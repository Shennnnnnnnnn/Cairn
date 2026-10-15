export type Host = 'pi' | 'claude' | 'codex' | 'mcp';
export interface Session { host: Host; sessionId: string; cwd: string }
export interface Owner extends Session { epoch: number }
export interface Capabilities { capture: boolean; preTool: boolean; restore: boolean; stop: boolean }
export interface Scope { workspaceId?: string; issueId?: string; teamId?: string; roundId?: string; matchId?: string }
export interface Budget { deadline?: string; maxCalls?: number; maxParallel: number; submitReserveMs?: number }
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
}
export interface Action {
  id: string; purpose: string; stopCondition: string;
  status: 'planned' | 'running' | 'completed' | 'failed' | 'cancelled'; observationIds: string[];
}
export interface EvidenceCitation { observationId: string; resultRef?: string; statement: string }
export interface Report {
  summary: string; citations: EvidenceCitation[];
  impact?: { text: string; scope: Scope; observationIds: string[] };
  rootCause?: { text: string; level: 'symptom' | 'service' | 'code' | 'root'; trigger?: string; amplification?: string };
  solution?: { mitigation: string; fix: string; prevention: string };
}
export interface Task {
  id: string; origin: string; goal: string; constraints: string[]; criteria: Criterion[]; profile: 'general' | 'emergency';
  scope: Scope; owner: Owner; revision: number; createdAt: string; budget: Budget;
  status: 'active' | 'suspended' | 'completed'; observations: Observation[]; claims: Claim[];
  actions: Action[]; hints: { id: string; text: string; author: string }[];
  calls: Record<string, { status: 'running' | 'finished'; tool: string; startedAt: string }>;
  report?: Report; delivery?: { key: string; receipt: unknown; recordedAt: string }; confirmedAt?: string;
  continuation?: { revision: number; count: number }; interrupted: boolean;
}
export interface Check { ok: boolean; issues: string[]; unmet: string[] }
export class CairnError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'CairnError'; }
}
