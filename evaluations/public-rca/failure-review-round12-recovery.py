"""Correct public HTTP interpretation without changing frozen scores/heuristics."""
import collections
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

base = Path(__file__).resolve().parent / "runs"
roots = {
    "original": base / "2026-10-18-scheduler-three-model-round12-final",
    "restoredPi": base / "2026-10-18-scheduler-pi-recovery-round12",
}
load = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
rows = []
for cohort, root in roots.items():
    assert (root / "report-reviews.json").exists()
    for row in load(root / "summary.json")["rows"]:
        actor = root / row["id"]
        phases = sorted((actor / "phases").glob("*/initial.metrics.json"))
        if not phases:
            phases = [actor / "initial.metrics.json"]
        observed = []
        for path in phases:
            metrics = load(path)
            errors = []
            for error in metrics.get("errors", []):
                text = error.get("message", "")
                # Read the status prefix, not incidental digit substrings in
                # Cloudflare ray_id/instance/error HTML or suggested URLs.
                match = re.match(r"\s*(\d{3})(?:\s|:)", text)
                errors.append({"httpPrefix": int(match[1]) if match else None,
                               "summary": text[:200],
                               "contains401or403Substring": bool(re.search("401|403", text))})
            observed.append({"phase": path.parent.name,
                             "finalStopReason": metrics.get("finalStopReason"),
                             "turnFailed": metrics.get("turnFailed"),
                             "toolCalls": metrics.get("toolCalls", 0),
                             "errors": errors})
        correction = None
        interpreted = row["reason"]
        if row["reason"] == "authentication_or_permission":
            reason = row.get("schedulerReason") or row.get("terminalErrorMessage") or ""
            match = re.match(r"\s*(\d{3})(?:\s|:)", reason)
            if match and int(match[1]) in {429, 500, 502, 503, 504}:
                interpreted = "provider_server_error"
                correction = {"frozenReasonRetained": row["reason"],
                              "reviewedDirectCause": interpreted,
                              "terminalHttpPrefix": int(match[1]),
                              "evidence": reason,
                              "why": "Frozen heuristic matched 401/403 inside Cloudflare instance/ray_id. Actual prefix, title, status and error_code are HTTP502 Bad gateway; no authentication failure demonstrated."}
        stop_cause = None if row["completed"] else interpreted
        scheduler_reason = row.get("schedulerReason") or ""
        if not row["completed"] and "raw JSON object" in scheduler_reason:
            stop_cause = "public_final_not_raw_json"
        elif not row["completed"] and '"too_big"' in scheduler_reason and '"references"' in scheduler_reason:
            stop_cause = "phase_schema_references_limit"
        elif not row["completed"] and "findings need an explanation or file/link references" in scheduler_reason:
            stop_cause = "checkpoint_grounding_rejected"
        rows.append({"cohort": cohort, "id": row["id"], "completed": row["completed"],
                     "frozenReason": row["reason"], "reviewedReason": interpreted,
                     "directStopCause": stop_cause,
                     "schedulerReason": scheduler_reason,
                     "artifactIssues": row.get("acceptanceIssues", []),
                     "correction": correction, "phases": observed})

result = {
    "createdAt": datetime.now(timezone.utc).isoformat(),
    "method": "Post-read public HTTP prefix/status review. Frozen summary.json, diagnostics.json, failure-layers.json, grading and raw events remain unchanged; this supplement corrects interpretation only.",
    "sourceSummaryHashes": {cohort: sha(root / "summary.json") for cohort, root in roots.items()},
    "scriptSHA256": sha(Path(__file__)),
    "reviewedIncompleteReasons": dict(collections.Counter(row["reviewedReason"] for row in rows if not row["completed"])),
    "directStopCauses": dict(collections.Counter(row["directStopCause"] for row in rows if not row["completed"])),
    "corrections": [dict(cohort=row["cohort"], id=row["id"], **row["correction"])
                    for row in rows if row["correction"]],
    "rows": rows,
}
output = roots["restoredPi"] / "failure-review.json"
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"actors": len(rows), "corrections": len(result["corrections"]),
                  "reviewedIncompleteReasons": result["reviewedIncompleteReasons"]}))
