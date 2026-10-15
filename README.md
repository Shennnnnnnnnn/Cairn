# Cairn

English | [简体中文](README.zh-CN.md)

**Goals, evidence and recoverable progress inside Pi, Claude Code and Codex.**

Your CLI owns the model, tools, sessions and approvals. Cairn preserves an external goal, distinguishes observations from hypotheses, records evidence and checks completion. No Cairn dispatcher, model worker or daemon is needed.

## Quick start

Requires **Node.js 24 or newer** and an installed, configured host CLI.

```sh
npm install
npm run check

# Choose your host; default scope is the current project.
node bin/cairn.mjs install --target pi
node bin/cairn.mjs install --target claude
node bin/cairn.mjs install --target codex
```

Start a new host session. In Codex, trust the project and review the installed hooks with `/hooks`. Ask:

> Use Cairn to investigate this issue. Define completion criteria, keep hypotheses separate from observations, and produce an evidence-backed report.

Only create or resume a Cairn task when it is wanted. Other CLI work keeps its normal behavior. Add `--scope user` for personal installation across projects; `--root DIR` selects an explicit root for isolated testing. Model credentials and approval settings remain owned by the host.

| Host | Integration |
| --- | --- |
| Pi | Self-contained package registered in project/user settings; native tools and lifecycle events |
| Claude Code | Native plugin registered through a local marketplace, with skills, hooks and MCP |
| Codex | Native project/user hooks, MCP and skill registration; a marketplace plugin is also built for distribution |

Codex project installation uses native scoped registration to avoid activating a project plugin in the user's global plugin cache. Built packages are under `dist/plugins/{pi,claude,codex}`; each contains its own runtime and can move independently of the checkout.

Other MCP clients can load the common server and `skills/cairn`:

```sh
node /absolute/path/to/Cairn/dist/cairn.mjs mcp --host mcp --session-id my-task-session
```

Claude/Codex startup hooks supply the actual `session_id` for MCP arguments. Pi binds native tools automatically. MCP-only installation does not automatically capture native host tools; manual evidence keeps its manual provenance.

## Goals and evidence

- **Goal:** observable completion criteria, constraints and budget.
- **Observation:** real tool inputs/results, time, scope, provenance and original references.
- **Claim:** proposed, supported, refuted or inconclusive interpretation linked to observations.
- **Action:** a meaningful step with its purpose and stopping condition.
- **Hint:** human context with attributed authorship.

SQLite commits state and audit events atomically. Observations stay immutable; claim revisions remain in the event log. Reports must cite eligible evidence supporting completion claims. Code checks references and structure; the agent still reviews causal relevance and counterevidence.

Data defaults to `<workspace>/.cairn/state.db`. Use `CAIRN_DB` or `--db` to override. Keep this directory private and out of Git: it contains raw tool results. Host plugins and task data have separate lifecycles.

## Recovery and inspection

```sh
node bin/cairn.mjs task list
node bin/cairn.mjs task show TASK_ID
node bin/cairn.mjs export TASK_ID --format markdown --out report.md
node bin/cairn.mjs export TASK_ID --format html --out evidence.html
node bin/cairn.mjs doctor --target codex
```

The HTML export is a standalone evidence graph with expandable original results. No server or network access is needed.

Move work to another CLI by calling `cairn_resume` with the task ID and `takeover: true`. It restores goals, hypotheses, evidence indexes and missing criteria, and increments the execution epoch. Old sessions cannot complete the task; late results remain audit-only. Native conversation histories stay with their host.

`cairn_suspend` saves incomplete progress. Completion hints are bounded and respect user interruption. `doctor` distinguishes declared capabilities from observed events; files existing does not prove hooks are trusted or active.

## Controlled tools and the emergency profile

```sh
# Replace template names and mappings with the organizer's official tool definitions.
node bin/cairn.mjs configure --file profiles/emergency.example.json
```

The example is an **unconfigured template**. The actual competition whitelist and schemas are still unknown. The gateway supports stdio/HTTP MCP servers and an explicit tool whitelist, with original result capture, budgets and submission checks.

The `emergency` profile requires native integration, a whitelist and team/round/issue/match scope. All rounds share one persistent 30-minute match deadline. Reports require impact evidence, causal level/root cause, real current-round `result_ref` citations and mitigation/fix/prevention. Human hints and manual records cannot satisfy competition evidence.

Submission mappings require `reportPath` and `receiptPath`. The gateway injects the validated saved report at `reportPath`; choose `reportFormat: "markdown"` when the platform expects text. Missing or ambiguous receipts require reconciliation through an allowed receipt tool before another submission. After the real receipt, the team confirms outside the model-callable interface:

```sh
node bin/cairn.mjs confirm TASK_ID
```

The agent can then complete. The organizer remains authoritative for result reference validation and scoring.

Hook coverage varies: Codex hosted tools and some specialized paths bypass local hooks. The gateway enforces its own whitelist and deadlines. Native hooks complement the host's sandbox and approvals; they are not a complete security boundary.

## Update and uninstall

```sh
node bin/cairn.mjs update --target pi
node bin/cairn.mjs uninstall --target pi
```

Use the original scope/root. The installer merges settings, records its own entries and preserves task data. Uninstall retains user-modified registrations and their runtime, reporting what remains.

## Development and verification

```sh
npm test                     # Typecheck, build, deterministic tests; no live models
npm pack --dry-run

# Opt-in: current CLI/model, temporary workspace, native capture and new-session recovery.
node scripts/host-smoke.mjs pi
node scripts/host-smoke.mjs claude
node scripts/host-smoke.mjs codex
```

Real-host tests use the configured account and may consume quota. Logs stay in the printed temporary directory. Codex test automation trusts the generated hooks for that invocation; normal installation uses regular trust review. Authentication failures are not counted as successful verification.

See [architecture](docs/architecture.md) and [verification](docs/verification.md). The original Python server/dispatcher/container architecture has been replaced; old interfaces and database formats are not migrated.

Labelled synthetic diagnosis cases and the grading rubric are in [evaluations](evaluations/README.md). They separate integration correctness from model diagnostic accuracy.

## Background and license

Cairn originated as a goal-directed exploration engine, validated in the Tencent Cloud AI penetration testing challenge. This version carries its goal, evidence and human-hint ideas into reusable CLI plugins.

Licensed under [AGPL-3.0](LICENSE).
