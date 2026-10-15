import { CairnError, type Task, type Branch, type BranchInput } from './types.js';

export const branchLabels = { pending: '待排查', running: '执行中', awaiting_review: '待主 Agent 汇总', completed: '已完成', blocked: '受阻', cancelled: '已取消' };
export function branchRun(task: Task, branch: Branch) {
  return branch.executor === 'subagent' && branch.agentId ? task.agentRuns?.find(run => run.agentId === branch.agentId && run.epoch === branch.epoch && run.attempt === branch.attempt && run.host === task.owner.host) : undefined;
}
export function branchStatus(task: Task, branch: Branch): Branch['status'] {
  if (['completed', 'cancelled'].includes(branch.status)) return branch.status;
  if (task.status !== 'active' || branch.epoch !== task.owner.epoch) return 'blocked';
  return branch.status === 'running' && branchRun(task, branch)?.status === 'returned' ? 'awaiting_review' : branch.status;
}
export function updateBranches(task: Task, inputs: BranchInput[], at: string): boolean {
  if (!Array.isArray(inputs)) throw new CairnError('invalid_branch', 'Branches must be an array');
  const next = structuredClone(task.branches ?? []), keys = new Set<string>();
  for (const input of inputs) {
    if (!input || typeof input.key !== 'string' || !input.key.trim() || typeof input.title !== 'string' || !input.title.trim() || !Object.hasOwn(branchLabels, input.status)) throw new CairnError('invalid_branch', 'A branch needs key, title and valid status');
    if (keys.has(input.key)) throw new CairnError('invalid_branch', `Duplicate branch ${input.key}`);
    keys.add(input.key);
    for (const name of ['question', 'rationale', 'assignee', 'summary'] as const) if (input[name] !== undefined && typeof input[name] !== 'string') throw new CairnError('invalid_branch', `Invalid branch ${name}`);
    for (const name of ['parent', 'agentId'] as const) if (input[name] !== undefined && input[name] !== null && (typeof input[name] !== 'string' || !input[name]!.trim())) throw new CairnError('invalid_branch', `Invalid branch ${name}`);
    const index = next.findIndex(branch => branch.key === input.key), old = next[index];
    const executor = input.executor ?? old?.executor ?? 'main';
    if (!['main', 'subagent'].includes(executor)) throw new CairnError('invalid_branch', 'Invalid branch executor');
    const agentId = input.agentId === null ? undefined : input.agentId ?? old?.agentId;
    const restart = !old || old.epoch!==task.owner.epoch || old.executor!==executor || old.agentId!==agentId || input.status==='running'&&(old.status!=='running'||branchStatus(task,old)==='awaiting_review');
    const value: Branch = { ...old, ...input, executor, parent: input.parent === null ? undefined : input.parent ?? old?.parent, agentId, epoch: task.owner.epoch, attempt:(old?.attempt??0)+(restart?1:0), updatedAt: old?.updatedAt ?? at };
    if (executor === 'main') {
      if (input.agentId) throw new CairnError('invalid_branch', 'A main-agent branch cannot bind a child agent');
      delete value.agentId;
    }
    if (['completed', 'cancelled'].includes(value.status) && !value.summary?.trim()) throw new CairnError('invalid_branch', 'A completed/cancelled branch needs a summary of its result or stopping reason');
    if (value.status === 'completed' && branchRun(task, value)?.status === 'running') throw new CairnError('active_delegate', 'The host still reports this child running; wait or stop it before accepting completion');
    if (JSON.stringify(value) === JSON.stringify(old)) continue;
    value.updatedAt = at;
    if (index < 0) next.push(value); else next[index] = value;
  }
  const map = new Map(next.map(branch => [branch.key, branch]));
  const activeIds = new Set<string>();
  for (const branch of next) {
    const seen = new Set([branch.key]); let parent = branch.parent;
    while (parent) {
      if (!map.has(parent) || seen.has(parent)) throw new CairnError('invalid_branch', 'Branch parents must exist in this task and form an acyclic tree');
      seen.add(parent); parent = map.get(parent)!.parent;
    }
    if (branch.agentId && !['completed', 'cancelled'].includes(branch.status) && branch.epoch === task.owner.epoch) {
      if (activeIds.has(branch.agentId)) throw new CairnError('invalid_branch', 'An active child agent can own only one branch; use child branches or distinct agents');
      activeIds.add(branch.agentId);
    }
  }
  const changed = JSON.stringify(next) !== JSON.stringify(task.branches ?? []);
  if (changed) task.branches = next;
  return changed;
}

export function pauseBranches(task: Task, at: string, summary: string) {
  for (const branch of task.branches ?? []) if (branch.status === 'running') {
    branch.status = 'blocked'; branch.summary = summary; branch.updatedAt = at;
  }
}
