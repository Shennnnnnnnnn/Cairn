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
 assert.throws(()=>engine.hint(task.id,s,'again','user'),/completed/);store.close();
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
 assert.throws(()=>engine.hint(task.id,s,'old','user'),/no longer owns/);
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
 const {store,engine,task}=setup(),o=evidence(engine,task.id,s,{scope:{roundId:'r1'}});
 assert.throws(()=>engine.claim(task.id,s,{text:'other round',status:'supported',supports:[o.id],refutes:[],scope:{roundId:'r2'}}),/scope/);store.close();
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
test('report and completion evidence are frozen while a submission is in flight',()=>{
 const {store,engine,task}=setup();const {report}=solve(engine,task.id);store.setConfig('gateway',{tools:[{name:'submit',role:'submit'}]});
 engine.beforeTool(task.id,s,'submit','submit',true);assert.throws(()=>engine.report(task.id,s,report),/frozen/);assert.throws(()=>engine.beforeTool(task.id,s,'submit2','submit',true),/in flight|running/);store.close();
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
test('emergency profile refuses missing integration, whitelist and scope',()=>{
 const store=new Store(':memory:'),engine=new Engine(store),input={origin:'a',goal:'b',criteria:['c'],profile:'emergency' as const,scope:{teamId:'t',roundId:'r1',issueId:'i',matchId:'m'}};
 assert.throws(()=>engine.create(s,input),/native capture/);
 store.register(s,{capture:true,preTool:true,restore:true,stop:true});assert.throws(()=>engine.create(s,input),/whitelist/);store.close();
});
test('emergency rounds share a match deadline and require automatic refs and human confirmation',()=>{
 const store=new Store(':memory:');let clock=new Date('2026-10-15T01:00:00Z');const engine=new Engine(store,()=>clock);
 store.register(s,{capture:true,preTool:true,restore:true,stop:true});store.setConfig('gateway',{tools:[{name:'submit',role:'submit'}]});
 const task=engine.create(s,{origin:'a',goal:'b',criteria:['c'],profile:'emergency',scope:{teamId:'t',roundId:'r1',issueId:'i1',matchId:'m'}});
 const manual=evidence(engine,task.id,s,{source:'manual',resultRef:'fake'});assert.throws(()=>engine.claim(task.id,s,{text:'x',status:'supported',supports:[manual.id],refutes:[]}),/automatically/);
 const o=evidence(engine,task.id,s,{callId:'real',resultRef:'ref-real'}),c=engine.claim(task.id,s,{text:'cause',status:'supported',supports:[o.id],refutes:[]});engine.satisfy(task.id,s,'c1',[c.id]);
 const report:Report={summary:'cause',citations:[{observationId:o.id,resultRef:'ref-real',statement:'proves cause'}],impact:{text:'all records queried',scope:task.scope,observationIds:[o.id]},rootCause:{text:'cause',level:'root'},solution:{mitigation:'route to healthy reader',fix:'correct mapping',prevention:'mapping checks'}};
 assert.equal(engine.validateReport(task.id,{...report,citations:[{...report.citations[0]!,resultRef:'forged'}]}).ok,false);
 engine.report(task.id,s,report);assert.throws(()=>engine.complete(task.id,s),/confirmation/);
 const receipt=evidence(engine,task.id,s,{callId:'submit',tool:'submit',resultRef:'receipt',receipt:'accepted',output:{receipt:'accepted'}});engine.delivery(task.id,s,'delivery',receipt.id);
 assert.throws(()=>engine.complete(task.id,s),/confirmation/);engine.confirm(task.id);engine.complete(task.id,s);
 clock=new Date('2026-10-15T01:10:00Z');const next=engine.create(s,{origin:'next',goal:'next',criteria:['c'],profile:'emergency',scope:{teamId:'t',roundId:'r2',issueId:'i2',matchId:'m'}});
 assert.equal(next.budget.deadline,task.budget.deadline);assert.equal(next.budget.deadline,'2026-10-15T01:30:00.000Z');store.close();
});
