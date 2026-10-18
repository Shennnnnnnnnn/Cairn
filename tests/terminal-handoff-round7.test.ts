import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHarness,Store,type Task,type Session} from '../src/index.js';
import {ToolRuntime} from '../src/tools.js';

const owner:Session={host:'pi',sessionId:'terminal-handoff-owner',cwd:'/workspace'};
const oldNext='Test the remaining alternative before finishing';
const finding=(covers:string[]=[])=>({key:'result',text:'The required input produced the expected result',status:'supported',basis:'Repeated the required input and inspected its output',covers});
function latestHost(task:Task){
 const handoff=task.handoffs?.findLast(item=>item.key==='@host/state');
 assert.ok(handoff,'The host must save the current task state');
 return handoff;
}

test('completed model finish retires the active agenda without rewriting saved checkpoints or handoffs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cairn-terminal-handoff-')),session={...owner,cwd:dir};
 let verificationCalls=0;
 const h=createHarness({database:join(dir,'state.db'),session,completionVerifier:{id:'terminal-contract',verify:()=>{verificationCalls++;return {ok:true,scope:'Required output contract'};}}});
 try{
  const started=await h.tools.invokeModel('cairn_start',{goal:'Return the verified output',criteria:['Return the verified output']}) as any;
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding(['c1'])],questions:['Could another input behave differently?'],next:oldNext});
  const before=h.engine.store.get(started.taskId),previousHandoff=latestHost(before),previousFile=readFileSync(previousHandoff.report!,'utf8');
  const receipt=await h.tools.invokeModel('cairn_finish',{}) as any;
  assert.equal(receipt.phase,'completed');assert.equal(receipt.exploration.mode,'completed');assert.equal(receipt.exploration.next,undefined);
  const context=await h.tools.invokeModel('cairn_read',{view:'context'}) as any;
  assert.equal(context.status,'completed');assert.equal(context.exploration.mode,'completed');assert.equal(context.exploration.next,undefined);assert.equal(context.checkpoint?.next,undefined);
  const completed=h.engine.store.get(started.taskId),currentHandoff=latestHost(completed);
  assert.deepEqual(completed.checkpoint,before.checkpoint,'Retiring an agenda is a projection, not an edit to the saved checkpoint');
  assert.equal(completed.checkpoint?.next,oldNext);assert.notEqual(currentHandoff.next,oldNext);assert.match(currentHandoff.next!,/complet|reuse|reopen|完成|复用/i);
  assert.notEqual(currentHandoff.id,previousHandoff.id);assert.deepEqual(completed.handoffs?.find(item=>item.id===previousHandoff.id),previousHandoff);assert.equal(readFileSync(previousHandoff.report!,'utf8'),previousFile);
  assert.ok(context.handoffs.some((item:any)=>item.id===currentHandoff.id));assert.equal(context.verification.current,true);assert.equal(verificationCalls,1);
  const revision=completed.revision,handoffs=completed.handoffs?.length,events=h.engine.store.events(started.taskId).length;
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'completed');
  const retried=h.engine.store.get(started.taskId);
  assert.equal(retried.revision,revision);assert.equal(retried.handoffs?.length,handoffs);assert.equal(h.engine.store.events(started.taskId).length,events);assert.equal(verificationCalls,1);
  const historical=await h.tools.invokeModel('cairn_read',{view:'handoffs',ref:previousHandoff.id}) as any;
  assert.equal(JSON.parse(historical.chunk).next,oldNext);
 }finally{await h.close();rmSync(dir,{recursive:true,force:true});}
});

test('reopen immediately saves the new owner generation and revalidation agenda while preserving old acceptance',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cairn-reopened-handoff-')),session={...owner,cwd:dir},database=join(dir,'state.db');
 const completionVerifier={id:'reopen-contract',verify:()=>({ok:true,scope:'Required output contract'})};
 let h=createHarness({database,session,completionVerifier});
 try{
  const started=await h.tools.invokeModel('cairn_start',{goal:'Return the verified output'}) as any;
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding(['c1'])],next:oldNext});
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'completed');
  const completed=h.engine.store.get(started.taskId),closedHandoff=latestHost(completed),closedFile=readFileSync(closedHandoff.report!,'utf8');
  await h.close();
  const replacement={...session,sessionId:'terminal-replacement'};h=createHarness({database,session:replacement,completionVerifier});
  const reason='A new input contradicts the saved result';
  const context=await h.tools.invokeModel('cairn_resume',{task_id:started.taskId,takeover:true,reopen_reason:reason}) as any;
  const reopened=h.engine.store.get(started.taskId),currentHandoff=latestHost(reopened);
  assert.equal(context.status,'active');assert.equal(reopened.owner.epoch,completed.owner.epoch+1);assert.equal(currentHandoff.source?.epoch,reopened.owner.epoch);assert.equal(currentHandoff.source?.sessionId,replacement.sessionId);assert.equal(currentHandoff.source?.reason,'reopened');assert.equal(currentHandoff.source?.revision,reopened.revision);
  assert.equal(currentHandoff.next,reopened.checkpoint?.next);assert.match(currentHandoff.next!,/revalid|recheck|重新|核验/i);assert.match(currentHandoff.summary,/contradicts/);
  assert.ok(context.handoffs.some((item:any)=>item.id===currentHandoff.id));assert.equal(context.exploration.next,reopened.checkpoint?.next);assert.notEqual(context.exploration.mode,'completed');
  assert.equal(context.verification.current,false);assert.deepEqual(reopened.verification,completed.verification,'The old receipt remains an immutable record but cannot accept the new generation');assert.equal(h.engine.verificationCurrent(reopened),false);assert.deepEqual(reopened.criteria[0]?.claimIds,[]);
  assert.notEqual(currentHandoff.source?.candidate,closedHandoff.source?.candidate);assert.deepEqual(reopened.handoffs?.find(item=>item.id===closedHandoff.id),closedHandoff);assert.equal(readFileSync(closedHandoff.report!,'utf8'),closedFile);
 }finally{await h.close();rmSync(dir,{recursive:true,force:true});}
});

test('three relevant manual handoffs do not evict the current host state from bounded context',async()=>{
 const h=createHarness({database:':memory:',session:owner});
 try{
  const started=await h.tools.invokeModel('cairn_start',{goal:'Return the verified output'}) as any;
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding(['c1'])],next:oldNext,handoffs:Array.from({length:3},(_,index)=>({key:`attempt-${index}`,summary:`Saved comparison ${index}`,from:['result'],next:`Inspect comparison ${index}`}))});
  for(const completed of [false,true]){
   if(completed)assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'completed');
   const saved=h.engine.store.get(started.taskId),currentHandoff=latestHost(saved),context=await h.tools.invokeModel('cairn_read',{view:'context',focus:'c1'}) as any;
   assert.ok(context.handoffs.some((item:any)=>item.id===currentHandoff.id),`Current host state is required in ${completed?'completed':'active'} context`);assert.ok(context.handoffs.length<=3);assert.ok(Buffer.byteLength(JSON.stringify(context),'utf8')<=16384);
   assert.equal(saved.handoffs?.filter(item=>!item.source).length,3,'Context selection must not delete manual history');
  }
  const historical=await h.tools.invokeModel('cairn_read',{view:'handoffs',ref:'attempt-0'}) as any;assert.equal(JSON.parse(historical.chunk).next,'Inspect comparison 0');
 }finally{await h.close();}
});

test('worker submission keeps its own next step before and after owner completion',async()=>{
 const h=createHarness({database:':memory:',session:owner}),worker={...owner,sessionId:'terminal-branch-worker'},workerTools=new ToolRuntime(h.engine,worker);
 try{
  const started=await h.tools.invokeModel('cairn_start',{goal:'Return the verified output',progress:[{key:'compare',title:'Compare another input',status:'pending',delegated:true}]}) as any;
  await h.tools.invokeModel('cairn_checkpoint',{next:oldNext});
  const lease=await workerTools.invokeModel('cairn_resume',{task_id:started.taskId,progress_key:'compare'}) as any,branchNext='Owner should verify the branch proposal in the required environment';
  await workerTools.invokeModel('cairn_checkpoint',{progress_key:'compare',lease_token:lease.leaseToken,summary:'The worker comparison is saved',findings:[{key:'alternative',text:'The second input produced the expected output',status:'proposed',basis:'Worker recorded the second input and output',covers:[]}],questions:['Does the target environment match?'],next:branchNext});
  const submitted=h.engine.store.get(started.taskId),item=submitted.progress?.find(value=>value.key==='compare'),branchHandoff=submitted.handoffs?.findLast(value=>value.source?.branchKey==='compare');
  assert.ok(branchHandoff);assert.equal(submitted.status,'active');assert.equal(item?.status,'completed');assert.equal(item?.branchStatus,'submitted');assert.equal(item?.branchCheckpoint?.next,branchNext);assert.equal(branchHandoff.next,branchNext);assert.equal(branchHandoff.source?.sessionId,worker.sessionId);assert.equal(submitted.checkpoint?.next,oldNext);assert.deepEqual(submitted.criteria[0]?.claimIds,[]);
  const proposal=submitted.claims.find(value=>value.branchKey==='compare')!;assert.equal(proposal.status,'proposed');
  await h.tools.invokeModel('cairn_checkpoint',{progress_key:'compare',branch_action:'merge'});
  await h.tools.invokeModel('cairn_checkpoint',{findings:[{key:proposal.key,text:proposal.text,status:'supported',basis:'Owner repeated the branch check in the required environment',covers:['c1']}]});
  const receipt=await h.tools.invokeModel('cairn_finish',{}) as any;assert.equal(receipt.phase,'completed');assert.equal(receipt.exploration.next,undefined);
  const completed=h.engine.store.get(started.taskId);assert.equal(completed.progress?.find(value=>value.key==='compare')?.branchCheckpoint?.next,branchNext);assert.deepEqual(completed.handoffs?.find(value=>value.id===branchHandoff.id),branchHandoff);
  const historical=await h.tools.invokeModel('cairn_read',{view:'handoffs',ref:branchHandoff.id}) as any;assert.equal(JSON.parse(historical.chunk).next,branchNext);
 }finally{await workerTools.close();await h.close();}
});

test('suspension and a fresh-session takeover retain actionable questions and next steps',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cairn-suspended-handoff-')),session={...owner,cwd:dir},database=join(dir,'state.db');
 let h=createHarness({database,session});
 try{
  const started=await h.tools.invokeModel('cairn_start',{goal:'Return the verified output'}) as any;
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding()],questions:['Which input is deployed?'],next:oldNext});
  const receipt=await h.tools.invokeModel('cairn_finish',{outcome:'suspended'}) as any;assert.equal(receipt.phase,'suspended');assert.equal(receipt.exploration.next,oldNext);
  const suspended=h.engine.store.get(started.taskId),handoff=latestHost(suspended),savedFile=readFileSync(handoff.report!,'utf8');assert.equal(handoff.next,oldNext);
  await h.close();h=createHarness({database,session:{...session,sessionId:'suspended-replacement'}});
  const context=await h.tools.invokeModel('cairn_resume',{task_id:started.taskId,takeover:true}) as any;
  assert.equal(context.status,'active');assert.equal(context.owner.epoch,suspended.owner.epoch+1);assert.equal(context.checkpoint.next,oldNext);assert.equal(context.exploration.next,oldNext);assert.deepEqual(context.checkpoint.questions,['Which input is deployed?']);assert.equal(readFileSync(handoff.report!,'utf8'),savedFile);assert.deepEqual(h.engine.store.get(started.taskId).handoffs?.find(item=>item.id===handoff.id),handoff);
 }finally{await h.close();rmSync(dir,{recursive:true,force:true});}
});

test('reading a legacy completed database retires its saved host next without migrating history',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'cairn-legacy-completed-handoff-')),session={...owner,cwd:dir},database=join(dir,'state.db');
 let h=createHarness({database:':memory:',session});
 try{
  const started=await h.tools.invokeModel('cairn_start',{goal:'Return the verified output'}) as any;
  await h.tools.invokeModel('cairn_checkpoint',{findings:[finding(['c1'])],next:oldNext});
  assert.equal((await h.tools.invokeModel('cairn_finish',{}) as any).phase,'completed');
  const legacy=h.engine.store.get(started.taskId),legacyHandoff=latestHost(legacy),previousNext=legacyHandoff.next;
  // Build the pre-upgrade record in a disposable database. The old generator
  // copied checkpoint.next into the completed host handoff and its report.
  legacyHandoff.next=oldNext;legacyHandoff.detail=legacyHandoff.detail!.replace(`Next: ${previousNext}`,`Next: ${oldNext}`);
  legacyHandoff.report=join(dir,'legacy-handoff.md');writeFileSync(legacyHandoff.report,legacyHandoff.detail,{encoding:'utf8',flag:'wx',mode:0o600});
  const legacyFile=readFileSync(legacyHandoff.report,'utf8');assert.ok(legacyFile.includes(`Next: ${oldNext}`));
  await h.close();
  const fixture=new Store(database);try{fixture.save(legacy,'fixture.legacy-import',{},new Date().toISOString());}finally{fixture.close();}
  h=createHarness({database,session});
  const persisted=()=>h.engine.store.db.prepare('SELECT state FROM tasks WHERE id=?').get(started.taskId)!.state;
  const before=persisted(),events=h.engine.store.events(started.taskId).length;
  const context=await h.tools.invokeModel('cairn_read',{view:'context',task_id:started.taskId}) as any,currentHost=context.handoffs.find((item:any)=>item.id===legacyHandoff.id);
  assert.equal(context.status,'completed');assert.equal(context.exploration.mode,'completed');assert.equal(context.exploration.next,undefined);assert.equal(context.checkpoint.next,undefined);assert.equal(context.checkpoint.historicalNext,oldNext);
  assert.ok(currentHost);assert.notEqual(currentHost.next,oldNext);assert.match(currentHost.next,/complet|reuse|reopen|完成|复用/i);assert.equal(currentHost.historicalNext,oldNext);
  assert.equal(persisted(),before,'Reading an old completed task must not rewrite or migrate its persisted state');assert.equal(h.engine.store.events(started.taskId).length,events);assert.equal(h.engine.store.get(started.taskId).revision,legacy.revision);assert.equal(readFileSync(legacyHandoff.report,'utf8'),legacyFile);
  const historical=await h.tools.invokeModel('cairn_read',{view:'handoffs',task_id:started.taskId,ref:legacyHandoff.id}) as any;assert.equal(JSON.parse(historical.chunk).next,oldNext);assert.equal(persisted(),before);
 }finally{await h.close();rmSync(dir,{recursive:true,force:true});}
});
