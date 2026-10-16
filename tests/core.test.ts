import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import type { Session, Report } from '../src/core/types.js';
const s:Session={host:'pi',sessionId:'s1',cwd:'/workspace'};
function setup(){const store=new Store(':memory:'),engine=new Engine(store),task=engine.create(s,{origin:'Alert',goal:'Diagnose',criteria:['Identify cause']});return {store,engine,task};}
function evidence(engine:Engine,taskId:string,session=s,extra:Record<string,unknown>={}){return engine.observe(taskId,session,{callId:'read1',tool:'metrics',input:{},output:{value:1},source:'hook',status:'success',...extra});}
function solve(engine:Engine,taskId:string,session=s){const o=evidence(engine,taskId,session),c=engine.claim(taskId,session,{text:'Backlog increased',status:'supported',supports:[o.id],refutes:[]});engine.satisfy(taskId,session,'c1',[c.id]);const report:Report={summary:'Backlog increased',citations:[{observationId:o.id,statement:'Metric confirms backlog'}]};engine.report(taskId,session,report);return {o,c,report};}
test('complete requires supported criteria and cited evidence',()=>{
 const {store,engine,task}=setup();assert.equal(engine.check(task.id).ok,false);assert.throws(()=>engine.complete(task.id,s),/report/i);
 solve(engine,task.id);assert.equal(engine.check(task.id).ok,true);engine.complete(task.id,s);assert.equal(store.get(task.id).status,'completed');
 engine.hint(task.id,s,'again','user');assert.equal(store.get(task.id).status,'completed');assert.equal(store.get(task.id).review!.pending.length,1);store.close();
});
test('manual registration cannot claim another task evidence and empty support is rejected',()=>{
 const {store,engine,task}=setup();assert.throws(()=>engine.claim(task.id,s,{text:'guess',status:'supported',supports:[],refutes:[]}),/need supporting/);
 assert.throws(()=>engine.claim(task.id,s,{text:'guess',status:'supported',supports:['unknown'],refutes:[]}),/missing/);store.close();
});
test('contradictory evidence invalidates an earlier satisfied criterion',()=>{
 const {store,engine,task}=setup(),{o,c}=solve(engine,task.id);
 engine.claim(task.id,s,{id:c.id,text:c.text,status:'refuted',supports:[],refutes:[o.id]});assert.equal(engine.check(task.id).ok,false);
 assert.throws(()=>engine.complete(task.id,s),/Criterion/);assert.equal(store.events(task.id).filter(e=>e.kind==='claim.revised').length,2);store.close();
});
test('reports cannot cite unrelated evidence while omitting the evidence for completion',()=>{
 const {store,engine,task}=setup();solve(engine,task.id);const o=evidence(engine,task.id,s,{callId:'unrelated'});
 assert.equal(engine.validateReport(task.id,{summary:'report',citations:[{observationId:o.id,statement:'unrelated'}]}).ok,false);store.close();
});
test('takeover fences the old CLI and keeps late results ineligible',()=>{
 const {store,engine,task}=setup(),newSession:Session={host:'codex',sessionId:'s2',cwd:'/workspace'};
 assert.throws(()=>engine.resume(task.id,newSession),/takeover/);engine.resume(task.id,newSession,true);
 assert.throws(()=>engine.checkpoint(task.id,s,{summary:'stale owner'}),/no longer owns/);
 const late=evidence(engine,task.id,s);assert.equal(late.eligible,false);
 assert.throws(()=>engine.claim(task.id,newSession,{text:'late',status:'supported',supports:[late.id],refutes:[]}),/late/);
 assert.equal(store.get(task.id).owner.epoch,2);store.close();
});
test('duplicate events return their original immutable observation',()=>{
 const {store,engine,task}=setup();const first=evidence(engine,task.id),second=evidence(engine,task.id,s,{output:'different'});
 assert.equal(first.id,second.id);assert.deepEqual(second.output,{value:1});assert.equal(store.get(task.id).observations.length,1);store.close();
});
test('error, empty successful result and healthy result retain different semantics',()=>{
 const {store,engine,task}=setup();const failed=evidence(engine,task.id,s,{status:'error'});
 assert.throws(()=>engine.claim(task.id,s,{text:'healthy',status:'supported',supports:[failed.id],refutes:[]}),/failed/);
 const empty=evidence(engine,task.id,s,{callId:'empty',output:[]});assert.deepEqual(empty.output,[]);assert.equal(empty.status,'success');store.close();
});
test('scope coverage is enforced',()=>{
 const {store,engine,task}=setup(),o=evidence(engine,task.id,s,{scope:{environment:'r1'}});
 assert.throws(()=>engine.claim(task.id,s,{text:'other round',status:'supported',supports:[o.id],refutes:[],scope:{environment:'r2'}}),/scope/);store.close();
});
test('parallel and total call budgets are reserved atomically',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),task=engine.create(s,{origin:'a',goal:'b',criteria:['c'],budget:{maxParallel:1,maxCalls:2}});
 engine.beforeTool(task.id,s,'one','read');assert.throws(()=>engine.beforeTool(task.id,s,'two','read'),/parallel/);
 evidence(engine,task.id,s,{callId:'one'});engine.beforeTool(task.id,s,'two','read');evidence(engine,task.id,s,{callId:'two'});
 assert.throws(()=>engine.beforeTool(task.id,s,'three','read'),/budget/);store.close();
});
test('out-of-order parallel results converge without losing a reservation',()=>{
 const {store,engine,task}=setup();engine.beforeTool(task.id,s,'first','a');engine.beforeTool(task.id,s,'second','b');
 evidence(engine,task.id,s,{callId:'second'});assert.equal(engine.check(task.id).issues.includes('Tool calls are still running'),true);
 evidence(engine,task.id,s,{callId:'first'});assert.equal(Object.values(store.get(task.id).calls).filter(c=>c.status==='finished').length,2);store.close();
});
test('deadline blocks calls and makes late results ineligible',()=>{
 const store=new Store(':memory:');let clock=new Date('2026-10-15T01:00:00Z');const engine=new Engine(store,()=>clock),task=engine.create(s,{origin:'a',goal:'b',criteria:['c'],budget:{deadline:'2026-10-15T01:01:00Z'}});
 engine.beforeTool(task.id,s,'one','read');clock=new Date('2026-10-15T01:02:00Z');assert.throws(()=>engine.beforeTool(task.id,s,'two','read'),/deadline/);
 assert.equal(evidence(engine,task.id,s,{callId:'one'}).eligible,false);store.close();
});
test('interruption saves progress and bounded continuation never loops indefinitely',()=>{
 const {store,engine,task}=setup();assert.ok(engine.continuation(task.id,s));assert.equal(engine.continuation(task.id,s),undefined);
 engine.hint(task.id,s,'direction','user');assert.ok(engine.continuation(task.id,s));engine.hint(task.id,s,'again','user');assert.equal(engine.continuation(task.id,s),undefined);
 engine.suspend(task.id,s);assert.equal(engine.continuation(task.id,s),undefined);assert.equal(evidence(engine,task.id).eligible,false);store.close();
});
test('database restart preserves current state and complete audit history',()=>{
 const dir=mkdtempSync(join(tmpdir(),'cairn-restart-')),path=join(dir,'state.db');let store=new Store(path),engine=new Engine(store);
 const task=engine.create(s,{origin:'a',goal:'b',criteria:['c']});solve(engine,task.id);const count=store.events(task.id).length;store.close();
 if(process.platform!=='win32')assert.equal(statSync(path).mode&0o777,0o600);
 store=new Store(path);engine=new Engine(store);assert.equal(engine.active(s)?.id,task.id);assert.equal(engine.check(task.id).ok,true);assert.equal(store.events(task.id).length,count);store.close();rmSync(dir,{recursive:true});
});
