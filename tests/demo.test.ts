import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareDemo, runDemo, type DemoStep } from '../src/demo.js';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { workspace as enclosingWorkspace } from '../src/paths.js';
import type { Task } from '../src/core/types.js';

const entry = resolve('dist/cairn.mjs');
const records = (path: string): any[] => readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false; throw error; } };
const workspace = () => {
  const parent = mkdtempSync(join(tmpdir(), 'cairn-demo-test-'));
  return { parent, ...prepareDemo(join(parent, 'workspace'), entry) };
};
const assertProcessesClosed = (root: string) => {
  const started = existsSync(join(root, 'demo-processes.jsonl')) ? records(join(root, 'demo-processes.jsonl')).filter(event => event.event === 'started') : [];
  const connected = records(join(root, 'execution.jsonl')).filter(step => step.name === 'mcp.connected');
  for (const event of [...started, ...connected]) assert.equal(alive(event.pid), false, `Demo child process ${event.pid} must exit`);
};

test('fresh demo uses actual typed stdio tools, checkpoints, closed-session takeover, and consistent exports', async () => {
  const demo = workspace(), steps: DemoStep[] = [];
  try {
    const result = await runDemo({ ...demo, entry, delayMs: 0, onStep: step => { steps.push(step); } });
    assert.equal(result.status, 'completed');
    const exported: Task = JSON.parse(readFileSync(result.taskPath, 'utf8'));
    const store = new Store(demo.db);
    try {
      const task = store.get(result.taskId);
      assert.deepEqual(exported, task);
      assert.equal(task.status, 'completed');
      assert.equal(task.owner.host, 'mcp');
      assert.equal(task.owner.epoch, 2);
      assert.equal(task.owner.sessionId, 'demo-resumed-session');
      assert.match(task.origin, /本地确定性演示/);
      assert.equal(task.profile, 'general');
      assert.equal(task.budget.maxCalls, 6);
      assert.equal(task.budget.maxParallel, 2);
      assert.equal(Object.keys(task.calls).length, 4);
      assert.equal(task.observations.length, 4);
      assert.deepEqual(task.observations.map(o => o.tool), ['service_health', 'price_sample', 'client_mapping', 'version_impact']);
      for (const observation of task.observations) {
        assert.equal(observation.source, 'gateway');
        assert.equal(observation.eligible, true);
        assert.equal(observation.status, 'success');
        assert.equal(observation.actor.host, 'mcp');
        assert.ok(observation.resultRef?.startsWith('demo:'));
        const output = observation.output as any;
        assert.equal(output.structuredContent.demo, true);
        assert.match(output.structuredContent.origin, /本地虚构/);
        assert.equal(output.structuredContent.result_ref, observation.resultRef);
      }
      assert.equal((task.observations[1]!.output as any).structuredContent.source.value, 10.26);
      assert.equal((task.observations[1]!.output as any).structuredContent.display.value, 1026);
      const crash = task.claims.find(c => c.key === 'crash')!;
      assert.equal(crash.status, 'refuted');
      assert.deepEqual(crash.refutes, [task.observations[0]!.id]);
      assert.deepEqual(crash.supports, []);
      assert.equal(new Engine(store).evaluateReport(task, task.report!).ok, true);
      assert.deepEqual(task.checkpoint!.questions, []);
      assert.deepEqual(new Set(task.report!.citations.map(c => c.resultRef)), new Set(task.observations.map(o => o.resultRef)));
      assert.ok(task.criteria.every(c => c.claimIds.length));
      assert.match(task.report!.solution!.mitigation, /未实际执行/);
      const history = store.events(task.id);
      const suspended = history.find(e => e.kind === 'task.finished' && e.payload.phase === 'suspended')!;
      const resumed = history.find(e => e.kind === 'task.resumed')!;
      const completed = history.find(e => e.kind === 'task.finished' && e.payload.phase === 'completed')!;
      assert.ok(suspended.seq < resumed.seq && resumed.seq < completed.seq);
    } finally { store.close(); }
    const trace = records(result.executionPath);
    assert.deepEqual(trace.filter(e => e.name !== 'mcp.closed'), steps);
    assert.equal(trace.at(-1)!.name, 'demo.completed');
    assert.equal(trace.findLast(e=>e.tool==='cairn_finish')!.phase,'completed');
    assert.equal(trace.filter(e => e.name === 'mcp.connected').length, 2);
    assert.equal(trace.filter(e => e.name === 'mcp.closed').length, 2);
    const firstClose = trace.findIndex(e => e.name === 'mcp.closed');
    const secondConnect = trace.findIndex((e, index) => e.name === 'mcp.connected' && index > firstClose);
    assert.ok(firstClose >= 0 && secondConnect > firstClose);
    const resume: any = trace.find(e => e.tool === 'cairn_resume');
    assert.deepEqual(resume.arguments, { task_id: result.taskId, takeover: true });
    assert.equal(resume.result.checkpoint.questions.length, 2);
    assert.equal(resume.result.claims.find((c: any) => c.key === 'crash').status, 'refuted');
    assert.equal(trace.filter(e => e.tool?.startsWith('cairn_tool_')).length, 4);
    const md = readFileSync(result.reportPath, 'utf8'), evidence = readFileSync(result.evidencePath, 'utf8');
    assert.match(md, /确定性 driver/);
    assert.match(md, /Status: completed/);
    for (const citation of exported.report!.citations) assert.ok(md.includes(citation.resultRef!));
    for (const observation of exported.observations) assert.ok(evidence.includes(observation.resultRef!));
    assert.ok(evidence.includes('demo'));
    assertProcessesClosed(demo.root);
    const taskCount = new Store(demo.db);
    try { assert.equal(taskCount.list().length, 1); } finally { taskCount.close(); }
    await assert.rejects(runDemo({ ...demo, entry, delayMs: 0 }), /EEXIST/);
  } finally { rmSync(demo.parent, { recursive: true, force: true }); }
});

test('prepare refuses nonempty roots, preserves their contents, and emits an executable native-host prompt', () => {
  const parent = mkdtempSync(join(tmpdir(), 'cairn-demo-prepare-'));
  try {
    writeFileSync(join(parent, 'sentinel.txt'), 'keep this');
    assert.throws(() => prepareDemo(parent, entry), /new or empty directory/);
    assert.equal(readFileSync(join(parent, 'sentinel.txt'), 'utf8'), 'keep this');
    assert.deepEqual(readdirSync(parent), ['sentinel.txt']);
    mkdirSync(join(parent, '.git'));
    const demo = prepareDemo(join(parent, 'fresh'), entry);
    assert.equal(enclosingWorkspace(demo.root), parent, 'Nested directories normally resolve to the enclosing Git workspace');
    assert.equal(demo.db, join(demo.root, '.cairn', 'state.db'));
    const scenario = JSON.parse(readFileSync(demo.scenarioPath, 'utf8'));
    assert.equal(scenario.demo, true);
    const prompt = readFileSync(demo.promptPath, 'utf8');
    assert.match(prompt, /cairn demo --prepare/);
    assert.match(prompt, /cairn install --target codex/);
    assert.match(prompt, /cairn_resume/);
    assert.match(prompt, /真实 CLI/);
    assert.match(prompt, /如果数据库不符，先停止/);
    assert.ok(prompt.includes(`export CAIRN_DB='${demo.db}'`));
    assert.ok(prompt.includes(`cairn ui --db '${demo.db}'`));
    const store = new Store(demo.db);
    try {
      assert.equal(store.list().length, 0);
      const gateway = store.config<any>('gateway');
      assert.equal(gateway.tools.length, 4);
      assert.deepEqual(gateway.servers.demo.args, [entry, 'demo-tools', '--root', demo.root]);
    } finally { store.close(); }
    assert.throws(() => prepareDemo(demo.root, entry), /new or empty directory/);
  } finally { rmSync(parent, { recursive: true, force: true }); }
});

test('interruption preserves incomplete evidence, closes children, and never starts the recovery session', async () => {
  const demo = workspace(), controller = new AbortController();
  try {
    await assert.rejects(runDemo({ ...demo, entry, delayMs: 0, signal: controller.signal, onStep: step => {
      if (step.name === 'cairn_checkpoint') controller.abort(new DOMException('User interrupted demo', 'AbortError'));
    } }), /User interrupted/);
    const store = new Store(demo.db);
    try {
      assert.equal(store.list().length, 1);
      const task = store.get(store.list()[0]!.id);
      assert.equal(task.status, 'suspended');
      assert.equal(task.owner.epoch, 1);
      assert.equal(task.observations.length, 2);
      assert.ok(task.checkpoint?.questions.length);
      assert.ok(!store.events(task.id).some(e => e.kind === 'task.resumed'));
      assert.deepEqual(JSON.parse(readFileSync(join(demo.root, 'task.json'), 'utf8')), task);
    } finally { store.close(); }
    const trace = records(join(demo.root, 'execution.jsonl'));
    assert.equal(trace.at(-1)!.name, 'demo.aborted');
    assert.equal(trace.filter(step => step.name === 'mcp.connected').length, 1);
    assert.equal(trace.some(step => step.name === 'demo.completed'), false);
    assertProcessesClosed(demo.root);
  } finally { rmSync(demo.parent, { recursive: true, force: true }); }
});

test('a pre-aborted demo never starts an MCP or upstream process', async () => {
  const demo = workspace(), controller = new AbortController();
  controller.abort(new DOMException('Already interrupted', 'AbortError'));
  try {
    await assert.rejects(runDemo({ ...demo, entry, delayMs: 0, signal: controller.signal }), /Already interrupted/);
    assert.equal(existsSync(join(demo.root, 'demo-processes.jsonl')), false);
    const store = new Store(demo.db);
    try { assert.equal(store.list().length, 0); } finally { store.close(); }
    assert.equal(records(join(demo.root, 'execution.jsonl')).at(-1).name, 'demo.aborted');
  } finally { rmSync(demo.parent, { recursive: true, force: true }); }
});


test('demo refuses a different database or changed upstream before launching any process', async () => {
  const demo = workspace();
  try {
    const outside = join(demo.parent, 'unrelated.db');
    await assert.rejects(runDemo({ ...demo, db: outside, entry, delayMs: 0 }), /isolated database/);
    assert.equal(existsSync(outside), false);
    const store = new Store(demo.db);
    try {
      const config = store.config<any>('gateway');
      config.servers.demo = { command: process.execPath, args: ['some-other-server.mjs'] };
      store.setConfig('gateway', config);
    } finally { store.close(); }
    await assert.rejects(runDemo({ ...demo, entry, delayMs: 0 }), /original local read-only fixture whitelist/);
    assert.equal(existsSync(join(demo.root, 'execution.jsonl')), false);
    assert.equal(existsSync(join(demo.root, 'demo-processes.jsonl')), false);
  } finally { rmSync(demo.parent, { recursive: true, force: true }); }
});
