import { randomUUID } from 'node:crypto';
import { Store } from './store.js';
import { CairnError, type Session, type Scope, type Task, type Observation, type Claim, type Report, type Check, type Budget } from './types.js';

const id = (prefix: string) => `${prefix}_${randomUUID()}`;
export const covers = (actual: Scope, required: Scope) => Object.entries(required).every(([k,v]) => actual[k as keyof Scope] === v);
function requireText(value: string, name: string) { if (!value.trim()) throw new CairnError('invalid_input', `${name} must not be empty`); }

export class Engine {
  constructor(readonly store: Store, readonly now: () => Date = () => new Date()) {}
  at() { return this.now().toISOString(); }
  active(session: Session): Task | undefined {
    const binding = this.store.session(session); return binding?.taskId ? this.store.get(binding.taskId) : undefined;
  }
  private own(task: Task, session: Session) {
    const bound = this.store.session(session);
    if (task.owner.host !== session.host || task.owner.sessionId !== session.sessionId || bound?.epoch !== task.owner.epoch)
      throw new CairnError('stale_owner', 'This session no longer owns this task. Explicitly resume with takeover to continue.');
  }
  private edit<T>(taskId: string, session: Session, kind: string, payload: unknown, fn: (task: Task) => T, allowSuspended = false): T {
    return this.store.transaction(() => {
      const task = this.store.get(taskId); this.own(task, session);
      if (task.status !== 'active' && !(allowSuspended && task.status === 'suspended')) throw new CairnError('inactive_task', `Task is ${task.status}`);
      const submits=this.store.config<{tools:{name:string;role?:string}[]}>('gateway')?.tools.filter(t=>t.role==='submit').map(t=>t.name)??[];
      if(['claim.revised','criterion.updated','report.saved'].includes(kind)&&Object.values(task.calls).some(c=>c.status==='running'&&submits.includes(c.tool)))throw new CairnError('submission_in_flight','Goal evidence and report are frozen while a submission is in flight');
      const result = fn(task); task.revision++; this.store.save(task, kind, {input:payload,result:result??null,owner:task.owner,revision:task.revision}, this.at()); return result;
    });
  }
  create(session: Session, input: { origin: string; goal: string; constraints?:string[]; criteria: string[]; profile?: 'general'|'emergency'; scope?: Scope; budget?: Partial<Budget> }): Task {
    requireText(input.goal, 'goal'); requireText(input.origin, 'origin');
    if (!input.criteria.length || input.criteria.some(c => !c.trim())) throw new CairnError('invalid_input', 'Supply at least one nonempty completion criterion');
    return this.store.transaction(() => {
      const existing = this.active(session);
      if (existing?.status === 'active') throw new CairnError('active_task', 'Suspend or complete the current task before creating another');
      const scope = input.scope ?? {}, profile = input.profile ?? 'general';
      const budget: Budget = { maxParallel: 3, ...input.budget };
      if (budget.deadline && !Number.isFinite(Date.parse(budget.deadline))) throw new CairnError('invalid_input', 'Invalid deadline');
      if (budget.maxParallel < 1 || !Number.isInteger(budget.maxParallel) || (budget.maxCalls !== undefined && (!Number.isInteger(budget.maxCalls) || budget.maxCalls < 1))) throw new CairnError('invalid_input', 'Invalid budget');
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
      const task: Task = { id: id('task'), origin: input.origin, goal: input.goal,constraints:input.constraints??[],
        criteria: input.criteria.map((text,i) => ({id:`c${i+1}`,text,claimIds:[]})), profile, scope, budget,
        owner: {...session,epoch:1}, revision:1, createdAt:this.at(), status:'active',
        observations:[], claims:[], actions:[], hints:[], calls:{}, interrupted:false };
      this.store.save(task, 'task.created', task, this.at()); this.store.bind(session, task); return task;
    });
  }
  resume(taskId: string, session: Session, takeover = false): Task {
    return this.store.transaction(() => {
      const task = this.store.get(taskId);
      if (task.status === 'completed') throw new CairnError('completed_task', 'Completed tasks are immutable; create a new task for follow-up');
      if (!takeover && (task.owner.host !== session.host || task.owner.sessionId !== session.sessionId)) throw new CairnError('takeover_required', 'A different session owns this task; explicit takeover is required');
      if (task.profile === 'emergency') {
        const caps = this.store.session(session)?.capabilities;
        if (!caps?.capture || !caps.preTool || !caps.restore || !caps.stop) throw new CairnError('missing_capabilities', 'This host cannot resume a strict emergency task');
      }
      if (takeover) {
        task.owner = {...session,epoch:task.owner.epoch+1};
        for (const call of Object.values(task.calls)) if (call.status === 'running') call.status = 'finished';
        for (const action of task.actions) if (action.status === 'running') action.status = 'cancelled';
      }
      task.status='active'; task.interrupted=false; task.revision++;
      this.store.save(task, 'task.resumed', {session,takeover}, this.at()); this.store.bind(session,task); return task;
    });
  }
  suspend(taskId: string, session: Session) {
    return this.edit(taskId,session,'task.suspended',{},task=>{task.status='suspended';task.interrupted=true;});
  }
  hint(taskId: string, session: Session, text: string, author: string) {
    return this.edit(taskId,session,'hint.added',{text,author},task=>{const hint={id:id('hint'),text,author};task.hints.push(hint);return hint;});
  }
  claim(taskId: string, session: Session, input: Omit<Claim,'id'|'revision'|'scope'> & {id?:string;scope?:Scope}) {
    return this.edit(taskId,session,'claim.revised',input,task=>{
      const old=input.id ? task.claims.find(c=>c.id===input.id) : undefined;
      if(input.id && !old)throw new CairnError('not_found','Unknown claim');
      const claim: Claim={...input,id:old?.id??id('claim'),revision:(old?.revision??0)+1,scope:input.scope??task.scope};
      requireText(claim.text,'claim');
      for(const ref of [...claim.supports,...claim.refutes]) this.evidence(task,ref,claim.scope);
      if(claim.status==='supported' && (!claim.supports.length || claim.refutes.length))throw new CairnError('unsupported_claim','Supported claims need supporting observations and no unresolved refutations');
      if(claim.status==='refuted' && !claim.refutes.length)throw new CairnError('unsupported_claim','Refuted claims need refuting observations');
      if(old)task.claims[task.claims.indexOf(old)]=claim;else task.claims.push(claim);
      return claim;
    });
  }
  satisfy(taskId: string, session: Session, criterionId: string, claimIds: string[]) {
    return this.edit(taskId,session,'criterion.updated',{criterionId,claimIds},task=>{
      const criterion=task.criteria.find(c=>c.id===criterionId);if(!criterion)throw new CairnError('not_found','Unknown criterion');
      for(const claimId of claimIds) { const c=task.claims.find(c=>c.id===claimId);if(!c || c.status!=='supported')throw new CairnError('unsupported_claim','Completion requires supported claims'); }
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
  check(taskId: string): Check {
    const task=this.store.get(taskId);
    const unmet=task.criteria.filter(c=>!c.claimIds.length || c.claimIds.some(ref=>{
      const claim=task.claims.find(x=>x.id===ref);
      return !claim || claim.status!=='supported' || !claim.supports.length || claim.refutes.length || claim.supports.some(o=>!task.observations.find(x=>x.id===o&&x.eligible&&x.status==='success'));
    })).map(c=>c.id);
    const issues=unmet.map(c=>`Criterion ${c} lacks a supported conclusion`);
    if(task.interrupted)issues.push('Task was interrupted');
    if(Object.values(task.calls).some(c=>c.status==='running'))issues.push('Tool calls are still running');
    return {ok:!issues.length,issues,unmet};
  }
  private evidence(task:Task, ref:string, scope:Scope):Observation {
    const o=task.observations.find(x=>x.id===ref);
    if(!o||!o.eligible||o.status!=='success')throw new CairnError('invalid_evidence',`Observation ${ref} is missing, failed or late`);
    if(!covers(o.scope,scope))throw new CairnError('scope_mismatch',`Observation ${ref} does not cover the claimed scope`);
    if(task.profile==='emergency'&&(o.source==='manual'||!o.resultRef))throw new CairnError('invalid_evidence','Competition evidence must be automatically captured with a real result_ref');
    return o;
  }
  validateReport(taskId:string, report:Report):Check {
    const task=this.store.get(taskId),check=this.check(taskId),issues=[...check.issues];
    if(!report.summary.trim())issues.push('Report summary is required');
    if(!report.citations.length)issues.push('At least one evidence citation is required');
    for(const citation of report.citations)try{
      const o=this.evidence(task,citation.observationId,task.scope);
      if(!citation.statement.trim())issues.push('Each citation needs an explanation');
      if(citation.resultRef!==undefined&&citation.resultRef!==o.resultRef)issues.push(`Invalid result_ref for ${o.id}`);
      if(task.profile==='emergency'&&citation.resultRef!==o.resultRef)issues.push(`Missing result_ref for ${o.id}`);
    }catch(e){issues.push((e as Error).message);}
    const cited=new Set(report.citations.map(c=>c.observationId));
    for(const criterion of task.criteria)for(const ref of criterion.claimIds){
      const claim=task.claims.find(c=>c.id===ref);
      if(claim&&!claim.supports.some(o=>cited.has(o)))issues.push(`Report does not cite evidence for ${criterion.id}/${claim.id}`);
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
    return {ok:!issues.length,issues:[...new Set(issues)],unmet:check.unmet};
  }
  report(taskId:string,session:Session,report:Report){
    return this.edit(taskId,session,'report.saved',report,task=>{task.report=report;task.delivery=undefined;task.confirmedAt=undefined;return this.validateReport(taskId,report);});
  }
  complete(taskId:string,session:Session){
    return this.edit(taskId,session,'task.completed',{},task=>{
      if(!task.report)throw new CairnError('invalid_report','Save and validate a report before completion');
      const check=this.validateReport(taskId,task.report);if(!check.ok)throw new CairnError('invalid_report',check.issues.join('; '));
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
  beforeTool(taskId:string,session:Session,callId:string,tool:string,submission=false,receipt=false){
    return this.edit(taskId,session,'tool.started',{callId,tool},task=>{
      if(task.calls[callId])return {duplicate:true};
      if(task.budget.deadline&&this.now().getTime()>=Date.parse(task.budget.deadline))throw new CairnError('deadline','Task deadline has passed');
      if(task.profile==='emergency'&&!submission&&!receipt&&task.budget.deadline&&Date.parse(task.budget.deadline)-this.now().getTime()<=(task.budget.submitReserveMs??30000))throw new CairnError('submission_window','Investigation budget ended; reserve the remaining time for report submission and receipt checks');
      if(task.budget.maxCalls!==undefined&&Object.keys(task.calls).length>=task.budget.maxCalls)throw new CairnError('call_budget','Tool call budget exhausted');
      if(Object.values(task.calls).filter(c=>c.status==='running').length>=task.budget.maxParallel)throw new CairnError('concurrency','Maximum parallel tool calls reached');
      if(submission){
        if(task.delivery)throw new CairnError('already_delivered','Submission receipt already exists; inspect it before retrying');
        if(Object.values(task.calls).some(c=>c.status==='running'&&c.tool===tool))throw new CairnError('submission_in_flight','Another submission is in flight');
        if(Object.values(task.calls).some(c=>c.tool===tool))throw new CairnError('ambiguous_submission','A prior submission was attempted; reconcile its receipt before retrying');
        if(!task.report||!this.validateReport(taskId,task.report).ok)throw new CairnError('invalid_report','Report must pass validation before submission');
      }
      task.calls[callId]={status:'running',tool,startedAt:this.at()};return {duplicate:false};
    });
  }
  observe(taskId:string,session:Session,input:Omit<Observation,'id'|'capturedAt'|'eligible'|'scope'|'actor'> & {scope?:Scope}){
    return this.store.transaction(()=>{
      const task=this.store.get(taskId);
      const old=task.observations.find(o=>o.callId===input.callId&&o.source===input.source);if(old)return old;
      let owned=true;try{this.own(task,session);}catch{owned=false;}
      const eligible=owned&&task.status==='active'&&!task.interrupted&&(!task.budget.deadline||this.now().getTime()<Date.parse(task.budget.deadline));
      const observation:Observation={...input,id:id('obs'),scope:input.scope??task.scope,actor:{host:session.host,sessionId:session.sessionId,epoch:this.store.session(session)?.epoch??0},eligible,capturedAt:this.at()};
      task.observations.push(observation);
      if(owned&&task.calls[input.callId])task.calls[input.callId]!.status='finished';
      task.revision++;this.store.save(task,'observation.captured',observation,this.at());return observation;
    });
  }
  context(taskId:string){
    const t=this.store.get(taskId);
    return {taskId:t.id,goal:t.goal,origin:t.origin,constraints:t.constraints,status:t.status,owner:t.owner,criteria:t.criteria,
      claims:t.claims,observations:t.observations.map(({output,input,...o})=>o),actions:t.actions,hints:t.hints,
      budget:t.budget,remainingMs:t.budget.deadline?Math.max(0,Date.parse(t.budget.deadline)-this.now().getTime()):null,
      check:this.check(taskId),delivery:t.delivery,revision:t.revision};
  }
  continuation(taskId:string,session:Session):string|undefined{
    const task=this.store.get(taskId);try{this.own(task,session);}catch{return;}
    if(task.status!=='active'||task.interrupted||this.check(taskId).ok)return;
    if(task.budget.deadline&&Date.parse(task.budget.deadline)<=this.now().getTime())return;
    if(task.continuation?.count && (task.continuation.revision===task.revision||task.continuation.count>=2))return;
    this.store.transaction(()=>{
      const t=this.store.get(taskId);t.continuation={revision:t.revision,count:(t.continuation?.count??0)+1};
      this.store.save(t,'continuation.suggested',t.continuation,this.at());
    });
    return `Cairn task ${taskId} is incomplete: ${this.check(taskId).issues.join('; ')}. Continue only if a useful action remains within budget; otherwise suspend and report the missing evidence. Do not restart after a user interruption.`;
  }
}
