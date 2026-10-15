import { Engine } from '../core/engine.js';
import { CairnError, type Session, type Host, type Capabilities } from '../core/types.js';
import { structuredResult, valueAt, type GatewayConfig } from '../gateway.js';
export const nativeCapabilities:Capabilities={capture:true,preTool:true,restore:true,stop:true};
export interface NativeEvent { type:string; sessionId:string; cwd:string; callId?:string; tool?:string; input?:unknown; output?:unknown; isError?:boolean; aborted?:boolean; stopHookActive?:boolean }
export function normalize(host:Host,event:any):NativeEvent{
 if(host==='pi')return {type:({session_start:'SessionStart',tool_call:'PreToolUse',tool_result:'PostToolUse',session_compact:'PostCompact',session_shutdown:'SessionEnd',agent_before_settle:'Stop',agent_settled:'Settled'} as Record<string,string>)[event.type]??event.type,
  sessionId:event.sessionId,cwd:event.cwd,callId:event.toolCallId,tool:event.toolName,input:event.input,
  output:event.structuredContent?{structuredContent:event.structuredContent,content:event.content}: {content:event.content,details:event.details},isError:event.isError,aborted:event.aborted??event.outcome==='aborted'};
 return {type:event.hook_event_name,sessionId:event.session_id,cwd:event.cwd,callId:event.tool_use_id,tool:event.tool_name,input:event.tool_input,output:event.tool_response??{error:event.error},isError:event.hook_event_name==='PostToolUseFailure'||event.tool_response?.isError===true||event.tool_response?.is_error===true,stopHookActive:event.stop_hook_active};
}
export function handleNative(engine:Engine,host:Host,event:NativeEvent):{context?:string;deny?:string;continue?:string}{
 if(!event.sessionId||!event.cwd)throw new CairnError('invalid_event','Host event needs session id and cwd');
 const session:Session={host,sessionId:event.sessionId,cwd:event.cwd};
 engine.store.register(session,event.type==='SessionStart'?nativeCapabilities:undefined,event.type,engine.at());
 const task=engine.active(session);
 const marker=`Cairn host=${host} session_id=${session.sessionId}. Supply this session_id to Cairn MCP tools. Cairn is enabled only after creating or resuming a task.`;
 if(event.type==='SessionStart')return {context:task?`${marker}\n${JSON.stringify(engine.context(task.id))}`:marker};
 if(!task)return {};
 if(event.type==='Interrupt'||event.type==='Settled'&&event.aborted){try{engine.suspend(task.id,session);}catch{}return {};}
 if(event.type==='PostCompact'||event.type==='PreCompact'||event.type==='RestoreContext')return {context:JSON.stringify(engine.context(task.id))};
 if(event.type==='Stop')return event.aborted||event.stopHookActive?{}:{continue:engine.continuation(task.id,session)};
 if(!event.tool||event.tool.includes('cairn_'))return {};
 const callId=`${host}:${event.sessionId}:${event.callId??''}`;
 if(!event.callId)return {}; // Never guess a tool identity or deduplicate unrelated calls.
 if(task.status!=='active'&&!(event.type.startsWith('PostToolUse')&&task.calls[callId]?.status==='running'))return {};
 if(event.type==='PreToolUse'){
  if(task.profile==='emergency')return {deny:'Emergency profile requires diagnostic and submission calls through cairn_call using the configured platform whitelist.'};
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
  return {context:`Cairn observation ${observation.id}: ${observation.status}, eligible=${observation.eligible}. Use this id in claims and fetch original evidence with cairn_evidence.`};
 }
 return {};
}
export function hookOutput(event:NativeEvent,result:ReturnType<typeof handleNative>){
 if(result.deny)return {hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'deny',permissionDecisionReason:result.deny}};
 if(result.continue)return {decision:'block',reason:result.continue};
 if(result.context&&['SessionStart','PostToolUse','PreToolUse'].includes(event.type))return {hookSpecificOutput:{hookEventName:event.type,additionalContext:result.context}};
 // Compaction context is restored by SessionStart(compact), Pi before_agent_start,
 // and the shared skill's explicit cairn_state read; unsupported hook outputs stay empty.
 return {};
}
