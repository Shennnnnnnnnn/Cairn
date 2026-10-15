import type { Engine } from '../core/engine.js';
import type { Task, Observation, Check, Branch } from '../core/types.js';
import { branchStatus, branchRun, branchLabels } from '../core/branches.js';
import type { CheckpointDelta } from './replay.js';

export type ObservationIndex = Omit<Observation, 'input' | 'output'> & { ref: string };
export type WorkItem = {
  key: string; title: string; status: 'pending' | 'running' | 'completed' | 'blocked' | 'cancelled';
  detail?: string; branch?: string; source: 'agent' | 'host' | 'criterion' | 'action'; updatedAt: string; statusLabel: string;
};
export type BranchView = Branch & { recordedStatus: Branch['status']; statusLabel: string; executorLabel: string; activitySource: 'host' | 'agent'; activityStatus: 'running' | 'returned' | 'unknown' };
export type TaskView = Omit<Task, 'observations' | 'progress' | 'branches'> & {
  branches: BranchView[]; branchCounts: { total: number; running: number; review: number; completed: number; waiting: number; delegated: number };
  observations: ObservationIndex[]; check: Check; reportCheck?: Check;
  progress: { satisfied: number; total: number };
  workItems: WorkItem[]; workGroups: { running: WorkItem[]; completed: WorkItem[]; waiting: WorkItem[] };
  workCounts: { running: number; completed: number; waiting: number; blocked: number; questions: number };
  progressSource: 'agent' | 'historical' | 'none'; updatedAt: string;
  phase: { key: string; label: string };
  metrics: { observations: number; supported: number; refuted: number; inFlight: number; calls: number };
};
export type TaskSummary = Pick<TaskView, 'id' | 'goal' | 'status' | 'createdAt' | 'owner' | 'revision' | 'phase' | 'progress' | 'metrics' | 'budget' | 'workCounts' | 'branchCounts' | 'updatedAt' | 'progressSource' | 'evidenceMode'>;
const stageLabels = { pending: '待推进', running: '执行中', completed: '已完成', blocked: '受阻', cancelled: '已取消' };
const stageDetails:Record<string,string> = {
  'Paused with this task':'随任务暂停，等待恢复。',
  'Removed from the current plan':'已从当前计划移除。',
  'Previous session stopped; resume this step explicitly if still needed':'已由新会话接管；需要继续时重新开始此阶段。',
};
function projectWork(task: Task, updatedAt: string): { items: WorkItem[]; source: TaskView['progressSource'] } {
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
  return { source, items: items.map(item => task.status !== 'active' && item.status === 'running'
    ? { ...item, status: task.status === 'suspended' ? 'blocked' : 'pending', statusLabel: task.status === 'suspended' ? '已暂停 · 等待恢复' : '阶段未单独确认' }
    : item) };
}
export function projectTask(engine: Engine, task: Task, historicalAt?: string): TaskView {
  const check = engine.evaluate(task), reportCheck = task.report ? engine.evaluateReport(task, task.report) : undefined;
  const progress = { satisfied: task.criteria.length - check.unmet.length, total: task.criteria.length };
  const latest = historicalAt ? undefined : engine.store.db.prepare('SELECT at FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(task.id);
  const updatedAt = historicalAt ?? latest?.at as string ?? task.checkpoint?.at ?? task.createdAt;
  const work = projectWork(task, updatedAt);
  const branches: BranchView[] = (task.branches ?? []).map(branch => {
    const status = branchStatus(task, branch), run = branchRun(task, branch);
    return { ...branch, status, recordedStatus: branch.status, statusLabel: branchLabels[status], executorLabel: branch.executor === 'main' ? '主 Agent' : branch.assignee || '子 Agent', activitySource: run ? 'host' : 'agent', activityStatus: run?.status ?? 'unknown' };
  });
  const branchCounts = { total: branches.length, running: branches.filter(b=>['running','reviewing'].includes(b.status)).length, review: branches.filter(b=>['awaiting_review','reviewing'].includes(b.status)).length, completed: branches.filter(b=>b.status==='completed').length, waiting: branches.filter(b=>['pending','blocked'].includes(b.status)).length, delegated: branches.filter(b=>b.executor==='subagent'&&b.status!=='cancelled').length };
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
  const nativeRunning=(task.agentRuns??[]).some(run=>run.epoch===task.owner.epoch&&run.host===task.owner.host&&run.status==='running');
  let phase = { key: 'investigating', label: nativeRunning?'宿主记录执行中':workCounts.running || branchCounts.running ? 'Agent 报告执行中' : branchCounts.review ? '分支待汇总' : '目标推进中' };
  if (task.status === 'completed') phase = { key: 'completed', label: '已完成' };
  else if (task.status === 'suspended') phase = { key: 'suspended', label: '已暂停' };
  else if (task.budget.deadline && Date.parse(task.budget.deadline) <= (historicalAt ? Date.parse(historicalAt) : engine.now().getTime())) phase = { key: 'expired', label: '提醒时间已到' };
  else if (task.report && check.ok) phase = { key: 'reporting', label: reportCheck?.ok ? '报告待完成' : '报告待补齐' };
  else if (check.ok) phase = { key: 'verifying', label: '条件已满足' };
  else if (!task.observations.length && !metrics.calls && !task.checkpoint && !branches.length && !work.items.some(i => i.source !== 'criterion')) phase = { key: 'starting', label: '目标已建立' };
  const { observations, progress: _stages, ...rest } = task;
  return {
    ...rest, branches, branchCounts, calls: captured ? rest.calls : {}, actions: captured ? rest.actions : [], check, reportCheck, phase, progress, workItems: work.items, workGroups, workCounts, progressSource: work.source, updatedAt, metrics,
    observations: captured ? observations.map(({ input, output, ...index }, i) => ({ ...index, ref: `E${i + 1}` })) : [],
  };
}
export function summaries(engine: Engine): TaskSummary[] {
  return engine.store.list().map(item => {
    const { id, goal, status, createdAt, owner, revision, phase, progress, metrics, budget, workCounts, branchCounts, updatedAt, progressSource, evidenceMode } = projectTask(engine, engine.store.get(item.id));
    return { id, goal, status, createdAt, owner, revision, phase, progress, metrics, budget, workCounts, branchCounts, updatedAt, progressSource, evidenceMode };
  });
}

export type TimelineEvent = { seq: number; kind: string; at: string; subject: string; observationId?: string; title: string; category: 'milestone' | 'evidence' | 'advanced'; status?: string; summary: string; detail?: string };
export interface ReplayPage { frames: TimelineEvent[]; total: number; missing: number; head: number; next: number | null }
export interface ReplayState { task: TaskView; events: TimelineEvent[]; seq: number; checkpoint?: CheckpointDelta }
const titles: Record<string, string> = {
  'task.created': '开始目标', 'task.resumed': '接管并恢复', 'task.suspended': '暂停任务', 'task.completed': '已完成', 'task.checkpoint': '保存阶段进展',
  'tool.started': '开始历史工具调用', 'observation.captured': '保存原始观测', 'claim.revised': '更新结论', 'criterion.updated': '更新目标条件', 'action.updated': '更新行动进展',
  'hint.added': '补充人工提示', 'report.saved': '保存报告', 'continuation.suggested': '提醒未完成事项',
  'agent.started': '助手开始执行', 'agent.returned': '助手执行结束，待汇总',
  'branch.updated': '分支状态变化', 'progress.updated': '执行状态变化', 'finding.updated': '结论变化',
};
/** Timeline projections allow only authored summaries and lifecycle metadata, never raw tool results. */
export function projectEvent(row: { seq: number; kind: string; at: string; payload: any }): TimelineEvent {
  const payload = row.payload ?? {}, input = payload.input ?? payload;
  const value = (v: unknown) => typeof v === 'string' ? v : '';
  let title = titles[row.kind] ?? '更新任务记录', status = '', detail = '', summary = '';
  const advanced = ['tool.started', 'observation.captured', 'claim.revised', 'criterion.updated', 'action.updated', 'report.saved'].includes(row.kind);
  if (row.kind === 'task.finished' || row.kind === 'task.checked') {
    status = value(payload.phase);
    title = ({ completed: '已完成', suspended: '暂停任务', incomplete: '完成检查未通过' } as Record<string, string>)[status] ?? '完成检查';
    summary = value(input.summary);
    detail = Array.isArray(payload.validation?.issues) ? payload.validation.issues.filter((s: unknown) => typeof s === 'string').join('\n') : '';
  } else if (row.kind === 'task.resumed') { summary = payload.takeover ? '新会话接管目标，继续已有结论与未解决问题。' : '继续当前会话保存的目标与进展。'; }
  else if(row.kind==='task.suspended'&&input.source==='host'){summary='宿主会话结束或被中断，已自动保存未完成工作，等待显式恢复。';}
  else if (row.kind === 'tool.started' || row.kind === 'observation.captured') { summary = value(input.tool ?? payload.tool); status = value(payload.status); }
  else if (row.kind === 'agent.started' || row.kind === 'agent.returned') { summary = `${value(payload.type) || '子 Agent'} · ${value(payload.agentId)}`; }
  else if (['branch.updated','progress.updated','finding.updated'].includes(row.kind)) {
    const change=input.branch??input.progress??input.finding;
    if(change){
      status=value(change.status);summary=value(change.title??change.text??change.key);
      title=input.branch?`分支 · ${branchLabels[status as keyof typeof branchLabels]??status}`:input.finding?'更新结论与依据':'更新执行状态';
      detail=value(change.summary??change.detail??change.basis);
    }
  }
  else summary = value(input.summary ?? input.text ?? input.goal ?? payload.result?.text ?? payload.summary);
  if (row.kind === 'task.checkpoint' || row.kind === 'task.finished' || row.kind === 'task.checked') {
    const lines = [Array.isArray(input.questions) && input.questions.length ? `未解决问题\n${input.questions.filter((s: unknown) => typeof s === 'string').join('\n')}` : '', value(input.next) ? `下一步\n${input.next}` : '', detail].filter(Boolean);
    if (Array.isArray(input.branches)) for (const branch of input.branches) lines.push(`${value(branch.title)} · ${branchLabels[branch.status as keyof typeof branchLabels] ?? value(branch.status)}${branch.summary ? `\n${value(branch.summary)}` : ''}`);
    detail = lines.join('\n\n');
  }
  return { seq: row.seq, kind: row.kind, at: row.at, title, category: advanced ? 'advanced' : 'milestone', ...(status ? { status } : {}), summary, ...(detail ? { detail } : {}), subject: summary,
    ...(row.kind === 'observation.captured' && typeof payload.id === 'string' ? { observationId: payload.id } : {}) };
}
