import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import type { Session, CheckpointInput } from '../src/core/types.js';

const session:Session={host:'pi',sessionId:'checkpoint-owner',cwd:'/workspace'};
function setup(criteria=['Identify the root cause']){
  const store=new Store(':memory:'),engine=new Engine(store);
  const task=engine.create(session,{origin:'user request',goal:'Diagnose price mapping',criteria});
  return {store,engine,task};
}
function observation(engine:Engine,taskId:string,callId='read',extra:Record<string,unknown>={},actor=session){
  return engine.observe(taskId,actor,{callId,tool:'read',input:{},output:{value:100},source:'hook',status:'success',...extra});
}

test('one finish records explicit findings, covers multiple goals and builds genuine citations atomically',()=>{
  const {store,engine,task}=setup(['Identify the cause','Determine affected clients']);
  const cause=observation(engine,task.id,'cause',{resultRef:'platform-cause'}),impact=observation(engine,task.id,'impact',{resultRef:'platform-impact'});
  const result=engine.finish(task.id,session,{outcome:'completed',summary:'A client mapping scales prices incorrectly',findings:[
    {key:'cause',text:'The old client multiplies the mapped price by 100',evidence:['E1'],covers:['c1']},
    {key:'impact',text:'Only clients on the old mapping are affected',evidence:['platform-impact'],covers:['Determine affected clients']},
  ]});
  assert.equal(result.status,'completed');assert.equal(result.phase,'completed');assert.equal(result.validation.ok,true);
  const saved=store.get(task.id);assert.equal(saved.claims.length,2);assert.equal(saved.report?.citations.length,2);
  assert.deepEqual(saved.report?.citations.map(c=>[c.observationId,c.resultRef,c.statement]),[
    [cause.id,'platform-cause','The old client multiplies the mapped price by 100'],
    [impact.id,'platform-impact','Only clients on the old mapping are affected'],
  ]);
  assert.equal(store.events(task.id).filter(e=>e.kind==='task.finished').length,1);store.close();
});

test('a checkpoint rolls back all findings, goal links and audit changes when a later reference is invalid',()=>{
  const {store,engine,task}=setup();observation(engine,task.id);
  const before=store.get(task.id),events=store.events(task.id).length;
  assert.throws(()=>engine.checkpoint(task.id,session,{summary:'partial',findings:[
    {key:'valid',text:'First conclusion',evidence:['E1']},
    {key:'invalid',text:'Second conclusion',evidence:['E999']},
  ]}),/does not belong/);
  assert.deepEqual(store.get(task.id),before);assert.equal(store.events(task.id).length,events);store.close();
});

test('evidence aliases are stable while forged, ambiguous, foreign and failed references cannot become findings',()=>{
  const {store,engine,task}=setup();
  const first=observation(engine,task.id,'first',{resultRef:'duplicate'});
  observation(engine,task.id,'second',{resultRef:'duplicate'});
  const failed=observation(engine,task.id,'failed',{status:'error'});
  const other:Session={host:'codex',sessionId:'other',cwd:'/workspace'};
  const foreignTask=engine.create(other,{origin:'other',goal:'other',criteria:['other']});
  const foreign=observation(engine,foreignTask.id,'foreign',{},other);
  assert.equal(engine.resolveEvidence(task.id,'E1').id,first.id);
  assert.equal(engine.resolveEvidence(task.id,'E3').id,failed.id,'Failed results remain readable');
  for(const ref of ['forged',foreign.id,'duplicate',failed.id]){
    assert.throws(()=>engine.checkpoint(task.id,session,{summary:'invalid',findings:[{text:'unsupported',evidence:[ref]}]}),/does not belong|multiple observations|failed/);
  }
  engine.checkpoint(task.id,session,{summary:'unambiguous',findings:[{text:'Explicit observation supports this finding',evidence:['E2']}]});
  assert.equal(engine.resolveEvidence(task.id,'E1').id,first.id);store.close();
});

test('stable finding keys preserve refutations and coverage until the agent explicitly resolves them',()=>{
  const {store,engine,task}=setup(['Cause','Impact']);observation(engine,task.id,'support');observation(engine,task.id,'counterexample');
  engine.checkpoint(task.id,session,{summary:'Initial',findings:[{key:'cause',text:'Mapping error',evidence:['E1'],covers:['c1']}]});
  const first=store.get(task.id).claims[0]!;
  engine.checkpoint(task.id,session,{summary:'Counterexample',findings:[{key:'cause',text:'Mapping error needs review',against:['E2']}]});
  let saved=store.get(task.id);assert.equal(saved.claims.length,1);assert.equal(saved.claims[0]!.id,first.id);assert.equal(saved.claims[0]!.status,'inconclusive');
  assert.deepEqual(saved.criteria[0]!.claimIds,[first.id]);assert.equal(engine.check(task.id).ok,false);assert.equal(saved.report?.citations.length,0);
  engine.checkpoint(task.id,session,{summary:'Still investigating',findings:[{key:'cause',text:'Mapping error needs review'}]});
  assert.deepEqual(store.get(task.id).claims[0]!.refutes,saved.claims[0]!.refutes);
  assert.throws(()=>engine.checkpoint(task.id,session,{summary:'Cannot hide counterexample',findings:[{key:'cause',text:'Mapping error',status:'supported'}]}),/unresolved refutations/);
  engine.checkpoint(task.id,session,{summary:'Counterexample explained',findings:[{key:'cause',text:'Mapping error in the old client',against:[]}]});
  assert.equal(store.get(task.id).claims[0]!.status,'inconclusive');
  engine.checkpoint(task.id,session,{summary:'Conclusion confirmed',findings:[{key:'cause',text:'Mapping error in the old client',status:'supported'}]});
  saved=store.get(task.id);assert.equal(saved.claims[0]!.status,'supported');assert.deepEqual(saved.criteria[0]!.claimIds,[first.id]);
  assert.deepEqual(engine.check(task.id).unmet,['c2']);store.close();
});

test('exact retries do not append duplicate claims or checkpoint events and completed finish is idempotent',()=>{
  const {store,engine,task}=setup();observation(engine,task.id);
  const input:CheckpointInput={summary:'Mapping confirmed',findings:[{text:'The result confirms the mapping error',evidence:['E1']}]};
  engine.checkpoint(task.id,session,input);const before=store.get(task.id),events=store.events(task.id).length;
  engine.checkpoint(task.id,session,input);assert.deepEqual(store.get(task.id),before);assert.equal(store.events(task.id).length,events);
  engine.finish(task.id,session,{outcome:'completed'});const finished=store.get(task.id),finishEvents=store.events(task.id).length;
  assert.equal(engine.finish(task.id,session,{outcome:'completed'}).phase,'completed');assert.deepEqual(store.get(task.id),finished);assert.equal(store.events(task.id).length,finishEvents);
  assert.throws(()=>engine.finish(task.id,session,{outcome:'completed',summary:'Edit the completed task'}),/immutable/);store.close();
});

test('insufficient evidence stays active and suspension saves explicit questions without fabricating conclusions',()=>{
  const {store,engine,task}=setup();
  const attempt=engine.finish(task.id,session,{outcome:'completed',summary:'No diagnostic result yet',questions:['Which mapping is deployed?']});
  assert.equal(attempt.phase,'incomplete');assert.equal(attempt.status,'active');assert.equal(attempt.validation.ok,false);assert.equal(store.get(task.id).claims.length,0);
  const suspended=engine.finish(task.id,session,{outcome:'suspended',summary:'Waiting for client version data',next:'Query the deployment manifest'});
  assert.equal(suspended.status,'suspended');assert.deepEqual(suspended.checkpoint?.questions,['Which mapping is deployed?']);assert.equal(suspended.checkpoint?.next,'Query the deployment manifest');
  assert.equal(engine.finish(task.id,session,{outcome:'suspended'}).phase,'suspended');store.close();
});

test('cross CLI takeover fences checkpoint and finish and cannot promote late evidence',()=>{
  const {store,engine,task}=setup();
  const next:Session={host:'claude',sessionId:'next-cli',cwd:'/workspace'};engine.resume(task.id,next,true);
  const late=observation(engine,task.id,'late');assert.equal(engine.resolveEvidence(task.id,'E1').eligible,false);
  assert.throws(()=>engine.checkpoint(task.id,session,{summary:'Old owner'}),/no longer owns/);
  assert.throws(()=>engine.finish(task.id,session,{outcome:'completed'}),/no longer owns/);
  assert.throws(()=>engine.checkpoint(task.id,next,{summary:'Use late result',findings:[{text:'late conclusion',evidence:[late.id]}]}),/late/);
  observation(engine,task.id,'fresh',{},next);
  const result=engine.finish(task.id,next,{outcome:'completed',summary:'Fresh result',findings:[{text:'Current owner verified the mapping',evidence:['E2']}]});
  assert.equal(result.phase,'completed');assert.equal(result.owner.epoch,2);store.close();
});

test('strict completion exposes delivery and confirmation stages and freezes receipted reports',()=>{
  const store=new Store(':memory:'),engine=new Engine(store);
  store.register(session,{capture:true,preTool:true,restore:true,stop:true});store.setConfig('gateway',{tools:[{name:'submit',role:'submit'}]});
  const task=engine.create(session,{origin:'contest',goal:'Diagnose',criteria:['Cause'],profile:'emergency',scope:{teamId:'t',roundId:'r',issueId:'i',matchId:'m'}});
  observation(engine,task.id,'cause',{resultRef:'real-cause'});
  const input:CheckpointInput={summary:'Mapping root cause',findings:[{key:'cause',text:'Incorrect mapping scales values',evidence:['E1']}],report:{
    impact:{text:'Old clients',scope:task.scope,observationIds:['E1']},rootCause:{text:'Mapping defect',level:'root'},solution:{mitigation:'Disable old route',fix:'Correct the mapping',prevention:'Contract checks'},
  }};
  assert.equal(engine.finish(task.id,session,{...input,outcome:'completed'}).phase,'ready_for_delivery');
  assert.deepEqual(store.get(task.id).report?.impact?.observationIds,[store.get(task.id).observations[0]!.id]);
  engine.beforeTool(task.id,session,'submit','submit',true);
  assert.throws(()=>engine.checkpoint(task.id,session,input),/in flight/);
  const receipt=observation(engine,task.id,'submit',{tool:'submit',resultRef:'receipt-ref',receipt:{accepted:true}});
  engine.delivery(task.id,session,'delivery-1',receipt.id);
  assert.equal(engine.finish(task.id,session,{outcome:'completed'}).phase,'awaiting_confirmation');
  const delivered=store.get(task.id);assert.throws(()=>engine.checkpoint(task.id,session,{summary:'Changed conclusion'}),/frozen/);
  assert.throws(()=>engine.report(task.id,session,{...delivered.report!,summary:'Changed report'}),/frozen/);
  assert.throws(()=>engine.claim(task.id,session,{id:delivered.claims[0]!.id,key:'cause',text:'Changed claim',status:'supported',supports:[delivered.observations[0]!.id],refutes:[]}),/frozen/);
  engine.confirm(task.id);const confirmation=store.get(task.id).confirmedAt;
  engine.checkpoint(task.id,session,{summary:input.summary,questions:['Archive the receipt']});
  assert.deepEqual(store.get(task.id).delivery,delivered.delivery);assert.equal(store.get(task.id).confirmedAt,confirmation);
  assert.equal(engine.finish(task.id,session,{outcome:'completed'}).phase,'completed');store.close();
});

test('manual contest evidence is readable but remains ineligible for a checkpoint conclusion',()=>{
  const store=new Store(':memory:'),engine=new Engine(store);
  store.register(session,{capture:true,preTool:true,restore:true,stop:true});store.setConfig('gateway',{tools:[{name:'query'}]});
  const task=engine.create(session,{origin:'contest',goal:'Diagnose',criteria:['Cause'],profile:'emergency',scope:{teamId:'t',roundId:'r',issueId:'i',matchId:'m'}});
  observation(engine,task.id,'manual',{source:'manual',resultRef:'fake'});assert.equal(engine.resolveEvidence(task.id,'E1').source,'manual');
  assert.throws(()=>engine.checkpoint(task.id,session,{summary:'Claim',findings:[{text:'Claim',evidence:['E1']}]}),/automatically/);store.close();
});

test('restoration is bounded in UTF-8 bytes while complete evidence and history remain persisted',()=>{
  const {store,engine,task}=setup();observation(engine,task.id,'raw',{output:'secret raw output '.repeat(10_000)});
  engine.checkpoint(task.id,session,{summary:'状态'.repeat(20_000),findings:[{key:'key'.repeat(10_000),text:'结论'.repeat(20_000),evidence:['E1']}],questions:Array.from({length:50},(_,i)=>`${i}问题`.repeat(1000))});
  const saved=store.get(task.id);
  saved.constraints=Array.from({length:50},()=>'限制'.repeat(1000));
  for(let i=0;i<200;i++){
    saved.claims.push({...saved.claims[0]!,id:`claim-${i}`,key:`finding-${i}`,text:`${i}结论`.repeat(1000)});
    saved.criteria.push({id:`c${i+2}`,text:'条件'.repeat(1000),claimIds:[]});
  }
  store.save(saved,'test.long_history',{},engine.at());
  const context=engine.context(task.id),serialized=JSON.stringify(context);
  assert.ok(Buffer.byteLength(serialized,'utf8')<=16*1024,`context is ${Buffer.byteLength(serialized)} bytes`);
  assert.equal(context.totals.claims,201);assert.ok(context.truncated.claims>0);assert.ok(context.truncated.criteria>0);assert.equal(context.truncated.text,true);
  assert.ok(!serialized.includes('secret raw output'));assert.ok(context.readMore.includes('cairn_read'));
  assert.equal(store.get(task.id).checkpoint?.summary.length,40_000);assert.equal(engine.resolveEvidence(task.id,'E1').output,'secret raw output '.repeat(10_000));store.close();
});
