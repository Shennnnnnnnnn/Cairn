export type Host = 'pi' | 'claude' | 'codex' | 'mcp';
export interface Session { host: Host; sessionId: string; cwd: string; epoch?: number }
export interface Owner extends Session { epoch: number }
export interface Capabilities { capture: boolean; preTool: boolean; restore: boolean; stop: boolean }
export interface Scope { workspaceId?: string; issueId?: string; teamId?: string; roundId?: string; matchId?: string }
export type EvidenceMode = 'curated' | 'captured';
export interface Budget { deadline?: string; maxCalls?: number; maxParallel?: number; submitReserveMs?: number }
export interface ProgressInput {
  key: string; title: string; status: 'pending' | 'running' | 'completed' | 'blocked' | 'cancelled'; detail?: string;
  from?: string[]; delegated?: boolean;
}
export interface BranchLease { token: string; actor: Session; epoch: number; expiresAt: string }
export interface ProgressItem extends ProgressInput {
  source: 'agent' | 'host'; updatedAt: string;
  branchStatus?: 'open' | 'claimed' | 'submitted' | 'merged'; lease?: BranchLease; branchCheckpoint?: Checkpoint;
}
export interface Criterion { id: string; text: string; claimIds: string[] }
export interface Observation {
  id: string; callId: string; tool: string; input: unknown; output: unknown;
  source: 'hook' | 'gateway' | 'manual'; resultRef?: string; scope: Scope;
  actor: {host:Host;sessionId:string;epoch:number};
  status: 'success' | 'error'; capturedAt: string; eligible: boolean;
  receipt?: unknown;
}
export interface Claim {
  id: string; text: string; status: 'proposed' | 'supported' | 'refuted' | 'inconclusive';
  supports: string[]; refutes: string[]; scope: Scope; revision: number;
  key?: string; updatedAt?: string;
  basis?: string; references?: string[]; provenance?: 'agent' | 'captured' | 'subagent' | 'human'; relatedCriteria?: string[];
  from?: string[]; branchKey?: string; history?: Omit<Claim, 'history'>[];
}
export interface Action {
  id: string; purpose: string; stopCondition: string;
  status: 'planned' | 'running' | 'completed' | 'failed' | 'cancelled'; observationIds: string[];
}
export interface EvidenceCitation { observationId: string; resultRef?: string; statement: string }
export interface Report {
  summary: string; citations: EvidenceCitation[];
  curatedReferences?: { claimId: string; statement: string; basis?: string; references: string[] }[];
  impact?: { text: string; scope: Scope; observationIds: string[] };
  rootCause?: { text: string; level: 'symptom' | 'service' | 'code' | 'root'; trigger?: string; amplification?: string };
  solution?: { mitigation: string; fix: string; prevention: string };
}
/** One explicit reasoning milestone. Evidence aliases are local to the task. */
export interface CheckpointInput {
  summary: string;
  findings?: {
    key?: string; text: string; status?: Claim['status']; evidence?: string[]; against?: string[];
    covers?: string[]; scope?: Scope; basis?: string; references?: string[]; from?: string[];
  }[];
  progress?: ProgressInput[];
  questions?: string[]; next?: string;
  report?: { summary?: string; impact?: Report['impact']; rootCause?: Report['rootCause']; solution?: Report['solution'] };
}
export interface Checkpoint { summary: string; questions: string[]; next?: string; at: string }
export type FinishInput = Partial<CheckpointInput> & { outcome: 'completed' | 'suspended' };
export interface Task {
  id: string; origin: string; goal: string; constraints: string[]; criteria: Criterion[]; profile: 'general' | 'emergency';
  scope: Scope; owner: Owner; revision: number; createdAt: string; budget: Budget;
  status: 'active' | 'suspended' | 'completed'; observations: Observation[]; claims: Claim[];
  actions: Action[]; hints: { id: string; text: string; author: string }[];
  calls: Record<string, { status: 'running' | 'finished'; tool: string; startedAt: string; epoch?:number }>;
  report?: Report; delivery?: { key: string; receipt: unknown; recordedAt: string }; confirmedAt?: string;
  checkpoint?: Checkpoint;
  conclude?: { status: 'requested' | 'saved'; at: string; revision: number };
  /** Older records omit evidenceMode and retain captured semantics. */
  evidenceMode?: EvidenceMode; progress?: ProgressItem[];
  referencePolicy?: 'advisory' | 'strict';
  lastCheck?: { revision: number; fingerprint: string };
  continuation?: { revision: number; count: number }; interrupted: boolean;
}
export interface Check { ok: boolean; issues: string[]; unmet: string[]; warnings?: string[] }
export class CairnError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'CairnError'; }
}
/** Lease credentials are never part of read-only projections or exports. */
export function publicTask(task: Task): Task {
  const result=structuredClone(task);
  for(const item of result.progress??[])if(item.lease)Reflect.deleteProperty(item.lease,'token');
  return result;
}
