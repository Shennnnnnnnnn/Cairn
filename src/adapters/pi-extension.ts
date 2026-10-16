import { Type } from '@sinclair/typebox';
import { Store } from '../core/store.js';
import { Engine } from '../core/engine.js';
import { ToolRuntime, coreCatalog, type ToolDefinition } from '../tools.js';
import { database } from '../paths.js';
import { handleNative, normalize } from './hooks.js';

// The adapter uses Pi's documented structural extension interface. Core imports no host SDK.
export default function cairn(pi:any){
 const resources=new Map<string,{store:Store;engine:Engine;runtimes:Map<string,ToolRuntime>}>();
 const registered=new Map<string,any>();
 const injectedContext=new Map<string,string>();
 let catalogIdentity:string|undefined;
 const session=(ctx:any)=>({host:'pi' as const,sessionId:ctx.sessionManager.getSessionId(),cwd:ctx.cwd});
 const ensure=(ctx:any)=>{
  const path=database(ctx.cwd);let resource=resources.get(path);
  if(!resource){const store=new Store(path);resource={store,engine:new Engine(store),runtimes:new Map()};resources.set(path,resource);}
  return resource;
 };
 const runtime=(ctx:any)=>{
  const resource=ensure(ctx),s=session(ctx),key=JSON.stringify([s.sessionId,s.cwd]);let value=resource.runtimes.get(key);
  if(!value){value=new ToolRuntime(resource.engine,s);resource.runtimes.set(key,value);}return value;
 };
 const dispatch=(event:any,ctx:any)=>handleNative(ensure(ctx).engine,'pi',normalize('pi',{...event,...session(ctx)}));
 const register=(tool:ToolDefinition)=>{
  const inputSchema=structuredClone(tool.inputSchema) as any;
  delete inputSchema.$schema;delete inputSchema.properties?.session_id;
  if(Array.isArray(inputSchema.required))inputSchema.required=inputSchema.required.filter((name:string)=>name!=='session_id');
  const definition={name:tool.name,label:tool.name,description:tool.description,parameters:Type.Unsafe(inputSchema),
   execute:async(_callId:string,input:any,signal:any,_update:any,ctx:any)=>{
    // Each invocation uses its actual Pi context, including after /new or /resume.
    try{const result=await runtime(ctx).invoke(tool.name,input,signal);return {content:[{type:'text',text:JSON.stringify(result??{ok:true})}],details:result};}
    catch(error){throw new Error(`Cairn: ${(error as Error).message}`);}
   }};
  registered.set(tool.name,definition);pi.registerTool(definition);
 };
 const refresh=async(ctx:any,force=false)=>{
  const resource=ensure(ctx),s=session(ctx),identity=JSON.stringify([database(ctx.cwd),s.sessionId,resource.store.config('gateway')]);
  const instance=runtime(ctx);if(!force&&catalogIdentity===identity&&instance.catalogStatus.ok)return;
  const catalog=await instance.list(),active=new Set(catalog.map(t=>t.name));
  for(const [name,definition]of registered)if(!active.has(name))pi.registerTool({...definition,exposure:'hidden'});
  for(const tool of catalog)register(tool);
  catalogIdentity=identity;
  if(!instance.catalogStatus.ok)ctx.ui.notify(`Cairn upstream tools unavailable: ${instance.catalogStatus.error}. Goal, evidence and recovery tools remain available.`,'warning');
 };
 // Register the five local tools without opening databases or upstream processes.
 for(const tool of coreCatalog())register(tool);
 pi.on('session_start',async(event:any,ctx:any)=>{dispatch(event,ctx);await refresh(ctx,true);});
 pi.on('tool_call',(event:any,ctx:any)=>{const result=dispatch(event,ctx);if(result.deny)return {block:true,reason:result.deny};});
 pi.on('tool_result',(event:any,ctx:any)=>{
  const result=dispatch(event,ctx);
  if(result.context)return {content:[...event.content,{type:'text',text:result.context}],structuredContent:event.structuredContent};
 });
 pi.on('before_agent_start',async(_event:any,ctx:any)=>{
  await refresh(ctx);
  const e=ensure(ctx).engine,s=session(ctx),task=e.active(s);
  const owns=task&&task.owner.host===s.host&&task.owner.sessionId===s.sessionId&&e.store.session(s)?.epoch===task.owner.epoch;
  const key=JSON.stringify([database(ctx.cwd),s.sessionId,s.cwd]),revision=JSON.stringify([task?.id,task?.revision,task?.status,task?.owner.epoch]);
  if(injectedContext.get(key)===revision)return;
  injectedContext.set(key,revision);
  const guidance=!task?'Cairn is available when useful. Start a goal with cairn_start; native session identity is automatic. General goals save your curated findings, references and progress at checkpoints without recording native tools. Omit session_id.':task.status==='completed'?'The previous goal is completed; cairn_start creates a new goal.':!owns?`This task belongs to another session. Explicitly cairn_resume task_id=${task.id} with takeover=true before changing it.`:task.status==='suspended'?`This task is suspended; explicitly cairn_resume task_id=${task.id} before continuing.`:'Continue from the saved checkpoint. Use cairn_read for evidence details when needed.';
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
  for(const resource of resources.values())resource.store.close();resources.clear();injectedContext.clear();catalogIdentity=undefined;
 });
 pi.registerCommand('cairn',{description:'Show Cairn task state or resume a task with /cairn resume <task-id> [takeover]',handler:async(args:string,ctx:any)=>{
  const e=ensure(ctx).engine,s=session(ctx),parts=args.trim().split(/\s+/);
  if(parts[0]==='resume'&&parts[1])e.resume(parts[1],s,parts[2]==='takeover');
  const task=e.active(s);ctx.ui.notify(task?JSON.stringify(e.context(task.id)):JSON.stringify(e.store.list()),'info');
 }});
}
