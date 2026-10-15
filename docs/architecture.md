# Cairn 2.0 plugin architecture

Cairn provides goals, evidence and recoverable progress inside existing CLIs. The host owns models, accounts, sessions, permissions, tool execution and concurrency. Cairn has no model worker pool, keepalive prompt, polling dispatcher or model API credentials.

## Model interface: five operations

`ToolRuntime` supplies the same implementation to Pi native tools and stdio MCP:

| Operation | Behavior |
| --- | --- |
| `cairn_start` | Create a goal; criteria default to the goal when omitted |
| `cairn_resume` | Bind an existing task; require explicit takeover to change owners |
| `cairn_read` | Read bounded context, original evidence, evidence indexes, history or tasks |
| `cairn_checkpoint` | Atomically save findings, counterevidence, coverage, unresolved questions and next action |
| `cairn_finish` | Save the same milestone content and finish, or suspend with progress |

The earlier 16-tool interface is replaced. Internal domain methods remain useful to the core, tests and compatibility with persisted task records; they are not separate model-facing tools. There is no new public manual-observation tool.

A normal small task uses start → native tool(s) → finish. A longer task inserts checkpoints only at useful milestones. Findings contain supporting `evidence`, refuting `against`, optional status and criterion `covers`. Readable `key` values identify intentional revisions; omitted status preserves an existing finding, counterevidence can downgrade it, and upgrades require an explicit declaration; exact unkeyed retries reuse an existing equivalent conclusion. New supported findings cover the sole criterion automatically. Multiple criteria use explicit c# identifiers or unambiguous criterion text.

The core derives report citations from supported conclusions covering criteria, retaining original `result_ref` values. Checkpoints can supplement emergency impact/root-cause/solution fields. A finding with unresolved counterevidence cannot be supported. Proof changes invalidate any existing confirmation; delivered proof/report content is frozen rather than silently rewritten.

Finish returns a validation result and a phase. Missing completion conditions retain `status: active` and `phase: incomplete`. General tasks with valid evidence complete. Emergency tasks progress through `ready_for_delivery` and `awaiting_confirmation`, remaining active until a real delivery and human team confirmation exist. `outcome: suspended` saves incomplete work and suppresses continuation hints. Repeating a completed finish without new content returns the recorded status.

## Identity and task binding

One `ToolRuntime` belongs to one native session or one MCP connection and owns its gateway lifecycle. Pi resolves identity from the actual invocation context. Claude/Codex startup hooks inject the real host session ID. A new MCP connection supplies it only on its first start/resume, then subsequent calls use the connection binding. Standalone clients can set `--session-id` when launching MCP.

No session is selected from recent activity or guessed from a database row. A task/session identity change must be explicit. Read-only inspection can address another task; editing requires the active bound owner. Hooks continue to identify native calls from the host's true event identity.

A task has a host-session owner and execution epoch. Explicit takeover increments the epoch and settles the previous owner's in-flight bookkeeping. Old sessions cannot mutate goal state or finish the task. Late observations are retained for audit and are ineligible as evidence. Suspended tasks can be resumed; completed tasks are immutable.

## Persistent records and compact restoration

`Engine` operates on goals, observations, claims, actions, human hints and checkpoints. `Store` commits the current projection and an append-only event atomically with SQLite `BEGIN IMMEDIATE`. WAL and a busy timeout support concurrent native hooks, MCP and dashboard processes. Original observations include raw input/output, source, scope, host, session and epoch. Claim revisions remain in the event ledger.

Evidence aliases **E1, E2, …** refer to append-only positions within a task. They remain stable after compaction and cross-host recovery. References can also be immutable observation IDs or unambiguous real platform references; cross-task, missing and ambiguous references are rejected. Raw evidence remains separate from model interpretations and human hints.

`Engine.context` returns a bounded recovery projection, within 16 KiB, with the goal, relevant/recent findings, evidence pointers, criterion gaps, latest checkpoint, questions, next step, owner and budget. Totals and truncation indicators distinguish omitted history from missing records. The full canonical task stays in SQLite. `cairn_read` retrieves evidence by alias, ID or result reference, paginates indexes/history and chunks large evidence by character offsets. Full metadata can be paged with `view: "details"` and individual immutable audit payloads with `view: "history", ref: "event:SEQ"`. Details pages support a revision check against concurrent writes. The UI and exports also provide full snapshots/reports.

This projection is additive to the TypeScript 1.x task shape. Existing SQLite tasks and saved reports are retained and can be resumed. The older Python database format has no automatic migration. Replacing the public tool protocol does not erase task history.

## Native adapters

Pi uses a native extension with tool-call, tool-result, before-start, compaction, settlement and shutdown events. Claude Code uses a local marketplace plugin containing skills, command hooks and stdio MCP. Codex uses native project/user hooks, MCP configuration and skill registration, while also building a marketplace package. Each bundle includes its runtime and does not depend on the source checkout after installation.

Only enabled tasks receive task processing. PreToolUse reserves budgets; PostToolUse captures the raw result and provides its E# alias to the agent. Core tools and typed `cairn_tool_*` calls in Cairn's actual host namespace are excluded to avoid recursive/double capture. A similarly named tool in another server namespace is not automatically exempt.

Pi restores compact context before turns and after compaction. Claude/Codex use startup/resume context and explicit read on a bound connection; a restarted MCP connection must bind with resume. User interruption wins over completion hints. Stop hooks may offer at most two bounded suggestions, without repeating one for an unchanged revision; core completion checks remain authoritative.

Native events have different coverage and failure semantics. Codex hosted tools may bypass local hooks. An adapter's declared capabilities describe implemented integration points; observed events show what has actually run. `doctor` reports both, together with installation, version, startup observation, MCP and upstream probes. A file's existence or a successful startup hook does not prove every tool path is captured. Missing native integration degrades capture/recovery; strict emergency start/resume rejects missing required capabilities.

## Typed upstream gateway

`cairn configure --file FILE` stores an explicit whitelist in the local database. Configuration is a local user operation, not a model tool. Each entry maps a safe public name to a server, upstream name, result-reference path, scope paths and role:

- `read`: diagnostic query.
- `submit`: requires `reportPath` and `receiptPath`; the gateway injects the saved validated JSON or Markdown report.
- `receipt`: query that can reconcile a previous ambiguous submission using a real mapped receipt.

`Gateway.list` retains original upstream JSON Schemas, descriptions and constraints. `ToolRuntime` exposes each entry as `cairn_tool_<name>` with those arguments directly, validates them and records a real gateway observation. The public submit schema removes the injected report field and its required entry through explicit object properties, preserving other caller arguments. It does not broadly rewrite references, alternatives or unrelated schema constraints.

Configuration names contain 1–53 ASCII letters, digits, underscores or hyphens, yielding tool names of at most 64 characters. Duplicate names and prototype keys are rejected. Dotted mapping paths reject empty/prototype segments, `valueAt` reads only own properties, and scope mapping keys are limited to supported scope fields. Data comes from `structuredContent` or JSON in the first text result; non-JSON responses remain original observations. Credentials in server environment/header settings are not returned in the catalogue.

A gateway instance reuses a client and cached paginated catalogue per server. Concurrent connection/catalog requests share promises. Close is idempotent and waits for in-flight connection cleanup. Changed server configuration creates a new client. Connection closure or a definite framing/protocol fault evicts the client; request cancellation, timeout and ordinary RPC business errors leave healthy shared transports available to other requests. Calls, especially external writes, are not automatically retried.

Before execution, the core atomically reserves call/parallel budgets and checks the deadline. Cancellation signals propagate to the individual MCP request. Scope extraction failures retain raw upstream results as error observations. A successful submission with a missing receipt remains an immutable successful raw observation, while the gateway returns an ambiguous-submission error. A subsequent submit is blocked; a successful configured receipt query can automatically record delivery only when a prior configured submission attempt exists. Receipt inspection without a submission cannot manufacture delivery.

Submission freezes report and evidence changes while in flight. Core submit/delivery/finish entry points enforce required validation independently of hooks. The gateway controls its own calls; other host tools remain subject to the host sandbox and approvals. In the emergency profile, native tool hooks direct investigation/submission through typed gateway tools.

## Blue-and-white progress UI

`cairn ui` starts an optional, read-only loopback HTTP server against the shared database. Server-side events detect committed audit-sequence changes from other processes. The browser refreshes compact projections after invalidation; raw evidence loads on selection. Dashboard traffic creates neither model requests nor audit events.

The original blue-and-white layout has task cards, a graph canvas and Details/Hints/Log sidebar. It shows goal coverage, calls, budgets, reports and stored checkpoint context, with graph layouts, pan/zoom, fullscreen, resizable details and exports. Coverage uses the core's completion checks and can decrease when evidence is refuted. Phase labels describe committed state and do not impose a new execution workflow.

There are no browser mutation endpoints. Host/origin checks, no CORS permission and a nonce CSP protect local evidence from cross-site access. Closing the optional web process does not stop the host. Bootstrap remains the shared skill's direct first attempt inside the main session.

## Emergency profile

The profile requires native integration, a configured whitelist and team/round/issue/match scope. One stored 30-minute match deadline spans all rounds and survives task recreation or host restart, with a default final 30-second submission reserve. Reports require impact scope evidence, root cause/causal level, actual result references and mitigation/fix/prevention. Manual observations and human hints are ineligible competition evidence.

Validated finish remains active as `ready_for_delivery`. A configured typed submission injects the saved report and records/reconciles the real receipt. `cairn confirm TASK_ID` records team confirmation outside model tools; the next finish can complete. These invariants survive missing hooks and do not depend on a Stop hook's behavior.

The organizer's official tool names and exact scope/result/receipt mappings remain required integration inputs. The example profile is an unconfigured template. Local reference checks establish structural integrity and scope, not causal truth or the organizer's authoritative result ownership/scoring.
