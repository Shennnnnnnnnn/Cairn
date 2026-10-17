import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,unlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHarness,type CompletionVerifier,type Session} from '../src/index.js';

type Harness=ReturnType<typeof createHarness>;
const initial='{"n":8}',replacement='{"n":6}';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const finding=(key='result',references=['checks.json'])=>({
 key,text:'The saved result contains eight checked entries',status:'supported' as const,
 basis:'Compared the result with the recorded check file',references,covers:['c1'],
});
async function fixture(run:(h:Harness,cwd:string,session:Session)=>Promise<void>,verifier?:CompletionVerifier){
 const cwd=mkdtempSync(join(tmpdir(),'cairn-claim-artifact-')),session:Session={host:'codex',sessionId:'reference-owner',cwd};
 const h=createHarness({database:join(cwd,'.cairn/state.db'),session,completionVerifier:verifier});
 try{await run(h,cwd,session);}finally{await h.close();rmSync(cwd,{recursive:true,force:true});}
}
async function start(h:Harness){return (await h.tools.invokeModel('cairn_start',{goal:'Deliver the checked result',criteria:['The result is supported by the saved checks']} ) as any).taskId as string;}
function saved(h:Harness,taskId:string,key='result'){return h.engine.store.get(taskId).claims.find(claim=>claim.key===key)! as any;}
function referenceState(h:Harness,taskId:string,key='result'){
 const claim=h.engine.context(taskId).claims.find(claim=>claim.key===key) as any;
 assert.ok(claim,`Missing finding ${key}`);assert.ok(claim.referenceState,'Context must expose the reference freshness separately from declared status');
 return claim.referenceState as {status:'current'|'stale'|'untracked';issues:string[]};
}

test('candidate report validation checks the candidate citations rather than only the saved report',async()=>{
 await fixture(async(h,cwd,session)=>{
  writeFileSync(join(cwd,'checks.json'),initial);writeFileSync(join(cwd,'current.json'),initial);
  const taskId=await start(h);
  await h.tools.invokeModel('cairn_checkpoint',{findings:[{...finding('old'),covers:[]},finding('current',['current.json'])],artifacts:[{path:'checks.json'},{path:'current.json'}]});
  writeFileSync(join(cwd,'checks.json'),replacement);
  await h.tools.invokeModel('cairn_checkpoint',{artifacts:[{path:'checks.json'},{path:'current.json'}]});
  const report=h.engine.store.get(taskId).report!,currentId=saved(h,taskId,'current').id;
  const currentOnly={...report,curatedReferences:report.curatedReferences!.filter(c=>c.claimId===currentId)};
  h.engine.report(taskId,session,currentOnly);
  assert.equal(h.engine.validateReport(taskId,currentOnly).ok,true);
  const candidate=h.engine.validateReport(taskId,report);
  assert.equal(candidate.ok,false);assert.match(candidate.issues.join('\n'),/old.*stale artifact reference/);
 });
});

test('artifacts-only checkpoints preserve old finding versions and stale findings lose effective coverage',async()=>{
 await fixture(async(h,cwd)=>{
  writeFileSync(join(cwd,'checks.json'),initial);const taskId=await start(h);
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding()],artifacts:[{path:'checks.json'}]});
  const before=saved(h,taskId);assert.equal(before.referenceArtifacts?.[0]?.sha256,digest(initial));
  assert.equal(referenceState(h,taskId).status,'current');
  writeFileSync(join(cwd,'checks.json'),replacement);
  await h.tools.invokeModel('cairn_checkpoint',{artifacts:[{path:'checks.json'}]});
  const after=saved(h,taskId),task=h.engine.store.get(taskId);
  assert.deepEqual(after.referenceArtifacts,before.referenceArtifacts);assert.equal(after.revision,before.revision);
  assert.equal(after.status,'supported','Freshness must not rewrite the agent declaration');
  assert.deepEqual(task.criteria[0]!.claimIds,[before.id],'Declared links remain available for review');
  assert.equal(task.artifacts?.[0]?.sha256,digest(replacement));
  assert.equal(referenceState(h,taskId).status,'stale');assert.ok(referenceState(h,taskId).issues.length>0);
  assert.deepEqual(h.engine.check(taskId).unmet,['c1']);
  assert.equal(h.engine.context(taskId).totals.coveredCriteria,0);
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'incomplete');
  assert.deepEqual(saved(h,taskId).referenceArtifacts,before.referenceArtifacts,'Finish must not refresh the old finding');
 });
});

test('finish collection of host-required files does not silently rebind saved findings',async()=>{
 let calls=0;
 await fixture(async(h,cwd)=>{
  writeFileSync(join(cwd,'checks.json'),initial);const taskId=await start(h);
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding()]});
  const before=saved(h,taskId);assert.equal(before.referenceArtifacts?.[0]?.sha256,digest(initial));
  writeFileSync(join(cwd,'checks.json'),replacement);
  const result=await h.tools.invokeModel('cairn_finish',{}) as any;
  assert.equal(result.phase,'incomplete');assert.equal(calls,0,'An outdated finding must not reach the external verifier');
  assert.equal(h.engine.store.get(taskId).artifacts?.[0]?.sha256,digest(replacement));
  assert.deepEqual(saved(h,taskId).referenceArtifacts,before.referenceArtifacts);
  assert.equal(saved(h,taskId).status,'supported');assert.equal(referenceState(h,taskId).status,'stale');
 },{id:'required-reference',artifacts:['checks.json'],verify:()=>{calls++;return {ok:true,method:'contract'};}});
});

test('explicit keyed re-save binds the new bytes once and later identical retries remain idempotent',async()=>{
 await fixture(async(h,cwd)=>{
  writeFileSync(join(cwd,'checks.json'),initial);const taskId=await start(h);
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding()],artifacts:[{path:'checks.json'}]});
  const old=saved(h,taskId);writeFileSync(join(cwd,'checks.json'),replacement);
  await h.tools.invokeModel('cairn_checkpoint',{artifacts:[{path:'checks.json'}]});
  const reviewed=await h.tools.invokeModel('cairn_checkpoint',{findings:[finding()]}) as any;
  const current=saved(h,taskId);
  assert.equal(current.id,old.id);assert.equal(current.revision,old.revision+1);
  assert.equal(current.history?.length,(old.history?.length??0)+1);
  assert.equal(current.referenceArtifacts?.[0]?.sha256,digest(replacement));
  assert.deepEqual(reviewed.delta.revisedFindings,['result']);assert.equal(referenceState(h,taskId).status,'current');
  const before=h.engine.store.get(taskId),events=h.engine.store.events(taskId).length;
  const retry=await h.tools.invokeModel('cairn_checkpoint',{summary:'Cosmetic progress wording',findings:[finding()]}) as any;
  assert.deepEqual(retry.delta.revisedFindings,[]);assert.equal(retry.delta.stateChanged,false);
  assert.deepEqual(h.engine.store.get(taskId),before);assert.equal(h.engine.store.events(taskId).length,events);
  assert.equal(h.engine.check(taskId).ok,true);
 });
});

test('legacy unkeyed SDK checkpoints revise an existing finding instead of appending a version duplicate',async()=>{
 await fixture(async(h,cwd,session)=>{
  writeFileSync(join(cwd,'checks.json'),initial);const taskId=await start(h);
  const {key,...anonymous}=finding();
  const input={summary:'Saved result',findings:[anonymous],artifacts:[{path:'checks.json'}]};
  h.engine.checkpoint(taskId,session,input);const old=h.engine.store.get(taskId).claims[0]! as any;
  writeFileSync(join(cwd,'checks.json'),replacement);h.engine.checkpoint(taskId,session,input);
  const task=h.engine.store.get(taskId),current=task.claims[0]! as any;
  assert.equal(task.claims.length,1);assert.equal(current.id,old.id);assert.equal(current.revision,old.revision+1);
  assert.equal(current.referenceArtifacts?.[0]?.sha256,digest(replacement));assert.equal(h.engine.check(taskId).ok,true);
  const before=h.engine.store.get(taskId),events=h.engine.store.events(taskId).length;
  h.engine.checkpoint(taskId,session,input);
  assert.deepEqual(h.engine.store.get(taskId),before);assert.equal(h.engine.store.events(taskId).length,events);
 });
});

test('anonymous SDK findings with dependency aliases keep their identity when referenced files change',async()=>{
 await fixture(async(h,cwd,session)=>{
  writeFileSync(join(cwd,'checks.json'),initial);const taskId=await start(h);
  const {key,...anonymous}=finding();
  const derived={...anonymous,from:['base']};
  const base={key:'base',text:'The original input is available',status:'supported' as const,basis:'Read original input',covers:[]};
  // The readable alias is initially a forward reference, then resolves to a persisted claim ID.
  h.engine.checkpoint(taskId,session,{summary:'Saved dependency chain',findings:[derived,base],artifacts:[{path:'checks.json'}]});
  const first=h.engine.store.get(taskId),old=first.claims.find(claim=>!claim.key)! as any;
  const baseId=first.claims.find(claim=>claim.key==='base')!.id;
  assert.deepEqual(old.from,[`claim:${baseId}`]);
  writeFileSync(join(cwd,'checks.json'),replacement);
  const input={summary:'Saved dependency chain',findings:[derived],artifacts:[{path:'checks.json'}]};
  h.engine.checkpoint(taskId,session,input);
  const current=h.engine.store.get(taskId),reviewed=current.claims.find(claim=>!claim.key)! as any;
  assert.equal(current.claims.length,2,'An alias must not create a second anonymous version');
  assert.equal(reviewed.id,old.id);assert.equal(reviewed.revision,old.revision+1);
  assert.deepEqual(reviewed.from,[`claim:${baseId}`]);
  assert.equal(reviewed.referenceArtifacts?.[0]?.sha256,digest(replacement));
  assert.equal(reviewed.history?.at(-1)?.referenceArtifacts?.[0]?.sha256,digest(initial));
  assert.deepEqual(current.criteria[0]!.claimIds,[old.id]);assert.equal(h.engine.check(taskId).ok,true);
  const before=h.engine.store.get(taskId),events=h.engine.store.events(taskId).length;
  h.engine.checkpoint(taskId,session,input);
  assert.deepEqual(h.engine.store.get(taskId),before);assert.equal(h.engine.store.events(taskId).length,events);
 });
});

test('same-size replacements and missing source files become stale without mutating saved findings',async()=>{
 await fixture(async(h,cwd)=>{
  assert.equal(Buffer.byteLength(initial),Buffer.byteLength(replacement));
  writeFileSync(join(cwd,'checks.json'),initial);const taskId=await start(h);
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding()],artifacts:[{path:'checks.json'}]});
  const before=h.engine.store.get(taskId),events=h.engine.store.events(taskId).length;
  writeFileSync(join(cwd,'checks.json'),replacement);
  assert.equal(referenceState(h,taskId).status,'stale');assert.equal(h.engine.check(taskId).ok,false);
  writeFileSync(join(cwd,'checks.json'),initial);assert.equal(referenceState(h,taskId).status,'current');
  unlinkSync(join(cwd,'checks.json'));
  assert.equal(referenceState(h,taskId).status,'stale');assert.ok(referenceState(h,taskId).issues.length>0);
  assert.equal(h.engine.check(taskId).ok,false);assert.deepEqual(h.engine.store.get(taskId),before);
  assert.equal(h.engine.store.events(taskId).length,events,'Read-only freshness checks must not append audit events');
 });
});

test('unknown references remain untracked while references to same-checkpoint declared files are bound',async()=>{
 await fixture(async(h,cwd)=>{
  writeFileSync(join(cwd,'notes.txt'),'unregistered source');writeFileSync(join(cwd,'checks.json'),initial);
  const taskId=await start(h);
  await h.tools.invokeModel('cairn_checkpoint',{findings:[{...finding('notes',['notes.txt','https://example.invalid/checks.json']),covers:[]}]});
  assert.equal(saved(h,taskId,'notes').referenceArtifacts?.length??0,0);
  assert.equal(referenceState(h,taskId,'notes').status,'untracked');
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding()],artifacts:[{path:'checks.json'}]});
  const tracked=saved(h,taskId);
  assert.equal(tracked.referenceArtifacts?.length,1);assert.equal(tracked.referenceArtifacts[0].path,join(cwd,'checks.json'));
  assert.equal(referenceState(h,taskId).status,'current');
  writeFileSync(join(cwd,'notes.txt'),'changed unregistered source');
  assert.equal(referenceState(h,taskId,'notes').status,'untracked');assert.equal(h.engine.check(taskId).ok,true);
 });
});

test('legacy records without reference snapshots are not backfilled by reads or artifacts-only saves',async()=>{
 await fixture(async(h,cwd)=>{
  writeFileSync(join(cwd,'checks.json'),initial);const taskId=await start(h);
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding()],artifacts:[{path:'checks.json'}]});
  h.engine.store.transaction(()=>{
   const legacy=h.engine.store.get(taskId);for(const claim of legacy.claims)Reflect.deleteProperty(claim,'referenceArtifacts');
   h.engine.store.save(legacy,'test.legacy-import',{},new Date().toISOString());
  });
  const before=h.engine.store.get(taskId),events=h.engine.store.events(taskId).length;
  assert.equal(referenceState(h,taskId).status,'untracked');assert.equal(h.engine.check(taskId).ok,true);
  assert.deepEqual(h.engine.store.get(taskId),before);assert.equal(h.engine.store.events(taskId).length,events);
  writeFileSync(join(cwd,'checks.json'),replacement);
  await h.tools.invokeModel('cairn_checkpoint',{artifacts:[{path:'checks.json'}]});
  assert.equal(referenceState(h,taskId).status,'untracked');assert.equal(saved(h,taskId).referenceArtifacts,undefined);
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'completed');
  assert.equal(saved(h,taskId).referenceArtifacts,undefined);
 });
});

test('compatibility claim API ignores forged host snapshots and derives versions from declared references',async()=>{
 await fixture(async(h,cwd,session)=>{
  writeFileSync(join(cwd,'checks.json'),initial);const taskId=await start(h);
  await h.tools.invokeModel('cairn_checkpoint',{artifacts:[{path:'checks.json'}]});
  const {covers,...authored}=finding();
  const claim=h.engine.claim(taskId,session,{...authored,supports:[],refutes:[],referenceArtifacts:[{path:join(cwd,'not-declared.secret'),sha256:'f'.repeat(64),bytes:999}]} as any) as any;
  assert.deepEqual(claim.referenceArtifacts,[{path:join(cwd,'checks.json'),sha256:digest(initial),bytes:Buffer.byteLength(initial)}]);
  h.engine.satisfy(taskId,session,'c1',[claim.id]);
  writeFileSync(join(cwd,'checks.json'),replacement);
  const revised=h.engine.claim(taskId,session,{...claim,referenceArtifacts:claim.referenceArtifacts}) as any;
  assert.equal(revised.id,claim.id);assert.equal(revised.referenceArtifacts[0].sha256,digest(replacement));
  assert.equal(referenceState(h,taskId).status,'current');
 });
});

test('asynchronous verifier file changes cannot produce an accepted current finding',async()=>{
 let calls=0;
 await fixture(async(h,cwd)=>{
  writeFileSync(join(cwd,'checks.json'),initial);const taskId=await start(h);
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding()]});
  const old=saved(h,taskId);
  const result=await h.tools.invokeModel('cairn_finish',{}) as any;
  assert.equal(calls,1);assert.equal(result.phase,'incomplete');assert.equal(result.status,'active');
  assert.equal(result.verification.status,'failed');assert.equal(result.verification.current,false);
  assert.equal(referenceState(h,taskId).status,'stale');assert.deepEqual(h.engine.check(taskId).unmet,['c1']);
  assert.deepEqual(saved(h,taskId).referenceArtifacts,old.referenceArtifacts);
 },{id:'mutating-reference-check',artifacts:['checks.json'],verify:async task=>{
  calls++;await Promise.resolve();writeFileSync(join(task.owner.cwd,'checks.json'),replacement);
  return {ok:true,method:'contract',scope:'Submission contract only'};
 }});
});

test('an unrelated proposed stale finding does not block independent current coverage',async()=>{
 await fixture(async(h,cwd)=>{
  writeFileSync(join(cwd,'checks.json'),initial);writeFileSync(join(cwd,'alternative.json'),initial);const taskId=await start(h);
  const artifacts=[{path:'checks.json'},{path:'alternative.json'}];
  await h.tools.invokeModel('cairn_checkpoint',{findings:[
   {...finding('alternative',['alternative.json']),status:'proposed',covers:[]},finding(),
  ],artifacts});
  const old=saved(h,taskId,'alternative');writeFileSync(join(cwd,'alternative.json'),replacement);
  await h.tools.invokeModel('cairn_checkpoint',{artifacts});
  assert.equal(referenceState(h,taskId,'alternative').status,'stale');assert.equal(saved(h,taskId,'alternative').status,'proposed');
  assert.deepEqual(saved(h,taskId,'alternative').referenceArtifacts,old.referenceArtifacts);
  assert.equal(referenceState(h,taskId).status,'current');assert.equal(h.engine.check(taskId).ok,true);
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'completed');
 });
});
