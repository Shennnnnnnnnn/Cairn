# Verification record

Record date: 2026-10-15 (Asia/Shanghai). Results below identify the evidence mode and distinguish automated integration checks from real model executions.

## Cairn 3.0.1 relationship graph as the main view

Verified locally on 2026-10-15 (Asia/Shanghai).

- **130 automated tests passed on Node 26.3.0**, including typecheck and bundle build. The 12 graph/state projection tests also passed on Node 24.19.0.
- The separate task-progress tab/board and its header counters were removed. The graph now includes a distinct starting point and full goal, recorded work stages, basis/observations, conclusions and acceptance conditions. It reuses the earlier UI palette from commit `930c037`: teal start, rose goal, indigo completed/formed results, amber running work and pale dashed pending work. A satisfied goal retains its role color and receives a green check.
- New projection tests cover real evidence paths, connected starting context, explicit work-state colors, no invented dependency between plan items, no invented execution stages in legacy tasks, stale running suppression after pause/completion, and nonoverlapping nodes within bounds in both layouts.
- ego-browser verified an explicitly labelled synthetic fixture: graph selected by default, no progress-board tab, all nodes within the canvas in horizontal and vertical layouts, correct colors, stage detail inspection, zoom/fit and fullscreen entry/exit. Pausing from another SQLite connection updated through SSE without reloading: the running stage became blocked and all running edges disappeared.
- `docs/images/dashboard-graph.png` is the actual browser screenshot of that synthetic fixture. It is a UI demonstration, not a new model execution or a diagnostic-quality evaluation. The earlier progress-board screenshot and verification record below are historical.

## Cairn 3.0 goal workflow and progress UI

Verified locally on 2026-10-15 (Asia/Shanghai).

- **124 automated tests passed on Node 26.3.0 and Node 24.19.0**; typecheck and self-contained bundle build passed. The shared skill validator passed.
- Public five-tool tests cover default curated creation without an upstream or tool whitelist, findings with explanations/file/URL references, visible milestones, suspension, cross-host takeover, stale-owner rejection and completion/export. Calls and observations remain empty throughout.
- Pi, Claude Code and Codex normalized native events leave curated tools unrestricted and unrecorded. Shared adapter tests cover milestone/reference recovery for all three hosts. Curated hooks skip uncorrelated native plan results, including delayed plans after the same session changes goals. Captured Codex plans require a reserved eligible call belonging to the current task and epoch.
- Completion checks reject unsupported findings, cross-task report references and conclusions whose declared scope does not cover the goal. Imported inconsistent scope associations are independently rejected by evaluation. Curated checks validate recorded relationships, not external reference contents or causal correctness.
- General curated tasks have no call/concurrency quota; unobservable quota settings are rejected. Deadlines are advisory. Explicit captured and emergency constraints, receipt reconciliation, report freezing and human confirmation remain covered by regression tests. Repeated unsuccessful finish checks are visible and deduplicated; progress checkpoints preserve the final report summary.
- ego-browser inspected the installed blue-and-white UI. A separately labelled synthetic curated fixture displayed one running, one completed and one pending milestone, with goal coverage 1/2. A second SQLite connection paused it: SSE changed running to zero and retained blocked work without reloading. Explicit new-session takeover retained findings and did not invent running work. The basis view contained the submitted explanation/file reference and no raw-tool section.
- The already completed real Codex 2.1 captured example was opened with the new UI: 0 running, 2 completed criteria; milestone timeline distinguished evidence review, pause, takeover, failed completion check and completion. Its six observations and original records were preserved. This UI check is not a new real-model run in curated mode.
- `docs/images/dashboard-v3.png` is an actual browser screenshot using explicitly labelled synthetic data, not a model reasoning evaluation. The Chinese workflow guide explains the six design questions and provides a free-tool, pause/resume example. Earlier captured examples explicitly opt into captured mode.

These checks do not establish a new real-model closed loop in all three CLIs. Historical live runs and deterministic native-CLI fixtures remain recorded below, with their original limits.

## Cairn 2.1 global command and complete example

Verified locally on 2026-10-15 (Asia/Shanghai).

- **89 tests passed on Node 26.3.0 and Node 24.19.0**. Typecheck/build passed. The new checks cover global package installation, the diagnostic example and stdio EOF cleanup; the earlier 79 tests remain included.
- `npm run install:global -- --cache /private/tmp/cairn-npm-cache --offline` installed a real global package at the configured npm prefix. From `/private/tmp`, `cairn --version` returned `2.1.0`; the command resolved to `/opt/homebrew/lib/node_modules/cairn/bin/cairn.mjs`, independently of this checkout.
- Automated packaging checks use an empty npm cache and temporary prefix, remove the source fixture, then verify version/help, all three host plugin installations, actual MCP startup and Pi extension import. The installed package has no runtime npm dependencies or source symlink.
- Global `cairn demo --no-ui --delay 0 --json` completed actual stdio MCP calls in two connections, saved four Gateway observations with demo references, preserved a refuted hypothesis, explicitly took over at epoch 2, and exported consistent Markdown/HTML/JSON plus execution logs.
- Global `cairn demo --port 0 --delay 3000` was inspected with ego-browser. The page showed suspended progress at 0/2, then completed at 2/2 with one takeover and four observations, without navigation/reload. Mapping evidence exposed the original `source_price * 100` expression. All 15 graph nodes fit the canvas after live growth.
- The example uses fixed steps and explicitly fictional data. It calls no external model and does not establish reasoning quality or performance of Pi, Claude or Codex. `demo --prepare --target HOST` creates a separate native-CLI workspace for users to run with their own model/account.
- Preparation rejects nonempty directories. The generated prompt explicitly binds `CAIRN_DB`, including when the sample is nested inside another Git repository. The deterministic driver refuses a different database or modified upstream configuration. Abort tests preserve incomplete progress and verify that child processes exit.
- `docs/examples/price-incident.zh-CN.md` documents the complete sequence, actual tool arguments and results, short references, report artifacts and the native-host alternative. Its screenshot comes from the globally installed command.

## Cairn 2.0 verification

Verified locally on 2026-10-15 (Asia/Shanghai), with the current five-tool protocol. Model/provider failures below are recorded separately from protocol integration results.

| Check | Current record |
| --- | --- |
| Typecheck, build and complete automated suite | 79 tests passed on Node 24.19.0 and Node 26.3.0; includes build/typecheck |
| New five-tool MCP lifecycle and typed upstream schemas | Passed real stdio transport, one-time session binding, short references, schema defaults and concurrent catalog loading |
| Pi 1.1.0 native lifecycle and new-session recovery | Passed actual Pi CLI against a deterministic loopback model fixture: 7 requests, native read → E1 → one finish/suspend → takeover → finish; 1 observation, epoch 2 |
| Claude Code 2.1.296 hooks/MCP lifecycle and recovery | Passed actual CLI against a deterministic local Messages API fixture: 7 requests, 1 native observation, new-session takeover, completed at epoch 2 |
| Codex CLI 0.162.0 hooks/MCP lifecycle and recovery | Passed with the configured live model and a goal-level prompt: native read, evidence-backed suspended checkpoint, new-session takeover and completion; 1 observation, epoch 2 |
| Blue-and-white dashboard | Passed ego-browser checks using explicitly labelled simulated data: checkpoint summary/questions/next, E1 raw evidence, and live criterion coverage 1/2 → 2/2 with status completed and no page reload |
| Shared skill/manifest and package | Shared skill validation and Claude plugin validation passed. Package dry run includes all three self-contained manifests, UI runtime and Chinese README |
| Documentation checks | JSON examples, shell/JS syntax and git diff whitespace checks passed |

Pi's two configured-live-model attempts were interrupted by upstream 429 rate limits and 503 service-unavailable responses. The second attempt successfully called `cairn_start`, then failed before reading evidence. No provider/model configuration was changed. Claude's configured-live-model attempt failed before inference because its existing OAuth session was expired and could not refresh. Local fixtures validate actual CLI integration and recovery; they do not prove model reasoning quality.

New regression cases cover task identity pinned per connection, refusal to abandon another active goal on resume, cross-workspace takeover, original-task routing of late native results, execution epochs (including old calls without epoch), proposed findings remaining proposed on text edits, complete metadata/audit paging after recovery truncation, and concurrent typed-catalog loads without duplicate tools. Existing 1.x-style SQLite claims/reports resume through the new interface without being rewritten.

The screenshot in `docs/images/dashboard.png` uses marked simulated/manual observations. It demonstrates the UI rather than a real incident diagnosis.

### What the new verification must cover

- A simple start → native read → finish workflow, without separate claim, satisfy or report calls.
- One-time MCP identity binding, Pi native identity, cross-CLI takeover and rejection of stale owners.
- Stable E# aliases, atomic checkpoint revisions, counterevidence, criterion coverage, automatic report references, failed finish returning gaps, suspension and repeated finish handling.
- Recovery context size/truncation and complete on-demand evidence/history retrieval, including pre-existing TypeScript 1.x tasks and reports.
- Original upstream schemas, injected submit fields, concurrent connection reuse, cancellation/timeout isolation, raw failures and safe receipt reconciliation without repeated external submission.
- Accurate declared/observed capability reporting and missing-hook behavior.
- Read-only dashboard behavior, live cross-process progress and original evidence inspection.

Reproduce deterministic checks from the repository root:

```sh
npm test
npm pack --dry-run
```

Opt-in host executions use the current configured account and may consume quota:

```sh
node scripts/host-smoke.mjs pi
node scripts/host-smoke.mjs claude
node scripts/host-smoke.mjs codex
node scripts/pi-fixture-smoke.mjs
node scripts/claude-fixture-smoke.mjs
```

The Pi and Claude fixtures run actual CLIs against local Messages API fixtures instead of external models. Pi uses a separate blank credential store and a loopback-only dummy provider. Each smoke test prints and retains its temporary logs. Temporary hook trust in tests does not replace normal installation review.

## Historical checks — 1.x protocol and initial dashboard

The following checks were recorded before the five-tool refactor. Their model protocol used create/capture/claim/satisfy/report/suspend/complete. They document earlier integration behavior, not acceptance of the 2.0 interface.

### Automated and browser checks

- `npm test`: 40 tests passed on Node 24.19.0 and Node 26.3.0, including typecheck and build.
- Real stdio MCP client/server lifecycle: create, capture, claim, report, cross-host takeover and completion.
- Fixture upstream: whitelist discovery, genuine result references, failed calls, cancellation, submission gates, missing receipts and reconciliation.
- Pi/Claude/Codex normalized events: capture, restoration, duplicate events, interruption and ordinary work after suspension.
- Project/user installation: merging, repeated updates, uninstall, preflight conflicts and retention of modified registrations.
- Core: contradictory/unsupported claims, invalid scope, unrelated citations, late results, budgets, crash recovery, in-flight report freezing and shared match deadlines.
- Claude plugin manifest and shared skill validation, shell syntax and `git diff --check` passed.
- Package dry run included the CLI and all three self-contained plugin manifests. The standalone HTML export was opened in ego-browser.
- Dashboard HTTP/SSE checks covered criterion counts, report validation, same-task evidence isolation, read-only routes, cross-origin/Host rejection, export, occupied ports and changes from a second SQLite connection.
- Browser checks used explicitly labelled demo data: original blue-and-white overview/detail layout, raw evidence, graph orientation, hints/logs, resizing and progress changing from 2/3 to 3/3 without reloading.

### Actual host executions with the old protocol

| Host | Historical version | Historical result |
| --- | --- | --- |
| Pi | 1.1.0 | Configured live model passed native read, captured observation, supported claim, report, suspension, new-session takeover and completion at epoch 2 |
| Codex CLI | 0.162.0 | Configured live model passed the same lifecycle using scoped hooks/MCP without global plugin-cache activation |
| Claude Code | 2.1.296 | Actual CLI passed against a deterministic local Messages API fixture, including hooks, MCP, Read and takeover; 12 protocol requests |

Claude's separate historical live-model attempt failed before inference because the existing OAuth session was expired and could not refresh. No account credentials were changed. The local fixture verified integration behavior, not model diagnostic reasoning.

The historical Codex test approved only its temporary Cairn MCP server and trusted generated hooks for that invocation. These policies were not installed into normal user configuration.

## Integration inputs and limits

- The official competition whitelist, schemas and result/scope/receipt mappings remain external inputs. `profiles/emergency.example.json` is a template, not a verified connection to the organizer.
- Host coverage varies. Codex hosted tools can bypass local hooks. MCP-only setup cannot capture arbitrary native tools; typed gateway calls are its automatically recorded execution path.
- Reference validity and schema/state tests cannot prove causal correctness. Labelled cases in `evaluations/emergency-cases.json` support separate model assessment. No contest score, improved diagnostic accuracy or measured task-latency reduction is claimed.
- TypeScript 1.x SQLite task records are retained and tested to resume through the new protocol; no compatibility is offered for the removed 16 public tools. Older Python APIs/database formats are not automatically migrated.
