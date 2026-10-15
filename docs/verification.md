# Verification record

Verified locally on 2026-10-15 (Asia/Shanghai).

## Automated checks

- `npm test`: 34 tests passed. Verified on Node 24.19.0 and Node 26.3.0. The command typechecks and builds first.
- Real stdio MCP client/server lifecycle: create, capture, claim, report, cross-host takeover and completion.
- Real fixture upstream: whitelist discovery, genuine result references, failed calls, cancellation, submission gates, missing receipts and reconciliation.
- Pi/Claude/Codex normalized event tests: capture, context recovery, duplicate events, user interruption and ordinary work after suspension.
- Project and user installation tests for all three hosts: merging, repeated updates, uninstall, conflict preflight and retention of modified registrations.
- Core tests: unsupported/contradictory claims, invalid scope, unrelated report citations, late results, deadline/concurrency/call budgets, crash recovery, frozen reports during submission and shared match deadlines.
- Claude native plugin manifest validation passed. Shared skill validation passed. Shell syntax and `git diff --check` passed.
- Package dry run contains the CLI and all three self-contained plugin manifests. The standalone HTML export was opened and visually inspected in ego-browser.

## Actual host executions

| Host | Version | Result |
| --- | --- | --- |
| Pi | 1.1.0 | Passed with the configured live model: native read → automatically captured observation → supported claim → report → suspend → new session takeover → completion, epoch 2 |
| Codex CLI | 0.162.0 | Passed the same live-model lifecycle using native scoped hooks/MCP configuration; no global plugin cache activation required |
| Claude Code | 2.1.296 | Native CLI lifecycle passed against a deterministic local Messages API fixture, including actual hooks, MCP, Read and new-session takeover; 12 protocol requests |

Claude's separate live-model attempt failed before inference because its existing OAuth session was expired and could not refresh. No account credentials were changed. The local protocol fixture verifies integration behavior, not Claude's diagnostic reasoning quality.

Reproduce with `node scripts/host-smoke.mjs HOST` using a configured account, or `node scripts/claude-fixture-smoke.mjs` for the deterministic Claude protocol fixture. The latter starts a loopback HTTP listener and uses a fixed dummy key, without external model requests. Each test prints its temporary artifact directory and retains its execution logs.

The Codex test explicitly approves only its test Cairn MCP server and trusts the generated hooks for that invocation. Those policies are not installed into normal user configuration.

## Remaining integration inputs and limits

- Competition-specific whitelist, actual tool schemas, result reference fields and submission receipt fields are not yet available. The example profile is a template.
- Host hook coverage varies. Codex hosted tools can bypass local hooks. The managed gateway is the enforced path for competition investigation/submission calls.
- Reference integrity checks cannot determine whether an inference is causally correct. The labelled synthetic cases in `evaluations/emergency-cases.json` support separate model evaluation; no contest score or diagnostic accuracy improvement is claimed from infrastructure tests.
- Old Python APIs and databases are intentionally not migrated.
