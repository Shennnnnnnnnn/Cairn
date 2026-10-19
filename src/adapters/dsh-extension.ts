import {randomUUID} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import registerNativeAdapter from './pi-extension.js';

type Handler=(event:any,context:any)=>any;
const message=(text:string)=>({id:randomUUID(),role:'user',source:{kind:'cairn'},content:[{type:'text',text}]});
const json=(value:unknown)=>JSON.parse(JSON.stringify(value??null));

/** DSH's public Cordis/tool/session interface; no DSH SDK enters Cairn's core. */
export function createDshPort(ctx:any,agent:any){
 const handlers=new Map<string,Handler[]>(),disposers=new Map<string,()=>void>();
 let turn:number|undefined,ended=false,lastReason:string|undefined;
 const context=()=>({cwd:ctx.workingDirectory.get(agent.session),sessionManager:{getSessionId:()=>agent.session.id},ui:{notify:(text:string)=>ctx.logger?.warn?.(text)}});
 const emit=async(type:string,event:any={})=>{
  const outputs=[];for(const handle of handlers.get(type)??[])outputs.push(await handle({type,...event},context()));return outputs;
 };
 const port={
  on(name:string,handle:Handler){handlers.set(name,[...(handlers.get(name)??[]),handle]);},
  registerTool(tool:any){
   disposers.get(tool.name)?.();
   if(tool.exposure==='hidden'){disposers.delete(tool.name);return;}
   const parameters=structuredClone(tool.parameters);delete parameters.$schema;
   const dispose=agent.ctx.tools.register({name:tool.name,description:tool.description,parameters,
    output:{schema:{},render:(_args:unknown,value:unknown)=>[{type:'text',text:JSON.stringify(value)}]},
    execute:async(input:unknown,exec:any)=>{
     const args=tool.prepareArguments?await tool.prepareArguments(input):input;
     const result=await tool.execute(exec.callId,args,exec.signal,undefined,context());
     return json(result?.details??result);
    }});
   disposers.set(tool.name,dispose);
  },
  // /cairn is a Pi UI command. DSH uses the same six native tools instead.
  registerCommand(){},
  sendMessage(value:any){if(value?.content)agent.inject(message(value.content));},
  async start(){await emit('session_start');},
  async close(){if(ended)return;ended=true;await emit('session_shutdown');for(const dispose of disposers.values())dispose();disposers.clear();},
 };
 agent.ctx.on('agent/pre-step',async(payload:any,next:()=>Promise<any>)=>{
  const decision=await next();if(decision.kind!=='enter'||payload.turn===turn)return decision;
  turn=payload.turn;
  const outputs=await emit('before_agent_start');
  const contexts=outputs.flatMap(output=>output?.message?.content?[message(output.message.content)]:[]);
  return {...decision,messages:[...decision.messages,...contexts]};
 });
 agent.ctx.on('tools/pre-execute',async(exec:any,next:()=>Promise<any>)=>{
  const outputs=await emit('tool_call',{toolCallId:exec.callId,toolName:exec.name,input:exec.arguments});
  const blocked=outputs.find(output=>output?.block);
  return blocked?{kind:'deny',reason:blocked.reason??'Cairn rejected this call'}:next();
 });
 // The observer sees the final outcome, including later policy rejection.
 // Injected context is non-waking and enters the next admitted step.
 agent.ctx.on('tools/result',(exec:any,result:any)=>{
  const event={type:'tool_result',toolCallId:exec.callId,toolName:exec.name,input:exec.arguments,content:result.content??[],structuredContent:result.isError?undefined:result.value,isError:!!result.isError};
  for(const handle of handlers.get('tool_result')??[]){
   const output=handle(event,context());
   if(output?.content){const additions=output.content.slice(event.content.length).filter((part:any)=>part.type==='text').map((part:any)=>part.text).join('\n');if(additions)agent.inject(message(additions));}
  }
 });
 agent.ctx.on('session/event',(_session:any,event:any)=>{
  if(event.type==='assistant/message'||event.type==='assistant/attempt'){
   const data=event.data,usage=data.usage;
   const content=(data.message?.content??[]).map((part:any)=>part.type==='tool-call'?{type:'toolCall',name:part.name,id:part.id,arguments:part.arguments}:part);
   const sample={role:'assistant',timestamp:event.seq,provider:agent.options?.provider??'dsh',model:agent.options?.model??'dsh',content,
    ...(usage?{usage:{input:usage.inputTokens,output:usage.outputTokens,cacheRead:usage.cacheReadTokens,cacheWrite:usage.cacheWriteTokens,reasoning:usage.reasoningTokens}}:{}),
    ...(event.type==='assistant/attempt'||data.interrupted?{errorMessage:'Native DSH attempt has incomplete usage'}:{})};
   for(const handle of handlers.get('message_end')??[])handle({type:'message_end',message:sample},context());
  }
  if(event.type==='turn/end')lastReason=typeof event.data.reason==='string'?event.data.reason:event.data.reason?.kind;
 });
 agent.ctx.on('agent/turn-stopping',async(payload:any)=>{
  if(payload.signal.aborted)return;
  for(const output of await emit('agent_before_settle'))if(output?.continue){
   for(const entry of output.entries??[])if(entry.content)agent.steer(message(entry.content));
  }
 });
 agent.ctx.on('agent/status',async(payload:any)=>{
  if(payload.status==='idle')await emit('agent_settled',{aborted:lastReason!==undefined&&lastReason!=='completed'});
 });
 agent.ctx.on('agent/disposed',()=>port.close());
 ctx.on('dispose',()=>port.close());
 return port;
}

export const name='cairn';
export const inject=['agents','tools','sessions','workingDirectory'];
export function apply(ctx:any,config:{includeSkill?:boolean}={}){
 ctx.on('agent/created',async({agent,source}:any)=>{
  const port=createDshPort(ctx,agent);
  registerNativeAdapter(port,{host:'dsh'});
  await port.start();
  const skill=fileURLToPath(new URL('../skills/cairn/SKILL.md',import.meta.url));
  if(config.includeSkill!==false&&existsSync(skill))agent.inject(message(readFileSync(skill,'utf8')));
  if(source==='compact')port.sendMessage({content:'Native context was compacted. Read the bound Cairn goal for saved facts, unresolved questions and handoffs before continuing.'});
 });
 // Headless can create its first agent while later entries are still mounting.
 // Its optional overlay dependency admits work only after our listener exists.
 ctx.provide('cairnReady',true);
}
export default {name,inject,apply};
