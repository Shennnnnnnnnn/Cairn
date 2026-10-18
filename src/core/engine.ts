import { createHash, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Store } from './store.js';
import { normalizeCausality, resolveSources, workRef } from './causality.js';
import { snapshotArtifacts, artifactIssues, snapshotClaimReferences, claimReferenceIssues, referenceIssues } from './artifacts.js';
import { saveHandoffs, saveGeneratedHandoff, selectHandoffContext, completedNext } from './handoff.js';
import { localReferenceIssue } from './references.js';
import { CairnError, publicTask, type Session, type Scope, type Task, type Observation, type Claim, type Report, type Check, type Budget, type CheckpointInput, type FinishInput, type EvidenceMode, type ProgressInput, type ProgressItem, type CompletionVerifier, type CompletionRepair, type VerificationRecord, type VerificationResult, type OutcomeAssessment } from './types.js';

const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export const covers = (actual: Scope, required: Scope) => Object.entries(required).every(([k,v]) => actual[k as keyof Scope] === v);
function requireText(value: string, name: string) { if (!value.trim()) throw new CairnError('invalid_input', `${name} must not be empty`); }
const proofState = (task: Task) => JSON.stringify({
  origin:task.origin,goal:task.goal,constraints:task.constraints,artifacts:task.artifacts,artifactRequirements:task.artifactRequirements,
  claims: task.claims.map(({revision,updatedAt,history,...claim})=>claim), criteria: task.criteria, report: task.report,
});
export function assessOutcome(task:Task){
  return task.assessment?{...task.assessment,current:task.assessment.epoch===task.owner.epoch&&task.assessment.proof===createHash('sha256').update(proofState(task)).digest('hex')&&!artifactIssues(task).length&&!referenceIssues(task).length}:undefined;
}
/** Shared by live projections and exports so historical receipts cannot accept a new candidate. */
export function verificationCurrent(task:Task){
  return !!task.verification&&task.verification.verifier===task.completionVerifier&&task.verification.epoch===task.owner.epoch&&task.verification.proof===createHash('sha256').update(proofState(task)).digest('hex')&&!artifactIssues(task).length&&!referenceIssues(task).length;
}
const sameAuthoredClaim = (a: Omit<Claim,'id'|'revision'>, b: Omit<Claim,'id'|'revision'>) =>
  a.text===b.text && a.status===b.status && JSON.stringify(a.supports)===JSON.stringify(b.supports) &&
  JSON.stringify(a.refutes)===JSON.stringify(b.refutes) && JSON.stringify(a.scope)===JSON.stringify(b.scope) && a.key===b.key &&
  a.basis===b.basis && JSON.stringify(a.references)===JSON.stringify(b.references) && a.provenance===b.provenance && JSON.stringify(a.relatedCriteria)===JSON.stringify(b.relatedCriteria) && JSON.stringify(a.from)===JSON.stringify(b.from) && a.branchKey===b.branchKey;
const sameClaim = (a:Omit<Claim,'id'|'revision'>,b:Omit<Claim,'id'|'revision'>) => sameAuthoredClaim(a,b)&&JSON.stringify(a.referenceArtifacts)===JSON.stringify(b.referenceArtifacts);
function preserveRevision(old:Claim|undefined, next:Claim) {
  if(old && old!==next){const {history,...snapshot}=old;next.history=[...(history??[]),snapshot];}
  return next;
}
function unchangedProgress(task:Task,previous:ProgressItem[]|undefined){
  for(const [index,item] of (task.progress??[]).entries()){
    const old=previous?.find(value=>value.key===item.key&&value.source===item.source);
    if(old&&JSON.stringify({...old,updatedAt:''})===JSON.stringify({...item,updatedAt:''}))task.progress![index]=old;
  }
}
const curated = (task:Task) => task.evidenceMode==='curated';
const hasBasis = (claim:Pick<Claim,'basis'|'references'>) => Boolean(claim.basis?.trim()||claim.references?.some(ref=>ref.trim()));
function clipText(value:string,bytes:number){
  if(Buffer.byteLength(value,'utf8')<=bytes)return value;
  let prefix=value.slice(0,bytes-3);
  while(Buffer.byteLength(prefix,'utf8')>bytes-3)prefix=prefix.slice(0,-1);
  if(/[\uD800-\uDBFF]$/.test(prefix))prefix=prefix.slice(0,-1);
  return `${prefix}…`;
}
function boundedCheck(check:Check){
  return {ok:check.ok,issues:check.issues.slice(0,12).map(issue=>clipText(issue,220)),unmet:check.unmet.slice(0,24),warnings:check.warnings?.slice(0,12).map(issue=>clipText(issue,220)),
    omittedIssues:Math.max(0,check.issues.length-12),omittedUnmet:Math.max(0,check.unmet.length-24)};
}

export function evaluateTask(task:Task,now=new Date()):Check {
    const referenceCache=new Map();
    const unmet=task.criteria.filter(c=>!c.claimIds.length || c.claimIds.some(ref=>{
      const claim=task.claims.find(x=>x.id===ref);
      if(curated(task))return !claim||claim.status!=='supported'||claim.provenance!=='agent'||!hasBasis(claim)||!covers(claim.scope,task.scope)||!!claimReferenceIssues(task,claim,referenceCache).length;
      return !claim || claim.status!=='supported' || !claim.supports.length || claim.refutes.length || claim.supports.some(o=>!task.observations.find(x=>x.id===o&&x.eligible&&x.status==='success'));
    })).map(c=>c.id);
    const issues=unmet.map(c=>`Criterion ${c} lacks a supported conclusion`);
    for(const ref of new Set(task.criteria.flatMap(c=>c.claimIds))){const claim=task.claims.find(c=>c.id===ref);if(claim)issues.push(...claimReferenceIssues(task,claim,referenceCache));}
    if(curated(task))for(const ref of new Set(task.criteria.flatMap(criterion=>criterion.claimIds))){
      const claim=task.claims.find(value=>value.id===ref);
      if(claim&&!covers(claim.scope,task.scope))issues.push(`Conclusion ${ref} does not cover this task scope`);
    }
    if(task.interrupted)issues.push('Task was interrupted');
    if(Object.values(task.calls).some(c=>c.status==='running'))issues.push('Tool calls are still running');
    for(const item of task.progress??[])if(item.delegated&&item.status!=='cancelled'){
      if(item.branchStatus==='submitted')issues.push(`Branch ${item.key} requires owner review and merge`);
      if(item.lease&&item.lease.epoch===task.owner.epoch&&Date.parse(item.lease.expiresAt)>now.getTime())issues.push(`Branch ${item.key} still has a live worker lease`);
    }
    return {ok:!issues.length,issues,unmet};
  }

export interface EngineOptions {
  validateReference?: (reference:string, task:Task) => string | undefined;
  completionVerifier?:CompletionVerifier;
  hostBudget?:Pick<Budget,'deadline'|'submitReserveMs'>;
}
export interface ReopenOptions { takeover?:boolean; invalidate?:string[]; expectedRevision?:number; author?:'agent'|'human'|'verifier' }
export class Engine {
  constructor(readonly store: Store, readonly now: () => Date = () => new Date(), readonly options:EngineOptions = {}) {}
  at() { return this.now().toISOString(); }
  private proof(task:Task){return createHash('sha256').update(proofState(task)).digest('hex');}
  private handoffOn(task:Task,reason:string,branch?:{actor:Session;key:string}){return saveGeneratedHandoff(task,this.store.path,this.proof(task),this.at(),reason,branch);}
  verificationCurrent(task:Task){return verificationCurrent(task);}
  assessmentStatus(task:Task){
    return assessOutcome(task);
  }
  /** Host API only: no public agent tool can declare independent correctness. */
  assess(taskId:string,input:Pick<OutcomeAssessment,'status'|'summary'|'scope'|'reviewer'>,expectedRevision?:number){
    if(!['passed','failed','inconclusive'].includes(input.status))throw new CairnError('invalid_input','Invalid assessment status');
    for(const key of ['summary','scope','reviewer'] as const)if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>4000)throw new CairnError('invalid_input',`Assessment ${key} must be nonempty and at most 4000 characters`);
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);if(expectedRevision!==undefined)this.expectRevision(task,expectedRevision);
      if(!task.report)throw new CairnError('invalid_input','Save the candidate report before reviewing it');
      task.assessment={...input,at:this.at(),epoch:task.owner.epoch,proof:this.proof(task)};task.revision++;
      this.store.save(task,'outcome.assessed',{assessment:task.assessment},this.at());return this.assessmentStatus(task)!;
    });
  }
  private hostBudget(budget:Budget):Budget {
    const merged={...budget},host=this.options.hostBudget;
    if(host?.deadline){
      if(!Number.isFinite(Date.parse(host.deadline)))throw new CairnError('invalid_budget','Invalid host deadline');
      if(!merged.deadline||Date.parse(host.deadline)<Date.parse(merged.deadline))merged.deadline=host.deadline;
    }
    if(host?.submitReserveMs!==undefined)merged.submitReserveMs=Math.max(merged.submitReserveMs??0,host.submitReserveMs);
    if(merged.submitReserveMs!==undefined&&(!Number.isInteger(merged.submitReserveMs)||merged.submitReserveMs<0||merged.submitReserveMs>1800000))throw new CairnError('invalid_budget','Invalid submit reserve');
    return merged;
  }
  private verificationIssues(task:Task):string[]{
    if(!task.completionVerifier)return [];
    const fileIssues=[...artifactIssues(task),...referenceIssues(task)];if(fileIssues.length)return fileIssues;
    const record=task.verification;
    if(!record||record.verifier!==task.completionVerifier||record.proof!==this.proof(task)||record.epoch!==task.owner.epoch)return ['External completion verification is required for this revision'];
    return record.status==='passed'?[]:record.issues.map(issue=>`External verification ${record.status}: ${issue.message}`);
  }
  /** Await host execution outside SQLite transactions; late results never complete changed tasks. */
  async verify(taskId:string,session:Session,signal?:AbortSignal){
    const candidate=this.store.get(taskId);this.own(candidate,session);
    if(candidate.interrupted||candidate.status==='suspended')throw new CairnError('inactive_task','Resume before external verification');
    const verifier=this.options.completionVerifier;
    if(!verifier||verifier.id!==candidate.completionVerifier)throw new CairnError('verifier_unavailable','The configured completion verifier is unavailable');
    signal?.throwIfAborted();
    let result:VerificationResult,status:VerificationRecord['status'];
    try{
      const before=[...artifactIssues(candidate),...referenceIssues(candidate)];
      result=before.length?{ok:false,issues:before.map(message=>({message}))}:await verifier.verify(publicTask(candidate),signal);
      if(!result||typeof result.ok!=='boolean'||(result.issues!==undefined&&(!Array.isArray(result.issues)||result.issues.some(i=>!i||typeof i.message!=='string'||!i.message.trim()||i.claims!==undefined&&(!Array.isArray(i.claims)||i.claims.some(c=>typeof c!=='string'))||i.references!==undefined&&(!Array.isArray(i.references)||i.references.some(r=>typeof r!=='string'))))))throw new Error('Invalid verifier response');
      if(result.method!==undefined&&!['replay','inspection','contract'].includes(result.method)||result.scope!==undefined&&(typeof result.scope!=='string'||!result.scope.trim()))throw new Error('Invalid verifier method/scope');
      if(result.ok&&result.issues?.length)throw new Error('Passing verification cannot contain unresolved issues');
      const changed=[...artifactIssues(candidate),...referenceIssues(candidate)];
      if(changed.length)result={...result,ok:false,issues:[...(result.issues??[]),...changed.map(message=>({message}))]};
      status=result.ok?'passed':'failed';
    }catch(error){result={ok:false,issues:[{message:`Verifier unavailable: ${String((error as Error).message).slice(0,500)}`}]};status='error';}
    signal?.throwIfAborted();
    return this.store.transaction(()=>{
      let task=this.store.get(taskId);this.own(task,session);this.expectRevision(task,candidate.revision);
      if(task.owner.epoch!==candidate.owner.epoch||task.interrupted||task.status!==candidate.status)throw new CairnError('revision_conflict','Task changed during verification; refresh before retrying');
      const issues=(result.issues?.length?result.issues:status==='passed'?[]:[{message:'External validation rejected this completion'}]).slice(0,12).map(issue=>({message:clipText(issue.message,1000),...(issue.claims?{claims:issue.claims.slice(0,24)}:{}),...(issue.references?{references:issue.references.slice(0,8).map(ref=>clipText(ref,350))}:{})}));
      const record:VerificationRecord={verifier:verifier.id,status,issues,at:this.at(),checkedRevision:candidate.revision,epoch:candidate.owner.epoch,proof:this.proof(candidate),...(result.method?{method:result.method}:{}),...(result.scope?{scope:clipText(result.scope,2000)}:{}),...(candidate.artifacts?.length?{artifacts:candidate.artifacts}:{})};
      if(task.status==='completed'&&status!=='passed'){
        if(task.profile==='emergency'||task.delivery)throw new CairnError('report_frozen','Delivered and emergency reports cannot be reopened by verification');
        // Bad attribution must never roll back a real failure or retain an old pass.
        const invalidate=[...new Set(issues.flatMap(issue=>issue.claims??[]))].filter(ref=>task.claims.filter(claim=>claim.id===ref||claim.key===ref).length===1);
        task=this.reopenOn(task,session,issues.map(issue=>issue.message).join('; '),{invalidate,author:'verifier'});
      }
      task.verification=record;task.revision++;
      this.store.save(task,'task.verified',{verification:record,owner:task.owner,revision:task.revision},this.at());
      return record;
    });
  }
  async finishVerified(taskId:string,session:Session,input:FinishInput,signal?:AbortSignal){
    signal?.throwIfAborted();
    const first=this.finish(taskId,session,input,true),task=this.store.get(taskId);
    if(input.outcome!=='completed'||first.phase!=='incomplete'||!task.report||!this.evaluateReport(task,task.report).ok||!task.completionVerifier)return first;
    await this.verify(taskId,session,signal);
    return this.finish(taskId,session,{outcome:'completed'});
  }
  active(session: Session): Task | undefined {
    const binding = this.store.session(session); return binding?.taskId ? this.store.get(binding.taskId) : undefined;
  }
  private own(task: Task, session: Session) {
    const bound = this.store.session(session);
    if (task.owner.host !== session.host || task.owner.sessionId !== session.sessionId || task.owner.cwd !== session.cwd || bound?.taskId !== task.id || bound?.epoch !== task.owner.epoch || session.epoch!==undefined&&session.epoch!==task.owner.epoch)
      throw new CairnError('stale_owner', 'This session no longer owns this task. Explicitly resume to refresh its epoch; a different session requires takeover.');
  }
  assertActiveOwner(taskId:string,session:Session):Task{
    const task=this.store.get(taskId);this.own(task,session);
    if(task.status!=='active')throw new CairnError('inactive_task',`Task is ${task.status}`);
    return task;
  }
  private edit<T>(taskId: string, session: Session, kind: string, payload: unknown, fn: (task: Task) => T, allowSuspended = false): T {
    return this.store.transaction(() => {
      const task = this.store.get(taskId); this.own(task, session);
      if (task.status !== 'active' && !(allowSuspended && task.status === 'suspended')) throw new CairnError('inactive_task', `Task is ${task.status}`);
      const changesProof=['claim.revised','criterion.updated','report.saved'].includes(kind);
      if(changesProof)this.assertNoSubmission(task);
      const previous=changesProof?proofState(task):undefined, delivered=task.delivery;
      const result = fn(task);
      normalizeCausality(task);
      if(changesProof&&previous!==proofState(task)){
        if(delivered)throw new CairnError('report_frozen','The delivered report and its goal evidence are frozen; create a follow-up task');
        task.delivery=undefined;task.confirmedAt=undefined;
      }else if(delivered){task.delivery=delivered;}
      task.revision++; this.store.save(task, kind, {input:payload,result:result??null,owner:task.owner,revision:task.revision}, this.at()); return result;
    });
  }
  private assertNoSubmission(task:Task){
    const submits=this.store.config<{tools:{name:string;role?:string}[]}>('gateway')?.tools.filter(t=>t.role==='submit').map(t=>t.name)??[];
    if(Object.values(task.calls).some(c=>c.status==='running'&&submits.includes(c.tool)))throw new CairnError('submission_in_flight','Goal evidence and report are frozen while a submission is in flight');
  }
  private progressOn(task:Task,items:ProgressInput[],source:'agent'|'host',replace=false):boolean{
    if(!Array.isArray(items))throw new CairnError('invalid_input','Progress must be an array');
    const keys=new Set<string>(),values:ProgressInput[]=[];
    for(const item of items){
      if(!item||typeof item.key!=='string'||!item.key.trim()||typeof item.title!=='string'||!item.title.trim())throw new CairnError('invalid_input','Each progress item needs a nonempty key and title');
      if(keys.has(item.key))throw new CairnError('invalid_input',`Progress key ${item.key} is repeated`);
      if(!['pending','running','completed','blocked','cancelled'].includes(item.status))throw new CairnError('invalid_input','Invalid progress status');
      if(item.detail!==undefined&&typeof item.detail!=='string')throw new CairnError('invalid_input','Progress detail must be a string');
      if(item.delegated!==undefined&&typeof item.delegated!=='boolean')throw new CairnError('invalid_input','delegated must be a boolean');
      keys.add(item.key);values.push({key:item.key,title:item.title,status:item.status,...(item.detail===undefined?{}:{detail:item.detail}),...(item.from===undefined?{}:{from:item.from}),...(item.delegated===undefined?{}:{delegated:item.delegated})});
    }
    const previous=task.progress??[],next=previous.map(item=>({...item}));let changed=false;
    for(const value of values){
      const index=next.findIndex(item=>item.key===value.key&&item.source===source),old=index<0?undefined:next[index];
      if(old?.lease&&Date.parse(old.lease.expiresAt)>this.now().getTime())throw new CairnError('branch_claimed','Release the branch lease before editing its progress');
      const item:ProgressItem={...old,...value,source,updatedAt:this.at()};
      if(item.delegated&&!item.branchStatus)item.branchStatus='open';
      if(value.delegated===false){item.branchStatus=undefined;item.lease=undefined;}
      if(old&&JSON.stringify({...old,updatedAt:''})===JSON.stringify({...item,updatedAt:''}))continue;
      if(index<0)next.push(item);else next[index]=item;changed=true;
    }
    if(replace)for(const item of next){
      if(item.source===source&&!keys.has(item.key)&&!['completed','cancelled'].includes(item.status)){
        if(item.lease)throw new CairnError('branch_claimed','Release the branch lease before removing it from the plan');
        item.status='cancelled';item.detail='Removed from the current plan';item.updatedAt=this.at();changed=true;
      }
    }
    if(changed)task.progress=next;
    return changed;
  }
  /** Host plans and explicit reasoning checkpoints share progress semantics without tool telemetry. */
  recordProgress(taskId:string,session:Session,items:ProgressInput[],source:'agent'|'host'='agent',replace=false){
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);this.own(task,session);
      if(task.status!=='active')throw new CairnError('inactive_task',`Task is ${task.status}`);
      if(!['agent','host'].includes(source))throw new CairnError('invalid_input','Invalid progress source');
      const previous=task.progress;
      this.progressOn(task,items,source,replace);normalizeCausality(task);unchangedProgress(task,previous);
      if(JSON.stringify(previous)!==JSON.stringify(task.progress)){
        task.revision++;this.store.save(task,'progress.updated',{items,source,replace,owner:task.owner,revision:task.revision},this.at());
      }
      return task.progress??[];
    });
  }
  private pauseProgress(task:Task,detail='Paused with this task'){
    for(const item of task.progress??[])if(item.lease){item.lease=undefined;item.branchStatus='open';}
    for(const item of task.progress??[])if(item.status==='running'){
      item.status='blocked';item.detail=detail;item.updatedAt=this.at();
    }
  }
  create(session: Session, input: { title?:string; origin: string; goal: string; constraints?:string[]; criteria: string[]; profile?: 'general'|'emergency'; scope?: Scope; budget?: Partial<Budget>; evidenceMode?:EvidenceMode; progress?:ProgressInput[]; referencePolicy?:'advisory'|'strict' }): Task {
    if(input.title!==undefined)requireText(input.title,'title');
    requireText(input.goal, 'goal'); requireText(input.origin, 'origin');
    if (!input.criteria.length || input.criteria.some(c => !c.trim())) throw new CairnError('invalid_input', 'Supply at least one nonempty completion criterion');
    return this.store.transaction(() => {
      const existing = this.active(session);
      if (existing?.status === 'active') throw new CairnError('active_task', 'Suspend or complete the current task before creating another');
      const scope = input.scope ?? {}, profile = input.profile ?? 'general', evidenceMode=input.evidenceMode??'captured';
      if(!['captured','curated'].includes(evidenceMode))throw new CairnError('invalid_input','Evidence mode must be curated or captured');
      if(input.referencePolicy!==undefined&&!['advisory','strict'].includes(input.referencePolicy))throw new CairnError('invalid_input','Invalid reference policy');
      if(profile==='emergency'&&evidenceMode==='curated')throw new CairnError('missing_capabilities','Emergency profile requires captured evidence with genuine platform references');
      if(evidenceMode==='curated'&&(input.budget?.maxCalls!==undefined||input.budget?.maxParallel!==undefined))throw new CairnError('invalid_budget','Curated tasks do not record tool calls, so call counts and concurrency cannot be enforced; omit maxCalls/maxParallel or use captured mode');
      const budget=this.hostBudget({...(evidenceMode==='captured'?{maxParallel:3}:{}),...input.budget});
      if (budget.deadline && !Number.isFinite(Date.parse(budget.deadline))) throw new CairnError('invalid_input', 'Invalid deadline');
      if ((budget.maxParallel!==undefined&&(budget.maxParallel < 1 || !Number.isInteger(budget.maxParallel))) || (budget.maxCalls !== undefined && (!Number.isInteger(budget.maxCalls) || budget.maxCalls < 1))) throw new CairnError('invalid_input', 'Invalid budget');
      if (profile === 'emergency') {
        if (!scope.teamId || !scope.roundId || !scope.issueId || !scope.matchId) throw new CairnError('missing_scope', 'Emergency tasks need teamId, roundId, issueId and matchId');
        const caps = this.store.session(session)?.capabilities;
        if (!caps?.capture || !caps.preTool || !caps.restore || !caps.stop) throw new CairnError('missing_capabilities', 'Emergency profile requires native capture, preTool, restore and stop integration. Run doctor and load trusted hooks.');
        const tools = this.store.config<{tools: unknown[]}>('gateway');
        if (!tools?.tools.length) throw new CairnError('missing_whitelist', 'Configure the official competition whitelist and result_ref mappings before starting an emergency task');
        const match = this.store.db.prepare('SELECT * FROM matches WHERE id=?').get(scope.matchId);
        if (match && match.team !== scope.teamId) throw new CairnError('scope_mismatch', 'Match belongs to another team');
        const deadline = match?.deadline as string ?? new Date(this.now().getTime() + 30*60_000).toISOString();
        if (Date.parse(deadline) <= this.now().getTime()) throw new CairnError('deadline', 'Match deadline has passed');
        this.store.db.prepare('INSERT OR IGNORE INTO matches VALUES (?,?,?)').run(scope.matchId, scope.teamId, deadline);
        budget.deadline = budget.deadline && Date.parse(budget.deadline) < Date.parse(deadline) ? budget.deadline : deadline;
        budget.submitReserveMs??=30000;
      }
      const task: Task = { id: id('task'),...(input.title?{title:input.title}:{}), origin: input.origin, goal: input.goal,constraints:input.constraints??[],
        criteria: input.criteria.map((text,i) => ({id:`c${i+1}`,text,claimIds:[]})), profile, scope, budget,evidenceMode,
        owner: {...session,epoch:1}, revision:1, createdAt:this.at(), status:'active',
        observations:[], claims:[], actions:[], hints:[], calls:{}, interrupted:false,execution:{state:'running',at:this.at(),epoch:1},...(this.options.completionVerifier?{completionVerifier:this.options.completionVerifier.id,...(this.options.completionVerifier.artifacts?.length?{artifactRequirements:this.options.completionVerifier.artifacts}: {})}:{}),...(input.referencePolicy?{referencePolicy:input.referencePolicy}:{}) };
      if(input.progress!==undefined)this.progressOn(task,input.progress,'agent');
      normalizeCausality(task);
      this.handoffOn(task,'created');
      this.store.save(task, 'task.created', task, this.at()); this.store.bind(session, task); return task;
    });
  }
  resume(taskId: string, session: Session, takeover = false): Task {
    return this.store.transaction(() => {
      const task = this.store.get(taskId);
      const current=this.active(session);
      if(current?.status==='active'&&current.id!==taskId)throw new CairnError('active_task','Suspend or complete the current task before resuming another');
      if (task.status === 'completed') throw new CairnError('completed_task', 'Completed tasks require an explicit reopen reason before resuming');
      if (!takeover && (task.owner.host !== session.host || task.owner.sessionId !== session.sessionId || task.owner.cwd !== session.cwd)) throw new CairnError('takeover_required', 'A different session or workspace owns this task; explicit takeover is required');
      if (task.profile === 'emergency') {
        const caps = this.store.session(session)?.capabilities;
        if (!caps?.capture || !caps.preTool || !caps.restore || !caps.stop) throw new CairnError('missing_capabilities', 'This host cannot resume a strict emergency task');
      }
      if (takeover || task.status==='suspended') {
        this.handoffOn(task,'before-takeover');
        task.owner = {...session,epoch:task.owner.epoch+1};
        for (const call of Object.values(task.calls)) if (call.status === 'running') call.status = 'finished';
        for (const action of task.actions) if (action.status === 'running') action.status = 'cancelled';
        this.pauseProgress(task,'Previous session stopped; resume this step explicitly if still needed');
      }
      task.budget=this.hostBudget(task.budget);
      task.status='active'; task.interrupted=false; task.revision++;
      this.store.save(task, 'task.resumed', {session,takeover}, this.at()); this.store.bind(session,task); return task;
    });
  }
  suspend(taskId: string, session: Session) {
    return this.edit(taskId,session,'task.suspended',{},task=>{task.status='suspended';task.interrupted=true;this.pauseProgress(task);this.handoffOn(task,'suspended');});
  }
  hint(taskId: string, session: Session, text: string, author: string) {
    return this.edit(taskId,session,'hint.added',{text,author},task=>{const hint={id:id('hint'),text,author};task.hints.push(hint);return hint;});
  }
  /** Human inputs are graph-external and may be appended even after completion. */
  addHint(taskId:string,text:string,author='human',expectedRevision?:number){
    requireText(text,'hint');requireText(author,'author');
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);this.expectRevision(task,expectedRevision);
      const hint={id:id('hint'),text,author};task.hints.push(hint);task.revision++;
      this.store.save(task,'hint.added',{...hint,actor:'human'},this.at());return hint;
    });
  }
  private expectRevision(task:Task,revision?:number){
    if(revision!==undefined&&task.revision!==revision)throw new CairnError('revision_conflict','Task changed; refresh before applying this action');
  }
  suspendByHuman(taskId:string,expectedRevision?:number){
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);
      this.expectRevision(task,expectedRevision);
      if(task.status!=='active')throw new CairnError('inactive_task',`Task is ${task.status}`);
      this.assertNoSubmission(task);this.handoffOn(task,'before-human-suspend');task.status='suspended';task.interrupted=true;task.owner.epoch++;
      for(const call of Object.values(task.calls))if(call.status==='running')call.status='finished';
      for(const action of task.actions)if(action.status==='running')action.status='cancelled';
      this.pauseProgress(task);task.revision++;this.store.bind(task.owner,task);
      this.store.save(task,'task.suspended',{actor:'human'},this.at());return this.context(taskId);
    });
  }
  reopen(taskId:string,session:Session,reason:string,options:ReopenOptions={}){
    return this.store.transaction(()=>this.reopenOn(this.store.get(taskId),session,reason,options));
  }
  private reopenOn(task:Task,session:Session,reason:string,options:ReopenOptions={}){
    requireText(reason,'reopen reason');
    const {takeover=false,invalidate=[],expectedRevision,author='agent'}=options;
    const current=this.active(session);
    this.expectRevision(task,expectedRevision);
      if(task.status!=='completed')throw new CairnError('invalid_state','Only completed tasks can be reopened');
      if(task.profile==='emergency'||task.delivery)throw new CairnError('report_frozen','Delivered and emergency tasks are frozen; create a follow-up task');
      if(current?.status==='active'&&current.id!==task.id)throw new CairnError('active_task','Suspend or complete the current task before reopening another');
      if(!takeover&&(task.owner.host!==session.host||task.owner.sessionId!==session.sessionId||task.owner.cwd!==session.cwd))throw new CairnError('takeover_required','Explicit takeover is required to reopen from a different session');
      const invalidated=invalidate.map(ref=>{
        const matches=task.claims.filter(c=>c.id===ref||c.key===ref);
        if(matches.length!==1)throw new CairnError('not_found',`Unknown or ambiguous finding ${ref}`);return matches[0]!;
      });
      const previous={revision:task.revision,owner:task.owner,report:task.report,criteria:structuredClone(task.criteria)};
      for(const old of new Set(invalidated)){
        const next=preserveRevision(old,{...old,status:'proposed',revision:old.revision+1,updatedAt:this.at()});
        task.claims[task.claims.indexOf(old)]=next;
      }
      // A reopened goal must be explicitly verified again, even if old facts remain valid.
      for(const criterion of task.criteria)criterion.claimIds=[];
      const feedback:Claim={id:id('claim'),text:reason,status:'proposed',supports:[],refutes:[],scope:task.scope,provenance:author,revision:1,updatedAt:this.at(),from:[...new Set(previous.criteria.flatMap(c=>c.claimIds))].map(ref=>`claim:${ref}`)};
      task.claims.push(feedback);task.hints.push({id:id('hint'),text:`[REOPEN] ${reason}`,author:author==='human'?'human':author==='verifier'?'verifier':`${session.host}:${session.sessionId}`});
      task.budget=this.hostBudget(task.budget);
      task.owner={...session,epoch:task.owner.epoch+1};task.status='active';task.interrupted=false;task.confirmedAt=undefined;task.continuation=undefined;task.lastCheck=undefined;task.finishAttempt=undefined;
      this.pauseProgress(task,'Reopened for external verification');
      task.checkpoint={summary:`Reopened: ${reason}`,questions:[reason],next:'Revalidate the affected findings and completion criteria',at:this.at()};
      normalizeCausality(task);task.revision++;this.store.bind(session,task);
      this.handoffOn(task,'reopened');
      this.store.save(task,'task.reopened',{reason,invalidate,feedback,previous,author,owner:task.owner,revision:task.revision},this.at());return task;
  }
  claim(taskId: string, session: Session, input: Omit<Claim,'id'|'revision'|'scope'|'referenceArtifacts'> & {id?:string;scope?:Scope}) {
    return this.edit(taskId,session,'claim.revised',input,task=>{
      const old=input.id ? task.claims.find(c=>c.id===input.id) : undefined;
      if(input.id && !old)throw new CairnError('not_found','Unknown claim');
      const claim: Claim=preserveRevision(old,{...input,id:old?.id??id('claim'),revision:(old?.revision??0)+1,scope:input.scope??task.scope,updatedAt:this.at()});
      // Host metadata is never accepted from a model or an SDK object spread.
      delete claim.referenceArtifacts;
      requireText(claim.text,'claim');
      if(curated(task)){
        if(claim.supports.length||claim.refutes.length)throw new CairnError('invalid_evidence_mode','Curated findings use basis and file/link references, without raw observations');
        if(claim.basis!==undefined&&typeof claim.basis!=='string')throw new CairnError('invalid_input','Finding basis must be a string');
        if(claim.references!==undefined&&(!Array.isArray(claim.references)||claim.references.some(ref=>typeof ref!=='string'||!ref.trim())))throw new CairnError('invalid_input','Finding references must be nonempty strings');
        if(['supported','refuted'].includes(claim.status)&&!hasBasis(claim))throw new CairnError('unsupported_claim','Supported or refuted curated findings need an explanation or file/link references');
        if(claim.status==='supported'&&task.criteria.some(criterion=>criterion.claimIds.includes(claim.id))&&!covers(claim.scope,task.scope))throw new CairnError('scope_mismatch','A conclusion used for completion must cover this task scope');
        claim.provenance='agent';
        claim.referenceArtifacts=snapshotClaimReferences(task,claim.references);
        if(claim.status!=='supported')for(const criterion of task.criteria)criterion.claimIds=criterion.claimIds.filter(ref=>ref!==claim.id);
      }else{
        for(const ref of [...claim.supports,...claim.refutes]) this.evidence(task,ref,claim.scope);
        if(claim.status==='supported' && (!claim.supports.length || claim.refutes.length))throw new CairnError('unsupported_claim','Supported claims need supporting observations and no unresolved refutations');
        if(claim.status==='refuted' && !claim.refutes.length)throw new CairnError('unsupported_claim','Refuted claims need refuting observations');
        claim.provenance='captured';
      }
      if(old)task.claims[task.claims.indexOf(old)]=claim;else task.claims.push(claim);
      return claim;
    });
  }
  satisfy(taskId: string, session: Session, criterionId: string, claimIds: string[]) {
    return this.edit(taskId,session,'criterion.updated',{criterionId,claimIds},task=>{
      const criterion=task.criteria.find(c=>c.id===criterionId);if(!criterion)throw new CairnError('not_found','Unknown criterion');
      for(const claimId of claimIds) {
        const c=task.claims.find(c=>c.id===claimId);if(!c || c.status!=='supported')throw new CairnError('unsupported_claim','Completion requires supported claims');
        if(curated(task)&&!covers(c.scope,task.scope))throw new CairnError('scope_mismatch','A conclusion used for completion must cover this task scope');
      }
      criterion.claimIds=[...new Set(claimIds)];return criterion;
    });
  }
  action(taskId: string, session: Session, input: {id?:string;purpose:string;stopCondition:string;status:'planned'|'running'|'completed'|'failed'|'cancelled';observationIds:string[]}) {
    return this.edit(taskId,session,'action.updated',input,task=>{
      const old=task.actions.find(a=>a.id===input.id); if(input.id&&!old)throw new CairnError('not_found','Unknown action');
      for(const ref of input.observationIds)this.evidence(task,ref,task.scope);
      const action={...input,id:old?.id??id('action')};if(old)task.actions[task.actions.indexOf(old)]=action;else task.actions.push(action);return action;
    });
  }
  /** Resolve a local alias, immutable ID or unambiguous platform reference, including failed observations for inspection. */
  resolveEvidence(taskId:string,ref:string):Observation{return this.resolve(this.store.get(taskId),ref);}
  private resolve(task:Task,ref:string):Observation{
    if(typeof ref!=='string'||!ref.trim())throw new CairnError('invalid_evidence','Evidence reference must be nonempty');
    const alias=/^E([1-9]\d*)$/.exec(ref);
    if(alias){const observation=task.observations[Number(alias[1])-1];if(observation)return observation;}
    else {
      const exact=task.observations.find(o=>o.id===ref);if(exact)return exact;
      const matches=task.observations.filter(o=>o.resultRef===ref);
      if(matches.length>1)throw new CairnError('ambiguous_evidence',`result_ref ${ref} identifies multiple observations; use E# or an observation ID`);
      if(matches[0])return matches[0];
    }
    throw new CairnError('invalid_evidence',`Evidence ${ref} does not belong to this task`);
  }
  private checkpointOn(task:Task,input:CheckpointInput,branchKey?:string){
    this.assertNoSubmission(task);
    if(typeof input.summary!=='string')throw new CairnError('invalid_input','Checkpoint summary is required');
    requireText(input.summary,'checkpoint summary');
    if(input.questions!==undefined&&(!Array.isArray(input.questions)||input.questions.some(q=>typeof q!=='string'||!q.trim())))throw new CairnError('invalid_input','Questions must be nonempty strings');
    if(input.next!==undefined&&typeof input.next!=='string')throw new CairnError('invalid_input','Next action must be a string');
    if(input.findings!==undefined&&!Array.isArray(input.findings))throw new CairnError('invalid_input','Findings must be an array');
    const previous=proofState(task),previousClaims=task.claims.slice(),oldProgress=task.progress,previousProgress=JSON.stringify(task.progress),keys=new Set<string>(),isCurated=curated(task);
    const coverage=(claimId:string)=>task.criteria.filter(c=>c.claimIds.includes(claimId)).map(c=>c.id);
    const sameCoverage=(claimId:string,ids:string[])=>{const current=coverage(claimId);return current.length===ids.length&&current.every(ref=>ids.includes(ref));};
    for(const finding of input.findings??[]){
      if(typeof finding.text!=='string')throw new CairnError('invalid_input','Finding text is required');
      requireText(finding.text,'finding');
      if(finding.key!==undefined){
        if(typeof finding.key!=='string'||!finding.key.trim())throw new CairnError('invalid_input','Finding key must be nonempty');
        if(keys.has(finding.key))throw new CairnError('invalid_input',`Finding key ${finding.key} is repeated in this checkpoint`);
        keys.add(finding.key);
      }
      let old=finding.key?task.claims.find(c=>c.key===finding.key):undefined;
      if(branchKey&&old&&old.branchKey!==branchKey)throw new CairnError('branch_restricted','A worker cannot overwrite findings outside its branch');
      const scope=finding.scope??old?.scope??task.scope;
      const refs=(values:string[]|undefined,existing:string[])=>{
        if(values===undefined)return existing;
        if(!Array.isArray(values))throw new CairnError('invalid_evidence','Evidence references must be an array');
        if(isCurated&&values.length)throw new CairnError('invalid_evidence_mode','Curated findings use basis and file/link references, without raw observations');
        return [...new Set(values.map(ref=>{const o=this.resolve(task,ref);this.evidence(task,o.id,scope);return o.id;}))];
      };
      const supports=refs(finding.evidence,old?.supports??[]),refutes=refs(finding.against,old?.refutes??[]);
      for(const ref of [...supports,...refutes])this.evidence(task,ref,scope);
      if(finding.basis!==undefined&&typeof finding.basis!=='string')throw new CairnError('invalid_input','Finding basis must be a string');
      if(finding.references!==undefined&&(!Array.isArray(finding.references)||finding.references.some(ref=>typeof ref!=='string'||!ref.trim())))throw new CairnError('invalid_input','Finding references must be nonempty strings');
      const basis=finding.basis??old?.basis,references=finding.references===undefined?old?.references:[...new Set(finding.references)];
      const justified=hasBasis({basis,references});
      let status=branchKey?'proposed':finding.status??old?.status??(isCurated?(justified?'supported':'proposed'):(supports.length?(refutes.length?'inconclusive':'supported'):(refutes.length?'refuted':'proposed')));
      if(finding.status===undefined){
        if(isCurated&&old&&['supported','refuted'].includes(old.status)&&!justified)status='proposed';
        if(!isCurated&&old?.status==='supported'&&(!supports.length||refutes.length))status=refutes.length?'inconclusive':'proposed';
        if(!isCurated&&old?.status==='refuted'&&!refutes.length)status=supports.length?'inconclusive':'proposed';
      }
      if(!['proposed','supported','refuted','inconclusive'].includes(status))throw new CairnError('invalid_input','Invalid finding status');
      if(isCurated){
        if(['supported','refuted'].includes(status)&&!justified)throw new CairnError('unsupported_claim','Supported or refuted curated findings need an explanation or file/link references');
      }else{
        if(status==='supported'&&(!supports.length||refutes.length))throw new CairnError('unsupported_claim','Supported findings need supporting observations and no unresolved refutations');
        if(status==='refuted'&&!refutes.length)throw new CairnError('unsupported_claim','Refuted findings need refuting observations');
      }
      let criteria:Task['criteria']|undefined;
      if(finding.covers!==undefined){
        if(!Array.isArray(finding.covers))throw new CairnError('invalid_input','Finding covers must be an array');
        criteria=[...new Set(finding.covers)].map(ref=>{
          const matches=task.criteria.filter(c=>c.id===ref||c.text===ref);
          if(matches.length!==1)throw new CairnError('invalid_criterion',`Criterion ${ref} is unknown or ambiguous; use its c# identifier`);
          return matches[0]!;
        });
      }else if(isCurated&&old?.relatedCriteria){const related=old.relatedCriteria;criteria=task.criteria.filter(c=>related.includes(c.id));}
      else if(!old&&task.criteria.length===1&&status==='supported')criteria=[task.criteria[0]!];
      if(isCurated&&status==='supported'&&criteria?.length&&!covers(scope,task.scope))throw new CairnError('scope_mismatch','A conclusion used for completion must cover this task scope');
      const value:Omit<Claim,'id'|'revision'>={text:finding.text,status,supports,refutes,scope,...(finding.key?{key:finding.key}:{}),
        ...(finding.from===undefined?(old?.from?{from:old.from}:{}):{from:finding.from}),
        ...(branchKey?{branchKey}:old?.branchKey?{branchKey:old.branchKey}:{}),
        ...(isCurated?{provenance:'agent' as const,...(basis===undefined?{}:{basis}),...(references===undefined?{}:{references}),relatedCriteria:criteria?.map(c=>c.id)??old?.relatedCriteria??[]}: {provenance:'captured' as const})};
      if(branchKey)value.provenance='subagent';
      // Unkeyed exact retries reuse the original conclusion; readable keys permit deliberate revisions.
      old??=task.claims.find(c=>sameAuthoredClaim(c,value)&&(isCurated||sameCoverage(c.id,criteria?.map(c=>c.id)??[])));
      if(isCurated)value.referenceArtifacts=snapshotClaimReferences(task,references,input.artifacts);
      const claim:Claim=old&&sameClaim(old,value)?old:preserveRevision(old,{...value,id:old?.id??id('claim'),revision:(old?.revision??0)+1,updatedAt:this.at()});
      if(old)task.claims[task.claims.indexOf(old)]=claim;else task.claims.push(claim);
      if(isCurated){
        for(const criterion of task.criteria)criterion.claimIds=criterion.claimIds.filter(ref=>ref!==claim.id);
        if(status==='supported')for(const criterion of criteria??[])criterion.claimIds.push(claim.id);
      }else if(criteria!==undefined){
        for(const criterion of task.criteria)criterion.claimIds=criterion.claimIds.filter(ref=>ref!==claim.id);
        for(const criterion of criteria)criterion.claimIds.push(claim.id);
      }
    }
    if(input.progress!==undefined)this.progressOn(task,input.progress,'agent');
    normalizeCausality(task);
    // Resolve aliases before comparing anonymous retries. Keep forward references
    // valid for the whole batch and never merge findings across branch identities.
    for(const claim of task.claims.slice()){
      if(claim.key||previousClaims.some(old=>old.id===claim.id)||!task.claims.some(c=>c.id===claim.id))continue;
      const existing=task.claims.find(other=>other.id!==claim.id&&sameAuthoredClaim(other,claim)&&(isCurated||sameCoverage(other.id,coverage(claim.id))));
      if(!existing)continue;
      const revised=sameClaim(existing,claim)?existing:preserveRevision(existing,{...claim,id:existing.id,revision:existing.revision+1,updatedAt:this.at()});
      task.claims=task.claims.filter(other=>other.id!==claim.id).map(other=>other.id===existing.id?revised:other);
      for(const criterion of task.criteria)criterion.claimIds=[...new Set(criterion.claimIds.map(ref=>ref===claim.id?existing.id:ref))];
      for(const node of [...task.claims,...(task.progress??[])])if(node.from)node.from=[...new Set(node.from.map(ref=>ref===`claim:${claim.id}`?`claim:${existing.id}`:ref))];
    }
    if(input.progress!==undefined)unchangedProgress(task,oldProgress);
    for(const [index,claim] of task.claims.entries()){
      const old=previousClaims.find(value=>value.id===claim.id);
      if(old&&sameClaim(old,claim))task.claims[index]=old;
    }
    if(branchKey)return previous!==proofState(task);
    if(input.artifacts!==undefined)task.artifacts=snapshotArtifacts(task.owner.cwd,input.artifacts);
    const handoffChanged=input.handoffs!==undefined&&saveHandoffs(task,input.handoffs,this.at());
    const citationKeys=new Set<string>(),citations:Report['citations']=[];
    if(!isCurated)for(const criterion of task.criteria)for(const claimId of criterion.claimIds){
      const claim=task.claims.find(c=>c.id===claimId);
      if(!claim||claim.status!=='supported'||!claim.supports.length||claim.refutes.length)continue;
      for(const ref of claim.supports){
        const observation=this.evidence(task,ref,task.scope),key=`${ref}\0${claim.text}`;
        if(!citationKeys.has(key)){citationKeys.add(key);citations.push({observationId:ref,...(observation.resultRef?{resultRef:observation.resultRef}:{}),statement:claim.text});}
      }
    }
    const report:Report={...task.report,summary:input.report?.summary??task.report?.summary??input.summary,citations,
      ...(isCurated?{curatedReferences:task.claims.filter(claim=>claim.status==='supported'&&hasBasis(claim)&&covers(claim.scope,task.scope)).map(claim=>({claimId:claim.id,statement:claim.text,...(claim.basis===undefined?{}:{basis:claim.basis}),references:claim.references??[]}))}:{})};
    if(typeof report.summary!=='string')throw new CairnError('invalid_input','Report summary must be a string');
    requireText(report.summary,'report summary');
    if(input.report?.impact){
      const impact=input.report.impact;
      if(!Array.isArray(impact.observationIds))throw new CairnError('invalid_input','Impact observationIds must be an array');
      report.impact={...task.report?.impact,...impact,observationIds:[...new Set(impact.observationIds.map(ref=>{
        const o=this.resolve(task,ref);this.evidence(task,o.id,impact.scope);return o.id;
      }))]};
    }
    if(input.report?.rootCause)report.rootCause={...task.report?.rootCause,...input.report.rootCause};
    if(input.report?.solution)report.solution={...task.report?.solution,...input.report.solution};
    task.report=report;
    const proofChanged=previous!==proofState(task);
    if(proofChanged){
      if(task.delivery)throw new CairnError('report_frozen','The delivered report and its goal evidence are frozen; create a follow-up task');
      task.delivery=undefined;task.confirmedAt=undefined;
    }
    const progressChanged=previousProgress!==JSON.stringify(task.progress);
    const next={summary:input.summary,questions:input.questions??task.checkpoint?.questions??[],next:input.next??task.checkpoint?.next};
    const {at,...oldCheckpoint}=task.checkpoint??{at:''};
    const changed=proofChanged||progressChanged||handoffChanged||JSON.stringify(next)!==JSON.stringify(oldCheckpoint);
    if(changed)task.checkpoint={...next,at:this.at()};
    if(changed&&task.conclude?.status==='requested')task.conclude={status:'saved',at:this.at(),revision:task.revision+1};
    return changed;
  }
  /** Coordination is separate from evidence. Only explicitly delegated agent stages are claimable. */
  branch(taskId:string,session:Session,key:string,action:'claim'|'heartbeat'|'release'|'checkpoint'|'merge',token?:string,input?:CheckpointInput,ttlSeconds=120){
    if(!Number.isInteger(ttlSeconds)||ttlSeconds<10||ttlSeconds>900)throw new CairnError('invalid_input','Branch lease must be 10–900 seconds');
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);
      if(task.status!=='active'||task.interrupted)throw new CairnError('inactive_task','Branches require an active task');
      this.assertNoSubmission(task);
      if(task.delivery)throw new CairnError('report_frozen','Delivered goal evidence is frozen');
      const item=task.progress?.find(p=>p.key===key&&p.source==='agent');
      if(!item?.delegated)throw new CairnError('invalid_branch','The owner must explicitly delegate this progress item first');
      const now=this.now().getTime(),lease=item.lease;
      const ownsLease=lease&&lease.actor.host===session.host&&lease.actor.sessionId===session.sessionId&&lease.actor.cwd===session.cwd&&lease.epoch===task.owner.epoch&&lease.token===token&&Date.parse(lease.expiresAt)>now;
      if(action==='merge'){
        this.own(task,session);
        if(item.branchStatus!=='submitted')throw new CairnError('invalid_branch','Only submitted branches can be merged');
        item.branchStatus='merged';item.lease=undefined;item.status='completed';
      }else if(action==='claim'){
        if(['submitted','merged'].includes(item.branchStatus??'')||['completed','cancelled'].includes(item.status))throw new CairnError('invalid_branch','Branch is already submitted, merged or closed');
        if(lease&&lease.epoch===task.owner.epoch&&Date.parse(lease.expiresAt)>now)throw new CairnError('branch_claimed','This branch already has a live lease');
        if(session.host===task.owner.host&&session.sessionId===task.owner.sessionId)throw new CairnError('invalid_branch','Use a separate worker session for delegated work');
        const current=this.active(session);
        if(current?.id!==task.id&&current?.status==='active')throw new CairnError('active_task','The worker is already bound to another active goal');
        const count=(task.progress??[]).filter(p=>p.lease&&p.lease.epoch===task.owner.epoch&&Date.parse(p.lease.expiresAt)>now).length;
        if(count>=(task.budget.maxParallel??32))throw new CairnError('concurrency','Maximum parallel branches reached');
        item.lease={token:randomUUID(),actor:{...session},epoch:task.owner.epoch,expiresAt:new Date(now+ttlSeconds*1000).toISOString()};
        item.branchStatus='claimed';item.status='running';this.store.bind(session,task);
      }else{
        // Owners may revoke a lease without impersonating its worker.
        if(action==='release'){
          let owner=false;try{this.own(task,session);owner=true;}catch{}
          if(!owner&&!ownsLease)throw new CairnError('stale_lease','Branch lease is expired, revoked or belongs to another worker');
          if(item.branchStatus==='merged')throw new CairnError('invalid_branch','Merged branches are closed');
          item.lease=undefined;item.branchStatus='open';item.status='pending';
        }else{
          if(!ownsLease||item.branchStatus!=='claimed')throw new CairnError('stale_lease','Branch lease is expired, revoked or belongs to another worker');
          if(action==='heartbeat')item.lease!.expiresAt=new Date(now+ttlSeconds*1000).toISOString();
          else if(action==='checkpoint'){
            if(!input)throw new CairnError('invalid_input','Branch checkpoint needs a summary');
            if(input.artifacts||input.handoffs||input.report||input.progress||input.findings?.some(f=>f.covers?.length||f.status&&f.status!=='proposed'))throw new CairnError('branch_restricted','Workers may only submit proposed findings for their own branch; report, progress and criterion writes require the owner');
            const findings=input.findings?.map((finding,index)=>{
              const localKey=finding.key??String(index+1),digest=createHash('sha256').update(JSON.stringify([key,localKey])).digest('hex');
              const findingKey=`branch:${encodeURIComponent(key).slice(0,40)}:${encodeURIComponent(localKey).slice(0,40)}:${digest}`;
              return {...finding,key:findingKey,status:'proposed' as const,from:finding.from??[workRef(item)],covers:[]};
            });
            this.checkpointOn(task,{summary:input.summary,findings,questions:input.questions,next:input.next},key);
            item.branchCheckpoint={summary:input.summary,questions:input.questions??[],next:input.next,at:this.at()};item.branchStatus='submitted';item.status='completed';item.lease=undefined;
          }else throw new CairnError('invalid_input','Unknown branch action');
        }
      }
      item.updatedAt=this.at();task.revision++;
      if(action==='checkpoint')this.handoffOn(task,'branch-submitted',{actor:session,key});
      // Tokens are returned only to the lease holder, not copied into audit payloads.
      this.store.save(task,`branch.${action}`,{key,actor:session,status:item.branchStatus,checkpoint:item.branchCheckpoint,summary:item.branchCheckpoint?.summary,revision:task.revision},this.at());
      return {taskId,key,status:item.branchStatus,...(item.lease?{leaseToken:item.lease.token,expiresAt:item.lease.expiresAt}:{}),context:this.context(task.id)};
    });
  }
  checkpoint(taskId:string,session:Session,input:CheckpointInput,incremental=false){
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);this.own(task,session);
      if(task.status!=='active')throw new CairnError('inactive_task',`Task is ${task.status}`);
      const increment=()=>JSON.stringify({proof:this.proof(task),questions:task.checkpoint?.questions??[],next:task.checkpoint?.next,progress:task.progress?.map(({updatedAt,...p})=>p),handoffs:task.handoffs?.filter(h=>!h.source)});
      const before=incremental?increment():undefined;
      if(this.checkpointOn(task,input)&&(!incremental||before!==increment())){
        task.revision++;this.handoffOn(task,'checkpoint');this.store.save(task,'task.checkpoint',{input,owner:task.owner,revision:task.revision},this.at());
      }
      return {...this.context(taskId),validation:boundedCheck(this.evaluateReport(task,task.report!))};
    });
  }
  finish(taskId:string,session:Session,input:FinishInput,deferVerification=false){
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);this.own(task,session);
      if(!['completed','suspended'].includes(input.outcome))throw new CairnError('invalid_input','Finish outcome must be completed or suspended');
      let hasContent=['summary','findings','questions','next','report','progress','artifacts','handoffs','basis','references','from','covers'].some(key=>input[key as keyof FinishInput]!==undefined);
      if(task.status==='completed'){
        if(hasContent||input.outcome!=='completed')throw new CairnError('completed_task','Completed tasks are immutable; create a new task for follow-up');
        if(artifactIssues(task).length||referenceIssues(task).length)throw new CairnError('artifact_changed','Submitted artifacts or finding references changed after completion. Reopen this task, review the affected findings and verify again.');
        return {...this.context(taskId),phase:'completed' as const,validation:boundedCheck(this.evaluateReport(task,task.report!))};
      }
      if(task.status==='suspended'){
        if(hasContent||input.outcome!=='suspended')throw new CairnError('inactive_task','Resume the suspended task before changing it');
        return {...this.context(taskId),phase:'suspended' as const,validation:boundedCheck(task.report?this.evaluateReport(task,task.report):this.evaluate(task))};
      }
      if(input.basis!==undefined||input.references!==undefined||input.from!==undefined||input.covers!==undefined){
        if(!curated(task)||input.findings!==undefined)throw new CairnError('invalid_input','Use either curated summary+basis/references or findings; captured mode requires findings with E# evidence');
        if(!input.summary?.trim())throw new CairnError('unsupported_claim','The short finish requires summary');
        let basis=input.basis,references=input.references;
        if(!hasBasis(input)&&input.from?.length){
          const sources=resolveSources(task,input.from),claims=sources.map(ref=>task.claims.find(c=>ref===`claim:${c.id}`));
          if(claims.some(c=>!c||c.status!=='supported'||!hasBasis(c)))throw new CairnError('unsupported_claim','Short finish from must cite saved supported findings with grounds; work items and unresolved hypotheses are not evidence');
          basis=claims.map(c=>`Saved finding ${c!.key??c!.id}: ${clipText(c!.text,500)}`).join('\n');
          references=[...new Set(claims.flatMap(c=>c!.references??[]))];
        }
        if(!hasBasis({basis,references}))throw new CairnError('unsupported_claim','The short finish requires explicit basis/references or saved supported findings in from');
        input={...input,findings:[{key:'final-result',text:input.summary,basis,references,from:input.from,covers:input.covers}]};
      }
      // Only host-declared paths can be collected without an explicit agent manifest.
      // No globbing or inferred deliverables, and no summary-to-evidence conversion.
      if(input.outcome==='completed'&&input.artifacts===undefined&&task.artifactRequirements?.length&&task.artifactRequirements.every(path=>existsSync(resolve(task.owner.cwd,path)))){
        const entries=new Map((task.artifacts??[]).map(artifact=>[resolve(task.owner.cwd,artifact.path),{path:resolve(task.owner.cwd,artifact.path),...(artifact.description!==undefined?{description:artifact.description}:{})}]));
        for(const path of task.artifactRequirements){const absolute=resolve(task.owner.cwd,path);if(!entries.has(absolute))entries.set(absolute,{path:absolute});}
        input={...input,artifacts:[...entries.values()]};hasContent=true;
      }
      let changed=false;
      if(hasContent)changed=this.checkpointOn(task,{...input,summary:input.summary??task.checkpoint?.summary??task.report?.summary??task.goal,
        ...((input.report!==undefined||input.summary!==undefined)?{report:{...input.report,...(input.report?.summary!==undefined?{summary:input.report.summary}:input.summary!==undefined?{summary:input.summary}:{})}}:{})});
      const structural=task.report?this.evaluateReport(task,task.report):{...this.evaluate(task),ok:false,issues:[...this.evaluate(task).issues,'A checkpoint with cited findings is required before completion']};
      const external=input.outcome==='completed'?(deferVerification&&task.completionVerifier?['Fresh external completion verification is required']:this.verificationIssues(task)):[];
      const validation={...structural,ok:structural.ok&&!external.length,issues:[...structural.issues,...external]};
      let phase:'completed'|'suspended'|'incomplete'|'ready_for_delivery'|'awaiting_confirmation'='incomplete';
      if(input.outcome==='suspended'){task.status='suspended';task.interrupted=true;this.pauseProgress(task);phase='suspended';changed=true;}
      else if(validation.ok){
        if(task.profile==='emergency'&&!task.delivery)phase='ready_for_delivery';
        else if(task.profile==='emergency'&&!task.confirmedAt)phase='awaiting_confirmation';
        else {task.status='completed';phase='completed';changed=true;}
      }
      let repair:CompletionRepair|undefined,attemptChanged=false;
      // A deferred verifier check is internal to one finish call, not a second attempt.
      if(phase==='incomplete'&&!(deferVerification&&task.completionVerifier&&structural.ok)){
        const fingerprint=this.completionFingerprint(task);
        const attempts=task.finishAttempt?.fingerprint===fingerprint?Math.min(3,task.finishAttempt.attempts+1):1;
        attemptChanged=task.finishAttempt?.fingerprint!==fingerprint||task.finishAttempt.attempts!==attempts;
        task.finishAttempt={fingerprint,attempts};
        repair=this.completionRepair(task,validation,attempts);
      }
      if(changed){task.revision++;this.handoffOn(task,phase);this.store.save(task,'task.finished',{input,phase,validation,repair,owner:task.owner,revision:task.revision},this.at());}
      else if(phase==='incomplete'){
        const fingerprint=createHash('sha256').update(JSON.stringify(validation)).digest('hex');
        const sameCheck=task.lastCheck?.revision===task.revision&&task.lastCheck.fingerprint===fingerprint;
        if(attemptChanged||!sameCheck){
          task.lastCheck={revision:task.revision,fingerprint};
          this.store.save(task,sameCheck?'completion.unchanged':'task.checked',{phase,validation,repair,owner:task.owner,revision:task.revision},this.at());
        }
      }
      return {...this.context(taskId),phase,validation:boundedCheck(validation),...(repair?{repair}:{})};
    });
  }
  private completionFingerprint(task:Task):string {
    const validation=this.completionCheck(task);
    return createHash('sha256').update(JSON.stringify({
      claims:task.claims.map(({revision,updatedAt,history,...claim})=>claim),criteria:task.criteria,
      reportPresent:!!task.report,artifacts:task.artifacts,issues:validation.issues,unmet:validation.unmet,hints:task.hints,
      progress:task.progress?.map(({key,source,status,from,delegated,branchStatus})=>({key,source,status,from,delegated,branchStatus})),
    })).digest('hex');
  }
  private completionRepair(task:Task,validation:Check,attempts:number):CompletionRepair {
    const missing=task.criteria.filter(c=>validation.unmet.includes(c.id)),actions:string[]=[];
    if(attempts>1)actions.push('Do not repeat cairn_finish with unchanged findings and coverage. Editing only the summary does not repair this check.');
    if(missing.length)actions.push(`Save justified findings with explicit covers:["${missing[0]!.id}"] for criteria they actually support, using ${curated(task)?'basis and references':'captured E# evidence'}. Reuse the finding key when revising; never invent support to fill coverage.`);
    else actions.push('Repair the listed validation issues and save the corrected findings/report before retrying completion.');
    if(task.verification&&task.verification.status!=='passed')actions.push('Address the external verifier issues; its acceptance scope is defined by the host.');
    if(curated(task)&&!task.claims.some(c=>c.status==='supported'))actions.push('Use cairn_checkpoint {findings:[{key:"result",text:"your result",status:"supported",basis:"actual support",references:["source path"],covers:["c1"]}]}. Summary alone is not evidence; finish cannot add it.');
    actions.push('If the missing evidence cannot be obtained, checkpoint the unresolved questions/next action and use cairn_finish {outcome:"suspended"}; the host saves the handoff.');
    return {unchanged:attempts>1,attempts,missingCriteria:missing.slice(0,8).map(c=>({id:c.id,text:clipText(c.text,240)})),omittedCriteria:Math.max(0,missing.length-8),actions,requiredFields:[...(missing.length?['checkpoint findings with justified explicit covers']:[]),...(artifactIssues(task).length?['existing required artifact files']:[])]};
  }
  /** Structural coverage and the current host verdict are intentionally separate. */
  completionCheck(task:Task):Check {
    const structural=task.report?this.evaluateReport(task,task.report):this.evaluate(task);
    const issues=[...structural.issues,...this.verificationIssues(task)];
    return {...structural,ok:!issues.length,issues};
  }
  check(taskId: string): Check {
    return this.evaluate(this.store.get(taskId));
  }
  evaluate(task:Task):Check { return evaluateTask(task,this.now()); }
  private evidence(task:Task, ref:string, scope:Scope):Observation {
    const o=task.observations.find(x=>x.id===ref);
    if(!o||!o.eligible||o.status!=='success')throw new CairnError('invalid_evidence',`Observation ${ref} is missing, failed or late`);
    if(!covers(o.scope,scope))throw new CairnError('scope_mismatch',`Observation ${ref} does not cover the claimed scope`);
    if(task.profile==='emergency'&&(o.source==='manual'||!o.resultRef))throw new CairnError('invalid_evidence','Competition evidence must be automatically captured with a real result_ref');
    return o;
  }
  validateReport(taskId:string, report:Report):Check {
    return this.evaluateReport(this.store.get(taskId),report);
  }
  evaluateReport(task:Task,report:Report):Check {
    const check=this.evaluate(task),issues=[...check.issues,...artifactIssues(task),...referenceIssues({...task,report})],warnings:string[]=[];
    if(!report.summary.trim())issues.push('Report summary is required');
    if(!curated(task)&&!report.citations.length)issues.push('At least one evidence citation is required');
    for(const citation of report.citations)try{
      const o=this.evidence(task,citation.observationId,task.scope);
      if(!citation.statement.trim())issues.push('Each citation needs an explanation');
      if(citation.resultRef!==undefined&&citation.resultRef!==o.resultRef)issues.push(`Invalid result_ref for ${o.id}`);
      if(task.profile==='emergency'&&citation.resultRef!==o.resultRef)issues.push(`Missing result_ref for ${o.id}`);
    }catch(e){issues.push((e as Error).message);}
    if(curated(task)){
      const curatedRefs=report.curatedReferences??[],citedClaims=new Set<string>();
      for(const citation of curatedRefs){
        const claim=task.claims.find(c=>c.id===citation.claimId);
        if(!claim||claim.status!=='supported'||claim.provenance!=='agent'||!hasBasis(claim)){issues.push(`Curated reference ${citation.claimId} is not a supported finding in this task`);continue;}
        if(!covers(claim.scope,task.scope)){issues.push(`Curated reference ${citation.claimId} does not cover this task scope`);continue;}
        if(typeof citation.statement!=='string'||!citation.statement.trim())issues.push('Each curated reference needs an explanation');
        if(!Array.isArray(citation.references)||citation.references.some(ref=>typeof ref!=='string'||!ref.trim())){issues.push('Curated references must be nonempty strings');continue;}
        if(!hasBasis(citation))issues.push(`Curated reference ${citation.claimId} needs a basis or file/link references`);
        if(citation.basis!==undefined&&citation.basis!==claim.basis)issues.push(`Curated reference ${citation.claimId} changes the recorded basis`);
        if(citation.references.some(ref=>!claim.references?.includes(ref)))issues.push(`Curated reference ${citation.claimId} contains references absent from the finding`);
        for(const ref of citation.references){
          const issue=(this.options.validateReference??localReferenceIssue)(ref,task);
          if(issue)(task.referencePolicy==='strict'?issues:warnings).push(issue);
        }
        citedClaims.add(claim.id);
      }
      for(const criterion of task.criteria)for(const ref of criterion.claimIds)if(!citedClaims.has(ref))issues.push(`Report does not cite the curated finding for ${criterion.id}/${ref}`);
    }else{
      const cited=new Set(report.citations.map(c=>c.observationId));
      for(const criterion of task.criteria)for(const ref of criterion.claimIds){
        const claim=task.claims.find(c=>c.id===ref);
        if(claim&&!claim.supports.some(o=>cited.has(o)))issues.push(`Report does not cite evidence for ${criterion.id}/${claim.id}`);
      }
    }
    if(task.profile==='emergency'){
      if(!report.impact?.text.trim()||!report.impact.observationIds.length)issues.push('Impact analysis and scope evidence are required');
      if(report.impact){
        if(!covers(report.impact.scope,task.scope))issues.push('Impact scope must include this team, round and issue');
        for(const ref of report.impact.observationIds)try{this.evidence(task,ref,report.impact.scope);}catch(e){issues.push((e as Error).message);}
      }
      if(!report.rootCause?.text.trim()||!report.rootCause.level)issues.push('Root cause and causal level are required');
      if(!report.solution?.mitigation.trim()||!report.solution.fix.trim()||!report.solution.prevention.trim())issues.push('Mitigation, root fix and prevention are required');
    }
    return {ok:!issues.length,issues:[...new Set(issues)],unmet:check.unmet,...(warnings.length?{warnings:[...new Set(warnings)]}:{})};
  }
  report(taskId:string,session:Session,report:Report){
    return this.edit(taskId,session,'report.saved',report,task=>{task.report=report;return this.evaluateReport(task,report);});
  }
  complete(taskId:string,session:Session){
    return this.edit(taskId,session,'task.completed',{},task=>{
      if(!task.report)throw new CairnError('invalid_report','Save and validate a report before completion');
      const check=this.completionCheck(task);if(!check.ok)throw new CairnError('invalid_report',check.issues.join('; '));
      if(task.profile==='emergency'&&(!task.delivery||!task.confirmedAt))throw new CairnError('confirmation_required','Competition completion requires a submission receipt and team confirmation via cairn confirm');
      task.status='completed';return {status:task.status};
    });
  }
  delivery(taskId:string,session:Session,key:string,observationId:string){
    return this.edit(taskId,session,'delivery.recorded',{key,observationId},task=>{
      if(task.delivery){if(task.delivery.key!==key)throw new CairnError('already_delivered','A different delivery is already recorded');return task.delivery;}
      if(!task.report||!this.validateReport(taskId,task.report).ok)throw new CairnError('invalid_report','Validate the report before recording delivery');
      const observation=this.evidence(task,observationId,task.scope);
      const tools=this.store.config<{tools:{name:string;role?:string}[]}>('gateway');
      if(task.profile==='emergency'&&!tools?.tools.some(t=>t.name===observation.tool&&['submit','receipt'].includes(t.role??'')))throw new CairnError('invalid_receipt','Receipt must come from a configured platform submission or receipt tool');
      if(task.profile==='emergency'&&!observation.receipt)throw new CairnError('invalid_receipt','The captured platform result contains no mapped receipt');
      task.delivery={key,receipt:observation.receipt??observation.output,recordedAt:this.at()};return task.delivery;
    });
  }
  confirm(taskId:string){
    return this.store.transaction(()=>{const task=this.store.get(taskId);if(task.status!=='active'||!task.delivery)throw new CairnError('invalid_state','An active task with a delivery receipt is required');task.confirmedAt=this.at();task.revision++;this.store.save(task,'team.confirmed',{},this.at());});
  }
  beforeTool(taskId:string,session:Session,callId:string,tool:string,submission=false,receipt=false):{duplicate:boolean;untracked?:boolean}{
    if(curated(this.assertActiveOwner(taskId,session)))return {duplicate:false,untracked:true};
    return this.edit(taskId,session,'tool.started',{callId,tool},task=>{
      if(task.calls[callId])return {duplicate:true};
      if(task.budget.deadline&&this.now().getTime()>=Date.parse(task.budget.deadline))throw new CairnError('deadline','Task deadline has passed');
      if(task.profile==='emergency'&&!submission&&!receipt&&task.budget.deadline&&Date.parse(task.budget.deadline)-this.now().getTime()<=(task.budget.submitReserveMs??30000))throw new CairnError('submission_window','Investigation budget ended; reserve the remaining time for report submission and receipt checks');
      if(task.budget.maxCalls!==undefined&&Object.keys(task.calls).length>=task.budget.maxCalls)throw new CairnError('call_budget','Tool call budget exhausted');
      if(Object.values(task.calls).filter(c=>c.status==='running').length>=(task.budget.maxParallel??3))throw new CairnError('concurrency','Maximum parallel tool calls reached');
      if(submission){
        if(task.delivery)throw new CairnError('already_delivered','Submission receipt already exists; inspect it before retrying');
        if(Object.values(task.calls).some(c=>c.status==='running'&&c.tool===tool))throw new CairnError('submission_in_flight','Another submission is in flight');
        if(Object.values(task.calls).some(c=>c.tool===tool))throw new CairnError('ambiguous_submission','A prior submission was attempted; reconcile its receipt before retrying');
        if(!task.report||!this.validateReport(taskId,task.report).ok)throw new CairnError('invalid_report','Report must pass validation before submission');
      }
      task.calls[callId]={status:'running',tool,startedAt:this.at(),epoch:task.owner.epoch};return {duplicate:false};
    });
  }
  observe(taskId:string,session:Session,input:Omit<Observation,'id'|'capturedAt'|'eligible'|'scope'|'actor'> & {scope?:Scope}){
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);
      if(curated(task))throw new CairnError('invalid_evidence_mode','Curated tasks do not retain tool inputs or outputs; save agent findings with basis and file/link references');
      const old=task.observations.find(o=>o.callId===input.callId&&o.source===input.source);if(old)return old;
      let owned=true;try{this.own(task,session);}catch{owned=false;}
      const reservation=task.calls[input.callId],epoch=reservation?(reservation.epoch??0):(this.store.session(session)?.epoch??0);
      const eligible=owned&&epoch===task.owner.epoch&&task.status==='active'&&!task.interrupted&&(!task.budget.deadline||this.now().getTime()<Date.parse(task.budget.deadline));
      const observation:Observation={...input,id:id('obs'),scope:input.scope??task.scope,actor:{host:session.host,sessionId:session.sessionId,epoch},eligible,capturedAt:this.at()};
      task.observations.push(observation);
      if(reservation)reservation.status='finished';
      task.revision++;this.store.save(task,'observation.captured',observation,this.at());return observation;
    });
  }
  context(taskId:string,focus?:string){
    const t=publicTask(this.store.get(taskId));
    let textTruncated=false;
    const text=(value:string,bytes:number)=>{
      if(Buffer.byteLength(value,'utf8')<=bytes)return value;
      textTruncated=true;return clipText(value,bytes);
    };
    const scope=(value:Scope)=>Object.fromEntries(Object.entries(value).map(([key,value])=>[key,text(value,160)])) as Scope;
    const alias=(observationId:string)=>`E${t.observations.findIndex(o=>o.id===observationId)+1}`;
    const check=this.evaluate(t);
    const projection=selectHandoffContext(t,focus),claims=projection.claims;
    const referenceCache=new Map(),referenceStates=new Map(claims.map(c=>{const issues=claimReferenceIssues(t,c,referenceCache);return [c.id,{status:issues.length?'stale' as const:c.referenceArtifacts?.length?'current' as const:'untracked' as const,issues:issues.slice(0,2).map(issue=>text(issue,300))}];}));
    const selected=new Set(claims.flatMap(c=>[...c.supports,...c.refutes]));
    const observations=t.observations.filter(o=>selected.has(o.id)||t.observations.indexOf(o)>=t.observations.length-12).slice(-18);
    const state={taskId:t.id,...(t.title?{title:text(t.title,200)}:{}),goal:text(t.goal,1500),origin:text(t.origin,500),constraints:t.constraints.slice(0,8).map(c=>text(c,300)),status:t.status,profile:t.profile,evidenceMode:t.evidenceMode??'captured',scope:scope(t.scope),
      owner:{...t.owner,sessionId:text(t.owner.sessionId,256),cwd:text(t.owner.cwd,500)},revision:t.revision,
      criteria:t.criteria.slice(0,24).map(c=>({...c,text:text(c.text,450),claimIds:c.claimIds.slice(0,8)})),
      claims:claims.map(({history,referenceArtifacts,...c})=>({...c,...(c.key?{key:text(c.key,180)}:{}),text:text(c.text,650),...(c.basis===undefined?{}:{basis:text(c.basis,900)}),...(c.references===undefined?{}:{references:c.references.slice(0,8).map(ref=>text(ref,350))}),...(c.from?{from:c.from.slice(0,12)}:{}),...(c.relatedCriteria===undefined?{}:{relatedCriteria:c.relatedCriteria.slice(0,12)}),referenceState:referenceStates.get(c.id)!,historyCount:history?.length??0,scope:scope(c.scope),supports:c.supports.slice(0,8),refutes:c.refutes.slice(0,8),evidence:c.supports.slice(0,8).map(alias),against:c.refutes.slice(0,8).map(alias),covers:t.criteria.filter(criterion=>criterion.claimIds.includes(c.id)).map(c=>c.id).slice(0,12)})),
      observations:observations.map(o=>({ref:alias(o.id),id:o.id,tool:text(o.tool,160),source:o.source,status:o.status,eligible:o.eligible,...(o.resultRef?{resultRef:text(o.resultRef,256)}:{}),scope:scope(o.scope),capturedAt:o.capturedAt})),
      actions:t.actions.slice(-4).map(a=>({...a,purpose:text(a.purpose,350),stopCondition:text(a.stopCondition,240),observationIds:a.observationIds.slice(0,6)})),
      hints:t.hints.slice(-4).map(h=>({...h,text:text(h.text,450),author:text(h.author,120)})),
      progress:(t.progress??[]).slice(-24).map(item=>({...item,key:text(item.key,180),title:text(item.title,350),...(item.from?{from:item.from.slice(0,12)}:{}),...(item.branchCheckpoint?{branchCheckpoint:{summary:text(item.branchCheckpoint.summary,500),questions:item.branchCheckpoint.questions.slice(0,8).map(question=>text(question,250)),next:item.branchCheckpoint.next?text(item.branchCheckpoint.next,500):undefined,at:item.branchCheckpoint.at}}:{}),...(item.lease?{lease:{actor:{host:item.lease.actor.host,sessionId:text(item.lease.actor.sessionId,256),cwd:text(item.lease.actor.cwd,500)},epoch:item.lease.epoch,expiresAt:item.lease.expiresAt}}:{}),...(item.detail===undefined?{}:{detail:text(item.detail,500)})})),
      ...(focus?{focus}:{}),
      artifacts:(t.artifacts??[]).map(a=>({...a,path:text(a.path,500),description:a.description?text(a.description,300):undefined})),artifactRequirements:t.artifactRequirements?.slice(0,16).map(path=>text(path,350)),
      handoffs:projection.handoffs.map(({detail,...h})=>({...h,detailAvailable:!!detail,summary:text(h.summary,600),report:h.report?text(h.report,500):undefined,sessionRef:h.sessionRef?text(h.sessionRef,500):undefined,source:h.source?{...h.source,cwd:text(h.source.cwd,500),sessionId:text(h.source.sessionId,256)}:undefined,artifacts:h.artifacts?.slice(0,8).map(ref=>text(ref,350)),from:h.from?.slice(0,12),next:t.status==='completed'&&h.key==='@host/state'?completedNext:h.next?text(h.next,500):undefined,...(t.status==='completed'&&h.key==='@host/state'&&h.next&&h.next!==completedNext?{historicalNext:text(h.next,500)}:{})})),
      verification:t.verification?{verifier:text(t.verification.verifier,200),status:t.verification.status,at:t.verification.at,checkedRevision:t.verification.checkedRevision,epoch:t.verification.epoch,current:this.verificationCurrent(t),method:t.verification.method??'unspecified',scope:t.verification.scope?text(t.verification.scope,500):undefined,issues:t.verification.issues.slice(0,4).map(issue=>({message:text(issue.message,350),claims:issue.claims?.slice(0,4)})),omittedIssues:Math.max(0,t.verification.issues.length-4)}:undefined,completionValidation:t.completionVerifier?'host-verifier-required':'structural-only',execution:t.execution,
      conclude:t.conclude,referencePolicy:t.referencePolicy??'advisory',
      exploration:this.exploration(t),scheduler:t.scheduler?{status:t.scheduler.status,phases:t.scheduler.sequence,...(t.scheduler.start?{start:{...t.scheduler.start,reason:text(t.scheduler.start.reason,350)}}:{}),inflight:t.scheduler.inflight.slice(0,4).map(f=>({id:f.id,phase:f.phase,branch:f.branch?{key:text(f.branch.key,160),title:text(f.branch.title,160)}:undefined,startedAt:f.startedAt,sessionRef:f.sessionRef?text(f.sessionRef,240):undefined})),omittedFlights:Math.max(0,t.scheduler.inflight.length-4),...(t.scheduler.feedback?{feedback:text(t.scheduler.feedback,500)}:{})}:undefined,assessment:t.assessment?{status:t.assessment.status,summary:text(t.assessment.summary,350),scope:text(t.assessment.scope,350),reviewer:text(t.assessment.reviewer,100),at:t.assessment.at,current:this.assessmentStatus(t)!.current}:undefined,
      checkpoint:t.checkpoint?{summary:text(t.checkpoint.summary,1800),questions:t.checkpoint.questions.slice(0,8).map(q=>text(q,350)),next:t.status!=='completed'&&t.checkpoint.next?text(t.checkpoint.next,600):undefined,...(t.status==='completed'&&t.checkpoint.next?{historicalNext:text(t.checkpoint.next,600)}:{}),at:t.checkpoint.at}:undefined,
      budget:t.budget,budgetPolicy:curated(t)?'advisory':'enforced',remainingMs:t.budget.deadline?Math.max(0,Date.parse(t.budget.deadline)-this.now().getTime()):null,
      check:{ok:check.ok,issues:check.issues.slice(0,24).map(issue=>text(issue,250)),unmet:check.unmet.slice(0,24)},
      delivery:t.delivery?{key:text(t.delivery.key,256),recordedAt:t.delivery.recordedAt,recorded:true}:undefined,confirmedAt:t.confirmedAt,
      totals:{claims:t.claims.length,observations:t.observations.length,criteria:t.criteria.length,coveredCriteria:t.criteria.length-check.unmet.length,progress:t.progress?.length??0,handoffs:t.handoffs?.length??0,artifacts:t.artifacts?.length??0,eligibleEvidence:t.observations.filter(o=>o.eligible&&o.status==='success').length},
      truncated:{artifacts:0,artifactRequirements:0,handoffs:0,omittedDependencies:[] as string[],claims:0,observations:0,criteria:0,constraints:0,actions:0,hints:0,progress:0,questions:0,text:false,checkIssues:Math.max(0,check.issues.length-24),bytes:0},
      readMore:curated(t)?'Findings and file/link references are agent-curated, not automatically verified. Follow handoff.report/artifacts for detail and sessionRef for native history. Use cairn_read view=handoffs or focus=criterion/claim/work reference. Full findings, progress and reports remain in the UI and persisted history.':'Use cairn_read with E# or an observation ID for original input/output. Task history and the full report remain available in the UI and persisted audit log.',
    };
    const size=()=>Buffer.byteLength(JSON.stringify(state),'utf8');
    // Bound restoration even for very long tasks; canonical records remain complete in SQLite.
    while(size()>12_000){
      if(state.observations.length>2)state.observations.pop();
      else if(state.scheduler?.inflight.length){state.scheduler.inflight.pop();state.scheduler.omittedFlights++;}
      else if(state.progress.length>2)state.progress.shift();
      else if(state.artifacts.length>1)state.artifacts.pop();
      else if((state.artifactRequirements?.length??0)>1)state.artifactRequirements!.pop();
      else if(state.handoffs.length>1)state.handoffs.splice(state.handoffs.findLastIndex(h=>h.key!=='@host/state'),1);
      else if(state.claims.length>1)state.claims.pop();
      else if(state.actions.length)state.actions.pop();
      else if(state.hints.length)state.hints.pop();
      else if(state.constraints.length)state.constraints.pop();
      else if(state.checkpoint?.questions.length)state.checkpoint.questions.pop();
      else if(state.criteria.length>1)state.criteria.pop();
      else break;
    }
    state.truncated={...state.truncated,artifacts:(t.artifacts?.length??0)-state.artifacts.length,artifactRequirements:(t.artifactRequirements?.length??0)-(state.artifactRequirements?.length??0),handoffs:(t.handoffs?.length??0)-state.handoffs.length,omittedDependencies:[...new Set(state.claims.flatMap(c=>c.from??[]))].filter(ref=>ref.startsWith('claim:')&&!state.claims.some(c=>ref===`claim:${c.id}`)).slice(0,12),claims:t.claims.length-state.claims.length,observations:t.observations.length-state.observations.length,criteria:t.criteria.length-state.criteria.length,
      constraints:t.constraints.length-state.constraints.length,actions:t.actions.length-state.actions.length,hints:t.hints.length-state.hints.length,
      progress:(t.progress?.length??0)-state.progress.length,
      questions:(t.checkpoint?.questions.length??0)-(state.checkpoint?.questions.length??0),text:textTruncated};
    state.truncated.bytes=size();
    return state;
  }
  /** A short blackboard agenda, not another model, a prescribed plan or proof of correctness. */
  private exploration(task:Task){
    const label=(c:Claim)=>({ref:c.key??c.id,status:c.status,text:clipText(c.text,180)});
    const check=this.evaluate(task);
    const recent=task.claims.slice().reverse().sort((a,b)=>(b.updatedAt??'').localeCompare(a.updatedAt??''));
    return {mode:task.status==='completed'?'completed':check.ok?'review_then_finish':'explore_or_suspend',
      unmet:check.unmet.slice(0,8),
      changed:recent.slice(0,4).map(label),
      uncertain:recent.filter(c=>c.status==='proposed'||c.status==='inconclusive').slice(0,3).map(label),
      excluded:recent.filter(c=>c.status==='refuted').slice(0,2).map(label),
      openWork:(task.progress??[]).filter(p=>['running','pending','blocked'].includes(p.status)).slice(-3).map(p=>({key:p.key,title:clipText(p.title,160),status:p.status,from:p.from?.slice(0,4)})),
      questions:task.checkpoint?.questions.slice(0,3).map(q=>clipText(q,180))??[],
      next:task.status!=='completed'&&task.checkpoint?.next?clipText(task.checkpoint.next,300):undefined,
      guidance:task.status==='completed'?'Task completed. Check acceptance and review scope before reuse; explicitly reopen for new work. Completion is not correctness.':`${check.ok?'Before finish, review':'Choose one discriminating next action from'} saved facts and alternatives at the requested scope. Compare mechanisms on the same subject before changing scope. Pressure may be cause, mediator or consequence; shared effects alone do not distinguish them. Reuse measured facts before repeating a check. Preserve time/window semantics, unit assumptions and observed versus missing coverage. Keep distinguishing evidence or the unresolved gap; coverage is not correctness.`};
  }
  /** Best-effort, time-bounded save/reason feedback; no native inputs/results or call counts. */
  explorationGuidance(taskId:string,session:Session):string|undefined{
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);try{this.own(task,session);}catch{return;}
      if(!curated(task)||task.status!=='active'||task.interrupted)return;
      const now=this.now().getTime();
      if(task.budget.deadline&&Date.parse(task.budget.deadline)-now<=(task.budget.submitReserveMs??30000))return;
      if(task.finishAttempt&&task.finishAttempt.attempts>=2&&task.finishAttempt.fingerprint===this.completionFingerprint(task))return;
      const key=createHash('sha256').update(JSON.stringify([task.claims.map(c=>[c.id,c.revision]),task.criteria,task.progress?.map(p=>[p.key,p.status,p.from]),task.hints,task.checkpoint?.questions,task.checkpoint?.next])).digest('hex');
      if(task.explorationNotice?.key===key||task.explorationNotice&&now-Date.parse(task.explorationNotice.at)<60000)return;
      const hintChanged=task.hints.at(-1)?.id!==task.explorationNotice?.hintId;
      // New hints/closed directions are reviewed in the next native result; otherwise
      // a long unsaved exploration receives one reminder for this board state.
      const lastSaved=Date.parse(task.checkpoint?.at??task.createdAt);
      if(now-lastSaved<60000&&!hintChanged)return;
      task.explorationNotice={key,at:this.at(),hintId:task.hints.at(-1)?.id};
      this.store.save(task,'exploration.review_requested',{key},this.at());
      const agenda=this.exploration(task);
      return `Cairn blackboard review: save reusable facts, not each command. Compare mechanisms on the same subject before changing scope. Pressure may be cause, mediator or consequence; co-occurrence alone cannot decide. Reuse saved measurements, alternatives and counterevidence. Name what a new check could change; test that prediction or preserve the gap. If the goal is supported, verify the deliverables and finish. Otherwise suspend when no useful action remains. Last receipt/read holds the board.${hintChanged&&task.hints.length?` New hint: ${clipText(task.hints.at(-1)!.text,450)}`:''} Open: ${JSON.stringify({unmet:agenda.unmet,uncertain:agenda.uncertain.map(c=>c.ref),questions:agenda.questions,next:agenda.next})}`;
    });
  }
  continuation(taskId:string,session:Session):string|undefined{
    const task=this.store.get(taskId);try{this.own(task,session);}catch{return;}
    if(task.status!=='active'||task.interrupted||this.check(taskId).ok&&!this.verificationIssues(task).length)return;
    if(task.budget.deadline&&Date.parse(task.budget.deadline)-this.now().getTime()<=(task.budget.submitReserveMs??30000))return;
    if(task.finishAttempt&&task.finishAttempt.attempts>=2&&task.finishAttempt.fingerprint===this.completionFingerprint(task))return;
    if(task.continuation?.count && (task.continuation.revision===task.revision||task.continuation.count>=2))return;
    this.store.transaction(()=>{
      const t=this.store.get(taskId);t.continuation={revision:t.revision,count:(t.continuation?.count??0)+1};
      this.store.save(t,'continuation.suggested',t.continuation,this.at());
    });
    return `Cairn task ${taskId} is incomplete: ${[...this.check(taskId).issues,...this.verificationIssues(task)].join('; ')}. Continue only if a useful action remains${curated(task)?'; configured deadlines are advisory':' within budget'}; otherwise suspend and report the missing evidence. Do not restart after a user interruption.`;
  }
  recordExecution(taskId:string,session:Session,state:'running'|'settled'|'interrupted'|'closed'){
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);try{this.own(task,session);}catch{return;}
      if(task.execution?.state===state&&task.execution.epoch===task.owner.epoch)return;
      task.execution={...task.execution,state,at:this.at(),epoch:task.owner.epoch,...(state==='settled'?{settledAt:this.at()}:state==='interrupted'?{interruptedAt:this.at()}:state==='closed'?{closedAt:this.at()}:{})};
      if(state!=='running')this.handoffOn(task,`host-${state}`);
      this.store.save(task,'host.execution',task.execution,this.at());
    });
  }
  budgetGuidance(taskId:string,session:Session):string|undefined{
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);try{this.own(task,session);}catch{return;}
      if(task.status!=='active'||task.interrupted||!task.budget.deadline)return;
      const remaining=Date.parse(task.budget.deadline)-this.now().getTime();
      if(remaining>(task.budget.submitReserveMs??30000))return;
      const stage=remaining<=0?'expired':'reserve';
      if(task.budgetNotice?.deadline===task.budget.deadline&&(task.budgetNotice.stage===stage||task.budgetNotice.stage==='expired'))return;
      task.budgetNotice={deadline:task.budget.deadline,stage,at:this.at()};
      task.conclude={status:'requested',at:this.at(),revision:task.revision};
      this.store.save(task,'budget.conclude_requested',task.budgetNotice,this.at());
      return `Cairn budget ${stage}: ${Math.max(0,Math.ceil(remaining/1000))} seconds remain. Stop expanding; checkpoint confirmed findings, counterevidence and unresolved questions/next. Then cairn_finish {} when covered, or {outcome:"suspended"} when incomplete. The host saves the handoff; it owns actual process termination.`;
    });
  }
  concludeGuidance(taskId:string,session:Session):string|undefined{
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);try{this.own(task,session);}catch{return;}
      if(task.status!=='active'||task.interrupted||!task.progress?.some(p=>p.status==='running'))return;
      if(task.conclude?.revision===task.revision)return;
      if(task.budget.deadline&&Date.parse(task.budget.deadline)<=this.now().getTime())return;
      if(task.checkpoint&&this.now().getTime()-Date.parse(task.checkpoint.at)<60000&&!task.progress.some(p=>p.status==='running'&&p.updatedAt>task.checkpoint!.at))return;
      task.conclude={status:'requested',at:this.at(),revision:task.revision};
      this.store.save(task,'conclude.requested',{revision:task.revision},this.at());
      return `Cairn conclude request for ${taskId}: stop expanding this exploration, stop waiting for new results, and save a cairn_checkpoint with confirmed findings, excluded hypotheses (status=refuted with basis or actual counterevidence), unresolved questions and the next step. Do not invent evidence. Then finish or suspend as appropriate. User interruption and lost ownership take priority; this is a best-effort save request, not an external process watchdog.`;
    });
  }
}
