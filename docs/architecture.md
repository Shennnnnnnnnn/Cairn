# Cairn 3.0 plugin architecture

Cairn preserves goals, curated evidence and recoverable progress inside existing CLIs. The host owns models, accounts, sessions, permissions, tools and concurrency. Cairn has no model worker pool, keepalive prompt, polling dispatcher or model API credentials.

## Model interface: five operations

`ToolRuntime` supplies the same domain interface to Pi native tools and stdio MCP:

| Operation | Behavior |
| --- | --- |
| `cairn_start` | Create a goal, criteria, initial constraints and optional progress; general tasks default to curated evidence |
| `cairn_resume` | Bind an existing task; require explicit takeover to change owners |
| `cairn_read` | Read bounded context, findings/references, optional captured observations, full details, history or tasks |
| `cairn_checkpoint` | Atomically save findings, progress, coverage, questions and next action |
| `cairn_finish` | Save milestone content and validate completion, or suspend with gaps |

The model does not separately maintain claim IDs, criterion links and report citations. A small task uses start → host tools → finish. Longer tasks add checkpoints at useful milestones. Initial tool guidance is goal/constraint input, rather than a framework-specific tool registry requirement.

Finding `key` values identify intentional revisions. `covers` associates supported findings with c# criteria; a new supported finding covers the sole criterion automatically. Finding statuses are `proposed`, `supported`, `refuted` and `inconclusive`. Work progress is separate: `{key,title,status,detail?}` uses `pending`, `running`, `completed`, `blocked` and `cancelled`. Updating a work item does not prove its corresponding goal condition.

Checkpoint `summary` describes current progress without replacing an existing report summary. An explicit finish `summary` or `report.summary` supplies the final report summary. The core regenerates the report's reference links from the saved findings. Missing conditions keep `status: active` and return `phase: incomplete`. A stopped attempt or expired budget is never completion.

## Two evidence modes

### Curated: the public general default

`cairn_start` defaults to `evidence_mode: "curated"` for the general profile. No gateway or tool whitelist is necessary. Native host tools remain freely selectable under the host's own permissions.

Curated findings store:

- `basis`: the agent's concise explanation of what supports or refutes the conclusion.
- `references`: file paths, URLs or other useful source pointers selected by the agent.
- Conclusion state, readable key and criterion coverage.

Supported findings need a recorded basis or references. The core validates their structure, recorded state and report/criterion relationships. It does not resolve file/link content, attest that a cited file was read, or establish causal correctness. References remain explicitly agent-curated. A model declaration of `supported` is not independent verification.

No `tool.started`, raw observation or tool-call metadata is stored for curated host tools. Pre/post hooks do not reserve a quota, block native tools, retain inputs/results or create E# aliases. Curated progress comes from explicit milestones, not uncorrelated host plan events. Goal/checkpoint/resume/finish events still form a persistent task history.

### Captured: explicit raw evidence

New general tasks opt in with `evidence_mode: "captured"`; emergency tasks require captured evidence. Existing tasks without an `evidenceMode` field retain captured semantics. Starting a new public task with a different default does not convert old records.

An `Observation` is an original tool result record, not an agent role. It includes original input/output, source, scope, actor host/session/epoch, time, result status and eligibility. Append-only E1/E2 aliases refer to its positions in a task. Immutable IDs and unambiguous genuine platform `result_ref` values are also accepted. Missing, ambiguous, cross-task, failed or late references cannot support completion.

Findings use `evidence` and `against` to link supporting and refuting observations. Original records stay separate from interpretations and human hints. A finding with unresolved captured counterevidence cannot be supported. Changes to goal proof invalidate confirmation; delivered report/proof content remains frozen. Historical manual observations retain their source and do not become automatic capture.

Captured validation establishes structural integrity, task/scope membership and eligibility. The agent must still review relevance and contradictions; diagnostic truth needs evaluation against labelled cases.

## Budget policy

Curated tasks have no default `maxCalls` or `maxParallel`. Supplying them is rejected, because unrecorded calls cannot be counted or limited reliably. A curated `budget.deadline` is advisory; passing it does not prevent a checkpoint, further native work or a valid finish. Host model limits, approvals and concurrency remain host responsibilities.

Captured calls reserve configured count/parallel limits atomically, and apply deadlines to gateway requests and native tool paths actually covered by hooks. The historical captured concurrency default remains three when unspecified. This is not a universal quota over arbitrary host paths. Hooks can be missing, and hosted tools may not invoke local hooks.

The emergency profile adds its shared 30-minute match deadline and default final 30-second submission reserve. Exhausting any budget leaves an incomplete goal; suspend with a gap report if further work must stop. A six-call fixture budget is sample configuration, not a general success threshold.

## Identity, subagents and ownership

One `ToolRuntime` belongs to one native session or MCP connection and owns its gateway lifecycle. Pi obtains identity from the actual invocation context. Claude/Codex startup hooks provide the true native session ID; a connection supplies it on its first start/resume and then uses its binding. Standalone MCP can use `--session-id`.

No identity is guessed from recent activity or a database row. Read-only inspection can address another task; editing requires the active bound owner, matching cwd and execution epoch. A new child-agent context is not automatically bound to its parent's goal.

Subagents can conduct independent checks or work in fresh context using the host's native mechanism. The primary owner reviews the results and saves the canonical checkpoint. Another durable native session can become the owner only through explicit resume/takeover. A child context is not a portable substitute for a new native session, its lifecycle hooks or task fencing.

Takeover increments the epoch and settles the previous owner's in-flight bookkeeping. Old owners cannot mutate or finish the task. In captured mode late observations remain audit-only. Suspension turns running progress items into blocked work, retains their meaning and suppresses continuation prompts. Resumption does not assume a previously running process is still alive. Completed tasks are immutable; repeating a content-free finish returns their recorded result.

## Persistence and compact restoration

`Engine` operates on goals, findings, optional observations, work progress, human hints and checkpoints. `Store` commits a projection and an append-only event atomically using SQLite `BEGIN IMMEDIATE`. WAL and a busy timeout support hooks, MCP and dashboard processes sharing the database. Claim revisions and task milestones remain in the event ledger.

`Engine.context` returns at most 16 KiB with goal, constraints, relevant/recent findings, basis/reference pointers, progress, criterion gaps, latest checkpoint, open questions, next step, owner and budget policy. Totals and truncation indicators distinguish omitted history from absent information. It contains neither private reasoning nor a full host transcript.

`cairn_read` retrieves a curated finding by key/ID or a captured observation by alias/ID/result reference. Indexes and history use record pagination. Full task metadata uses `view: "details"`; large records and immutable event payloads use character offsets. Details pages can require a matching revision; individual audit payloads use `view: "history", ref: "event:SEQ"`. UI/export projections retain access to full persisted records.

Existing TypeScript SQLite tasks and reports remain available with their original mode. Older Python formats have no automatic migration. Replacing the public workflow does not erase task history.

## Native adapters

Pi uses a native extension for session, tool, compaction, settlement and shutdown events. Claude uses a local marketplace plugin with skills, hooks and stdio MCP. Codex installs project/user hooks, MCP and a skill, while a marketplace package is also built. Each bundle contains its runtime.

Lifecycle processing remains available to enabled tasks in both modes: startup context, compaction restoration, interruption and bounded Stop checks. Pi injects context after a meaningful state revision or compaction rather than repeating an unchanged projection on every turn. Claude/Codex use startup/resume context and explicit read on bound connections. A restarted MCP connection binds again with resume.

Native plan integration is conditional and captured-only. A successful Codex `update_plan` result can supply semantic progress only if a previous captured PreToolUse reservation associates its call ID with the current task and owner epoch, and its observation is eligible. The progress event contains only known `plan[{step,status}]` fields; the captured observation retains its normal provenance separately. Missing, stale or cross-task associations do not update progress. Curated hooks skip native plan results entirely: without call association, a result delayed across same-session goal changes cannot be safely attributed. No call metadata is added to curated mode for this purpose. Arbitrary similarly named MCP tools are not interpreted as plans. Claude/Pi have no guaranteed native-plan mapping; `checkpoint.progress` is the reliable shared path for all three hosts.

In curated mode all other native pre/post tool events remain unrecorded and unblocked by Cairn. In captured mode PreToolUse reserves budgets and PostToolUse records results. Actual Cairn namespaces are excluded from recursive capture; similarly named tools on another server are not exempt.

User interruption takes priority. Stop hints are bounded and do not replace core finish/submit validation. Declared capabilities describe adapter implementation; observed lifecycle events show what actually ran. `doctor` reports both with installation/version/MCP/upstream status. An installed hook does not prove complete tool coverage. Missing hooks degrade automatic restoration or captured evidence; explicit curated management remains available. Emergency start/resume rejects missing required integration.

## Optional typed upstream gateway

`cairn configure --file FILE` stores optional local upstream configuration. The five goal tools work without it. Each configured tool maps a safe public name to a server, original upstream name, role and optional result/scope/receipt paths:

- `read`: an optional read tool; curated tasks can use it without storing calls/results.
- `submit`: captured-only validated delivery, requiring report and receipt mappings.
- `receipt`: captured-only query to reconcile a prior ambiguous submission.

`Gateway.list` preserves upstream JSON Schemas, descriptions and constraints; `ToolRuntime` exposes `cairn_tool_<name>` with original arguments and validates them. The injected report field is removed from the public submit schema without broadly rewriting alternatives or references. Names are restricted to 1–53 ASCII letters/digits/underscores/hyphens; unsafe mapping keys, prototype paths and duplicate names are rejected. Configuration credentials are not returned in the tool catalog.

`Gateway.callUnrecorded` requires an active curated general owner and a read role. It checks ownership before connecting and again before dispatch, propagates cancellation and creates no Cairn call/observation records on success or failure. Its request timeout is transport protection, not a whole-goal deadline. It does not constrain native tools. Submit/receipt cannot use this route to bypass delivery checks.

`Gateway.call` retains the captured path: atomically reserve limits, execute, extract scope/reference/receipt and append original results. Scope extraction failure retains the raw result as an error observation. Successful submission without a receipt remains immutable captured evidence and returns an ambiguity error; another submit is blocked until a configured receipt query reconciles the previous attempt. A receipt query without a submission cannot manufacture delivery. In-flight submissions freeze report/proof changes.

One gateway reuses a client and cached paginated catalog per server. Concurrent requests share connection promises. Close is idempotent and awaits pending connection cleanup. Configuration changes replace clients. Transport/protocol faults evict connections; per-request cancellation, timeout and ordinary RPC errors do not stop unrelated healthy requests. Calls, especially external writes, are never retried automatically.

## Blue-and-white progress UI

`cairn ui` starts an optional read-only loopback HTTP server against the shared database. SSE invalidates compact projections after a committed audit sequence changes. Dashboard traffic creates no model calls or task audit events.

The CLI can remember one UI database with `cairn ui --db FILE --remember`; `cairn ui --forget` clears that preference and exits. Selection is explicit `--db`, then `CAIRN_DB`, then the saved UI database, then the workspace database. The versioned preference is atomically saved under `userHome()/.cairn/ui.json` with private file permissions. This affects only the UI path; task/MCP/hook selection is unchanged. When no port is specified, the CLI tries port 8000 and falls back to a free port only on an address-in-use error. Explicit port failures remain visible. Failed startup does not replace a remembered preference.

The relationship graph is the default main view; there is no separate progress board. It includes starting context, authored work stages, evidence, conclusions, completion criteria and the goal. Teal origin and rose goal colors preserve roles; indigo completed/result nodes, amber running work and pale dashed pending work preserve the earlier UI's status semantics. Goal nodes retain their role color and display satisfaction separately. Labels supplement color. Work stages form an explicit branch from the starting context, without fabricated causal links to findings.

The graph displays stored, reported state, not live process liveness. `active` does not mean a process is running. Paused/stale work is not shown as executing; missing telemetry does not mean idle. Goal coverage comes from core validation and may decrease after revised findings. Raw observations are labelled as original evidence where present; curated conclusions display basis/references and agent provenance. The timeline emphasizes human-readable milestone summaries and expandable detail, with captured evidence events filterable separately. Phase labels describe persisted state, not a fixed execution pipeline.

The server has no browser mutation endpoints. Host/origin checks, no CORS permission and nonce CSP protect local data from cross-site access. Closing the UI does not stop the host. Bootstrap remains a direct useful first attempt in the ongoing host session, without a second model runtime.

## Emergency profile

Emergency requires captured evidence, native integration, an official configured tool gateway and team/round/issue/match scope. A stored 30-minute match deadline spans rounds and survives restarts or task recreation, with a default final 30-second submission reserve. Reports require impact scope evidence, root cause/causal level, genuine result references and mitigation/fix/prevention. Human hints and manual observations are ineligible evidence.

Validated finish remains active as `ready_for_delivery`. The typed submit injects the saved report and records/reconciles the real receipt. `cairn confirm TASK_ID` records human team confirmation outside model tools; a subsequent finish completes. Core entry points enforce these invariants independently of Stop hook behavior.

Official tool names and exact result/scope/receipt mappings remain organizer integration inputs. The example profile is an unconfigured template. Local checks do not replace the organizer's authoritative reference ownership and scoring.
