import { CairnError, type Task, type ProgressItem } from './types.js';

export const workRef = (item: Pick<ProgressItem, 'source' | 'key'>) => `work:${item.source}:${item.key}`;

/** Persist canonical identities, never mutable labels or an ambiguous shorthand. */
export function normalizeCausality(task: Task) {
  const nodes = new Map<string, { from?: string[] }>();
  const aliases = new Map<string, Set<string>>();
  const alias = (key: string, ref: string) => {
    const values = aliases.get(key) ?? new Set<string>(); values.add(ref); aliases.set(key, values);
  };
  for (const claim of task.claims) {
    const ref = `claim:${claim.id}`; nodes.set(ref, claim); alias(ref, ref); alias(claim.id, ref);
    if (claim.key) alias(claim.key, ref);
  }
  for (const item of task.progress ?? []) {
    const ref = workRef(item); nodes.set(ref, item); alias(ref, ref); alias(item.key, ref); alias(`work:${item.key}`, ref);
  }
  for (const [ref, node] of nodes) {
    if (node.from === undefined) continue;
    if (!Array.isArray(node.from) || node.from.some(value => typeof value !== 'string' || !value.trim()))
      throw new CairnError('invalid_dependency', 'from must contain nonempty dependency references');
    node.from = [...new Set(node.from.map(value => {
      // A fully qualified reference always wins over readable aliases.
      if (nodes.has(value)) return value;
      const matches = aliases.get(value);
      if (!matches?.size) throw new CairnError('invalid_dependency', `Unknown dependency ${value} for ${ref}`);
      if (matches.size !== 1) throw new CairnError('ambiguous_dependency', `Dependency ${value} is ambiguous; use claim:ID or work:agent:KEY / work:host:KEY`);
      return [...matches][0]!;
    }))];
  }
  // Kahn's algorithm also handles long exploration chains without recursion.
  const indegree = new Map([...nodes].map(([ref, node]) => [ref, node.from?.length ?? 0]));
  const children = new Map<string, string[]>();
  for (const [ref, node] of nodes) for (const parent of node.from ?? []) {
    const values = children.get(parent) ?? []; values.push(ref); children.set(parent, values);
  }
  const ready = [...indegree].filter(([, degree]) => !degree).map(([ref]) => ref);
  for (let index = 0; index < ready.length; index++) for (const child of children.get(ready[index]!) ?? []) {
    const degree = indegree.get(child)! - 1; indegree.set(child, degree); if (!degree) ready.push(child);
  }
  if (ready.length !== nodes.size) throw new CairnError('dependency_cycle', 'Dependencies must form a DAG; this update introduces a cycle');
}
