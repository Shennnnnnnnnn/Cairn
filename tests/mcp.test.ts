import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {Store} from '../src/core/store.js';
import {Engine} from '../src/core/engine.js';
import {Gateway,gatewaySchema} from '../src/gateway.js';
import type {Session} from '../src/core/types.js';
import {handleNative} from '../src/adapters/hooks.js';
const config=gatewaySchema.parse({servers:{fixture:{command:process.execPath,args:[resolve('tests/fixtures/upstream.mjs')]}},tools:['read','slow'].map(name=>({name,server:'fixture',upstream:name,resultRefPath:'result_ref',scopePaths:{workspaceId:'workspace_id',environment:'environment',issueId:'issue_id'}}))});
test('six-tool MCP lifecycle binds once, captures native evidence, and restores across CLIs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cairn-mcp-')),db=join(dir,'state.db');
 const local=new Store(db),engine=new Engine(local),session:Session={host:'claude',sessionId:'session1',cwd:dir};
 handleNative(engine,'claude',{type:'SessionStart',sessionId:session.sessionId,cwd:session.cwd});
 const client=new Client({name:'integration',version:'1'});
 await client.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/cairn.mjs'),'mcp','--db',db,'--host','claude','--root',session.cwd],stderr:'pipe'}));
 const call=async(name:string,args:any)=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return (result.structuredContent as any).result;};
 try{
  const tools=(await client.listTools()).tools;
  assert.deepEqual(tools.map(t=>t.name),['cairn_start','cairn_resume','cairn_read','cairn_update','cairn_checkpoint','cairn_finish']);
  assert.ok(tools.every(tool=>tool.annotations?.destructiveHint===false&&tool.annotations?.openWorldHint===false));
  assert.ok(!(tools.find(t=>t.name==='cairn_finish')!.inputSchema.properties as any).session_id);
  const context=await call('cairn_start',{session_id:session.sessionId,goal:'Verify native marker',evidence_mode:'captured'}),taskId=context.taskId;
  handleNative(engine,'claude',{type:'PreToolUse',sessionId:session.sessionId,cwd:session.cwd,callId:'read1',tool:'Read',input:{path:'evidence.txt'}});
  handleNative(engine,'claude',{type:'PostToolUse',sessionId:session.sessionId,cwd:session.cwd,callId:'read1',tool:'Read',output:{text:'native marker'}});
  const increment={key:'marker',text:'The native file contains the marker',status:'supported',evidence:['E1'],covers:['c1']};
  writeFileSync(join(dir,'marker.txt'),'native marker');
  const receipt=await call('cairn_checkpoint',JSON.parse(JSON.stringify({findings:[JSON.stringify(increment)],artifacts:[JSON.stringify({path:'marker.txt'})],handoffs:[JSON.stringify({key:'wire',summary:'Saved native marker',from:['marker'],artifacts:['marker.txt']})],progress:[JSON.stringify({key:'verify',title:'Verify marker',status:'completed',from:['marker']})],next:''})));
  assert.equal(local.get(taskId).artifacts![0]!.bytes,13);assert.equal(local.get(taskId).handoffs!.find(h=>h.key==='wire')!.summary,'Saved native marker');
  assert.deepEqual(receipt.delta.addedFindings,['marker']);assert.equal(receipt.coverage.covered,1);
  assert.deepEqual(local.get(taskId).claims[0]!.text,increment.text);
  await call('cairn_finish',{outcome:'suspended'});
  const original=local.get(taskId);assert.equal(original.status,'suspended');assert.equal(original.report!.citations.length,1);
  const other=new Client({name:'codex-test',version:'1'});
  await other.connect(new StdioClientTransport({command:process.execPath,args:[resolve('dist/cairn.mjs'),'mcp','--db',db,'--host','codex','--root',dir],stderr:'pipe'}));
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
 assert.equal((await gateway.list()).length,2);await assert.rejects(gateway.call(task.id,session,'not-allowed',{}),/configured/);
 const observation=await gateway.call(task.id,session,'read',{});assert.equal(observation.resultRef,'ref-read');assert.equal(observation.source,'gateway');assert.equal(observation.scope.environment,'staging');
 const failure=await gateway.call(task.id,session,'read',{fail:true});assert.equal(failure.status,'error');
 assert.throws(()=>engine.claim(task.id,session,{text:'bad',status:'supported',supports:[failure.id],refutes:[]}),/failed/);
});
