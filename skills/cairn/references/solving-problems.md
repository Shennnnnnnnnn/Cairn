# Using Cairn for actual work

Cairn keeps the goal and evidence while the host agent does the work. Use normal host permissions and tools; tool names and invocation order are task inputs, not a fixed workflow.

## Turn the request into a verifiable goal

Record the real project or input paths, observed problem, available material, allowed changes and the result the user needs. Choose criteria that can be checked from outputs: a reproduced bug and passing regression, a reconciled calculation with its coverage limits, or an implemented feature with a working user path.

For example:

> Use Cairn to diagnose the failing import in `/path/to/project`. You may read source, run the local reproduction and modify the relevant implementation. Completion means the original failing input works and a meaningful regression check passes. Choose tools yourself. Preserve useful findings with file references; save the actual checks and results. If access is missing, save the gap and next action instead of declaring success.

Begin with `cairn_start`. Generic MCP/Multica and Pi already bind identity; native Claude/Codex use the real startup-hook identity once. Default curated mode needs no upstream configuration.

## Work and record milestones

Use the host's tools to inspect source/data, reproduce the issue, implement the authorized change and verify it. Separate facts, hypotheses and rejected explanations. Record a checkpoint when the result changes the next useful action, before handing work over, or when pausing.

- `findings`: concise conclusions, their `basis`, file/link `references`, and the criteria they cover.
- `progress`: stable keys for the work actually completed, in progress or blocked; these appear in the relationship graph.
- `questions` and `next`: unresolved issues and a concrete continuation.

Do not store private reasoning, a transcript of every tool call, or invented dependencies just to fill the graph. A supported finding should cite material actually inspected. A file path alone does not establish correctness.

## Pause, resume and finish

Pause with `cairn_finish` and `outcome: "suspended"`; return the task ID. Another session reads and explicitly resumes that ID with `takeover: true`, reviews saved references and continues. A subagent may check an independent question; the main owner reviews and records the result.

Use `cairn_finish` to save the final summary and findings. It completes when goal coverage and the submitted evidence relationships pass. If checks fail, inspect the returned gaps and either make a useful verification or suspend. There is no separate business-system submission step in Cairn.

The final summary should say what changed or was learned, what was actually verified, the files/artifacts that support it, and any remaining limits. Use whatever structure helps the user's task; no fixed incident-report fields are required. Any external action follows the user's authorization and the host's own tools.
