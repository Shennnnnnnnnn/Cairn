import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHarness,Engine,Store,type Session} from '../src/index.js';
import {coreCatalog} from '../src/tools.js';
import {handleNative} from '../src/adapters/hooks.js';

const session:Session={host:'pi',sessionId:'completion-owner',cwd:process.cwd()};
const input={origin:'user',goal:'Deliver a supported result',criteria:['Identify the cause','Reproduce the evidence'],evidenceMode:'curated' as const};
const toolInput={origin:input.origin,goal:input.goal,criteria:input.criteria,evidence_mode:'curated'};

test('incomplete finish supplies bounded, actionable criterion feedback without inventing coverage',async()=>{
 const h=createHarness({database:':memory:',session});try{
  await h.tools.invoke('cairn_start',toolInput);
  const result=await h.tools.invoke('cairn_finish',{}) as any;
  assert.equal(result.phase,'incomplete');assert.equal(result.status,'active');
  assert.deepEqual(result.repair.missingCriteria,[{id:'c1',text:'Identify the cause'},{id:'c2',text:'Reproduce the evidence'}]);
  assert.equal(result.repair.attempts,1);assert.equal(result.repair.unchanged,false);
  assert.match(result.repair.actions.join(' '),/covers:\["c1"\]/);assert.match(result.repair.actions.join(' '),/suspended/);
  assert.equal(coreCatalog().length,6);assert.equal(result.coverage.covered,0);
 }finally{await h.close();}
});

test('unchanged finish retries and summary rewrites do not masquerade as evidence progress',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invoke('cairn_start',toolInput) as any;
  await h.tools.invoke('cairn_finish',{summary:'A candidate answer'});
  const repeat=await h.tools.invoke('cairn_finish',{summary:'The same answer, rewritten'}) as any;
  assert.equal(repeat.repair.attempts,2);assert.equal(repeat.repair.unchanged,true);
  assert.match(repeat.repair.actions[0],/Do not repeat/);
  assert.equal(h.engine.continuation(task.taskId,session),undefined);
  for(let i=0;i<8;i++)await h.tools.invoke('cairn_finish',{});
  assert.equal(h.engine.store.get(task.taskId).finishAttempt?.attempts,3);
  assert.equal(h.engine.store.get(task.taskId).claims.length,0);
  const checked=h.engine.store.events(task.taskId).filter(e=>e.kind==='task.checked');
  assert.equal(checked.length,1,'only the first saturated retry is persisted after the two summary changes');
  await h.tools.invoke('cairn_checkpoint',{summary:'New facts',findings:[{key:'new',text:'A real observation',basis:'Independently checked source',covers:[]}]});
  assert.match(h.engine.continuation(task.taskId,session)!,/incomplete/,'new findings allow a fresh decision');
  const fresh=await h.tools.invoke('cairn_finish',{}) as any;assert.equal(fresh.repair.attempts,1);
 }finally{await h.close();}
});

test('exact unkeyed finding retries retain a single claim and can be repaired with explicit coverage',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invoke('cairn_start',toolInput) as any;
  const candidate={summary:'Cause identified',findings:[{text:'Cause A',basis:'Source A',covers:['c1']}]};
  const first=await h.tools.invoke('cairn_finish',candidate) as any;
  const second=await h.tools.invoke('cairn_finish',candidate) as any;
  assert.equal(second.revision,first.revision);assert.equal(second.repair.attempts,2);
  assert.equal(h.engine.store.get(task.taskId).claims.length,1);
  assert.deepEqual(second.repair.missingCriteria,[{id:'c2',text:'Reproduce the evidence'}]);
  const done=await h.tools.invoke('cairn_finish',{summary:'Reproduction saved',findings:[{key:'repro',text:'Evidence reproduced',basis:'Recomputed using the original source',covers:['c2']}]}) as any;
  assert.equal(done.phase,'completed');assert.equal(done.repair,undefined);
 }finally{await h.close();}
});

test('external verification is one completion attempt, even with its internal deferred check',async()=>{
 let accepts=false;const h=createHarness({database:':memory:',session,completionVerifier:{id:'fixture:semantic',verify:()=>accepts?{ok:true}:{ok:false,issues:[{message:'Source mismatch'}]}}});
 try{
  await h.tools.invoke('cairn_start',{goal:'Verified output'});
  const candidate={summary:'Candidate',findings:[{key:'answer',text:'Candidate answer',basis:'Source'}]};
  const first=await h.tools.invoke('cairn_finish',candidate) as any;
  const second=await h.tools.invoke('cairn_finish',{}) as any;
  assert.equal(first.repair.attempts,1);assert.equal(second.repair.attempts,2);
  assert.match(second.repair.actions.join(' '),/external verifier/);
  accepts=true;assert.equal((await h.tools.invoke('cairn_finish',{}) as any).phase,'completed');
 }finally{await h.close();}
});

test('completion feedback survives database reopen and explicit session takeover',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'cairn-completion-')),database=join(directory,'state.sqlite');
 let h=createHarness({database,session});
 try{
  const task=await h.tools.invoke('cairn_start',toolInput) as any;
  await h.tools.invoke('cairn_finish',{summary:'Saved answer'});await h.tools.invoke('cairn_finish',{});
  const oldEpoch=h.engine.store.get(task.taskId).owner.epoch;
  await h.close();h=createHarness({database,session:{...session,sessionId:'recovered-owner'}});
  const resumed=await h.tools.invoke('cairn_resume',{task_id:task.taskId,takeover:true}) as any;
  assert.ok(resumed.owner.epoch>oldEpoch);
  const retry=await h.tools.invoke('cairn_finish',{}) as any;
  assert.equal(retry.repair.attempts,3);assert.equal(retry.status,'active');assert.equal(retry.repair.missingCriteria.length,2);
  assert.equal((await h.tools.invoke('cairn_finish',{outcome:'suspended',summary:'Evidence unavailable',questions:['Need the original source']}) as any).phase,'suspended');
 }finally{await h.close();rmSync(directory,{recursive:true,force:true});}
});

for(const evidenceMode of ['curated','captured'] as const){
 test(`${evidenceMode} deadline never falls back to exploration after the save reminder`,()=>{
  let time=Date.parse('2026-10-17T10:00:00Z');const store=new Store(':memory:'),engine=new Engine(store,()=>new Date(time));
  try{
   const task=engine.create(session,{...input,evidenceMode,budget:{deadline:'2026-10-17T10:01:00Z'},progress:[{key:'work',title:'Check source',status:'running'}]});
   time+=61000;const stop={type:'Stop',sessionId:session.sessionId,cwd:session.cwd};
   assert.match(handleNative(engine,'pi',stop).continue!,/budget expired/);
   assert.equal(handleNative(engine,'pi',stop).continue,undefined);
   engine.checkpoint(task.id,session,{summary:'Saved after deadline'});
   assert.equal(handleNative(engine,'pi',stop).continue,undefined);
   assert.equal(engine.concludeGuidance(task.id,session),undefined);
   engine.finish(task.id,session,{outcome:'suspended'});assert.equal(handleNative(engine,'pi',stop).continue,undefined);
  }finally{store.close();}
 });
}

test('management-only loops receive reserve guidance without capturing their calls',()=>{
 let time=Date.parse('2026-10-17T10:00:00Z');const store=new Store(':memory:'),engine=new Engine(store,()=>new Date(time));
 try{
  const task=engine.create(session,{...input,budget:{deadline:'2026-10-17T10:01:00Z',submitReserveMs:20000}});
  time+=45000;const event={type:'PostToolUse',sessionId:session.sessionId,cwd:session.cwd,tool:'cairn_finish',callId:'management-only'};
  assert.match(handleNative(engine,'pi',event).context!,/budget reserve/);
  assert.deepEqual(handleNative(engine,'pi',event),{});
  assert.equal(handleNative(engine,'pi',{...event,type:'Stop',tool:undefined}).continue,undefined);
  const saved=store.get(task.id);assert.equal(saved.observations.length,0);assert.deepEqual(saved.calls,{});
  assert.equal(store.events(task.id).filter(e=>e.kind==='budget.conclude_requested').length,1);
 }finally{store.close();}
});

test('user interruption wins over budget and completion feedback',()=>{
 const store=new Store(':memory:'),engine=new Engine(store);try{
  const task=engine.create(session,{...input,budget:{deadline:new Date(Date.now()-1000).toISOString()}});
  assert.deepEqual(handleNative(engine,'pi',{type:'Stop',sessionId:session.sessionId,cwd:session.cwd,aborted:true}),{});
  handleNative(engine,'pi',{type:'Interrupt',sessionId:session.sessionId,cwd:session.cwd});
  assert.equal(engine.budgetGuidance(task.id,session),undefined);
  assert.equal(engine.continuation(task.id,session),undefined);assert.equal(store.get(task.id).status,'suspended');
 }finally{store.close();}
});

test('anonymous retries resolve finding/progress aliases and duplicate prerequisites before deduplication',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invoke('cairn_start',toolInput) as any;
  await h.tools.invoke('cairn_checkpoint',{summary:'Seed',findings:[{key:'source',text:'Original source',basis:'Read file',covers:[]}],progress:[{key:'inspect',title:'Inspect source',status:'completed'}]});
  const candidate={summary:'Derived',findings:[{text:'Derived result',basis:'Compared source',from:['source','inspect','source'],covers:['c1']}]};
  const first=await h.tools.invoke('cairn_finish',candidate) as any;
  const second=await h.tools.invoke('cairn_finish',candidate) as any;
  const third=await h.tools.invoke('cairn_finish',candidate) as any;
  assert.equal(second.revision,first.revision);assert.equal(third.revision,first.revision);
  assert.equal(third.repair.attempts,3);
  const saved=h.engine.store.get(task.taskId);assert.equal(saved.claims.length,2);
  assert.equal(saved.claims[1]!.from?.length,2);assert.equal(saved.criteria[0]!.claimIds.length,1);
 }finally{await h.close();}
});

test('anonymous deduplication preserves batch forward references and branch identity',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invoke('cairn_start',toolInput) as any;
  const candidate={summary:'Derived',findings:[{text:'Derived result',basis:'Compared source',from:['future'],covers:['c1']},{key:'future',text:'Source result',basis:'Read source',covers:[]}]};
  const first=await h.tools.invoke('cairn_finish',candidate) as any;
  const second=await h.tools.invoke('cairn_finish',candidate) as any;
  assert.equal(second.revision,first.revision);assert.equal(second.repair.attempts,2);assert.equal(h.engine.store.get(task.taskId).claims.length,2);
  await h.tools.invoke('cairn_checkpoint',{summary:'Delegate distinct tasks',progress:[{key:'a',title:'Inspect A',status:'pending',delegated:true},{key:'b',title:'Inspect B',status:'pending',delegated:true}]});
  for(const key of ['a','b']){
   const worker={...session,sessionId:`worker-${key}`},claimed=h.engine.branch(task.taskId,worker,key,'claim');
   h.engine.branch(task.taskId,worker,key,'checkpoint',claimed.leaseToken,{summary:'Same proposal',findings:[{text:'Identical proposal',basis:'Source',from:['future']}]});
  }
  const proposals=h.engine.store.get(task.taskId).claims.filter(c=>c.text==='Identical proposal');
  assert.equal(proposals.length,2);assert.deepEqual(proposals.map(c=>c.branchKey).sort(),['a','b']);
 }finally{await h.close();}
});

test('new human hints and finished exploration permit a fresh decision; cosmetic progress does not',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invoke('cairn_start',toolInput) as any;
  await h.tools.invoke('cairn_finish',{});await h.tools.invoke('cairn_finish',{});
  assert.equal(h.engine.continuation(task.taskId,session),undefined);
  h.engine.addHint(task.taskId,'Check a newly supplied source');
  assert.match(h.engine.continuation(task.taskId,session)!,/incomplete/);
  assert.equal((await h.tools.invoke('cairn_finish',{}) as any).repair.attempts,1);
  await h.tools.invoke('cairn_checkpoint',{summary:'Exploration started',progress:[{key:'inspect',title:'Inspect new source',status:'running'}]});
  await h.tools.invoke('cairn_finish',{});await h.tools.invoke('cairn_finish',{});
  await h.tools.invoke('cairn_checkpoint',{summary:'Wording only',progress:[{key:'inspect',title:'Inspect the new source carefully',status:'running',detail:'Reworded status'}]});
  assert.equal((await h.tools.invoke('cairn_finish',{}) as any).repair.unchanged,true);
  await h.tools.invoke('cairn_checkpoint',{summary:'Exploration ended; evidence still missing',progress:[{key:'inspect',title:'Inspect source',status:'completed'}]});
  assert.equal((await h.tools.invoke('cairn_finish',{}) as any).repair.attempts,1);
 }finally{await h.close();}
});

test('captured anonymous finding identity includes criterion coverage; exact retries keep both covered goals',()=>{
 const store=new Store(':memory:'),engine=new Engine(store);try{
  const task=engine.create(session,{...input,evidenceMode:'captured'});
  engine.observe(task.id,session,{callId:'source',tool:'read',input:{},output:'Confirmed source',source:'manual',status:'success',scope:{}});
  const candidate={text:'Same confirmed fact',evidence:['E1']};
  engine.checkpoint(task.id,session,{summary:'First criterion',findings:[{...candidate,covers:['c1']}]});
  engine.checkpoint(task.id,session,{summary:'Second criterion',findings:[{...candidate,covers:['c2']}]});
  const before=store.get(task.id);assert.equal(before.claims.length,2);assert.deepEqual(engine.check(task.id).unmet,[]);
  engine.checkpoint(task.id,session,{summary:'Second criterion',findings:[{...candidate,covers:['c2']}]});
  const after=store.get(task.id);assert.equal(after.revision,before.revision);assert.equal(after.claims.length,2);
  assert.deepEqual(after.criteria,before.criteria);assert.deepEqual(engine.check(task.id).unmet,[]);
 }finally{store.close();}
});
