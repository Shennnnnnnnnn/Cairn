import { z } from 'zod';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { Engine } from './core/engine.js';
import { Gateway } from './gateway.js';
import { CairnError, type Session, type CheckpointInput } from './core/types.js';
import { branchStatus, branchRun } from './core/branches.js';

const text = z.string().trim().min(1);
const scope = z.record(text.max(200),text.max(2000));
const finding = z.object({
  key:text.max(200).optional(), text:text.max(8000),
  status:z.enum(['proposed','supported','refuted','inconclusive']).optional(),
  evidence:z.array(text).max(100).optional(), against:z.array(text).max(100).optional(),
  basis:text.max(16000).optional(),references:z.array(text.max(4000)).max(100).optional(),
  covers:z.array(text).max(100).optional(), scope:scope.optional(),
  branch:text.max(200).optional(),
}).strict();
const progress=z.object({key:text.max(200),title:text.max(2000),status:z.enum(['pending','running','completed','blocked','cancelled']),detail:text.max(4000).optional(),branch:text.max(200).optional()}).strict();
const branch=z.object({key:text.max(200),title:text.max(2000),status:z.enum(['pending','running','awaiting_review','completed','blocked','cancelled']),executor:z.enum(['main','subagent']).optional(),parent:text.max(200).nullable().optional(),question:text.max(4000).optional(),rationale:text.max(4000).optional(),assignee:text.max(200).optional(),agentId:text.max(500).nullable().optional(),summary:text.max(8000).optional()}).strict();
const draft = z.object({
  summary:text.max(16000).optional(),
}).strict();
const checkpointFields = {
  summary:text.max(16000), findings:z.array(finding).max(100).optional(),
  questions:z.array(text.max(2000)).max(50).optional(), next:text.max(4000).optional(), report:draft.optional(),
  progress:z.array(progress).max(100).optional(),
  branches:z.array(branch).max(100).optional(),
};
const schemas = {
  cairn_start:z.object({
    session_id:text.optional(), goal:text.max(12000), origin:text.default('user request'),
    criteria:z.array(text.max(4000)).min(1).max(100).optional(), constraints:z.array(text.max(2000)).max(50).default([]),
    scope:scope.optional(),
    evidence_mode:z.enum(['curated','captured']).optional(),progress:z.array(progress).max(100).optional(),branches:z.array(branch).max(100).optional(),
    budget:z.object({deadline:z.iso.datetime().optional(),maxCalls:z.number().int().positive().optional(),maxParallel:z.number().int().min(1).max(32).optional()}).strict().optional(),
  }).strict(),
  cairn_resume:z.object({session_id:text.optional(),task_id:text,takeover:z.boolean().default(false)}).strict(),
  cairn_read:z.object({view:z.enum(['context','details','evidence','history','tasks','branches']).default('context'),task_id:text.optional(),ref:text.optional(),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(32768).optional(),revision:z.number().int().nonnegative().optional()}).strict(),
  cairn_checkpoint:z.object(checkpointFields).strict(),
  cairn_finish:z.object({...checkpointFields,summary:checkpointFields.summary.optional(),outcome:z.enum(['completed','suspended']).default('completed')}).strict(),
};
const descriptions:Record<keyof typeof schemas,string> = {
  cairn_start:'Autonomously assess independent investigation branches and choose the useful number of host-native subagents under host/user limits, including zero. Optional branches {key,title,status,executor,parent,question,rationale,assignee,agentId,summary} track the decision and work. Cairn does not spawn them. Start a persistent goal. General tasks default to curated evidence: use any host tools freely; Cairn records no calls/results and imposes no call/concurrency quota. Preserve initial tool guidance in constraints. Optional progress items describe meaningful work. Completion depends on goal criteria and findings with basis/file/URL references. Deadline is advisory here. Explicit evidence_mode=captured enables optional automatic capture. Generic cairn mcp and Pi bind session identity automatically: omit session_id. Native Claude/Codex adapters supply the real startup-hook session_id once.',
  cairn_resume:'Restore a saved goal and bind this connection. Supply task_id; generic cairn mcp and Pi omit session_id because it is already bound. Native Claude/Codex adapters supply the real startup-hook session_id once. Moving to a different owner requires explicit takeover=true. Returns bounded recovery context.',
  cairn_read:'Use view=branches for paginated branch states and reviewed findings; ref selects a branch key. Read bounded context, task details, curated findings by key/id, optional captured evidence by E1/result_ref, paginated history, or saved tasks. Defaults to bound task. Large records use character offsets; indexes/history use record offsets. Supply revision when continuing details pages to detect changes.',
  cairn_checkpoint:'Update branches by key; link findings/progress with branch. Use pending before launch, running after actual launch, awaiting_review when returned, completed after main-agent review, blocked or cancelled when stopped. Completed/cancelled branches need a result/stopping summary. agentId is optional and must be a real host ID when supplied. Never set host lifecycle metadata. Save meaningful progress and findings together. In default curated mode, findings use basis (what supports the conclusion) and references (file paths/URLs); nothing is automatically verified or captured. covers associates supported findings with c1 etc. Optional progress items update work status by readable key. Captured mode also supports actual E1/result_ref links. Preserve unresolved questions and update only at milestones; no tool-by-tool bookkeeping or private reasoning.',
  cairn_finish:'Before completion, review or cancel unresolved branches and settle known running child agents; suspension always remains possible. Finish in one call with summary and evidence-backed findings, or suspend with unresolved questions. References and goal coverage are validated, with report citations generated automatically. Failed checks keep the task active and return gaps. Retrying a completed finish without new content returns its status.',
};
export interface ToolDefinition { name:string; description:string; inputSchema:Record<string,unknown>; readOnly?:boolean }
export function coreCatalog():ToolDefinition[] {
  return Object.entries(schemas).map(([name,schema]) => {
    const inputSchema=z.toJSONSchema(schema,{io:'input'}) as Record<string,unknown>;delete inputSchema.$schema;
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
          for(const tool of await this.gateway.list()) {
            const name=`cairn_tool_${tool.name}`;
            const inputSchema=structuredClone(tool.inputSchema) as Record<string,unknown>;
            this.validators.set(name,new AjvJsonSchemaValidator().getValidator(inputSchema));
            this.dynamic.push({name,description:`${tool.description??tool.name}\nCurated mode forwards calls without recording them. Captured mode saves original results and applies configured limits.`,inputSchema});
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
  async invoke(name:string,input:unknown,signal?:AbortSignal):Promise<unknown> {
    if(Object.hasOwn(schemas,name)) {
      const parsed=(schemas[name as keyof typeof schemas] as z.ZodType<any>).parse(input??{});
      if(name==='cairn_start') {
        const session=resolveSession(this.bound??this.baseSession,parsed);
        const {session_id,evidence_mode,...goal}=parsed;
        const task=this.engine.create(session,{...goal,evidenceMode:evidence_mode??'curated',criteria:goal.criteria??[goal.goal]});
        this.bound=session;this.boundTask=task.id;return this.engine.context(task.id);
      }
      if(name==='cairn_resume') {
        const session=resolveSession(this.bound??this.baseSession,parsed);
        const task=this.engine.resume(parsed.task_id,session,parsed.takeover);
        this.bound=session;this.boundTask=task.id;return this.engine.context(task.id);
      }
      if(name==='cairn_read')return this.read(parsed);
      const {task,session}=this.current();
      if(name==='cairn_checkpoint')return this.engine.checkpoint(task.id,session,parsed as CheckpointInput);
      return this.engine.finish(task.id,session,parsed);
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
    return {evidence:{ref:`E${index+1}`,observationId:observation.id,resultRef:observation.resultRef,status:observation.status,scope:observation.scope,eligible:observation.eligible},result:observation.output};
  }
  private read(input:z.infer<typeof schemas.cairn_read>) {
    const {view,offset}=input;
    if(view==='tasks'||(!this.bound&&view==='context'&&!input.task_id)) {
      const tasks=this.engine.store.list(),limit=Math.min(input.limit??20,50);
      return {tasks:tasks.slice(offset,offset+limit),total:tasks.length,nextOffset:offset+limit<tasks.length?offset+limit:undefined,binding:this.bound?'bound':'Call cairn_start or cairn_resume with the native session_id once.',upstream:this.catalogStatus};
    }
    const task=input.task_id?this.engine.store.get(input.task_id):this.current().task;
    if(input.revision!==undefined&&input.revision!==task.revision)throw new CairnError('revision_changed','Task changed while paging; restart reading at offset 0 with its new revision.');
    if(view==='context')return {...this.engine.context(task.id),upstream:this.catalogStatus};
    if(view==='branches'){
      const items=(task.branches??[]).map(branch=>({...branch,status:branchStatus(task,branch),recordedStatus:branch.status,activity:branchRun(task,branch)??{source:'agent',verification:'Main-agent report; no matching native lifecycle observed'},findings:task.claims.filter(claim=>claim.branch===branch.key).map(claim=>({id:claim.id,key:claim.key,status:claim.status,text:claim.text.slice(0,1500)}))}));
      if(input.ref){
        const item=items.find(branch=>branch.key===input.ref);if(!item)throw new CairnError('not_found','Branch does not belong to this task');
        const serialized=JSON.stringify(item),limit=input.limit??16384;
        return serialized.length<=limit&&offset===0?{taskId:task.id,revision:task.revision,item}:{taskId:task.id,revision:task.revision,encoding:'json',chunk:serialized.slice(offset,offset+limit),offset,totalCharacters:serialized.length,nextOffset:offset+limit<serialized.length?offset+limit:undefined};
      }
      const limit=Math.min(input.limit??20,50);
      return {taskId:task.id,revision:task.revision,total:items.length,items:items.slice(offset,offset+limit).map(({question,rationale,summary,...branch})=>({...branch,question:question?.slice(0,1000),rationale:rationale?.slice(0,1000),summary:summary?.slice(0,2000),findings:branch.findings.slice(0,12)})),nextOffset:offset+limit<items.length?offset+limit:undefined};
    }
    if(view==='details'){
      const {observations,...details}=task;
      const serialized=JSON.stringify({...details,evidenceCount:observations.length}),limit=input.limit??16384;
      return {taskId:task.id,revision:task.revision,encoding:'json',chunk:serialized.slice(offset,offset+limit),offset,totalCharacters:serialized.length,nextOffset:offset+limit<serialized.length?offset+limit:undefined};
    }
    if(view==='evidence') {
      if(task.evidenceMode==='curated'){
        const items=task.claims.filter(c=>c.basis||c.references?.length).map(c=>({id:c.id,key:c.key,text:c.text,status:c.status,basis:c.basis,references:c.references??[],source:'agent' as const}));
        if(input.ref){
          const item=items.find(c=>c.id===input.ref||c.key===input.ref);if(!item)throw new CairnError('not_found','Curated finding not found; use its key or id. This task stores no original tool records.');
          const serialized=JSON.stringify(item),limit=input.limit??16384;
          return serialized.length<=limit&&offset===0?{mode:'curated',item}:{mode:'curated',encoding:'json',chunk:serialized.slice(offset,offset+limit),offset,totalCharacters:serialized.length,nextOffset:offset+limit<serialized.length?offset+limit:undefined};
        }
        const limit=Math.min(input.limit??20,50);
        return {mode:'curated',verification:'AI-curated; file/URL content and causal correctness are not automatically verified',total:items.length,items:items.slice(offset,offset+limit).map(item=>({...item,text:item.text.slice(0,1500),basis:item.basis?.slice(0,2000),references:item.references.slice(0,8),truncated:item.text.length>1500||(item.basis?.length??0)>2000||item.references.length>8})),nextOffset:offset+limit<items.length?offset+limit:undefined};
      }
      if(!input.ref) {
        const limit=Math.min(input.limit??20,50);
        return {taskId:task.id,total:task.observations.length,observations:task.observations.slice(offset,offset+limit).map((o,i)=>({ref:`E${offset+i+1}`,id:o.id,tool:o.tool,status:o.status,eligible:o.eligible,source:o.source,resultRef:o.resultRef,scope:o.scope,capturedAt:o.capturedAt})),nextOffset:offset+limit<task.observations.length?offset+limit:undefined};
      }
      const observation=this.engine.resolveEvidence(task.id,input.ref);
      const {input:args,output,...metadata}=observation;
      const data={input:args,output},serialized=JSON.stringify(data),limit=input.limit??16384;
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
