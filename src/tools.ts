import { z } from 'zod';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { Engine } from './core/engine.js';
import { claimReferenceIssues } from './core/artifacts.js';
import { Gateway, publicInputSchema } from './gateway.js';
import { CairnError, publicTask, type Session, type CheckpointInput } from './core/types.js';

const text = z.string().trim().min(1);
const scope = z.object({ workspaceId:text.optional(), issueId:text.optional(), teamId:text.optional(), roundId:text.optional(), matchId:text.optional() }).strict();
const finding = z.object({
  key:text.max(200).optional(), text:text.max(8000),
  status:z.enum(['proposed','supported','refuted','inconclusive']).optional(),
  evidence:z.array(text).max(100).optional(), against:z.array(text).max(100).optional(),
  basis:text.max(16000).optional(),references:z.array(text.max(4000)).max(100).optional(),
  covers:z.array(text).max(100).optional(), scope:scope.optional(),
  from:z.array(text).max(100).optional(),
}).strict();
const progress=z.object({key:text.max(200),title:text.max(2000),status:z.enum(['pending','running','completed','blocked','cancelled']),detail:text.max(4000).optional(),from:z.array(text).max(100).optional(),delegated:z.boolean().optional()}).strict();
const draft = z.object({
  summary:text.max(16000).optional(),
  impact:z.object({text,scope,observationIds:z.array(text)}).strict().optional(),
  rootCause:z.object({text,level:z.enum(['symptom','service','code','root']),trigger:text.optional(),amplification:text.optional()}).strict().optional(),
  solution:z.object({mitigation:text,fix:text,prevention:text}).strict().optional(),
}).strict();
const artifact=z.object({path:text.max(4000),description:text.max(2000).optional()}).strict();
const handoff=z.object({key:text.max(200),summary:text.max(4000),report:text.max(4000).optional(),artifacts:z.array(text.max(4000)).max(16).optional(),sessionRef:text.max(4000).optional(),from:z.array(text).max(100).optional(),next:text.max(4000).optional()}).strict();
const checkpointFields = {
  summary:text.max(16000), findings:z.array(finding).max(100).optional(),
  questions:z.array(text.max(2000)).max(50).optional(), next:text.max(4000).optional(), report:draft.optional(),
  progress:z.array(progress).max(100).optional(),
  artifacts:z.array(artifact).max(16).optional(),handoffs:z.array(handoff).max(8).optional(),
};
const schemas = {
  cairn_start:z.object({
    session_id:text.optional(), title:text.max(200).optional(),goal:text.max(12000), origin:text.default('user request'),
    criteria:z.array(text.max(4000)).min(1).max(100).optional(), constraints:z.array(text.max(2000)).max(50).default([]),
    profile:z.enum(['general','emergency']).default('general'), scope:scope.optional(),
    evidence_mode:z.enum(['curated','captured']).optional(),progress:z.array(progress).max(100).optional(),
    reference_policy:z.enum(['advisory','strict']).optional(),
    budget:z.object({deadline:z.iso.datetime().optional(),maxCalls:z.number().int().positive().optional(),maxParallel:z.number().int().min(1).max(32).optional(),submitReserveMs:z.number().int().min(0).max(1800000).optional()}).strict().optional(),
  }).strict(),
  cairn_resume:z.object({session_id:text.optional(),task_id:text,takeover:z.boolean().default(false),reopen_reason:text.max(8000).optional(),invalidate:z.array(text).max(100).optional(),progress_key:text.max(200).optional(),lease_seconds:z.number().int().min(10).max(900).optional()}).strict(),
  cairn_read:z.object({view:z.enum(['context','details','evidence','history','handoffs','tasks']).default('context'),task_id:text.optional(),ref:text.optional(),focus:text.max(4000).optional(),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(32768).optional(),revision:z.number().int().nonnegative().optional()}).strict(),
  cairn_checkpoint:z.object({...checkpointFields,summary:checkpointFields.summary.optional(),task_id:text.optional(),progress_key:text.max(200).optional(),branch_action:z.enum(['claim','heartbeat','release','checkpoint','merge']).optional(),lease_token:text.optional(),lease_seconds:z.number().int().min(10).max(900).optional()}).strict().superRefine((value,ctx)=>{
    const control=value.progress_key&&['claim','heartbeat','release','merge'].includes(value.branch_action??'');
    if(!control&&!value.summary)ctx.addIssue({code:'custom',path:['summary'],message:'Checkpoint requires summary. Example: {"summary":"Checked sources; validating the result"}'});
    if(value.branch_action&&!value.progress_key)ctx.addIssue({code:'custom',path:['progress_key'],message:'Branch actions require progress_key'});
  }),
  cairn_finish:z.object({...checkpointFields,summary:checkpointFields.summary.optional(),basis:text.max(16000).optional(),references:z.array(text.max(4000)).max(100).optional(),from:z.array(text).max(100).optional(),covers:z.array(text).max(100).optional(),outcome:z.enum(['completed','suspended']).default('completed')}).strict(),
};
// Hosts publish and enforce the small model protocol. SDK invoke retains the
// historical parser, so integrations can migrate without exposing it to models.
const modelFinding=finding.extend({key:text.max(160),text:text.max(1600),status:z.enum(['proposed','supported','refuted','inconclusive']),basis:text.max(2000).optional(),references:z.array(text.max(1000)).max(8).optional(),covers:z.array(text).max(100)});
const modelSchemas={...schemas,
  cairn_checkpoint:z.object({...checkpointFields,summary:text.max(1000).optional(),findings:z.array(modelFinding).max(12).optional(),task_id:text.optional(),progress_key:text.max(200).optional(),branch_action:z.enum(['claim','heartbeat','release','checkpoint','merge']).optional(),lease_token:text.optional(),lease_seconds:z.number().int().min(10).max(900).optional()}).strict(),
  cairn_finish:z.object({outcome:z.enum(['completed','suspended']).default('completed'),summary:text.max(1000).optional()}).strict(),
};
// Transport compatibility only: decode one JSON object layer, then apply the
// unchanged strict model schema. Never turn prose into facts or infer fields.
export function prepareModelInput(name:string,input:unknown):unknown {
  if(name!=='cairn_checkpoint'||!input||typeof input!=='object'||Array.isArray(input))return input;
  const value={...input} as Record<string,unknown>;
  if(typeof value.next==='string'&&!value.next.trim())delete value.next;
  for(const field of ['findings','progress','artifacts','handoffs'])if(Array.isArray(value[field]))value[field]=value[field].map(item=>{
    if(typeof item!=='string'||item.length>32000)return item;
    try{const decoded=JSON.parse(item);return decoded&&typeof decoded==='object'&&!Array.isArray(decoded)?decoded:item;}catch{return item;}
  });
  return value;
}
const descriptions:Record<keyof typeof schemas,string> = {
  cairn_start:'Preserve the original goal, constraints and separate observable deliverables. Defaults to curated: native tools stay with the host, without recording or quotas. Pi/generic MCP omit session_id; Claude/Codex use the real startup identity once. Progress is optional. Captured/emergency is opt-in.',
  cairn_resume:'Restore a task and bind this connection. Different owners require takeover=true. Completed goals need explicit reopen_reason to revise; invalidate can name affected findings. Read the saved blackboard before repeating exploration. Optional progress_key joins delegated work with a private leaseToken; it does not transfer goal ownership.',
  cairn_read:'Read context, details, evidence, history, handoffs or tasks. focus accepts a criterion/finding/work reference. Use view=evidence ref=finding-key for exact saved grounds, dependencies and current reference state. Reuse source measurements before rescanning; changed sources need review. Read handoff report/artifacts before native history. Details use character offset/limit and revision; indexes use record offsets. Reads grant no coverage or correctness.',
  cairn_checkpoint:'Save increments as objects: {findings:[{key:"fact-a",text:"observed result",status:"supported",basis:"actual check",references:["source"],covers:[]}]}. Reuse keys. proposed=untested; refuted=excluded with counterevidence. covers:[] is intermediate; name c# only when justified. from names joint prerequisites. Compare mechanisms on the same subject before changing scope. Pressure may be cause, mediator or consequence; co-occurrence alone does not distinguish them. Save the strongest alternative and distinguishing evidence, or the unresolved gap. No new fact: save changed questions/next/progress; summary alone is rejected. Omit unused optional fields. Reuse saved measurements and source pointers; include time/window, known units or assumptions, and observed/missing coverage in basis when relevant. Read the delta, not the whole board after each save. Files/report/handoffs are optional; host handoff is automatic. Captured mode uses eligible E#. Branch control uses progress_key/lease_token/branch_action; workers propose.',
  cairn_finish:'Finish {} checks saved coverage and host acceptance. Only outcome and short summary are accepted. Save new facts, covers and file changes in checkpoint first. Required existing files are collected automatically. Repair named gaps before retrying {}; do not restate proof. No useful check remains: checkpoint the gap and finish {outcome:"suspended"}. A durable handoff is automatic. Completion/acceptance is not conclusion correctness; emergency delivery/confirmation stays separate.',
};
export interface ToolDefinition { name:string; description:string; inputSchema:Record<string,unknown>; readOnly?:boolean; role?:string }
export function coreCatalog():ToolDefinition[] {
  return Object.entries(modelSchemas).map(([name,schema]) => {
    const inputSchema=z.toJSONSchema(schema,{io:'input'}) as Record<string,unknown>;delete inputSchema.$schema;
    if(name==='cairn_checkpoint'){
      const properties=inputSchema.properties as Record<string,unknown>;
      inputSchema.anyOf=[...['findings','progress','artifacts','handoffs'].map(field=>({type:'object',required:[field],properties:{[field]:{type:'array',minItems:1}}})),...['questions','next','report'].map(field=>({type:'object',required:[field],properties:{[field]:properties[field]}})),{type:'object',required:['branch_action','progress_key'],properties:{branch_action:{type:'string',enum:['claim','heartbeat','release','merge']},progress_key:properties.progress_key}}];
    }
    return {name,description:descriptions[name as keyof typeof schemas],inputSchema,readOnly:name==='cairn_read'};
  });
}
export function resolveSession(base:Session,input:{session_id?:string}):Session {
  if(base.sessionId&&input.session_id&&base.sessionId!==input.session_id)throw new CairnError('session_mismatch','The native host session is authoritative; omit session_id or use the supplied host id');
  const sessionId=input.session_id??base.sessionId;
  if(!sessionId)throw new CairnError('session_required','Call cairn_start or cairn_resume with the session_id supplied by the startup hook. Standalone MCP may use --session-id.');
  return {...base,sessionId};
}

/** One native session or MCP connection owns one binding and one upstream lifecycle. */
export class ToolRuntime {
  private bound?:Session;
  private lastInputError?:{fingerprint:string;count:number};
  private boundTask?:string;
  private loading?:Promise<ToolDefinition[]>;
  private validators=new Map<string,ReturnType<AjvJsonSchemaValidator['getValidator']>>();
  private dynamic:ToolDefinition[]=[];
  private catalogRevision='';
  catalogStatus:{ok:boolean;error?:string}={ok:true};
  readonly gateway:Gateway;
  constructor(readonly engine:Engine,readonly baseSession:Session,gateway?:Gateway) {
    this.bound=baseSession.sessionId?{...baseSession}:undefined;
    this.boundTask=this.bound?engine.active(this.bound)?.id:undefined;
    if(this.bound&&this.boundTask)this.bound.epoch??=engine.store.session(this.bound)?.epoch;
    this.gateway=gateway??new Gateway(engine);
  }
  async list():Promise<ToolDefinition[]> {
    if(this.loading)return this.loading;
    const loading=this.loadCatalog();this.loading=loading;
    try{return await loading;}finally{if(this.loading===loading)this.loading=undefined;}
  }
  private async loadCatalog():Promise<ToolDefinition[]> {
    const configured=this.engine.store.config('gateway');
    const revision=JSON.stringify(configured??null);
    if(revision!==this.catalogRevision||!this.catalogStatus.ok) {
      this.dynamic=[];this.validators.clear();this.catalogStatus={ok:true};
      try {
        if(configured) {
          const config=this.gateway.config();
          for(const tool of await this.gateway.list()) {
            const mapping=config.tools.find(t=>t.name===tool.name)!;
            const name=`cairn_tool_${tool.name}`;
            const inputSchema=publicInputSchema(tool.inputSchema,mapping) as Record<string,unknown>;
            this.validators.set(name,new AjvJsonSchemaValidator().getValidator(inputSchema));
            this.dynamic.push({name,description:`${tool.description??tool.name}\nCurated mode forwards read tools without recording calls or results. Explicit captured mode records evidence and enforces configured limits.${tool.role==='submit'?' Submission is only available in captured mode; the saved validated report is injected automatically. Inspect the existing receipt before retrying.':''}`,inputSchema,role:tool.role});
          }
        }
        this.catalogRevision=revision;
      } catch(error) {
        this.dynamic=[];this.validators.clear();this.catalogStatus={ok:false,error:(error as Error).message};
      }
    }
    return [...coreCatalog(),...this.dynamic];
  }
  private session():Session {
    if(!this.bound)throw new CairnError('session_required','Bind this MCP connection with cairn_start or cairn_resume and the native session_id from startup. No session is inferred from recent activity.');
    return this.bound;
  }
  private current() {
    const session=this.session(),task=this.engine.active(session);
    if(!task)throw new CairnError('no_task','Start or resume a Cairn goal in this session first.');
    if(this.boundTask&&this.boundTask!==task.id)throw new CairnError('task_binding_changed','This connection belongs to a different task. Explicitly resume the intended task before writing.');
    this.boundTask=task.id;
    return {task,session};
  }
  async invokeModel(name:string,input:unknown,signal?:AbortSignal):Promise<unknown>{
    if(!Object.hasOwn(modelSchemas,name))return this.invoke(name,input,signal);
    const checked=(modelSchemas[name as keyof typeof modelSchemas] as z.ZodType<any>).safeParse(prepareModelInput(name,input??{}));
    if(!checked.success)throw new CairnError('invalid_model_input',name==='cairn_finish'?'finish accepts only outcome and a short summary. Save findings, covers, files and report with cairn_checkpoint, then cairn_finish {}.':checked.error.issues.slice(0,2).map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ').slice(0,700));
    const parsed=checked.data;
    if(name!=='cairn_checkpoint'){
      const result=await this.invoke(name,parsed,signal);
      return name==='cairn_finish'?this.modelReceipt(result as any):result;
    }
    const control=parsed.progress_key&&['claim','heartbeat','release','merge'].includes(parsed.branch_action??'');
    if(!control&&!parsed.findings?.length&&parsed.questions===undefined&&!parsed.progress?.length&&!parsed.artifacts?.length&&!parsed.handoffs?.length&&!parsed.next&&!Object.keys(parsed.report??{}).length)throw new CairnError('checkpoint_requires_delta','A summary alone is not an increment. Save a new/revised keyed finding with status, grounds and covers:[], or a changed question/next/progress. If nothing changed, keep exploring or suspend; do not invent facts.');
    const before=this.engine.store.get(parsed.task_id??this.current().task.id);
    const summary=parsed.summary??parsed.findings?.[0]?.text??parsed.next??parsed.questions?.[0]??parsed.progress?.[0]?.title??'Saved exploration state';
    const result=await this.invoke(name,{...parsed,...(!control?{summary:summary.slice(0,1000)}:{})},signal,true) as Record<string,unknown>;
    const after=this.engine.store.get(before.id),previous=new Map(before.claims.map(c=>[c.id,c.revision]));
    const changed=after.claims.filter(c=>!previous.has(c.id)||previous.get(c.id)!==c.revision);
    return {...this.modelReceipt(result,new Set(changed.map(c=>c.id)),after.claims.length),delta:{addedFindings:after.claims.filter(c=>!previous.has(c.id)).map(c=>c.key??c.id),revisedFindings:after.claims.filter(c=>previous.has(c.id)&&previous.get(c.id)!==c.revision).map(c=>c.key??c.id),stateChanged:after.revision!==before.revision}};
  }
  /** Model acknowledgements are deltas, not another recovery snapshot. SDK
   * receipts and explicit reads retain their historical complete projections. */
  private modelReceipt(result:Record<string,any>,changed?:Set<string>,total?:number):Record<string,any>{
    if(!result?.coverage||!result.exploration)return result; // Branch control has its own lease/context contract.
    const {findings=[],artifacts=[],handoffs=[],exploration,...rest}=result;
    const selected=findings.filter((f:any)=>changed?.has(f.id)||f.referenceState?.status==='stale');
    const {changed:repeatedFacts,guidance,...agenda}=exploration;
    return {...rest,findings:selected,findingsOmitted:(total??findings.length)-selected.length,
      exploration:{...agenda,uncertain:agenda.uncertain.map(({text,...ref}:any)=>ref),excluded:agenda.excluded.map(({text,...ref}:any)=>ref)},
      ...(artifacts.length?{artifacts:artifacts.map(({path,bytes}:any)=>({path,bytes}))}:{}),
      // The current host pointer is enough to find durable recovery; old manual
      // handoffs remain available through a focused read and are never deleted.
      ...(handoffs.length?{handoffs:handoffs.filter((h:any)=>h.key==='@host/state').slice(-1)}:{}),
      readMore:'Delta receipt; omitted facts and handoffs remain in cairn_read. Completion and acceptance do not establish conclusion correctness.'};
  }
  async invoke(name:string,input:unknown,signal?:AbortSignal,incremental=false):Promise<unknown> {
    if(Object.hasOwn(schemas,name)) {
      const checked=(schemas[name as keyof typeof schemas] as z.ZodType<any>).safeParse(input??{});
      if(!checked.success){
        const message=checked.error.issues.slice(0,3).map(issue=>`${issue.path.join('.')}: ${issue.message}`).join('; ').slice(0,1200);
        const fingerprint=JSON.stringify([name,input]);
        const count=this.lastInputError?.fingerprint===fingerprint?this.lastInputError.count+1:1;
        this.lastInputError={fingerprint,count};
        throw new CairnError('invalid_input',message+(count>1?' Do not repeat the unchanged call; correct the named fields. Use cairn_read to inspect saved state.':''));
      }
      this.lastInputError=undefined;
      const parsed=checked.data;
      if(name==='cairn_start') {
        const session=resolveSession(this.bound??this.baseSession,parsed);
        const {session_id,evidence_mode,reference_policy,...goal}=parsed;
        if(goal.profile==='emergency'){
          await this.list();
          if(!this.catalogStatus.ok)throw new CairnError('upstream_unavailable',`Cannot start a strict task while upstream tools are unavailable: ${this.catalogStatus.error}`);
        }
        const task=this.engine.create(session,{...goal,evidenceMode:evidence_mode??(goal.profile==='emergency'?'captured':'curated'),referencePolicy:reference_policy,criteria:goal.criteria??[goal.goal]});
        this.bound={...session,epoch:task.owner.epoch};this.boundTask=task.id;return this.engine.context(task.id);
      }
      if(name==='cairn_resume') {
        const session=resolveSession(this.bound??this.baseSession,parsed);
        if(parsed.progress_key){
          if(parsed.takeover||parsed.reopen_reason||parsed.invalidate)throw new CairnError('invalid_input','Branch claims cannot take over or reopen a goal');
          const result=this.engine.branch(parsed.task_id,session,parsed.progress_key,'claim',undefined,undefined,parsed.lease_seconds);
          this.bound={...session,epoch:result.context.owner.epoch};this.boundTask=parsed.task_id;return result;
        }
        if(parsed.invalidate&&!parsed.reopen_reason)throw new CairnError('invalid_input','invalidate requires reopen_reason');
        const task=parsed.reopen_reason?this.engine.reopen(parsed.task_id,session,parsed.reopen_reason,{takeover:parsed.takeover,invalidate:parsed.invalidate}):this.engine.resume(parsed.task_id,session,parsed.takeover);
        this.bound={...session,epoch:task.owner.epoch};this.boundTask=task.id;return this.engine.context(task.id);
      }
      if(name==='cairn_read')return this.read(parsed);
      if(name==='cairn_checkpoint'&&(parsed.progress_key||parsed.branch_action)){
        if(!parsed.progress_key)throw new CairnError('invalid_input','Branch operations require progress_key');
        const session=this.session(),taskId=parsed.task_id??this.current().task.id;
        const {task_id,progress_key,branch_action,lease_token,lease_seconds,...checkpoint}=parsed;
        const result=this.engine.branch(taskId,session,progress_key,branch_action??'checkpoint',lease_token,checkpoint as CheckpointInput,lease_seconds);
        if(branch_action==='claim'){this.boundTask=taskId;this.bound={...session,epoch:result.context.owner.epoch};}
        return result;
      }
      const {task,session}=this.current();
      if(name==='cairn_checkpoint'){
        if(parsed.task_id&&parsed.task_id!==task.id)throw new CairnError('task_binding_changed','Checkpoint task_id does not match this connection');
        if(parsed.lease_token||parsed.lease_seconds)throw new CairnError('invalid_input','Lease fields require progress_key');
        return this.receipt(this.engine.checkpoint(task.id,session,parsed as CheckpointInput,incremental));
      }
      return this.receipt(await this.engine.finishVerified(task.id,session,parsed,signal));
    }
    await this.list();
    const validate=this.validators.get(name);
    if(!validate)throw new CairnError('unknown_tool',this.catalogStatus.ok?`Unknown tool ${name}`:`Upstream tools unavailable: ${this.catalogStatus.error}`);
    const checked=validate(input??{});
    if(!checked.valid)throw new CairnError('invalid_input',checked.errorMessage);
    const {task,session}=this.current();
    if(task.evidenceMode==='curated')return {recorded:false,result:await this.gateway.callUnrecorded(task.id,session,name.slice('cairn_tool_'.length),checked.data as Record<string,unknown>,signal),guidance:'Use basis and references for curated findings; no E# tool record is created.'};
    const observation=await this.gateway.call(task.id,session,name.slice('cairn_tool_'.length),checked.data as Record<string,unknown>,signal);
    const saved=this.engine.store.get(task.id),index=saved.observations.findIndex(o=>o.id===observation.id);
    return {evidence:{ref:`E${index+1}`,observationId:observation.id,resultRef:observation.resultRef,status:observation.status,scope:observation.scope,eligible:observation.eligible},result:observation.output,delivery:saved.delivery?{recorded:true}:undefined};
  }
  private receipt(context:ReturnType<Engine['context']>&{phase?:string;validation?:unknown;repair?:unknown}){
    return {taskId:context.taskId,status:context.status,revision:context.revision,owner:{epoch:context.owner.epoch},phase:context.phase,
      coverage:{covered:context.totals.coveredCriteria,total:context.totals.criteria},
      findings:context.claims.map(c=>({id:c.id,key:c.key,status:c.status,covers:c.covers,referenceState:c.referenceState})),
      check:context.check,validation:context.validation,repair:context.repair,completionValidation:context.completionValidation,verification:context.verification,execution:context.execution,
      artifacts:context.artifacts,handoffs:context.handoffs.map(h=>({id:h.id,key:h.key,report:h.report})),budget:context.budget,remainingMs:context.remainingMs,conclude:context.conclude,
      exploration:context.exploration,
      readMore:'Continue from this blackboard agenda; use cairn_read only for missing details. New facts, counterevidence or a closed direction should change the next decision, not just the final report.'};
  }
  private read(input:z.infer<typeof schemas.cairn_read>) {
    const {view,offset}=input;
    if(view==='tasks'||(!this.bound&&view==='context'&&!input.task_id)) {
      const tasks=this.engine.store.list(),limit=Math.min(input.limit??20,50);
      return {tasks:tasks.slice(offset,offset+limit),total:tasks.length,nextOffset:offset+limit<tasks.length?offset+limit:undefined,binding:this.bound?'bound':'Call cairn_start or cairn_resume with the native session_id once.',upstream:this.catalogStatus};
    }
    const task=publicTask(input.task_id?this.engine.store.get(input.task_id):this.current().task);
    if(input.revision!==undefined&&input.revision!==task.revision)throw new CairnError('revision_changed','Task changed while paging; restart reading at offset 0 with its new revision.');
    if(view==='context')return {...this.engine.context(task.id,input.focus),upstream:this.catalogStatus};
    if(view==='handoffs'){
      const items=task.handoffs??[],limit=Math.min(input.limit??5,10);
      if(input.ref){
        const item=items.find(h=>h.id===input.ref)??items.findLast(h=>h.key===input.ref);if(!item)throw new CairnError('not_found','Handoff not found; use its key or id');
        const serialized=JSON.stringify(item),size=input.limit??8192;
        return {taskId:task.id,revision:task.revision,encoding:'json',chunk:serialized.slice(offset,offset+size),offset,totalCharacters:serialized.length,nextOffset:offset+size<serialized.length?offset+size:undefined};
      }
      return {taskId:task.id,revision:task.revision,total:items.length,items:items.slice().reverse().slice(offset,offset+limit).map(h=>({id:h.id,key:h.key,summary:h.summary.slice(0,500),report:h.report?.slice(0,350),at:h.at})),nextOffset:offset+limit<items.length?offset+limit:undefined};
    }
    if(view==='details'){
      const {observations,...details}=task;
      const serialized=JSON.stringify({...details,evidenceCount:observations.length}),limit=input.limit??16384;
      return {taskId:task.id,revision:task.revision,encoding:'json',chunk:serialized.slice(offset,offset+limit),offset,totalCharacters:serialized.length,nextOffset:offset+limit<serialized.length?offset+limit:undefined};
    }
    if(view==='evidence') {
      if(task.evidenceMode==='curated'){
        const claims=task.claims,cache=new Map();
        const item=(c:typeof claims[number])=>{
          const issues=claimReferenceIssues(task,c,cache);
          return {id:c.id,key:c.key,revision:c.revision,text:c.text,status:c.status,basis:c.basis,references:c.references??[],from:c.from??[],source:c.provenance??'agent',
            referenceState:{status:issues.length?'stale':c.referenceArtifacts?.length?'current':'untracked',issues:issues.slice(0,2)}};
        };
        const envelope={mode:'curated',taskId:task.id,revision:task.revision};
        if(input.ref){
          const claim=claims.find(c=>c.id===input.ref||c.key===input.ref);if(!claim)throw new CairnError('not_found','Curated finding not found; use its key or id. This task stores no original tool records.');
          const value=item(claim),serialized=JSON.stringify(value),limit=input.limit??16384;
          return serialized.length<=limit&&offset===0?{...envelope,item:value}:{...envelope,encoding:'json',chunk:serialized.slice(offset,offset+limit),offset,totalCharacters:serialized.length,nextOffset:offset+limit<serialized.length?offset+limit:undefined};
        }
        const limit=Math.min(input.limit??20,50);
        return {...envelope,verification:'AI-curated; content and causal correctness are not automatically verified. Current means file version unchanged',total:claims.length,items:claims.slice(offset,offset+limit).map(claim=>{const value=item(claim);return {...value,text:value.text.slice(0,1500),basis:value.basis?.slice(0,2000),references:value.references.slice(0,8),truncated:value.text.length>1500||(value.basis?.length??0)>2000||value.references.length>8};}),nextOffset:offset+limit<claims.length?offset+limit:undefined};
      }
      if(!input.ref) {
        const limit=Math.min(input.limit??20,50);
        return {taskId:task.id,total:task.observations.length,observations:task.observations.slice(offset,offset+limit).map((o,i)=>({ref:`E${offset+i+1}`,id:o.id,tool:o.tool,status:o.status,eligible:o.eligible,source:o.source,resultRef:o.resultRef,scope:o.scope,capturedAt:o.capturedAt})),nextOffset:offset+limit<task.observations.length?offset+limit:undefined};
      }
      const observation=this.engine.resolveEvidence(task.id,input.ref);
      const {input:args,output,receipt,...metadata}=observation;
      const data={input:args,output,receipt},serialized=JSON.stringify(data),limit=input.limit??16384;
      const ref=`E${task.observations.findIndex(o=>o.id===observation.id)+1}`;
      return serialized.length<=limit&&offset===0?{ref,...metadata,data}:{ref,...metadata,encoding:'json',chunk:serialized.slice(offset,offset+limit),offset,totalCharacters:serialized.length,nextOffset:offset+limit<serialized.length?offset+limit:undefined};
    }
    const events=this.engine.store.events(task.id);
    if(input.ref){
      const sequence=/^(?:event:)?([1-9]\d*)$/.exec(input.ref);
      const event=sequence?events.find(e=>e.seq===Number(sequence[1])):undefined;
      if(!event)throw new CairnError('not_found','Audit event does not belong to this task');
      const serialized=JSON.stringify(event.payload),limit=input.limit??16384;
      return {...event,payload:undefined,encoding:'json',chunk:serialized.slice(offset,offset+limit),offset,totalCharacters:serialized.length,nextOffset:offset+limit<serialized.length?offset+limit:undefined};
    }
    const limit=Math.min(input.limit??10,50),selected=events.slice(offset,offset+limit);
    let remaining=16000;
    const records=selected.map(({payload,...event})=>{
      const serialized=JSON.stringify(payload),size=Math.max(0,Math.min(remaining,2000));remaining-=Math.min(serialized.length,size);
      return {...event,...(serialized.length<=size?{payload}:{payloadPreview:serialized.slice(0,size),truncated:true})};
    });
    return {taskId:task.id,total:events.length,events:records,nextOffset:offset+limit<events.length?offset+limit:undefined};
  }
  async close(){await this.gateway.close();}
}
