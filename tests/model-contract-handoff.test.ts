import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AjvJsonSchemaValidator} from '@modelcontextprotocol/sdk/validation/ajv';
import {createHarness,type Session} from '../src/index.js';
import {coreCatalog} from '../src/tools.js';

const session:Session={host:'pi',sessionId:'model-owner',cwd:'/workspace'};
const fact={key:'fact',text:'Input A produced the recorded result',status:'supported',basis:'Checked the original input',covers:[]} as const;
const finding=()=>({...fact,covers:[] as string[]});

test('model catalog and enforcement narrow finish while preserving SDK compatibility',async()=>{
 const schema=coreCatalog().find(t=>t.name==='cairn_finish')!.inputSchema;
 assert.deepEqual(Object.keys(schema.properties as object),['outcome','summary']);
 const validate=new AjvJsonSchemaValidator().getValidator(schema);
 assert.equal(validate({}).valid,true);assert.equal(validate({findings:[]}).valid,false);
 const h=createHarness({database:':memory:',session});try{
  await h.tools.invokeModel('cairn_start',{goal:'Return a result'});
  await assert.rejects(h.tools.invokeModel('cairn_finish',{summary:'Result',basis:'Source'}),/checkpoint/);
  assert.equal((await h.tools.invoke('cairn_finish',{summary:'Result',basis:'Legacy SDK source'}) as any).phase,'completed');
 }finally{await h.close();}
});

test('model checkpoint rejects summary-only and never implicitly covers a criterion',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invokeModel('cairn_start',{goal:'Return a result'}) as any;
  await assert.rejects(h.tools.invokeModel('cairn_checkpoint',{summary:'Still investigating'}),/not an increment/);
  await assert.rejects(h.tools.invokeModel('cairn_checkpoint',{findings:[{key:'f',text:'Observation',status:'supported',basis:'Source'}]}),/covers/);
  const receipt=await h.tools.invokeModel('cairn_checkpoint',{findings:[finding()]}) as any;
  assert.deepEqual(receipt.delta.addedFindings,['fact']);assert.equal(receipt.coverage.covered,0);
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'incomplete');
  await h.tools.invokeModel('cairn_checkpoint',{findings:[{...finding(),covers:['c1']}]});
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'completed');
  assert.equal(h.engine.store.get(task.taskId).claims.length,1);
 }finally{await h.close();}
});

test('model fact retries are idempotent despite cosmetic summaries; revisions remain explicit',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invokeModel('cairn_start',{goal:'Return a result'}) as any;
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding()]});const before=h.engine.store.get(task.taskId);
  const retry=await h.tools.invokeModel('cairn_checkpoint',{summary:'A different status sentence',findings:[finding()]}) as any;
  assert.deepEqual(retry.delta.addedFindings,[]);assert.deepEqual(retry.delta.revisedFindings,[]);assert.equal(retry.delta.stateChanged,false);
  assert.equal(h.engine.store.get(task.taskId).revision,before.revision);assert.equal(h.engine.store.get(task.taskId).handoffs?.length,before.handoffs?.length);
  const changed=await h.tools.invokeModel('cairn_checkpoint',{findings:[{...finding(),status:'refuted',basis:'Same input failed in the required environment'}]}) as any;
  assert.deepEqual(changed.delta.revisedFindings,['fact']);assert.equal(h.engine.store.get(task.taskId).claims[0]?.history?.length,1);
 }finally{await h.close();}
});

test('automatic handoff survives lost session with immutable candidate, old owner and report',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cairn-auto-handoff-')),s={...session,cwd:dir},db=join(dir,'state.db');
 let h=createHarness({database:db,session:s});
 try{
  const task=await h.tools.invokeModel('cairn_start',{goal:'Return a result'}) as any;
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding()],questions:['Does B reproduce?'],next:'Test B'});
  const saved=h.engine.store.get(task.taskId).handoffs!.at(-1)!;const content=readFileSync(saved.report!,'utf8');
  assert.equal(saved.source?.sessionId,s.sessionId);assert.equal(saved.source?.state,'saved');assert.match(saved.source!.candidate,/^[a-f0-9]{64}$/);assert.match(content,/Does B reproduce/);
  await h.close();const next={...s,sessionId:'replacement'};h=createHarness({database:db,session:next});
  await h.tools.invokeModel('cairn_resume',{task_id:task.taskId,takeover:true});
  assert.equal(readFileSync(saved.report!,'utf8'),content);assert.equal(h.engine.store.get(task.taskId).handoffs!.find(v=>v.id===saved.id)!.source?.epoch,1);
  const context=await h.tools.invokeModel('cairn_read',{view:'context',focus:'fact'}) as any;
  assert.equal(context.owner.epoch,2);assert.ok(context.handoffs.some((v:any)=>v.source?.sessionId===s.sessionId));assert.ok(!context.handoffs.some((v:any)=>v.detail));assert.ok(Buffer.byteLength(JSON.stringify(context))<=16384);
 }finally{await h.close();rmSync(dir,{recursive:true,force:true});}
});

test('handoff detail stays durable when a report projection cannot be written',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cairn-handoff-failure-'));writeFileSync(join(dir,'handoffs'),'occupied');
 const h=createHarness({database:join(dir,'state.db'),session:{...session,cwd:dir}});
 try{
  const task=await h.tools.invokeModel('cairn_start',{goal:'Preserve unavailable evidence'}) as any;
  await h.tools.invokeModel('cairn_checkpoint',{questions:['Missing source'],next:'Ask for source'});
  const saved=h.engine.store.get(task.taskId).handoffs!.at(-1)!;assert.equal(saved.report,undefined);assert.match(saved.projectionError!,/saved in SQLite/);assert.match(saved.detail!,/Missing source/);
  const read=await h.tools.invokeModel('cairn_read',{view:'handoffs',ref:saved.id}) as any;assert.match(JSON.parse(read.chunk).detail,/Ask for source/);
 }finally{await h.close();rmSync(dir,{recursive:true,force:true});}
});

test('worker auto handoff binds branch author and generation without promoting facts',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invokeModel('cairn_start',{goal:'Return a result',progress:[{key:'compare',title:'Compare B',status:'pending',delegated:true}]}) as any;
  const worker={...session,sessionId:'branch-worker'},lease=h.engine.branch(task.taskId,worker,'compare','claim');
  h.engine.branch(task.taskId,worker,'compare','checkpoint',lease.leaseToken,{summary:'B compared',findings:[{key:'b',text:'B behaved differently',status:'proposed',basis:'Recorded comparison',covers:[]}]});
  const saved=h.engine.store.get(task.taskId),handoff=saved.handoffs!.at(-1)!;
  assert.equal(handoff.source?.branchKey,'compare');assert.equal(handoff.source?.sessionId,worker.sessionId);assert.equal(saved.claims[0]?.status,'proposed');assert.equal(saved.criteria[0]?.claimIds.length,0);
  const count=saved.handoffs!.length;h.engine.resume(task.taskId,{...session,sessionId:'new-owner'},true);
  assert.throws(()=>h.engine.branch(task.taskId,worker,'compare','checkpoint',lease.leaseToken,{summary:'Late'}),/lease/);
  assert.equal(h.engine.store.get(task.taskId).handoffs!.length,count+1);
 }finally{await h.close();}
});

test('automatic handoff never changes acceptance proof or advertises receiver acknowledgement',async()=>{
 let calls=0;const h=createHarness({database:':memory:',session,completionVerifier:{id:'check',verify:()=>{calls++;return {ok:true,scope:'Candidate contract'};}}});
 try{
  const task=await h.tools.invokeModel('cairn_start',{goal:'Return a result'}) as any;
  await h.tools.invokeModel('cairn_checkpoint',{findings:[{...finding(),covers:['c1']}]});
  const result=await h.tools.invokeModel('cairn_finish',{}) as any;assert.equal(result.phase,'completed');assert.equal(result.verification.current,true);assert.equal(calls,1);
  const saved=h.engine.store.get(task.taskId),handoff=saved.handoffs!.at(-1)!;assert.equal(handoff.source?.candidate,saved.verification?.proof);assert.equal(handoff.source?.state,'saved');assert.match(handoff.detail!,/No receiver/);
 }finally{await h.close();}
});
