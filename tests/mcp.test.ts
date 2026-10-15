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
const config=gatewaySchema.parse({servers:{fixture:{command:process.execPath,args:[resolve('tests/fixtures/upstream.mjs')]}},tools:['read','submit','receipt','slow'].map(name=>({name,server:'fixture',upstream:name,role:name==='submit'?'submit':name==='receipt'?'receipt':'read',resultRefPath:'result_ref',reportPath:name==='submit'?'report':undefined,receiptPath:['submit','receipt'].includes(name)?'receipt':undefined,scopePaths:{teamId:'team_id',roundId:'round_id',issueId:'issue_id'}}))});
test('stdio MCP full lifecycle and cross-CLI restoration via real client transport',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cairn-mcp-')),db=join(dir,'state.db');
 const client=new Client({name:'integration',version:'1'});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/cairn.mjs'),'mcp','--db',db,'--host','claude','--session-id','session1'],stderr:'pipe'}));
 const call=async(name:string,args:any)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return (result.structuredContent as any).result;};
 try{
  assert.equal((await client.listTools()).tools.length,16);
  const task=await call('cairn_create',{origin:'alert',goal:'cause',criteria:['cause']});
  const obs=await call('cairn_evidence',{task_id:task.id,manual:{tool:'fixture',input:{},output:'measured'}});
  const claim=await call('cairn_claim',{task_id:task.id,text:'cause',status:'supported',supports:[obs.id]});
  await call('cairn_satisfy',{task_id:task.id,criterion_id:'c1',claim_ids:[claim.id]});
  await call('cairn_report',{task_id:task.id,report:{summary:'cause',citations:[{observationId:obs.id,statement:'measurement'}]}});
  const other=new Client({name:'codex-test',version:'1'});await other.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/cairn.mjs'),'mcp','--db',db,'--host','codex','--session-id','session2'],stderr:'pipe'}));
  try{
   const resumed=await other.callTool({name:'cairn_resume',arguments:{task_id:task.id,takeover:true}});assert.ok(!resumed.isError);
   const stale=await client.callTool({name:'cairn_complete',arguments:{task_id:task.id}});assert.equal(stale.isError,true);
   const finished=await other.callTool({name:'cairn_complete',arguments:{task_id:task.id}});assert.ok(!finished.isError,JSON.stringify(finished));
  }finally{await other.close();}
 }finally{await client.close();rmSync(dir,{recursive:true});}
});
test('gateway records real upstream refs, rejects unknown tools and failed results',async()=>{
 const store=new Store(':memory:'),engine=new Engine(store),session:Session={host:'pi',sessionId:'p',cwd:'/w'};
 store.setConfig('gateway',config);const task=engine.create(session,{origin:'a',goal:'b',criteria:['c']});const gateway=new Gateway(engine);
 assert.equal((await gateway.list()).length,4);await assert.rejects(gateway.call(task.id,session,'not-allowed',{}),/whitelist/);
 const observation=await gateway.call(task.id,session,'read',{});assert.equal(observation.resultRef,'ref-read');assert.equal(observation.source,'gateway');assert.equal(observation.scope.roundId,'round');
 const failure=await gateway.call(task.id,session,'read',{fail:true});assert.equal(failure.status,'error');
 assert.throws(()=>engine.claim(task.id,session,{text:'bad',status:'supported',supports:[failure.id],refutes:[]}),/failed/);store.close();
});
test('submission gates prevent ambiguous and concurrent retries; cancellation propagates',async()=>{
 const store=new Store(':memory:'),engine=new Engine(store),session:Session={host:'pi',sessionId:'p',cwd:'/w'};store.setConfig('gateway',config);
 const task=engine.create(session,{origin:'a',goal:'b',criteria:['c']}),gateway=new Gateway(engine);
 await assert.rejects(gateway.call(task.id,session,'submit',{}),/validation/);
 const obs=await gateway.call(task.id,session,'read',{}),claim=engine.claim(task.id,session,{text:'cause',status:'supported',supports:[obs.id],refutes:[]});engine.satisfy(task.id,session,'c1',[claim.id]);engine.report(task.id,session,{summary:'cause',citations:[{observationId:obs.id,statement:'metric'}]});
 await gateway.call(task.id,session,'submit',{});assert.ok(store.get(task.id).delivery);await assert.rejects(gateway.call(task.id,session,'submit',{}),/receipt already/);
 const controller=new AbortController();const slow=gateway.call(task.id,session,'slow',{},controller.signal);setTimeout(()=>controller.abort(),100);await assert.rejects(slow);
 assert.equal(store.get(task.id).observations.at(-1)?.status,'error');assert.ok(!Object.values(store.get(task.id).calls).some(c=>c.status==='running'));store.close();
});
test('lost submission receipt is reconciled without resubmitting the external write',async()=>{
 const store=new Store(':memory:'),engine=new Engine(store),session:Session={host:'pi',sessionId:'p',cwd:'/w'};
 const cfg=structuredClone(config);cfg.tools.find(t=>t.name==='submit')!.receiptPath='missing_receipt';store.setConfig('gateway',cfg);
 const task=engine.create(session,{origin:'a',goal:'b',criteria:['c']}),gateway=new Gateway(engine),obs=await gateway.call(task.id,session,'read',{});
 const claim=engine.claim(task.id,session,{text:'cause',status:'supported',supports:[obs.id],refutes:[]});engine.satisfy(task.id,session,'c1',[claim.id]);engine.report(task.id,session,{summary:'cause',citations:[{observationId:obs.id,statement:'measured'}]});
 await assert.rejects(gateway.call(task.id,session,'submit',{}),/reconcile/);await assert.rejects(gateway.call(task.id,session,'submit',{}),/prior submission/);
 const receipt=await gateway.call(task.id,session,'receipt',{});engine.delivery(task.id,session,`submission:${task.id}`,receipt.id);assert.ok(store.get(task.id).delivery);
 const submitted=store.get(task.id).observations.find(o=>o.tool==='submit')!;assert.deepEqual((submitted.input as any).report,store.get(task.id).report);store.close();
});
