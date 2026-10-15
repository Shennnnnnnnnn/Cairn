# Cairn plugin architecture

Cairn supplies recoverable goals and an evidence ledger inside existing agent CLIs. The host owns models, accounts, sessions, permissions and concurrency. No Cairn model worker, keepalive prompt, dispatcher or model API credential is needed.

## Shared core

`Engine` operates on Goal, Observation, Claim, Action and Hint records. `Store` commits every change together with an append-only event in one SQLite `BEGIN IMMEDIATE` transaction. The task table holds the current projection; original observations and historical claim revisions remain in the event ledger. Observations retain their host, session and execution epoch. The database uses WAL and a busy timeout for concurrent MCP and hook processes.

Each task has a host session owner and an execution epoch. Explicit takeover increments the epoch. Old sessions can append late observations for audit, but those observations cannot support completion. Suspended tasks produce no continuation suggestion. A task can suggest continuation at most twice, with no second suggestion for an unchanged state. User interruption is authoritative.

Goals are separate from facts. Completion criteria reference supported claims; claims reference eligible observations. Reports must cite actual evidence used for those claims. The code checks provenance, scope, identifiers and state, not the semantic truth of a causal explanation. The host agent and labelled evaluations check the interpretation.

## Public tools

The MCP server and Pi's native tools share schemas and implementations:

| Tool | Purpose |
| --- | --- |
| `cairn_create`, `cairn_resume` | Create an explicit goal or take over external state |
| `cairn_state`, `cairn_events` | Read recovery context or audit deltas |
| `cairn_evidence` | Fetch raw observations or clearly labelled manual records |
| `cairn_claim`, `cairn_satisfy` | Revise hypotheses and associate supported claims with criteria |
| `cairn_action`, `cairn_hint` | Record purposeful actions or attributed human context |
| `cairn_check`, `cairn_report`, `cairn_complete` | Validate criteria, citations and final completion |
| `cairn_suspend`, `cairn_delivery` | Save incomplete progress or reconcile a real receipt |
| `cairn_tools`, `cairn_call` | Discover and call whitelisted upstream MCP tools |

For stdio MCP, `--host` identifies the adapter. Hooks inject the real host `session_id`, which the agent supplies in tool arguments. Standalone MCP users can supply `--session-id`. Session IDs are explicit; the server never guesses ownership from the most recently active session.

## Host integration

Pi uses a native extension with tool-call, tool-result, before-start and settlement events. Claude Code and Codex use native plugin bundles containing skills, stdio MCP configuration and command hooks. All adapters normalize events before calling the same core. The bundles contain their own built runtime and do not depend on the source checkout after installation.

SessionStart records the loaded adapter and injects the session identity. PreToolUse reserves tool budget, and PostToolUse records the actual result. Cairn's own state tools are excluded to avoid recursive capture. Compaction recovery reads the current state index and fetches raw evidence on demand. Pi restores context before each turn; Claude/Codex additionally use SessionStart on resume/compaction and the shared skill's explicit state read.

Host hooks have different coverage and failure semantics. For example, Codex hosted tools may bypass local function hooks. Hooks are useful capture/integration points, not a universal security boundary. The controlled MCP gateway enforces its own whitelist, deadlines, parallel reservations and submission gates. Host sandbox and approval settings still apply to all other native tools. Core completion never depends solely on a Stop hook.

## Controlled upstream tools

`cairn configure --file FILE` installs a whitelist in the local task database. Only local users configure it; there is no model-callable configuration operation. `cairn_tools` returns original input schemas only for configured entries.

Each entry maps a public `name` to an upstream server/tool, result reference path, scope paths and an optional role:

- `read`: diagnostics.
- `submit`: requires `reportPath` and `receiptPath`. The gateway injects the saved validated report into the declared argument path, replacing any agent-supplied report at that path. `reportFormat` is `json` or `markdown`.
- `receipt`: a permitted reconciliation query. A receipt observation can resolve an ambiguous prior submission without repeating the write.

Paths are dot-separated JSON paths into `structuredContent`, or into JSON parsed from the first MCP text block. Scope mapping must reflect the official tool's actual response. Non-JSON responses remain raw observations. Credentials belong in upstream server environment configuration and are never returned in the tool catalogue.

Submission freezes report/claim changes until the result returns. Missing receipts and interrupted submissions require reconciliation; the gateway will not blindly submit again. Cancellation signals propagate to MCP requests. Absolute deadlines constrain subsequent calls and make results returned after the deadline ineligible.

## Emergency profile

The profile requires native integration, a configured whitelist and team/round/issue/match scope. One stored match deadline spans all its rounds and survives session restart and task recreation. Reports require impact scope evidence, a root cause and causal level, actual result references, and mitigation/fix/prevention. Human hints and manual records cannot supply competition evidence. `cairn confirm TASK_ID` records team confirmation outside the model-callable MCP interface.

Tool names and exact scope/result/receipt mappings depend on the organizer's still-unpublished whitelist. The example profile is a template, not a working competition connection. Local checks cannot replace the organizer's authoritative validation of `result_ref` ownership.
