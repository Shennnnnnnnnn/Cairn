import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/core/store.js';
import { Engine } from '../src/core/engine.js';
import { projectTask } from '../src/ui/view.js';
import { projectGraph, layoutGraph, graphNodeSize, graphPalette } from '../src/ui/graph.js';
import type { Session } from '../src/core/types.js';

const session: Session = { host: 'codex', sessionId: 'graph-session', cwd: '/workspace' };
const at = '2026-10-15T09:00:00.000Z';
function fixture() {
  const store = new Store(':memory:'), engine = new Engine(store);
  const task = engine.create(session, { origin: '用户报告价格异常', goal: '查明异常机制与影响范围', criteria: ['明确机制', '明确范围'], evidenceMode: 'curated' });
  return { store, engine, task };
}

test('relationship graph preserves the original start, goal, formed-fact and running colors', () => {
  const { store, engine, task } = fixture();
  try {
    task.progress = [
      { key: 'mapping', title: '核对映射文件', status: 'completed', source: 'agent', updatedAt: at },
      { key: 'scope', title: '圈定影响范围', status: 'running', source: 'agent', updatedAt: at },
      { key: 'repair', title: '形成修复建议', status: 'pending', source: 'agent', updatedAt: at },
    ];
    const model = projectGraph(projectTask(engine, task)), nodes = new Map(model.nodes.map(n => [n.id, n]));
    assert.equal(nodes.get('origin')?.status, 'origin'); assert.equal(nodes.get('goal')?.status, 'goal');
    assert.equal(nodes.get('goal')?.label, task.goal);
    assert.equal(nodes.get('work:mapping')?.status, 'completed'); assert.equal(nodes.get('work:scope')?.status, 'running');
    assert.equal(nodes.get('work:repair')?.status, 'pending');
    assert.equal(graphPalette.origin.fill, '#14b8a6'); assert.equal(graphPalette.goal.fill, '#f43f5e');
    assert.equal(graphPalette.completed.fill, '#6366f1'); assert.equal(graphPalette.running.fill, '#f59e0b');
    assert.ok(model.edges.some(e => e.to === 'work:scope' && e.state === 'running'));
    assert.ok(!model.edges.some(e => e.from.startsWith('work:') && e.to.startsWith('work:')), 'plan array order does not establish dependency');
  } finally { store.close(); }
});

test('curated basis connects the start, conclusion, acceptance criterion and full task goal', () => {
  const { store, engine, task } = fixture();
  try {
    task.claims = [{ id: 'mapping', text: '1.4 重复乘以100', status: 'supported', basis: '映射文件中存在额外缩放', references: ['mapping.json:12'], provenance: 'agent', supports: [], refutes: [], scope: task.scope, revision: 1 }];
    task.criteria[0]!.claimIds = ['mapping'];
    const graph = projectGraph(projectTask(engine, task));
    for (const [from, to] of [['origin', 'basis:mapping'], ['basis:mapping', 'claim:mapping'], ['claim:mapping', 'criterion:c1'], ['criterion:c1', 'goal']]) assert.ok(graph.edges.some(e => e.from === from && e.to === to), `${from} -> ${to}`);
    assert.equal(graph.nodes.find(n => n.id === 'criterion:c1')?.status, 'goal');
    assert.match(graph.nodes.find(n => n.id === 'criterion:c1')!.state, /发现覆盖/);
    assert.equal(graph.nodes.filter(n => n.kind === 'observation').length, 0);
    assert.equal(graph.nodes.filter(n => n.kind === 'work').length, 0, 'criteria must not become invented work steps');
    const connected = new Set(['origin']);
    while (graph.edges.some(e => connected.has(e.from) && !connected.has(e.to))) for (const edge of graph.edges) if (connected.has(edge.from)) connected.add(edge.to);
    assert.equal(connected.size, graph.nodes.length, 'all saved branches are reachable from the start');
  } finally { store.close(); }
});

test('paused and completed graphs do not show stale recorded stages as running', () => {
  const { store, engine, task } = fixture();
  try {
    task.progress = [{ key: 'scope', title: '核对影响面', status: 'running', source: 'agent', updatedAt: at }];
    for (const status of ['suspended', 'completed'] as const) {
      task.status = status;
      const model = projectGraph(projectTask(engine, task));
      assert.ok(!model.nodes.some(n => n.status === 'running')); assert.ok(!model.edges.some(e => e.state === 'running'));
      assert.equal(model.nodes.find(n => n.id === 'goal')?.status, 'goal', 'a completed target keeps its rose role color');
    }
    assert.match(projectGraph(projectTask(engine, task)).nodes.find(n => n.id === 'goal')!.state, /流程已完成/);
  } finally { store.close(); }
});

test('captured history keeps genuine evidence paths and refutations without inventing execution stages', () => {
  const { store, engine, task } = fixture();
  try {
    delete task.evidenceMode; task.status = 'completed';
    task.observations = [{ id: 'raw-a', callId: 'read-a', tool: 'read_mapping', input: {}, output: 'raw', source: 'hook', scope: task.scope, actor: { host: 'codex', sessionId: session.sessionId, epoch: 1 }, status: 'success', capturedAt: at, eligible: true }];
    task.claims = [{ id: 'mapping', text: '服务崩溃假设已排除', status: 'refuted', supports: [], refutes: ['raw-a', 'missing-foreign-ref'], scope: task.scope, revision: 1 }];
    const model = projectGraph(projectTask(engine, task));
    assert.ok(model.edges.some(e => e.from === 'origin' && e.to === 'obs:raw-a'));
    assert.ok(model.edges.some(e => e.from === 'obs:raw-a' && e.to === 'claim:mapping' && e.state === 'refuted'));
    assert.ok(!model.nodes.some(n => n.kind === 'work' || n.status === 'running'));
    assert.ok(!model.edges.some(e => e.from.includes('missing-foreign-ref')));
    assert.equal(model.nodes.find(n => n.id === 'claim:mapping')?.status, 'refuted');
  } finally { store.close(); }
});

test('a new goal has a connected intent graph without claiming any completed investigation', () => {
  const { store, engine, task } = fixture();
  try {
    const model = projectGraph(projectTask(engine, task));
    assert.equal(model.nodes.filter(n => n.status === 'completed' || n.status === 'running').length, 0);
    assert.equal(model.nodes.filter(n => n.kind === 'work' || n.kind === 'basis' || n.kind === 'claim').length, 0);
    assert.ok(model.edges.filter(e => e.from === 'origin').every(e => e.state === 'context'));
    assert.ok(model.nodes.some(n => n.id === 'goal' && n.label === task.goal));
  } finally { store.close(); }
});

test('both graph layouts place all nodes in bounds without overlap within a rank', () => {
  const { store, engine, task } = fixture();
  try {
    task.progress = Array.from({ length: 7 }, (_, index) => ({ key: `step-${index}`, title: `调查项 ${index}`, status: 'pending', source: 'agent', updatedAt: at }));
    for (const direction of ['horizontal', 'vertical'] as const) {
      const graph = layoutGraph(projectGraph(projectTask(engine, task)), direction);
      for (const node of graph.nodes) {
        assert.ok(node.x >= 0 && node.y >= 0 && node.x + graphNodeSize.width <= graph.width && node.y + graphNodeSize.height <= graph.height);
        for (const other of graph.nodes.filter(n => n.rank === node.rank && n.id !== node.id)) assert.ok(Math.abs(other.x - node.x) >= graphNodeSize.width || Math.abs(other.y - node.y) >= graphNodeSize.height);
      }
    }
  } finally { store.close(); }
});
