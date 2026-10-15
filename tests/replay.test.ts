import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { startUi } from '../src/ui/server.js';
import { projectTask } from '../src/ui/view.js';
import { projectGraph } from '../src/ui/graph.js';

const first = { host: 'codex' as const, sessionId: 'initial', cwd: '/workspace' };
const second = { host: 'claude' as const, sessionId: 'takeover', cwd: '/workspace' };
function chain(store: Store) {
  let now = Date.parse('2026-10-15T01:00:00Z');
  const engine = new Engine(store, () => new Date(now++));
  const task = engine.create(first, { origin: '本地样例', goal: '修复价格换算', criteria: ['复现并验证修复'], evidenceMode: 'curated', progress: [{ key: 'repair', title: '核对并修复', status: 'running' }] });
  engine.checkpoint(task.id, first, { summary: '初步怀疑单位错误', findings: [{ key: 'cause', text: '可能缺少单位换算', status: 'proposed' }] });
  engine.checkpoint(task.id, first, { summary: '已实际复现', findings: [{ key: 'cause', text: '缺少分到元的换算', status: 'supported', basis: '实际输入1640得到1640，约定应为16.4', references: ['price.mjs'], covers: ['c1'] }] });
  engine.finish(task.id, first, { outcome: 'suspended', questions: ['待修复并回归'], next: '修正换算' });
  engine.resume(task.id, second, true);
  engine.finish(task.id, second, { outcome: 'completed', summary: '已修复并实际验证', questions: [], findings: [{ key: 'fix', text: '修复后1640分返回16.4元', basis: '修改后独立运行回归得到16.4', references: ['verification.md'], covers: ['c1'] }], progress: [{ key: 'repair', title: '核对并修复', status: 'completed' }] });
  return { task, engine };
}

test('replay preserves intermediate revisions, graph states, pause and takeover without running actions', () => {
  const store = new Store(':memory:');
  try {
    const { task, engine } = chain(store), before = JSON.stringify(store.get(task.id)), events = store.events(task.id);
    const frames = events.map(e => store.historical(task.id, e.seq).task);
    assert.equal(frames.length, 6);
    assert.equal(frames[0]!.claims.length, 0);
    assert.equal(frames[1]!.claims[0]!.status, 'proposed');
    assert.equal(frames[2]!.claims[0]!.status, 'supported');
    assert.equal(frames[3]!.status, 'suspended');
    assert.equal(frames[4]!.owner.epoch, 2);
    assert.equal(frames[5]!.status, 'completed');
    assert.equal(frames[0]!.owner.host, 'codex'); assert.equal(frames[5]!.owner.host, 'claude');
    const graph = (i: number) => projectGraph(projectTask(engine, frames[i]!, events[i]!.at));
    assert.equal(graph(0).nodes.find(n => n.id === 'work:repair')!.status, 'running');
    assert.notEqual(graph(3).nodes.find(n => n.id === 'work:repair')!.status, 'running');
    assert.equal(graph(5).nodes.find(n => n.id === 'work:repair')!.status, 'completed');
    assert.equal(JSON.stringify(store.get(task.id)), before); assert.equal(store.events(task.id).length, 6);
  } finally { store.close(); }
});

test('event sequence distinguishes same-revision checks and writes roll back atomically', () => {
  const store = new Store(':memory:'), engine = new Engine(store);
  try {
    const task = engine.create(first, { origin: 'sample', goal: 'verify', criteria: ['verify'], evidenceMode: 'curated' });
    engine.finish(task.id, first, { outcome: 'completed' });
    const events = store.events(task.id);
    assert.equal(events.length, 2);
    assert.equal(store.historical(task.id, events[0]!.seq).task.revision, store.historical(task.id, events[1]!.seq).task.revision);
    assert.equal(store.historical(task.id, events[0]!.seq).task.lastCheck, undefined);
    assert.ok(store.historical(task.id, events[1]!.seq).task.lastCheck);
    store.db.exec("CREATE TRIGGER reject_history BEFORE INSERT ON task_history BEGIN SELECT RAISE(FAIL,'snapshot failed'); END");
    const before = JSON.stringify(store.get(task.id));
    assert.throws(() => store.save({ ...store.get(task.id), goal: 'uncommitted' }, 'test', {}, new Date().toISOString()), /snapshot failed/);
    assert.equal(JSON.stringify(store.get(task.id)), before); assert.equal(store.events(task.id).length, 2);
  } finally { store.close(); }
});

test('historical deadline labels use event time rather than today', () => {
  const store = new Store(':memory:'), engine = new Engine(store, () => new Date('2026-10-15T02:00:00Z'));
  try {
    const task = engine.create(first, { origin: 'sample', goal: 'verify', criteria: ['verify'], evidenceMode: 'curated', budget: { deadline: '2026-10-15T01:30:00Z' } });
    assert.equal(projectTask(engine, task).phase.key, 'expired');
    assert.equal(projectTask(engine, task, '2026-10-15T01:00:00Z').phase.key, 'starting');
  } finally { store.close(); }
});

test('old databases retain honest initial/head baselines; future events have complete frames', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-legacy-replay-')), path = join(dir, 'state.db');
  let store = new Store(path);
  try {
    const { task } = chain(store), events = store.events(task.id);
    store.db.exec('DROP TABLE task_history'); store.close(); store = new Store(path);
    assert.equal(store.historical(task.id, events[0]!.seq).task.claims.length, 0);
    assert.equal(store.historical(task.id, events.at(-1)!.seq).task.status, 'completed');
    assert.throws(() => store.historical(task.id, events[2]!.seq), /No saved historical state/);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM task_history').get()!.n, 2);
    store.close(); store = new Store(path);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM task_history').get()!.n, 2);
    const engine = new Engine(store), next = engine.create(first, { origin: 'next', goal: 'continue', criteria: ['done'], evidenceMode: 'curated' });
    engine.hint(next.id, first, 'new saved state', 'human');
    assert.equal(store.historical(next.id, store.events(next.id).at(-1)!.seq).task.hints.length, 1);
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('replay HTTP is task-scoped, paginated, frozen at its head, private and read-only', async () => {
  const store = new Store(':memory:'), { engine, task } = chain(store), dashboard = await startUi(engine, { port: 0 });
  const read = async (path: string) => (await fetch(`${dashboard.url}/api/tasks/${path}`)).json();
  try {
    const other = engine.create({ ...first, sessionId: 'other' }, { origin: 'other', goal: 'foreign', criteria: ['done'], evidenceMode: 'captured' });
    const observation = engine.observe(other.id, { ...first, sessionId: 'other' }, { callId: 'raw', tool: 'SECRET_TOOL', input: 'SECRET_INPUT', output: 'SECRET_OUTPUT', source: 'hook', status: 'success' });
    const rawSeq = store.events(other.id).at(-1)!.seq;
    const rawFrame = await read(`${other.id}/replay/${rawSeq}`);
    assert.ok(!JSON.stringify(rawFrame).includes('SECRET_INPUT')); assert.ok(!JSON.stringify(rawFrame).includes('SECRET_OUTPUT'));
    assert.ok(!JSON.stringify(store.db.prepare('SELECT state FROM task_history WHERE event_seq=?').get(rawSeq)).includes('SECRET_OUTPUT'));
    assert.equal(rawFrame.task.observations[0].id, observation.id);
    assert.equal((await fetch(`${dashboard.url}/api/tasks/${task.id}/replay/${rawSeq}`)).status, 404);
    const converted = store.get(other.id); converted.evidenceMode = 'curated'; store.save(converted, 'task.checkpoint', { input: { summary: 'AI 整理' } }, new Date().toISOString());
    assert.ok(!JSON.stringify(await read(`${other.id}/replay`)).includes('SECRET_TOOL'));
    assert.deepEqual((await read(`${other.id}/replay/${rawSeq}`)).task.observations, []);
    for (let i = 0; i < 205; i++) engine.hint(other.id, { ...first, sessionId: 'other' }, `note ${i}`, 'human');
    const page1 = await read(`${other.id}/replay`);
    engine.hint(other.id, { ...first, sessionId: 'other' }, 'arrived during replay', 'human');
    const collected = [...page1.frames]; let next = page1.next;
    while (next !== null) { const page = await read(`${other.id}/replay?after=${next}&head=${page1.head}`); collected.push(...page.frames); next = page.next; }
    assert.equal(collected.length, page1.total); assert.ok(collected.length > 200);
    assert.equal(new Set(collected.map(f => f.seq)).size, collected.length);
    assert.ok(collected.every(f => f.seq <= page1.head));
    assert.ok((await read(`${other.id}/replay`)).total > page1.total);
    const before = JSON.stringify(store.get(task.id)), count = store.events(task.id).length;
    const frame = await read(`${task.id}/replay/${store.events(task.id)[1]!.seq}`);
    assert.equal(frame.task.claims[0].status, 'proposed'); assert.equal(frame.events.length, 2);
    assert.equal(frame.task.status, 'active'); assert.equal(frame.task.updatedAt, store.events(task.id)[1]!.at);
    assert.equal(JSON.stringify(store.get(task.id)), before); assert.equal(store.events(task.id).length, count);
    for (const cursor of ['-1', 'NaN', '1.5']) assert.equal((await fetch(`${dashboard.url}/api/tasks/${task.id}/replay?after=${cursor}`)).status, 400);
    assert.equal((await fetch(`${dashboard.url}/api/tasks/${task.id}/replay`, { method: 'POST' })).status, 405);
  } finally { await dashboard.close(); store.close(); }
});
