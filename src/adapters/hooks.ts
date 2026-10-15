import { Engine } from '../core/engine.js';
import { CairnError, type Session, type Host, type Capabilities, type ProgressInput } from '../core/types.js';
import { structuredResult, valueAt, type GatewayConfig } from '../gateway.js';
// These describe the installed adapter's integration points. They are not proof
// that a host has trusted or invoked every hook; doctor reports observations separately.
export const nativeCapabilities:Capabilities={capture:true,preTool:true,restore:true,stop:true};
export function observedCapabilities(seen:Record<string,string>):Capabilities{
 return {capture:!!(seen.PostToolUse||seen.PostToolUseFailure),preTool:!!seen.PreToolUse,restore:!!(seen.SessionStart||seen.RestoreContext||seen.PostCompact),stop:!!seen.Stop};
}
/** Only our actual host namespace is exempt from capture and strict native-tool gating. */
export function isCairnTool(host:Host,name:string){
 const local=/^cairn_(?:start|resume|read|checkpoint|finish|tool_[A-Za-z0-9_-]+)$/;
 if(host==='pi')return local.test(name);
 const prefix=host==='claude'?/^mcp__(?:plugin_cairn_cairn|cairn)__/:/^mcp__cairn__/;
 return prefix.test(name)&&local.test(name.replace(prefix,''));
}
export interface NativeEvent { type:string; sessionId:string; cwd:string; callId?:string; tool?:string; input?:unknown; output?:unknown; isError?:boolean; aborted?:boolean; stopHookActive?:boolean }
export function normalize(host:Host,event:any):NativeEvent{
 if(host==='pi')return {type:({session_start:'SessionStart',tool_call:'PreToolUse',tool_result:'PostToolUse',session_before_compact:'PreCompact',session_compact:'PostCompact',session_shutdown:'SessionEnd',agent_before_settle:'Stop',agent_settled:'Settled'} as Record<string,string>)[event.type]??event.type,
  sessionId:event.sessionId,cwd:event.cwd,callId:event.toolCallId,tool:event.toolName,input:event.input,
  output:event.structuredContent?{structuredContent:event.structuredContent,content:event.content}: {content:event.content,details:event.details},isError:event.isError,aborted:event.aborted??event.outcome==='aborted'};
 return {type:event.hook_event_name,sessionId:event.session_id,cwd:event.cwd,callId:event.tool_use_id,tool:event.tool_name,input:event.tool_input,output:event.tool_response??{error:event.error},isError:event.hook_event_name==='PostToolUseFailure'||event.tool_response?.isError===true||event.tool_response?.is_error===true,stopHookActive:event.stop_hook_active};
}
/** Only Codex's known plan contract is interpreted. The caller must already
 * possess a captured call's task/epoch association; curated hooks never use it.
 * Other hosts use checkpoint.progress. No hidden reasoning is read. */
export function nativeProgress(host:Host,event:NativeEvent):ProgressInput[]|undefined{
 if(host!=='codex'||event.tool!=='update_plan'||event.type!=='PostToolUse'||event.isError)return;
 const input=event.input as {plan?:unknown}|undefined;
 if(!input||!Array.isArray(input.plan)||input.plan.length>100)return;
 const statuses={pending:'pending',in_progress:'running',completed:'completed'} as const;
 const items:ProgressInput[]=[];
 for(const [index,value]of input.plan.entries()){
  if(!value||typeof value!=='object'||typeof value.step!=='string'||!value.step.trim()||typeof value.status!=='string'||!Object.hasOwn(statuses,value.status))return;
  items.push({key:`codex-plan-${index+1}`,title:value.step,status:statuses[value.status as keyof typeof statuses]});
 }
 return items;
}
export function handleNative(engine:Engine,host:Host,event:NativeEvent):{context?:string;deny?:string;continue?:string}{
 if(!event.sessionId||!event.cwd)throw new CairnError('invalid_event','Host event needs session id and cwd');
 const session:Session={host,sessionId:event.sessionId,cwd:event.cwd};
 engine.store.register(session,event.type==='SessionStart'?nativeCapabilities:undefined,event.type,engine.at());
 if(event.tool&&isCairnTool(host,event.tool))return {};
 const nativeCallId=event.callId?`${host}:${event.sessionId}:${event.callId}`:undefined;
 // The host may switch goals while an old native call is still returning. Its
 // persisted call id identifies the original task; the current binding does not.
 const currentTask=engine.active(session);
 const task=event.type.startsWith('PostToolUse')&&nativeCallId?engine.store.taskForCall(nativeCallId)??currentTask:currentTask;
 const marker=host==='pi'?'Cairn tools are bound to this native Pi session. Omit session_id; do not invent one.':`Cairn host=${host} session_id=${session.sessionId}. Supply this real session_id only on the first cairn_start or cairn_resume of this MCP connection; subsequent calls are already bound. Never guess a session id.`;
 if(event.type==='SessionStart'){
  if(!task)return {context:`${marker} Cairn is enabled only after starting or resuming a task.`};
  if(task.status==='completed')return {context:`${marker}\nTask ${task.id} is completed. Use cairn_read with task_id=${task.id} to inspect it, or cairn_start for a new goal.\n${JSON.stringify(engine.context(task.id))}`};
  const owns=task.owner.host===host&&task.owner.sessionId===session.sessionId&&engine.store.session(session)?.epoch===task.owner.epoch;
  const binding=host==='pi'?`Use cairn_read for this task${!owns?`; first cairn_resume task_id=${task.id} with explicit takeover=true to change the recorded owner`:task.status==='suspended'?'; explicitly cairn_resume to continue the suspended work':''}.`:`For a new MCP connection, first cairn_resume task_id=${task.id} with this session_id${owns?'':'; takeover=true is required to change the recorded owner'}. After compaction on the same connection, use cairn_read.`;
  return {context:`${marker}\n${binding}\n${JSON.stringify(engine.context(task.id))}`};
 }
 if(!task)return {};
 if(event.type==='Interrupt'||event.type==='Settled'&&event.aborted){try{engine.suspend(task.id,session);}catch{}return {};}
 if(event.type==='PostCompact'||event.type==='PreCompact'||event.type==='RestoreContext')return {context:JSON.stringify(engine.context(task.id))};
 if(event.type==='Stop')return event.aborted||event.stopHookActive?{}:{continue:engine.continuation(task.id,session)};
 if(!event.tool)return {};
 if(task.evidenceMode==='curated'){
  // Native tools remain entirely under the host's control: no call reservations,
  // budget decisions, raw inputs/results, or tool metadata are persisted.
  // A late plan result cannot be associated with its original task without call
  // metadata. Use explicit milestone progress instead of guessing that binding.
  return {};
 }
 const callId=`${host}:${event.sessionId}:${event.callId??''}`;
 if(!event.callId)return {}; // Never guess a tool identity or deduplicate unrelated calls.
 if(task.status!=='active'&&!(event.type.startsWith('PostToolUse')&&task.calls[callId]))return {};
 if(event.type==='PreToolUse'){
  if(task.profile==='emergency')return {deny:'Emergency profile requires the configured cairn_tool_* tools for investigation, submission and receipt checks. Their original argument schemas are exposed directly; native tools cannot bypass this evidence and budget boundary.'};
  if(task.observations.some(o=>o.callId===callId&&o.source==='hook'))return {deny:'This tool call already has a captured result; inspect its Cairn evidence before retrying'};
  try{const result=engine.beforeTool(task.id,session,callId,event.tool);return result.duplicate?{deny:'This tool call was already started; reconcile the existing result before retrying'}:{};}
  catch(error){return {deny:(error as Error).message};}
 }
 if(event.type==='PostToolUse'||event.type==='PostToolUseFailure'){
  const config=engine.store.config<GatewayConfig>('gateway');
  const mapping=config?.tools.find(t=>t.name===event.tool||t.upstream===event.tool);
  const structured=structuredResult(event.output);
  const ref=mapping?.resultRefPath?valueAt(structured,mapping.resultRefPath):undefined;
  const scope={...task.scope};
  for(const [key,path]of Object.entries(mapping?.scopePaths??{})){const v=valueAt(structured,path);if(typeof v==='string')(scope as any)[key]=v;}
  const observation=engine.observe(task.id,session,{callId,tool:event.tool,input:event.input??{},output:event.output??null,source:'hook',status:event.isError?'error':'success',scope,resultRef:typeof ref==='string'?ref:undefined});
  const progress=nativeProgress(host,event);
  if(progress&&task.calls[callId]?.epoch===task.owner.epoch&&currentTask?.id===task.id&&observation.eligible){
   try{engine.recordProgress(task.id,session,progress,'host',true);}catch{}
  }
  const index=engine.store.get(task.id).observations.findIndex(o=>o.id===observation.id)+1;
  if(currentTask?.id!==task.id)return {context:`Cairn result belongs to previous task ${task.id}, E${index}: ${observation.status}, eligible=${observation.eligible} for that task only. It is not evidence for the current goal.`};
  if(!observation.eligible)return {context:`Cairn audit-only result for task ${task.id}, E${index}: ${observation.status}, eligible=false. This late or interrupted result cannot support current conclusions.`};
  return {context:`Cairn E${index}: ${observation.status}, eligible=${observation.eligible}, scope=${JSON.stringify(observation.scope)}. Reference E${index} in a checkpoint or finish; use cairn_read for original evidence when needed.`};
 }
 return {};
}
export function hookOutput(event:NativeEvent,result:ReturnType<typeof handleNative>){
 if(result.deny)return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:result.deny}};
 if(result.continue)return {decision:'block',reason:result.continue};
 if(result.context&&['SessionStart','PostToolUse','PreToolUse'].includes(event.type))return {hookSpecificOutput:{hookEventName:event.type,additionalContext:result.context}};
 // Compaction context is restored by SessionStart(compact), Pi before_agent_start,
 // and cairn_read; unsupported hook outputs stay empty.
 return {};
}
