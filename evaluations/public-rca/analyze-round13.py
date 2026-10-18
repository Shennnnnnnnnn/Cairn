"""Metadata, usage and delivery accounting; hidden labels require review barrier."""
import json, hashlib, collections, statistics, math, subprocess, re
from datetime import datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parent/'runs/2026-10-18-scheduler-contract-round13-final'
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def http_status(value):
    """Read HTTP status prefixes/structured fields, never arbitrary digit substrings."""
    if isinstance(value,dict):
        for key in ['status','statusCode','httpStatus','http_status']:
            candidate=value.get(key)
            if isinstance(candidate,(int,str)) and re.fullmatch(r'[45]\d{2}',str(candidate)):return int(candidate)
        for key in ['error','response','cause']:
            candidate=http_status(value.get(key))
            if candidate:return candidate
        return None
    if not isinstance(value,str):return None
    value=value.strip();match=re.match(r'^(?:HTTP(?:/\d(?:\.\d)?)?\s+)?([45]\d{2})(?=\s|:|$)',value,re.I)
    if match:return int(match[1])
    try:return http_status(json.loads(value))
    except (ValueError,TypeError):return None
assert sha(Path(__file__))==sha(ROOT/'analyze-round13.py'), 'Use frozen-equivalent analysis source'
manifest=load(ROOT/'manifest.json');ended=load(ROOT/'execution-ended.json')
assert ended['allActorsEnded'] and len(ended['outcomes'])==54
assert sha(ROOT/'manifest.json')==load(ROOT/'execution-started.json')['manifestSha256']
for name,digest in manifest['frozenFiles'].items():assert sha(ROOT/name)==digest, name
for name,digest in manifest['implementation'].items():assert sha(ROOT/'implementation'/name)==digest, name
for name,digest in manifest['cases'].items():assert sha(ROOT/'cases'/name)==digest, name
reviews=load(ROOT/'report-reviews.json')
for row in manifest['schedule']:
    path=ROOT/row['id']/'initial.REPORT.md';r=next(r for r in reviews if r['id']==row['id'])
    assert r['readFinalReport'] and r['sha256']==sha(path) if path.exists() else r['missingConfirmed']
if (ROOT/'finished.json').exists():raise SystemExit('Never regrade a finished batch')
barrier_path=ROOT/'grading-started.json'
if barrier_path.exists():
    barrier=load(barrier_path);assert barrier['manifestSHA256']==sha(ROOT/'manifest.json') and barrier['reportReviewsSHA256']==sha(ROOT/'report-reviews.json')
else:
    barrier={'gradingStartedAt':datetime.now().astimezone().isoformat(),'allActorsEndedAt':ended['endedAt'],'manifestSHA256':sha(ROOT/'manifest.json'),'reportReviewsSHA256':sha(ROOT/'report-reviews.json'),'allActorsEndedBeforeGrading':True,'allReportsReviewedBeforeGrading':True}
    barrier_path.write_text(json.dumps(barrier,indent=2)+'\n')
records=[];checks=[];all_threads=[]
for row in manifest['schedule']:
    directory=ROOT/row['id'];work=directory/'workspace';metric=load(directory/'initial.metrics.json');spec=next(m for m in manifest['models'] if m['slug']==row['model'])
    assert (directory/'actor-finished.json').exists()
    models=set();efforts=set();headers=[];sources={};events=collections.Counter();compactions=[];stops=[];native_errors=[];custom=collections.Counter();max_input=0;usage=None;session_usages=[]
    totals={k:0 for k in ['input','output','cacheRead','cacheWrite','totalTokens']}
    for path in sorted((directory/'sessions').glob('*.jsonl')):
        sources[path.name]=sha(path);session_usage=None
        for line in path.open():
            try:e=json.loads(line)
            except ValueError:continue
            typ=e.get('type','');events[typ]+=1
            payload_type=(e.get('payload') or {}).get('type','') if isinstance(e.get('payload'),dict) else ''
            if 'compact' in typ or 'truncat' in typ or 'compact' in payload_type or 'truncat' in payload_type:compactions.append({'type':typ,'payloadType':payload_type,'at':e.get('timestamp'),'tokensBefore':e.get('tokensBefore')})
            if typ=='session':headers.append({k:e.get(k) for k in ['id','cwd']})
            if typ=='session_meta':headers.append({k:e.get('payload',{}).get(k) for k in ['id','cwd']})
            if typ=='thinking_level_change':efforts.add(e.get('thinkingLevel'))
            if typ=='turn_context':
                payload=e.get('payload',{});models.add(payload.get('model'));efforts.add(payload.get('effort',payload.get('reasoning_effort')))
            if typ=='event_msg' and e.get('payload',{}).get('type')=='token_count':
                payload=e['payload'];session_usage=payload.get('info',{}).get('total_token_usage',session_usage)
                last=payload.get('info',{}).get('last_token_usage',{});max_input=max(max_input,last.get('input_tokens',0))
            message=e.get('message',{})
            if message.get('role')=='assistant':
                models.add(message.get('model'));stops.append(message.get('stopReason'));u=message.get('usage') or {}
                if message.get('errorMessage'):native_errors.append(message['errorMessage'])
                for k in totals:totals[k]+=u.get(k,0)
                max_input=max(max_input,u.get('input',0)+u.get('cacheRead',0)+u.get('cacheWrite',0))
            if typ=='custom_message':custom[e.get('customType','unknown')]+=1
            if message.get('role')=='custom':custom[message.get('customType','unknown')]+=1
        if session_usage is not None:session_usages.append(session_usage)
    if session_usages:usage={key:sum(value.get(key,0) for value in session_usages) for key in set().union(*(set(value) for value in session_usages))}
    for line in (directory/'initial.jsonl').open():
        try:stream_event=json.loads(line)
        except ValueError:continue
        if 'compaction' in stream_event.get('type',''):compactions.append({'type':stream_event['type'],'source':'CLI stream'})
    models.discard(None);efforts.discard(None)
    ledger=({'input_tokens':totals['input']+totals['cacheRead']+totals['cacheWrite'],'cached_input_tokens':totals['cacheRead'],'cache_write_input_tokens':totals['cacheWrite'],'output_tokens':totals['output']} if spec['host']=='pi' and headers else usage)
    expected_ids=set(metric.get('sessionIds') or [metric.get('threadId')]);expected_ids.discard(None)
    native_checks={'model':models==set(metric['actualModels']) and models.issubset({spec['id']}),'effort':efforts==set(metric['actualEfforts']) and efforts.issubset({spec['thinking']}),'identity':len(headers)==len(expected_ids) and {header['id'] for header in headers}==expected_ids and all(header['cwd']==str(work) for header in headers),'usage':ledger is not None and all(ledger.get(key,0)==(metric.get('usage') or {}).get(key,0) for key in ['input_tokens','cached_input_tokens','output_tokens'])}
    if spec['host']=='pi':native_checks['total_tokens']=totals['totalTokens']==sum(totals[key] for key in ['input','output','cacheRead','cacheWrite'])
    phase_audits=[]
    if row['arm']=='cairn':
        for phase in metric.get('phases',[]):
            phase_dir=directory/'phases'/phase['phaseId'];phase_metric=load(phase_dir/'initial.metrics.json');launch=load(phase_dir/'launch.json')
            phase_checks={'requestedModel':launch['requestedModel']==spec['id'],'requestedEffort':launch['requestedEffort']==spec['thinking'],'nativeToolsOnly':launch['implementation'] is None,'sameWorkspace':launch['workspace']==str(work),'noBudget':launch['evaluationBudgets'] is None,'resumedSession':not phase.get('resumedFrom') or phase['sessionRef']==phase['resumedFrom']}
            if spec['host']=='pi':
                terminal_stop=None
                for line in (phase_dir/'initial.jsonl').open():
                    try:event=json.loads(line)
                    except ValueError:continue
                    if event.get('type')=='message_end' and (event.get('message') or {}).get('role')=='assistant':terminal_stop=event['message'].get('stopReason')
                phase_checks['terminalStop']=terminal_stop==phase_metric.get('finalStopReason')
            phase_audits.append({'phaseId':phase['phaseId'],'sessionId':phase_metric.get('threadId'),'checks':phase_checks,'modelObserved':phase_metric.get('actualModels'),'effortObserved':phase_metric.get('actualEfforts')})
        native_checks['phase_launches']=all(all(audit['checks'].values()) for audit in phase_audits)
        native_checks['phase_count']=len(phase_audits)==metric.get('phaseCount')
    else:
        launch=load(directory/'launch.json');native_checks['requestedModel']=launch['requestedModel']==spec['id'];native_checks['requestedEffort']=launch['requestedEffort']==spec['thinking']
        if spec['host']=='pi':native_checks['terminal_stop']=bool(stops) and stops[-1]==metric.get('finalStopReason')
    # Terminal startup errors with no native inference metadata remain measured failures.
    native_audit={'id':row['id'],'method':'Native header/model/effort/usage/stop/event/custom-type metadata only; no private thinking content inspected.','sources':sources,'headers':headers,'models':sorted(models),'efforts':sorted(efforts),'usage':ledger,'maxPerRequestInputTokens':max_input,'compactions':compactions,'events':dict(events),'customTypes':dict(custom),'checks':native_checks,'phaseAudits':phase_audits,'modelRouteObservation':'observed' if models else 'unavailable before native model metadata'}
    (directory/'native-ledger-audit.json').write_text(json.dumps(native_audit,ensure_ascii=False,indent=2)+'\n')
    tools=load(directory/'initial.tools.json');acceptance=load(directory/'initial.acceptance.json');assurance=load(directory/'initial.cairn-assurance.json') if row['arm']=='cairn' else None
    components=load(directory/'initial.acceptance-components.json') if row['kind']=='rca' else {'contract':acceptance,'arithmetic':acceptance,'replayAgrees':True}
    tasks=load(directory/'initial.cairn-tasks.json') if row['arm']=='cairn' else []
    natural=metric.get('exitCode')==0 and (metric.get('finalStopReason')=='stop' if spec['host']=='pi' else not metric.get('turnFailed'))
    artifacts=['answer.json','REPORT.md','checks.json'] if row['kind']=='rca' else ['allocation.py' if row['case']=='generic-01' else 'summary.json','REPORT.md']
    present=all((directory/('initial.'+name)).is_file() and (directory/('initial.'+name)).stat().st_size>0 for name in artifacts)
    original=load(directory/'input-hashes.json')
    expected={name.split('/',1)[1]:h for name,h in manifest['cases'].items() if name.startswith(row['case']+'/')}
    if row['kind']=='rca':expected['TASK.md']=hashlib.sha256(((ROOT/'cases'/row['case']/'TASK.md').read_text()+'\n\n'+(ROOT/'reproduction-contract.frozen.md').read_text()).encode()).hexdigest()
    assert original==expected, 'Original input copy mismatch: '+row['id']
    for name in artifacts:
        if (directory/('initial.'+name)).exists():assert (work/name).is_file() and sha(directory/('initial.'+name))==sha(work/name), 'Artifact snapshot changed: '+row['id']+'/'+name
    modified=[n for n,h in original.items() if not (work/n).is_file() or sha(work/n)!=h]
    unexpected=[n for n in modified if not (row['case']=='generic-01' and n=='allocation.py')]
    if row['kind']=='rca':
        proc=subprocess.run(['/usr/bin/python3',str(ROOT/'grade.py'),row['case'],str(work)],capture_output=True,text=True,timeout=15)
        assert proc.returncode==0,proc.stderr;grade=json.loads(proc.stdout)
    else:grade={'validAnswer':bool(acceptance['ok']),'jointTop1':bool(acceptance['ok'])}
    if (directory/'initial.grade.json').exists():assert load(directory/'initial.grade.json')==grade, 'Deterministic grade changed'
    else:(directory/'initial.grade.json').write_text(json.dumps(grade,ensure_ascii=False,indent=2)+'\n')
    names=[t.get('name',t.get('tool','')) for t in tools]
    successful_reads=[t for t in tools if t.get('name',t.get('tool'))=='cairn_read' and not (t.get('isError') or t.get('error') or t.get('status')=='failed' or (t.get('result') or {}).get('isError'))]
    board={'calls':sum(n.startswith('cairn_') for n in names),'checkpoints':names.count('cairn_checkpoint'),'finishes':names.count('cairn_finish'),'targetedEvidenceReads':sum((t.get('arguments') or {}).get('view')=='evidence' and bool((t.get('arguments') or {}).get('ref')) for t in successful_reads),'contextReads':sum((t.get('arguments') or {}).get('view')=='context' for t in successful_reads),'handoffs':sum(len(t.get('handoffs',[])) for t in tasks),'savedFindings':sum(len(t.get('claims',[])) for t in tasks)}
    complete=bool(natural and present and grade['validAnswer'] and (row['arm']=='native' or assurance['completedCandidateCurrent'] and metric.get('schedulerStatus')=='completed'))
    correct=bool(grade['jointTop1']);effective=bool(complete and correct and acceptance['ok'] and not unexpected)
    accounting_diagnostics=metric.get('accountingDiagnostics') or ([metric['accountingDiagnostic']] if metric.get('accountingDiagnostic') else [])
    u=metric.get('usage') if accounting_diagnostics else ledger or metric.get('usage');known=u is not None;inp=(u or {}).get('input_tokens',0);out=(u or {}).get('output_tokens',0);cached=(u or {}).get('cached_input_tokens',0)
    errors=[e.get('message','') for e in metric.get('errors',[])];joined=' '.join(errors);terminal_message=errors[-1] if errors else ''
    if complete:reason='completed'
    elif not natural:
        if metric.get('launchError'):reason='cli_launch'
        elif metric.get('finalStopReason')=='length':reason='native_output_limit'
        elif 'context' in terminal_message.lower() and any(s in terminal_message.lower() for s in ['length','limit','exceed']):reason='context_limit'
        elif 'finish_reason' in terminal_message.lower() and 'error' in terminal_message.lower():reason='provider_termination_unspecified'
        elif http_status(terminal_message) in [401,403]:reason='authentication_or_permission'
        elif http_status(terminal_message)==429:reason='provider_quota_or_rate_limit'
        elif http_status(terminal_message) is not None and http_status(terminal_message)>=500:reason='provider_server_error'
        elif any(s in terminal_message.lower() for s in ['unauthorized','authentication_error']):reason='authentication_or_permission'
        elif any(s in terminal_message.lower() for s in ['rate limit','quota']):reason='provider_quota_or_rate_limit'
        elif 'internal server' in terminal_message.lower():reason='provider_server_error'
        elif any(s in terminal_message.lower() for s in ['connection','timed out','terminated','stream','reconnect']):reason='transport_or_service'
        else:reason='native_turn_failure_unclassified'
    elif not present:reason='missing_deliverables_after_stop'
    elif not grade['validAnswer']:reason='invalid_answer_format'
    elif assurance and not assurance['completedCandidateCurrent']:
        verification_errors=' '.join(i.get('message','') for t in tasks for i in t.get('verification',{}).get('issues',[]))
        if 'EPIPE' in verification_errors:reason='host_verifier_ipc_unavailable'
        elif not tasks:reason='cairn_not_started'
        elif any(t.get('verification',{}).get('status')=='error' for t in tasks):reason='host_verifier_unavailable'
        elif any(t.get('verification',{}).get('status')=='failed' for t in tasks):reason='host_verifier_rejected'
        else:reason='cairn_saved_state_or_acceptance'
    else:reason='unclassified'
    if not complete and row['arm']=='cairn' and natural and metric.get('schedulerStatus') not in ['completed',None]:
        scheduler_reason=str((metric.get('schedulerResult') or {}).get('reason','')).lower()
        if 'repair' in scheduler_reason and any(value in scheduler_reason for value in ['tool','action']):reason='scheduler_repair_action_rejected'
        elif 'too_big' in scheduler_reason or 'invalid_type' in scheduler_reason:reason='scheduler_phase_schema'
        elif 'findings need an explanation or file/link references' in scheduler_reason:reason='scheduler_checkpoint_grounding'
        elif any(value in scheduler_reason for value in ['invalid','json','protocol','parse','schema']):reason='scheduler_output_protocol'
        elif any(value in scheduler_reason for value in ['no progress','no_progress','unchanged','direction','intent']):reason='scheduler_no_progress_or_directions'
        elif reason not in ['host_verifier_rejected','host_verifier_unavailable','host_verifier_ipc_unavailable']:reason='scheduler_suspended_or_failed'
    cleanup=load(directory/'credential-cleanup.json');assert cleanup['removed'] and all(not Path(path).exists() for path in cleanup.get('paths',[cleanup.get('path')]) if path)
    assert load(directory/'launch.json')['evaluationBudgets'] is None and not metric['timedOut'] and not metric['budgetExceeded']
    all_threads.extend(metric.get('sessionIds') or [metric.get('threadId')])
    records.append({**row,'host':spec['host'],'validAnswer':bool(grade['validAnswer']),'prediction':(grade.get('predictions') or [None])[0],'expectedLabel':grade.get('truth'),'expectedFamily':grade.get('expectedFamily'),'actualModel':metric['actualModels'],'actualEffort':metric['actualEfforts'],'completed':complete,'correct':correct,'effectiveDelivery':effective,'validatedCorrectArtifacts':bool(present and correct and acceptance['ok'] and not unexpected),'acceptedTaskButCLIFailed':bool(assurance and assurance['completedCandidateCurrent'] and not natural),'falseCompletion':complete and not correct,'invalidCompletion':complete and not effective,'acceptancePassed':bool(acceptance['ok']),'contractPassed':bool(components['contract']['ok']),'arithmeticPassed':bool(components['arithmetic']['ok']),'acceptanceReplayAgrees':components['replayAgrees'],'naturalTermination':natural,'reason':reason,'wallSeconds':metric['wallSeconds'],'tokens':inp+out if known else None,'inputTokens':inp if known else None,'outputTokens':out if known else None,'cacheReadTokens':cached if known else None,'noncachedInputTokens':inp-cached-(u or {}).get('cache_write_input_tokens',0) if known else None,'cacheWriteTokens':(u or {}).get('cache_write_input_tokens',0) if known else None,'usageLowerBound':metric.get('usageIsLowerBound',True) or not known,'accountingDiagnostics':accounting_diagnostics,'withoutEffectiveOutput':not natural and len(tools)==0 and not any((u or {}).get(k,0) for k in ['input_tokens','output_tokens']),'blackboard':board,'toolCalls':len(tools),'toolErrors':metric['toolErrors'],'cairnToolErrors':sum((t.get('name','').startswith('cairn_') or t.get('tool','').startswith('cairn_')) and bool(t.get('isError') or t.get('error') or t.get('status')=='failed' or (t.get('result') or {}).get('isError')) for t in tools),'errors':errors,'terminalErrorMessage':terminal_message,'apiErrorMessages':len(errors),'compactions':compactions,'maxPerRequestInputTokens':max_input,'customTypes':dict(custom),'taskMarkedCompleted':any(t.get('status')=='completed' for t in tasks),'savedStateFalseCompletion':any(t.get('status')=='completed' for t in tasks) and not correct,'naturalStopMissingValidArtifacts':natural and (not present or not grade['validAnswer']),'unexpectedInputChanges':unexpected,'nativeChecks':native_checks,'acceptanceIssues':acceptance.get('issues',[]),'schedulerStatus':metric.get('schedulerStatus'),'schedulerReason':(metric.get('schedulerResult') or {}).get('reason'),'schedulerPhases':metric.get('phases',[]),'phaseCount':metric.get('phaseCount',1),'phaseErrors':metric.get('phaseErrors',0),'recovery':metric.get('recovery'),'taskStates':[{'status':t['status'],'claimCount':len(t['claims']),'verification':t.get('verification',{}).get('status'),'verificationIssues':t.get('verification',{}).get('issues',[]),'continuation':t.get('continuation')} for t in tasks]})
timeline=[]
for row in manifest['schedule']:
    mt=load(ROOT/row['id']/'initial.metrics.json')
    timeline.extend([(mt['startedAt'],1,row['model']),(mt['finishedAt'],-1,row['model'])])
active=0;max_active=0;model_active=collections.Counter()
for at,delta,model in sorted(timeline,key=lambda e:(e[0],e[1])):
    active+=delta;model_active[model]+=delta;max_active=max(max_active,active)
    assert 0<=model_active[model]<=1 and 0<=active<=3
assert active==0 and max_active==ended['maxConcurrent']
assert len([t for t in all_threads if t])==len(set(t for t in all_threads if t))
def dist(values):
    values=[v for v in values if v is not None]
    if not values:return None
    mean=statistics.mean(values);cv=statistics.stdev(values)/mean if len(values)>1 and mean else None
    return {'n':len(values),'mean':mean,'median':statistics.median(values),'min':min(values),'max':max(values),'cv':cv,'maxMinRatio':max(values)/min(values) if min(values)>0 else None}
def group(rows):
    n=len(rows);good=sum(r['effectiveDelivery'] for r in rows);tokens=sum(r['tokens'] or 0 for r in rows);seconds=sum(r['wallSeconds'] for r in rows)
    return {'n':n,'validAnswers':sum(r['validAnswer'] for r in rows),'completed':sum(r['completed'] for r in rows),'correct':sum(r['correct'] for r in rows),'effectiveDelivery':good,'validatedCorrectArtifacts':sum(r['validatedCorrectArtifacts'] for r in rows),'acceptedTasksButCLIFailed':sum(r['acceptedTaskButCLIFailed'] for r in rows),'falseCompletion':sum(r['falseCompletion'] for r in rows),'invalidCompletion':sum(r['invalidCompletion'] for r in rows),'acceptancePassed':sum(r['acceptancePassed'] for r in rows),'contractPassed':sum(r['contractPassed'] for r in rows),'arithmeticPassed':sum(r['arithmeticPassed'] for r in rows),'recordedTokens':tokens,'noncachedInputTokens':sum(r['noncachedInputTokens'] or 0 for r in rows),'outputTokens':sum(r['outputTokens'] or 0 for r in rows),'cacheReadTokens':sum(r['cacheReadTokens'] or 0 for r in rows),'cacheWriteTokens':sum(r['cacheWriteTokens'] or 0 for r in rows),'missingUsage':sum(r['tokens'] is None for r in rows),'zeroTokensAndNoToolsFailures':sum(r['withoutEffectiveOutput'] for r in rows),'usageLowerBound':any(r['usageLowerBound'] for r in rows),'totalSeconds':seconds,'tokensPerEffectiveDelivery':tokens/good if good else None,'secondsPerEffectiveDelivery':seconds/good if good else None,'time':dist([r['wallSeconds'] for r in rows]),'tokens':dist([r['tokens'] for r in rows]),'completedTime':dist([r['wallSeconds'] for r in rows if r['completed']]),'completedTokens':dist([r['tokens'] for r in rows if r['completed']]),'naturalStops':sum(r['naturalTermination'] for r in rows),'savedTasksMarkedCompleted':sum(r['taskMarkedCompleted'] for r in rows),'savedStateFalseCompletion':sum(r['savedStateFalseCompletion'] for r in rows),'naturalStopsMissingValidArtifacts':sum(r['naturalStopMissingValidArtifacts'] for r in rows),'apiErrors':sum(r['apiErrorMessages'] for r in rows),'incompleteReasons':dict(collections.Counter(r['reason'] for r in rows if not r['completed']))}
groups={spec['slug']:{arm:group([r for r in records if r['model']==spec['slug'] and r['arm']==arm and r['kind']=='rca']) for arm in ['native','cairn']} for spec in manifest['models']}
per_case={spec['slug']:{case:{arm:group([r for r in records if r['model']==spec['slug'] and r['case']==case and r['arm']==arm]) for arm in ['native','cairn']} for case in ['new-01','new-02','new-03']} for spec in manifest['models']}
summary={'groups':groups,'perCase':per_case,'schedulerPhaseUsage':{spec['slug']:{phase:{'n':len(values:=[value for row in records if row['model']==spec['slug'] for value in row['schedulerPhases'] if value['phase']==phase]),'seconds':sum(value['wallSeconds'] for value in values),'recordedTokens':sum((value.get('usage') or {}).get('input_tokens',0)+(value.get('usage') or {}).get('output_tokens',0) for value in values),'errors':sum(bool(value.get('error')) for value in values)} for phase in ['bootstrap','reason','explore','conclude']} for spec in manifest['models']},'rows':records,'manifestSHA256':sha(ROOT/'manifest.json'),'reportReviewSHA256':sha(ROOT/'report-reviews.json'),'frozenIntact':True,'globalConfigChanges':[name for name,h in manifest['globalConfigHashes'].items() if not Path(name).exists() or sha(Path(name))!=h],'nativeCheckFailures':[{'id':r['id'],'checks':r['nativeChecks']} for r in records if not all(r['nativeChecks'].values())]}
(ROOT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
(ROOT/'finished.json').write_text(json.dumps({'finishedAt':datetime.now().astimezone().isoformat(),'gradingStartedAt':barrier['gradingStartedAt'],'allActorsEndedAt':barrier['allActorsEndedAt'],'allActorsEndedBeforeGrading':True,'allPublicReportsReviewedBeforeGrading':True,'actors':len(records),'manifestSHA256':sha(ROOT/'manifest.json'),'reportReviewSHA256':sha(ROOT/'report-reviews.json')},indent=2)+'\n')
print(json.dumps({k:summary[k] for k in ['groups','schedulerPhaseUsage','globalConfigChanges','nativeCheckFailures']},ensure_ascii=False,indent=2))
