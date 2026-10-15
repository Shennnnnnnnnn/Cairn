import type { TaskView } from './view.js';
import { projectGraph, graphKindLabels, type GraphNode, type GraphActor } from './graph.js';

export interface CheckpointChange {
  nodeId: string; relatedIds: string[]; kind: GraphNode['kind']; actor?: GraphActor;
  title: string; change: 'added' | 'updated' | 'removed'; label: string; before?: string; after?: string;
}
export interface CheckpointDelta {
  baseline: 'initial' | 'previous' | 'gap' | 'unknown';
  previous?: { seq: number; at: string }; missing: number; elapsedMs?: number;
  changes: CheckpointChange[]; highlighted: string[];
  reportChanged: boolean; summaryChanged: boolean; ownerChanged: boolean;
}

/** Compare visible domain content, excluding storage revisions and timestamps. */
function signature(node: GraphNode) {
  const d=node.data;
  switch(node.kind){
    case 'origin':return [d.origin];
    case 'goal':return [node.label,node.state,d.status,d.check?.ok];
    case 'branch':return [node.label,node.status,d.executor,d.assignee,d.agentId,d.parent,d.question,d.rationale,d.summary,d.epoch,d.attempt,d.activitySource,d.activityStatus];
    case 'review':return [node.label,node.status,d.summary];
    case 'basis':return [d.basis,d.references?.slice().sort(),d.provenance,d.scope,d.branch];
    case 'claim':return [d.text,d.status,d.supports.slice().sort(),d.refutes.slice().sort(),d.scope,d.branch,d.relatedCriteria?.slice().sort()];
    case 'criterion':return [node.label,node.state,d.claimIds.slice().sort()];
    case 'work':return [node.label,node.status,d.detail,d.branch,d.source];
    case 'action':return [d.purpose,d.status,d.stopCondition,d.observationIds];
    case 'observation':return [d.id,d.tool,d.status,d.eligible,d.resultRef,d.scope];
  }
}
function canonical(value: unknown): unknown {
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
  return value;
}
export function branchTransition(node: GraphNode, before?: GraphNode): string {
  const status=node.data.status;
  if(!before&&status==='pending')return '建立待排查分支';
  if(status==='running'&&before?.data.status!=='running')return before&&before.data.status!=='pending'?'继续执行':'开始执行';
  if(status==='awaiting_review'&&before?.data.status!=='awaiting_review')return node.actor==='subagent'?'返回待汇总':'等待汇总';
  if(status==='completed'&&before?.data.status!=='completed')return node.actor==='subagent'?'主 Agent 复核完成':'主 Agent 执行完成';
  if(status==='cancelled'&&before?.data.status!=='cancelled')return '取消排查';
  if(status==='blocked'&&before?.data.status!=='blocked')return '暂停 / 受阻';
  if(before&&(node.actor!==before.actor||node.data.agentId!==before.data.agentId||node.data.epoch!==before.data.epoch))return '更新负责人';
  if(before&&node.data.parent!==before.data.parent)return '调整分支归属';
  if(status==='running'&&before&&node.data.attempt!==before.data.attempt)return '新一轮执行';
  if(before&&(node.data.activitySource!==before.data.activitySource||node.data.activityStatus!==before.data.activityStatus))return '同步宿主状态';
  return before?'更新分支说明':'建立排查分支';
}
export function compareCheckpoint(current: TaskView, previous?: TaskView, options: { baseline?: CheckpointDelta['baseline']; previousSeq?: number; missing?: number } = {}): CheckpointDelta {
  const baseline=options.baseline??(previous?'previous':'initial');
  if(previous&&previous.id!==current.id)throw new Error('Cannot compare checkpoints from different tasks');
  const now=projectGraph(current),old=previous?projectGraph(previous):undefined;
  const prior=new Map(old?.nodes.map(node=>[node.id,node])??[]),present=new Map(now.nodes.map(node=>[node.id,node]));
  const changes:CheckpointChange[]=[];
  if(baseline!=='unknown'){
    for(const node of now.nodes){
      const before=prior.get(node.id);
      if(before&&JSON.stringify(canonical([before.actor,signature(before)]))===JSON.stringify(canonical([node.actor,signature(node)])))continue;
      // The derived review node is highlighted together with its branch, so a
      // single returned result does not become two apparent operations.
      if(node.kind==='review')continue;
      const change=before?'updated':'added';
      const label=node.kind==='branch'?branchTransition(node,before):node.kind==='goal'&&current.status==='completed'?'主目标验收完成':`${before?'更新':'新增'}${graphKindLabels[node.kind]}`;
      const reviewId=node.kind==='branch'?`review:${node.data.key}`:undefined;
      changes.push({nodeId:node.id,relatedIds:reviewId&&present.has(reviewId)?[reviewId]:[],kind:node.kind,...(node.actor?{actor:node.actor}:{}),title:node.label,change,label,...(before?{before:before.state}:{}),after:node.state});
    }
    for(const node of old?.nodes??[])if(!present.has(node.id)&&node.kind!=='review')changes.push({nodeId:node.id,relatedIds:[],kind:node.kind,...(node.actor?{actor:node.actor}:{}),title:node.label,change:'removed',label:`移除${graphKindLabels[node.kind]}`,before:node.state});
  }
  // Branch transitions lead the list; geometry changes never enter this diff.
  changes.sort((a,b)=>Number(b.kind==='branch')-Number(a.kind==='branch'));
  const highlighted=new Set(changes.flatMap(change=>[change.nodeId,...change.relatedIds]).filter(id=>present.has(id)));
  const elapsed=previous?Date.parse(current.updatedAt)-Date.parse(previous.updatedAt):NaN;
  return {baseline,...(previous?{previous:{seq:options.previousSeq??0,at:previous.updatedAt}}:{}),missing:options.missing??0,...(Number.isFinite(elapsed)&&elapsed>=0?{elapsedMs:elapsed}:{}),changes,highlighted:[...highlighted],
    reportChanged:JSON.stringify(current.report)!==JSON.stringify(previous?.report),summaryChanged:current.checkpoint?.summary!==previous?.checkpoint?.summary,ownerChanged:!!previous&&JSON.stringify(current.owner)!==JSON.stringify(previous.owner)};
}

/** These are simultaneous saved statuses, not measured overlapping runtimes. */
export function checkpointActors(task: TaskView) {
  const main=task.branches.filter(branch=>branch.executor==='main');
  const children=task.branches.filter(branch=>branch.executor==='subagent');
  return {
    main:{running:main.filter(b=>b.status==='running').length,review:children.filter(b=>b.status==='awaiting_review').length,reviewed:children.filter(b=>b.status==='completed').length},
    subagent:{running:children.filter(b=>b.status==='running').length,returned:children.filter(b=>b.status==='awaiting_review').length,reviewed:children.filter(b=>b.status==='completed').length,pending:children.filter(b=>b.status==='pending').length},
  };
}
