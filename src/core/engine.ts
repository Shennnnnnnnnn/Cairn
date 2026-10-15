import { createHash, randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { CairnError, type Session, type Scope, type Task, type Observation, type Claim, type Report, type Check, type Budget, type CheckpointInput, type FinishInput, type EvidenceMode, type ProgressInput, type ProgressItem, type BranchInput, type StateUpdateInput } from './types.js';
import { updateBranches, pauseBranches, branchStatus, branchRun, unboundAgentRuns } from './branches.js';

const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export const covers = (actual: Scope, required: Scope) => Object.entries(required).every(([k,v]) => actual[k as keyof Scope] === v);
function requireText(value: string, name: string) { if (!value.trim()) throw new CairnError('invalid_input', `${name} must not be empty`); }
const proofState = (task: Task) => JSON.stringify({
  claims: task.claims.map(({revision,updatedAt,...claim})=>claim), criteria: task.criteria, report: task.report,
});
const sameClaim = (a: Omit<Claim,'id'|'revision'>, b: Omit<Claim,'id'|'revision'>) =>
  a.text===b.text && a.status===b.status && JSON.stringify(a.supports)===JSON.stringify(b.supports) &&
  JSON.stringify(a.refutes)===JSON.stringify(b.refutes) && JSON.stringify(a.scope)===JSON.stringify(b.scope) && a.key===b.key &&
  a.basis===b.basis && JSON.stringify(a.references)===JSON.stringify(b.references) && a.provenance===b.provenance && JSON.stringify(a.relatedCriteria)===JSON.stringify(b.relatedCriteria) && a.branch===b.branch;
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
  return {ok:check.ok,issues:check.issues.slice(0,12).map(issue=>clipText(issue,220)),unmet:check.unmet.slice(0,24),
    omittedIssues:Math.max(0,check.issues.length-12),omittedUnmet:Math.max(0,check.unmet.length-24)};
}

export class Engine {
  constructor(readonly store: Store, readonly now: () => Date = () => new Date()) {}
  at() { return this.now().toISOString(); }
  active(session: Session): Task | undefined {
    const binding = this.store.session(session); return binding?.taskId ? this.store.get(binding.taskId) : undefined;
  }
  private own(task: Task, session: Session) {
    const bound = this.store.session(session);
    if (task.owner.host !== session.host || task.owner.sessionId !== session.sessionId || task.owner.cwd !== session.cwd || bound?.taskId !== task.id || bound?.epoch !== task.owner.epoch)
      throw new CairnError('stale_owner', 'This session no longer owns this task. Explicitly resume with takeover to continue.');
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
      const result = fn(task);
      task.revision++; this.store.save(task, kind, {input:payload,result:result??null,owner:task.owner,revision:task.revision}, this.at()); return result;
    });
  }
  private progressOn(task:Task,items:ProgressInput[],source:'agent'|'host',replace=false):boolean{
    if(!Array.isArray(items))throw new CairnError('invalid_input','Progress must be an array');
    const keys=new Set<string>(),values:ProgressInput[]=[];
    for(const item of items){
      if(!item||typeof item.key!=='string'||!item.key.trim()||typeof item.title!=='string'||!item.title.trim())throw new CairnError('invalid_input','Each progress item needs a nonempty key and title');
      if(keys.has(item.key))throw new CairnError('invalid_input',`Progress key ${item.key} is repeated`);
      if(!['pending','running','completed','blocked','cancelled'].includes(item.status))throw new CairnError('invalid_input','Invalid progress status');
      if(item.detail!==undefined&&typeof item.detail!=='string')throw new CairnError('invalid_input','Progress detail must be a string');
      if(item.branch!==undefined&&!task.branches?.some(branch=>branch.key===item.branch))throw new CairnError('invalid_branch','Progress branch does not belong to this task');
      keys.add(item.key);values.push({key:item.key,title:item.title,status:item.status,...(item.detail===undefined?{}:{detail:item.detail}),...(item.branch===undefined?{}:{branch:item.branch})});
    }
    const previous=task.progress??[],next=previous.map(item=>({...item}));let changed=false;
    for(const value of values){
      const index=next.findIndex(item=>item.key===value.key&&item.source===source),old=index<0?undefined:next[index];
      const branch=value.branch??old?.branch;
      if(old&&old.title===value.title&&old.status===value.status&&old.detail===value.detail&&old.branch===branch)continue;
      const item:ProgressItem={...value,...(branch?{branch}:{}),source,updatedAt:this.at()};
      if(index<0)next.push(item);else next[index]=item;changed=true;
    }
    if(replace)for(const item of next){
      if(item.source===source&&!keys.has(item.key)&&!['completed','cancelled'].includes(item.status)){
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
      if(this.progressOn(task,items,source,replace)){
        task.revision++;this.store.save(task,'progress.updated',{items,source,replace,owner:task.owner,revision:task.revision},this.at());
      }
      return task.progress??[];
    });
  }
  private pauseProgress(task:Task,detail='Paused with this task'){
    for(const item of task.progress??[])if(item.status==='running'){
      item.status='blocked';item.detail=detail;item.updatedAt=this.at();
    }
    pauseBranches(task,this.at(),detail);
  }
  create(session: Session, input: { origin: string; goal: string; constraints?:string[]; criteria: string[]; scope?: Scope; budget?: Partial<Budget>; evidenceMode?:EvidenceMode; progress?:ProgressInput[]; branches?:BranchInput[] }): Task {
    requireText(input.goal, 'goal'); requireText(input.origin, 'origin');
    if (!input.criteria.length || input.criteria.some(c => !c.trim())) throw new CairnError('invalid_input', 'Supply at least one nonempty completion criterion');
    return this.store.transaction(() => {
      const existing = this.active(session);
      if (existing?.status === 'active') throw new CairnError('active_task', 'Suspend or complete the current task before creating another');
      const scope = input.scope ?? {}, evidenceMode=input.evidenceMode??'captured';
      if(!['captured','curated'].includes(evidenceMode))throw new CairnError('invalid_input','Evidence mode must be curated or captured');
      if(evidenceMode==='curated'&&(input.budget?.maxCalls!==undefined||input.budget?.maxParallel!==undefined))throw new CairnError('invalid_budget','Curated tasks do not record tool calls, so call counts and concurrency cannot be enforced; omit maxCalls/maxParallel or use captured mode');
      const budget: Budget = { ...(evidenceMode==='captured'?{maxParallel:3}:{}), ...input.budget };
      if (budget.deadline && !Number.isFinite(Date.parse(budget.deadline))) throw new CairnError('invalid_input', 'Invalid deadline');
      if ((budget.maxParallel!==undefined&&(budget.maxParallel < 1 || !Number.isInteger(budget.maxParallel))) || (budget.maxCalls !== undefined && (!Number.isInteger(budget.maxCalls) || budget.maxCalls < 1))) throw new CairnError('invalid_input', 'Invalid budget');
      const task: Task = { id: id('task'), origin: input.origin, goal: input.goal,constraints:input.constraints??[],
        criteria: input.criteria.map((text,i) => ({id:`c${i+1}`,text,claimIds:[]})), scope, budget,evidenceMode,
        owner: {...session,epoch:1}, revision:1, createdAt:this.at(), status:'active',
        observations:[], claims:[], actions:[], hints:[], calls:{}, interrupted:false };
      if(input.branches!==undefined)updateBranches(task,input.branches,this.at());
      if(input.progress!==undefined)this.progressOn(task,input.progress,'agent');
      this.store.save(task, 'task.created', task, this.at()); this.store.bind(session, task); return task;
    });
  }
  resume(taskId: string, session: Session, takeover = false): Task {
    return this.store.transaction(() => {
      const task = this.store.get(taskId);
      const current=this.active(session);
      if(current?.status==='active'&&current.id!==taskId)throw new CairnError('active_task','Suspend or complete the current task before resuming another');
      if (task.status === 'completed') throw new CairnError('completed_task', 'Completed tasks are immutable; create a new task for follow-up');
      if (!takeover && (task.owner.host !== session.host || task.owner.sessionId !== session.sessionId || task.owner.cwd !== session.cwd)) throw new CairnError('takeover_required', 'A different session or workspace owns this task; explicit takeover is required');
      if (takeover) {
        task.owner = {...session,epoch:task.owner.epoch+1};
        for (const call of Object.values(task.calls)) if (call.status === 'running') call.status = 'finished';
        for (const action of task.actions) if (action.status === 'running') action.status = 'cancelled';
        this.pauseProgress(task,'Previous session stopped; resume this step explicitly if still needed');
      }
      task.status='active'; task.interrupted=false; task.revision++;
      this.store.save(task, 'task.resumed', {session,takeover}, this.at()); this.store.bind(session,task); return task;
    });
  }
  suspend(taskId: string, session: Session, source:'agent'|'host'='agent') {
    return this.edit(taskId,session,'task.suspended',{source},task=>{task.status='suspended';task.interrupted=true;this.pauseProgress(task);});
  }
  hint(taskId: string, session: Session, text: string, author: string) {
    return this.edit(taskId,session,'hint.added',{text,author},task=>{const hint={id:id('hint'),text,author};task.hints.push(hint);return hint;});
  }
  /** Only native adapters call this. Child execution ending is never goal acceptance. */
  recordAgentLifecycle(taskId:string,session:Session,agentId:string,event:'started'|'returned',agentType?:string) {
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);
      // A child can return after its owner paused A and started B. This scoped
      // lifecycle audit may settle A without changing the session binding to B.
      if(task.owner.host!==session.host||task.owner.sessionId!==session.sessionId||task.owner.cwd!==session.cwd)throw new CairnError('stale_owner','The child event belongs to a previous owner');
      if(task.status==='completed'||task.status==='suspended'&&event==='started')return;
      requireText(agentId,'agent id');
      // A native start belongs to the active parent's task at arrival. It is
      // saved immediately, even before any semantic branch has a matching ID.
      const branch=task.branches?.find(branch=>branch.executor==='subagent'&&branch.agentId===agentId&&branch.epoch===task.owner.epoch);
      const outstanding=task.agentRuns?.filter(run=>run.agentId===agentId&&run.epoch===task.owner.epoch&&run.host===session.host&&run.status==='running').at(-1);
      if(!branch&&event==='returned'&&!outstanding)return;
      const attempt=branch?.attempt??outstanding?.attempt??1;
      const old=task.agentRuns?.find(run=>run.agentId===agentId&&run.epoch===task.owner.epoch&&run.attempt===attempt&&run.host===session.host);
      // Duplicate events and late starts never regress a returned execution.
      if(old&&(old.status==='returned'||event==='started'))return;
      const run={...old,agentId,host:session.host,epoch:task.owner.epoch,attempt,...(agentType?{type:agentType}:{}),status:event==='started'?'running' as const:'returned' as const,...(event==='started'?{startedAt:this.at()}:{returnedAt:this.at()})};
      task.agentRuns??=[];if(old)task.agentRuns[task.agentRuns.indexOf(old)]=run;else task.agentRuns.push(run);
      task.revision++;this.store.save(task,`agent.${event}`,{agentId,type:agentType,status:run.status,epoch:run.epoch,source:'host'},this.at());
    });
  }
  private branchesOn(task:Task,inputs:BranchInput[]):boolean {
    const unbound=unboundAgentRuns(task);
    let changed=updateBranches(task,inputs,this.at());
    for(const branch of task.branches??[])if(branch.executor==='subagent'&&branch.epoch===task.owner.epoch&&branch.agentId&&!branchRun(task,branch)){
      const run=unbound.find(run=>run.agentId===branch.agentId&&run.epoch===task.owner.epoch&&run.host===task.owner.host);
      if(!run)continue;
      run.attempt=branch.attempt;changed=true;
      if(['reviewing','completed'].includes(branch.status)&&run.status==='running')throw new CairnError('active_delegate','The host still reports this child running; wait before reviewing or accepting completion');
    }
    return changed;
  }
  claim(taskId: string, session: Session, input: Omit<Claim,'id'|'revision'|'scope'> & {id?:string;scope?:Scope}) {
    return this.edit(taskId,session,'claim.revised',input,task=>{
      const old=input.id ? task.claims.find(c=>c.id===input.id) : undefined;
      if(input.id && !old)throw new CairnError('not_found','Unknown claim');
      const claim: Claim={...input,id:old?.id??id('claim'),revision:(old?.revision??0)+1,scope:input.scope??task.scope};
      requireText(claim.text,'claim');
      if(claim.branch!==undefined&&!task.branches?.some(branch=>branch.key===claim.branch))throw new CairnError('invalid_branch','Claim branch does not belong to this task');
      if(curated(task)){
        if(claim.supports.length||claim.refutes.length)throw new CairnError('invalid_evidence_mode','Curated findings use basis and file/link references, without raw observations');
        if(claim.basis!==undefined&&typeof claim.basis!=='string')throw new CairnError('invalid_input','Finding basis must be a string');
        if(claim.references!==undefined&&(!Array.isArray(claim.references)||claim.references.some(ref=>typeof ref!=='string'||!ref.trim())))throw new CairnError('invalid_input','Finding references must be nonempty strings');
        if(['supported','refuted'].includes(claim.status)&&!hasBasis(claim))throw new CairnError('unsupported_claim','Supported or refuted curated findings need an explanation or file/link references');
        if(claim.status==='supported'&&task.criteria.some(criterion=>criterion.claimIds.includes(claim.id))&&!covers(claim.scope,task.scope))throw new CairnError('scope_mismatch','A conclusion used for completion must cover this task scope');
        claim.provenance='agent';
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
  private checkpointOn(task:Task,input:CheckpointInput){
    if(typeof input.summary!=='string')throw new CairnError('invalid_input','Checkpoint summary is required');
    requireText(input.summary,'checkpoint summary');
    if(input.questions!==undefined&&(!Array.isArray(input.questions)||input.questions.some(q=>typeof q!=='string'||!q.trim())))throw new CairnError('invalid_input','Questions must be nonempty strings');
    if(input.next!==undefined&&typeof input.next!=='string')throw new CairnError('invalid_input','Next action must be a string');
    if(input.findings!==undefined&&!Array.isArray(input.findings))throw new CairnError('invalid_input','Findings must be an array');
    const previous=proofState(task),keys=new Set<string>(),isCurated=curated(task);
    const branchesChanged=input.branches===undefined?false:this.branchesOn(task,input.branches);
    for(const finding of input.findings??[]){
      if(typeof finding.text!=='string')throw new CairnError('invalid_input','Finding text is required');
      requireText(finding.text,'finding');
      if(finding.key!==undefined){
        if(typeof finding.key!=='string'||!finding.key.trim())throw new CairnError('invalid_input','Finding key must be nonempty');
        if(keys.has(finding.key))throw new CairnError('invalid_input',`Finding key ${finding.key} is repeated in this checkpoint`);
        keys.add(finding.key);
      }
      let old=finding.key?task.claims.find(c=>c.key===finding.key):undefined;
      const branch=finding.branch??old?.branch;
      if(branch!==undefined&&!task.branches?.some(value=>value.key===branch))throw new CairnError('invalid_branch','Finding branch does not belong to this task');
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
      let status=finding.status??old?.status??(isCurated?(justified?'supported':'proposed'):(supports.length?(refutes.length?'inconclusive':'supported'):(refutes.length?'refuted':'proposed')));
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
      const value:Omit<Claim,'id'|'revision'>={text:finding.text,status,supports,refutes,scope,...(finding.key?{key:finding.key}:{}),...(branch?{branch}:{}),
        ...(isCurated?{provenance:'agent' as const,...(basis===undefined?{}:{basis}),...(references===undefined?{}:{references}),relatedCriteria:criteria?.map(c=>c.id)??old?.relatedCriteria??[]}: {provenance:'captured' as const})};
      // Unkeyed exact retries reuse the original conclusion; readable keys permit deliberate revisions.
      old??=task.claims.find(c=>sameClaim(c,value));
      const claim:Claim=old&&sameClaim(old,value)?old:{...value,id:old?.id??id('claim'),revision:(old?.revision??0)+1,updatedAt:this.at()};
      if(old)task.claims[task.claims.indexOf(old)]=claim;else task.claims.push(claim);
      if(isCurated){
        for(const criterion of task.criteria)criterion.claimIds=criterion.claimIds.filter(ref=>ref!==claim.id);
        if(status==='supported')for(const criterion of criteria??[])criterion.claimIds.push(claim.id);
      }else if(criteria!==undefined){
        for(const criterion of task.criteria)criterion.claimIds=criterion.claimIds.filter(ref=>ref!==claim.id);
        for(const criterion of criteria)criterion.claimIds.push(claim.id);
      }
    }
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
    task.report=report;
    const proofChanged=previous!==proofState(task);
    const progressChanged=input.progress===undefined?false:this.progressOn(task,input.progress,'agent');
    const next={summary:input.summary,questions:input.questions??task.checkpoint?.questions??[],next:input.next??task.checkpoint?.next};
    const {at,...oldCheckpoint}=task.checkpoint??{at:''};
    const changed=proofChanged||progressChanged||branchesChanged||JSON.stringify(next)!==JSON.stringify(oldCheckpoint);
    if(changed)task.checkpoint={...next,at:this.at()};
    return changed;
  }
  checkpoint(taskId:string,session:Session,input:CheckpointInput){
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);this.own(task,session);
      if(task.status!=='active')throw new CairnError('inactive_task',`Task is ${task.status}`);
      if(this.checkpointOn(task,input)){
        task.revision++;this.store.save(task,'task.checkpoint',{input,owner:task.owner,revision:task.revision},this.at());
      }
      return {...this.context(taskId),validation:boundedCheck(this.evaluateReport(task,task.report!))};
    });
  }
  update(taskId:string,session:Session,input:StateUpdateInput) {
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);this.own(task,session);
      if(task.status!=='active')throw new CairnError('inactive_task',`Task is ${task.status}`);
      const keys=Object.keys(input);
      if(keys.length!==1||!['branch','progress','finding'].includes(keys[0]!))throw new CairnError('invalid_input','Report exactly one branch, progress item or finding per update');
      const patch:CheckpointInput={summary:task.checkpoint?.summary??task.goal};
      let kind:string,subject:string;
      if(input.branch){
        const value=input.branch,old=task.branches?.find(branch=>branch.key===value.key);
        const title=value.title??old?.title;
        if(!title)throw new CairnError('invalid_branch','A new branch needs a title');
        const executor=value.executor??old?.executor??'main';
        if(executor==='subagent'&&value.status==='completed'&&old&&branchStatus(task,old)!=='reviewing'&&old.status!=='completed')throw new CairnError('review_required','Record reviewing when the main agent starts reviewing; complete only after review');
        patch.branches=[{...value,title}];kind='branch.updated';subject=value.key;
      }else if(input.progress){
        const value=input.progress,title=value.title??task.progress?.find(item=>item.key===value.key&&item.source==='agent')?.title;
        if(!title)throw new CairnError('invalid_input','A new progress item needs a title');
        patch.progress=[{...value,title}];kind='progress.updated';subject=value.key;
      }else if(input.finding){
        requireText(input.finding.key,'finding key');patch.findings=[input.finding];kind='finding.updated';subject=input.finding.key;
      }else throw new CairnError('invalid_input','State update must not be empty');
      const changed=this.checkpointOn(task,patch);
      if(changed){task.revision++;this.store.save(task,kind,{input,subject,source:'agent',revision:task.revision},this.at());}
      const latest=this.store.db.prepare('SELECT seq,kind,at FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(taskId);
      const branch=input.branch?task.branches?.find(branch=>branch.key===input.branch!.key):undefined;
      return {taskId,revision:task.revision,changed,receipt:latest,...(branch?{branch:{key:branch.key,status:branchStatus(task,branch),source:branchRun(task,branch)?'host':'agent'},
        ...(branch.executor==='subagent'&&branch.agentId&&!branchRun(task,branch)?{guidance:'No native lifecycle matched this branch ID. Native executions are saved and displayed independently; their IDs may differ from host routing addresses. Exact binding is optional. Report semantic changes, not duplicate lifecycle events.'}:{})}:{})};
    });
  }
  finish(taskId:string,session:Session,input:FinishInput){
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);this.own(task,session);
      if(!['completed','suspended'].includes(input.outcome))throw new CairnError('invalid_input','Finish outcome must be completed or suspended');
      const hasContent=['summary','findings','questions','next','report','progress','branches'].some(key=>input[key as keyof FinishInput]!==undefined);
      if(task.status==='completed'){
        if(hasContent||input.outcome!=='completed')throw new CairnError('completed_task','Completed tasks are immutable; create a new task for follow-up');
        return {...this.context(taskId),phase:'completed' as const,validation:boundedCheck(this.evaluateReport(task,task.report!))};
      }
      if(task.status==='suspended'){
        if(hasContent||input.outcome!=='suspended')throw new CairnError('inactive_task','Resume the suspended task before changing it');
        return {...this.context(taskId),phase:'suspended' as const,validation:boundedCheck(task.report?this.evaluateReport(task,task.report):this.evaluate(task))};
      }
      let changed=false;
      if(hasContent)changed=this.checkpointOn(task,{...input,summary:input.summary??task.checkpoint?.summary??task.report?.summary??task.goal,
        ...((input.report!==undefined||input.summary!==undefined)?{report:{...input.report,...(input.report?.summary!==undefined?{summary:input.report.summary}:input.summary!==undefined?{summary:input.summary}:{})}}:{})});
      const validation=task.report?this.evaluateReport(task,task.report):{...this.evaluate(task),ok:false,issues:[...this.evaluate(task).issues,'A checkpoint with cited findings is required before completion']};
      let phase:'completed'|'suspended'|'incomplete'='incomplete';
      if(input.outcome==='suspended'){task.status='suspended';task.interrupted=true;this.pauseProgress(task);phase='suspended';changed=true;}
      else if(validation.ok){task.status='completed';phase='completed';changed=true;}
      if(changed){task.revision++;this.store.save(task,'task.finished',{input,phase,validation,owner:task.owner,revision:task.revision},this.at());}
      else if(phase==='incomplete'){
        const fingerprint=createHash('sha256').update(JSON.stringify(validation)).digest('hex');
        if(task.lastCheck?.revision!==task.revision||task.lastCheck.fingerprint!==fingerprint){
          task.lastCheck={revision:task.revision,fingerprint};
          this.store.save(task,'task.checked',{phase,validation,owner:task.owner,revision:task.revision},this.at());
        }
      }
      return {...this.context(taskId),phase,validation:boundedCheck(validation)};
    });
  }
  check(taskId: string): Check {
    return this.evaluate(this.store.get(taskId));
  }
  evaluate(task:Task):Check {
    const unmet=task.criteria.filter(c=>!c.claimIds.length || c.claimIds.some(ref=>{
      const claim=task.claims.find(x=>x.id===ref);
      if(curated(task))return !claim||claim.status!=='supported'||claim.provenance!=='agent'||!hasBasis(claim)||!covers(claim.scope,task.scope);
      return !claim || claim.status!=='supported' || !claim.supports.length || claim.refutes.length || claim.supports.some(o=>!task.observations.find(x=>x.id===o&&x.eligible&&x.status==='success'));
    })).map(c=>c.id);
    const issues=unmet.map(c=>`Criterion ${c} lacks a supported conclusion`);
    if(curated(task))for(const ref of new Set(task.criteria.flatMap(criterion=>criterion.claimIds))){
      const claim=task.claims.find(value=>value.id===ref);
      if(claim&&!covers(claim.scope,task.scope))issues.push(`Conclusion ${ref} does not cover this task scope`);
    }
    if(task.interrupted)issues.push('Task was interrupted');
    if(Object.values(task.calls).some(c=>c.status==='running'))issues.push('Tool calls are still running');
    for(const branch of task.branches??[]) {
      if(!['completed','cancelled'].includes(branchStatus(task,branch)))issues.push(`Branch ${branch.key} is unresolved; review its result or cancel it with a stopping reason`);
    }
    for(const run of task.agentRuns??[])if(run.epoch===task.owner.epoch&&run.host===task.owner.host&&run.status==='running'&&!task.agentRuns?.some(later=>later.agentId===run.agentId&&later.epoch===run.epoch&&later.attempt>run.attempt&&later.status==='returned'))issues.push(`Child agent ${run.agentId} is still running; stop or wait for it before finishing`);
    return {ok:!issues.length,issues,unmet};
  }
  private evidence(task:Task, ref:string, scope:Scope):Observation {
    const o=task.observations.find(x=>x.id===ref);
    if(!o||!o.eligible||o.status!=='success')throw new CairnError('invalid_evidence',`Observation ${ref} is missing, failed or late`);
    if(!covers(o.scope,scope))throw new CairnError('scope_mismatch',`Observation ${ref} does not cover the claimed scope`);
    return o;
  }
  validateReport(taskId:string, report:Report):Check {
    return this.evaluateReport(this.store.get(taskId),report);
  }
  evaluateReport(task:Task,report:Report):Check {
    const check=this.evaluate(task),issues=[...check.issues];
    if(!report.summary.trim())issues.push('Report summary is required');
    if(!curated(task)&&!report.citations.length)issues.push('At least one evidence citation is required');
    for(const citation of report.citations)try{
      const o=this.evidence(task,citation.observationId,task.scope);
      if(!citation.statement.trim())issues.push('Each citation needs an explanation');
      if(citation.resultRef!==undefined&&citation.resultRef!==o.resultRef)issues.push(`Invalid result_ref for ${o.id}`);
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
    return {ok:!issues.length,issues:[...new Set(issues)],unmet:check.unmet};
  }
  report(taskId:string,session:Session,report:Report){
    return this.edit(taskId,session,'report.saved',report,task=>{task.report=report;return this.evaluateReport(task,report);});
  }
  complete(taskId:string,session:Session){
    return this.edit(taskId,session,'task.completed',{},task=>{
      if(!task.report)throw new CairnError('invalid_report','Save and validate a report before completion');
      const check=this.validateReport(taskId,task.report);if(!check.ok)throw new CairnError('invalid_report',check.issues.join('; '));
      task.status='completed';return {status:task.status};
    });
  }
  beforeTool(taskId:string,session:Session,callId:string,tool:string):{duplicate:boolean;untracked?:boolean}{
    if(curated(this.assertActiveOwner(taskId,session)))return {duplicate:false,untracked:true};
    return this.edit(taskId,session,'tool.started',{callId,tool},task=>{
      if(task.calls[callId])return {duplicate:true};
      if(task.budget.deadline&&this.now().getTime()>=Date.parse(task.budget.deadline))throw new CairnError('deadline','Task deadline has passed');
      if(task.budget.maxCalls!==undefined&&Object.keys(task.calls).length>=task.budget.maxCalls)throw new CairnError('call_budget','Tool call budget exhausted');
      if(Object.values(task.calls).filter(c=>c.status==='running').length>=(task.budget.maxParallel??3))throw new CairnError('concurrency','Maximum parallel tool calls reached');
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
  context(taskId:string){
    const t=this.store.get(taskId);
    let textTruncated=false;
    const text=(value:string,bytes:number)=>{
      if(Buffer.byteLength(value,'utf8')<=bytes)return value;
      textTruncated=true;return clipText(value,bytes);
    };
    const scope=(value:Scope)=>Object.fromEntries(Object.entries(value).map(([key,value])=>[key,text(value,160)])) as Scope;
    const alias=(observationId:string)=>`E${t.observations.findIndex(o=>o.id===observationId)+1}`;
    const check=this.evaluate(t);
    const relevant=new Set(t.criteria.flatMap(c=>c.claimIds));
    const claims=t.claims.slice().sort((a,b)=>
      (b.updatedAt??'').localeCompare(a.updatedAt??'')||Number(relevant.has(b.id))-Number(relevant.has(a.id))||t.claims.indexOf(b)-t.claims.indexOf(a)).slice(0,12);
    const selected=new Set(claims.flatMap(c=>[...c.supports,...c.refutes]));
    const observations=t.observations.filter(o=>selected.has(o.id)||t.observations.indexOf(o)>=t.observations.length-12).slice(-18);
    const state={taskId:t.id,goal:text(t.goal,1500),origin:text(t.origin,500),constraints:t.constraints.slice(0,8).map(c=>text(c,300)),status:t.status,evidenceMode:t.evidenceMode??'captured',scope:scope(t.scope),
      owner:{...t.owner,sessionId:text(t.owner.sessionId,256),cwd:text(t.owner.cwd,500)},revision:t.revision,
      criteria:t.criteria.slice(0,24).map(c=>({...c,text:text(c.text,450),claimIds:c.claimIds.slice(0,8)})),
      claims:claims.map(c=>({...c,...(c.key?{key:text(c.key,180)}:{}),text:text(c.text,650),...(c.basis===undefined?{}:{basis:text(c.basis,900)}),...(c.references===undefined?{}:{references:c.references.slice(0,8).map(ref=>text(ref,350))}),...(c.relatedCriteria===undefined?{}:{relatedCriteria:c.relatedCriteria.slice(0,12)}),scope:scope(c.scope),supports:c.supports.slice(0,8),refutes:c.refutes.slice(0,8),evidence:c.supports.slice(0,8).map(alias),against:c.refutes.slice(0,8).map(alias),covers:t.criteria.filter(criterion=>criterion.claimIds.includes(c.id)).map(c=>c.id).slice(0,12)})),
      observations:observations.map(o=>({ref:alias(o.id),id:o.id,tool:text(o.tool,160),source:o.source,status:o.status,eligible:o.eligible,...(o.resultRef?{resultRef:text(o.resultRef,256)}:{}),scope:scope(o.scope),capturedAt:o.capturedAt})),
      actions:t.actions.slice(-4).map(a=>({...a,purpose:text(a.purpose,350),stopCondition:text(a.stopCondition,240),observationIds:a.observationIds.slice(0,6)})),
      hints:t.hints.slice(-4).map(h=>({...h,text:text(h.text,450),author:text(h.author,120)})),
      progress:(t.progress??[]).slice(-24).map(item=>({...item,key:text(item.key,180),title:text(item.title,350),...(item.detail===undefined?{}:{detail:text(item.detail,500)})})),
      branches:(t.branches??[]).slice().sort((a,b)=>Number(['completed','cancelled'].includes(a.status))-Number(['completed','cancelled'].includes(b.status))||b.updatedAt.localeCompare(a.updatedAt)).slice(0,16).map(branch=>({...branch,title:text(branch.title,300),...(branch.question?{question:text(branch.question,400)}:{}),...(branch.rationale?{rationale:text(branch.rationale,350)}:{}),...(branch.summary?{summary:text(branch.summary,600)}:{}),...(branch.assignee?{assignee:text(branch.assignee,160)}:{}),status:branchStatus(t,branch),recordedStatus:branch.status,activity:branchRun(t,branch)?.status??'reported'})),
      agentRuns:(t.agentRuns??[]).filter(run=>run.epoch===t.owner.epoch).slice(-12).map(run=>({...run,agentId:text(run.agentId,500),...(run.type?{type:text(run.type,120)}:{})})),
      delegation:'The main agent autonomously chooses whether and how many host-native helpers are useful from independent questions, current evidence, coordination cost and host/user limits. Save branches and link findings/progress by branch. Planned is not launched; record real agentId only when known. Child returned means awaiting_review, not accepted. Review results centrally; do not let children take over the root goal. If delegation is unavailable, work branches in the main session.',
      checkpoint:t.checkpoint?{summary:text(t.checkpoint.summary,1800),questions:t.checkpoint.questions.slice(0,8).map(q=>text(q,350)),next:t.checkpoint.next?text(t.checkpoint.next,600):undefined,at:t.checkpoint.at}:undefined,
      budget:t.budget,budgetPolicy:curated(t)?'advisory':'enforced',remainingMs:t.budget.deadline?Math.max(0,Date.parse(t.budget.deadline)-this.now().getTime()):null,
      check:{ok:check.ok,issues:check.issues.slice(0,24).map(issue=>text(issue,250)),unmet:check.unmet.slice(0,24)},
      totals:{claims:t.claims.length,observations:t.observations.length,criteria:t.criteria.length,progress:t.progress?.length??0,branches:t.branches?.length??0,agentRuns:t.agentRuns?.length??0,eligibleEvidence:t.observations.filter(o=>o.eligible&&o.status==='success').length},
      truncated:{claims:0,observations:0,criteria:0,constraints:0,actions:0,hints:0,progress:0,branches:0,agentRuns:0,questions:0,text:false,checkIssues:Math.max(0,check.issues.length-24),bytes:0},
      readMore:curated(t)?'Findings and file/link references are agent-curated, not automatically verified. Full findings, progress and reports remain in the UI and persisted history.':'Use cairn_read with E# or an observation ID for original input/output. Task history and the full report remain available in the UI and persisted audit log.',
    };
    const size=()=>Buffer.byteLength(JSON.stringify(state),'utf8');
    // Bound restoration even for very long tasks; canonical records remain complete in SQLite.
    while(size()>12_000){
      if(state.observations.length>2)state.observations.pop();
      else if(state.agentRuns.length>2)state.agentRuns.shift();
      else if(state.progress.length>2)state.progress.shift();
      else if(state.branches.length>2)state.branches.pop();
      else if(state.claims.length>1)state.claims.pop();
      else if(state.actions.length)state.actions.pop();
      else if(state.hints.length)state.hints.pop();
      else if(state.constraints.length)state.constraints.pop();
      else if(state.checkpoint?.questions.length)state.checkpoint.questions.pop();
      else if(state.criteria.length>1)state.criteria.pop();
      else if(state.branches.length)state.branches.pop();
      else if(state.agentRuns.length)state.agentRuns.shift();
      else break;
    }
    state.truncated={...state.truncated,claims:t.claims.length-state.claims.length,observations:t.observations.length-state.observations.length,criteria:t.criteria.length-state.criteria.length,
      constraints:t.constraints.length-state.constraints.length,actions:t.actions.length-state.actions.length,hints:t.hints.length-state.hints.length,
      progress:(t.progress?.length??0)-state.progress.length,
      branches:(t.branches?.length??0)-state.branches.length,agentRuns:(t.agentRuns?.length??0)-state.agentRuns.length,
      questions:(t.checkpoint?.questions.length??0)-(state.checkpoint?.questions.length??0),text:textTruncated};
    state.truncated.bytes=size();
    return state;
  }
  continuation(taskId:string,session:Session):string|undefined{
    const task=this.store.get(taskId);try{this.own(task,session);}catch{return;}
    if(task.status!=='active'||task.interrupted||this.check(taskId).ok)return;
    if(!curated(task)&&task.budget.deadline&&Date.parse(task.budget.deadline)<=this.now().getTime())return;
    if(task.continuation?.count && (task.continuation.revision===task.revision||task.continuation.count>=2))return;
    this.store.transaction(()=>{
      const t=this.store.get(taskId);t.continuation={revision:t.revision,count:(t.continuation?.count??0)+1};
      this.store.save(t,'continuation.suggested',t.continuation,this.at());
    });
    return `Cairn task ${taskId} is incomplete: ${this.check(taskId).issues.join('; ')}. Continue only if a useful action remains${curated(task)?'; configured deadlines are advisory':' within budget'}; otherwise suspend and report the missing evidence. Do not restart after a user interruption.`;
  }
}
