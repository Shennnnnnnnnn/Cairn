# Cairn 4.9 plugin architecture

Cairn preserves goals, curated evidence and recoverable progress inside existing CLIs. The host owns models, accounts, sessions, permissions and tools. The default six-tool harness adds no dispatcher or model API credentials. An opt-in `Scheduler` / `cairn run` supplies a persistent Bootstrap/Reason/Explore loop through a `HostExecutor` callback; the provided Pi/Codex adapters invoke the native CLI and retain host permissions. See [the scheduler guide](scheduler.zh-CN.md). Concurrency is an explicit process resource setting, not a task budget.

The optional scheduler generates compact phase instructions from the same schema used to validate results. Output correction resumes the original native session and accepts only observed zero-action candidates; Pi disables tools, while Codex audits public actions after execution. New scheduler tasks default to `session-mode single`: all Bootstrap/Reason/Explore phases reuse the same native session sequentially, with deltas and a full public snapshot locator. Explicit `session-mode multi` permits separate Explore sessions as needed; its default `fresh-full` coordinator preserves the original design, while `reuse-delta` allows coordinator reuse. The execution policy and single-session locator survive restart/takeover; projection cursors reset to a full input. Single-session continuation requires a locator and confirmed native availability, including repair and conclude; it never silently starts a replacement. Legacy scheduler records retain multi-session recovery. Stale-review checks compare saved blackboard state; actual file versions participate in repeated-completion guards without silently refreshing old finding references. These mechanisms do not establish independent semantic correctness.

Initial entry is separately configurable as `auto`, `bootstrap-first` or `reason-first`. Auto reviews saved findings, observations, actions, progress, questions, next steps or deliverables before doing more work; an empty work state starts with the original direct Bootstrap attempt. It uses no domain heuristics or additional model call. Selection is persisted before dispatch and exposed through status and timeline; later recovery preserves prior progress even if the new invocation requests another entry. Legacy scheduler records remain recoverable without inventing a past selection. Entry selection does not grant evidence or criterion coverage.

## Model interface: six operations

`ToolRuntime` supplies the same domain interface to Pi native tools and stdio MCP:

| Operation | Behavior |
| --- | --- |
| `cairn_start` | Create a goal, criteria, initial constraints and optional progress; general tasks default to curated evidence |
| `cairn_resume` | Bind an existing task; require explicit takeover to change owners |
| `cairn_read` | Read bounded context, findings/references, optional captured observations, full details, history or tasks |
| `cairn_update` | Immediately save one branch/progress/finding change, with a compact idempotent receipt |
| `cairn_checkpoint` | Save recovery summary, questions and next action |
| `cairn_finish` | Validate the final outcome, or suspend with gaps |

The model does not separately maintain claim IDs, criterion links and report citations. A small task uses start → host tools → update finding → finish. Longer tasks save semantic updates when they occur and recovery summaries before handoff or compaction. Initial tool guidance is goal/constraint input, rather than a framework-specific tool registry requirement.

Finding `key` values identify intentional revisions. `covers` associates supported findings with c# criteria; a new supported finding covers the sole criterion automatically. Finding statuses are `proposed`, `supported`, `refuted` and `inconclusive`. Work progress is separate: `{key,title,status,detail?}` uses `pending`, `running`, `completed`, `blocked` and `cancelled`. Updating a work item does not prove its corresponding goal condition.

Checkpoint `summary` describes current progress without replacing an existing report summary. An explicit finish `summary` or checkpoint `report.summary` supplies the final report summary. Model-facing finish accepts only outcome and a short summary; SDK invoke retains the wider legacy input. The core regenerates the report's reference links from the saved findings. Missing conditions keep `status: active` and return `phase: incomplete`. A stopped attempt or expired budget is never completion.

## Two evidence modes

### Curated: the public general default

`cairn_start` defaults to `evidence_mode: "curated"` for new tasks. No gateway or tool whitelist is necessary. Native host tools remain freely selectable under the host's own permissions.

Curated findings store:

- `basis`: the agent's concise explanation of what supports or refutes the conclusion.
- `references`: file paths, URLs or other useful source pointers selected by the agent.
- Conclusion state, readable key and criterion coverage.

Supported findings need a recorded basis or references. The core validates their structure, recorded state and report/criterion relationships. It can validate explicitly declared local reference paths and bind artifact hashes, but does not attest that a cited file was read or establish semantic/causal correctness. References remain explicitly agent-curated. A model declaration of `supported` is not independent verification.

No `tool.started`, raw observation, tool name or tool IO is stored for curated host tools. Numeric resource statistics use a separate hashed receipt table. Pre/post hooks do not reserve a quota, block native tools, retain inputs/results or create E# aliases. Curated business state comes from explicit semantic updates, not uncorrelated host plan events. Goal/checkpoint/resume/finish events still form a persistent task history.

### Captured: explicit raw evidence

Tasks opt in with `evidence_mode: "captured"`. Existing tasks without an `evidenceMode` field retain captured semantics. Starting a new public task with a different default does not convert old records.

An `Observation` is an original tool result record, not an agent role. It includes original input/output, source, scope, actor host/session/epoch, time, result status and eligibility. Append-only E1/E2 aliases refer to its positions in a task. Immutable IDs and unambiguous genuine platform `result_ref` values are also accepted. Missing, ambiguous, cross-task, failed or late references cannot support completion.

Findings use `evidence` and `against` to link supporting and refuting observations. Original records stay separate from interpretations and human hints. A finding with unresolved captured counterevidence cannot be supported. Historical manual observations retain their source and do not become automatic capture.

Captured validation establishes structural integrity, task/scope membership and eligibility. The agent must still review relevance and contradictions; diagnostic truth needs evaluation against labelled cases.

## Budget policy

Curated tasks have no default `maxCalls` or `maxParallel`. Supplying them is rejected, because unrecorded calls cannot be counted or limited reliably. A curated `budget.deadline` is advisory; passing it does not prevent a checkpoint, further native work or a valid finish. Host model limits, approvals and concurrency remain host responsibilities.

Captured calls reserve configured count/parallel limits atomically, and apply deadlines to gateway requests and native tool paths actually covered by hooks. The historical captured concurrency default remains three when unspecified. This is not a universal quota over arbitrary host paths. Hooks can be missing, and hosted tools may not invoke local hooks.

Budget exhaustion does not establish completion; suspend with a gap report if further work must stop. A six-call fixture budget is sample configuration, not a general success threshold.

## Identity, subagents and ownership

One `ToolRuntime` belongs to one native session or MCP connection and owns its gateway lifecycle. Pi obtains identity from the actual invocation context. Native Claude/Codex startup hooks provide the true native session ID; a connection supplies it on its first start/resume and then uses its binding. Generic `cairn mcp` automatically generates a fresh per-process UUID when no explicit `--session-id` is supplied. This is a generic MCP identity, not a claimed native CLI session. New owners still require explicit takeover; no identity is inferred from recent tasks.

Generic MCP database selection uses `--db`, then `CAIRN_DB`, then `userHome()/.cairn/mcp.json`, then the workspace. `--remember` writes the generic preference atomically; `--forget` clears it and exits. Explicit native hosts retain their existing database/identity path. UI preferences remain separate; integration installation intentionally saves both to the same database.

No identity is guessed from recent activity or a database row. Read-only inspection can address another task; editing requires the active bound owner, matching cwd and execution epoch. A new child-agent context is not automatically bound to its parent's goal.

Subagents can conduct independent checks using the host's native mechanism. An owner can explicitly delegate a progress item; a separate session claims a token-bearing lease and submits only proposed findings. The owner reviews and merges the branch, then explicitly promotes conclusions. Claim, heartbeat, expiry, release and epoch fencing are transactional. Leases are coordination state, never evidence. Another durable native session can become the owner only through explicit resume/takeover. A child context is not a portable substitute for a new native session, its lifecycle hooks or task fencing.

Takeover increments the epoch and settles the previous owner's in-flight bookkeeping. Old owners cannot mutate or finish the task. In captured mode late observations remain audit-only. Suspension turns running progress items into blocked work, retains their meaning and suppresses continuation prompts. Resumption does not assume a previously running process is still alive. Completed tasks reject ordinary writes; explicit reopen with a reason advances the owner epoch and preserves the historical completion. Repeating a content-free finish returns its recorded status. MCP connections pin their bound epoch, including when the same native session explicitly reopens a task.

## Autonomous investigation branches

The shared skill recommends working in the current host session by default. The model requests host-native helpers when bounded independent questions and expected benefit justify the coordination cost, within host/user limits. In the default tool integration the host schedules helpers; the optional Scheduler explicitly dispatches native phases through HostExecutor. Branches can also be investigated by the main session.

`Branch` persists a stable key, parent, question, executor/assignee, optional real agent ID, status, result/stopping summary, epoch and execution attempt. Checkpoints update branches atomically with findings and progress; each may point to a branch key. Parent cycles, foreign references and duplicate active agent bindings are rejected. Completed/cancelled branches require a summary. Pending, running, blocked or unreviewed branches keep completion incomplete, as do known current-epoch native helpers still running. Suspension can be saved immediately.

Codex/Claude bundles register SubagentStart/SubagentStop. New starts under an enabled, active parent goal immediately save minimal execution metadata and historical state without branch registration or agent reporting. Returns route to the observed run's original goal/owner epoch. Unassociated executions appear independently in the graph; an exact native ID can later associate them with semantic branches. Unknown stops and stale owner events cannot infer a new goal. Child-specific tool/Stop hooks cannot suspend the parent. A native return ends execution and does not accept findings; main-agent review remains a separate semantic transition. Pi and generic MCP explicitly report uncovered states. Doctor reports installed and actually observed coverage.

The graph projects saved branch membership and nesting, not inferred causal dependencies. It shows assignee and state and links reviewed findings/evidence to their branch. Replay uses the persisted states, including lifecycle changes. Unbranched existing tasks keep their earlier topology.

Official references: [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude hooks](https://code.claude.com/docs/en/hooks), [Pi extensions](https://pi.dev/docs/latest/extensions). Host capability and hook coverage still depend on the installed runtime.

## Persistence and compact restoration

`Engine` operates on goals, findings, optional observations, work progress, human hints and checkpoints. `Store` commits a projection and an append-only event atomically using SQLite `BEGIN IMMEDIATE`. WAL and a busy timeout support hooks, MCP and dashboard processes sharing the database. Each event also commits a historical domain-state frame in `task_history`, using a nested savepoint so direct Store writes remain atomic too. Frames omit raw observation IO and retain the evidence index. The read-only replay API projects these states using their event time, pages frame metadata at a fixed head, and scopes lookups to the requested task. The UI keeps historical playback separate from live SSE updates. Legacy databases import only known creation/current-head baselines and disclose missing intermediate frames; no model or tool is rerun to manufacture history. Claim revisions and task changes remain in the event ledger.

`Engine.context` retains the bounded legacy summary and adds a complete semantic graph when the envelope fits. Larger graphs supply an immutable snapshot reference and checksum instead of dropping nodes or proof paths. Legacy totals/truncation indicators describe the summary only; graph completeness is explicit. Snapshot reads use task_history and event sequence, not revision alone, and are scoped to the task. They contain no raw tool IO or private host transcript.

`cairn_read` retrieves a curated finding by key/ID or a captured observation by alias/ID/result reference. Indexes and history use record pagination. Full task metadata uses `view: "details"`; large records and immutable event payloads use character offsets. Details pages can require a matching revision; individual audit payloads use `view: "history", ref: "event:SEQ"`. UI/export projections retain access to full persisted records.

Existing TypeScript SQLite tasks and reports remain available with their original mode. Older Python formats have no automatic migration. Replacing the public workflow does not erase task history.

## Recorded-time replay semantics

The replay endpoint projects the requested state and its immediately preceding available visible state in the same task. The response includes a semantic checkpoint delta: changes, highlighted node IDs, prior sequence/time, elapsed save interval and gap disclosure. It does not compare against the browser's last visited frame, so direct/backward seeks have the same result. Missing intermediate snapshots produce an explicitly aggregate delta; unavailable baselines produce no inferred highlights.

Graph comparisons exclude storage revisions, timestamps and geometry, and canonicalize dictionary/relation order. Origin/goal signatures contain only meaningful visible state. Branch transitions group the derived review node with its source branch, rather than presenting one returned result as two operations. Removed information is listed without drawing a current ghost node. Actor lanes and review/return links derive from saved branch assignment and acceptance; they do not add domain events, tool telemetry, private reasoning or measured execution spans.

The replay UI uses a continuous time axis derived from recorded timestamps, with 1×/5×/10×/30×/60× actual time multipliers, a millisecond seek range, elapsed/total duration and proportional record markers. A monotonic clock anchors playback, so delayed timer ticks do not change the rate. Between records it holds the last known state; loading buffers at the next transition. Pause intent survives in-flight reads, and newer seeks invalidate stale responses. Equal-time records share an instant and display the latest ledger state; invalid/regressing timestamps are clamped in ledger order and disclosed. No operation duration or concurrency is inferred from a batched save. State colors, recent-change outlines, actor lanes and review nodes remain visible. Its default camera focuses branch execution and review; fit and source links expose the full graph. Live updates remain isolated until the user returns live.

## Native adapters

Pi uses a native extension for session, tool, compaction, settlement and shutdown events. Claude uses a local marketplace plugin with skills, hooks and stdio MCP. Codex installs project/user hooks, MCP and a skill, while a marketplace package is also built. Each bundle contains its runtime.

Lifecycle processing remains available to enabled tasks in both modes: startup context, compaction restoration, interruption and bounded Stop checks. Pi injects context after a meaningful state revision or compaction rather than repeating an unchanged projection on every turn. Claude/Codex use startup/resume context and explicit read on bound connections. A restarted MCP connection binds again with resume.

Native plan integration is conditional and captured-only. A successful Codex `update_plan` result can supply semantic progress only if a previous captured PreToolUse reservation associates its call ID with the current task and owner epoch, and its observation is eligible. The progress event contains only known `plan[{step,status}]` fields; the captured observation retains its normal provenance separately. Missing, stale or cross-task associations do not update progress. Curated hooks skip native plan results entirely: without call association, a result delayed across same-session goal changes cannot be safely attributed. No call metadata is added to curated mode for this purpose. Arbitrary similarly named MCP tools are not interpreted as plans. Claude/Pi have no guaranteed native-plan mapping; `checkpoint.progress` is the reliable shared path for all three hosts.

In curated mode all other native pre/post tool events remain unrecorded and unblocked by Cairn. In captured mode PreToolUse reserves budgets and PostToolUse records results. Actual Cairn namespaces are excluded from recursive capture; similarly named tools on another server are not exempt.

User interruption takes priority. Stop hints are bounded and do not replace core completion validation. Declared capabilities describe adapter implementation; observed lifecycle events show what actually ran. `doctor` reports both with installation/version/MCP/upstream status. An installed hook does not prove complete tool coverage. Missing hooks degrade automatic restoration or captured evidence; explicit curated management remains available.

## Optional typed upstream gateway

The six management tools work without an upstream configuration. An optional gateway can expose configured MCP tools with their original input schemas, using stdio or Streamable HTTP. Tool selection and permissions remain with the host.

Generic mappings identify the server, upstream tool, optional result-reference path and arbitrary string-valued scope paths. Cairn does not inject business reports into tool arguments or orchestrate external acceptance. Original arguments pass through unchanged.

Captured calls reserve explicit budgets and append original results; curated calls forward without retaining tool input/output. Both use shared connections, paginated catalogs, independent request cancellation and idempotent close. Scope/reference extraction errors preserve the original failure in captured mode. Transport faults evict dead connections; ordinary tool failures and cancellation do not tear down independent requests. External actions are never automatically retried.

## Blue-and-white progress UI

`cairn ui` starts an optional loopback HTTP server against the shared database. SSE invalidates compact projections after a committed audit sequence changes. Read-only dashboard traffic creates no model calls or task audit events. Human mutations append their own attributed events.

The CLI can remember one UI database with `cairn ui --db FILE --remember`; `cairn ui --forget` clears that preference and exits. Selection is explicit `--db`, then `CAIRN_DB`, then the saved UI database, then the workspace database. The versioned preference is atomically saved under `userHome()/.cairn/ui.json` with private file permissions. This affects only the UI path; task/MCP/hook selection is unchanged. When no port is specified, the CLI tries port 8000 and falls back to a free port only on an address-in-use error. Explicit port failures remain visible. Failed startup does not replace a remembered preference.

The relationship graph is the default main view; there is no separate progress board. It includes starting context, authored work stages, evidence, conclusions, completion criteria and the goal. Teal origin and rose goal colors preserve roles; indigo completed/result nodes, amber running work and pale dashed pending work preserve the earlier UI's status semantics. Goal nodes retain their role color and display satisfaction separately. Labels supplement color. Explicit findings/progress.from values express joint prerequisites. The engine resolves same-batch aliases to canonical IDs and checks the whole graph for cycles before commit. The graph uses longest-path ranks, with criterion and goal nodes after exploration. Records without declared dependencies retain contextual start edges. No dependency is invented from plan order. HTML exports share the same graph projection.

The graph displays stored, reported state, not live process liveness. `active` does not mean a process is running. Paused/stale work is not shown as executing; missing telemetry does not mean idle. Goal coverage comes from core validation and may decrease after revised findings. Raw observations are labelled as original evidence where present; curated conclusions display basis/references and agent provenance. The timeline emphasizes human-readable change summaries and expandable detail, with captured evidence events filterable separately. Phase labels describe persisted state, not a fixed execution pipeline.

Host/origin checks, no CORS permission and nonce CSP protect local data. Only hints, suspend and reopen have POST routes; each requires the per-server CSRF token, JSON with a bounded body and an atomically checked task revision. Lease credentials are removed from read-only projections and exports. Closing the UI does not stop the host. Bootstrap remains a direct useful first attempt in the ongoing host session, without a second model runtime.

## Immediate semantic updates and native execution records

`cairn_update` accepts exactly one branch, progress item or stable-key finding. It validates ownership and state, atomically appends an event and immutable history state, and returns a compact receipt. Unchanged retries append nothing. A delegated branch enters reviewing before the main agent examines its result; acceptance is a separate completed update. Checkpoint remains a recovery summary/import interface, not the ordinary transition reporting cadence.

Native SubagentStart associates a new execution with the active parent goal and owner at arrival, immediately saving agent.started plus its historical state, even without a semantic branch. SubagentStop routes to that exact previously observed execution/goal, including when the parent has paused and started another goal. Repeated starts/returns and stale owner epochs do not create new activity. Unknown stops cannot infer a goal. Native parent-session end or interruption automatically suspends unfinished work once; child-session end cannot suspend its parent. An already observed ID cannot attach to a fresh goal after ownership changes. Minimal IDs/type/status/timestamps are retained; tool calls, raw results, child messages and transcripts are not.

An unassociated run is shown as a native execution node connected to the parent context, never an invented investigation branch. Native execution counters are separate from semantic branch counters. Exact native ID association can merge it into a branch; routing aliases, matching names and counts are not treated as proof. Binding changes commit at association time and do not rewrite past frames. The main agent reports semantic states such as review start, accepted findings, blocked hypotheses and goal coverage. MCP-only hosts report uncovered states explicitly. Host execution lifecycle and semantic acceptance are deliberately independent.

The native event contract was checked against [official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks). Host/plugin hooks still require their native trust flow in normal use. The isolated automated Codex exercise enables only reviewed Cairn hooks; it preserves the model workspace sandbox.

## Prompt responsibilities

The shared SKILL.md owns behavioral policy: goal/evidence semantics, immediate updates, delegation/review and recovery. References supply scenario-specific examples or branch/host details on demand. Tool descriptions contain calling conditions, input/output conventions and validation behavior; they do not repeat the work method. Native hooks inject identity, saved state and role-specific boundaries. The recovery packet contains current facts and a pointer to the skill rather than a second delegation policy.

Exact application-level prompts used in the read-only acceptance run are published separately from the skill. They are example inputs with provenance, not additional standing instructions. Host system/developer policies and private reasoning are not exported.

## Graph as shared context

The pure core graph projection retains every stored finding, basis/reference, criterion, branch, work item, native execution and human hint. Evidence connections are generated by the same evidenceRelations function used in the UI. Geometry and derived visual review decoration remain UI concerns. Intended criterion relevance (addresses) is distinct from accepted coverage (criterion). Missing references become unavailable nodes rather than disappearing or triggering cross-task lookup.

cairn_read graph supports the full body, complete topology index, evidence-connected focus and snapshot deltas. Page offsets address JSON text; clients pin event sequence and checksum and read through nextOffset. Concurrent updates and ownership takeover do not alter a pinned snapshot. The current curated visibility policy also applies to historical graph reads; a policy change invalidating the projection rejects a mismatched checksum.

A handoff contains the assignment, root goal/criteria/constraints, evidence-connected selection, human hints and global graph access. Related proof components include competing hypotheses and branch ancestors, without claiming that membership establishes causality. Native child startup injects read-only graph access only for the verified active parent owner, never a newer unrelated goal. A helper can read an explicit task_id without binding/resuming it. MCP-only delegation resolves and forwards this packet through the host.

New writes remain compact receipts whose sequence identifies a graph snapshot. The agent reads the latest graph or a delta at decision/review points, without a polling scheduler. Snapshots reflect saved semantics at that point; they cannot prove the model read every token or the cited material is correct. The host still owns execution and concurrency.

## Versioned exploration and review

branch.from pins supported, task-scoped fact versions (or origin); finding.producedBy records the producing exploration attempt and its immutable inputs. Membership does not imply production. Reused branch attempts retain distinct exploration nodes; revised source bodies remain visible as fixed historical fact nodes. Core rejects unsupported/foreign sources, self-derived cycles and outputs based on stale inputs. The UI and semantic graph share this topology.

A task enters explicit evidence-review mode when it first declares an exploration or receives external feedback. Subsequent new/revised findings queue generation-numbered review reasons; plain direct tasks remain lightweight. A review acknowledgement names a task-scoped historical snapshot and a summary, clearing only generations visible there. It cannot repair a stale derivation. Source revisions propagate staleness through derived findings and block completion until revalidated or withdrawn. Both queues and source validity are persisted/projected, not maintained by a scheduler. Host events/context and update receipts expose pending review; the shared skill handles reconsideration at decision points.

Attributed human feedback is append-only in any status and does not bind or change the owner. Optional immutable keys make retries idempotent. The author is caller supplied, not authenticated identity. Feedback does not reopen a completed task automatically. Explicit resume with reopen.reason preserves prior history, advances the epoch and requires takeover for a different owner; graph/replay show the feedback, review and reopen as separate saved changes. No tool inputs/results or child transcripts are collected.


## Numeric resource accounting (4.8)

`usage_samples` stores only SHA-256 receipt keys, task/owner attribution and numeric counters. Pre-tool events reserve attribution without a tool record; returned native calls increment a counter once, including failures, while the Cairn namespace is counted separately. Old owner epochs cannot charge a new owner, and a delayed return keeps its reserved original task. No receipt contains a tool name, timestamp, arguments or result. Child hooks remain outside the main-session totals.

Pi consumes finalized native assistant usage. A start/resume response can precede task binding, so the adapter temporarily holds its numbers in memory until success. An exact task/epoch binding keeps that turn's final reply attributed after finish; the next user turn resets the binding. Claude/Codex read only numeric usage shapes from the exact host-supplied file in at most 4 MiB increments. Per-message maxima deduplicate Claude partial records; Codex cumulative counters are baselined and cannot be rewound by an older concurrent hook. Receipt transactions make cursor retries idempotent. Initial/oversized history and unsupported formats may limit coverage, which is explicitly described as observed main-session usage, never total account cost.

Usage saves an atomic `usage.updated` event/history frame without increasing the semantic revision, invalidating completion or queuing evidence review. The timeline treats these as advanced records. `Store.save` also maintains a task activity timer across actual active/suspended/completed transitions, with a partial marker for older tasks first observed while active. Dashboard/replay time comes from the live/playback clock; active time freezes on suspension and completion, while wall time continues until completion. No historical counters or active intervals are fabricated.

## Integration boundary in 4.9

Mainline immediate updates, semantic Branch provenance, snapshot-fenced global review, native execution events, numeric accounting and natural-time replay coexist with delegated progress leases, artifact acceptance, immutable handoffs and the optional scheduler. These are separate facts: a semantic branch is not a worker lease, a process returning is not a reviewed result, and artifact acceptance is not independent correctness.

Scheduler inputs include semantic branches, native runs and globalReview with its immutable snapshot. Owner phases can explicitly acknowledge that snapshot via review:{snapshot,summary}; worker phases cannot. Findings saved after that snapshot remain pending. Stale source facts still require re-investigation. Scheduler startup reviews saved feedback and semantic work rather than guessing difficulty. Native phase usage is attributed with a hashed invocation receipt; repeated receipt processing cannot duplicate totals.

The competition profile, delivery/confirm operations and fixed incident report fields remain retired. Reports use summary and generated citations; domain-specific structure belongs in the task's artifacts or verifier. Historical evaluation documents preserve their frozen versions and do not measure this integrated release.
