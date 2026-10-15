import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { projectTask, projectEvent } from '../src/ui/view.js';
import type { Session } from '../src/core/types.js';

const session: Session = { host: 'codex', sessionId: 'ui-progress', cwd: '/workspace' };
const at = '2026-10-15T09:00:00.000Z';
function fixture() {
  const store = new Store(':memory:'), engine = new Engine(store);
  const task = engine.create(session, { origin: '用户提供问题背景', goal: '确认价格异常并给出修复建议', criteria: ['确定机制', '确定影响面'], evidenceMode: 'curated' });
  return { store, engine, task };
}
test('progress groups use explicit reported stages, not task active status or raw tool calls', () => {
  const { store, engine, task } = fixture();
  try {
    const empty = projectTask(engine, task); assert.equal(empty.workCounts.running, 0); assert.equal(empty.progressSource, 'none');
    task.progress = [
      { key: 'mechanism', title: '比对价格字段', status: 'completed', source: 'agent', updatedAt: at },
      { key: 'impact', title: '圈定受影响范围', status: 'running', source: 'agent', updatedAt: at },
      { key: 'repair', title: '核对修复版本', status: 'pending', source: 'agent', updatedAt: at },
      { key: 'verify', title: '等待测试账号', status: 'blocked', source: 'agent', updatedAt: at },
    ];
    task.checkpoint = { summary: '机制已明确，继续确认范围', questions: ['样本是否覆盖全部客户端？'], at };
    const view = projectTask(engine, task);
    assert.deepEqual(view.workGroups.running.map(i => i.key), ['impact']);
    assert.deepEqual(view.workGroups.completed.map(i => i.key), ['mechanism']);
    assert.deepEqual(view.workGroups.waiting.map(i => i.key), ['repair', 'verify']);
    assert.deepEqual(view.workCounts, { running: 1, completed: 1, waiting: 2, blocked: 1, questions: 1 });
    assert.equal(view.progressSource, 'agent');
  } finally { store.close(); }
});
test('paused and completed tasks never project stale running stages as executing', () => {
  const { store, engine, task } = fixture();
  try {
    task.progress = [{ key: 'impact', title: '圈定范围', status: 'running', source: 'agent', updatedAt: at }];
    for (const status of ['suspended', 'completed'] as const) {
      task.status = status; const view = projectTask(engine, task);
      assert.equal(view.workGroups.running.length, 0); assert.equal(view.workGroups.waiting[0]?.status, status === 'suspended' ? 'blocked' : 'pending');
      assert.match(view.workGroups.waiting[0]!.statusLabel, status === 'suspended' ? /已暂停/ : /未单独确认/);
    }
    assert.equal(task.progress[0]!.status, 'running', 'projection must not rewrite persisted history');
  } finally { store.close(); }
});
test('curated views keep authored basis and references without exposing captured tool indexes', () => {
  const { store, engine, task } = fixture();
  try {
    task.calls = { secret: { tool: 'INTERNAL_TOOL_SENTINEL', status: 'running', startedAt: at } };
    task.observations = [{ id: 'obs-secret', callId: 'secret', tool: 'INTERNAL_TOOL_SENTINEL', input: 'RAW_SENTINEL', output: 'RAW_SENTINEL', source: 'hook', scope: {}, actor: { host: 'codex', sessionId: 'ui-progress', epoch: 1 }, status: 'success', capturedAt: at, eligible: true }];
    task.claims = [{ id: 'claim-a', text: '1.4 中重复缩放', basis: '映射文件与 1.5 对照均表明重复乘以100。', references: ['mapping.json:12', 'https://example.com/incident'], provenance: 'agent', relatedCriteria: ['c1'], status: 'supported', supports: [], refutes: [], scope: task.scope, revision: 1 }];
    task.criteria[0]!.claimIds = ['claim-a'];
    const view = projectTask(engine, task), serialized = JSON.stringify(view);
    assert.deepEqual(view.observations, []); assert.deepEqual(view.calls, {}); assert.equal(view.metrics.calls, 0);
    assert.ok(!serialized.includes('RAW_SENTINEL')); assert.ok(!serialized.includes('INTERNAL_TOOL_SENTINEL'));
    assert.match(serialized, /映射文件与 1.5 对照/); assert.match(serialized, /mapping.json:12/);
  } finally { store.close(); }
});
test('legacy completed model runs show validated goal coverage without inventing stages', () => {
  const { store, engine, task } = fixture();
  try {
    delete task.evidenceMode;
    task.status = 'completed';
    task.observations = [{ id: 'obs-a', callId: 'read-a', tool: 'read_mapping', input: {}, output: 'raw', source: 'hook', scope: task.scope, actor: { host: 'codex', sessionId: session.sessionId, epoch: 1 }, status: 'success', capturedAt: at, eligible: true }];
    task.claims = [{ id: 'claim-a', text: '重复缩放已确认', status: 'supported', supports: ['obs-a'], refutes: [], scope: task.scope, revision: 1 }];
    task.criteria[0]!.claimIds = ['claim-a'];
    const view = projectTask(engine, task);
    assert.equal(view.phase.label, '已完成'); assert.equal(view.progressSource, 'historical'); assert.equal(view.workCounts.running, 0);
    assert.deepEqual(view.workGroups.completed.map(i => i.title), ['确定机制']);
    assert.deepEqual(view.workGroups.waiting.map(i => i.title), ['确定影响面']);
    assert.equal(view.workGroups.completed[0]?.statusLabel, '条件已满足');
  } finally { store.close(); }
});
test('timeline differentiates suspend, resume, rejected completion, and successful completion', () => {
  const base = { seq: 1, at, kind: 'task.finished' };
  assert.equal(projectEvent({ ...base, payload: { phase: 'suspended', input: { outcome: 'suspended', summary: '保存当前依据，稍后恢复' } } }).title, '暂停任务');
  const failure = projectEvent({ ...base, payload: { phase: 'incomplete', input: { outcome: 'completed', summary: '尝试交付' }, validation: { ok: false, issues: ['影响范围仍缺依据'] } } });
  assert.equal(projectEvent({ ...base, kind: 'task.checked', payload: { phase: 'incomplete', validation: { ok: false, issues: ['影响范围仍缺依据'] } } }).title, '完成检查未通过');
  assert.equal(failure.title, '完成检查未通过'); assert.match(failure.detail!, /影响范围仍缺依据/);
  assert.equal(projectEvent({ ...base, payload: { phase: 'completed', input: { outcome: 'completed', summary: '条件均已满足' } } }).title, '已完成');
  assert.equal(projectEvent({ ...base, kind: 'task.resumed', payload: { takeover: true } }).title, '接管并恢复');
});
test('timeline preserves authored milestones but never serializes raw outputs or snapshots', () => {
  const event = projectEvent({ seq: 4, at, kind: 'task.checkpoint', payload: { input: { summary: '完成价格映射对照', questions: ['影响范围待查'], next: '核对用户窗口', findings: [{ text: '字段重复乘以100', basis: '文件内容', references: ['mapping.json'] }] }, output: 'RAW_SENTINEL', task: { observations: ['RAW_SENTINEL'] } } });
  assert.equal(event.category, 'milestone'); assert.equal(event.title, '保存阶段进展'); assert.match(event.summary, /价格映射/); assert.match(event.detail!, /影响范围待查/); assert.match(event.detail!, /核对用户窗口/); assert.ok(!JSON.stringify(event).includes('RAW_SENTINEL'));
  const raw = projectEvent({ seq: 5, at, kind: 'observation.captured', payload: { id: 'obs-secret', tool: 'read', output: 'RAW_SENTINEL' } });
  assert.equal(raw.category, 'advanced'); assert.equal(raw.observationId, 'obs-secret'); assert.equal(raw.summary, 'read'); assert.ok(!JSON.stringify(raw).includes('RAW_SENTINEL'));
});
