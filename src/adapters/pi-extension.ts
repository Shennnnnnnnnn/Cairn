import { Type } from '@sinclair/typebox';
import { Store } from '../core/store.js';
import { Engine } from '../core/engine.js';
import { ToolRuntime, coreCatalog, prepareModelInput, type ToolDefinition } from '../tools.js';
import type { TokenUsage } from '../core/types.js';
import { database } from '../paths.js';
import { handleNative, normalize } from './hooks.js';
import { tokenUsage, incompleteUsage } from '../core/usage.js';
import { piTokens } from './usage.js';
import { hostOptions } from './host-options.js';

// The adapter uses Pi's documented structural extension interface. Core imports no host SDK.
export default function cairn(pi:any,options:{host?:'pi'|'dsh'}={}){
 const host=options.host??'pi';
 const resources=new Map<string,{store:Store;engine:Engine;runtimes:Map<string,ToolRuntime>}>();
 const registered=new Map<string,any>();
 const injectedContext=new Map<string,string>();
 const usageBindings=new Map<string,{taskId:string;epoch:number}>();
 const pendingUsage=new Map<string,{id:string;tokens:TokenUsage;partial:boolean}[]>();
 const pendingPartial=new Set<string>();
 const usageSession=(ctx:any)=>JSON.stringify([database(ctx.cwd),ctx.sessionManager.getSessionId(),ctx.cwd]);
 let catalogIdentity:string|undefined;
 const session=(ctx:any)=>({host,sessionId:ctx.sessionManager.getSessionId(),cwd:ctx.cwd});
 const ensure=(ctx:any)=>{
  const path=database(ctx.cwd);let resource=resources.get(path);
  if(!resource){const store=new Store(path);resource={store,engine:new Engine(store,undefined,hostOptions()),runtimes:new Map()};resources.set(path,resource);}
  return resource;
 };
 const runtime=(ctx:any)=>{
  const resource=ensure(ctx),s=session(ctx),key=JSON.stringify([s.sessionId,s.cwd]);let value=resource.runtimes.get(key);
  if(!value){value=new ToolRuntime(resource.engine,s);resource.runtimes.set(key,value);}return value;
 };
 const dispatch=(event:any,ctx:any)=>handleNative(ensure(ctx).engine,host,normalize('pi',{...event,...session(ctx)}));
 const register=(tool:ToolDefinition)=>{
  const inputSchema=structuredClone(tool.inputSchema) as any;
  delete inputSchema.$schema;delete inputSchema.properties?.session_id;
  if(Array.isArray(inputSchema.required))inputSchema.required=inputSchema.required.filter((name:string)=>name!=='session_id');
  const definition={name:tool.name,label:tool.name,description:tool.description,parameters:Type.Unsafe(inputSchema),
   // Pi validates before execute; normalize the wire encoding at its documented
   // preparation boundary too. The advertised and enforced schema stays strict.
   prepareArguments:(input:unknown)=>prepareModelInput(tool.name,input),
   execute:async(_callId:string,input:any,signal:any,_update:any,ctx:any)=>{
    // Each invocation uses its actual Pi context, including after /new or /resume.
    try{const result=await runtime(ctx).invokeModel(tool.name,input,signal);if(['cairn_start','cairn_resume'].includes(tool.name))await refresh(ctx,true);return {content:[{type:'text',text:JSON.stringify(result??{ok:true})}],details:result};}
    catch(error){throw new Error(`Cairn: ${(error as Error).message}`);}
   }};
  registered.set(tool.name,definition);pi.registerTool(definition);
 };
 const refresh=async(ctx:any,force=false)=>{
  const resource=ensure(ctx),s=session(ctx),task=resource.engine.active(s),identity=JSON.stringify([database(ctx.cwd),s.sessionId,task?.id,task?.evidenceMode,resource.store.config('gateway')]);
  const instance=runtime(ctx);if(!force&&catalogIdentity===identity&&instance.catalogStatus.ok)return;
  const catalog=await instance.list(),active=new Set(catalog.map(t=>t.name));
  for(const [name,definition]of registered)if(!active.has(name))pi.registerTool({...definition,exposure:'hidden'});
  for(const tool of catalog)register(tool);
  catalogIdentity=identity;
  if(!instance.catalogStatus.ok)ctx.ui.notify(`Cairn upstream tools unavailable: ${instance.catalogStatus.error}. Goal, evidence and recovery tools remain available.`,'warning');
 };
 // Register the six local tools without opening databases or upstream processes.
 for(const tool of coreCatalog())register(tool);
 pi.on('session_start',async(event:any,ctx:any)=>{dispatch(event,ctx);await refresh(ctx,true);});
 pi.on('message_end',(event:any,ctx:any)=>{
  const message=event.message,usage=message?.role==='assistant'?piTokens(message.usage):undefined;
  if(message?.role==='assistant'&&message.errorMessage&&!usage){
   const key=usageSession(ctx);
   if(usageBindings.has(key))incompleteUsage(ensure(ctx).engine,session(ctx));else pendingPartial.add(key);
  }
  if(!usage||typeof message.timestamp!=='number')return;
  const key=usageSession(ctx),id=`message:${message.timestamp}:${message.provider??''}:${message.model??''}`;
  // One native turn can read instructions and inputs before starting its goal.
  // Retain numeric samples only, then bind them when start/resume succeeds.
  const binding=usageBindings.get(key),active=ensure(ctx).engine.active(session(ctx));
  const partial=!!message.errorMessage;
  if(message.content?.some((part:any)=>part.type==='toolCall'&&['cairn_start','cairn_resume'].includes(part.name))||!binding&&active?.status!=='active'){
   pendingUsage.set(key,[...(pendingUsage.get(key)??[]),{id,tokens:usage,partial}]);return;
  }
  tokenUsage(ensure(ctx).engine,session(ctx),id,usage,{modelCall:true,binding,partial});
 });
 pi.on('tool_call',(event:any,ctx:any)=>{const result=dispatch(event,ctx);if(result.deny)return {block:true,reason:result.deny};});
 pi.on('tool_result',(event:any,ctx:any)=>{
  const result=dispatch(event,ctx);
  if(['cairn_start','cairn_resume'].includes(event.toolName)){
   const key=usageSession(ctx),pending=pendingUsage.get(key);
   const task=ensure(ctx).engine.active(session(ctx));
   if(!event.isError&&task?.status==='active'){
    const binding={taskId:task.id,epoch:task.owner.epoch};usageBindings.set(key,binding);
    if(pendingPartial.delete(key))incompleteUsage(ensure(ctx).engine,session(ctx));
    pendingUsage.delete(key);
    for(const sample of pending??[])tokenUsage(ensure(ctx).engine,session(ctx),sample.id,sample.tokens,{modelCall:true,binding,partial:sample.partial});
   }
  }
  if(result.context)return {content:[...event.content,{type:'text',text:result.context}],structuredContent:event.structuredContent};
 });
 pi.on('before_agent_start',async(_event:any,ctx:any)=>{
  await refresh(ctx);
  const e=ensure(ctx).engine,s=session(ctx),task=e.active(s);
  if(task)e.recordExecution(task.id,s,'running');
  const owns=task&&task.owner.host===s.host&&task.owner.sessionId===s.sessionId&&e.store.session(s)?.epoch===task.owner.epoch;
  usageBindings.delete(usageSession(ctx));pendingUsage.delete(usageSession(ctx));pendingPartial.delete(usageSession(ctx));
  if(owns&&task.status==='active')usageBindings.set(usageSession(ctx),{taskId:task.id,epoch:task.owner.epoch});
  const key=JSON.stringify([database(ctx.cwd),s.sessionId,s.cwd]),revision=JSON.stringify([task?.id,task?.revision,task?.status,task?.owner.epoch]);
  if(injectedContext.get(key)===revision)return;
  injectedContext.set(key,revision);
  const guidance=!task?'Cairn is available. Use cairn_start to bind a goal; native session identity is automatic, so omit session_id.':task.status==='completed'?'The previous goal is completed. Explicit cairn_resume reopen={reason} can continue it when authorized; cairn_start creates a different goal.':!owns?`This task belongs to another session. Explicitly cairn_resume task_id=${task.id} with takeover=true before changing it.`:task.status==='suspended'?`This task is suspended; explicitly cairn_resume task_id=${task.id} before continuing.`:'Saved Cairn state follows. Use cairn_read for omitted details.';
  return {message:{customType:'cairn-context',content:task?`${guidance}\n${JSON.stringify(e.context(task.id))}`:guidance,display:false}};
 });
 pi.on('session_before_compact',(event:any,ctx:any)=>{const result=dispatch(event,ctx);if(result.context)pi.sendMessage({customType:'cairn-conclude',content:result.context,display:false},{triggerTurn:false});});
 pi.on('session_compact',(event:any,ctx:any)=>{
  const result=dispatch(event,ctx);
  const s=session(ctx);injectedContext.delete(JSON.stringify([database(ctx.cwd),s.sessionId,s.cwd]));
  if(result.context)pi.sendMessage({customType:'cairn-context',content:result.context,display:false},{triggerTurn:false});
 });
 pi.on('agent_before_settle',(event:any,ctx:any)=>{
  const result=dispatch(event,ctx);
  if(result.continue)return {continue:true,entries:[{type:'custom_message',customType:'cairn-check',content:result.continue,display:false}]};
 });
 pi.on('agent_settled',(event:any,ctx:any)=>{dispatch(event,ctx);});
 pi.on('session_shutdown',async(event:any,ctx:any)=>{
  if(resources.has(database(ctx.cwd)))dispatch(event,ctx);
  await Promise.allSettled([...resources.values()].flatMap(resource=>[...resource.runtimes.values()].map(instance=>instance.close())));
  for(const resource of resources.values())resource.store.close();resources.clear();injectedContext.clear();usageBindings.clear();pendingUsage.clear();pendingPartial.clear();catalogIdentity=undefined;
 });
 pi.registerCommand('cairn',{description:'Show Cairn task state or resume a task with /cairn resume <task-id> [takeover]',handler:async(args:string,ctx:any)=>{
  const e=ensure(ctx).engine,s=session(ctx),parts=args.trim().split(/\s+/);
  if(parts[0]==='resume'&&parts[1])e.resume(parts[1],s,parts[2]==='takeover');
  const task=e.active(s);ctx.ui.notify(task?JSON.stringify(e.context(task.id)):JSON.stringify(e.store.list()),'info');
 }});
}
