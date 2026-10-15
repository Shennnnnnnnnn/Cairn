# Cairn 4.5 plugin architecture

Cairn preserves goals, curated evidence and recoverable progress inside existing CLIs. The host owns models, accounts, sessions, permissions, tools and concurrency. Cairn has no model worker pool, keepalive prompt, polling dispatcher or model API credentials.

## Model interface: six operations

`ToolRuntime` supplies the same domain interface to Pi native tools and stdio MCP:

| Operation | Behavior |
| --- | --- |
| `cairn_start` | Create a goal, criteria, initial constraints and optional progress; general tasks default to curated evidence |
| `cairn_resume` | Bind an existing task; require explicit takeover to change owners |
| `cairn_read` | Read bounded context, findings/references, optional captured observations, full details, history or tasks |
| `cairn_update` | Immediately save one branch/progress/finding change, with a compact idempotent receipt |
| `cairn_checkpoint` | Save recovery summary, questions and next action |
| `cairn_finish` | Save milestone content and validate completion, or suspend with gaps |

The model does not separately maintain claim IDs, criterion links and report citations. A small task uses start → host tools → finish. Longer tasks add checkpoints at useful milestones. Initial tool guidance is goal/constraint input, rather than a framework-specific tool registry requirement.

Finding `key` values identify intentional revisions. `covers` associates supported findings with c# criteria; a new supported finding covers the sole criterion automatically. Finding statuses are `proposed`, `supported`, `refuted` and `inconclusive`. Work progress is separate: `{key,title,status,detail?}` uses `pending`, `running`, `completed`, `blocked` and `cancelled`. Updating a work item does not prove its corresponding goal condition.

Checkpoint `summary` describes current progress without replacing an existing report summary. An explicit finish `summary` or `report.summary` supplies the final report summary. The core regenerates the report's reference links from the saved findings. Missing conditions keep `status: active` and return `phase: incomplete`. A stopped attempt or expired budget is never completion.

## Two evidence modes

### Curated: the public general default

`cairn_start` defaults to `evidence_mode: "curated"` for new tasks. No gateway or tool whitelist is necessary. Native host tools remain freely selectable under the host's own permissions.

Curated findings store:

- `basis`: the agent's concise explanation of what supports or refutes the conclusion.
- `references`: file paths, URLs or other useful source pointers selected by the agent.
- Conclusion state, readable key and criterion coverage.

Supported findings need a recorded basis or references. The core validates their structure, recorded state and report/criterion relationships. It does not resolve file/link content, attest that a cited file was read, or establish causal correctness. References remain explicitly agent-curated. A model declaration of `supported` is not independent verification.

No `tool.started`, raw observation or tool-call metadata is stored for curated host tools. Pre/post hooks do not reserve a quota, block native tools, retain inputs/results or create E# aliases. Curated progress comes from explicit milestones, not uncorrelated host plan events. Goal/checkpoint/resume/finish events still form a persistent task history.

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

Subagents can conduct independent checks or work in fresh context using the host's native mechanism. The primary owner reviews the results and saves the canonical checkpoint. Another durable native session can become the owner only through explicit resume/takeover. A child context is not a portable substitute for a new native session, its lifecycle hooks or task fencing.

Takeover increments the epoch and settles the previous owner's in-flight bookkeeping. Old owners cannot mutate or finish the task. In captured mode late observations remain audit-only. Suspension turns running progress items into blocked work, retains their meaning and suppresses continuation prompts. Resumption does not assume a previously running process is still alive. Completed tasks are immutable; repeating a content-free finish returns their recorded result.

## Autonomous investigation branches

The shared skill and tool/context descriptions ask the current model to decide whether and how many host-native helpers are useful. This decision uses independent questions, evidence, coordination cost and host/user limits. There is no Cairn process that schedules model workers. Branches can also be investigated by the main session.

`Branch` persists a stable key, parent, question, executor/assignee, optional real agent ID, status, result/stopping summary, epoch and execution attempt. Checkpoints update branches atomically with findings and progress; each may point to a branch key. Parent cycles, foreign references and duplicate active agent bindings are rejected. Completed/cancelled branches require a summary. Pending, running, blocked or unreviewed branches keep completion incomplete, as do known current-epoch native helpers still running. Suspension can be saved immediately.

Codex/Claude bundles register SubagentStart/SubagentStop. New starts under an enabled, active parent goal immediately save minimal execution metadata and historical state without branch registration or agent reporting. Returns route to the observed run's original goal/owner epoch. Unassociated executions appear independently in the graph; an exact native ID can later associate them with semantic branches. Unknown stops and stale owner events cannot infer a new goal. Child-specific tool/Stop hooks cannot suspend the parent. A native return ends execution and does not accept findings; main-agent review remains a separate semantic transition. Pi and generic MCP explicitly report uncovered states. Doctor reports installed and actually observed coverage.

The graph projects saved branch membership and nesting, not inferred causal dependencies. It shows assignee and state and links reviewed findings/evidence to their branch. Replay uses the persisted states, including lifecycle changes. Unbranched existing tasks keep their earlier topology.

Official references: [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), [Codex hooks](https://learn.chatgpt.com/docs/hooks), [Claude hooks](https://code.claude.com/docs/en/hooks), [Pi extensions](https://pi.dev/docs/latest/extensions). Host capability and hook coverage still depend on the installed runtime.

## Persistence and compact restoration

`Engine` operates on goals, findings, optional observations, work progress, human hints and checkpoints. `Store` commits a projection and an append-only event atomically using SQLite `BEGIN IMMEDIATE`. WAL and a busy timeout support hooks, MCP and dashboard processes sharing the database. Each event also commits a historical domain-state frame in `task_history`, using a nested savepoint so direct Store writes remain atomic too. Frames omit raw observation IO and retain the evidence index. The read-only replay API projects these states using their event time, pages frame metadata at a fixed head, and scopes lookups to the requested task. The UI keeps historical playback separate from live SSE updates. Legacy databases import only known creation/current-head baselines and disclose missing intermediate frames; no model or tool is rerun to manufacture history. Claim revisions and task milestones remain in the event ledger.

`Engine.context` returns at most 16 KiB with goal, constraints, relevant/recent findings, basis/reference pointers, progress, criterion gaps, latest checkpoint, open questions, next step, owner and budget policy. Totals and truncation indicators distinguish omitted history from absent information. It contains neither private reasoning nor a full host transcript.

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

`cairn ui` starts an optional read-only loopback HTTP server against the shared database. SSE invalidates compact projections after a committed audit sequence changes. Dashboard traffic creates no model calls or task audit events.

The CLI can remember one UI database with `cairn ui --db FILE --remember`; `cairn ui --forget` clears that preference and exits. Selection is explicit `--db`, then `CAIRN_DB`, then the saved UI database, then the workspace database. The versioned preference is atomically saved under `userHome()/.cairn/ui.json` with private file permissions. This affects only the UI path; task/MCP/hook selection is unchanged. When no port is specified, the CLI tries port 8000 and falls back to a free port only on an address-in-use error. Explicit port failures remain visible. Failed startup does not replace a remembered preference.

The relationship graph is the default main view; there is no separate progress board. It includes starting context, authored work stages, evidence, conclusions, completion criteria and the goal. Teal origin and rose goal colors preserve roles; indigo completed/result nodes, amber running work and pale dashed pending work preserve the earlier UI's status semantics. Goal nodes retain their role color and display satisfaction separately. Labels supplement color. Work stages form an explicit branch from the starting context, without fabricated causal links to findings.

The graph displays stored, reported state, not live process liveness. `active` does not mean a process is running. Paused/stale work is not shown as executing; missing telemetry does not mean idle. Goal coverage comes from core validation and may decrease after revised findings. Raw observations are labelled as original evidence where present; curated conclusions display basis/references and agent provenance. The timeline emphasizes human-readable milestone summaries and expandable detail, with captured evidence events filterable separately. Phase labels describe persisted state, not a fixed execution pipeline.

The server has no browser mutation endpoints. Host/origin checks, no CORS permission and nonce CSP protect local data from cross-site access. Closing the UI does not stop the host. Bootstrap remains a direct useful first attempt in the ongoing host session, without a second model runtime.

## Immediate semantic updates and native execution records

`cairn_update` accepts exactly one branch, progress item or stable-key finding. It validates ownership and state, atomically appends an event and immutable history state, and returns a compact receipt. Unchanged retries append nothing. A delegated branch enters reviewing before the main agent examines its result; acceptance is a separate completed update. Checkpoint remains a recovery summary/import interface, not the ordinary transition reporting cadence.

Native SubagentStart associates a new execution with the active parent goal and owner at arrival, immediately saving agent.started plus its historical state, even without a semantic branch. SubagentStop routes to that exact previously observed execution/goal, including when the parent has paused and started another goal. Repeated starts/returns and stale owner epochs do not create new activity. Unknown stops cannot infer a goal. Native parent-session end or interruption automatically suspends unfinished work once; child-session end cannot suspend its parent. An already observed ID cannot attach to a fresh goal after ownership changes. Minimal IDs/type/status/timestamps are retained; tool calls, raw results, child messages and transcripts are not.

An unassociated run is shown as a native execution node connected to the parent context, never an invented investigation branch. Native execution counters are separate from semantic branch counters. Exact native ID association can merge it into a branch; routing aliases, matching names and counts are not treated as proof. Binding changes commit at association time and do not rewrite past frames. The main agent reports semantic states such as review start, accepted findings, blocked hypotheses and goal coverage. MCP-only hosts report uncovered states explicitly. Host execution lifecycle and semantic acceptance are deliberately independent.

The native event contract was checked against [official Codex hooks documentation](https://learn.chatgpt.com/docs/hooks). Host/plugin hooks still require their native trust flow in normal use. The isolated automated Codex exercise enables only reviewed Cairn hooks; it preserves the model workspace sandbox.
