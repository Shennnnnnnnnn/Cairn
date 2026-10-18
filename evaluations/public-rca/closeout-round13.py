"""Post-seal supplemental closeout; never modifies frozen results or actor artifacts."""
import collections
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

base = Path(__file__).resolve().parent
root = base / 'runs/2026-10-18-scheduler-contract-round13-final'
load = lambda p: json.loads(p.read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
manifest = load(root / 'manifest.json')
summary = load(root / 'summary.json')
reviews = load(root / 'report-reviews.json')
revision = '--revision1' in sys.argv
assert len(reviews) == 54 and all(r.get('readFinalReport') or r.get('missingConfirmed') for r in reviews)
assert load(root / 'execution-ended.json')['allActorsEnded']

frozen_drift = [name for name, digest in manifest['implementation'].items()
                if sha(root / 'implementation' / name) != digest]
current_drift = [name for name, digest in manifest['implementation'].items()
                 if not (base.parent.parent / name).is_file() or sha(base.parent.parent / name) != digest]
frozen_driver_drift = [name for name, digest in manifest['frozenFiles'].items()
                       if sha(root / name) != digest]
global_changes = [name for name, digest in manifest['globalConfigHashes'].items()
                  if (sha(Path(name)) if Path(name).is_file() else None) != digest]
scans = [load(root / row['id'] / 'public-scope.scan.json') for row in manifest['schedule']]
classifications = []
temporary = []
private_dirs = set()
tool_call_provenance = {}
argument_candidates = []
absolute = re.compile(r"(?<![a-zA-Z0-9_])/(?:Users|private|tmp|var|etc|home|root|opt|Applications)/[^\s\"'<>;|,)]+")
protected = re.compile(r'grade\.py|case-manifest|\.pi/agent|models\.json|auth\.json|printenv|os\.environ|https?://|\b(?:curl|wget)\b')

for row in manifest['schedule']:
    directory = root / row['id']
    workspace = str(directory.resolve() / 'workspace')
    launch_files = [directory / 'launch.json', *sorted((directory / 'phases').glob('*/launch.json'))]
    for path in launch_files:
        if not path.is_file():
            continue
        launch = load(path)
        if launch.get('privateCredentialDirectory'):
            private_dirs.add(launch['privateCredentialDirectory'])
        assert launch.get('credentialFilesArchived') is not True
    for path in sorted((directory / 'sessions').glob('*.jsonl')):
        for line_number, line in enumerate(path.open(), 1):
            try:
                event = json.loads(line)
            except ValueError:
                continue
            message = event.get('message') or {}
            content = message.get('content')
            if not isinstance(content, list):
                continue
            for block in content:
                if not isinstance(block, dict) or block.get('type') != 'toolCall':
                    continue
                key = (row['id'], block.get('id'))
                tool_call_provenance[key] = {
                    'ledger': str(path.relative_to(root)), 'line': line_number,
                    'ledgerRecordTimestamp': event.get('timestamp'),
                    'messageTimestamp': message.get('timestamp'),
                }
    for tool in load(directory / 'initial.tools.json'):
        raw = json.dumps(tool.get('arguments') or {}, ensure_ascii=False).replace('\\n', '\n')
        paths = sorted(set(p for p in absolute.findall(raw)
                           if not p.startswith(workspace) and p != '/opt/homebrew/bin/bash'))
        patterns = sorted(set(protected.findall(raw)))
        if paths or patterns:
            argument_candidates.append({'actor': row['id'], 'toolId': tool['id'],
                                        'outsideAbsoluteLiterals': paths, 'protectedOrNetworkPatterns': patterns})

for scan in scans:
    for entry in scan['flagged']:
        value = entry['input']
        key = entry['toolId'].split(':')[-1]
        paths = sorted(set(re.findall(r'/tmp/[^\s\"\'<>;|,)]+', value)))
        if paths:
            classification = 'real_shared_tmp_write_or_remove'
            for path in paths:
                writes = bool(re.search(r'>\s*' + re.escape(path) + r'(?:\s|$)', value))
                removes = bool(re.search(r'\brm\s+-f\s+' + re.escape(path) + r'(?:\s|;|$)', value))
                reads = bool(re.search(r'\b(?:cat|tail)\s+(?:-[^\s]+\s+)?' + re.escape(path) + r'(?:\s|;|$)', value))
                assert writes or removes
                temporary.append({'actor': scan['id'], 'toolId': entry['toolId'], 'path': path,
                                  'write': writes, 'remove': removes, 'read': reads,
                                  'sameCommandOwnStdoutRedirectBeforeRead': writes and reads,
                                  'commandSHA256': hashlib.sha256(value.encode()).hexdigest(),
                                  'publicToolStatus': entry.get('status'),
                                  **tool_call_provenance.get((scan['id'], key), {})})
        elif '../evidence/' in value:
            assert re.search(r'\bcd\s+\.tmp\b', value)
            classification = 'own_workspace_evidence_from_tmp_subdirectory'
        elif re.search(r'\.parent\.name', value):
            classification = 'python_parent_name_false_positive'
        elif 'Path(__file__).resolve().parent' in value:
            classification = 'generated_script_own_directory_false_positive'
        else:
            assert set(entry['flags']) == {'cwd-change'}
            classification = 'own_workspace_cwd_or_python_identifier_false_positive'
        classifications.append({'actor': scan['id'], 'toolId': entry['toolId'],
                                'classification': classification,
                                'sourceScan': str((root / scan['id'] / 'public-scope.scan.json').relative_to(root))})

by_path = collections.defaultdict(set)
for entry in temporary:
    by_path[entry['path']].add(entry['actor'])
cross_actor_paths = {path: sorted(actors) for path, actors in by_path.items() if len(actors) > 1}
assert not cross_actor_paths
assert all(not row['protectedOrNetworkPatterns'] for row in argument_candidates)
assert all(row['outsideAbsoluteLiterals'] and all(path.startswith('/tmp/') for path in row['outsideAbsoluteLiterals'])
           for row in argument_candidates)

changes = {}
for model, arms in summary['groups'].items():
    native, cairn = arms['native'], arms['cairn']
    changes[model] = {
        'tokensChangePct': (cairn['recordedTokens'] / native['recordedTokens'] - 1) * 100,
        'completedMedianSecondsChangePct': (cairn['completedTime']['median'] / native['completedTime']['median'] - 1) * 100,
        'tokenCVNative': native['tokens']['cv'], 'tokenCVCairn': cairn['tokens']['cv'],
        'completedTokenCVNative': native['completedTokens']['cv'], 'completedTokenCVCairn': cairn['completedTokens']['cv'],
    }

credential_receipts = load(root / 'credential-cleanup-review.json') if revision else None
launch_private_directory_count = len(private_dirs)
if credential_receipts:
    for row in credential_receipts['rows']:
        private_dirs.add(row['path'])

result = {
    'createdAt': datetime.now(timezone.utc).isoformat(),
    'method': 'Supplement after all public-report acknowledgements were sealed. Public tool arguments, argv/launch paths, native tool-call receipt timestamps and source hashes only. Frozen outcomes and grading definitions are unchanged. Static literal review is not an OS isolation proof.',
    'scriptSHA256': sha(Path(__file__)), 'manifestSHA256': sha(root / 'manifest.json'),
    'summarySHA256': sha(root / 'summary.json'), 'sealedReportsSHA256': sha(root / 'report-reviews.json'),
    'actors': len(manifest['schedule']), 'allActorsEnded': True,
    'presentReports': sum(bool(row.get('readFinalReport')) for row in reviews),
    'missingReportsConfirmed': sum(bool(row.get('missingConfirmed')) for row in reviews),
    'frozenImplementationDrift': frozen_drift, 'frozenDriverDrift': frozen_driver_drift,
    'currentWorkspaceImplementationDrift': current_drift, 'globalConfigChanges': global_changes,
    'actorsWithProtectedInputChanges': [row['id'] for row in summary['rows'] if row['unexpectedInputChanges']],
    'privateCredentialDirectories': {'count': len(private_dirs), 'stillPresent': sorted(p for p in private_dirs if Path(p).exists()),
                                     'credentialsArchived': False,
                                     'launchMetadataDirectoryCount': launch_private_directory_count,
                                     'cleanupReceipts': len(credential_receipts['rows']) if credential_receipts else None,
                                     'uniqueReceiptDirectories': len(set(row['path'] for row in credential_receipts['rows'])) if credential_receipts else None,
                                     'receiptDirectoriesByHost': {host: len(set(row['path'] for row in credential_receipts['rows'] if row['host'] == host)) for host in ['pi', 'codex']} if credential_receipts else None,
                                     'method': 'Union of Pi launch privateCredentialDirectory and all native CLI cleanup receipt paths; Codex launch metadata omits its private directory, so cleanup receipt path is required.' if revision else 'Pi launch privateCredentialDirectory only; Codex launch metadata has no corresponding field.'},
    'scope': {
        'indexedCommandsAndPaths': sum(len(scan['entries']) for scan in scans),
        'flaggedCandidates': len(classifications),
        'classifications': dict(collections.Counter(row['classification'] for row in classifications)),
        'candidateReviews': classifications,
        'allToolArgumentLiteralCandidates': argument_candidates,
        'sharedTemporary': temporary,
        'sharedTmpActors': sorted(set(row['actor'] for row in temporary)),
        'sharedTmpWriteCommands': sum(row['write'] for row in temporary),
        'sharedTmpRemoveCommands': sum(row['remove'] for row in temporary),
        'sharedTmpUniquePaths': len(by_path),
        'observedCrossActorSamePath': cross_actor_paths,
        'hiddenAccessObserved': False,
        'limitations': 'Three native DeepSeek actors wrote stdout to shared /tmp instead of their task-local .tmp, and two removed the named files. Actual deviations remain in the sample. Public commands/results are consistent with reading their own preceding redirection; no other Round13 actor references those paths. Untracked external processes and dynamic/indirect access cannot be excluded. Pi has no OS sandbox. No unknown shared file was removed by this audit.',
    },
    'costVariation': changes,
    'usageReconciliation': load(root / 'context-audit.json')['accountingDisagreements'],
    'nativeCheckFailures': summary['nativeCheckFailures'],
    'limitations': ['No real formal Reason/Explore requests occurred; that path is covered by scripted fixtures only.',
                    'GLM has a service-window interruption. All-attempt CV includes incomplete zero-recorded-usage attempts; completed-only statistics remain separate.',
                    'Pi failed provider requests can have unreported usage, so recorded totals are lower bounds, not verified invoice costs.'],
}
if revision:
    result['supersedes'] = {'file': 'closeout-audit.json', 'sha256': sha(root / 'closeout-audit.json'),
                            'originalScript': 'closeout-audit-original.py',
                            'originalScriptSHA256': sha(root / 'closeout-audit-original.py'),
                            'correction': 'Original count43 covered only Pi launch directories. Add18 distinct Codex cleanup receipt paths:61 actual native CLI executions,61 cleanup receipts,61 unique temporary private directories (Pi43/Codex18). No raw receipt or frozen outcome changed.'}
path = root / ('closeout-audit.v2.json' if revision else 'closeout-audit.json')
assert not path.exists(), 'Preserve the first closeout result'
path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({key: value for key, value in result.items() if key not in ['scope']}, ensure_ascii=False, indent=2))
print(json.dumps({key: value for key, value in result['scope'].items() if key not in ['candidateReviews', 'allToolArgumentLiteralCandidates', 'sharedTemporary']}, ensure_ascii=False, indent=2))
