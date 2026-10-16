# Shared branches and external verification

These fields extend the same five Cairn tools; use the host's existing tools to execute work. Main and Worker connections must share the same SQLite database. Do not invent a native session identity; generic MCP generates one automatically.

The owner opens a branch with `cairn_checkpoint`:

```json
{"summary":"Delegate source inspection","progress":[{"key":"source","title":"Inspect source","status":"pending","delegated":true}]}
```

A separate Worker uses `cairn_resume`:

```json
{"task_id":"TASK_ID","progress_key":"source"}
```

Keep the returned `leaseToken` private. The default lease lasts 120 seconds; `lease_seconds` allows 10–900. Renew before expiration through `cairn_checkpoint`:

```json
{"progress_key":"source","branch_action":"heartbeat","lease_token":"TOKEN"}
```

Submit through `cairn_checkpoint`:

```json
{"progress_key":"source","branch_action":"checkpoint","lease_token":"TOKEN","summary":"Source reviewed","findings":[{"key":"cause","text":"Potential cause","status":"proposed","basis":"Relevant source comparison"}]}
```

Workers cannot change coverage, reports, other progress items or finish the root goal. Use `branch_action: "release"` with the token to relinquish work. Expired/revoked tokens cannot be reused; reclaim an available branch to get a new token. A lease does not start or terminate a host process.

The owner checks the actual sources, then calls `cairn_checkpoint` with `progress_key` and `branch_action: "merge"`. This records review without promoting findings. Read the saved complete finding key (namespaced under `branch:`) through `cairn_read`, then use a normal owner checkpoint with that key, explicit supported status and criterion coverage. Do not guess a namespaced key. Unmerged submitted work and live leases block completion. If a branch is no longer needed, release and cancel it explicitly.

Captured mode still requires eligible original observations before promotion; branch access does not grant native capture ownership. Ask the owner to obtain missing captured evidence through its existing controlled path.

To reopen after external validation failure, use `cairn_resume`:

```json
{"task_id":"TASK_ID","reopen_reason":"Integration verification failed","invalidate":["cause"]}
```

A different owner additionally needs `takeover: true`. The previous completion snapshot stays in history; feedback is appended, all criterion coverage needs reconfirmation, and only explicitly invalidated findings are downgraded. Delivered/emergency goals require a follow-up task. A completed task can receive a human Hint without being reopened.

After any epoch change, explicitly resume old connections before writing again. Never substitute a guessed epoch, native session ID or lease token. When a conclude request arrives, save confirmed and refuted findings with real grounds, remaining questions and next steps; do not revive work after an explicit user interruption.
