import type { Engine } from '../core/engine.js';
import type { Task, Observation, Check } from '../core/types.js';

export type ObservationIndex = Omit<Observation, 'input' | 'output' | 'receipt'> & {ref:string};
export type TaskView = Omit<Task, 'observations' | 'delivery'> & {
  observations: ObservationIndex[];
  delivered: boolean;
  check: Check;
  reportCheck?: Check;
  progress: { satisfied: number; total: number };
  phase: { key: string; label: string };
  metrics: { observations: number; supported: number; refuted: number; inFlight: number; calls: number };
};
export type TaskSummary = Pick<TaskView, 'id' | 'goal' | 'status' | 'createdAt' | 'owner' | 'revision' | 'phase' | 'progress' | 'metrics' | 'budget'>;
export function projectTask(engine: Engine, task: Task): TaskView {
  const check = engine.evaluate(task);
  const reportCheck = task.report ? engine.evaluateReport(task, task.report) : undefined;
  const progress = { satisfied: task.criteria.length - check.unmet.length, total: task.criteria.length };
  const metrics = {
    observations: task.observations.length,
    supported: task.claims.filter(c => c.status === 'supported').length,
    refuted: task.claims.filter(c => c.status === 'refuted').length,
    inFlight: Object.values(task.calls).filter(c => c.status === 'running').length,
    calls: Object.keys(task.calls).length,
  };
  let phase = { key: 'investigating', label: '调查中' };
  if (task.status === 'completed') phase = { key: 'completed', label: '已完成' };
  else if (task.status === 'suspended') phase = { key: 'suspended', label: '已暂停' };
  else if (task.budget.deadline && Date.parse(task.budget.deadline) <= engine.now().getTime()) phase = { key: 'expired', label: '预算已到期' };
  else if (task.delivery && !task.confirmedAt && task.profile === 'emergency') phase = { key: 'confirmation', label: '待队伍确认' };
  else if (task.report && check.ok) phase = { key: 'reporting', label: reportCheck?.ok ? task.profile==='emergency'?'待提交报告':'报告待完成' : '报告待补齐' };
  else if (check.ok) phase = { key: 'verifying', label: '条件已满足' };
  else if (!task.observations.length && !metrics.calls) phase = { key: 'starting', label: '起步' };
  const { observations, delivery, ...rest } = task;
  return {
    ...rest, check, reportCheck, phase, progress, metrics, delivered: !!delivery,
    // Raw tool results and receipts are fetched only when an observation is selected.
    observations: observations.map(({ input, output, receipt, ...index },i) => ({...index,ref:`E${i+1}`})),
  };
}
export function summaries(engine: Engine): TaskSummary[] {
  return engine.store.list().map(item => {
    const { id, goal, status, createdAt, owner, revision, phase, progress, metrics, budget } = projectTask(engine, engine.store.get(item.id));
    return { id, goal, status, createdAt, owner, revision, phase, progress, metrics, budget };
  });
}
