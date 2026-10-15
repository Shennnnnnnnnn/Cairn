import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { ToolRuntime } from '../src/tools.js';
import { handleNative, normalize, hookOutput } from '../src/adapters/hooks.js';
import { projectTask } from '../src/ui/view.js';
import { projectGraph, layoutGraph } from '../src/ui/graph.js';
import type { Host, BranchInput } from '../src/core/types.js';

function fixture(host: Host = 'codex') {
  let clock = Date.parse('2026-10-15T10:00:00Z');
  const store = new Store(':memory:'), engine = new Engine(store, () => new Date(clock++));
  const session = { host, sessionId: `main-${host}`, cwd: '/workspace' };
  const runtime = new ToolRuntime(engine, session);
  return { store, engine, session, runtime };
}
const initial: BranchInput[] = [
  { key: 'logs', title: '核对超时日志', status: 'running', executor: 'subagent', agentId: 'log-agent', assignee: '日志助手', question: '超时发生在哪一层？', rationale: '日志可独立于变更检查' },
  { key: 'changes', title: '核对近期变更', status: 'running', executor: 'subagent', agentId: 'change-agent', assignee: '变更助手' },
  { key: 'verify', title: '主会话核对复现', status: 'running', executor: 'main' },
];
const finding = { key: 'cause', text: '配置超时过短', basis: '复现与配置核对一致', references: ['config.json:8'], branch: 'logs', covers: ['c1'] };

test('Pi, Claude and Codex share branch semantics, findings, completion and recovery', async () => {
  for (const host of ['pi', 'claude', 'codex'] as Host[]) {
    const f = fixture(host);
    try {
      const start: any = await f.runtime.invoke('cairn_start', { goal: '确认超时机制', branches: initial });
      assert.equal(start.branches.length, 3); assert.equal(start.branches[0].executor, 'subagent');
      await f.runtime.invoke('cairn_checkpoint', { summary: '助手返回初步结果，主会话准备汇总', branches: [{ key: 'logs', title: '核对超时日志', status: 'awaiting_review' }], findings: [finding] });
      const incomplete: any = await f.runtime.invoke('cairn_finish', {});
      assert.equal(incomplete.phase, 'incomplete'); assert.ok(incomplete.validation.issues.some((issue: string) => issue.includes('Branch')));
      const branches: any = await f.runtime.invoke('cairn_read', { view: 'branches' });
      assert.equal(branches.items[0].status, 'awaiting_review'); assert.equal(branches.items[0].findings[0].key, 'cause');
      await f.runtime.invoke('cairn_finish', { outcome: 'suspended' });
      const newSession = { ...f.session, host: 'mcp' as const, sessionId: `restore-${host}` }, restored = new ToolRuntime(f.engine, newSession);
      const recovery: any = await restored.invoke('cairn_resume', { task_id: start.taskId, takeover: true });
      assert.equal(recovery.branches.length, 3); assert.equal(recovery.branches.find((b: any) => b.key === 'changes').status, 'blocked');
      await assert.rejects(f.runtime.invoke('cairn_checkpoint', { summary: 'late write' }), /no longer owns/);
      const result: any = await restored.invoke('cairn_finish', { summary: '已核对日志与复现，保留有效依据', branches: [
        { key: 'logs', title: '核对超时日志', status: 'completed', summary: '主会话复核了日志依据' },
        { key: 'changes', title: '核对近期变更', status: 'cancelled', summary: '现有复现已定位原因，此方向不再需要，旧会话助手状态需由宿主处理' },
        { key: 'verify', title: '主会话核对复现', status: 'completed', summary: '复现与配置一致' },
      ] });
      assert.equal(result.phase, 'completed');
      const saved = f.store.get(start.taskId); assert.equal(saved.claims[0]!.branch, 'logs'); assert.deepEqual(saved.calls, {}); assert.deepEqual(saved.observations, []);
      await restored.close();
    } finally { await f.runtime.close(); f.store.close(); }
  }
});

test('branch updates validate parents, ownership, summaries, evidence links and retries atomically', () => {
  const { store, engine, session } = fixture();
  try {
    const task = engine.create(session, { origin: 'test', goal: 'diagnose', criteria: ['done'], evidenceMode: 'curated', branches: initial });
    const before = JSON.stringify(store.get(task.id));
    for (const branches of [
      [{ key: 'cycle', title: 'cycle', status: 'pending', parent: 'cycle' }],
      [{ key: 'missing', title: 'missing', status: 'pending', parent: 'foreign' }],
      [{ key: 'logs', title: 'logs', status: 'completed' }],
      [{ key: 'other', title: 'other', status: 'running', executor: 'subagent', agentId: 'log-agent' }],
    ] as BranchInput[][]) {
      assert.throws(() => engine.checkpoint(task.id, session, { summary: 'invalid', branches }));
      assert.equal(JSON.stringify(store.get(task.id)), before);
    }
    assert.throws(() => engine.checkpoint(task.id, session, { summary: 'invalid', findings: [{ ...finding, branch: 'foreign' }] }), /does not belong/);
    assert.throws(() => engine.claim(task.id, session, { text: 'foreign claim',status:'proposed',supports:[],refutes:[],branch:'foreign' }), /does not belong/);
    assert.throws(() => engine.checkpoint(task.id, session, { summary: 'invalid', progress: [{ key: 'a', title: 'a', status: 'running', branch: 'foreign' }] }), /does not belong/);
    const update = { summary: '子分支开始', branches: [{ key: 'latency', title: '核对上游耗时', status: 'running' as const, parent: 'logs' }], findings: [finding], progress: [{ key: 'scan', title: '核对样本', status: 'running' as const, branch: 'latency' }] };
    engine.checkpoint(task.id, session, update); const count = store.events(task.id).length;
    engine.checkpoint(task.id, session, update); assert.equal(store.events(task.id).length, count);
    assert.equal(store.get(task.id).progress![0]!.branch, 'latency');
  } finally { store.close(); }
});

test('native child hooks capture lifecycle metadata only and never accept the child result automatically', () => {
  for (const host of ['claude', 'codex'] as Host[]) {
    const { store, engine, session } = fixture(host);
    try {
      const task = engine.create(session, { origin: 'test', goal: 'diagnose', criteria: ['done'], evidenceMode: 'curated', branches: initial });
      const event = (type: string, id = 'log-agent') => normalize(host, { hook_event_name: type, session_id: session.sessionId, cwd: session.cwd, agent_id: id, agent_type: 'Explore', last_assistant_message: 'PRIVATE_CHILD_REPORT', tool_name: 'SECRET_CHILD_TOOL', tool_use_id: 'child-call', tool_input: 'SECRET_INPUT', tool_response: 'SECRET_RESULT' });
      const before = store.events(task.id).length;
      handleNative(engine, host, event('SubagentStart', 'unbound-internal-agent'));
      assert.equal(store.events(task.id).length, before);
      const start = event('SubagentStart'), output = hookOutput(start, handleNative(engine, host, start));
      assert.equal(output.hookSpecificOutput?.hookEventName, 'SubagentStart');
      handleNative(engine, host, start);
      assert.equal(store.events(task.id).length, before + 1);
      for (const type of ['PostToolUse', 'Stop', 'Interrupt', 'PreCompact']) handleNative(engine, host, event(type));
      assert.equal(store.events(task.id).length, before + 1); assert.equal(store.get(task.id).status, 'active');
      assert.equal(projectTask(engine, store.get(task.id)).branches[0]!.activitySource, 'host');
      handleNative(engine, host, event('SubagentStop')); handleNative(engine, host, event('SubagentStop')); handleNative(engine, host, start);
      const view = projectTask(engine, store.get(task.id));
      assert.equal(view.branches[0]!.status, 'awaiting_review'); assert.equal(view.branches[0]!.recordedStatus, 'running');
      assert.equal(view.branchCounts.review, 1); assert.equal(view.branchCounts.completed, 0);
      assert.equal(store.events(task.id).length, before + 2);
      assert.ok(!JSON.stringify(store.events(task.id)).includes('PRIVATE_CHILD_REPORT'));
      assert.ok(!JSON.stringify(store.get(task.id)).includes('SECRET_')); assert.deepEqual(store.get(task.id).calls, {});
      engine.checkpoint(task.id, session, { summary: '审阅后确认有效', findings: [finding], branches: [{ key: 'logs', title: '核对超时日志', status: 'completed', summary: '已核对日志依据与结论' }] });
      assert.equal(projectTask(engine, store.get(task.id)).branches[0]!.status, 'completed');
    } finally { store.close(); }
  }
});

test('stop-before-start, reused helpers and cancelled running helpers preserve execution semantics', () => {
  const { store, engine, session } = fixture();
  try {
    const task = engine.create(session, { origin: 'test', goal: 'diagnose', criteria: ['done'], evidenceMode: 'curated', branches: [initial[0]!] });
    engine.recordAgentLifecycle(task.id, session, 'log-agent', 'returned');
    engine.recordAgentLifecycle(task.id, session, 'log-agent', 'started');
    assert.equal(projectTask(engine, store.get(task.id)).branches[0]!.status, 'awaiting_review');
    engine.checkpoint(task.id, session, { summary: '让同一助手补查新样本', branches: [{ key: 'logs', title: '核对超时日志', status: 'running' }] });
    assert.equal(store.get(task.id).branches![0]!.attempt, 2);
    assert.equal(projectTask(engine, store.get(task.id)).branches[0]!.status, 'running');
    assert.equal(projectTask(engine, store.get(task.id)).branches[0]!.activitySource, 'agent');
    engine.recordAgentLifecycle(task.id, session, 'log-agent', 'started');
    assert.throws(() => engine.checkpoint(task.id, session, { summary: 'premature', branches: [{ key: 'logs', title: 'logs', status: 'completed', summary: 'not actually returned' }] }), /still reports/);
    engine.checkpoint(task.id, session, { summary: '该方向已充分，停止助手', findings: [finding], branches: [{ key: 'logs', title: 'logs', status: 'cancelled', summary: '已请求宿主停止' }] });
    assert.equal(engine.finish(task.id, session, { outcome: 'completed' }).phase, 'incomplete');
    engine.recordAgentLifecycle(task.id, session, 'log-agent', 'returned');
    assert.equal(engine.finish(task.id, session, { outcome: 'completed' }).phase, 'completed');
  } finally { store.close(); }
});

test('a named primary agent retains startup and interrupt handling while child actors stay isolated',()=>{
  const {store,engine,session}=fixture('claude');
  try{
    const primary={sessionId:session.sessionId,cwd:session.cwd,agentId:'named-primary'};
    const startup=handleNative(engine,'claude',{...primary,type:'SessionStart'});assert.match(startup.context!,/session_id=/);
    const task=engine.create(session,{origin:'test',goal:'diagnose',criteria:['done'],evidenceMode:'curated'});
    handleNative(engine,'claude',{...primary,agentId:'child',type:'SubagentStart'});
    handleNative(engine,'claude',{...primary,agentId:'child',type:'SessionStart'});
    handleNative(engine,'claude',{...primary,agentId:'child',type:'Interrupt'});
    assert.equal(store.get(task.id).status,'active');
    handleNative(engine,'claude',{...primary,type:'Interrupt'});assert.equal(store.get(task.id).status,'suspended');
  }finally{store.close();}
});

test('late child events cannot change a new goal or a replacement owner', () => {
  const { store, engine, session } = fixture();
  try {
    const task = engine.create(session, { origin: 'test', goal: 'diagnose', criteria: ['done'], evidenceMode: 'curated', branches: [initial[0]!] });
    engine.recordAgentLifecycle(task.id, session, 'log-agent', 'started');
    engine.suspend(task.id, session);
    const next = engine.create(session, { origin: 'next', goal: 'other goal', criteria: ['done'], evidenceMode: 'curated' }), before = JSON.stringify(store.get(next.id));
    const late = { type: 'SubagentStop', sessionId: session.sessionId, cwd: session.cwd, agentId: 'log-agent' };
    handleNative(engine, 'codex', late); assert.equal(JSON.stringify(store.get(next.id)), before);
    engine.suspend(next.id, session);
    const replacement = { ...session, sessionId: 'new-owner' }; engine.resume(task.id, replacement, true);
    const resumed = JSON.stringify(store.get(task.id));
    handleNative(engine, 'codex', late); assert.equal(JSON.stringify(store.get(task.id)), resumed);
    const view = projectTask(engine, store.get(task.id)); assert.equal(view.branchCounts.running, 0); assert.equal(view.branches[0]!.activityStatus, 'returned');
    assert.equal(view.branches[0]!.status, 'blocked');
    engine.checkpoint(task.id, replacement, { summary: '接管后自行核对', branches: [{ key: 'logs', title: '核对日志', status: 'running', executor: 'main' }] });
    assert.equal(projectTask(engine, store.get(task.id)).branches[0]!.activitySource, 'agent');
  } finally { store.close(); }
});

test('graph shows actual branch membership and nesting, with lifecycle-aware replay colors', () => {
  const { store, engine, session } = fixture();
  try {
    const task = engine.create(session, { origin: 'test', goal: 'diagnose', criteria: ['done'], evidenceMode: 'curated', branches: [...initial, { key: 'nested', title: '核对耗时分布', status: 'pending', parent: 'logs' }] });
    engine.checkpoint(task.id, session, { summary: '登记分支依据', findings: [{key:'main-first',text:'主会话先返回',basis:'主会话的独立核对',branch:'verify',covers:[]},finding], progress: [{ key: 'sample', title: '核对样本', status: 'completed', branch: 'nested' }] });
    const runningSeq = store.events(task.id).at(-1)!.seq;
    engine.recordAgentLifecycle(task.id, session, 'log-agent', 'returned'); const returnedSeq = store.events(task.id).at(-1)!.seq;
    const model = projectGraph(projectTask(engine, store.get(task.id))), claim = store.get(task.id).claims.find(item=>item.branch==='logs')!;
    assert.ok(model.edges.some(e => e.from === 'origin' && e.to === 'branch:logs'));
    assert.ok(model.edges.some(e => e.from === 'branch:logs' && e.to === 'branch:nested'));
    assert.ok(model.edges.some(e => e.from === 'branch:nested' && e.to === 'work:sample'));
    assert.ok(model.edges.some(e => e.from === 'branch:logs' && e.to === `basis:${claim.id}`));
    assert.ok(!model.edges.some(e => e.from === 'branch:changes' && e.to === 'branch:logs'));
    assert.equal(model.nodes.find(n => n.id === 'branch:logs')!.status, 'review');
    const running = store.historical(task.id, runningSeq), returned = store.historical(task.id, returnedSeq);
    assert.equal(projectGraph(projectTask(engine, running.task, running.at)).nodes.find(n => n.id === 'branch:logs')!.status, 'running');
    assert.equal(projectGraph(projectTask(engine, returned.task, returned.at)).nodes.find(n => n.id === 'branch:logs')!.status, 'review');
    for (const direction of ['horizontal', 'vertical'] as const) {
      const layout = layoutGraph(model, direction);
      assert.equal(layout.nodes.length, model.nodes.length);
      for (const node of layout.nodes) assert.ok(node.x >= 0 && node.y >= 0 && node.x + 225 <= layout.width && node.y + 94 <= layout.height);
      const bases=layout.nodes.filter(node=>node.kind==='basis');
      assert.equal(bases[0]!.data.branch,'logs','basis ordering follows the branch lane rather than result arrival order');
    }
  } finally { store.close(); }
});

test('a child returning to a paused goal settles its lifecycle without taking over the next goal', () => {
  const {store,engine,session}=fixture();
  try {
    const task=engine.create(session,{origin:'test',goal:'diagnose',criteria:['done'],evidenceMode:'curated',branches:[initial[0]!]});
    engine.recordAgentLifecycle(task.id,session,'log-agent','started');engine.suspend(task.id,session);
    const next=engine.create(session,{origin:'next',goal:'other',criteria:['done'],evidenceMode:'curated'});
    handleNative(engine,'codex',{type:'SubagentStop',sessionId:session.sessionId,cwd:session.cwd,agentId:'log-agent'});
    assert.equal(store.get(task.id).agentRuns![0]!.status,'returned');assert.equal(store.get(task.id).status,'suspended');
    assert.equal(engine.active(session)!.id,next.id);assert.equal(store.get(next.id).agentRuns,undefined);
    engine.suspend(next.id,session);engine.resume(task.id,session);
    const finished=engine.finish(task.id,session,{outcome:'completed',summary:'已恢复并审阅',findings:[finding],branches:[{key:'logs',title:'日志',status:'completed',summary:'复核已有结果'}]});
    assert.equal(finished.phase,'completed');
  } finally {store.close();}
});

test('restoration remains bounded with many branches and complete branch details remain readable', async () => {
  const f = fixture();
  try {
    const branches = Array.from({ length: 100 }, (_, i) => ({ key: `branch-${i}`, title: '检查'.repeat(900), status: 'pending', question: '问题'.repeat(1900), rationale: '原因'.repeat(1900), summary: '状态'.repeat(3900) }));
    const started: any = await f.runtime.invoke('cairn_start', { goal: '恢复大型排查', branches });
    assert.ok(Buffer.byteLength(JSON.stringify(started), 'utf8') < 16384); assert.ok(started.truncated.branches > 0);
    const page: any = await f.runtime.invoke('cairn_read', { view: 'branches', offset: 95, limit: 5 });
    assert.equal(page.items.length, 5); assert.equal(page.total, 100);
    const detail: any = await f.runtime.invoke('cairn_read', { view: 'branches', ref: 'branch-99', limit: 32768 });
    assert.equal(detail.item.summary, branches[99]!.summary);
  } finally { await f.runtime.close(); f.store.close(); }
});
