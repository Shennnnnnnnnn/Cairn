import type { TaskView } from './view.js';

export type GraphNodeKind = 'origin' | 'goal' | 'branch' | 'review' | 'work' | 'action' | 'observation' | 'basis' | 'claim' | 'criterion';
export type GraphState = 'origin' | 'goal' | 'running' | 'review' | 'completed' | 'pending' | 'blocked' | 'refuted' | 'cancelled';
export type GraphActor = 'main' | 'subagent';
export type GraphNode = { id: string; kind: GraphNodeKind; label: string; state: string; status: GraphState; rank: number; data: any; actor?: GraphActor };
export type GraphEdge = { from: string; to: string; relation: 'context' | 'branch' | 'handoff' | 'review' | 'stage' | 'basis' | 'supports' | 'refutes' | 'criterion' | 'goal'; state: 'context' | 'running' | 'review' | 'completed' | 'pending' | 'refuted' };
export type GraphModel = { nodes: GraphNode[]; edges: GraphEdge[] };

/** The original Cairn graph palette: teal start, rose goal, indigo facts, amber execution. */
export const graphPalette = {
  origin: { fill: '#14b8a6', stroke: '#0d9488', text: '#ffffff', muted: '#ecfdf5' },
  goal: { fill: '#f43f5e', stroke: '#e11d48', text: '#ffffff', muted: '#fff1f2' },
  running: { fill: '#f59e0b', stroke: '#d97706', text: '#422006', muted: '#713f12' },
  review: { fill: '#e0f2fe', stroke: '#38bdf8', text: '#075985', muted: '#0284c7' },
  completed: { fill: '#6366f1', stroke: '#4f46e5', text: '#ffffff', muted: '#eef2ff' },
  pending: { fill: '#f8fafc', stroke: '#cbd5e1', text: '#64748b', muted: '#94a3b8' },
  blocked: { fill: '#fff7ed', stroke: '#fdba74', text: '#9a3412', muted: '#c2410c' },
  refuted: { fill: '#fff1f2', stroke: '#fda4af', text: '#be123c', muted: '#e11d48' },
  cancelled: { fill: '#f8fafc', stroke: '#e2e8f0', text: '#94a3b8', muted: '#94a3b8' },
} satisfies Record<GraphState, { fill: string; stroke: string; text: string; muted: string }>;
export const graphKindLabels: Record<GraphNodeKind, string> = { origin: '起点', goal: '任务目标', branch: '排查分支', review: '复核汇总', work: '执行阶段', action: '历史行动', observation: '原始观测', basis: 'AI 整理的依据', claim: '假设与结论', criterion: '目标条件' };

/** Project only saved relationships. Plan order does not imply dependency or causality. */
export function projectGraph(task: TaskView): GraphModel {
  const nodes: GraphNode[] = [], edges: GraphEdge[] = [];
  const add = (rank: number, kind: GraphNodeKind, id: string, label: string, state: string, status: GraphState, data: any, actor?: GraphActor) => nodes.push({ rank, kind, id, label, state, status, data, ...(actor?{actor}:{}) });
  const connect = (from: string, to: string, relation: GraphEdge['relation'], state: GraphEdge['state'] = 'completed') => edges.push({ from, to, relation, state });
  const claimLabels = { proposed: '待验证', supported: '已形成结论', refuted: '已反驳', inconclusive: '依据不足' };
  const branches = new Map((task.branches ?? []).map(branch=>[branch.key,branch]));
  const depths = new Map<string,number>();
  for (const branch of branches.values()) {
    let depth=1,parent=branch.parent;const seen=new Set([branch.key]);
    while(parent&&branches.has(parent)&&!seen.has(parent)){seen.add(parent);depth++;parent=branches.get(parent)!.parent;}
    depths.set(branch.key,depth);
  }
  const hasDelegates=[...branches.values()].some(branch=>branch.executor==='subagent');
  const evidenceRank = Math.max(0,...depths.values())+(hasDelegates?2:1);
  const branchOrigin = (key?:string) => key&&branches.has(key)?`branch:${key}`:'origin';
  const actorFor = (key?:string): GraphActor => key&&branches.get(key)?.executor==='subagent'?'subagent':'main';
  add(0, 'origin', 'origin', task.origin, '起点 · 已知背景', 'origin', task);
  add(evidenceRank+3, 'goal', 'goal', task.goal, task.status === 'completed' ? '✓ 目标已完成' : task.check.ok ? '✓ 条件已满足 · 待完成检查' : task.status === 'suspended' ? '目标尚未完成 · 任务已暂停' : '目标尚未完成', 'goal', task);
  for (const branch of branches.values()) {
    const status: GraphState = branch.status==='awaiting_review'?'review':branch.status;
    const state=branch.executor==='subagent'&&branch.status==='awaiting_review'?'已返回 · 待主 Agent 复核':branch.executor==='subagent'&&branch.status==='completed'?'已返回 · 主 Agent 已复核':`${branch.executorLabel} · ${branch.statusLabel}`;
    add(depths.get(branch.key)!, 'branch', `branch:${branch.key}`, branch.title, state, status, branch, branch.executor);
    connect(branchOrigin(branch.parent), `branch:${branch.key}`, 'branch', status==='running'?'running':status==='completed'?'completed':'pending');
    if(branch.executor==='subagent'&&['awaiting_review','completed'].includes(branch.status)){
      const accepted=branch.status==='completed';
      add(evidenceRank-1,'review',`review:${branch.key}`,branch.title,accepted?'主 Agent · 复核完成':'主 Agent · 等待复核',accepted?'completed':'review',branch,'main');
      connect(`branch:${branch.key}`,`review:${branch.key}`,'handoff',accepted?'completed':'review');
      for(const claim of task.claims.filter(claim=>claim.branch===branch.key))connect(`review:${branch.key}`,`claim:${claim.id}`,'review',accepted?'completed':'pending');
    }
  }

  // Historical criterion projections duplicate the real target nodes and are omitted.
  for (const item of task.workItems.filter(i => i.source !== 'criterion')) {
    const action = item.source === 'action' ? task.actions.find(a => `action:${a.id}` === item.key) : undefined;
    const id = action ? `action:${action.id}` : `work:${item.key}`;
    const status = task.status !== 'active' && item.status === 'running' ? task.status === 'suspended' ? 'blocked' : 'pending' : item.status;
    const state = task.status !== 'active' && item.status === 'running' ? task.status === 'suspended' ? '已暂停' : '阶段未单独确认' : item.statusLabel;
    add(item.branch&&depths.has(item.branch)?depths.get(item.branch)!+1:1, action ? 'action' : 'work', id, item.title, state, status, action ?? item,actorFor(item.branch));
    connect(branchOrigin(item.branch), id, 'stage', status === 'running' ? 'running' : status === 'completed' ? 'completed' : 'pending');
    if (action) for (const observation of action.observationIds) connect(id, `obs:${observation}`, 'basis');
  }
  if ((task.evidenceMode ?? 'captured') === 'curated') {
    for (const claim of task.claims) if (claim.basis || claim.references?.length) {
      add(evidenceRank, 'basis', `basis:${claim.id}`, claim.basis || claim.references?.[0] || 'AI 整理的依据', 'AI 整理 · 引用可核对', 'completed', claim,actorFor(claim.branch));
      connect(branchOrigin(claim.branch), `basis:${claim.id}`, claim.branch?'branch':'context', 'context');
      connect(`basis:${claim.id}`, `claim:${claim.id}`, 'basis', claim.status === 'refuted' ? 'refuted' : 'completed');
    }
  }
  for (const observation of task.observations) {
    const state = observation.status === 'error' ? '查询失败' : observation.eligible ? '已取得原始观测' : '历史记录 · 不参与完成判定';
    add(evidenceRank, 'observation', `obs:${observation.id}`, `${observation.ref} · ${observation.tool}`, state, observation.status === 'error' ? 'blocked' : 'completed', observation,'main');
    connect('origin', `obs:${observation.id}`, 'context', 'context');
  }
  for (const claim of task.claims) {
    const status = claim.status === 'supported' ? 'completed' : claim.status === 'refuted' ? 'refuted' : 'pending';
    add(evidenceRank+1, 'claim', `claim:${claim.id}`, claim.text, claimLabels[claim.status], status, claim,actorFor(claim.branch));
    if(claim.branch&&(!((task.evidenceMode??'captured')==='curated')||(!claim.basis&&!claim.references?.length)))connect(branchOrigin(claim.branch),`claim:${claim.id}`,'branch','context');
    for (const ref of claim.supports) connect(`obs:${ref}`, `claim:${claim.id}`, 'supports');
    for (const ref of claim.refutes) connect(`obs:${ref}`, `claim:${claim.id}`, 'refutes', 'refuted');
  }
  for (const criterion of task.criteria) {
    const met = !task.check.unmet.includes(criterion.id);
    add(evidenceRank+2, 'criterion', `criterion:${criterion.id}`, criterion.text, met ? '✓ 目标条件已满足' : '○ 目标条件待满足', 'goal', criterion);
    for (const ref of criterion.claimIds) connect(`claim:${ref}`, `criterion:${criterion.id}`, 'criterion', met ? 'completed' : 'pending');
    connect(`criterion:${criterion.id}`, 'goal', 'goal', met ? 'completed' : 'pending');
  }
  const nodeIds = new Set(nodes.map(n => n.id));
  // Stale or cross-task references never create invented nodes or dangling edges.
  const validEdges = edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to));
  for (const node of nodes) if (node.id !== 'origin' && !validEdges.some(e => e.to === node.id)) {
    validEdges.push({ from: 'origin', to: node.id, relation: node.kind === 'criterion' || node.kind === 'goal' ? 'goal' : 'context', state: 'context' });
  }
  return { nodes, edges: validEdges };
}

export const graphNodeSize = { width: 225, height: 94 };
export interface GraphLane { actor: GraphActor; label: string; x: number; y: number; width: number; height: number }
export function layoutGraph(model: GraphModel, direction: 'vertical' | 'horizontal') {
  const rankCount = Math.max(4,...model.nodes.map(node=>node.rank))+1;
  const ranks = Array.from({ length: rankCount }, (_, rank) => model.nodes.filter(n => n.rank === rank));
  // Keep each branch's work and evidence in the same relative lane. Storage
  // arrival order (e.g. the main agent returning first) must not cross the
  // independent branches or visually suggest a different parent.
  const branches=new Map(model.nodes.filter(node=>node.kind==='branch').map(node=>[node.data.key as string,node]));
  const roots=[...branches.values()].filter(node=>!branches.has(node.data.parent)).map(node=>node.data.key as string);
  const lane=(node:GraphNode)=>{
    let key:string|undefined=node.kind==='branch'?node.data.key:node.data.branch;
    if(node.kind==='criterion')key=model.nodes.find(claim=>claim.kind==='claim'&&node.data.claimIds.includes(claim.data.id)&&claim.data.branch)?.data.branch;
    const seen=new Set<string>();
    while(key&&branches.get(key)?.data.parent&&!seen.has(key)){seen.add(key);key=branches.get(key)!.data.parent;}
    const index=key?roots.indexOf(key):-1;return index<0?roots.length:index;
  };
  if(branches.size)for(const column of ranks)column.sort((a,b)=>lane(a)-lane(b));
  if(branches.size){
    const vertical=direction==='vertical',pitch=vertical?255:120,flow=vertical?150:285;
    const actors:GraphActor[]=model.nodes.some(node=>node.actor==='subagent')?['main','subagent']:['main'];
    const spans=new Map(actors.map(actor=>[actor,Math.max(1,...ranks.map(column=>column.filter(node=>node.actor===actor).length))*pitch]));
    const groupSpan=actors.reduce((sum,actor)=>sum+spans.get(actor)!,0)+(actors.length-1)*40;
    const sharedSpan=Math.max(1,...ranks.map(column=>column.filter(node=>!node.actor).length))*pitch;
    const cross=Math.max(groupSpan,sharedSpan)+40,offsets=new Map<GraphActor,number>();let offset=(cross-groupSpan)/2;
    for(const actor of actors){offsets.set(actor,offset);offset+=spans.get(actor)!+40;}
    const nodes=ranks.flatMap((column,rank)=>{
      const counts=new Map<string,number>();
      return column.map(node=>{
        const key=node.actor??'shared',index=counts.get(key)??0;counts.set(key,index+1);
        const count=column.filter(item=>item.actor===node.actor).length;
        const across=node.actor?offsets.get(node.actor)!+index*pitch:(cross-count*pitch)/2+index*pitch;
        return {...node,x:vertical?across+(pitch-225)/2:20+rank*flow,y:vertical?20+rank*flow:across+(pitch-94)/2};
      });
    });
    const lastOwned=Math.max(1,...model.nodes.filter(node=>node.actor).map(node=>node.rank));
    const start=20+flow-32,end=20+lastOwned*flow+(vertical?94:225)+18;
    const lanes:GraphLane[]=actors.map(actor=>({actor,label:actor==='main'?'主 Agent · 推进与复核':'子 Agent · 独立排查',x:vertical?offsets.get(actor)!-8:start,y:vertical?start:offsets.get(actor)!-10,width:vertical?spans.get(actor)!+16:end-start,height:vertical?end-start:spans.get(actor)!+20}));
    return {...model,nodes,width:vertical?cross:rankCount*flow+10,height:vertical?rankCount*flow+10:cross,lanes};
  }
  const count = Math.max(...ranks.map(column => column.length), 2), vertical = direction === 'vertical';
  const width = vertical ? count * 255 + 30 : rankCount * 285 - 30;
  const height = vertical ? rankCount * 150 - 25 : count * 120 + 30;
  const nodes = ranks.flatMap((column, rank) => column.map((node, index) => ({ ...node,
    x: vertical ? 20 + index * 255 + (width - column.length * 255 - 30) / 2 : 20 + rank * 285,
    y: vertical ? 20 + rank * 150 : 20 + index * 120 + (height - column.length * 120 - 30) / 2,
  })));
  return { ...model, nodes, width, height, lanes:[] as GraphLane[] };
}
