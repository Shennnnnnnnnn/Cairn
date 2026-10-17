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
  basis?: string; references?: string[]; provenance?: 'agent' | 'captured' | 'subagent' | 'human' | 'verifier'; relatedCriteria?: string[];
  /** Host-computed versions of explicitly referenced, declared local artifacts. */
  referenceArtifacts?: Pick<Artifact,'path'|'sha256'|'bytes'>[];
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
/** Explicit local submission. Contents are hashed by the harness, never supplied by the model. */
export interface ArtifactInput { path:string; description?:string }
export interface Artifact extends ArtifactInput { sha256:string; bytes:number }
/** An exploration handoff points to saved detail without copying native transcripts. */
export interface HandoffInput {
  key:string; summary:string; report?:string; artifacts?:string[]; sessionRef?:string;
  from?:string[]; next?:string;
}
export interface Handoff extends HandoffInput {
  id:string; at:string; revision:number;
  /** Host-generated saved knowledge; this is not a receiver/delivery acknowledgement. */
  source?:Owner & {taskId:string;revision:number;candidate:string;fingerprint:string;state:'saved';reason:string;branchKey?:string};
  detail?:string; projectionError?:string;
}
/** One explicit reasoning milestone. Evidence aliases are local to the task. */
export interface CheckpointInput {
  summary: string;
  findings?: {
    key?: string; text: string; status?: Claim['status']; evidence?: string[]; against?: string[];
    covers?: string[]; scope?: Scope; basis?: string; references?: string[]; from?: string[];
  }[];
  progress?: ProgressInput[];
  artifacts?:ArtifactInput[]; handoffs?:HandoffInput[];
  questions?: string[]; next?: string;
  report?: { summary?: string; impact?: Report['impact']; rootCause?: Report['rootCause']; solution?: Report['solution'] };
}
export interface Checkpoint { summary: string; questions: string[]; next?: string; at: string }
export type FinishInput = Partial<CheckpointInput> & {
  outcome: 'completed' | 'suspended';
  /** One-result shorthand. Grounds are explicit; summary alone never becomes evidence. */
  basis?:string; references?:string[]; from?:string[]; covers?:string[];
};
/** A trusted host/human review, independent of the agent's status and artifact acceptance. */
export interface OutcomeAssessment {
  status:'passed'|'failed'|'inconclusive'; summary:string; scope:string; reviewer:string;
  at:string; epoch:number; proof:string;
}
/** Trusted host feedback, separate from agent-curated findings. */
export interface VerificationIssue { message:string; claims?:string[]; references?:string[] }
export interface VerificationResult { ok:boolean; issues?:VerificationIssue[]; method?:'replay'|'inspection'|'contract'; scope?:string }
export interface CompletionVerifier {
  id:string;
  /** Host-owned required deliverables; the agent cannot remove this acceptance requirement. */
  artifacts?:string[];
  verify(task:Readonly<Task>, signal?:AbortSignal):VerificationResult|Promise<VerificationResult>;
}
export interface VerificationRecord {
  verifier:string; status:'passed'|'failed'|'error'; issues:VerificationIssue[];
  at:string; checkedRevision:number; epoch:number; proof:string;
  method?:VerificationResult['method']; scope?:string; artifacts?:Artifact[];
}
export interface Task {
  id: string; title?:string; origin: string; goal: string; constraints: string[]; criteria: Criterion[]; profile: 'general' | 'emergency';
  scope: Scope; owner: Owner; revision: number; createdAt: string; budget: Budget;
  status: 'active' | 'suspended' | 'completed'; observations: Observation[]; claims: Claim[];
  actions: Action[]; hints: { id: string; text: string; author: string }[];
  calls: Record<string, { status: 'running' | 'finished'; tool: string; startedAt: string; epoch?:number }>;
  report?: Report; delivery?: { key: string; receipt: unknown; recordedAt: string }; confirmedAt?: string;
  checkpoint?: Checkpoint;
  completionVerifier?:string; verification?:VerificationRecord;
  assessment?:OutcomeAssessment;
  artifactRequirements?:string[]; artifacts?:Artifact[]; handoffs?:Handoff[];
  execution?:{state:'running'|'settled'|'interrupted'|'closed';at:string;epoch:number;settledAt?:string;interruptedAt?:string;closedAt?:string};
  budgetNotice?:{deadline:string;stage:'reserve'|'expired';at:string};
  conclude?: { status: 'requested' | 'saved'; at: string; revision: number };
  /** Older records omit evidenceMode and retain captured semantics. */
  evidenceMode?: EvidenceMode; progress?: ProgressItem[];
  referencePolicy?: 'advisory' | 'strict';
  lastCheck?: { revision: number; fingerprint: string };
  /** Bounded completion retries against the same findings and validation gaps. */
  finishAttempt?: { fingerprint: string; attempts: number };
  continuation?: { revision: number; count: number }; interrupted: boolean;
  explorationNotice?:{key:string;at:string;hintId?:string};
}
export interface CompletionRepair {
  unchanged: boolean; attempts: number;
  missingCriteria: { id: string; text: string }[]; omittedCriteria: number;
  actions: string[];
  requiredFields?:string[];
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
