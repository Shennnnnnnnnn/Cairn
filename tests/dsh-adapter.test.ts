import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {apply} from '../src/adapters/dsh-extension.js';
import {Store} from '../src/core/store.js';

function fixture(){
 const root=mkdtempSync(join(tmpdir(),'cairn-dsh-')),previous=process.env.CAIRN_DB,database=join(root,'state.db');process.env.CAIRN_DB=database;
 const global=new Map<string,any[]>(),agents:any[]=[];
 const ctx={provide:()=>{},on:(name:string,handler:any)=>global.set(name,[...(global.get(name)??[]),handler]),workingDirectory:{get:(session:any)=>session.cwd},logger:{warn:()=>{}}};
 apply(ctx,{includeSkill:false});
 const create=async(id:string)=>{
  const tools=new Map<string,any>(),events=new Map<string,any[]>(),cwd=join(root,id);mkdirSync(cwd);
  const injected:any[]=[],steered:any[]=[];
  const agent:any={session:{id,cwd},options:{provider:'fixture',model:'fixture'},inject:(m:any)=>injected.push(m),steer:(m:any)=>steered.push(m)};
  agent.ctx={
   on:(name:string,handler:any)=>events.set(name,[...(events.get(name)??[]),handler]),
   tools:{register:(tool:any)=>{tools.set(tool.name,tool);return ()=>{if(tools.get(tool.name)===tool)tools.delete(tool.name);};}},
  };
  const emit=async(name:string,...args:any[])=>{let value:any;for(const handler of events.get(name)??[])value=await handler(...args);return value;};
  const step=(turn:number)=>emit('agent/pre-step',{agent,turn},async()=>({kind:'enter',messages:[]}));
  const assistant=(seq:number,failed=false)=>emit('session/event',agent.session,{type:failed?'assistant/attempt':'assistant/message',seq,data:failed?{stream:[]}:{message:{content:[]},usage:{inputTokens:5,outputTokens:2,cacheReadTokens:3,reasoningTokens:1}}});
  const call=async(name:string,input:any,callId=name)=>{
   const exec={agent,callId,name,arguments:input,signal:new AbortController().signal};
   const gate=await emit('tools/pre-execute',exec,async()=>({kind:'allow'}));if(gate?.kind==='deny')throw Error(gate.reason);
   const value=await tools.get(name).execute(input,exec);
   await emit('tools/result',exec,{value,content:[{type:'text',text:JSON.stringify(value)}]});return value;
  };
  for(const handle of global.get('agent/created')??[])await handle({agent,source:'startup'});
  const result={agent,tools,emit,step,assistant,call,injected,steered};agents.push(result);return result;
 };
 return {database,create,close:async()=>{for(const a of agents)await a.emit('agent/disposed',{agent:a.agent});for(const handle of global.get('dispose')??[])await handle();if(previous===undefined)delete process.env.CAIRN_DB;else process.env.CAIRN_DB=previous;rmSync(root,{recursive:true,force:true});}};
}

test('DSH uses real session identities, isolates per-agent schemas and records source-grounded completion',async()=>{
 const f=fixture();try{
  const a=await f.create('native-a'),b=await f.create('native-b');
  await a.step(1);await a.assistant(1);await a.assistant(2);
  const started=await a.call('cairn_start',{goal:'Verify a saved fact',criteria:['Fact verified'],evidence_mode:'curated'});
  const other=await b.call('cairn_start',{goal:'Keep independent work',criteria:['Unfinished'],evidence_mode:'captured'});
  assert.equal(a.tools.get('cairn_update').parameters.properties.finding.properties.evidence,undefined);
  assert.ok(b.tools.get('cairn_update').parameters.properties.finding.properties.evidence);
  await a.call('cairn_update',{finding:{key:'fact',text:'The checked fact holds',status:'supported',basis:'Independent source comparison',references:['https://example.test/source'],covers:['c1']}});
  assert.equal((await a.call('cairn_finish',{})).phase,'completed');
  await a.assistant(3);
  const store=new Store(f.database);try{
   const task=store.get(started.taskId);assert.equal(task.owner.host,'dsh');assert.equal(task.owner.sessionId,'native-a');assert.equal(task.status,'completed');
   assert.equal(task.usage!.tokens!.input,24);assert.equal(task.usage!.tokens!.output,6);assert.equal(task.usage!.modelCalls,3);
   assert.equal(store.get(other.taskId).status,'active');assert.equal(store.get(other.taskId).owner.sessionId,'native-b');
  }finally{store.close();}
 }finally{await f.close();}
});

test('DSH preserves unknown billing on failed attempts, drops earlier turns and requests saved-goal continuation',async()=>{
 const f=fixture();try{
  const a=await f.create('native');await a.step(1);await a.assistant(1);
  await a.step(2);await a.assistant(2,true);await a.assistant(3);
  const started=await a.call('cairn_start',{goal:'Finish only with verified evidence',criteria:['Verified']});
  await a.emit('agent/turn-stopping',{agent:a.agent,turn:2,signal:new AbortController().signal});
  assert.ok(a.steered.length>0);assert.ok(a.steered.every(m=>m.role==='user'&&m.source.kind==='cairn'));
  const store=new Store(f.database);try{
   const task=store.get(started.taskId);assert.equal(task.usage!.modelCalls,1);assert.equal(task.usage!.tokens!.input,8);assert.equal(task.usage!.partial,true);assert.equal(task.status,'active');
  }finally{store.close();}
 }finally{await f.close();}
});
