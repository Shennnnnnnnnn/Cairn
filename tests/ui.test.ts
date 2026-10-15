import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { get } from 'node:http';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { startUi } from '../src/ui/server.js';
import { projectTask } from '../src/ui/view.js';
import type { Session } from '../src/core/types.js';

const session: Session = { host: 'codex', sessionId: 'ui-session', cwd: '/workspace' };
function fixture() {
  const store = new Store(':memory:'), engine = new Engine(store);
  const task = engine.create(session, { origin: '告警', goal: '核对价格字段', criteria: ['确认错误机制', '圈定影响面'], evidenceMode: 'captured' });
  return { store, engine, task };
}
test('dashboard progress is evidence-backed criterion coverage, and refutations reduce it', () => {
  const { store, engine, task } = fixture();
  assert.equal(projectTask(engine, store.get(task.id)).phase.key, 'starting');
  engine.beforeTool(task.id, session, 'query', 'query_data');
  assert.equal(projectTask(engine, store.get(task.id)).metrics.inFlight, 1);
  const observation = engine.observe(task.id, session, { callId: 'query', tool: 'query_data', input: {}, output: { private: 'RAW_SENTINEL' }, source: 'hook', status: 'success' });
  const claim = engine.claim(task.id, session, { text: '字段缩放缺失', status: 'supported', supports: [observation.id], refutes: [] });
  engine.satisfy(task.id, session, 'c1', [claim.id]);
  const view = projectTask(engine, store.get(task.id));
  assert.deepEqual(view.progress, { satisfied: 1, total: 2 }); assert.equal(view.metrics.inFlight, 0);
  assert.ok(!JSON.stringify(view).includes('RAW_SENTINEL'));
  engine.claim(task.id, session, { id: claim.id, text: claim.text, status: 'refuted', supports: [], refutes: [observation.id] });
  assert.equal(projectTask(engine, store.get(task.id)).progress.satisfied, 0); store.close();
});
test('report phase reflects report validation as well as goal coverage', () => {
  const { store, engine, task } = fixture();
  engine.observe(task.id,session,{callId:'read',tool:'read',input:{},output:'measured',source:'hook',status:'success'});
  engine.checkpoint(task.id,session,{summary:'确认机制，继续调查影响面',findings:[{key:'cause',text:'机制已确认',evidence:['E1'],covers:['c1']}]});
  const partial=projectTask(engine,store.get(task.id));assert.equal(partial.phase.key,'investigating');assert.deepEqual(partial.progress,{satisfied:1,total:2});
  engine.checkpoint(task.id,session,{summary:'两项条件均有支持',findings:[{key:'impact',text:'影响面已确认',evidence:['E1'],covers:['c2']}]});
  engine.report(task.id, session, { summary: '仍缺证据', citations: [] });
  const view = projectTask(engine, store.get(task.id));
  assert.equal(view.phase.label, '报告待补齐'); assert.equal(view.reportCheck?.ok, false); store.close();
});
test('live HTTP dashboard serves the bundled page and scoped evidence while rejecting writes and cross-origin access', async () => {
  const { store, engine, task } = fixture(), dashboard = await startUi(engine, { port: 0 });
  try {
    const page = await fetch(dashboard.url), source = await page.text();
    assert.equal(page.status, 200); assert.match(source, /Cairn · 实时进度/); assert.match(source, /new EventSource/);
    assert.match(page.headers.get('content-security-policy')!, /frame-ancestors 'none'/);
    assert.equal(page.headers.get('access-control-allow-origin'), null);
    const observation = engine.observe(task.id, session, { callId: 'read', tool: 'read', input: {}, output: 'RAW_SENTINEL', source: 'hook', status: 'success' });
    assert.ok(!(await (await fetch(`${dashboard.url}/api/tasks/${task.id}`)).text()).includes('RAW_SENTINEL'));
    const raw = await (await fetch(`${dashboard.url}/api/tasks/${task.id}/observations/${observation.id}`)).json(); assert.equal(raw.output, 'RAW_SENTINEL');
    const other = { ...session, sessionId: 'another-session' }, foreignTask = engine.create(other, { origin: 'x', goal: 'y', criteria: ['z'] });
    assert.equal((await fetch(`${dashboard.url}/api/tasks/${foreignTask.id}/observations/${observation.id}`)).status, 404);
    assert.equal((await fetch(`${dashboard.url}/api/tasks`, { method: 'POST' })).status, 405);
    assert.equal((await fetch(`${dashboard.url}/api/tasks`, { headers: { Origin: 'https://other.example' } })).status, 403);
    const rebound = await new Promise<number>(resolve => get(`${dashboard.url}/api/tasks`, { headers: { Host: 'rebind.example' } }, response => { response.resume(); resolve(response.statusCode!); }));
    assert.equal(rebound, 403);
    assert.equal((await fetch(`${dashboard.url}/api/tasks`, { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    const history = await (await fetch(`${dashboard.url}/api/tasks/${task.id}/events`)).text(); assert.ok(!history.includes('RAW_SENTINEL'));
  } finally { await dashboard.close(); store.close(); }
});
test('SSE detects another CLI database connection without a browser reload', { timeout: 10000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-ui-stream-')), path = join(dir, 'state.db');
  const store = new Store(path), engine = new Engine(store), task = engine.create(session, { origin: 'x', goal: 'y', criteria: ['z'] });
  const dashboard = await startUi(engine, { port: 0, pollMs: 50 });
  const writer = new Store(path), otherEngine = new Engine(writer), controller = new AbortController();
  try {
    const response = await fetch(`${dashboard.url}/api/stream`, { signal: controller.signal }), reader = response.body!.getReader();
    const ready = new TextDecoder().decode((await reader.read()).value); assert.match(ready, /event: ready/);
    otherEngine.hint(task.id, session, '刚收到的业务背景', 'human');
    const changed = new TextDecoder().decode((await reader.read()).value); assert.match(changed, /event: change/);
    const snapshot = await (await fetch(`${dashboard.url}/api/tasks/${task.id}`)).json(); assert.equal(snapshot.hints[0].text, '刚收到的业务背景');
    await reader.cancel();
  } finally { controller.abort(); await dashboard.close(); writer.close(); store.close(); rmSync(dir, { recursive: true }); }
});
test('dashboard export contains the current report and invalid cursors are rejected', async () => {
  const { store, engine, task } = fixture(), dashboard = await startUi(engine, { port: 0 });
  try {
    const response = await fetch(`${dashboard.url}/api/tasks/${task.id}/export?format=markdown`);
    assert.match(response.headers.get('content-disposition')!, /attachment/); assert.match(await response.text(), /核对价格字段/);
    assert.equal((await fetch(`${dashboard.url}/api/tasks/${task.id}/events?after=-1`)).status, 400);
    assert.equal((await fetch(`${dashboard.url}/api/tasks/${task.id}/export?format=exe`)).status, 400);
  } finally { await dashboard.close(); store.close(); }
});
test('dashboard reports occupied ports and refuses public network binding', async () => {
  const { store, engine } = fixture(), first = await startUi(engine, { port: 0 });
  try {
    await assert.rejects(startUi(engine, { port: Number(new URL(first.url).port) }), (error: any) => error.code === 'EADDRINUSE');
    await assert.rejects(startUi(engine, { host: '0.0.0.0', port: 0 }), /loopback/);
  } finally { await first.close(); store.close(); }
});


test('curated dashboard exposes authored milestones and denies residual raw tool records', async () => {
  const { store, engine, task } = fixture();
  const observation = engine.observe(task.id, session, { callId: 'secret', tool: 'RAW_TOOL_SENTINEL', input: {}, output: 'RAW_SENTINEL', source: 'hook', status: 'success' });
  const changed = store.get(task.id); changed.evidenceMode = 'curated';
  changed.checkpoint = { summary: 'AI 整理了文件依据', questions: [], at: new Date().toISOString() };
  store.save(changed, 'task.checkpoint', { input: { summary: 'AI 整理了文件依据' } }, changed.checkpoint.at);
  const dashboard = await startUi(engine, { port: 0 });
  try {
    const events = await (await fetch(`${dashboard.url}/api/tasks/${task.id}/events`)).json();
    assert.ok(events.events.some((e: any) => e.title === '保存阶段进展' && e.summary === 'AI 整理了文件依据'));
    assert.ok(!JSON.stringify(events).includes('RAW_TOOL_SENTINEL')); assert.ok(!JSON.stringify(events).includes('RAW_SENTINEL'));
    assert.equal((await fetch(`${dashboard.url}/api/tasks/${task.id}/observations/${observation.id}`)).status, 404);
  } finally { await dashboard.close(); store.close(); }
});
