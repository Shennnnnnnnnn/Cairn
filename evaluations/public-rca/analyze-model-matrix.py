"""Post-run model matrix. Requires all actors finished before reading any label grade."""
import hashlib, json, re, sqlite3, sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUN = ROOT / 'runs' / sys.argv[1]

def load(path, default=None):
    return json.loads(path.read_text()) if path.exists() else default

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

manifest = load(RUN / 'manifest.json')
def episode_dir(slug, case, mode):
    return Path(manifest.get('episodeLocations', {}).get('/'.join([slug, case, mode]), RUN / slug / case / mode))
finished = load(RUN / 'finished.json', {})
if not finished.get('allActorsEndedBeforeGrading'):
    raise SystemExit('All actors must finish before analysis or hidden-grade reads')
checks = []

def check(name, value):
    checks.append(dict(name=name, passed=bool(value)))

specs = {m['slug']: m for m in manifest['models']}
check('four requested model IDs', {m['id'] for m in specs.values()} == {
    'global:deepseek-v4.1-flash', 'cn:step-5-preview', 'cn:glm-5.3', 'cn:kimi-k3-1'})
check('twelve unique model/arm pairs', len(manifest['order']) == 12 and len({tuple(v) for v in manifest['order']}) == 12)
for slug in specs:
    check(slug + ' has exactly three arms', {m for s, _, m in manifest['order'] if s == slug} == set(manifest['arms']))
for field in ['deadlineSeconds', 'outputTokenLimit', 'maxTokensPerResponse', 'hostReserveMs']:
    check('no evaluation ' + field, manifest[field] is None)
runner = (RUN / 'runner.frozen.mjs').read_text()
check('no actor watchdog', 'setTimeout' not in runner)
check('no actor maxTokens rewrite', not re.search(r'\.maxTokens\s*=', runner))
check('deadline/reserve removed', 'delete env.CAIRN_DEADLINE;delete env.CAIRN_SUBMIT_RESERVE_MS;' in runner)
check('runner hash', digest(RUN / 'runner.frozen.mjs') == manifest['runnerHash'])
check('protocol hash', digest(RUN / 'protocol.before.md') == manifest['protocolHash'])
check('prompt hash', digest(RUN / 'prompt.frozen.txt') == manifest['promptHash'])
check('source manifest hash', digest(RUN / 'case-manifest.json') == manifest['sourceManifestHash'])
check('identifier policy hash', digest(RUN / 'identifier-policy.json') == manifest['identifierPolicyHash'])
check('neutral experiment root', not re.search(r'memory|disk[_-]?io|network|cartservice', RUN.name, re.I))
check('preflight provenance hash', digest(RUN / 'preflight-probes.json') == manifest['preflightProbeHash'])
check('single selected case', {c for _, c, _ in manifest['order']} == {'case-03'})
if manifest.get('parallelAmendment'):
    finalization = load(RUN / 'combined-finalization.json')
    amendment = load(RUN / manifest['parallelAmendment'])
    check('parallel amendment recorded before new actors', bool(amendment.get('at')))
    check('parallel amendment hash', digest(RUN / manifest['parallelAmendment']) == finalization['amendmentSha256'])
    check('global completion barrier', finalization['allActorsEndedBeforeGrading'])
    check('public report reviews frozen before grading', finalization['allPublicReportReviewsBeforeGrading'] and digest(RUN / 'qualitative-audit.json') == finalization['qualitativeAuditSha256'])
    check('at most three concurrent actors', finalization['maxConcurrentActors'] <= 3)
    check('original host drained without interrupting actor', load(RUN / 'original-runner-drained.json').get('actorInterrupted') is False)
    for lane in finalization['laneProvenance']:
        lane_root = Path(lane['root'])
        lm = load(lane_root / 'manifest.json')
        check(lane['modelSlug'] + ' lane manifest hash', digest(lane_root / 'manifest.json') == lane['manifestSha256'])
        check(lane['modelSlug'] + ' lane runner hash', digest(lane_root / 'runner.frozen.mjs') == lane['runnerSha256'] == lm['runnerHash'])
        check(lane['modelSlug'] + ' lane frozen protocol hash', digest(lane_root / 'protocol.before.md') == lane['protocolSha256'] == lm['protocolHash'])
        check(lane['modelSlug'] + ' lane no early grading marker', not (lane_root / 'finished.json').exists())
        lane_runner = (lane_root / 'runner.frozen.mjs').read_text()
        check(lane['modelSlug'] + ' no actor watchdog or maxTokens rewrite', 'setTimeout' not in lane_runner and not re.search(r'\.maxTokens\s*=', lane_runner))
        for key in ['models', 'cases', 'archiveHashesByArm', 'registeredModelLimits', 'budgetPolicy', 'commonSystemPromptHash', 'cairnGuidanceHash', 'promptHash']:
            check(lane['modelSlug'] + ' lane shared ' + key, lm[key] == manifest[key])
        for mode, files in lm['archiveHashesByArm'].items():
            archive = lane_root / (lm['previousImplementationArchive'] if mode == 'pi-cairn-previous' else lm['implementationArchive'])
            for name, expected in files.items():
                check(lane['modelSlug'] + '/' + mode + ' frozen ' + name, digest(archive / name) == expected)
for name, key in [('verify-artifacts.mjs', 'verifierHash'), ('verify-reproduction.py', 'numericVerifierHash'),
                  ('verify-submission.mjs', 'compositionVerifierHash'), ('grade.py', 'graderHash'),
                  ('reproduction-contract.md', 'reproductionContractHash')]:
    check('shared ' + name + ' unchanged', digest(ROOT / name) == manifest[key])
baseline = load(ROOT / 'runs' / manifest['baselineRun'] / 'manifest.json')
for mode, entries in manifest['archiveHashesByArm'].items():
    archive = RUN / (manifest['previousImplementationArchive'] if mode == 'pi-cairn-previous' else manifest['implementationArchive'])
    check(mode + ' matches previous frozen implementation', entries == baseline['archiveHashesByArm'][mode])
    for name, sha in entries.items():
        check(mode + ' frozen ' + name, digest(archive / name) == sha)

end_time = max(datetime.fromisoformat(load(episode_dir(s, c, m) / 'initial.metrics.json')['finishedAt'].replace('Z', '+00:00')).timestamp()
               for s, c, m in manifest['order'])
cairn_guidance = re.search(r"const cairnInitial='([^']*)';", runner).group(1)
common = re.search(r"const common='([^']*)';", runner).group(1)
check('common system prompt hash', hashlib.sha256(common.encode()).hexdigest() == manifest['commonSystemPromptHash'])
check('common Cairn guidance hash', hashlib.sha256(cairn_guidance.encode()).hexdigest() == manifest['cairnGuidanceHash'])
first_slug, first_case, first_mode = manifest['order'][0]
task_template = (episode_dir(first_slug, first_case, first_mode) / 'workspace/TASK.md').read_bytes()
task_suffix = b'\n\n' + (RUN / 'reproduction-contract.frozen.md').read_bytes()
check('actual TASK has frozen reproduction suffix', task_template.endswith(task_suffix))
check('actual TASK origin matches pre-run case hash', task_template.endswith(task_suffix) and
      hashlib.sha256(task_template[:-len(task_suffix)]).hexdigest() == manifest['cases'][first_case]['TASK.md'])
task_hash = hashlib.sha256(task_template).hexdigest()

def accepted(task, directory):
    verification = task.get('verification', {})
    if task['status'] != 'completed' or verification.get('status') != 'passed':
        return False
    if verification.get('epoch') != task['owner']['epoch'] or verification.get('verifier') != task.get('completionVerifier'):
        return False
    for required in manifest['artifactRequirements']:
        path = str((Path(task['owner']['cwd']) / required).resolve())
        artifact = next((a for a in task.get('artifacts', []) if a['path'] == path), None)
        snapshot = directory / ('initial.' + required)
        if not artifact or not snapshot.is_file() or digest(snapshot) != artifact['sha256']:
            return False
    return True

rows = []
for slug, case, mode in manifest['order']:
    d = episode_dir(slug, case, mode)
    spec = specs[slug]
    metric, grade = load(d / 'initial.metrics.json'), load(d / 'initial.grade.json', {})
    if slug in ['glm', 'kimi'] and manifest.get('parallelAmendment'):
        check(slug + '/' + mode + ' starts after user parallel amendment', datetime.fromisoformat(metric['startedAt'].replace('Z', '+00:00')) >= datetime.fromisoformat(amendment['at']))
    tasks, tools = load(d / 'initial.cairn-tasks.json', []), load(d / 'initial.tools.json', [])
    replay = load(d / 'initial.acceptance.json', {})
    tag = slug + '/' + mode
    check(tag + ' grade created after last actor', (d / 'initial.grade.json').stat().st_mtime >= end_time)
    check(tag + ' requested provider/model', metric['requestedProvider'] == spec['provider'] and metric['requestedModel'] == spec['id'])
    check(tag + ' reported model ID', not metric['actualModels'] or metric['actualModels'] == [spec['provider'] + '/' + spec['id']])
    check(tag + ' reported thinking', not metric['actualThinkingLevels'] or metric['actualThinkingLevels'] == [spec['thinking']])
    check(tag + ' actual prompt', (d / 'initial.prompt.txt').read_text() == (RUN / 'prompt.frozen.txt').read_text() + (cairn_guidance if mode != 'pi' else ''))
    check(tag + ' no evaluator interruption', not metric['timedOut'] and not metric['budgetExceeded'])
    check(tag + ' no recovery run', not (d / 'recovery.metrics.json').exists())
    launch = load(d / 'launch.json')
    check(tag + ' isolated temporary directory', launch['tmpdir'] == str(d / 'workspace/.tmp') and launch['model'] == spec)
    check(tag + ' neutral visible workspace path', not re.search(r'memory|disk[_-]?io|network|cartservice', str(d / 'workspace'), re.I))
    check(tag + ' same full TASK and reproduction contract', digest(d / 'workspace/TASK.md') == task_hash)
    for name, sha in load(d / 'input-hashes.json', {}).items():
        check(tag + ' input ' + name, (d / 'workspace' / name).is_file() and digest(d / 'workspace' / name) == sha)
    for name, sha in manifest['cases'][case].items():
        if name.startswith('evidence/'):
            check(tag + ' original evidence ' + name, digest(d / 'workspace' / name) == sha)
    natural = metric['exitCode'] == 0 and metric.get('finalStopReason') == 'stop'
    artifacts_present = all((d / ('initial.' + f)).is_file() for f in manifest['artifactRequirements'])
    complete = natural and (any(accepted(t, d) for t in tasks) if mode != 'pi' else bool(grade.get('validAnswer')) and artifacts_present)
    row = dict(model=spec['id'], modelSlug=slug, case=case, mode=mode, episodeDirectory=str(d), metrics=metric, grade=grade, acceptance=replay,
               naturalTermination=natural, artifactsPresent=artifacts_present, completed=complete,
               correctDelivery=bool(complete and replay.get('ok') and grade.get('jointTop1')),
               falseCompletion=bool(complete and not grade.get('jointTop1')), tasks=tasks,
               providerErrors=0, nativeRetries=0, retryOutcomes=[], checkpoints=0, findingCheckpoints=0,
               maxResponseOutput=0, responseLengthEvents=0, maxAssistantDurationMs=0, compactions=0,
               toolErrorsByName={}, explicitBlackboardReads=sum(t['name'] == 'cairn_read' for t in tools),
               finishCalls=[], handoffs=[], scopeCandidates=[], filesystemToolTargets=[])
    declared = {t['id']: t for t in tools}
    cumulative_output, output_at_call = 0, {}
    for line in (d / 'initial.jsonl').read_text().splitlines():
        try:
            event = json.loads(line)
        except ValueError:
            continue
        if event.get('type') == 'auto_retry_start':
            row['nativeRetries'] += 1
        if event.get('type') == 'auto_retry_end':
            row['retryOutcomes'].append({k: event[k] for k in ['attempt', 'success', 'error'] if k in event})
        if event.get('type') == 'auto_compaction_start':
            row['compactions'] += 1
        if event.get('type') == 'tool_execution_end' and event.get('isError'):
            name = event.get('toolName', 'unknown')
            row['toolErrorsByName'][name] = row['toolErrorsByName'].get(name, 0) + 1
        message = event.get('message', {})
        if event.get('type') == 'message_end' and message.get('role') == 'assistant':
            output = message.get('usage', {}).get('output', 0)
            cumulative_output += output
            row['maxResponseOutput'] = max(row['maxResponseOutput'], output)
            row['maxAssistantDurationMs'] = max(row['maxAssistantDurationMs'], message.get('durationMs', 0))
            row['providerErrors'] += int(message.get('stopReason') == 'error')
            row['responseLengthEvents'] += int(message.get('stopReason') == 'length')
            for part in message.get('content', []):
                if part.get('type') == 'toolCall':
                    output_at_call[part['id']] = cumulative_output
        if event.get('type') == 'tool_execution_end' and event.get('toolName') == 'cairn_checkpoint' and not event.get('isError'):
            row['checkpoints'] += 1
            args = declared.get(event.get('toolCallId'), {}).get('arguments', {})
            if args.get('findings'):
                row['findingCheckpoints'] += 1
                row.setdefault('firstFindingCheckpointOutputTokens', output_at_call.get(event.get('toolCallId')))
        if event.get('type') == 'tool_execution_end' and event.get('toolName') == 'cairn_finish':
            text = '\n'.join(c.get('text', '') for c in event.get('result', {}).get('content', []) if c.get('type') == 'text')
            try:
                receipt = json.loads(text)
            except ValueError:
                receipt = {}
            row['finishCalls'].append(dict(error=bool(event.get('isError')), phase=receipt.get('phase'),
                                            verification=receipt.get('verification')))
    for call in tools:
        if call['name'] in ['read', 'write', 'edit']:
            args = call.get('arguments', {})
            target = args.get('path') or args.get('file_path')
            if target:
                resolved = (d / 'workspace' / target).resolve()
                row['filesystemToolTargets'].append(dict(tool=call['name'], target=target, resolved=str(resolved),
                                                         insideWorkspace=resolved.is_relative_to((d / 'workspace').resolve())))
        if call['name'] == 'cairn_finish':
            row.setdefault('finishPayloadBytes', []).append(len(json.dumps(call.get('arguments', {}), ensure_ascii=False, separators=(',', ':')).encode()))
        if call['name'] == 'bash':
            command = call.get('arguments', {}).get('command', '')
            if re.search(r'/tmp/|/Users/|\.\./|https?://|curl\s|wget\s|/proc/', command):
                row['scopeCandidates'].append(dict(toolCallId=call['id'], command=command))
    if row['compactions']:
        metric['usageIsLowerBound'] = True
        row['usageCaveat'] = 'Native compaction may use internal requests not represented in message_end usage; counts are a lower bound'
    for task in tasks:
        check(tag + ' no task budget', not task.get('budget'))
        check(tag + ' required artifacts', task.get('artifactRequirements') == manifest['artifactRequirements'])
        argv = [v.replace('<episode>', str(d)) for v in manifest['verifierCommand']]
        verifier = 'command:' + hashlib.sha256(json.dumps(dict(argv=argv, artifacts=manifest['artifactRequirements']), separators=(',', ':')).encode()).hexdigest()
        check(tag + ' verifier identity', task.get('completionVerifier') == verifier)
        row['handoffs'].extend(task.get('handoffs', []))
    row['handoffsWithSourceAndClaims'] = sum(bool(h.get('source')) and bool(h.get('from')) for h in row['handoffs'])
    row['savedHandoffReports'] = sum(bool(h.get('source')) and bool(h.get('from')) and bool(h.get('detail')) and bool(h.get('report')) and (d / 'workspace' / h['report']).is_file() for h in row['handoffs'])
    db = d / 'workspace/.cairn/state.db'
    if db.exists():
        with sqlite3.connect(db.as_uri() + '?mode=ro', uri=True) as sql:
            milestones = sql.execute("SELECT at,payload FROM events WHERE kind='task.checkpoint' ORDER BY seq").fetchall()
        row['persistedCheckpoints'] = len(milestones)
        row['firstCheckpointSeconds'] = (datetime.fromisoformat(milestones[0][0].replace('Z', '+00:00')) - datetime.fromisoformat(metric['startedAt'].replace('Z', '+00:00'))).total_seconds() if milestones else None
    rows.append(row)

by_model = {}
for slug in specs:
    selected = [r for r in rows if r['modelSlug'] == slug]
    by_model[slug] = dict(completed=sum(r['completed'] for r in selected), correctDelivery=sum(r['correctDelivery'] for r in selected),
                          falseCompletion=sum(r['falseCompletion'] for r in selected), count=len(selected),
                          wallSeconds=sum(r['metrics']['wallSeconds'] for r in selected),
                          reportedTotalTokens=sum(r['metrics']['usage']['totalTokens'] for r in selected))
summary = dict(manifest=manifest, results=rows, byModel=by_model, audit=dict(passed=sum(c['passed'] for c in checks),
               total=len(checks), failures=[c for c in checks if not c['passed']]), checks=checks,
               analysisHash=digest(Path(__file__)), finished=finished)
(RUN / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
print(json.dumps(dict(byModel=by_model, audit=summary['audit']), ensure_ascii=False, indent=2))
if summary['audit']['failures']:
    raise SystemExit(1)
