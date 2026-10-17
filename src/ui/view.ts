import type { Engine } from '../core/engine.js';
import { publicTask, type Task, type Observation, type Check, type ProgressItem } from '../core/types.js';
import { artifactIssues } from '../core/artifacts.js';

export type ObservationIndex = Omit<Observation, 'input' | 'output' | 'receipt'> & { ref: string };
export type WorkItem = Omit<ProgressItem,'source'> & {
  key: string; title: string; status: 'pending' | 'running' | 'completed' | 'blocked' | 'cancelled';
  detail?: string; source: 'agent' | 'host' | 'criterion' | 'action'; updatedAt: string; statusLabel: string;
};
export type TaskView = Omit<Task, 'observations' | 'delivery' | 'progress'> & {
  observations: ObservationIndex[]; delivered: boolean; check: Check; reportCheck?: Check;
  progress: { satisfied: number; total: number };
  workItems: WorkItem[]; workGroups: { running: WorkItem[]; completed: WorkItem[]; waiting: WorkItem[] };
  workCounts: { running: number; completed: number; waiting: number; blocked: number; questions: number };
  progressSource: 'agent' | 'historical' | 'none'; updatedAt: string;
  phase: { key: string; label: string };
  metrics: { observations: number; supported: number; refuted: number; inFlight: number; calls: number };
  assurance:{artifacts:string;acceptance:string;conclusion:string;conclusionState:'unreviewed'|'stale'|'passed'|'failed'|'inconclusive';assessment?:{summary:string;scope:string;reviewer:string;at:string}};
};
export type TaskSummary = Pick<TaskView, 'id' | 'title' | 'goal' | 'status' | 'createdAt' | 'owner' | 'revision' | 'phase' | 'progress' | 'metrics' | 'budget' | 'workCounts' | 'updatedAt' | 'progressSource' | 'evidenceMode'|'assurance'>;
const stageLabels = { pending: '待推进', running: '执行中', completed: '已完成', blocked: '受阻', cancelled: '已取消' };
const stageDetails:Record<string,string> = {
  'Paused with this task':'随任务暂停，等待恢复。',
  'Removed from the current plan':'已从当前计划移除。',
  'Previous session stopped; resume this step explicitly if still needed':'已由新会话接管；需要继续时重新开始此阶段。',
};
export function projectWork(task: Task, updatedAt: string, now=Date.now()): { items: WorkItem[]; source: TaskView['progressSource'] } {
  const stages = task.progress;
  let items: WorkItem[], source: TaskView['progressSource'];
  if (stages?.length) {
    source = 'agent'; items = stages.map(item => ({ ...item, ...(item.detail?{detail:stageDetails[item.detail]??item.detail}:{}), statusLabel: stageLabels[item.status] }));
  } else if ((task.evidenceMode ?? 'captured') === 'captured') {
    source = task.actions.length || task.criteria.length ? 'historical' : 'none';
    items = [
      ...task.actions.map(a => ({ key: `action:${a.id}`, title: a.purpose, status: a.status === 'planned' ? 'pending' as const : a.status === 'failed' ? 'blocked' as const : a.status,
        detail: a.stopCondition, source: 'action' as const, updatedAt, statusLabel: stageLabels[a.status === 'planned' ? 'pending' : a.status === 'failed' ? 'blocked' : a.status] })),
      ...task.criteria.map(c => ({ key: `criterion:${c.id}`, title: c.text, status: c.claimIds.length ? 'completed' as const : 'pending' as const,
        source: 'criterion' as const, updatedAt, statusLabel: c.claimIds.length ? '条件已满足' : '条件待满足' })),
    ];
  } else { items = []; source = 'none'; }
  // A saved running state is not evidence that an agent process is alive. Stopped tasks
  // retain unfinished work without presenting it as currently executing.
  return { source, items: items.map(item => item.lease&&(item.lease.epoch!==task.owner.epoch||Date.parse(item.lease.expiresAt)<=now)
    ? {...item,status:'blocked',statusLabel:'租约已过期 · 可重新认领'}
    : item.branchStatus==='submitted'?{...item,statusLabel:'待主会话审核'}:task.status !== 'active' && item.status === 'running'
    ? { ...item, status: task.status === 'suspended' ? 'blocked' : 'pending', statusLabel: task.status === 'suspended' ? '已暂停 · 等待恢复' : '阶段未单独确认' }
    : item) };
}
export function projectTask(engine: Engine, task: Task): TaskView {
  task=publicTask(task);
  const check = engine.evaluate(task), reportCheck = task.report ? engine.completionCheck(task) : undefined;
  const progress = { satisfied: task.criteria.length - check.unmet.length, total: task.criteria.length };
  const latest = engine.store.db.prepare('SELECT at FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(task.id);
  const updatedAt = latest?.at as string ?? task.checkpoint?.at ?? task.createdAt;
  const work = projectWork(task, updatedAt,engine.now().getTime());
  // Historical criteria use current validated coverage, never the presence of a link alone.
  for (const item of work.items.filter(i => i.source === 'criterion')) {
    const met = !check.unmet.includes(item.key.slice('criterion:'.length));
    item.status = met ? 'completed' : 'pending'; item.statusLabel = met ? '条件已满足' : '条件待满足';
  }
  const workGroups = { running: work.items.filter(i => i.status === 'running'), completed: work.items.filter(i => i.status === 'completed'), waiting: work.items.filter(i => !['running', 'completed'].includes(i.status)) };
  const workCounts = { running: workGroups.running.length, completed: workGroups.completed.length, waiting: workGroups.waiting.length, blocked: work.items.filter(i => i.status === 'blocked').length, questions: task.checkpoint?.questions.length ?? 0 };
  const captured = (task.evidenceMode ?? 'captured') === 'captured';
  const metrics = {
    observations: captured ? task.observations.length : 0,
    supported: task.claims.filter(c => c.status === 'supported').length,
    refuted: task.claims.filter(c => c.status === 'refuted').length,
    inFlight: captured && task.status === 'active' ? Object.values(task.calls).filter(c => c.status === 'running').length : 0,
    calls: captured ? Object.keys(task.calls).length : 0,
  };
  let phase = { key: 'investigating', label: workCounts.running ? 'Agent 报告执行中' : '目标推进中' };
  if (task.status === 'completed') phase = reportCheck&&!reportCheck.ok?{key:'verifying',label:'历史完成，当前提交待复验'}:{ key: 'completed', label: '已完成' };
  else if (task.status === 'suspended') phase = { key: 'suspended', label: '已暂停' };
  else if (task.budget.deadline && Date.parse(task.budget.deadline) <= engine.now().getTime()) phase = { key: 'expired', label: task.profile === 'emergency' ? '比赛时间已到' : '提醒时间已到' };
  else if (task.delivery && !task.confirmedAt && task.profile === 'emergency') phase = { key: 'confirmation', label: '待队伍确认' };
  else if(task.completionVerifier&&reportCheck&&!reportCheck.ok)phase={key:'verifying',label:'外部验证待通过'};
  else if (task.report && check.ok) phase = { key: 'reporting', label: reportCheck?.ok ? task.profile === 'emergency' ? '待提交报告' : '报告待完成' : '报告待补齐' };
  else if (check.ok) phase = { key: 'verifying', label: '条件已满足' };
  else if (!task.observations.length && !metrics.calls && !task.checkpoint && !work.items.some(i => i.source !== 'criterion')) phase = { key: 'starting', label: '目标已建立' };
  const { observations, delivery, progress: _stages, ...rest } = task;
  const assessment=engine.assessmentStatus(task);
  const conclusionState:TaskView['assurance']['conclusionState']=assessment?(assessment.current?assessment.status:'stale'):'unreviewed';
  const assurance={artifacts:task.artifacts?.length?(artifactIssues(task).length?'提交物已变化／缺失':'提交物与快照一致'):'未登记文件提交物',
    acceptance:task.completionVerifier?(task.verification?(engine.verificationCurrent(task)?`${task.verification.method??'未声明方法'} · ${task.verification.status}`:'历史验收已过期'):'等待宿主验收'):'仅结构检查',
    conclusion:({unreviewed:'结论未评定',stale:'结论审查已过期',passed:'结论审查通过',failed:'结论审查未通过',inconclusive:'结论审查仍不确定'} as const)[conclusionState],
    conclusionState,...(assessment?{assessment:{summary:assessment.summary,scope:assessment.scope,reviewer:assessment.reviewer,at:assessment.at}}:{})};
  return {
    ...rest, calls: captured ? rest.calls : {}, actions: captured ? rest.actions : [], check, reportCheck, phase, progress, workItems: work.items, workGroups, workCounts, progressSource: work.source, updatedAt, metrics, assurance, delivered: !!delivery,
    observations: captured ? observations.map(({ input, output, receipt, ...index }, i) => ({ ...index, ref: `E${i + 1}` })) : [],
  };
}
export function summaries(engine: Engine): TaskSummary[] {
  return engine.store.list().map(item => {
    const { id, title, goal, status, createdAt, owner, revision, phase, progress, metrics, budget, workCounts, updatedAt, progressSource, evidenceMode,assurance } = projectTask(engine, engine.store.get(item.id));
    return { id, title, goal, status, createdAt, owner, revision, phase, progress, metrics, budget, workCounts, updatedAt, progressSource, evidenceMode,assurance };
  });
}

export type TimelineEvent = { seq: number; kind: string; at: string; subject: string; observationId?: string; title: string; category: 'milestone' | 'evidence' | 'advanced'; status?: string; summary: string; detail?: string };
const titles: Record<string, string> = {
  'task.created': '开始目标', 'task.resumed': '接管并恢复', 'task.suspended': '暂停任务', 'task.completed': '已完成', 'task.checkpoint': '保存阶段进展',
  'tool.started': '开始历史工具调用', 'observation.captured': '保存原始观测', 'claim.revised': '更新结论', 'criterion.updated': '更新目标条件', 'action.updated': '更新行动进展',
  'hint.added': '补充人工提示', 'report.saved': '保存报告', 'delivery.recorded': '收到交付回执', 'team.confirmed': '队伍确认', 'continuation.suggested': '提醒未完成事项',
  'task.verified':'外部完成验证','host.execution':'宿主执行状态','budget.conclude_requested':'预算收尾提醒','task.reopened':'外部反馈重开目标','branch.claim':'分支已认领','branch.heartbeat':'续租分支','branch.release':'释放分支','branch.checkpoint':'提交分支发现','branch.merge':'主会话审核分支','conclude.requested':'请求保存探索结果',
  'exploration.review_requested':'回看黑板并选择方向','outcome.assessed':'独立结论审查',
};
/** Timeline projections allow only authored summaries and lifecycle metadata, never raw tool results. */
export function projectEvent(row: { seq: number; kind: string; at: string; payload: any }): TimelineEvent {
  const payload = row.payload ?? {}, input = payload.input ?? payload;
  const value = (v: unknown) => typeof v === 'string' ? v : '';
  let title = titles[row.kind] ?? '更新任务记录', status = '', detail = '', summary = '';
  const advanced = ['tool.started', 'observation.captured', 'claim.revised', 'criterion.updated', 'action.updated', 'report.saved','branch.heartbeat'].includes(row.kind);
  if (row.kind === 'task.finished' || row.kind === 'task.checked') {
    status = value(payload.phase);
    title = ({ completed: '已完成', suspended: '暂停任务', incomplete: '完成检查未通过', ready_for_delivery: '报告已就绪，待交付', awaiting_confirmation: '等待队伍确认' } as Record<string, string>)[status] ?? '完成检查';
    summary = value(input.summary);
    detail = Array.isArray(payload.validation?.issues) ? payload.validation.issues.filter((s: unknown) => typeof s === 'string').join('\n') : '';
  } else if(row.kind==='task.verified'){status=value(payload.verification?.status);summary=`外部验证：${status}`;detail=(payload.verification?.issues??[]).map((issue:any)=>value(issue.message)).join('\n');}
  else if(row.kind==='outcome.assessed'){status=value(payload.assessment?.status);summary=value(payload.assessment?.summary);detail=`${value(payload.assessment?.reviewer)} · ${value(payload.assessment?.scope)}`;}
  else if(row.kind==='host.execution'){summary=`宿主状态：${value(payload.state)}（与任务完成状态独立）`;}
  else if(row.kind==='budget.conclude_requested'){summary=`收尾提醒：${value(payload.stage)}`;}
  else if (row.kind === 'task.resumed') { summary = payload.takeover ? '新会话接管目标，继续已有结论与未解决问题。' : '继续当前会话保存的目标与进展。'; }
  else if (row.kind === 'tool.started' || row.kind === 'observation.captured') { summary = value(input.tool ?? payload.tool); status = value(payload.status); }
  else summary = value(input.summary ?? input.text ?? input.goal ?? input.reason ?? input.key ?? payload.result?.text ?? payload.summary);
  if (row.kind === 'task.checkpoint' || row.kind === 'task.finished' || row.kind === 'task.checked') {
    const lines = [Array.isArray(input.questions) && input.questions.length ? `未解决问题\n${input.questions.filter((s: unknown) => typeof s === 'string').join('\n')}` : '', value(input.next) ? `下一步\n${input.next}` : '', detail].filter(Boolean);
    detail = lines.join('\n\n');
  }
  return { seq: row.seq, kind: row.kind, at: row.at, title, category: advanced ? 'advanced' : 'milestone', ...(status ? { status } : {}), summary, ...(detail ? { detail } : {}), subject: summary,
    ...(row.kind === 'observation.captured' && typeof payload.id === 'string' ? { observationId: payload.id } : {}) };
}
