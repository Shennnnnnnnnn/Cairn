import {test} from 'node:test';
import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {Store} from '../src/core/store.js';
import {Engine} from '../src/core/engine.js';
import {ToolRuntime,coreCatalog} from '../src/tools.js';
import {gatewaySchema} from '../src/gateway.js';
import type {Session} from '../src/core/types.js';
const session:Session={host:'codex',sessionId:'native',cwd:'/workspace'};
function fixture(){const store=new Store(':memory:'),engine=new Engine(store),runtime=new ToolRuntime(engine,session);return{store,engine,runtime};}
function observe(engine:Engine,taskId:string,callId='read'){return engine.observe(taskId,session,{callId,tool:'Read',input:{path:'fixture'},output:'marker',source:'hook',status:'success'});}

test('minimal start, native tool result and one finish preserve the evidence graph',async(t)=>{
 const {store,engine,runtime}=fixture();t.after(async()=>{await runtime.close();store.close();});
 const catalog=coreCatalog();assert.deepEqual(catalog.find(t=>t.name==='cairn_start')!.inputSchema.required,['goal']);assert.deepEqual(catalog.find(t=>t.name==='cairn_finish')!.inputSchema.required??[],[]);
 const started=await runtime.invoke('cairn_start',{goal:'Verify the marker'}) as any;
 observe(engine,started.taskId);
 const finished=await runtime.invoke('cairn_finish',{summary:'Marker verified',findings:[{text:'Native read returned marker',evidence:['E1']}]}) as any;
 assert.equal(finished.status,'completed');
 const task=store.get(started.taskId);assert.equal(task.criteria.length,1);assert.equal(task.criteria[0]!.claimIds[0],task.claims[0]!.id);assert.equal(task.report!.citations[0]!.observationId,task.observations[0]!.id);
 assert.equal(store.events(task.id).filter(e=>e.kind==='task.finished').length,1);
});

test('a proposed finding cannot become supported by editing its text',()=>{
 const {store,engine}=fixture(),task=engine.create(session,{origin:'test',goal:'Verify',criteria:['Verify']});observe(engine,task.id);
 engine.checkpoint(task.id,session,{summary:'Hypothesis',findings:[{key:'hypothesis',text:'May explain marker',status:'proposed',evidence:['E1'],covers:['c1']}]});
 engine.checkpoint(task.id,session,{summary:'Still a hypothesis',findings:[{key:'hypothesis',text:'Updated possible explanation'}]});
 assert.equal(store.get(task.id).claims[0]!.status,'proposed');assert.equal(engine.check(task.id).ok,false);store.close();
});

test('connections pin task identity and resuming another task requires settling the active one',async(t)=>{
 const {store,engine,runtime:first}=fixture(),second=new ToolRuntime(engine,session);t.after(async()=>{await first.close();await second.close();store.close();});
 const b=await first.invoke('cairn_start',{goal:'Task B'}) as any;
 await first.invoke('cairn_finish',{outcome:'suspended',summary:'B paused'});
 const a=await second.invoke('cairn_start',{goal:'Task A'}) as any;
 await assert.rejects(first.invoke('cairn_resume',{task_id:b.taskId}),/current task/);
 await assert.rejects(first.invoke('cairn_checkpoint',{summary:'Must not write to A'}),/different task/);
 await second.invoke('cairn_finish',{outcome:'suspended',summary:'A paused'});
 await first.invoke('cairn_resume',{task_id:b.taskId});
 await assert.rejects(second.invoke('cairn_checkpoint',{summary:'Must not write to B'}),/different task/);
 assert.equal(store.get(a.taskId).status,'suspended');assert.equal(store.get(b.taskId).status,'active');
});

test('same-session epoch changes reject late reserved results and workspace moves need takeover',()=>{
 const {store,engine}=fixture(),task=engine.create(session,{origin:'test',goal:'Verify',criteria:['Verify']});
 engine.beforeTool(task.id,session,'old-call','Read');engine.resume(task.id,session,true);
 const late=engine.observe(task.id,session,{callId:'old-call',tool:'Read',input:{},output:'late',source:'hook',status:'success'});
 assert.equal(late.eligible,false);assert.equal(late.actor.epoch,1);
 engine.beforeTool(task.id,session,'new-call','Read');const fresh=observe(engine,task.id,'new-call');assert.equal(fresh.eligible,true);assert.equal(fresh.actor.epoch,2);
 assert.throws(()=>engine.resume(task.id,{...session,cwd:'/elsewhere'}),/takeover/);
 assert.throws(()=>engine.checkpoint(task.id,{...session,cwd:'/elsewhere'},{summary:'Wrong workspace'}),/no longer owns/);store.close();
});

test('bounded recovery permits paging the complete task details, raw evidence and audit payload',async(t)=>{
 const {store,engine,runtime}=fixture();t.after(async()=>{await runtime.close();store.close();});
 const start=await runtime.invoke('cairn_start',{goal:'目标'.repeat(1500)+'GOAL_END',constraints:['限制'.repeat(800)+'CONSTRAINT_END']}) as any;
 const obs=engine.observe(start.taskId,session,{callId:'long',tool:'Read',input:{},output:'原文'.repeat(10000)+'RAW_END',source:'hook',status:'success'});
 await runtime.invoke('cairn_checkpoint',{summary:'Checkpoint',findings:[{key:'long',text:'结论'.repeat(1500)+'FINDING_END',evidence:[obs.id]}]});
 const context=await runtime.invoke('cairn_read',{}) as any;assert.ok(JSON.stringify(context).length<16000);
 let offset=0,revision:number|undefined,all='';do{const page=await runtime.invoke('cairn_read',{view:'details',offset,limit:700,revision}) as any;revision=page.revision;all+=page.chunk;offset=page.nextOffset??-1;}while(offset>=0);
 assert.ok(all.includes('GOAL_END'));assert.ok(all.includes('CONSTRAINT_END'));assert.ok(all.includes('FINDING_END'));JSON.parse(all);
 const oldRevision=revision;engine.hint(start.taskId,session,'New human input','reviewer');await assert.rejects(runtime.invoke('cairn_read',{view:'details',revision:oldRevision}),/Task changed/);
 const evidence=await runtime.invoke('cairn_read',{view:'evidence',ref:'E1',offset:19000,limit:3000}) as any;assert.ok(evidence.chunk.includes('RAW_END'));
 const event=store.events(start.taskId).find(e=>e.kind==='task.checkpoint')!;
 const history=await runtime.invoke('cairn_read',{view:'history',ref:`event:${event.seq}`,offset:2000,limit:16000}) as any;assert.ok(history.chunk.includes('FINDING_END'));
});

test('typed tools retain original parameters and concurrent catalog loads do not duplicate them',async(t)=>{
 const {store,engine,runtime}=fixture();t.after(async()=>{await runtime.close();store.close();});
 store.setConfig('gateway',gatewaySchema.parse({servers:{fixture:{command:process.execPath,args:[resolve('tests/fixtures/upstream.mjs')]}},tools:[{name:'read',server:'fixture',upstream:'read',resultRefPath:'result_ref'}]}));
 const catalogs=await Promise.all([runtime.list(),runtime.list(),runtime.list()]);
 for(const catalog of catalogs){assert.equal(catalog.length,6);assert.equal(new Set(catalog.map(t=>t.name)).size,6);const schema=catalog.at(-1)!.inputSchema;assert.ok(!('tool' in (schema.properties as any??{})));}
 const start=await runtime.invoke('cairn_start',{goal:'Read the configured fixture'}) as any;
 const result=await runtime.invoke('cairn_tool_read',{}) as any;assert.equal(result.evidence.ref,'E1');assert.equal(result.evidence.resultRef,'ref-read');assert.equal(engine.store.get(start.taskId).observations.length,1);
});

test('unavailable upstream keeps the five management tools and reports actual degraded capability',async(t)=>{
 const {store,runtime}=fixture();t.after(async()=>{await runtime.close();store.close();});
 store.setConfig('gateway',gatewaySchema.parse({servers:{missing:{command:'/nonexistent/cairn-fixture'}},tools:[{name:'read',server:'missing',upstream:'read'}]}));
 const catalog=await runtime.list();assert.equal(catalog.length,5);assert.equal(runtime.catalogStatus.ok,false);
 const state=await runtime.invoke('cairn_read',{view:'tasks'}) as any;assert.equal(state.upstream.ok,false);
 await assert.rejects(runtime.invoke('cairn_start',{goal:'Strict task',profile:'emergency',scope:{teamId:'t',roundId:'r',issueId:'i',matchId:'m'}}),/upstream tools are unavailable/);
});

test('legacy reservations without an execution epoch stay audit-only after takeover',()=>{
 const {store,engine}=fixture(),task=engine.create(session,{origin:'legacy',goal:'Verify',criteria:['Verify']});
 engine.beforeTool(task.id,session,'legacy-call','Read');
 const legacy=store.get(task.id);delete legacy.calls['legacy-call']!.epoch;store.save(legacy,'legacy.fixture',{},engine.at());
 engine.resume(task.id,session,true);
 const result=engine.observe(task.id,session,{callId:'legacy-call',tool:'Read',input:{},output:'old result',source:'hook',status:'success'});
 assert.equal(result.eligible,false);assert.equal(result.actor.epoch,0);store.close();
});

test('a persisted 1.x-style task without checkpoints resumes with its existing claims and report',async(t)=>{
 const {store,engine}=fixture(),task=engine.create(session,{origin:'legacy',goal:'Verify',criteria:['Verify']});const obs=observe(engine,task.id);
 const claim=engine.claim(task.id,session,{text:'Marker verified',status:'supported',supports:[obs.id],refutes:[]});engine.satisfy(task.id,session,'c1',[claim.id]);
 engine.report(task.id,session,{summary:'Original 1.x report',citations:[{observationId:obs.id,statement:'Native read returned marker'}]});engine.suspend(task.id,session);
 const before=store.get(task.id);assert.equal(before.checkpoint,undefined);
 const next:Session={host:'claude',sessionId:'upgraded',cwd:'/workspace'},runtime=new ToolRuntime(engine,next);t.after(async()=>{await runtime.close();store.close();});
 await runtime.invoke('cairn_resume',{task_id:task.id,takeover:true});const result=await runtime.invoke('cairn_finish',{}) as any;
 assert.equal(result.status,'completed');assert.deepEqual(store.get(task.id).report,before.report);assert.equal(store.get(task.id).claims[0]!.id,claim.id);
});
