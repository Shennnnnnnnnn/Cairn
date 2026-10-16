# Applying Cairn to actual work

Use the shared SKILL.md for state timing, evidence rules, delegation and recovery. This reference adds task-specific inputs and examples.

## Specify observable acceptance

| Task | Useful inputs | Observable completion |
| --- | --- | --- |
| Diagnose and fix a defect | Project path, symptom, failing input, allowed edits | Reproduction explains the defect; repaired original path and relevant regression pass |
| Reconcile data | Source files, field meanings, period, scope | Differences are reproducible, explained and bounded to the inspected inputs |
| Implement a feature | Expected user behavior, constraints, existing conventions | Authorized change works through its intended user path and applicable checks |

For example:

> Use Cairn to diagnose the failing import in `/path/to/project`. You may inspect source, run the local reproduction and modify the relevant implementation. Completion means the original failing input works and a meaningful regression passes. Preserve checked findings and references; save missing access or evidence as a gap.

## Minimal finding payload

Call `cairn_update` when the finding is obtained. Replace these placeholders with inspected material; `covers` names the actual goal criterion.

```json
{
  "finding": {
    "key": "import-cause",
    "text": "The entrypoint references a path that is absent from the package.",
    "status": "supported",
    "basis": "Compared the declared entrypoint with the packaged files and reproduced the import failure.",
    "references": ["package.json", "src/index.ts"],
    "covers": ["c1"]
  }
}
```

A reproduction, an implemented change and a passing verification are separate facts. In particular, changing code does not establish that the original path now works. Preserve verification coverage and remaining exclusions with the findings.

## Delivery and missing access

The final report may be short: result, actual checks, supporting files and limits. Use the user's requested format. If a required environment or input is unavailable, record precisely what is missing and a concrete continuation; another session should be able to resume without reconstructing the conversation. There is no fixed incident-report template or separate external submission flow.
