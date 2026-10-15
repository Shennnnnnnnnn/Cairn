import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { ToolRuntime, coreCatalog } from '../src/tools.js';
import { handleNative, normalize, isCairnTool } from '../src/adapters/hooks.js';
import { projectTask, projectEvent } from '../src/ui/view.js';
import { projectGraph } from '../src/ui/graph.js';
import { checkpointActors } from '../src/ui/replay.js';
import type { Host } from '../src/core/types.js';

function fixture(host:Host='codex',path=':memory:') {
  let time=Date.parse('2026-10-15T10:00:00Z');
  const store=new Store(path),engine=new Engine(store,()=>new Date(time)),session={host,sessionId:'immediate-main',cwd:'/fixture'};
  const runtime=new ToolRuntime(engine,session);
  const event=(type:string,id='child')=>normalize(host,{hook_event_name:type,session_id:session.sessionId,cwd:session.cwd,agent_id:id,agent_type:'read-only',last_assistant_message:'SECRET_REPORT',tool_name:'SECRET_TOOL',tool_input:'SECRET_INPUT',tool_response:'SECRET_OUTPUT'});
  return {store,engine,session,runtime,event,advance:(ms=1000)=>{time+=ms;},now:()=>new Date(time).toISOString()};
}

test('all hosts persist individual semantic changes with compact, idempotent receipts',async()=>{
  for(const host of ['pi','claude','codex','mcp'] as Host[]){
    const f=fixture(host);try{
      const start=await f.runtime.invoke('cairn_start',{goal:'verify actual behavior'}) as any;
      const pending={branch:{key:'main',title:'actual check',status:'pending'}};
      const first=await f.runtime.invoke('cairn_update',pending) as any;
      assert.equal(first.changed,true);assert.ok(JSON.stringify(first).length<500);
      f.advance(2000);
      const retry=await f.runtime.invoke('cairn_update',pending) as any;
      assert.equal(retry.changed,false);assert.deepEqual(retry.receipt,first.receipt);
      f.advance(5000);
      const running=await f.runtime.invoke('cairn_update',{branch:{key:'main',status:'running'}}) as any;
      f.advance(9000);
      await f.runtime.invoke('cairn_update',{finding:{key:'cause',text:'A checked fact',basis:'Read the fixture',references:['fixture.json'],branch:'main',covers:['c1']}});
      f.advance(3000);
      await f.runtime.invoke('cairn_update',{branch:{key:'main',status:'completed',summary:'Actually checked'}});
      const events=f.store.events(start.taskId);
      assert.deepEqual(events.map(e=>e.kind),['task.created','branch.updated','branch.updated','finding.updated','branch.updated']);
      assert.equal(Date.parse(running.receipt.at)-Date.parse(first.receipt.at),7000);
      assert.equal(f.store.historical(start.taskId,first.receipt.seq).task.branches![0]!.status,'pending');
      assert.equal(f.store.historical(start.taskId,running.receipt.seq).task.branches![0]!.status,'running');
      assert.equal(projectEvent(events[2]!).title,'分支 · 执行中');
      assert.deepEqual(f.store.get(start.taskId).calls,{});assert.deepEqual(f.store.get(start.taskId).observations,[]);
      const count=events.length;
      await assert.rejects(f.runtime.invoke('cairn_update',{branch:{key:'main',status:'running'},progress:{key:'p',title:'p',status:'running'}}));
      await assert.rejects(f.runtime.invoke('cairn_update',{branch:{key:'new',status:'running'}}),/title/);
      assert.equal(f.store.events(start.taskId).length,count);
      assert.equal((await f.runtime.invoke('cairn_finish',{} ) as any).status,'completed');
    }finally{await f.runtime.close();f.store.close();}
  }
});

test('update catalog enforces one entity and the native adapters exempt only actual Cairn updates',()=>{
  const schema=coreCatalog().find(t=>t.name==='cairn_update')!.inputSchema;
  assert.deepEqual(schema.oneOf,[{required:['branch']},{required:['progress']},{required:['finding']}]);
  for(const [host,name] of [['pi','cairn_update'],['codex','mcp__cairn__cairn_update'],['claude','mcp__plugin_cairn_cairn__cairn_update']] as [Host,string][]){
    assert.equal(isCairnTool(host,name),true);assert.equal(isCairnTool(host,`foreign_${name}`),false);
  }
});

test('child return, review start and accepted completion have separate saved states',async()=>{
  const f=fixture();try{
    const t=f.engine.create(f.session,{origin:'test',goal:'review',criteria:['proof'],evidenceMode:'curated'});
    await f.runtime.invoke('cairn_resume',{task_id:t.id});
    await f.runtime.invoke('cairn_update',{branch:{key:'logs',title:'logs',executor:'subagent',agentId:'child',status:'pending'}});
    f.advance();handleNative(f.engine,'codex',f.event('SubagentStart'));
    assert.equal(projectTask(f.engine,f.store.get(t.id)).branches[0]!.status,'running');
    await assert.rejects(f.runtime.invoke('cairn_update',{branch:{key:'logs',status:'reviewing'}}),/still reports/);
    f.advance();handleNative(f.engine,'codex',f.event('SubagentStop'));
    const returned=f.store.events(t.id).at(-1)!;
    await assert.rejects(f.runtime.invoke('cairn_update',{branch:{key:'logs',status:'completed',summary:'too soon'}}),/reviewing/);
    f.advance();const review=await f.runtime.invoke('cairn_update',{branch:{key:'logs',status:'reviewing'}}) as any;
    const view=projectTask(f.engine,f.store.get(t.id)),graph=projectGraph(view);
    assert.equal(graph.nodes.find(n=>n.id==='branch:logs')!.status,'review');
    assert.equal(graph.nodes.find(n=>n.id==='review:logs')!.status,'running');
    assert.equal(checkpointActors(view).main.reviewing,1);
    f.advance();await f.runtime.invoke('cairn_update',{finding:{key:'fact',text:'Verified',basis:'Actual check',branch:'logs'}});
    f.advance();const accepted=await f.runtime.invoke('cairn_update',{branch:{key:'logs',status:'completed',summary:'Actually reviewed'}}) as any;
    assert.equal(projectTask(f.engine,f.store.historical(t.id,returned.seq).task).branches[0]!.status,'awaiting_review');
    assert.equal(f.store.historical(t.id,review.receipt.seq).task.branches![0]!.status,'reviewing');
    assert.equal(f.store.historical(t.id,accepted.receipt.seq).task.branches![0]!.status,'completed');
    assert.equal(projectGraph(projectTask(f.engine,f.store.get(t.id))).nodes.find(n=>n.id==='review:logs')!.status,'completed');
    assert.ok(!JSON.stringify(f.store.get(t.id)).includes('SECRET_'));
  }finally{await f.runtime.close();f.store.close();}
});

test('native lifecycle is saved and graphed before ID registration, survives restart and later links exactly',async()=>{
  const root=mkdtempSync(join(tmpdir(),'cairn-pending-native-')),path=join(root,'state.db');
  let f=fixture('codex',path);try{
    const task=f.engine.create(f.session,{origin:'test',goal:'review',criteria:['done'],evidenceMode:'curated'});
    const before=f.store.events(task.id).length;
    handleNative(f.engine,'codex',f.event('SubagentStart'));const startedAt=f.now();
    handleNative(f.engine,'codex',f.event('SubagentStart'));
    f.advance(4000);handleNative(f.engine,'codex',f.event('SubagentStop'));const returnedAt=f.now();
    assert.equal(f.store.events(task.id).length,before+2,'native states do not wait for model reporting');
    const live=f.store.get(task.id);assert.equal(live.branches,undefined);
    assert.equal(projectGraph(projectTask(f.engine,live)).nodes.find(node=>node.kind==='agent')!.status,'review');
    const launched=f.store.events(task.id).find(event=>event.kind==='agent.started')!;
    assert.equal(projectGraph(projectTask(f.engine,f.store.historical(task.id,launched.seq).task)).nodes.find(node=>node.kind==='agent')!.status,'running');
    await f.runtime.close();f.store.close();f=fixture('codex',path);f.advance(10_000);
    const update=f.engine.update(task.id,f.session,{branch:{key:'logs',title:'logs',executor:'subagent',agentId:'child',status:'running'}});
    const current=f.store.get(task.id),run=current.agentRuns![0]!;
    assert.equal(run.startedAt,startedAt);assert.equal(run.returnedAt,returnedAt);
    assert.equal(update.branch!.source,'host');assert.equal(update.branch!.status,'awaiting_review');
    assert.ok(!projectGraph(projectTask(f.engine,current)).nodes.some(node=>node.kind==='agent'),'exact association replaces the standalone execution node');
    assert.equal(update.receipt!.at,f.now(),'association commits at its real current time');
    assert.ok(!JSON.stringify(f.store.events(task.id)).includes('SECRET_'));
  }finally{await f.runtime.close();f.store.close();rmSync(root,{recursive:true,force:true});}
});

test('native executions cannot cross goal or ownership epochs and late returns stay with the original goal',()=>{
  const f=fixture();try{
    const a=f.engine.create(f.session,{origin:'test',goal:'A',criteria:['done'],evidenceMode:'curated'});
    handleNative(f.engine,'codex',f.event('SubagentStart'));f.engine.suspend(a.id,f.session);
    const b=f.engine.create(f.session,{origin:'test',goal:'B',criteria:['done'],evidenceMode:'curated'});
    handleNative(f.engine,'codex',f.event('SubagentStop'));
    assert.equal(f.store.get(a.id).agentRuns![0]!.status,'returned');
    assert.equal(f.store.get(b.id).agentRuns,undefined);
    f.engine.update(b.id,f.session,{branch:{key:'different',title:'not A',executor:'subagent',agentId:'child',status:'running'}});
    assert.equal(f.store.get(b.id).agentRuns,undefined);
    f.engine.suspend(b.id,f.session);
    const owner={...f.session,sessionId:'replacement'};f.engine.resume(a.id,owner,true);
    f.engine.update(a.id,owner,{branch:{key:'new',title:'new epoch',executor:'subagent',agentId:'child',status:'running'}});
    assert.ok(f.store.get(a.id).agentRuns!.every(run=>run.epoch===1),'old executions do not transfer to a new owner');
  }finally{f.store.close();}
});

test('an early running child cannot be accepted and failed persistence rolls back its association',()=>{
  const f=fixture();try{
    const task=f.engine.create(f.session,{origin:'test',goal:'A',criteria:['done'],evidenceMode:'curated'});
    handleNative(f.engine,'codex',f.event('SubagentStart'));
    const before=JSON.stringify(f.store.get(task.id));
    assert.throws(()=>f.engine.update(task.id,f.session,{branch:{key:'logs',title:'logs',executor:'subagent',agentId:'child',status:'completed',summary:'premature'}}),/still reports/);
    assert.equal(JSON.stringify(f.store.get(task.id)),before);
    f.store.db.exec("CREATE TRIGGER reject_history BEFORE INSERT ON task_history BEGIN SELECT RAISE(ABORT,'fixture history failure'); END");
    assert.throws(()=>f.engine.update(task.id,f.session,{branch:{key:'logs',title:'logs',executor:'subagent',agentId:'child',status:'running'}}),/fixture history failure/);
    assert.equal(JSON.stringify(f.store.get(task.id)),before);
    assert.equal(f.store.events(task.id).length,2);
  }finally{f.store.close();}
});

test('pausing during review persists the interruption and resume does not infer a running review',()=>{
  const f=fixture();try{
    const t=f.engine.create(f.session,{origin:'test',goal:'A',criteria:['done'],evidenceMode:'curated'});
    f.engine.update(t.id,f.session,{branch:{key:'child',title:'child',executor:'subagent',status:'awaiting_review'}});
    f.engine.update(t.id,f.session,{branch:{key:'child',status:'reviewing'}});
    handleNative(f.engine,'codex',{type:'Interrupt',sessionId:f.session.sessionId,cwd:f.session.cwd});
    assert.equal(f.store.get(t.id).status,'suspended');assert.equal(f.store.get(t.id).branches![0]!.status,'blocked');
    f.engine.resume(t.id,f.session);assert.equal(projectTask(f.engine,f.store.get(t.id)).branches[0]!.status,'blocked');
  }finally{f.store.close();}
});

test('an observed old child cannot attach to a fresh goal after its former owner loses the task',()=>{
  const f=fixture();try{
    const a=f.engine.create(f.session,{origin:'test',goal:'A',criteria:['done'],evidenceMode:'curated'});
    handleNative(f.engine,'codex',f.event('SubagentStart'));
    const owner={...f.session,sessionId:'new-owner'};
    f.engine.resume(a.id,owner,true);f.engine.suspend(a.id,owner);
    const b=f.engine.create(f.session,{origin:'test',goal:'B',criteria:['done'],evidenceMode:'curated'});
    handleNative(f.engine,'codex',f.event('SubagentStart'));
    handleNative(f.engine,'codex',f.event('SubagentStop'));
    assert.equal(f.store.get(b.id).agentRuns,undefined);
    assert.equal(f.store.get(a.id).agentRuns![0]!.status,'running','old-owner returns cannot alter the taken-over goal');
  }finally{f.store.close();}
});

test('native main-session end pauses unfinished work once and child session end cannot pause its parent',()=>{
  const f=fixture();try{
    const task=f.engine.create(f.session,{origin:'test',goal:'unfinished',criteria:['done'],evidenceMode:'curated',progress:[{key:'work',title:'work',status:'running'}]});
    handleNative(f.engine,'codex',f.event('SubagentStart'));
    handleNative(f.engine,'codex',f.event('SessionEnd'));
    assert.equal(f.store.get(task.id).status,'active','a child cannot end the parent goal');
    const end={type:'SessionEnd',sessionId:f.session.sessionId,cwd:f.session.cwd};
    handleNative(f.engine,'codex',end);
    assert.equal(f.store.get(task.id).status,'suspended');assert.equal(f.store.get(task.id).progress![0]!.status,'blocked');
    const events=f.store.events(task.id);assert.equal(events.at(-1)!.payload.input.source,'host');
    handleNative(f.engine,'codex',end);assert.equal(f.store.events(task.id).length,events.length);
    f.engine.resume(task.id,f.session);assert.equal(f.store.get(task.id).progress![0]!.status,'blocked');
  }finally{f.store.close();}
});
