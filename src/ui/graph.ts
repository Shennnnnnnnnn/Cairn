import type { TaskView } from './view.js';

export type GraphNodeKind = 'origin' | 'goal' | 'work' | 'action' | 'observation' | 'basis' | 'claim' | 'criterion';
export type GraphState = 'origin' | 'goal' | 'running' | 'completed' | 'pending' | 'blocked' | 'refuted' | 'cancelled';
export type GraphNode = { id: string; kind: GraphNodeKind; label: string; state: string; status: GraphState; rank: number; data: any };
export type GraphEdge = { from: string; to: string; relation: 'context' | 'stage' | 'basis' | 'supports' | 'refutes' | 'criterion' | 'goal' | 'dependency'; state: 'context' | 'running' | 'completed' | 'pending' | 'refuted'; group?: string };
export type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[] };

/** The original Cairn graph palette: teal start, rose goal, indigo facts, amber execution. */
export const graphPalette = {
  origin: { fill: '#14b8a6', stroke: '#0d9488', text: '#ffffff', muted: '#ecfdf5' },
  goal: { fill: '#f43f5e', stroke: '#e11d48', text: '#ffffff', muted: '#fff1f2' },
  running: { fill: '#f59e0b', stroke: '#d97706', text: '#422006', muted: '#713f12' },
  completed: { fill: '#6366f1', stroke: '#4f46e5', text: '#ffffff', muted: '#eef2ff' },
  pending: { fill: '#f8fafc', stroke: '#cbd5e1', text: '#64748b', muted: '#94a3b8' },
  blocked: { fill: '#fff7ed', stroke: '#fdba74', text: '#9a3412', muted: '#c2410c' },
  refuted: { fill: '#fff1f2', stroke: '#fda4af', text: '#be123c', muted: '#e11d48' },
  cancelled: { fill: '#f8fafc', stroke: '#e2e8f0', text: '#94a3b8', muted: '#94a3b8' },
} satisfies Record<GraphState, { fill: string; stroke: string; text: string; muted: string }>;
export const graphKindLabels: Record<GraphNodeKind, string> = { origin: '起点', goal: '任务目标', work: '执行阶段', action: '历史行动', observation: '原始观测', basis: 'AI 整理的依据', claim: '假设与结论', criterion: '目标条件' };

/** Project only saved relationships. Plan order does not imply dependency or causality. */
export type GraphTask=Pick<TaskView,'origin'|'goal'|'status'|'check'|'workItems'|'actions'|'evidenceMode'|'claims'|'observations'|'criteria'>;
export function projectGraph(task: GraphTask): GraphModel {
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [];
  const add = (rank: number, kind: GraphNodeKind, id: string, label: string, state: string, status: GraphState, data: any) => nodes.push({ rank, kind, id, label, state, status, data });
  const connect = (from: string, to: string, relation: GraphEdge['relation'], state: GraphEdge['state'] = 'completed') => edges.push({ from, to, relation, state });
  const claimLabels = { proposed: '待验证', supported: '模型判断有支持', refuted: '已反驳', inconclusive: '依据不足' };
  const workIds=new Map(task.workItems.map(item=>[`work:${item.source}:${item.key}`,task.workItems.filter(other=>other.key===item.key).length>1?`work:${item.source}:${item.key}`:`work:${item.key}`]));
  const dependency=(ref:string)=>workIds.get(ref)??ref;
  const dependencies=(from:string[]|undefined,to:string)=>{for(const ref of from??[])edges.push({from:dependency(ref),to,relation:'dependency',state:'completed',group:`dependencies:${to}`});};
  add(0, 'origin', 'origin', task.origin, '起点 · 已知背景', 'origin', task);
  add(4, 'goal', 'goal', task.goal, task.status === 'completed' ? '✓ 流程已完成 · 结论另行审查' : task.check.ok ? '✓ 条件已满足 · 待完成检查' : task.status === 'suspended' ? '目标尚未完成 · 任务已暂停' : '目标尚未完成', 'goal', task);

  // Historical criterion projections duplicate the real target nodes and are omitted.
  for (const item of task.workItems.filter(i => i.source !== 'criterion')) {
    const action = item.source === 'action' ? task.actions.find(a => `action:${a.id}` === item.key) : undefined;
    const id = action ? `action:${action.id}` : workIds.get(`work:${item.source}:${item.key}`)!;
    const status = task.status !== 'active' && item.status === 'running' ? task.status === 'suspended' ? 'blocked' : 'pending' : item.status;
    const state = task.status !== 'active' && item.status === 'running' ? task.status === 'suspended' ? '已暂停' : '阶段未单独确认' : item.statusLabel;
    add(1, action ? 'action' : 'work', id, item.title, state, status, action ?? item);
    if(item.from?.length)dependencies(item.from,id);
    else connect('origin', id, 'stage', status === 'running' ? 'running' : status === 'completed' ? 'completed' : 'pending');
    if (action) for (const observation of action.observationIds) connect(id, `obs:${observation}`, 'basis');
  }
  if ((task.evidenceMode ?? 'captured') === 'curated') {
    for (const claim of task.claims) if (claim.basis || claim.references?.length) {
      add(1, 'basis', `basis:${claim.id}`, claim.basis || claim.references?.[0] || 'AI 整理的依据', 'AI 整理 · 引用可核对', 'completed', claim);
      connect('origin', `basis:${claim.id}`, 'context', 'context');
      connect(`basis:${claim.id}`, `claim:${claim.id}`, 'basis', claim.status === 'refuted' ? 'refuted' : 'completed');
    }
  }
  for (const observation of task.observations) {
    const state = observation.status === 'error' ? '查询失败' : observation.eligible ? '已取得原始观测' : '历史记录 · 不参与完成判定';
    add(1, 'observation', `obs:${observation.id}`, `${observation.ref} · ${observation.tool}`, state, observation.status === 'error' ? 'blocked' : 'completed', observation);
    connect('origin', `obs:${observation.id}`, 'context', 'context');
  }
  for (const claim of task.claims) {
    const status = claim.status === 'supported' ? 'completed' : claim.status === 'refuted' ? 'refuted' : 'pending';
    add(2, 'claim', `claim:${claim.id}`, claim.text, claimLabels[claim.status], status, claim);
    dependencies(claim.from,`claim:${claim.id}`);
    for (const ref of claim.supports) connect(`obs:${ref}`, `claim:${claim.id}`, 'supports');
    for (const ref of claim.refutes) connect(`obs:${ref}`, `claim:${claim.id}`, 'refutes', 'refuted');
  }
  for (const criterion of task.criteria) {
    const met = !task.check.unmet.includes(criterion.id);
    add(3, 'criterion', `criterion:${criterion.id}`, criterion.text, met ? '✓ 已有发现覆盖此条件' : '○ 目标条件待满足', 'goal', criterion);
    for (const ref of criterion.claimIds) connect(`claim:${ref}`, `criterion:${criterion.id}`, 'criterion', met ? 'completed' : 'pending');
    connect(`criterion:${criterion.id}`, 'goal', 'goal', met ? 'completed' : 'pending');
  }
  const nodeIds = new Set(nodes.map(n => n.id));
  // Stale or cross-task references never create invented nodes or dangling edges.
  const validEdges = edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
  for (const node of nodes) if (node.id !== 'origin' && !validEdges.some(e => e.to === node.id)) {
    validEdges.push({ from: 'origin', to: node.id, relation: node.kind === 'criterion' || node.kind === 'goal' ? 'goal' : 'context', state: 'context' });
  }
  const byId=new Map(nodes.map(node=>[node.id,node]));
  const indegree=new Map(nodes.map(node=>[node.id,0])),children=new Map<string,string[]>();
  for(const edge of validEdges){indegree.set(edge.to,indegree.get(edge.to)!+1);const values=children.get(edge.from)??[];values.push(edge.to);children.set(edge.from,values);}
  const ready=nodes.filter(node=>!indegree.get(node.id));for(const node of nodes)node.rank=0;
  for(let index=0;index<ready.length;index++)for(const id of children.get(ready[index]!.id)??[]){
    const child=byId.get(id)!;child.rank=Math.max(child.rank,ready[index]!.rank+1);
    indegree.set(id,indegree.get(id)!-1);if(!indegree.get(id))ready.push(child);
  }
  // Criteria and the goal remain to the right of every exploration branch.
  const depth=Math.max(0,...nodes.filter(n=>!['goal','criterion'].includes(n.kind)).map(n=>n.rank));
  for(const node of nodes)if(node.kind==='criterion')node.rank=depth+1;else if(node.kind==='goal')node.rank=depth+2;
  return { nodes, edges: validEdges };
}

export const graphNodeSize = { width: 225, height: 94 };
export function layoutGraph(model: GraphModel, direction: 'vertical' | 'horizontal') {
  const rankCount=Math.max(1,...model.nodes.map(node=>node.rank+1));
  const ranks = Array.from({ length: rankCount }, (_, rank) => model.nodes.filter(n => n.rank === rank));
  const count = Math.max(...ranks.map(column => column.length), 2), vertical = direction === 'vertical';
  const width = vertical ? count * 255 + 30 : rankCount * 285 - 30;
  const height = vertical ? rankCount * 150 - 25 : count * 120 + 30;
  const nodes = ranks.flatMap((column, rank) => column.map((node, index) => ({ ...node,
    x: vertical ? 20 + index * 255 + (width - column.length * 255 - 30) / 2 : 20 + rank * 285,
    y: vertical ? 20 + rank * 150 : 20 + index * 120 + (height - column.length * 120 - 30) / 2,
  })));
  return { ...model, nodes, width, height };
}
