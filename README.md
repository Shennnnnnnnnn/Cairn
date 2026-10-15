# Cairn

English | [简体中文](README.zh-CN.md)

**Goals, evidence and recoverable progress inside Pi, Claude Code and Codex.**

Cairn 4.0 gives the model five operations: **start, resume, read, checkpoint and finish**. General tasks use **curated evidence** by default: the agent works with any available host tools, then saves meaningful progress, conclusions, supporting explanations and file/link references. Cairn does not record those tool calls or their results.

Your CLI owns the model, account, sessions, tool approvals and concurrency. Cairn keeps the goal and its progress in SQLite, with an optional blue-and-white dashboard. No upstream gateway or tool whitelist is required for an ordinary task.

## Quick start

Requires **Node.js 24 or newer**. Run once from the Cairn repository root:

```sh
npm install
npm run install:global
cairn --version
```

The helper builds, packs and installs an independent global copy from the repository; it does not publish a package to npm. You can then run `cairn` from any project directory. If the npm global directory is not writable:

```sh
npm run install:global -- --prefix "$HOME/.local"
export PATH="$HOME/.local/bin:$PATH"
cairn --version
```

The helper accepts `--cache DIR` and `--offline`; offline installation requires the repository dependencies to be available.

Enter the project you want to work on and choose the adapter for your configured host CLI:

```sh
cd /path/to/your-project

# Choose the CLI you use. Default installation scope is this project.
cairn install --target pi
cairn install --target claude
cairn install --target codex
cairn ui
```

Start a new host session. In Codex, trust the project and review Cairn hooks with `/hooks`. Add `--scope user` for personal installation across projects or `--root DIR` for an explicit installation root.

Give the agent the goal and any tool guidance in your initial request:

> Use Cairn to diagnose this timeout. The available logs and metrics tools are described below; choose the useful queries yourself. Save conclusions with their supporting explanation and file/link references, plus what is running, done or blocked. Finish when the impact, cause and proposed fix satisfy the goal, or suspend with the remaining gaps. Tool-call recording is unnecessary.

Tool guidance is task input. Cairn does not hardcode which diagnostic, code or research tools the agent must use. The host still enforces its own permissions.

## The shortest model workflow

Generic `cairn mcp`, including Multica, binds a fresh connection identity automatically; omit `session_id`. Native Claude/Codex adapters supply the actual startup-hook `session_id` once on the first start/resume. Pi binds its native identity automatically. Subsequent calls use the connection binding.

**`cairn_start`:** omitted criteria default to the goal.

```json
{
  "session_id": "HOST_SESSION_ID_FROM_STARTUP",
  "goal": "Confirm the project name in package.json"
}
```

The agent reads `package.json` with its preferred host tool. Cairn creates no raw observation or E# alias in this default mode.

**`cairn_finish`:** save the conclusion and check completion together.

```json
{
  "summary": "The project name is cairn.",
  "findings": [{
    "key": "project-name",
    "text": "package.json declares name=cairn.",
    "status": "supported",
    "basis": "Read the name field in the project manifest.",
    "references": ["package.json"]
  }]
}
```

A new supported finding covers the sole criterion automatically. Multiple criteria use `covers: ["c1", "c2"]`. Missing supported findings or coverage keep the task active with `phase: "incomplete"`. The program checks the recorded structure and coverage; it does **not** open a file/link to verify its contents or establish causal truth.

Longer work uses `cairn_checkpoint` at milestones. Include stable finding `key` values, `basis`, `references`, unresolved `questions`, a `next` action and optional progress:

```json
{
  "summary": "The source is reviewed; the fix still needs a regression check.",
  "progress": [
    {"key":"source","title":"Review the source","status":"completed"},
    {"key":"regression","title":"Check the regression","status":"running"}
  ],
  "questions": ["Does the existing failure case now pass?"],
  "next": "Run the relevant regression test."
}
```

Progress statuses are `pending`, `running`, `completed`, `blocked` and `cancelled`. They describe reported work; they are separate from the goal's completion conditions. Checkpoint summaries describe the current milestone and do not overwrite an existing report summary. An explicit finish `summary` or `report.summary` sets the final report summary.

| Fixed tool | Purpose |
| --- | --- |
| `cairn_start` | Start a goal, criteria, initial constraints and optional progress |
| `cairn_resume` | Restore and bind a task; explicitly take over another session's work |
| `cairn_read` | Read context, curated findings/references, task details or paginated history |
| `cairn_checkpoint` | Save findings, progress, criterion coverage and open questions together |
| `cairn_finish` | Save and validate completion, or suspend incomplete work |

The [Chinese goal workflow guide](docs/goal-workflow.zh-CN.md) provides a complete example without tool configuration or call records.

## Goals and budgets

General curated tasks have **no default call or concurrency quota**. Omit `budget` for normal use. Host concurrency and model/account usage remain under the CLI's control.

- `budget.deadline` is an advisory time target for curated tasks. Passing it does not complete the goal or prevent further work.
- Curated mode rejects `maxCalls` and `maxParallel`: Cairn cannot enforce counts for calls it does not record.
- A stopped or budget-limited attempt remains incomplete. Save gaps and suspend when needed; tool count is never a completion criterion.
- Explicit `captured` tasks can enforce call/concurrency/deadline limits on Cairn gateway calls and native tool paths that actually invoke the hooks. This is not a global quota over every host tool path.

## Blue-and-white progress dashboard

```sh
cairn ui
cairn ui --port 8001 --db .cairn/state.db
```

For a fixed database, such as a Multica runtime, remember it once. Later `cairn ui` works from any directory:

```sh
cairn ui --db /path/to/multica/state.db --remember
cairn ui
cairn ui --forget  # clear the saved dashboard and exit
```

UI database precedence is `--db` → `CAIRN_DB` → saved dashboard → current workspace. The setting is UI-specific; MCP, hooks and task commands keep their existing parameter/environment selection. Preferences live in `.cairn/ui.json` under the user home, or under `CAIRN_CONFIG_HOME` when set.

Open the printed loopback URL. Without `--port`, Cairn tries `8000` and chooses a free port if occupied; explicit ports remain strict. The **relationship graph is the main view**; there is no separate progress board. It connects the starting context, recorded work, evidence, conclusions, completion criteria and goal. Teal marks the start, rose marks goals, indigo marks completed work/results, amber marks running work, and pale dashed nodes mark pending work. Labels distinguish role and status; goal nodes retain their role color when satisfied. Select a node for its details. Zoom, pan, fit, fullscreen and vertical/horizontal layouts remain available. The timeline highlights milestones with expandable details; captured tool events can be filtered separately.

![Blue-and-white relationship graph with synthetic demonstration data](docs/images/dashboard-graph.png)

The dashboard displays the most recently committed progress. An `active` task or a zero tool count does not prove that a process is currently alive. Curated tasks deliberately have no tool-call telemetry and use explicit checkpoint progress. Native plan results without a reliable original task association are skipped, so a delayed event cannot change another goal.

The dashboard is read-only and loopback-only. Closing it does not stop the agent. Use the same database/workspace as the host. Goal coverage can decrease if a supporting conclusion is revised or refuted.

```sh
cairn task list
cairn task show TASK_ID
cairn export TASK_ID --format json --out task.json
cairn export TASK_ID --format markdown --out report.md
cairn export TASK_ID --format html --out evidence.html
```

Replace `TASK_ID` with an actual ID. Exports preserve the task's selected evidence mode; a curated task contains the agent's explanations and references, rather than raw tool transcripts.

## Pause, recover and use subagents

Save a checkpoint, then suspend using `cairn_finish`:

```json
{"outcome":"suspended"}
```

Resume in a new session or another CLI using `cairn_resume`:

```json
{"session_id":"NEW_HOST_SESSION_ID_FROM_STARTUP","task_id":"TASK_ID","takeover":true}
```

Takeover increments the execution epoch. Old sessions cannot change or complete the task. Running progress items become blocked on suspension, and the resumed agent explicitly updates them as work continues. Native chat history stays with the host; Cairn restores the goal, findings, references, progress, open questions and next step.

Subagents are useful for independent checks or a fresh working context. The main agent remains responsible for reviewing their outputs and saving a goal checkpoint. A child context does not automatically acquire the main task's identity or write access. A durable handoff to another native session still uses the adapter's explicit resume/takeover flow. Cairn adds no worker pool or fixed reason/explore pipeline.

Recovery context is bounded to **16 KiB**, with totals and explicit truncation indicators. Persisted records remain complete. `cairn_read {"view":"evidence","ref":"project-name"}` reads a curated finding by key or ID; omit `ref` for the index. History uses record pagination, while large details and event payloads use character offsets. Use `view: "details"` and a returned `revision` to detect concurrent changes, or `view: "history", ref: "event:123"` for a specific audit event.

User interruption is authoritative, suspended work has no continuation prompts, and completion hints are bounded.

## Host integration and capability limits

| Host | Integration | Progress and recovery |
| --- | --- | --- |
| Pi | Self-contained native package, extension and skill | Native identity; changed checkpoints and compaction restore context; explicit checkpoint progress |
| Claude Code | Local marketplace plugin with skills, hooks and stdio MCP | Startup ID binds the first start/resume; explicit checkpoint progress |
| Codex | Project/user hooks, MCP and skill; a marketplace package is also built | Same identity binding; explicit checkpoint progress; optional captured plan-event mapping with a valid task/epoch association |
| Multica | Managed MCP and shared skill on its local runtime | Automatic MCP identity; explicit checkpoint/resume/finish; shared dashboard database |

Packages under `dist/plugins/{pi,claude,codex}` include their runtime. Codex project installation uses scoped hooks/MCP/skill registration rather than automatic global plugin-cache activation.

Other clients can run the shared MCP server and load `skills/cairn`:

```sh
cairn mcp
cairn doctor --target codex
```

Generic MCP selects `--db`, then `CAIRN_DB`, then its saved database, then the workspace. Remember it with `cairn mcp --db FILE --remember`; clear it with `cairn mcp --forget`. Native adapters keep their actual host identities and workspace selection.

### Multica installation

Run on the same machine as the selected Multica runtime, using the real workspace ID:

```sh
cairn install --target multica --agent "Troubleshooting Assistant" --workspace-id WORKSPACE_ID
cairn update --target multica
cairn doctor --target multica
cairn ui
```

The installer registers the MCP server, binds the shared skill, and saves the same persistent database for generic MCP and the dashboard. An existing unmanaged `cairn` server needs explicit `--adopt`. The last successful workspace/agent selection is remembered; later updates do not depend on Multica's current workspace selection.

The global installation script can run that setup with the installed copy:

```sh
npm run install:global -- --target multica --agent "Troubleshooting Assistant" --workspace-id WORKSPACE_ID
```

Omit `--target` to update only the global command. See the [Chinese Multica guide](docs/multica.zh-CN.md) for ownership, recovery and capability limits.

MCP alone is sufficient for explicit curated checkpoints and recovery. Native lifecycle/context restoration depends on actual host integration. Curated goals do not automatically mirror native plans, and Claude/Pi have no guaranteed native-plan mapping in Cairn. Captured Codex plan events require a previously reserved call for the current task and epoch; hosted paths may bypass local hooks.

`doctor` separates declared capabilities from observed lifecycle events and checks installation, version, MCP and configured upstream availability. Missing capture hooks do not prevent a curated task; missing restoration events require explicit read/resume.

## Optional captured evidence and the complete diagnosis demo

For raw tool evidence, explicitly choose `evidence_mode: "captured"` when starting a new general task. Captured observations preserve original input/output, source, scope and execution identity. E# aliases point to them; findings use `evidence`/`against`, and completion validates reference membership, eligibility and coverage. Structural integrity still does not prove the interpretation.

```sh
cairn demo
cairn demo --port 0
cairn demo --no-ui --delay 0 --json
```

This remains an **explicit captured-mode example**, using local price-incident fixtures and real stdio MCP calls with a deterministic driver. It shows raw evidence, suspension, new-session takeover and report export; it needs no model account. Its configured tool whitelist and six-call limit illustrate that example, not the general workflow. The dashboard remains in the foreground until Ctrl+C.

To prepare it for a real agent instead:

```sh
unset CAIRN_WORKSPACE
cairn demo --prepare --target codex --root ./cairn-example
cd cairn-example
export CAIRN_DB="$PWD/.cairn/state.db"
codex
```

Ask the agent to read `PROMPT.md`. Use `--target pi` or `--target claude` for those hosts. In a second terminal, enter that workspace and run `cairn ui --db "$PWD/.cairn/state.db" --port 0`. Preparation does not start a model; the CLI supplies its configured model, account and approvals. A nonempty destination is rejected. `CAIRN_DB` pins the sample DB even inside another Git repository; use a new terminal for other work or `unset CAIRN_DB` afterward.

The [captured price-incident walkthrough](docs/examples/price-incident.zh-CN.md) explains inputs, actual references and exports. Previous real-model/real-CLI runs remain historical verification, described separately in [verification](docs/verification.md).

## Solve actual problems with AI

After installing the host or Multica integration, run `cairn ui` and give the agent a concrete goal. Include the real project/input path, symptoms and material, allowed changes, and observable acceptance criteria. The agent selects its own tools.

For a local startup defect:

> Use Cairn to fix the startup failure in `/absolute/path/to/project`. The actual error is [paste error]; the expected result is a working development server and homepage. You may read source, reproduce locally and modify the relevant implementation and tests. Reproduce the failure, establish the cause from inspected files/results, implement the fix and verify the original path plus relevant regressions. Preserve useful findings and source references, update the graph at milestones, and finish only when the criteria hold. Report the actual changes, checks/results and remaining limits.

Cairn preserves the goal, findings, references and handoff state. The host agent performs the actual diagnosis, edits, calculations or research. Completion is based on goal coverage and recorded evidence relationships; source truth and causal correctness still require review.

To pause, ask the agent to save open questions and the next action and return its task ID. In another session, request an explicit takeover of that ID, review the saved state and continue. Data checks can use reconciled totals and an output file as criteria; implementation work can use a working user path and regression results; research can use source-linked conclusions and a verified experiment.

See the [Chinese practical workflow guide](docs/goal-workflow.zh-CN.md) for reusable prompts and a runnable local exercise. Default tasks need no upstream configuration; optional MCP forwarding can be configured separately with `cairn configure --file upstream-tools.json`.

## Update, data and development

```sh
# In the Cairn repository, update the global command.
npm install
npm run install:global

# In the original target project, update the chosen adapter.
cd /path/to/your-project
cairn update --target codex
cairn uninstall --target codex
```

Global command installation and host adapter installation are separate. Use the original scope/root and restart the host after updating its adapter. The installer merges configuration and tracks its own entries; modified registrations are reported and retained on uninstall. Task data stays independent. `npm uninstall --global cairn` removes the global command; use the same `--prefix DIR` if applicable.

Data defaults to `<workspace>/.cairn/state.db`. `CAIRN_DB` or `--db` overrides it; `CAIRN_WORKSPACE` selects the workspace root. Existing TypeScript SQLite tasks retain their selected semantics: records without `evidenceMode` remain **captured**. New public general starts default to curated; existing tasks are not silently converted. Earlier Python formats have no automatic migration. Keep task data out of Git.

The original bootstrap's direct first attempt remains in the ongoing session: understand the goal, act, review the result and adapt. There is no separate bootstrap worker, keepalive prompting, model pool or polling dispatcher.

```sh
npm test
npm pack --dry-run
node scripts/host-smoke.mjs pi
node scripts/host-smoke.mjs claude
node scripts/host-smoke.mjs codex
node scripts/pi-fixture-smoke.mjs
node scripts/claude-fixture-smoke.mjs
```

`npm test` typechecks, builds and runs deterministic tests without live models. Real-host smoke tests use configured accounts and may consume quota. Protocol fixtures use local model API servers and do not validate model reasoning. See [verification](docs/verification.md) for measured results and [architecture](docs/architecture.md) for implementation details. Task quality should be assessed against the user's acceptance criteria, inspected sources and actual verification results.

## Background and license

Cairn preserves goals, evidence, human context and recovery state across supported CLI hosts so agents can continue verifiable work.

Licensed under [AGPL-3.0](LICENSE).
