# Verification record

Record date: 2026-10-15 (Asia/Shanghai). Current 2.0 verification is separated from historical checks of the replaced 1.x tool protocol.

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
