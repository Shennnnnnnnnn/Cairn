import type { Engine } from '../core/engine.js';
import type { Task, Observation, Check, Branch, ProgressItem } from '../core/types.js';
import { branchStatus, branchRun, branchLabels } from '../core/branches.js';
import { projectUsage, type ResourceUsage } from './usage.js';
import type { CheckpointDelta } from './replay.js';

import { publicTask } from '../core/types.js';
import { artifactIssues } from '../core/artifacts.js';

export type ObservationIndex = Omit<Observation, 'input' | 'output' | 'receipt'> & { ref: string };
export type WorkItem = Omit<ProgressItem,'source'> & {
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
  resourceUsage: ResourceUsage;
  metrics: { observations: number; supported: number; refuted: number; inFlight: number; calls: number };
  assurance:{artifacts:string;acceptance:string;conclusion:string;conclusionState:'unreviewed'|'stale'|'passed'|'failed'|'inconclusive';assessment?:{summary:string;scope:string;reviewer:string;at:string}};
};
export type TaskSummary = Pick<TaskView, 'id' | 'title' | 'assurance' | 'goal' | 'status' | 'createdAt' | 'owner' | 'revision' | 'phase' | 'progress' | 'metrics' | 'budget' | 'workCounts' | 'branchCounts' | 'updatedAt' | 'progressSource' | 'evidenceMode' | 'resourceUsage'>;
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
export function projectBranches(task:Task):BranchView[]{
  return (task.branches ?? []).map(branch => {
    const status = branchStatus(task, branch), run = branchRun(task, branch);
    return { ...branch, status, recordedStatus: branch.status, statusLabel: branchLabels[status], executorLabel: branch.executor === 'main' ? '主 Agent' : branch.assignee || '子 Agent', activitySource: run ? 'host' : 'agent', activityStatus: run?.status ?? 'unknown' };
  });
}
export function projectTask(engine: Engine, task: Task, historicalAt?: string): TaskView {
  task=publicTask(task);
  const check = engine.evaluate(task), reportCheck = task.report ? engine.completionCheck(task) : undefined;
  const progress = { satisfied: task.criteria.length - check.unmet.length, total: task.criteria.length };
  const latest = historicalAt ? undefined : engine.store.db.prepare('SELECT at FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 1').get(task.id);
  const updatedAt = historicalAt ?? latest?.at as string ?? task.checkpoint?.at ?? task.createdAt;
  const work = projectWork(task, updatedAt,historicalAt?Date.parse(historicalAt):engine.now().getTime());
  const branches=projectBranches(task);
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
  if (task.status === 'completed'&&reportCheck&&!reportCheck.ok) phase={key:'verifying',label:'历史完成，当前提交待复验'};
  else if (task.status === 'completed') phase = { key: 'completed', label: task.review&&task.review.generation>task.review.acknowledged?'已完成 · 新反馈待复核':'已完成' };
  else if (task.status === 'suspended') phase = { key: 'suspended', label: '已暂停' };
  else if (task.budget.deadline && Date.parse(task.budget.deadline) <= (historicalAt ? Date.parse(historicalAt) : engine.now().getTime())) phase = { key: 'expired', label: '提醒时间已到' };
  else if (task.report && check.ok) phase = { key: 'reporting', label: reportCheck?.ok ? '报告待完成' : '报告待补齐' };
  else if (check.ok) phase = { key: 'verifying', label: '条件已满足' };
  else if (!task.observations.length && !metrics.calls && !task.checkpoint && !branches.length && !work.items.some(i => i.source !== 'criterion')) phase = { key: 'starting', label: '目标已建立' };
  const stopped=!task.timing&&task.status!=='active'?engine.store.db.prepare(`SELECT at FROM events WHERE task_id=? AND at<=?
    AND (kind IN ('task.suspended','task.completed') OR (kind='task.finished' AND json_extract(payload,'$.phase') IN ('completed','suspended'))) ORDER BY seq DESC LIMIT 1`).get(task.id,historicalAt??engine.at()):undefined;
  const timeEnd=stopped?.at as string??updatedAt;
  const { observations, progress: _stages, ...rest } = task;
  const assessment=engine.assessmentStatus(task);
  const conclusionState:TaskView['assurance']['conclusionState']=assessment?(assessment.current?assessment.status:'stale'):'unreviewed';
  const assurance={artifacts:task.artifacts?.length?(artifactIssues(task).length?'提交物已变化／缺失':'提交物与快照一致'):'未登记文件提交物',
    acceptance:task.completionVerifier?(task.verification?(engine.verificationCurrent(task)?`${task.verification.method??'未声明方法'} · ${task.verification.status}`:'历史验收已过期'):'等待宿主验收'):'仅结构检查',
    conclusion:({unreviewed:'结论未评定',stale:'结论审查已过期',passed:'结论审查通过',failed:'结论审查未通过',inconclusive:'结论审查仍不确定'} as const)[conclusionState],
    conclusionState,...(assessment?{assessment:{summary:assessment.summary,scope:assessment.scope,reviewer:assessment.reviewer,at:assessment.at}}:{})};
  return {
    ...rest, resourceUsage:projectUsage(task,historicalAt?Date.parse(historicalAt):engine.now().getTime(),timeEnd), branches, branchCounts, calls: captured ? rest.calls : {}, actions: captured ? rest.actions : [], check, reportCheck, phase, progress, workItems: work.items, workGroups, workCounts, progressSource: work.source, updatedAt, metrics, assurance,
    observations: captured ? observations.map(({ input, output, ...index }, i) => ({ ...index, ref: `E${i + 1}` })) : [],
  };
}
export function summaries(engine: Engine): TaskSummary[] {
  return engine.store.list().map(item => {
    const { id, title, assurance, goal, status, createdAt, owner, revision, phase, progress, metrics, budget, workCounts, branchCounts, updatedAt, progressSource, evidenceMode, resourceUsage } = projectTask(engine, engine.store.get(item.id));
    return { id, title, assurance, goal, status, createdAt, owner, revision, phase, progress, metrics, budget, workCounts, branchCounts, updatedAt, progressSource, evidenceMode, resourceUsage };
  });
}

export type TimelineEvent = { seq: number; kind: string; at: string; subject: string; observationId?: string; title: string; category: 'milestone' | 'evidence' | 'advanced'; status?: string; summary: string; detail?: string };
export interface ReplayPage { frames: TimelineEvent[]; total: number; missing: number; head: number; next: number | null }
export interface ReplayState { task: TaskView; events: TimelineEvent[]; seq: number; checkpoint?: CheckpointDelta }
const titles: Record<string, string> = {
  'task.created': '开始目标', 'task.resumed': '接管并恢复', 'task.suspended': '暂停任务', 'task.completed': '已完成', 'task.checkpoint': '保存阶段进展',
  'tool.started': '开始历史工具调用', 'observation.captured': '保存原始观测', 'claim.revised': '更新结论', 'criterion.updated': '更新目标条件', 'action.updated': '更新行动进展',
  'usage.updated':'更新用量统计',
  'task.reopened':'任务重开', 'task.reviewed':'复核新证据与反馈',
  'hint.added': '补充人工提示', 'report.saved': '保存报告', 'continuation.suggested': '提醒未完成事项',
  'agent.started': '助手开始执行', 'agent.returned': '助手执行结束，待汇总',
  'branch.updated': '分支状态变化', 'progress.updated': '执行状态变化', 'finding.updated': '结论变化',
  'task.verified':'外部完成验证','host.execution':'宿主执行状态','budget.conclude_requested':'预算收尾提醒','branch.claim':'分支已认领','branch.heartbeat':'续租分支','branch.release':'释放分支','branch.checkpoint':'提交分支发现','branch.merge':'主会话审核分支','conclude.requested':'请求保存探索结果',
  'exploration.review_requested':'回看黑板并选择方向','outcome.assessed':'独立结论审查',
  'scheduler.claimed':'启动自动探索','scheduler.dispatched':'派发宿主阶段','scheduler.reasoned':'完成黑板审阅','scheduler.phase_failed':'宿主阶段失败','scheduler.explore_failed':'探索分支受阻','scheduler.completion_rejected':'完成验收未通过','scheduler.stale_reason':'黑板变化，重新审阅','scheduler.released':'自动探索已停止','scheduler.stopping':'保存探索缺口',
};
/** Timeline projections allow only authored summaries and lifecycle metadata, never raw tool results. */
export function projectEvent(row: { seq: number; kind: string; at: string; payload: any }): TimelineEvent {
  const payload = row.payload ?? {}, input = payload.input ?? payload;
  const value = (v: unknown) => typeof v === 'string' ? v : '';
  let title = titles[row.kind] ?? '更新任务记录', status = '', detail = '', summary = '';
  const advanced = ['usage.updated','tool.started', 'observation.captured', 'claim.revised', 'criterion.updated', 'action.updated', 'report.saved','branch.heartbeat','scheduler.heartbeat','scheduler.session','scheduler.result_saved','scheduler.settled'].includes(row.kind);
  if (row.kind === 'task.finished' || row.kind === 'task.checked') {
    status = value(payload.phase);
    title = ({ completed: '已完成', suspended: '暂停任务', incomplete: '完成检查未通过' } as Record<string, string>)[status] ?? '完成检查';
    summary = value(input.summary);
    detail = Array.isArray(payload.validation?.issues) ? payload.validation.issues.filter((s: unknown) => typeof s === 'string').join('\n') : '';
  } else if(row.kind==='task.verified'){status=value(payload.verification?.status);summary=`外部验证：${status}`;detail=(payload.verification?.issues??[]).map((issue:any)=>value(issue.message)).join('\n');}
  else if(row.kind==='outcome.assessed'){status=value(payload.assessment?.status);summary=value(payload.assessment?.summary);detail=`${value(payload.assessment?.reviewer)} · ${value(payload.assessment?.scope)}`;}
  else if(row.kind==='host.execution'){summary=`宿主状态：${value(payload.state)}（与任务完成状态独立）`;}
  else if(row.kind==='budget.conclude_requested'){summary=`收尾提醒：${value(payload.stage)}`;}
  else if(row.kind==='scheduler.policy_selected'){
    title='选择会话策略';status=value(payload.sessionMode);
    summary=payload.sessionMode==='single'?'单会话 · 按顺序探索':'多会话 · 按需独立 Explore';
    detail=`${value(payload.coordinatorMode)} · 最大探索并发 ${Number(payload.maxParallel??1)}`;
  }
  else if(row.kind==='scheduler.start_selected'){
    title='选择启动方式';status=value(payload.selected);
    summary=`${value(payload.requested)} → ${value(payload.selected)}`;detail=value(payload.reason);
  }
  else if(row.kind.startsWith('scheduler.')){
    status=value(payload.status);
    summary=[value(payload.phase),value(payload.branch?.title??payload.branch),value(payload.error??payload.reason)].filter(Boolean).join(' · ')||value(payload.status)||'保存调度状态';
    const usage=payload.metrics?.usage;
    detail=[value(payload.sessionMode)?`会话策略：${value(payload.sessionMode)}`:'',value(payload.sessionRef),usage?`记录 tokens：输入 ${Number(usage.input_tokens??0)}，输出 ${Number(usage.output_tokens??0)}`:'',typeof payload.metrics?.wallSeconds==='number'?`宿主耗时：${payload.metrics.wallSeconds.toFixed(1)} 秒`:''].filter(Boolean).join('\n');
  }
  else if (row.kind === 'usage.updated') { summary='已同步宿主的数值统计，不包含工具参数、结果或对话。'; }
  else if (row.kind === 'task.resumed') { summary = payload.takeover ? '新会话接管目标，继续已有结论与未解决问题。' : '继续当前会话保存的目标与进展。'; }
  else if(row.kind==='task.reopened'){summary=value(payload.reason);detail='保留原完成记录，更新执行代次后继续探索。';}
  else if(row.kind==='task.reviewed'){summary=value(payload.summary);detail=`已复核快照 ${payload.snapshot}，后续新信息仍需另行复核。`;}
  else if(row.kind==='hint.added'){summary=value(input.text);detail=`提供者：${value(input.author)} · 人工反馈，不自动作为事实或重开任务。`;}
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
