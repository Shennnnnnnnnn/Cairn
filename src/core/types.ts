export type Host = 'pi' | 'claude' | 'codex' | 'mcp';
export interface Session { host: Host; sessionId: string; cwd: string; epoch?: number }
export interface Owner extends Session { epoch: number }
export interface Capabilities { capture: boolean; preTool: boolean; restore: boolean; stop: boolean }
export type Scope = Record<string, string>;
export type EvidenceMode = 'curated' | 'captured';
export interface Budget { deadline?: string; maxCalls?: number; maxParallel?: number; submitReserveMs?:number }
export interface ProgressInput {
  key: string; title: string; status: 'pending' | 'running' | 'completed' | 'blocked' | 'cancelled'; detail?: string;
  branch?: string; from?: string[]; delegated?: boolean;
}
export interface BranchLease { token: string; actor: Session; epoch: number; expiresAt: string }
export interface ProgressItem extends ProgressInput {
  source: 'agent' | 'host'; updatedAt: string;
  branchStatus?: 'open' | 'claimed' | 'submitted' | 'merged'; lease?: BranchLease; branchCheckpoint?: Checkpoint;
}
export type BranchStatus = 'pending' | 'running' | 'awaiting_review' | 'reviewing' | 'completed' | 'blocked' | 'cancelled';
export interface BranchInput {
  key: string; title: string; status: BranchStatus; executor?: 'main' | 'subagent';
  parent?: string | null; question?: string; rationale?: string; assignee?: string;
  agentId?: string | null; summary?: string; from?: string[];
}
export interface Branch extends Omit<BranchInput, 'executor' | 'parent' | 'agentId'> {
  executor: 'main' | 'subagent'; parent?: string; agentId?: string;
  epoch: number; attempt: number; updatedAt: string; sourceFacts?: FactVersion[];
}
/** Minimal host lifecycle metadata, never a tool call or a child transcript. */
export interface AgentRun {
  agentId: string; host: Host; epoch: number; attempt: number; type?: string;
  status: 'running' | 'returned'; startedAt?: string; returnedAt?: string;
}
export interface Criterion { id: string; text: string; claimIds: string[] }
export interface Observation {
  id: string; callId: string; tool: string; input: unknown; output: unknown;
  source: 'hook' | 'gateway' | 'manual'; resultRef?: string; scope: Scope;
  actor: {host:Host;sessionId:string;epoch:number};
  status: 'success' | 'error'; capturedAt: string; eligible: boolean;
}
export interface FactVersion { id:string; revision:number; text:string; basis?:string; references?:string[]; scope:Scope }
export interface Derivation { branch:string; epoch:number; attempt:number; inputs:FactVersion[] }
export interface ReviewReason { generation:number; kind:'evidence'|'feedback'|'reopened'; ref:string; text:string }
export interface ReviewState { generation:number; acknowledged:number; pending:ReviewReason[]; last?:{snapshot:number;generation:number;summary:string;at:string} }
export interface HumanFeedback { id:string; text:string; author:string; key?:string; at?:string }
export interface Claim {
  id: string; text: string; status: 'proposed' | 'supported' | 'refuted' | 'inconclusive';
  supports: string[]; refutes: string[]; scope: Scope; revision: number;
  key?: string; updatedAt?: string;
  basis?: string; references?: string[]; provenance?: 'agent' | 'captured' | 'subagent' | 'human' | 'verifier'; relatedCriteria?: string[];
  /** Host-computed versions of explicitly referenced, declared local artifacts. */
  referenceArtifacts?: Pick<Artifact,'path'|'sha256'|'bytes'>[];
  from?: string[]; branchKey?: string; history?: Omit<Claim, 'history'>[];
  branch?: string; derivation?:Derivation;
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
    branch?: string; producedBy?:string;
  }[];
  progress?: ProgressInput[];
  branches?: BranchInput[];
  artifacts?:ArtifactInput[]; handoffs?:HandoffInput[];
  questions?: string[]; next?: string;
  report?: { summary?: string };
}
export interface Checkpoint { summary: string; questions: string[]; next?: string; at: string }
/** One semantic change, reported when it happens, without tool telemetry. */
export interface StateUpdateInput {
  branch?: Omit<BranchInput, 'title'> & { title?: string };
  progress?: Omit<ProgressInput, 'title'> & { title?: string };
  finding?: NonNullable<CheckpointInput['findings']>[number] & { key: string };
  review?:{snapshot:number;summary:string};
  feedback?:{task_id:string;text:string;author:string;key?:string};
}
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
/** Optional orchestration metadata. Knowledge remains in findings/progress, not leases. */
export interface SchedulerFlight {
  id:string; phase:'bootstrap'|'reason'|'explore'|'conclude'; startedAt:string;
  branch?:{key:string;title:string}; sessionRef?:string; fingerprint:string;
  /** Validated public result saved before applying it; never private reasoning. */
  candidate?:unknown;
}
export type SchedulerStartMode = 'auto'|'bootstrap-first'|'reason-first';
export interface SchedulerState {
  version:1; epoch:number; bootstrapDone:boolean; sequence:number;
  /** Initial entry selection; recovery keeps the saved phase instead of restarting it. */
  start?:{requested:SchedulerStartMode;selected:Exclude<SchedulerStartMode,'auto'>;basis:'explicit'|'saved-state'|'new-task';reason:string};
  status:'running'|'idle'|'failed'|'interrupted'|'completed'|'suspended';
  lease?:{token:string;expiresAt:string}; inflight:SchedulerFlight[];
  reasonFingerprint?:string; failedBranches:string[]; feedback?:string;
  completionAttempt?:string;
}
/** Numeric host telemetry only; no tool names, arguments, results or transcripts. */
export interface TokenUsage {
  input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number;
}
export interface UsageTotals {
  partial?: boolean;
  tokens?: TokenUsage; modelCalls?: number; toolCalls?: number; cairnCalls?: number; toolErrors?: number;
  sources: string[]; updatedAt: string;
}
export interface TaskTiming { activeMs: number; activeSince?: string; stoppedAt?: string; trackedSince: string }
export interface Task {
  id: string; title?:string; origin: string; goal: string; constraints: string[]; criteria: Criterion[]; profile?:'general';
  scope: Scope; owner: Owner; revision: number; createdAt: string; budget: Budget;
  status: 'active' | 'suspended' | 'completed'; observations: Observation[]; claims: Claim[];
  actions: Action[]; hints: HumanFeedback[];
  review?:ReviewState; reopened?:{epoch:number;reason:string;at:string};
  calls: Record<string, { status: 'running' | 'finished'; tool: string; startedAt: string; epoch?:number }>;
  report?: Report;
  checkpoint?: Checkpoint;
  completionVerifier?:string; verification?:VerificationRecord;
  assessment?:OutcomeAssessment;
  artifactRequirements?:string[]; artifacts?:Artifact[]; handoffs?:Handoff[];
  execution?:{state:'running'|'settled'|'interrupted'|'closed';at:string;epoch:number;settledAt?:string;interruptedAt?:string;closedAt?:string};
  budgetNotice?:{deadline:string;stage:'reserve'|'expired';at:string};
  conclude?: { status: 'requested' | 'saved'; at: string; revision: number };
  /** Older records omit evidenceMode and retain captured semantics. */
  evidenceMode?: EvidenceMode; progress?: ProgressItem[];
  branches?: Branch[]; agentRuns?: AgentRun[];
  usage?: UsageTotals; timing?: TaskTiming;
  referencePolicy?: 'advisory' | 'strict';
  lastCheck?: { revision: number; fingerprint: string };
  /** Bounded completion retries against the same findings and validation gaps. */
  finishAttempt?: { fingerprint: string; attempts: number };
  continuation?: { revision: number; count: number }; interrupted: boolean;
  explorationNotice?:{key:string;at:string;hintId?:string};
  scheduler?:SchedulerState;
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
  if(result.scheduler?.lease)Reflect.deleteProperty(result.scheduler.lease,'token');
  return result;
}
