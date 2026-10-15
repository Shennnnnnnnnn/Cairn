import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Store} from '../src/core/store.js';
import {Engine} from '../src/core/engine.js';
import {Gateway,gatewaySchema} from '../src/gateway.js';
import type {Session} from '../src/core/types.js';
import {handleNative} from '../src/adapters/hooks.js';
const config=gatewaySchema.parse({servers:{fixture:{command:process.execPath,args:[resolve('tests/fixtures/upstream.mjs')]}},tools:['read','submit','receipt','slow'].map(name=>({name,server:'fixture',upstream:name,role:name==='submit'?'submit':name==='receipt'?'receipt':'read',resultRefPath:'result_ref',reportPath:name==='submit'?'report':undefined,receiptPath:['submit','receipt'].includes(name)?'receipt':undefined,scopePaths:{teamId:'team_id',roundId:'round_id',issueId:'issue_id'}}))});
test('five-tool MCP lifecycle binds once, captures native evidence, and restores across CLIs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cairn-mcp-')),db=join(dir,'state.db');
 const local=new Store(db),engine=new Engine(local),session:Session={host:'claude',sessionId:'session1',cwd:'/workspace'};
 handleNative(engine,'claude',{type:'SessionStart',sessionId:session.sessionId,cwd:session.cwd});
 const client=new Client({name:'integration',version:'1'});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/cairn.mjs'),'mcp','--db',db,'--host','claude','--root',session.cwd],stderr:'pipe'}));
 const call=async(name:string,args:any)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return (result.structuredContent as any).result;};
 try{
  const tools=(await client.listTools()).tools;
  assert.deepEqual(tools.map(t=>t.name),['cairn_start','cairn_resume','cairn_read','cairn_checkpoint','cairn_finish']);
  assert.ok(!(tools.find(t=>t.name==='cairn_finish')!.inputSchema.properties as any).session_id);
  const context=await call('cairn_start',{session_id:session.sessionId,goal:'Verify native marker'}),taskId=context.taskId;
  handleNative(engine,'claude',{type:'PreToolUse',sessionId:session.sessionId,cwd:session.cwd,callId:'read1',tool:'Read',input:{path:'evidence.txt'}});
  handleNative(engine,'claude',{type:'PostToolUse',sessionId:session.sessionId,cwd:session.cwd,callId:'read1',tool:'Read',output:{text:'native marker'}});
  await call('cairn_finish',{outcome:'suspended',summary:'Marker read; awaiting reviewer',findings:[{key:'marker',text:'The native file contains the marker',evidence:['E1']}]});
  const original=local.get(taskId);assert.equal(original.status,'suspended');assert.equal(original.report!.citations.length,1);
  const other=new Client({name:'codex-test',version:'1'});
  await other.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/cairn.mjs'),'mcp','--db',db,'--host','codex','--root','/workspace'],stderr:'pipe'}));
  try{
   const refused=await other.callTool({name:'cairn_resume',arguments:{task_id:taskId,session_id:'session2'}});assert.equal(refused.isError,true);
   const resumed=await other.callTool({name:'cairn_resume',arguments:{task_id:taskId,session_id:'session2',takeover:true}});assert.ok(!resumed.isError);
   const stale=await client.callTool({name:'cairn_finish',arguments:{}});assert.equal(stale.isError,true);
   const finished=await other.callTool({name:'cairn_finish',arguments:{}});assert.ok(!finished.isError,JSON.stringify(finished));
   assert.equal(local.get(taskId).status,'completed');
   const retry=await other.callTool({name:'cairn_finish',arguments:{}});assert.ok(!retry.isError);assert.equal(local.get(taskId).revision,(retry.structuredContent as any).result.revision);
  }finally{await other.close();}
 }finally{await client.close();local.close();rmSync(dir,{recursive:true});}
});
test('gateway records real upstream refs, rejects unknown tools and failed results',async(t)=>{
 const store=new Store(':memory:'),engine=new Engine(store),session:Session={host:'pi',sessionId:'p',cwd:'/w'};
 store.setConfig('gateway',config);const task=engine.create(session,{origin:'a',goal:'b',criteria:['c']});const gateway=new Gateway(engine);t.after(async()=>{await gateway.close();store.close();});
 assert.equal((await gateway.list()).length,4);await assert.rejects(gateway.call(task.id,session,'not-allowed',{}),/whitelist/);
 const observation=await gateway.call(task.id,session,'read',{});assert.equal(observation.resultRef,'ref-read');assert.equal(observation.source,'gateway');assert.equal(observation.scope.roundId,'round');
 const failure=await gateway.call(task.id,session,'read',{fail:true});assert.equal(failure.status,'error');
 assert.throws(()=>engine.claim(task.id,session,{text:'bad',status:'supported',supports:[failure.id],refutes:[]}),/failed/);
});
test('submission gates prevent ambiguous and concurrent retries; cancellation propagates',async(t)=>{
 const store=new Store(':memory:'),engine=new Engine(store),session:Session={host:'pi',sessionId:'p',cwd:'/w'};store.setConfig('gateway',config);
 const task=engine.create(session,{origin:'a',goal:'b',criteria:['c']}),gateway=new Gateway(engine);t.after(async()=>{await gateway.close();store.close();});
 await assert.rejects(gateway.call(task.id,session,'submit',{}),/validation/);
 const obs=await gateway.call(task.id,session,'read',{}),claim=engine.claim(task.id,session,{text:'cause',status:'supported',supports:[obs.id],refutes:[]});engine.satisfy(task.id,session,'c1',[claim.id]);engine.report(task.id,session,{summary:'cause',citations:[{observationId:obs.id,statement:'metric'}]});
 await gateway.call(task.id,session,'submit',{});assert.ok(store.get(task.id).delivery);await assert.rejects(gateway.call(task.id,session,'submit',{}),/receipt already/);
 const controller=new AbortController();const slow=gateway.call(task.id,session,'slow',{},controller.signal);setTimeout(()=>controller.abort(),100);await assert.rejects(slow);
 assert.equal(store.get(task.id).observations.at(-1)?.status,'error');assert.ok(!Object.values(store.get(task.id).calls).some(c=>c.status==='running'));
});
test('lost submission receipt is reconciled without resubmitting the external write',async(t)=>{
 const store=new Store(':memory:'),engine=new Engine(store),session:Session={host:'pi',sessionId:'p',cwd:'/w'};
 const cfg=structuredClone(config);cfg.tools.find(t=>t.name==='submit')!.receiptPath='missing_receipt';store.setConfig('gateway',cfg);
 const task=engine.create(session,{origin:'a',goal:'b',criteria:['c']}),gateway=new Gateway(engine);t.after(async()=>{await gateway.close();store.close();});const obs=await gateway.call(task.id,session,'read',{});
 const claim=engine.claim(task.id,session,{text:'cause',status:'supported',supports:[obs.id],refutes:[]});engine.satisfy(task.id,session,'c1',[claim.id]);engine.report(task.id,session,{summary:'cause',citations:[{observationId:obs.id,statement:'measured'}]});
 await assert.rejects(gateway.call(task.id,session,'submit',{}),/reconcile/);await assert.rejects(gateway.call(task.id,session,'submit',{}),/prior submission/);
 const receipt=await gateway.call(task.id,session,'receipt',{});engine.delivery(task.id,session,`submission:${task.id}`,receipt.id);assert.ok(store.get(task.id).delivery);
 const submitted=store.get(task.id).observations.find(o=>o.tool==='submit')!;assert.deepEqual((submitted.input as any).report,store.get(task.id).report);
});
