export type Host = 'pi' | 'claude' | 'codex' | 'mcp';
export interface Session { host: Host; sessionId: string; cwd: string }
export interface Owner extends Session { epoch: number }
export interface Capabilities { capture: boolean; preTool: boolean; restore: boolean; stop: boolean }
export type Scope = Record<string, string>;
export type EvidenceMode = 'curated' | 'captured';
export interface Budget { deadline?: string; maxCalls?: number; maxParallel?: number }
export interface ProgressInput {
  key: string; title: string; status: 'pending' | 'running' | 'completed' | 'blocked' | 'cancelled'; detail?: string;
}
export interface ProgressItem extends ProgressInput { source: 'agent' | 'host'; updatedAt: string }
export interface Criterion { id: string; text: string; claimIds: string[] }
export interface Observation {
  id: string; callId: string; tool: string; input: unknown; output: unknown;
  source: 'hook' | 'gateway' | 'manual'; resultRef?: string; scope: Scope;
  actor: {host:Host;sessionId:string;epoch:number};
  status: 'success' | 'error'; capturedAt: string; eligible: boolean;
}
export interface Claim {
  id: string; text: string; status: 'proposed' | 'supported' | 'refuted' | 'inconclusive';
  supports: string[]; refutes: string[]; scope: Scope; revision: number;
  key?: string; updatedAt?: string;
  basis?: string; references?: string[]; provenance?: 'agent' | 'captured'; relatedCriteria?: string[];
}
export interface Action {
  id: string; purpose: string; stopCondition: string;
  status: 'planned' | 'running' | 'completed' | 'failed' | 'cancelled'; observationIds: string[];
}
export interface EvidenceCitation { observationId: string; resultRef?: string; statement: string }
export interface Report {
  summary: string; citations: EvidenceCitation[];
  curatedReferences?: { claimId: string; statement: string; basis?: string; references: string[] }[];
}
/** One explicit reasoning milestone. Evidence aliases are local to the task. */
export interface CheckpointInput {
  summary: string;
  findings?: {
    key?: string; text: string; status?: Claim['status']; evidence?: string[]; against?: string[];
    covers?: string[]; scope?: Scope; basis?: string; references?: string[];
  }[];
  progress?: ProgressInput[];
  questions?: string[]; next?: string;
  report?: { summary?: string };
}
export interface Checkpoint { summary: string; questions: string[]; next?: string; at: string }
export type FinishInput = Partial<CheckpointInput> & { outcome: 'completed' | 'suspended' };
export interface Task {
  id: string; origin: string; goal: string; constraints: string[]; criteria: Criterion[];
  scope: Scope; owner: Owner; revision: number; createdAt: string; budget: Budget;
  status: 'active' | 'suspended' | 'completed'; observations: Observation[]; claims: Claim[];
  actions: Action[]; hints: { id: string; text: string; author: string }[];
  calls: Record<string, { status: 'running' | 'finished'; tool: string; startedAt: string; epoch?:number }>;
  report?: Report;
  checkpoint?: Checkpoint;
  /** Older records omit evidenceMode and retain captured semantics. */
  evidenceMode?: EvidenceMode; progress?: ProgressItem[];
  lastCheck?: { revision: number; fingerprint: string };
  continuation?: { revision: number; count: number }; interrupted: boolean;
}
export interface Check { ok: boolean; issues: string[]; unmet: string[] }
export class CairnError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'CairnError'; }
}
