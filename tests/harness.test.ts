import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { ToolRuntime } from '../src/tools.js';
import { createHarness } from '../src/index.js';
import { projectTask } from '../src/ui/view.js';
import { projectGraph, layoutGraph } from '../src/ui/graph.js';
import { handleNative } from '../src/adapters/hooks.js';
import type { Session } from '../src/core/types.js';

const owner:Session={host:'mcp',sessionId:'owner',cwd:'/workspace'};
const worker:Session={host:'mcp',sessionId:'worker',cwd:'/workspace'};
function setup(){
  const store=new Store(':memory:');let time=Date.parse('2026-10-16T02:00:00Z');
  const engine=new Engine(store,()=>new Date(time));
  const task=engine.create(owner,{origin:'user',goal:'Explain and verify',criteria:['Verified'],evidenceMode:'curated'});
  return {store,engine,task,advance:(ms:number)=>{time+=ms;}};
}

test('joint dependencies resolve across an unordered batch, grow past five ranks and roll back cycles atomically',()=>{
  const {store,engine,task}=setup();
  try{
    engine.checkpoint(task.id,owner,{summary:'Multi-hop',findings:[
      {key:'result',text:'Result',basis:'Verified',from:['explore']},
      {key:'a',text:'Known A',basis:'Read A',covers:[]},{key:'b',text:'Known B',basis:'Read B',covers:[]},
    ],progress:[{key:'explore',title:'Combine A and B',status:'completed',from:['a','b']}]});
    const saved=store.get(task.id),result=saved.claims.find(c=>c.key==='result')!;
    assert.deepEqual(result.from,['work:agent:explore']);
    engine.checkpoint(task.id,owner,{summary:'Verify result',progress:[{key:'verify',title:'Verify',status:'completed',from:['result']}],findings:[{key:'final',text:'Final',basis:'Independent check',from:['verify'],covers:['c1']}]});
    const graph=projectGraph(projectTask(engine,store.get(task.id)));
    const joint=graph.edges.filter(e=>e.to==='work:explore'&&e.relation==='dependency');
    assert.equal(joint.length,2);assert.equal(new Set(joint.map(e=>e.group)).size,1);
    assert.ok(graph.nodes.find(n=>n.id==='goal')!.rank>4);
    for(const direction of ['horizontal','vertical'] as const)assert.equal(layoutGraph(graph,direction).nodes.length,graph.nodes.length);
    const before=store.get(task.id),events=store.events(task.id).length;
    assert.throws(()=>engine.checkpoint(task.id,owner,{summary:'Cycle',findings:[{key:'a',text:'A depends on the final result',from:['final']}]}),/DAG/);
    assert.deepEqual(store.get(task.id),before);assert.equal(store.events(task.id).length,events);
    assert.throws(()=>engine.recordProgress(task.id,owner,[{key:'bad',title:'Unknown',status:'pending',from:['foreign']}]),/Unknown dependency/);
    assert.deepEqual(store.get(task.id),before);
  }finally{store.close();}
});

test('ambiguous dependency keys require qualified identities and normalized retries preserve revisions',()=>{
  const {store,engine,task,advance}=setup();
  try{
    engine.checkpoint(task.id,owner,{summary:'Seed',findings:[{key:'same',text:'Known',basis:'Read',covers:[]}],progress:[{key:'same',title:'Explore',status:'completed'}]});
    assert.throws(()=>engine.checkpoint(task.id,owner,{summary:'Ambiguous',findings:[{key:'next',text:'Next',from:['same']}]}),/ambiguous/);
    const checkpoint={summary:'Unambiguous',findings:[{key:'next',text:'Next',basis:'Check',from:['work:agent:same']}]};
    engine.checkpoint(task.id,owner,checkpoint);const before=store.get(task.id),count=store.events(task.id).length;advance(2000);
    engine.checkpoint(task.id,owner,checkpoint);assert.deepEqual(store.get(task.id),before);assert.equal(store.events(task.id).length,count);
    engine.recordProgress(task.id,owner,[{key:'follow',title:'Follow',status:'pending',from:['next']}]);
    const progress=store.get(task.id),events=store.events(task.id).length;advance(2000);
    engine.recordProgress(task.id,owner,[{key:'follow',title:'Follow',status:'pending',from:['next']}]);
    assert.deepEqual(store.get(task.id),progress);assert.equal(store.events(task.id).length,events);
  }finally{store.close();}
});

test('reopen retains the finish snapshot, appends feedback and requires fresh criterion confirmation',()=>{
  const {store,engine,task}=setup();
  try{
    engine.finish(task.id,owner,{outcome:'completed',summary:'Verified',findings:[{key:'cause',text:'Cause',basis:'Observed'}]});
    const completed=store.get(task.id);engine.addHint(task.id,'External test failed');assert.equal(store.get(task.id).status,'completed');
    engine.reopen(task.id,owner,'Integration test contradicted the finding',{invalidate:['cause'],author:'human'});
    const reopened=store.get(task.id),cause=reopened.claims.find(c=>c.key==='cause')!;
    assert.equal(reopened.owner.epoch,completed.owner.epoch+1);assert.equal(cause.status,'proposed');assert.equal(cause.history?.[0]?.status,'supported');
    assert.equal(reopened.claims.at(-1)?.provenance,'human');assert.deepEqual(reopened.claims.at(-1)?.from,[`claim:${cause.id}`]);
    assert.equal(engine.finish(task.id,owner,{outcome:'completed'}).phase,'incomplete');
    assert.deepEqual(store.events(task.id).find(e=>e.kind==='task.reopened')!.payload.previous.report,completed.report);
    engine.checkpoint(task.id,owner,{summary:'Retested',findings:[{key:'cause',text:'Updated cause',status:'supported',basis:'Integration retested',covers:['c1']}]});
    engine.update(task.id,owner,{review:{snapshot:store.graphState(task.id).seq,summary:'Reviewed feedback and revalidated the revised cause'}});
    assert.equal(engine.finish(task.id,owner,{outcome:'completed'}).phase,'completed');
    assert.equal(store.get(task.id).claims.find(c=>c.key==='cause')!.history?.length,2);
  }finally{store.close();}
});

test('reopen rolls back unknown invalidations or conflicting ownership',()=>{
  const {store,engine,task}=setup();
  try{
    engine.finish(task.id,owner,{outcome:'completed',summary:'Done',findings:[{text:'Done',basis:'Checked'}]});
    const before=store.get(task.id);
    assert.throws(()=>engine.reopen(task.id,worker,'Feedback'),/takeover/);
    assert.throws(()=>engine.reopen(task.id,owner,'Feedback',{invalidate:['missing']}),/Unknown/);assert.deepEqual(store.get(task.id),before);
  }finally{store.close();}
});

test('branch leases fence competing workers, proposed findings require owner merge and promotion',async()=>{
  const {store,engine,task}=setup();const main=new ToolRuntime(engine,owner),child=new ToolRuntime(engine,worker);
  try{
    await main.invoke('cairn_checkpoint',{summary:'Delegate',progress:[{key:'inspect',title:'Inspect source',status:'pending',delegated:true}]});
    const claimed=await child.invoke('cairn_resume',{task_id:task.id,progress_key:'inspect'}) as any;
    const token=claimed.leaseToken;assert.ok(token);
    assert.ok(!JSON.stringify(engine.context(task.id)).includes(token));assert.ok(!JSON.stringify(projectTask(engine,store.get(task.id))).includes(token));
    assert.throws(()=>engine.branch(task.id,{...worker,sessionId:'other'},'inspect','claim'),/live lease/);
    await assert.rejects(child.invoke('cairn_finish',{}),/no longer owns/);
    await assert.rejects(child.invoke('cairn_checkpoint',{progress_key:'inspect',lease_token:token,summary:'Bad',findings:[{text:'Bad',status:'supported',basis:'Unreviewed'}]}),/proposed/);
    await child.invoke('cairn_checkpoint',{progress_key:'inspect',lease_token:token,branch_action:'heartbeat'});
    await child.invoke('cairn_checkpoint',{progress_key:'inspect',lease_token:token,summary:'Read source',questions:['Confirm version?'],next:'Review deployment version',findings:[{key:'cause',text:'Possible cause',basis:'Source review'}]});
    assert.deepEqual(store.get(task.id).progress?.[0]?.branchCheckpoint?.questions,['Confirm version?']);
    assert.equal(store.get(task.id).progress?.[0]?.branchCheckpoint?.next,'Review deployment version');
    const finding=store.get(task.id).claims[0]!;assert.equal(finding.provenance,'subagent');assert.equal(finding.status,'proposed');assert.deepEqual(store.get(task.id).criteria[0]?.claimIds,[]);
    assert.ok(engine.check(task.id).issues.some(issue=>issue.includes('review')));
    await main.invoke('cairn_checkpoint',{progress_key:'inspect',branch_action:'merge'});
    await main.invoke('cairn_checkpoint',{summary:'Reviewed',findings:[{key:finding.key,text:finding.text,status:'supported',covers:['c1']}]});
    assert.equal((await main.invoke('cairn_finish',{}) as any).phase,'completed');
    assert.ok(!JSON.stringify(store.events(task.id)).includes(token));
  }finally{await child.close();await main.close();store.close();}
});

test('expired and revoked branch tokens cannot write across reclamation, suspension or takeover',()=>{
  const {store,engine,task,advance}=setup();
  try{
    engine.recordProgress(task.id,owner,[{key:'inspect',title:'Inspect',status:'pending',delegated:true}]);
    const first=engine.branch(task.id,worker,'inspect','claim',undefined,undefined,10);advance(10001);
    assert.equal(projectTask(engine,store.get(task.id)).workItems[0]?.status,'blocked');
    assert.throws(()=>engine.branch(task.id,worker,'inspect','heartbeat',first.leaseToken),/expired/);
    const other={...worker,sessionId:'other'},second=engine.branch(task.id,other,'inspect','claim');
    assert.notEqual(first.leaseToken,second.leaseToken);
    assert.throws(()=>engine.branch(task.id,worker,'inspect','checkpoint',first.leaseToken,{summary:'Late'}),/expired/);
    engine.suspendByHuman(task.id);engine.resume(task.id,owner);
    assert.throws(()=>engine.branch(task.id,other,'inspect','checkpoint',second.leaseToken,{summary:'Late'}),/expired/);
    const third=engine.branch(task.id,worker,'inspect','claim');engine.resume(task.id,{...owner,sessionId:'next'},true);
    assert.throws(()=>engine.branch(task.id,worker,'inspect','checkpoint',third.leaseToken,{summary:'Late'}),/expired/);
    assert.equal(store.get(task.id).claims.length,0);
  }finally{store.close();}
});

test('reference existence is advisory by default, strict when requested and replaceable for remote hosts',()=>{
  const dir=mkdtempSync(join(tmpdir(),'cairn-refs-')),store=new Store(':memory:'),session={...owner,cwd:dir};
  try{
    writeFileSync(join(dir,'source.ts'),'verified source');const engine=new Engine(store);
    const task=engine.create(session,{origin:'user',goal:'Verify',criteria:['Verify'],evidenceMode:'curated',referencePolicy:'strict'});
    let result=engine.finish(task.id,session,{outcome:'completed',summary:'Check references',findings:[{key:'file',text:'Verified',references:['missing.ts:4']}]});
    assert.equal(result.phase,'incomplete');assert.ok(result.validation.issues.some(issue=>issue.includes('does not exist')));
    result=engine.finish(task.id,session,{outcome:'completed',summary:'Verified reference',findings:[{key:'file',text:'Verified',references:['source.ts:1','https://example.test/remote']}]});assert.equal(result.phase,'completed');
    const advisory=engine.create(session,{origin:'user',goal:'Remote',criteria:['Remote'],evidenceMode:'curated'});
    const warning=engine.finish(advisory.id,session,{outcome:'completed',summary:'Remote source',findings:[{text:'Remote source',references:['remote.ts:1']}]});assert.equal(warning.phase,'completed');assert.equal(warning.validation.warnings?.length,1);
    const remote=new Engine(store,undefined,{validateReference:()=>undefined});assert.equal(remote.evaluateReport(store.get(advisory.id),store.get(advisory.id).report!).warnings,undefined);
  }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

test('conclude requests are bounded, saved observably and never restart an interrupted session',()=>{
  const {store,engine,task}=setup();const session={...owner,host:'codex' as const};
  try{
    engine.resume(task.id,session,true);engine.recordProgress(task.id,session,[{key:'inspect',title:'Inspect',status:'running'}]);
    const event={type:'Stop',sessionId:session.sessionId,cwd:session.cwd};
    assert.match(handleNative(engine,'codex',event).continue!,/conclude request/);
    assert.equal(store.events(task.id).filter(e=>e.kind==='conclude.requested').length,1);
    handleNative(engine,'codex',event);assert.equal(store.events(task.id).filter(e=>e.kind==='conclude.requested').length,1);
    engine.checkpoint(task.id,session,{summary:'Excluded hypothesis',findings:[{text:'Hypothesis excluded',status:'refuted',basis:'Measured counterexample'}]});
    assert.equal(store.get(task.id).conclude?.status,'saved');
    handleNative(engine,'codex',{...event,type:'Interrupt'});
    assert.deepEqual(handleNative(engine,'codex',event),{continue:undefined});
  }finally{store.close();}
});

test('embedded harness has the same six tools, accepts arbitrary MCP hosts and closes idempotently',async()=>{
  const harness=createHarness({database:':memory:',session:owner});
  assert.equal((await harness.tools.list()).length,6);
  const task=await harness.tools.invoke('cairn_start',{goal:'Embedded goal'}) as any;assert.ok(task.taskId);
  const result=await harness.tools.invoke('cairn_finish',{summary:'Checked',findings:[{text:'Goal met',basis:'Application verification'}]}) as any;assert.equal(result.phase,'completed');
  await harness.close();await harness.close();await assert.rejects(harness.tools.list(),/closed/);
});

test('old connections in the same native session must explicitly resume after epoch changes',async()=>{
  const {store,engine,task}=setup(),runtime=new ToolRuntime(engine,owner);
  try{
    engine.suspendByHuman(task.id);engine.resume(task.id,owner);
    await assert.rejects(runtime.invoke('cairn_checkpoint',{summary:'Late',findings:[{text:'Stale',basis:'Old execution'}]}),/no longer owns/);
    await runtime.invoke('cairn_resume',{task_id:task.id});
    await runtime.invoke('cairn_finish',{summary:'Fresh',findings:[{text:'Fresh',basis:'New verification'}]});
    engine.reopen(task.id,owner,'External feedback');
    await assert.rejects(runtime.invoke('cairn_checkpoint',{summary:'Late after reopen'}),/no longer owns/);
    await runtime.invoke('cairn_resume',{task_id:task.id});await runtime.invoke('cairn_checkpoint',{summary:'Fresh after reopen'});
    assert.equal(store.get(task.id).claims.some(c=>c.text==='Stale'),false);
  }finally{await runtime.close();store.close();}
});

test('namespaced branch finding keys are collision-resistant and stay promotable at maximum input lengths',async()=>{
  const {store,engine,task}=setup(),main=new ToolRuntime(engine,owner);
  try{
    const cases=[['a:b','x'],['a','b:x'],['测'.repeat(200),'查'.repeat(200)]];
    for(const [index,[key,local]] of cases.entries()){
      engine.recordProgress(task.id,owner,[{key:key!,title:'Inspect',status:'pending',delegated:true}]);
      const session={...worker,sessionId:`worker-${index}`},claimed=engine.branch(task.id,session,key!,'claim');
      engine.branch(task.id,session,key!,'checkpoint',claimed.leaseToken,{summary:'Proposed',findings:[{key:local,text:`Finding ${index}`,basis:'Review'}]});
      engine.branch(task.id,owner,key!,'merge');
    }
    const claims=store.get(task.id).claims;assert.equal(new Set(claims.map(c=>c.key)).size,3);
    for(const claim of claims){assert.ok(claim.key!.length<=200);await main.invoke('cairn_checkpoint',{summary:'Reviewed',findings:[{key:claim.key,text:claim.text,status:'supported',covers:['c1']}]});}
    assert.equal(engine.check(task.id).ok,true);
  }finally{await main.close();store.close();}
});

test('late captured calls stay ineligible when the same owner resumes a suspension',()=>{
  const store=new Store(':memory:'),engine=new Engine(store);
  try{
    const task=engine.create(owner,{origin:'user',goal:'Verify',criteria:['Verify']});
    engine.beforeTool(task.id,owner,'old','read');engine.suspend(task.id,owner);engine.resume(task.id,owner);
    const result=engine.observe(task.id,owner,{callId:'old',tool:'read',input:{},output:'Late result',source:'hook',status:'success'});
    assert.equal(result.eligible,false);assert.equal(result.actor.epoch,1);
    engine.beforeTool(task.id,owner,'new','read');assert.equal(engine.observe(task.id,owner,{callId:'new',tool:'read',input:{},output:'Fresh result',source:'hook',status:'success'}).eligible,true);
  }finally{store.close();}
});
