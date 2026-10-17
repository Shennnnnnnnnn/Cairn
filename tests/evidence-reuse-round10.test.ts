import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHarness,Engine,Store,type Session} from '../src/index.js';
const session:Session={host:'pi',sessionId:'reuse-owner',cwd:'/workspace'};

test('focused curated evidence keeps exact saved facts, dependencies, revision and current source state',async()=>{
 const cwd=mkdtempSync(join(tmpdir(),'cairn-reuse-'));writeFileSync(join(cwd,'measurements.json'),'version one');
 const h=createHarness({database:':memory:',session:{...session,cwd}});try{
  const start=await h.tools.invokeModel('cairn_start',{goal:'Explain the observed change'}) as any;
  const basis='Observed at [120,180), clock origin unspecified; unit unknown; 2 measured of 3 expected subjects, third not collected.';
  await h.tools.invokeModel('cairn_checkpoint',{artifacts:[{path:'measurements.json'}],findings:[{key:'measured',text:'Source shows a change',status:'supported',basis,references:['measurements.json'],covers:[]},{key:'explanation',text:'Mechanism is unresolved',status:'inconclusive',from:['measured'],covers:[]}]});
  const before=JSON.stringify(h.engine.store.get(start.taskId));
  const read=await h.tools.invokeModel('cairn_read',{view:'evidence',ref:'measured'}) as any;
  const task=h.engine.store.get(start.taskId);
  assert.equal(read.taskId,start.taskId);assert.equal(read.revision,task.revision);
  assert.equal(read.item.basis,basis);assert.equal(read.item.revision,1);
  assert.deepEqual(read.item.referenceState,{status:'current',issues:[]});
  assert.equal(JSON.stringify(h.engine.store.get(start.taskId)),before,'read must never refresh a source or change coverage');
  const dependent=await h.tools.invokeModel('cairn_read',{view:'evidence',ref:'explanation'}) as any;
  assert.deepEqual(dependent.item.from,[`claim:${task.claims[0]!.id}`]);
  assert.equal(dependent.item.referenceState.status,'untracked','agent text is not independent verification');
  writeFileSync(join(cwd,'measurements.json'),'version two');
  const stale=await h.tools.invokeModel('cairn_read',{view:'evidence',ref:'measured'}) as any;
  assert.equal(stale.item.referenceState.status,'stale');assert.equal(stale.item.revision,1);assert.equal(stale.item.basis,basis);
  assert.equal(h.engine.store.get(start.taskId).claims[0]!.revision,1);
 }finally{await h.close();rmSync(cwd,{recursive:true,force:true});}
});

test('curated evidence paging is revision pinned and preserves complete source notes',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const start=await h.tools.invokeModel('cairn_start',{goal:'Explain result'}) as any;
  await h.tools.invokeModel('cairn_checkpoint',{findings:[{key:'fact',text:'A recorded observation',status:'supported',basis:'Large note '.repeat(180),covers:[]}]});
  const first=await h.tools.invokeModel('cairn_read',{view:'evidence',ref:'fact',limit:170}) as any;
  assert.equal(first.taskId,start.taskId);assert.equal(first.revision,h.engine.store.get(start.taskId).revision);
  let chunk=first.chunk,next=first.nextOffset;
  while(next!==undefined){const page=await h.tools.invokeModel('cairn_read',{view:'evidence',ref:'fact',limit:170,offset:next,revision:first.revision}) as any;chunk+=page.chunk;next=page.nextOffset;}
  assert.equal(JSON.parse(chunk).basis,'Large note '.repeat(180).trim());
  await h.tools.invokeModel('cairn_checkpoint',{questions:['Which observation could change the result?']});
  await assert.rejects(h.tools.invokeModel('cairn_read',{view:'evidence',ref:'fact',offset:170,revision:first.revision}),/Task changed/);
 }finally{await h.close();}
});

test('blackboard recent facts and alternatives follow revisions rather than insertion order',()=>{
 let clock=Date.parse('2026-10-18T00:00:00Z');const store=new Store(':memory:'),engine=new Engine(store,()=>new Date(clock));
 try{
  const task=engine.create(session,{origin:'request',goal:'Explain result',criteria:['Explain'],evidenceMode:'curated'});
  for(let i=0;i<7;i++){clock+=1000;engine.checkpoint(task.id,session,{summary:'Measured',findings:[{key:`fact-${i}`,text:`Observation ${i}`,status:'inconclusive',covers:[]}]});}
  clock+=1000;engine.checkpoint(task.id,session,{summary:'New counterevidence',findings:[{key:'fact-0',text:'Original direction now has new counterevidence',status:'inconclusive',covers:[]}]});
  const context=engine.context(task.id);
  assert.equal(context.exploration.changed[0]!.ref,'fact-0');assert.equal(context.exploration.uncertain[0]!.ref,'fact-0');
  assert.equal(store.get(task.id).claims[0]!.revision,2);assert.equal(store.get(task.id).claims[0]!.history!.length,1);
  assert.equal(context.check.ok,false);assert.deepEqual(store.get(task.id).budget,{});
 }finally{store.close();}
});
