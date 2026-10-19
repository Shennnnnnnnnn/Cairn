import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import piExtension from '../src/adapters/pi-extension.js';
import {Store} from '../src/core/store.js';

function fixture(){
 const cwd=mkdtempSync(join(tmpdir(),'cairn-prebind-')),tools=new Map<string,any>(),handlers=new Map<string,any>();
 const ctx={cwd,sessionManager:{getSessionId:()=> 'native'},ui:{notify:()=>{}}};
 piExtension({on:(name:string,handler:any)=>handlers.set(name,handler),registerTool:(tool:any)=>tools.set(tool.name,tool),registerCommand:()=>{},sendMessage:()=>{}});
 const emit=(name:string,data:any={})=>handlers.get(name)?.({type:name,...data},ctx);
 const message=(timestamp:number,start=false)=>emit('message_end',{message:{role:'assistant',timestamp,provider:'fixture',model:'fixture',usage:{input:5,output:2,cacheRead:3,cacheWrite:0},content:start?[{type:'toolCall',name:'cairn_start'}]:[]}});
 const bind=async()=>{const response=await tools.get('cairn_start').execute('start',{goal:'Verify complete native turn usage'},undefined,undefined,ctx);await emit('tool_result',{toolName:'cairn_start',toolCallId:'start',isError:false,content:response.content});return response.details.taskId;};
 return {cwd,emit,message,bind,close:async()=>{await emit('session_shutdown');rmSync(cwd,{recursive:true,force:true});}};
}
test('Pi counts numeric messages before binding in the current turn exactly once',async()=>{
 const f=fixture();
 try{
  await f.emit('session_start');await f.emit('before_agent_start');
  await f.message(1);await f.message(2);await f.message(2);await f.message(3,true);
  const id=await f.bind(),store=new Store(join(f.cwd,'.cairn/state.db'));
  try{const usage=store.get(id).usage!;assert.equal(usage.modelCalls,3);assert.equal(usage.tokens!.input,24);assert.equal(usage.tokens!.output,6);assert.equal(usage.tokens!.cacheRead,9);}
  finally{store.close();}
 }finally{await f.close();}
});
test('Pi never transfers an earlier ordinary turn into a later goal',async()=>{
 const f=fixture();
 try{
  await f.emit('session_start');await f.emit('before_agent_start');await f.message(1);
  await f.emit('before_agent_start');await f.message(2);await f.message(3,true);
  const id=await f.bind(),store=new Store(join(f.cwd,'.cairn/state.db'));
  try{assert.equal(store.get(id).usage!.modelCalls,2);assert.equal(store.get(id).usage!.tokens!.input,16);}
  finally{store.close();}
 }finally{await f.close();}
});

test('a model error marks reported token usage as incomplete instead of implying zero billing',async()=>{
 const f=fixture();
 try{
  await f.emit('session_start');await f.emit('before_agent_start');await f.message(1,true);const id=await f.bind();
  await f.emit('message_end',{message:{role:'assistant',timestamp:2,provider:'fixture',model:'fixture',errorMessage:'Connection error',usage:{input:0,output:0,cacheRead:0,cacheWrite:0},content:[]}});
  const store=new Store(join(f.cwd,'.cairn/state.db'));try{assert.equal(store.get(id).usage!.partial,true);assert.equal(store.get(id).usage!.tokens!.input,8);}finally{store.close();}
 }finally{await f.close();}
});
