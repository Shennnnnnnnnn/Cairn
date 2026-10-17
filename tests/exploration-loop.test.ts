import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHarness,Engine,Store,type Session} from '../src/index.js';
import {handleNative} from '../src/adapters/hooks.js';
import {projectTask} from '../src/ui/view.js';
import {markdown} from '../src/export.js';
const session:Session={host:'pi',sessionId:'exploration-owner',cwd:process.cwd()};

test('long unsaved curated exploration gets one bounded blackboard review without telemetry',()=>{
 let clock=Date.parse('2026-10-17T10:00:00Z');const store=new Store(':memory:'),engine=new Engine(store,()=>new Date(clock));
 try{
  const task=engine.create(session,{origin:'request',goal:'Compare alternatives',criteria:['Supported result'],evidenceMode:'curated'});
  const event={type:'PostToolUse',sessionId:session.sessionId,cwd:session.cwd,tool:'bash',callId:'native',input:{secret:'UNRECORDED'},output:'UNRECORDED'};
  assert.deepEqual(handleNative(engine,'pi',event),{});clock+=61000;
  assert.match(handleNative(engine,'pi',event).context!,/blackboard review/);
  assert.deepEqual(handleNative(engine,'pi',event),{});clock+=61000;assert.deepEqual(handleNative(engine,'pi',event),{});
  const saved=store.get(task.id);assert.equal(saved.observations.length,0);assert.deepEqual(saved.calls,{});
  assert.ok(!JSON.stringify(store.events(task.id)).includes('UNRECORDED'));
  engine.finish(task.id,session,{outcome:'suspended'});clock+=61000;assert.deepEqual(handleNative(engine,'pi',event),{});
 }finally{store.close();}
});

test('new hints trigger a review and checkpoint receipts preserve facts exclusions and next direction',async()=>{
 let clock=Date.parse('2026-10-17T10:00:00Z');const h=createHarness({database:':memory:',session,now:()=>new Date(clock)});
 try{
  const task=await h.tools.invoke('cairn_start',{goal:'Find a justified result',criteria:['Explain result','Verify outcome']}) as any;
  h.engine.addHint(task.taskId,'Check the alternative','human');
  assert.match(h.engine.explorationGuidance(task.taskId,session)!,/alternatives and counterevidence/);
  const receipt=await h.tools.invoke('cairn_checkpoint',{summary:'Input checked',findings:[{key:'fact',text:'Input A has this behavior',basis:'Recorded observation',covers:[]},{key:'excluded',text:'Alternative B',status:'refuted',basis:'B failed under the same input',from:['fact'],covers:[]}],questions:['Is C sufficient?'],next:'Test C',progress:[{key:'compare',title:'Test C against input A',status:'running',from:['fact']}]}) as any;
  assert.equal(receipt.coverage.covered,0);assert.equal(receipt.exploration.next,'Test C');assert.equal(receipt.exploration.excluded[0].ref,'excluded');assert.equal(receipt.exploration.openWork[0].key,'compare');
  assert.match(receipt.exploration.guidance,/next action/);assert.equal(h.engine.explorationGuidance(task.taskId,session),undefined);
  clock+=61000;assert.match(h.engine.explorationGuidance(task.taskId,session)!,/blackboard review/);
 }finally{await h.close();}
});

test('finish consumes saved supported facts without restating their grounds',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invoke('cairn_start',{goal:'Deliver result'}) as any;
  await h.tools.invoke('cairn_checkpoint',{summary:'Fact A established',findings:[{key:'a',text:'Observed A',basis:'Actual source A',covers:[]}]});
  const result=await h.tools.invoke('cairn_finish',{summary:'A satisfies the requested condition',from:['a'],covers:['c1']}) as any;
  assert.equal(result.phase,'completed');const saved=h.engine.store.get(task.taskId),final=saved.claims.find(c=>c.key==='final-result')!;
  assert.match(final.basis!,/Observed A/);assert.deepEqual(final.from,[`claim:${saved.claims.find(c=>c.key==='a')!.id}`]);
 }finally{await h.close();}
});

test('short finish rejects unresolved hypotheses and work items as evidence',async()=>{
 const h=createHarness({database:':memory:',session});try{
  await h.tools.invoke('cairn_start',{goal:'Deliver result',progress:[{key:'work',title:'Investigation',status:'running'}]});
  await h.tools.invoke('cairn_checkpoint',{summary:'Tentative',findings:[{key:'guess',text:'Maybe A',status:'proposed',basis:'Untested interpretation',covers:[]}]});
  for(const ref of ['guess','work'])await assert.rejects(h.tools.invoke('cairn_finish',{summary:'Done',from:[ref]}),/supported findings/);
  const incomplete=await h.tools.invoke('cairn_finish',{summary:'Done'}) as any;assert.equal(incomplete.phase,'incomplete');assert.equal(incomplete.coverage.covered,0);
  assert.match(incomplete.repair.actions.join(' '),/cairn_checkpoint.*basis/);
 }finally{await h.close();}
});

test('one-call curated finish requires actual grounds and never bypasses captured evidence',async()=>{
 const h=createHarness({database:':memory:',session});try{
  await h.tools.invoke('cairn_start',{goal:'Read name'});
  assert.equal((await h.tools.invoke('cairn_finish',{summary:'Name is cairn',basis:'Read the name field',references:['package.json']}) as any).phase,'completed');
  await h.tools.invoke('cairn_start',{goal:'Captured result',evidence_mode:'captured'});
  await assert.rejects(h.tools.invoke('cairn_finish',{summary:'Done',basis:'My interpretation'}),/captured mode/);
 }finally{await h.close();}
});

test('finish automatically collects only explicit host-required files before acceptance',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cairn-auto-submit-'));writeFileSync(join(dir,'result.txt'),'candidate');writeFileSync(join(dir,'unrequested.txt'),'extra');let seen:any;
 const h=createHarness({database:':memory:',session:{...session,cwd:dir},completionVerifier:{id:'required-file',artifacts:['result.txt'],verify:task=>{seen=task;return {ok:true,method:'contract',scope:'Required result file'};}}});
 try{
  await h.tools.invoke('cairn_start',{goal:'Deliver result.txt'});
  const result=await h.tools.invoke('cairn_finish',{summary:'Result saved',basis:'Generated and inspected result.txt',references:['result.txt']}) as any;
  assert.equal(result.phase,'completed');assert.equal(seen.artifacts.length,1);assert.equal(seen.artifacts[0].path,join(dir,'result.txt'));assert.equal(seen.artifacts[0].bytes,9);
 }finally{await h.close();rmSync(dir,{recursive:true,force:true});}
});

test('task completion and artifact pass do not declare independent conclusion correctness',async()=>{
 const h=createHarness({database:':memory:',session,completionVerifier:{id:'arithmetic',verify:()=>({ok:true,method:'replay',scope:'Declared arithmetic only'})}});
 try{
  const task=await h.tools.invoke('cairn_start',{goal:'Check a conclusion'}) as any;
  await h.tools.invoke('cairn_finish',{summary:'Candidate',basis:'Recorded supporting source'});
  let view=projectTask(h.engine,h.engine.store.get(task.taskId));assert.equal(view.status,'completed');assert.equal(view.assurance.conclusionState,'unreviewed');assert.match(view.assurance.acceptance,/passed/);
  h.engine.assess(task.taskId,{status:'failed',summary:'External reference contradicts the candidate',scope:'Object plus requested outcome',reviewer:'host-reference'});
  view=projectTask(h.engine,h.engine.store.get(task.taskId));assert.equal(view.status,'completed');assert.equal(view.assurance.conclusionState,'failed');assert.match(markdown(h.engine.store.get(task.taskId)),/failed.*host-reference/);
  h.engine.reopen(task.taskId,session,'New counterexample');view=projectTask(h.engine,h.engine.store.get(task.taskId));assert.equal(view.assurance.conclusionState,'stale');
 }finally{await h.close();}
});

test('assessment is not an agent tool and long reviewer text stays out of bounded recovery',async()=>{
 const h=createHarness({database:':memory:',session});try{
  const task=await h.tools.invoke('cairn_start',{goal:'Deliver result'}) as any;
  await h.tools.invoke('cairn_finish',{summary:'Result',basis:'Source'});
  h.engine.assess(task.taskId,{status:'inconclusive',summary:'S'.repeat(4000),scope:'C'.repeat(4000),reviewer:'R'.repeat(4000)});
  assert.ok(Buffer.byteLength(JSON.stringify(h.engine.context(task.taskId)))<14000);
  assert.equal((await h.tools.list()).length,5);await assert.rejects(h.tools.invoke('cairn_assess',{}),/Unknown tool|unavailable/);
 }finally{await h.close();}
});

test('one verified finish preserves explicit artifact descriptions and order in its internal retry',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cairn-submit-description-'));writeFileSync(join(dir,'result.txt'),'candidate');writeFileSync(join(dir,'detail.txt'),'support');let verifies=0;
 const h=createHarness({database:':memory:',session:{...session,cwd:dir},completionVerifier:{id:'described-required',artifacts:['result.txt'],verify:()=>{verifies++;return {ok:true,method:'contract',scope:'Exact submitted files'};}}});
 try{
  await h.tools.invoke('cairn_start',{goal:'Deliver result'});
  const result=await h.tools.invoke('cairn_finish',{summary:'Result saved',basis:'Compared candidate',artifacts:[{path:'detail.txt',description:'Reproduction details'},{path:'result.txt',description:'Final result'}]}) as any;
  assert.equal(result.phase,'completed');assert.equal(verifies,1);assert.equal(result.verification.current,true);
  assert.deepEqual(result.artifacts.map((a:any)=>[a.path,a.description]),[[join(dir,'detail.txt'),'Reproduction details'],[join(dir,'result.txt'),'Final result']]);
 }finally{await h.close();rmSync(dir,{recursive:true,force:true});}
});

test('new knowledge restores review after unchanged finishes; cosmetic progress does not',()=>{
 let clock=Date.parse('2026-10-17T10:00:00Z');const store=new Store(':memory:'),engine=new Engine(store,()=>new Date(clock));
 try{
  const task=engine.create(session,{origin:'request',goal:'Justified result',criteria:['Result'],evidenceMode:'curated'});
  engine.finish(task.id,session,{outcome:'completed',summary:'Guess'});engine.finish(task.id,session,{outcome:'completed',summary:'Guess again'});clock+=61000;
  assert.equal(engine.explorationGuidance(task.id,session),undefined);
  engine.checkpoint(task.id,session,{summary:'New fact',findings:[{key:'fact',text:'Source checked',basis:'Actual observation',covers:[]}]});clock+=61000;
  assert.match(engine.explorationGuidance(task.id,session)!,/blackboard review/);
  engine.checkpoint(task.id,session,{summary:'Reworded status only'});clock+=61000;
  assert.equal(engine.explorationGuidance(task.id,session),undefined);
 }finally{store.close();}
});
