# Emergency diagnosis profile

Use the organizer's configured `cairn_tool_*` tools. Each exposes its own parameters; the gateway records evidence and enforces the whitelist and budget. Native diagnostic calls outside the gateway are blocked where host hooks support interception. The profile requires native integration and team/round/issue/match scope; a configured but unavailable upstream must be repaired before work starts.

The match has one 30-minute deadline shared by all rounds. Reserve time for submission and team review. Repeating a task does not reset the clock.

Provide the report fields in checkpoint or finish:

1. `report.impact`: affected functions, users, data and measured scope, with observationIds (E1 aliases are accepted). Distinguish samples from full-population coverage.
2. `report.rootCause`: text and causal level (`symptom`, `service`, `code`, `root`); add trigger/amplification when supported.
3. Findings and evidence: use actual results from this team's current round. Cairn generates citations with genuine result_ref values; review whether each result actually supports the conclusion and resolve counterevidence.
4. `report.solution`: concrete mitigation, fix and prevention grounded in the confirmed mechanism.

Healthy distractors must not be reported as faults. Missing error logs do not rule out incorrect data. Human hints and manual records cannot supply competition evidence.

`cairn_finish` returns `ready_for_delivery` when the report passes but no receipt exists. Call the configured submission tool; Cairn injects the saved validated report and freezes it after delivery. On a timeout or missing receipt, inspect current delivery and use the configured receipt query. Never resubmit blindly. Receipt reconciliation is recorded automatically after a real submission attempt.

The team confirms a real delivered report outside model tools with `cairn confirm TASK_ID`. Finish remains `awaiting_confirmation` until then, and a final finish without new report content completes the task. Do not rewrite a report after its receipt or claim completion while confirmation is missing.
