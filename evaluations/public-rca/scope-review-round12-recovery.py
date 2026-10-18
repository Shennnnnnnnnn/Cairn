"""Supplemental public-input scope audit; no model calls or hidden labels.

The frozen scan is deliberately broad. This file preserves its candidates and
adds reviewed path resolution, shared scratch receipts, and byte integrity.
It does not change scoring or claim an OS sandbox for Pi.
"""
import collections
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

base = Path(__file__).resolve().parent
repo = base.parent.parent
cohorts = {
    "original": base / "runs/2026-10-18-scheduler-three-model-round12-final",
    "restoredPi": base / "runs/2026-10-18-scheduler-pi-recovery-round12",
}
load = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
tmp_pattern = re.compile(r"(?:/private)?/tmp/[A-Za-z0-9._/-]+")
protected_pattern = re.compile(r"grade\.py|case-manifest|\.pi/agent|models\.json|auth\.json|printenv|os\.environ")
network_pattern = re.compile(r"https?://|\bcurl\b|\bwget\b")
nested_pattern = re.compile(r"\b(?:pi|codex|claude|opencode|gemini|aider|llm)(?:\s|$)")


def public_tool_times(actor):
    """Read only ledger timestamps/roles and public tool-call IDs.

    Never return private reasoning blocks or any message body beyond tool IDs.
    Root sessions may contain a later cumulative copy, deduplicated by ID.
    """
    times = {}
    for path in sorted((actor / "sessions").glob("*.jsonl")):
        for line in path.open():
            try:
                event = json.loads(line)
            except ValueError:
                continue
            message = event.get("message") or {}
            if message.get("role") == "assistant":
                for block in message.get("content") or []:
                    if block.get("type") == "toolCall":
                        times.setdefault(block["id"], {})["issuedAt"] = event.get("timestamp")
            elif message.get("role") == "toolResult":
                times.setdefault(message["toolCallId"], {})["returnedAt"] = event.get("timestamp")
    return times


reviewed = []
shared = []
observed_patterns = []
integrity = {}
for cohort, root in cohorts.items():
    assert load(root / "execution-ended.json")["allActorsEnded"]
    manifest = load(root / "manifest.json")
    frozen_bad = [name for name, expected in manifest["frozenFiles"].items()
                  if not (root / name).exists() or sha(root / name) != expected]
    implementation_bad = [name for name, expected in manifest["implementation"].items()
                          if not (root / "implementation" / name).exists()
                          or sha(root / "implementation" / name) != expected]
    workspace_drift = [name for name, expected in manifest["implementation"].items()
                       if not (repo / name).exists() or sha(repo / name) != expected]
    config_bad = [name for name, expected in manifest["globalConfigHashes"].items()
                  if not Path(name).exists() or sha(Path(name)) != expected]
    actor_checks = []
    for row in manifest["schedule"]:
        actor = root / row["id"]
        work = actor / "workspace"
        inputs = load(actor / "input-hashes.json")
        changed = [name for name, expected in inputs.items()
                   if not (work / name).exists() or sha(work / name) != expected]
        cleanup_files = [actor / "credential-cleanup.json"]
        cleanup_files += list((actor / "phases").glob("*/credential-cleanup.json"))
        cleanup = []
        for path in cleanup_files:
            if path.exists():
                record = load(path)
                paths = record.get("paths") or ([record["path"]] if "path" in record else [])
                cleanup.append({"receipt": str(path), "recordedRemoved": record.get("removed"),
                                "pathsStillExist": [name for name in paths if Path(name).exists()]})
        actor_checks.append({"id": row["id"], "inputsChanged": changed,
                             "credentialCleanup": cleanup})
        times = public_tool_times(actor)
        tools = load(actor / "initial.tools.json")
        for tool in tools:
            arguments = tool.get("arguments") or {"command": tool.get("command")}
            serialized = json.dumps(arguments, ensure_ascii=False)
            hits = {name: bool(pattern.search(serialized)) for name, pattern in [
                ("protected", protected_pattern), ("network", network_pattern),
                ("nestedCli", nested_pattern)]}
            if any(hits.values()):
                observed_patterns.append({"cohort": cohort, "id": row["id"],
                                          "toolId": tool["id"], "patterns": hits})
            command = arguments.get("command")
            if not isinstance(command, str):
                continue
            paths = sorted(set(tmp_pattern.findall(command)))
            if paths:
                phase_id, _, native_id = tool["id"].rpartition(":")
                native_id = native_id or tool["id"]
                own_write = bool(re.search(r">\s*(?:/private)?/tmp/", command))
                own_read = bool(re.search(r"\b(?:cat|tail|head)\s+(?:-[^ ]+\s+)*(?:/private)?/tmp/", command))
                remove = bool(re.search(r"\brm\s+-f\s+(?:/private)?/tmp/", command))
                shared.append({"cohort": cohort, "id": row["id"], "model": row["model"],
                               "arm": row["arm"], "toolId": tool["id"], "paths": paths,
                               "write": own_write, "read": own_read, "remove": remove,
                               "sameCommandWritesBeforeRead": own_write and own_read
                               and command.find(">/tmp/") < command.find("cat /tmp/")
                               if "cat /tmp/" in command else own_write and own_read,
                               "isError": tool.get("isError"), "status": tool.get("status"),
                               **times.get(native_id, {}),
                               "commandFirstLine": command.splitlines()[0]})
        scan = load(actor / "public-scope.scan.json")
        for flag in scan["flagged"]:
            text = flag["input"]
            if tmp_pattern.search(text):
                category = "shared-tmp-scratch"
                evidence = "Explicit shared /tmp stdout redirection/read/removal; retained as a real instruction boundary deviation. See per-command receipts."
            elif re.search(r"\bcd\s+\.\.\s", text):
                category = "outside-workspace-cwd-failed-read"
                evidence = "GLM tried cd .. from the workspace and to execute actor-parent .tmp/a7_stats.py. Public tool result is ENOENT/exit2, with no file content returned; subsequent command returned to the absolute workspace."
            elif "../evidence/" in text:
                category = "inside-workspace-relative-read"
                evidence = "Shell first cd .tmp inside this workspace; ../evidence resolves to this actor workspace/evidence, not another actor or grading path."
            elif re.search(r"\.parents?\b", text):
                category = "path-parent-expression-within-workspace"
                evidence = "Path.parent accesses evidence categories or resolves script-local root. The sole parent.parent script is workspace/.tmp/validate_outputs.py, so its root remains the workspace."
            else:
                category = "inside-workspace-cwd-or-documentation"
                evidence = "Reviewed cd targets are actor-own absolute workspace or relative evidence/.tmp/current directory. Some matches are literal REPORT reproduction examples in heredocs, not executed shell changes."
            reviewed.append({"cohort": cohort, "id": row["id"], "toolId": flag["toolId"],
                             "flags": flag["flags"], "classification": category,
                             "evidence": evidence})
    integrity[cohort] = {"formalFrozenIntact": not frozen_bad and not implementation_bad,
                         "frozenFileMismatches": frozen_bad,
                         "implementationMismatches": implementation_bad,
                         "currentWorkspaceDrift": workspace_drift,
                         "globalConfigMismatches": config_bad,
                         "actors": actor_checks}

# The ledger receipts bound each public command. Compare every same-path command
# across actors and cohorts, not only commands on the revised-main rows.
overlaps = []
for i, left in enumerate(shared):
    for right in shared[i + 1:]:
        if (left["cohort"], left["id"]) == (right["cohort"], right["id"]):
            continue
        common = set(left["paths"]) & set(right["paths"])
        if not common:
            continue
        bounds = [left.get("issuedAt"), left.get("returnedAt"),
                  right.get("issuedAt"), right.get("returnedAt")]
        if any(value is None for value in bounds):
            overlaps.append({"left": left["toolId"], "right": right["toolId"],
                             "paths": sorted(common), "status": "unknown-command-time"})
        elif max(bounds[0], bounds[2]) <= min(bounds[1], bounds[3]):
            overlaps.append({"left": left["toolId"], "right": right["toolId"],
                             "paths": sorted(common), "status": "overlap"})

result = {
    "createdAt": datetime.now(timezone.utc).isoformat(),
    "scope": "All 90 public command/path arguments and public write contents; frozen broad candidates manually classified. No hidden labels, private reasoning, or actor scripts executed.",
    "scriptSHA256": sha(Path(__file__)),
    "isolationLimit": "Pi has no OS sandbox. Static native inputs do not prove absence of indirect/dynamic filesystem or network activity, nor external process interference.",
    "scoringUnchanged": True,
    "hiddenOrCredentialReferenceObservedInPublicToolInputs": bool(observed_patterns),
    "networkOrNestedCliPatternHits": observed_patterns,
    "flaggedCommands": len(reviewed),
    "classifications": dict(collections.Counter(x["classification"] for x in reviewed)),
    "reviewed": reviewed,
    "sharedScratch": {
        "actors": sorted(set(x["cohort"] + "/" + x["id"] for x in shared)),
        "commands": len(shared), "writeCommands": sum(x["write"] for x in shared),
        "readCommands": sum(x["read"] for x in shared),
        "cleanupCommands": sum(x["remove"] for x in shared),
        "receipts": shared, "samePathCrossActorCommandOverlaps": overlaps,
        "conclusion": "All observed content reads follow their own stdout redirection in the same successful shell command. Same-path cross-actor overlap is checked from public native ledger timestamps. This supports no observed cross-actor stdout reuse in these receipts; dynamic paths and unrelated external processes remain outside the proof.",
        "leftoverPolicy": "Do not inspect or remove unknown current shared /tmp files. One actor has no explicit cleanup receipt; this is not a credential cleanup claim.",
    },
    "integrity": integrity,
}
out = cohorts["restoredPi"] / "scope-review.json"
out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"flaggedCommands": len(reviewed), "classifications": result["classifications"],
                  "sharedScratchCommands": len(shared), "sharedScratchActors": len(result["sharedScratch"]["actors"]),
                  "samePathCrossActorCommandOverlaps": overlaps,
                  "formalFrozenIntact": {k: v["formalFrozenIntact"] for k, v in integrity.items()},
                  "inputsChangedActors": sum(bool(a["inputsChanged"]) for v in integrity.values() for a in v["actors"])}, ensure_ascii=False))
