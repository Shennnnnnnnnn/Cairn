import { z } from 'zod';
import { Engine } from './core/engine.js';
import { Gateway } from './gateway.js';
import { CairnError, type Session, type Report } from './core/types.js';

const text=z.string().trim().min(1), scope=z.object({workspaceId:text.optional(),issueId:text.optional(),teamId:text.optional(),roundId:text.optional(),matchId:text.optional()});
const sessionFields={session_id:text.optional()};
const taskFields={...sessionFields,task_id:text};
const citation=z.object({observationId:text,resultRef:text.optional(),statement:text});
export const reportSchema=z.object({summary:text,citations:z.array(citation),impact:z.object({text,scope,observationIds:z.array(text)}).optional(),rootCause:z.object({text,level:z.enum(['symptom','service','code','root']),trigger:text.optional(),amplification:text.optional()}).optional(),solution:z.object({mitigation:text,fix:text,prevention:text}).optional()});
export type ToolDefinition={name:string;description:string;schema:z.ZodObject<any>;run:(input:any,session:Session,signal?:AbortSignal)=>unknown|Promise<unknown>};
export function definitions(engine:Engine):ToolDefinition[]{
 const gateway=new Gateway(engine);
 return [
  {name:'cairn_create',description:'Enable Cairn for this session: create a goal with explicit completion criteria. Use the host session_id supplied by the Cairn startup hook.',schema:z.object({...sessionFields,origin:text,goal:text,constraints:z.array(text).default([]),criteria:z.array(text).min(1),profile:z.enum(['general','emergency']).default('general'),scope:scope.optional(),budget:z.object({deadline:z.iso.datetime().optional(),maxCalls:z.number().int().positive().optional(),maxParallel:z.number().int().min(1).max(32).default(3),submitReserveMs:z.number().int().nonnegative().max(1800000).optional()}).optional()}),run:(i,s)=>engine.create(s,i)},
  {name:'cairn_resume',description:'Resume external task state. Set takeover=true explicitly when moving ownership to a different CLI/session.',schema:z.object({...taskFields,takeover:z.boolean().default(false)}),run:(i,s)=>engine.resume(i.task_id,s,i.takeover)},
  {name:'cairn_state',description:'Read compact goal, hypotheses, evidence index, budget and recovery context. Raw evidence is fetched separately.',schema:z.object({...sessionFields,task_id:text.optional()}),run:(i,s)=>i.task_id?engine.context(i.task_id):engine.active(s)?engine.context(engine.active(s)!.id):{tasks:engine.store.list()}},
  {name:'cairn_evidence',description:'Read an original observation. Manual registration is labelled manual and is ineligible as competition evidence.',schema:z.object({...taskFields,observation_id:text.optional(),manual:z.object({tool:text,input:z.unknown(),output:z.unknown(),resultRef:text.optional(),status:z.enum(['success','error']).default('success')}).optional()}).refine(i=>!!i.observation_id!==!!i.manual,'Provide observation_id or manual') as any,run:(i,s)=>{
    if(i.manual)return engine.observe(i.task_id,s,{...i.manual,callId:`manual:${crypto.randomUUID()}`,source:'manual'});
    const o=engine.store.get(i.task_id).observations.find(o=>o.id===i.observation_id);if(!o)throw new CairnError('not_found','Observation not found');return o;
  }},
  {name:'cairn_claim',description:'Create or revise an evidence-backed claim; distinguish proposed, supported, refuted and inconclusive. Supported claims require eligible observations.',schema:z.object({...taskFields,id:text.optional(),text,status:z.enum(['proposed','supported','refuted','inconclusive']),supports:z.array(text).default([]),refutes:z.array(text).default([]),scope:scope.optional()}),run:(i,s)=>{const {task_id,session_id,...claim}=i;return engine.claim(task_id,s,claim);}},
  {name:'cairn_satisfy',description:'Associate supported claims with a completion criterion; this does not itself complete the task.',schema:z.object({...taskFields,criterion_id:text,claim_ids:z.array(text)}),run:(i,s)=>engine.satisfy(i.task_id,s,i.criterion_id,i.claim_ids)},
  {name:'cairn_action',description:'Track a meaningful action with its purpose, stopping condition and results; avoid logging every thought.',schema:z.object({...taskFields,id:text.optional(),purpose:text,stopCondition:text,status:z.enum(['planned','running','completed','failed','cancelled']),observationIds:z.array(text).default([])}),run:(i,s)=>{const {task_id,session_id,...action}=i;return engine.action(task_id,s,action);}},
  {name:'cairn_hint',description:'Record human background with authorship; hints are not tool evidence.',schema:z.object({...taskFields,text,author:text}),run:(i,s)=>engine.hint(i.task_id,s,i.text,i.author)},
  {name:'cairn_check',description:'Check which goal criteria remain unsupported and whether any tool calls are still in flight.',schema:z.object(taskFields),run:i=>engine.check(i.task_id)},
  {name:'cairn_report',description:'Save a draft and validate citations, scope and goal coverage. Emergency reports need impact, causal level and mitigation/fix/prevention.',schema:z.object({...taskFields,report:reportSchema}),run:(i,s)=>engine.report(i.task_id,s,i.report as Report)},
  {name:'cairn_complete',description:'Complete only after the saved report passes the core checks. Emergency completion also needs the real submission receipt and human team confirmation.',schema:z.object(taskFields),run:(i,s)=>engine.complete(i.task_id,s)},
  {name:'cairn_suspend',description:'Save incomplete progress and stop continuation suggestions. Use for missing evidence, interruption or exhaustion.',schema:z.object(taskFields),run:(i,s)=>engine.suspend(i.task_id,s)},
  {name:'cairn_delivery',description:'Reconcile delivery using a real captured observation. Inspect existing delivery before any retry; never fabricate a receipt.',schema:z.object({...taskFields,key:text,observation_id:text}),run:(i,s)=>engine.delivery(i.task_id,s,i.key,i.observation_id)},
  {name:'cairn_events',description:'Read append-only audit events since a sequence number.',schema:z.object({...taskFields,after:z.number().int().nonnegative().default(0)}),run:i=>engine.store.events(i.task_id,i.after)},
  {name:'cairn_tools',description:'Discover only configured upstream whitelist tools and their original input schemas.',schema:z.object(sessionFields),run:()=>gateway.list()},
  {name:'cairn_call',description:'Execute a whitelisted MCP tool with atomic budget reservation, automatic evidence capture and submission gates.',schema:z.object({...taskFields,tool:text,arguments:z.record(z.string(),z.unknown()).default({})}),run:(i,s,signal)=>gateway.call(i.task_id,s,i.tool,i.arguments,signal)}
 ];
}
export function resolveSession(base:Session,input:{session_id?:string}):Session{
 if(base.sessionId&&input.session_id&&base.sessionId!==input.session_id)throw new CairnError('session_mismatch','The native host session is authoritative; omit session_id or use the supplied host id');
 const sessionId=input.session_id??base.sessionId;
 if(!sessionId)throw new CairnError('session_required','Supply the session_id shown by the Cairn host hook, or pass --session-id when starting MCP');
 return {...base,sessionId};
}
export async function invoke(engine:Engine,base:Session,name:string,input:unknown,signal?:AbortSignal){
 const tool=definitions(engine).find(t=>t.name===name);if(!tool)throw new CairnError('unknown_tool',name);
 const parsed=tool.schema.parse(input);return tool.run(parsed,resolveSession(base,parsed),signal);
}
