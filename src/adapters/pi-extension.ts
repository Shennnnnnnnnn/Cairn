import { Type } from '@sinclair/typebox';
import { z } from 'zod';
import { Store } from '../core/store.js';
import { Engine } from '../core/engine.js';
import { definitions, invoke } from '../tools.js';
import { database } from '../paths.js';
import { handleNative, normalize } from './hooks.js';

// The adapter uses Pi's documented structural extension interface. Core imports no host SDK.
export default function cairn(pi:any){
 let store:Store|undefined,engine:Engine|undefined;
 const session=(ctx:any)=>({host:'pi' as const,sessionId:ctx.sessionManager.getSessionId(),cwd:ctx.cwd});
 const ensure=(ctx:any)=>{if(!engine){store=new Store(database(ctx.cwd));engine=new Engine(store);}return engine;};
 const dispatch=(event:any,ctx:any)=>handleNative(ensure(ctx),'pi',normalize('pi',{...event,...session(ctx)}));
 pi.on('session_start',(event:any,ctx:any)=>{dispatch(event,ctx);});
 pi.on('tool_call',(event:any,ctx:any)=>{const result=dispatch(event,ctx);if(result.deny)return {block:true,reason:result.deny};});
 pi.on('tool_result',(event:any,ctx:any)=>{
  const result=dispatch(event,ctx);
  if(result.context)return {content:[...event.content,{type:'text',text:result.context}],structuredContent:event.structuredContent};
 });
 pi.on('before_agent_start',(_event:any,ctx:any)=>{
  const e=ensure(ctx),s=session(ctx),task=e.active(s);
  return {message:{customType:'cairn-context',content:task?JSON.stringify(e.context(task.id)):'Cairn native tools are bound to this Pi session automatically. Omit session_id in Cairn tool arguments.',display:false}};
 });
 pi.on('agent_before_settle',(event:any,ctx:any)=>{
  const result=dispatch(event,ctx);
  if(result.continue)return {continue:true,entries:[{type:'custom_message',customType:'cairn-check',content:result.continue,display:false}]};
 });
 pi.on('agent_settled',(event:any,ctx:any)=>{dispatch(event,ctx);});
 pi.on('session_shutdown',()=>{store?.close();engine=undefined;store=undefined;});
 // Tool definitions use the exact same schemas and implementation as stdio MCP.
 // Create a temporary in-memory engine only to obtain definitions, without filesystem effects.
 const catalogStore=new Store(':memory:'),catalog=definitions(new Engine(catalogStore));catalogStore.close();
 for(const tool of catalog){
  const jsonSchema=z.toJSONSchema(tool.schema);delete (jsonSchema as any).$schema;
  delete (jsonSchema as any).properties?.session_id;
  pi.registerTool({name:tool.name,label:tool.name,description:tool.description,parameters:Type.Unsafe(jsonSchema),
   execute:async(_callId:string,input:any,signal:any,_update:any,ctx:any)=>{
    try{const result=await invoke(ensure(ctx),session(ctx),tool.name,input,signal);return {content:[{type:'text',text:JSON.stringify(result??{ok:true})}],details:result};}
    catch(error){throw new Error(`Cairn: ${(error as Error).message}`);}
   }});
 }
 pi.registerCommand('cairn',{description:'Show Cairn task state or resume a task with /cairn resume <task-id> [takeover]',handler:async(args:string,ctx:any)=>{
  const e=ensure(ctx),s=session(ctx),parts=args.trim().split(/\s+/);
  if(parts[0]==='resume'&&parts[1])e.resume(parts[1],s,parts[2]==='takeover');
  const task=e.active(s);ctx.ui.notify(task?JSON.stringify(e.context(task.id)):JSON.stringify(e.store.list()),'info');
 }});
}
