import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { projectTask } from '../src/ui/view.js';
import { projectGraph, layoutGraph } from '../src/ui/graph.js';
import { compareCheckpoint, checkpointActors } from '../src/ui/replay.js';
import { startUi } from '../src/ui/server.js';

const session={host:'codex' as const,sessionId:'checkpoint-main',cwd:'/fixture'};
function fixture(){
  let now=Date.parse('2026-10-15T10:00:00Z');
  const store=new Store(':memory:'),engine=new Engine(store,()=>new Date(now+=1000));
  const task=engine.create(session,{origin:'合成检查点测试',goal:'核对原因并验证修复',criteria:['原因有依据','实际回归通过'],evidenceMode:'curated',branches:[
    {key:'logs',title:'核对日志',executor:'subagent',assignee:'日志助手',status:'pending'},
    {key:'changes',title:'核对变更',executor:'subagent',assignee:'变更助手',status:'pending'},
    {key:'main',title:'主会话复现',executor:'main',status:'pending'},
    {key:'fix',title:'修复回归',executor:'main',parent:'main',status:'pending'},
  ]});
  const frame=()=>{const row=store.events(task.id).at(-1)!;return {seq:row.seq,view:projectTask(engine,store.get(task.id),row.at)};};
  const frames=[frame()];
  engine.checkpoint(task.id,session,{summary:'两个助手和主会话独立推进',branches:[
    {key:'logs',title:'核对日志',executor:'subagent',agentId:'logs-real-id',status:'running'},
    {key:'changes',title:'核对变更',executor:'subagent',agentId:'changes-real-id',status:'running'},
    {key:'main',title:'主会话复现',status:'running'},
  ]});frames.push(frame());
  engine.checkpoint(task.id,session,{summary:'日志助手先返回，其他方向继续',branches:[{key:'logs',title:'核对日志',status:'awaiting_review',summary:'返回样本，等待主会话核对'}],findings:[{key:'cause',branch:'logs',text:'样本存在百倍偏差',status:'proposed',basis:'待核对的样本说明',references:['fixture/logs.json'],covers:[]}]});frames.push(frame());
  engine.checkpoint(task.id,session,{summary:'复核日志后推进修复，不等待另一个助手',branches:[
    {key:'logs',title:'核对日志',status:'completed',summary:'主会话独立核对样本并接受结果'},
    {key:'main',title:'主会话复现',status:'completed',summary:'实际复现一致'},
    {key:'fix',title:'修复回归',status:'running'},
  ],findings:[{key:'cause',branch:'logs',text:'样本存在百倍偏差',status:'supported',covers:['c1']}]});frames.push(frame());
  return {store,engine,task,frames,frame};
}

test('checkpoint deltas group batch transitions while preserving independent ongoing work',()=>{
  const f=fixture();try{
    const [initial,running,returned,reviewed]=f.frames;
    const launched=compareCheckpoint(running!.view,initial!.view,{previousSeq:initial!.seq});
    assert.equal(launched.changes.filter(c=>c.kind==='branch').length,3);
    assert.ok(launched.changes.filter(c=>c.kind==='branch').every(c=>c.label==='开始执行'));
    assert.ok(!launched.highlighted.includes('origin'));assert.ok(!launched.highlighted.includes('goal'));
    const delta=compareCheckpoint(returned!.view,running!.view,{previousSeq:running!.seq});
    assert.equal(delta.previous!.seq,running!.seq);assert.ok(delta.elapsedMs!>0);
    const branches=delta.changes.filter(c=>c.kind==='branch');assert.equal(branches.length,1);
    assert.equal(branches[0]!.label,'返回待汇总');assert.equal(branches[0]!.actor,'subagent');
    assert.ok(delta.highlighted.includes('branch:logs'));assert.ok(delta.highlighted.includes('review:logs'));
    assert.ok(!delta.highlighted.includes('branch:changes'));assert.ok(!delta.highlighted.includes('branch:main'));
    assert.ok(!delta.changes.some(c=>c.kind==='review'),'one return is one grouped branch transition');
    const actors=checkpointActors(returned!.view);assert.equal(actors.main.running,1);assert.equal(actors.main.review,1);assert.equal(actors.subagent.running,1);assert.equal(actors.subagent.returned,1);
    const accepted=compareCheckpoint(reviewed!.view,returned!.view);
    assert.equal(accepted.changes.find(c=>c.nodeId==='branch:logs')!.label,'主 Agent 复核完成');
    assert.equal(accepted.changes.find(c=>c.nodeId==='branch:fix')!.label,'开始执行');
    assert.ok(!accepted.highlighted.includes('branch:changes'),'a still-running helper did not end with another branch');
    const claim=reviewed!.view.claims[0]!;
    assert.ok(accepted.highlighted.includes(`claim:${claim.id}`));assert.ok(!accepted.highlighted.includes(`basis:${claim.id}`),'accepting a conclusion does not invent a new basis');
  }finally{f.store.close();}
});

test('timestamps, storage revisions and summary-only saves do not highlight unchanged nodes',()=>{
  const f=fixture();try{
    const previous=structuredClone(f.frames[2]!.view),next=structuredClone(previous);
    previous.claims[0]!.scope={project:'demo',environment:'local'};next.claims[0]!.scope={environment:'local',project:'demo'};
    previous.claims[0]!.references=['a.json','b.json'];next.claims[0]!.references=['b.json','a.json'];
    next.revision+=100;next.updatedAt='2026-10-15T12:00:00Z';next.checkpoint!.at=next.updatedAt;next.checkpoint!.summary='仅补充阶段说明';
    for(const branch of next.branches)branch.updatedAt=next.updatedAt;
    for(const claim of next.claims){claim.revision++;claim.updatedAt=next.updatedAt;}
    const delta=compareCheckpoint(next,previous);
    assert.deepEqual(delta.highlighted,[]);assert.deepEqual(delta.changes,[]);assert.equal(delta.summaryChanged,true);
    next.report!.summary='只更新报告';assert.equal(compareCheckpoint(next,previous).reportChanged,true);assert.deepEqual(compareCheckpoint(next,previous).highlighted,[]);
  }finally{f.store.close();}
});

test('basis edits and removals are compared by saved content rather than graph positions',()=>{
  const f=fixture();try{
    const previous=f.frames[2]!.view,next=structuredClone(previous),claim=next.claims[0]!;
    claim.basis='新的样本说明';claim.references=['fixture/new-logs.json'];
    const changed=compareCheckpoint(next,previous);
    assert.deepEqual(changed.highlighted,[`basis:${claim.id}`]);
    claim.basis='';claim.references=[];
    const removed=compareCheckpoint(next,previous);
    assert.equal(removed.changes.find(c=>c.nodeId===`basis:${claim.id}`)!.change,'removed');
    assert.ok(!removed.highlighted.includes(`basis:${claim.id}`),'no ghost node for removed information');
    assert.ok(!removed.highlighted.includes('branch:main'));
    const reassigned=structuredClone(previous);reassigned.branches.find(b=>b.key==='logs')!.executor='main';
    const moved=compareCheckpoint(reassigned,previous);
    assert.equal(moved.changes.find(c=>c.nodeId==='branch:logs')!.label,'更新负责人');
    assert.ok(moved.highlighted.includes(`basis:${claim.id}`));assert.ok(moved.highlighted.includes(`claim:${claim.id}`));
  }finally{f.store.close();}
});

test('review nodes derive from branch acceptance and actor lanes keep actual ownership separate',()=>{
  const f=fixture();try{
    const waiting=projectGraph(f.frames[2]!.view),accepted=projectGraph(f.frames[3]!.view);
    assert.equal(waiting.nodes.find(n=>n.id==='review:logs')!.actor,'main');assert.equal(waiting.nodes.find(n=>n.id==='review:logs')!.status,'review');
    assert.equal(waiting.nodes.find(n=>n.id==='branch:logs')!.actor,'subagent');assert.ok(!waiting.nodes.some(n=>n.id==='review:changes'));
    assert.ok(waiting.edges.some(e=>e.from==='branch:logs'&&e.to==='review:logs'&&e.relation==='handoff'&&e.state==='review'));
    assert.equal(accepted.nodes.find(n=>n.id==='review:logs')!.state,'主 Agent · 复核完成');
    for(const direction of ['horizontal','vertical'] as const){
      const layout=layoutGraph(waiting,direction);assert.equal(layout.lanes.length,2);
      for(const node of layout.nodes){
        assert.ok(node.x>=0&&node.y>=0&&node.x+225<=layout.width&&node.y+94<=layout.height);
        if(node.actor){const lane=layout.lanes.find(l=>l.actor===node.actor)!;assert.ok(node.x>=lane.x&&node.y>=lane.y&&node.x+225<=lane.x+lane.width&&node.y+94<=lane.y+lane.height,`${node.id} must stay in its actor lane`);}
        for(const other of layout.nodes.filter(n=>n.rank===node.rank&&n.id!==node.id))assert.ok(Math.abs(node.x-other.x)>=225||Math.abs(node.y-other.y)>=94);
      }
      const main=layout.lanes.find(l=>l.actor==='main')!,child=layout.lanes.find(l=>l.actor==='subagent')!;
      assert.ok(direction==='vertical'?main.x+main.width<child.x:main.y+main.height<child.y);
    }
    assert.equal(f.store.events(f.task.id).length,4);assert.deepEqual(f.store.get(f.task.id).calls,{});assert.deepEqual(f.store.get(f.task.id).observations,[]);
  }finally{f.store.close();}
});

test('first and unavailable baselines do not fabricate intermediate operations or cross-task differences',()=>{
  const f=fixture();try{
    const first=compareCheckpoint(f.frames[0]!.view);assert.equal(first.baseline,'initial');assert.ok(first.changes.filter(c=>c.kind==='branch').every(c=>c.label==='建立待排查分支'));
    const unknown=compareCheckpoint(f.frames[3]!.view,undefined,{baseline:'unknown'});assert.deepEqual(unknown.changes,[]);assert.deepEqual(unknown.highlighted,[]);
    const foreign=structuredClone(f.frames[0]!.view);foreign.id='foreign';assert.throws(()=>compareCheckpoint(f.frames[1]!.view,foreign),/different tasks/);
  }finally{f.store.close();}
});

test('a matched native lifecycle can advance a pending branch without recording tool calls',()=>{
  const store=new Store(':memory:'),engine=new Engine(store);
  try{
    const task=engine.create(session,{origin:'test',goal:'verify',criteria:['done'],evidenceMode:'curated',branches:[{key:'child',title:'独立核对',executor:'subagent',agentId:'known-child',status:'pending'}]});
    const before=projectTask(engine,store.get(task.id));
    engine.recordAgentLifecycle(task.id,session,'known-child','started');
    const running=projectTask(engine,store.get(task.id));assert.equal(running.branches[0]!.status,'running');assert.equal(running.branches[0]!.recordedStatus,'pending');
    assert.equal(compareCheckpoint(running,before).changes.find(c=>c.nodeId==='branch:child')!.label,'开始执行');
    engine.checkpoint(task.id,session,{summary:'主会话同步已启动状态',branches:[{key:'child',title:'独立核对',status:'running'}]});
    assert.equal(store.get(task.id).branches![0]!.attempt,1,'acknowledging a native start must retain its execution identity');
    engine.recordAgentLifecycle(task.id,session,'known-child','returned');
    const returned=projectTask(engine,store.get(task.id));assert.equal(returned.branches[0]!.status,'awaiting_review');assert.equal(returned.branches[0]!.activitySource,'host');
    assert.equal(compareCheckpoint(returned,running).changes.find(c=>c.nodeId==='branch:child')!.label,'返回待汇总');
    assert.deepEqual(store.get(task.id).calls,{});assert.deepEqual(store.get(task.id).observations,[]);
    const other={...session,sessionId:'pending-native-pause'},paused=engine.create(other,{origin:'test',goal:'pause',criteria:['done'],evidenceMode:'curated',branches:[{key:'child',title:'已知助手',executor:'subagent',agentId:'pause-child',status:'pending'}]});
    engine.recordAgentLifecycle(paused.id,other,'pause-child','started');engine.suspend(paused.id,other);engine.resume(paused.id,other);
    assert.equal(projectTask(engine,store.get(paused.id)).branches[0]!.status,'blocked','resume does not infer that a pre-pause helper is still executing');
  }finally{store.close();}
});

test('HTTP checkpoint differences use the preceding saved task frame even when seeking backward',async()=>{
  const f=fixture(),ui=await startUi(f.engine,{port:0});
  try{
    const read=async(seq:number)=>(await (await fetch(`${ui.url}/api/tasks/${f.task.id}/replay/${seq}`)).json());
    const before=JSON.stringify(f.store.get(f.task.id)),count=f.store.events(f.task.id).length;
    const first=await read(f.frames[0]!.seq);assert.equal(first.checkpoint.baseline,'initial');
    const last=await read(f.frames[3]!.seq);assert.equal(last.checkpoint.previous.seq,f.frames[2]!.seq);
    const earlier=await read(f.frames[1]!.seq);assert.equal(earlier.checkpoint.previous.seq,f.frames[0]!.seq);
    const again=await read(f.frames[3]!.seq);assert.deepEqual(again.checkpoint,last.checkpoint);
    assert.equal(JSON.stringify(f.store.get(f.task.id)),before);assert.equal(f.store.events(f.task.id).length,count);
    // Missing historical frames are disclosed as an aggregate delta.
    f.store.db.prepare('DELETE FROM task_history WHERE event_seq IN (?,?)').run(f.frames[1]!.seq,f.frames[2]!.seq);
    const gap=await read(f.frames[3]!.seq);assert.equal(gap.checkpoint.baseline,'gap');assert.equal(gap.checkpoint.missing,2);assert.equal(gap.checkpoint.previous.seq,f.frames[0]!.seq);
    f.store.db.prepare('DELETE FROM task_history WHERE event_seq=?').run(f.frames[0]!.seq);
    const unknown=await read(f.frames[3]!.seq);assert.equal(unknown.checkpoint.baseline,'unknown');assert.deepEqual(unknown.checkpoint.highlighted,[]);
  }finally{await ui.close();f.store.close();}
});
