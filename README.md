# Cairn

English | [简体中文](README.zh-CN.md)

**Goals, evidence and recoverable progress inside Pi, Claude Code and Codex.**

Cairn 2.1 gives the model five operations: **start, resume, read, checkpoint and finish**. Use normal host tools, then save a meaningful finding together with its evidence and goal coverage. A small task can finish in one call after the work; the core maintains claim links and report citations.

Your CLI owns the model, account, sessions, tool approvals and concurrency. Cairn preserves an external goal and evidence ledger in SQLite, with an optional blue-and-white progress dashboard.

## Quick start

Requires **Node.js 24 or newer**. Install the global command from this repository:

```sh
# Run once from the Cairn repository root.
npm install
npm run install:global
cairn --version
```

The helper builds Cairn, packs it and installs an independent global copy from this repository. This flow does not publish a package to the npm registry. You can then run `cairn` from any project directory; keep the working directory set to the project whose tasks you want to use.

If your npm global directory needs elevated permissions, choose a writable prefix:

```sh
npm run install:global -- --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
cairn --version
```

The helper also accepts `--cache DIR` and `--offline`; offline installation needs the repository dependencies already available.

In the project you want to work on, install the adapter for your configured host CLI:

```sh
cd /path/to/your-project

# Choose your host; default scope is the current project.
cairn install --target pi
cairn install --target claude
cairn install --target codex
cairn ui
```

Start a new host session. In Codex, trust the project and review Cairn hooks with `/hooks`. Ask:

> Use Cairn to investigate this timeout. Start with the most useful query, keep supporting evidence and counterevidence, and save progress at meaningful milestones. Finish with the impact, cause and solution, or suspend with the remaining gaps.

Only enabled tasks receive Cairn processing. Add `--scope user` for personal installation across projects or `--root DIR` for an explicit installation root.

## Run the complete example

```sh
cairn demo
```

This creates an isolated temporary workspace, starts the blue-and-white dashboard and runs a deterministic price-incident diagnosis over real stdio MCP calls. Watch evidence arrive, a checkpoint preserve findings and open questions, the task suspend, a new session take over, and the final impact evidence complete the goal. The dashboard stays in the foreground after completion; use Ctrl+C to close it. It uses local fixture data and a scripted driver, with no external model or account.

```sh
# Let the OS select a free dashboard port.
cairn demo --port 0

# Run quickly without the dashboard; print the result and artifact paths as JSON.
cairn demo --no-ui --delay 0 --json
```

To let a real agent perform the diagnosis instead, prepare a new sample workspace and its host adapter:

```sh
unset CAIRN_WORKSPACE
cairn demo --prepare --target codex --root ./cairn-example
cd cairn-example
export CAIRN_DB="$PWD/.cairn/state.db"
codex
```

Ask it to read `PROMPT.md` and follow the goal. Use `--target pi` or `--target claude` for the other hosts. Preparation does not launch a model; your CLI supplies its model, account and approvals. In a second terminal, enter that workspace and run `cairn ui --db "$PWD/.cairn/state.db" --port 0` to watch it. Set `CAIRN_DB` only in the sample shell: it pins the sample database even when the directory is inside another Git repository. Use a new terminal for other projects, or run `unset CAIRN_DB` after the sample. An explicitly chosen nonempty directory is rejected rather than overwritten.

The full [Chinese walkthrough](docs/examples/price-incident.zh-CN.md) explains inputs, tool results, evidence links, recovery and exported `report.md`, `evidence.html`, `task.json` and `execution.jsonl`.

## The model workflow

### Start → normal tool → finish

On Claude/Codex MCP, supply the actual startup-hook `session_id` once when starting or resuming a connection. Pi binds the native session automatically; omit that field. Subsequent calls use the binding and need no task/session arguments.

**`cairn_start`** — criteria default to the goal:

```json
{"session_id":"HOST_SESSION_ID_FROM_STARTUP","goal":"Confirm the project name in package.json"}
```

Read `package.json` using the host's native tool. The adapter automatically captures the result and provides an evidence alias such as **E1**. Use the alias actually returned for this task.

**`cairn_finish`** — save, generate citations and validate completion together:

```json
{
  "summary": "The project name is cairn.",
  "findings": [{"text":"package.json declares name=cairn.","evidence":["E1"]}]
}
```

A new supported finding covers the sole criterion automatically. Multiple criteria use `covers: ["c1", "c2"]`. Valid completion returns `status: "completed"`; missing evidence keeps the task active with `phase: "incomplete"` and validation gaps.

For longer work, **`cairn_checkpoint`** takes the same content plus unresolved `questions` and a `next` action. Findings can include readable `key` values for later revisions, `evidence` for support, `against` for counterevidence and an explicit status. Evidence aliases, immutable observation IDs and unambiguous genuine `result_ref` values are accepted. For new findings without a status, support/counterevidence determines supported, refuted, inconclusive or proposed. Revisions preserve the previous status; new counterevidence may downgrade it, and an uncertain finding requires an explicit supported declaration to upgrade. A supported finding cannot retain unresolved counterevidence.

| Fixed tool | Purpose |
| --- | --- |
| `cairn_start` | Start a goal, criteria, constraints and budget |
| `cairn_resume` | Restore and bind a task; explicitly take over another session's work |
| `cairn_read` | Read context, original evidence, paginated history or saved tasks |
| `cairn_checkpoint` | Save findings, counterevidence, criterion coverage and next steps atomically |
| `cairn_finish` | Save and validate completion, or suspend incomplete work |

No separate claim/satisfy/report calls are needed. The old 16-tool protocol is no longer a public compatibility interface. An explicit whitelist adds typed `cairn_tool_*` operations.

## Host integration and degraded capabilities

| Host | Integration | Identity and recovery |
| --- | --- | --- |
| Pi | Self-contained native package, extension and skill | Native identity binding, tool-result evidence and context before turns |
| Claude Code | Local marketplace plugin with skills, hooks and stdio MCP | Startup session ID on the first start/resume; binding lasts for the connection |
| Codex | Project/user hooks, MCP and skill; a marketplace package is also built | Same binding; native scoped configuration and trusted hooks |

Packages live under `dist/plugins/{pi,claude,codex}` and include their own runtime. Codex project installation uses direct scoped registration rather than global plugin-cache activation.

Other clients can run the shared stdio server and load `skills/cairn`:

```sh
cairn mcp --host mcp --session-id my-task-session
cairn doctor --target codex
```

MCP alone cannot capture arbitrary native host tools. Configured `cairn_tool_*` calls still capture real results through the gateway. There is no model-callable manual observation registration in the new interface. Historical manual observations retain their provenance.

`doctor` separates declared adapter capabilities from actually observed lifecycle events and checks installation, versions, MCP and upstream availability. Configuration files or a startup observation do not prove complete tool coverage. Codex hosted tools and specialized paths may bypass local hooks. Missing hooks reduce native capture/recovery; strict emergency tasks reject missing required native integration and use controlled gateway tools.

## Pause and recover

Suspend with **`cairn_finish`**:

```json
{"outcome":"suspended","summary":"Connection exhaustion identified; awaiting stack samples.","questions":["Which path retains connections?"],"next":"Inspect occupancy stacks."}
```

Resume from another CLI with **`cairn_resume`**:

```json
{"session_id":"NEW_HOST_SESSION_ID_FROM_STARTUP","task_id":"TASK_ID","takeover":true}
```

Takeover increments the execution epoch. Old sessions cannot complete the task; late results remain audit-only. Reconnecting MCP in the same native session still requires binding once, without takeover if ownership is unchanged. Native chat history stays with the host.

Recovery context is bounded to **16 KiB**, with totals and explicit truncation indicators; persisted records remain complete. Use `cairn_read` with `{"view":"evidence","ref":"E3"}` for original data. Evidence indexes and history use record pagination. Full task metadata is available through `view: "details"`; individual audit payloads use `view: "history", ref: "event:123"`. Large records use character offsets and chunks. Include the returned revision while paging details to detect concurrent changes. User interruption is authoritative, suspended work has no continuation prompts, and completion hints are bounded.

## Blue-and-white progress dashboard

```sh
cairn ui
cairn ui --port 8001 --db .cairn/state.db
```

Open the printed loopback URL, default `http://127.0.0.1:8000`. The original web layout is retained: task cards, graph canvas and Details / Hints / Log panels. Live updates show evidence-backed criterion coverage, calls and budget; select evidence to load raw results. Horizontal/vertical layouts, pan/zoom, fullscreen, resizable details, reports and snapshots are available. Checkpoint summaries, unresolved questions and next steps are persisted with each task.

The dashboard is read-only and loopback-only. Keep working in your CLI. Closing it does not stop the agent. Use the same database/workspace as the host. Progress reflects supported criteria and can decrease after refutation.

```sh
cairn task list
cairn task show TASK_ID
cairn export TASK_ID --format json --out task.json
cairn export TASK_ID --format markdown --out report.md
cairn export TASK_ID --format html --out evidence.html
```

Replace `TASK_ID` with an actual ID. The HTML export is a standalone evidence graph with expandable original results.

## Typed tools and emergency profile

```sh
cairn configure --file profiles/emergency.example.json
```

The example is an **unconfigured template**. Replace commands, upstream names and result/scope/receipt mappings with the organizer's official definitions before use.

The explicit whitelist exposes each upstream schema directly as `cairn_tool_<name>`, without a generic tool/arguments wrapper. Configuration names contain 1–53 letters, digits, underscores or hyphens, keeping the prefixed name within 64 characters. The gateway supports stdio and Streamable HTTP, reuses connections/catalogs, records original results and enforces budgets. Cancellation/timeouts affect the request while other requests on a healthy shared transport continue. External submissions are never automatically retried.

The `emergency` profile requires native integration, a whitelist and team/round/issue/match scope. All rounds share one persistent **30-minute match deadline**, with the final 30 seconds reserved by default for submission/receipt checks. Reports need impact scope evidence, root cause/causal level, real current-round `result_ref` citations and mitigation/fix/prevention. Add competition fields through `report.impact`, `report.rootCause` and `report.solution` in checkpoint/finish. Human hints and manual observations cannot supply competition evidence.

A validated finish returns `phase: "ready_for_delivery"` and stays active. Call the configured typed submit tool; the gateway injects the saved report at `reportPath` and hides that injected input from the model schema. Set `reportFormat: "markdown"` when needed. Missing receipts require an allowed receipt query; a successful real receipt automatically reconciles an existing submission attempt. There is no blind resubmission.

Finish returns `phase: "awaiting_confirmation"` until the team confirms outside model tools:

```sh
cairn confirm TASK_ID
```

Then call `cairn_finish {}` to complete. The organizer remains authoritative for reference ownership and scoring.

## Core ideas and bootstrap

The ledger retains goals, immutable observations, revisable conclusions, checkpoints and attributed human hints. SQLite commits state and audit events atomically. Structural reference checks do not establish causal truth; the agent must inspect relevance and counterevidence, with diagnostic quality assessed separately on labelled tasks.

The original bootstrap's direct first attempt remains in the ongoing host session. Establish the goal and constraints, take a useful action, then adapt. Simple tasks can finish directly. There is no separate bootstrap worker, keepalive prompting, model pool, polling dispatcher or fixed reason/explore handoff.

## Update, data and uninstall

```sh
# Run in the Cairn repository to update the global command.
npm install
npm run install:global

# Run in the original target project to update its adapter.
cd /path/to/your-project
cairn update --target pi
cairn update --target claude
cairn update --target codex
cairn uninstall --target pi
```

Global command installation and host adapter installation are separate: updating the global command does not replace copies already installed in hosts. Use the original scope/root and restart the host session. The installer merges settings and tracks its entries. Modified registrations are reported and retained during uninstall, together with their runtime. Task data stays independent. After removing the host adapters you no longer need, `npm uninstall --global cairn` removes the global command; include the same `--prefix DIR` if you used a custom prefix.

Data defaults to `<workspace>/.cairn/state.db`; `CAIRN_DB` or `--db` overrides it, and `CAIRN_WORKSPACE` selects a workspace root. Existing **TypeScript 1.x SQLite tasks are preserved and resumable**, including saved reports. The old public tool protocol is replaced. The earlier Python server/dispatcher APIs and database formats are not automatically migrated. Keep raw task data private and out of Git.

## Development and verification

```sh
npm test                     # Typecheck, build and deterministic tests; no live models
npm pack --dry-run
node scripts/host-smoke.mjs pi
node scripts/host-smoke.mjs claude
node scripts/host-smoke.mjs codex
node scripts/pi-fixture-smoke.mjs
node scripts/claude-fixture-smoke.mjs
```

Current verification: **89 tests passed on Node 24/26**, including offline global installation, operation outside the checkout, the complete MCP example and process cleanup. The 2.0 baseline remains 79 tests; a configured live-model Codex lifecycle passed, and actual Pi/Claude CLIs passed local protocol lifecycles. Pi live inference was limited by upstream 429/503 errors; Claude live inference was blocked by expired OAuth. See [verification](docs/verification.md).

Real-host tests use configured accounts and may consume quota. Logs remain in the printed temporary directory. Temporary hook trust in tests does not replace normal installation review. Pi and Claude protocol fixtures use local servers instead of external models.

See [architecture](docs/architecture.md), [verification](docs/verification.md), and labelled cases/rubrics under [evaluations](evaluations/README.md). Historical protocol checks and current verification are reported separately; infrastructure tests do not demonstrate improved diagnostic accuracy or lower task latency.

## Background and license

Cairn originated as a goal-directed exploration engine, validated in the Tencent Cloud AI penetration testing challenge. This version carries its goal, evidence and human-hint ideas into reusable CLI plugins.

Licensed under [AGPL-3.0](LICENSE).
