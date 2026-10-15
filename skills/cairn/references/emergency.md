# Emergency diagnosis profile

Use only the organizer's configured whitelist through `cairn_tools` and `cairn_call`. The profile refuses to start without native integration, a whitelist, and team/round/issue/match scope.

The match has one 30-minute deadline shared by all rounds. Reserve time for report submission and team review. Repeating a task does not reset the clock.

The report contains:

1. Impact: affected functions, users and data. Investigate population/range coverage; distinguish a sample from a full assessment.
2. Root cause: a concise conclusion and causal level (`symptom`, `service`, `code`, `root`). Separate trigger and amplification where the evidence establishes both.
3. Evidence: explain each citation and use its actual `result_ref` from this team's current round. Include discriminating and counterevidence; unrelated logs add no support.
4. Solution: concrete mitigation, root fix and recurrence prevention, grounded in the established mechanism.

Healthy distractors must not be reported as faults. Missing error logs do not rule out incorrect data. Keep uncertainty visible.

Save and validate the report before the configured submission tool. Delivery requires its real receipt. The team confirms completion with `cairn confirm TASK_ID`; the agent cannot self-confirm through MCP.
