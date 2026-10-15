import { z } from 'zod';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { Engine } from './core/engine.js';
import { Gateway, publicInputSchema } from './gateway.js';
import { CairnError, type Session, type CheckpointInput } from './core/types.js';

const text = z.string().trim().min(1);
const scope = z.object({ workspaceId:text.optional(), issueId:text.optional(), teamId:text.optional(), roundId:text.optional(), matchId:text.optional() }).strict();
const finding = z.object({
  key:text.max(200).optional(), text:text.max(8000),
  status:z.enum(['proposed','supported','refuted','inconclusive']).optional(),
  evidence:z.array(text).max(100).optional(), against:z.array(text).max(100).optional(),
  covers:z.array(text).max(100).optional(), scope:scope.optional(),
}).strict();
const draft = z.object({
  summary:text.max(16000).optional(),
  impact:z.object({text,scope,observationIds:z.array(text)}).strict().optional(),
  rootCause:z.object({text,level:z.enum(['symptom','service','code','root']),trigger:text.optional(),amplification:text.optional()}).strict().optional(),
  solution:z.object({mitigation:text,fix:text,prevention:text}).strict().optional(),
}).strict();
const checkpointFields = {
  summary:text.max(16000), findings:z.array(finding).max(100).optional(),
  questions:z.array(text.max(2000)).max(50).optional(), next:text.max(4000).optional(), report:draft.optional(),
};
const schemas = {
  cairn_start:z.object({
    session_id:text.optional(), goal:text.max(12000), origin:text.default('user request'),
    criteria:z.array(text.max(4000)).min(1).max(100).optional(), constraints:z.array(text.max(2000)).max(50).default([]),
    profile:z.enum(['general','emergency']).default('general'), scope:scope.optional(),
    budget:z.object({deadline:z.iso.datetime().optional(),maxCalls:z.number().int().positive().optional(),maxParallel:z.number().int().min(1).max(32).default(3),submitReserveMs:z.number().int().min(0).max(1800000).optional()}).strict().optional(),
  }).strict(),
  cairn_resume:z.object({session_id:text.optional(),task_id:text,takeover:z.boolean().default(false)}).strict(),
  cairn_read:z.object({view:z.enum(['context','details','evidence','history','tasks']).default('context'),task_id:text.optional(),ref:text.optional(),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(32768).optional(),revision:z.number().int().nonnegative().optional()}).strict(),
  cairn_checkpoint:z.object(checkpointFields).strict(),
  cairn_finish:z.object({...checkpointFields,summary:checkpointFields.summary.optional(),outcome:z.enum(['completed','suspended']).default('completed')}).strict(),
};
const descriptions:Record<keyof typeof schemas,string> = {
  cairn_start:'Start a persistent goal in the current session. Completion criteria describe observable user outcomes and default to the goal; put review handoffs in checkpoint questions. On MCP, supply the native session_id from startup once; subsequent calls are bound automatically. Continue using normal host tools.',
  cairn_resume:'Restore a saved goal and bind this connection. Supply task_id and, for MCP, the session_id from startup once. Moving to another native session requires explicit takeover=true. Returns bounded recovery context.',
  cairn_read:'Read bounded context, full task details, original evidence by E1/result_ref, paginated evidence/history, or saved tasks. Defaults to current bound task. Details and large evidence use character offsets; indexes/history use record offsets. Supply revision when continuing a details page to detect changes.',
  cairn_checkpoint:'Save a meaningful progress checkpoint in one call. Findings cite E1/E2 or genuine result_ref; covers names goal criteria (c1 etc). Stable finding keys revise earlier conclusions. References, goal coverage and report citations are maintained atomically. Include unresolved questions; avoid logging every thought.',
  cairn_finish:'Finish in one call with summary and evidence-backed findings, or suspend with unresolved questions. References and goal coverage are validated, with report citations generated automatically. Failed checks keep the task active and return gaps. Emergency delivery and human confirmation remain mandatory. Retrying a completed finish without new content returns its status.',
};
export interface ToolDefinition { name:string; description:string; inputSchema:Record<string,unknown>; readOnly?:boolean; role?:string }
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
          const config=this.gateway.config();
          for(const tool of await this.gateway.list()) {
            const mapping=config.tools.find(t=>t.name===tool.name)!;
            const name=`cairn_tool_${tool.name}`;
            const inputSchema=publicInputSchema(tool.inputSchema,mapping) as Record<string,unknown>;
            this.validators.set(name,new AjvJsonSchemaValidator().getValidator(inputSchema));
            this.dynamic.push({name,description:`${tool.description??tool.name}\nCairn captures evidence and enforces this task's budget.${tool.role==='submit'?' The saved validated report is injected automatically; inspect the existing receipt before retrying.':''}`,inputSchema,role:tool.role});
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
        const {session_id,...goal}=parsed;
        if(goal.profile==='emergency'){
          await this.list();
          if(!this.catalogStatus.ok)throw new CairnError('upstream_unavailable',`Cannot start a strict task while upstream tools are unavailable: ${this.catalogStatus.error}`);
        }
        const task=this.engine.create(session,{...goal,criteria:goal.criteria??[goal.goal]});
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
    const observation=await this.gateway.call(task.id,session,name.slice('cairn_tool_'.length),checked.data as Record<string,unknown>,signal);
    const saved=this.engine.store.get(task.id),index=saved.observations.findIndex(o=>o.id===observation.id);
    return {evidence:{ref:`E${index+1}`,observationId:observation.id,resultRef:observation.resultRef,status:observation.status,scope:observation.scope,eligible:observation.eligible},result:observation.output,delivery:saved.delivery?{recorded:true}:undefined};
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
    if(view==='details'){
      const {observations,...details}=task;
      const serialized=JSON.stringify({...details,evidenceCount:observations.length}),limit=input.limit??16384;
      return {taskId:task.id,revision:task.revision,encoding:'json',chunk:serialized.slice(offset,offset+limit),offset,totalCharacters:serialized.length,nextOffset:offset+limit<serialized.length?offset+limit:undefined};
    }
    if(view==='evidence') {
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
