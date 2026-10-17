"""Metadata, usage and delivery accounting; hidden labels require review barrier."""
import json, hashlib, collections, statistics, math, subprocess
from datetime import datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parent/'runs/2026-10-18-five-model-round11'
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
manifest=load(ROOT/'manifest.json');ended=load(ROOT/'execution-ended.json')
assert ended['allActorsEnded'] and len(ended['outcomes'])==100
assert sha(ROOT/'manifest.json')==load(ROOT/'execution-started.json')['manifestSha256']
for name,digest in manifest['frozenFiles'].items():assert sha(ROOT/name)==digest, name
for name,digest in manifest['implementation'].items():assert sha(ROOT/'implementation'/name)==digest, name
for name,digest in manifest['cases'].items():assert sha(ROOT/'cases'/name)==digest, name
reviews=load(ROOT/'report-reviews.json')
for row in manifest['schedule']:
    path=ROOT/row['id']/'initial.REPORT.md';r=next(r for r in reviews if r['id']==row['id'])
    assert r['readFinalReport'] and r['sha256']==sha(path) if path.exists() else r['missingConfirmed']
if (ROOT/'finished.json').exists():raise SystemExit('Never regrade a finished batch')
records=[];checks=[];all_threads=[]
for row in manifest['schedule']:
    directory=ROOT/row['id'];work=directory/'workspace';metric=load(directory/'initial.metrics.json');spec=next(m for m in manifest['models'] if m['slug']==row['model'])
    assert (directory/'actor-finished.json').exists() and not (directory/'initial.grade.json').exists()
    models=set();efforts=set();headers=[];sources={};events=collections.Counter();compactions=[];stops=[];native_errors=[];custom=collections.Counter();max_input=0;usage=None
    totals={k:0 for k in ['input','output','cacheRead','cacheWrite','totalTokens']}
    for path in sorted((directory/'sessions').glob('*.jsonl')):
        sources[path.name]=sha(path)
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
                payload=e['payload'];usage=payload.get('info',{}).get('total_token_usage',usage)
                last=payload.get('info',{}).get('last_token_usage',{});max_input=max(max_input,last.get('input_tokens',0))
            message=e.get('message',{})
            if message.get('role')=='assistant':
                models.add(message.get('model'));stops.append(message.get('stopReason'));u=message.get('usage') or {}
                if message.get('errorMessage'):native_errors.append(message['errorMessage'])
                for k in totals:totals[k]+=u.get(k,0)
                max_input=max(max_input,u.get('input',0)+u.get('cacheRead',0)+u.get('cacheWrite',0))
            if typ=='custom_message':custom[e.get('customType','unknown')]+=1
            if message.get('role')=='custom':custom[message.get('customType','unknown')]+=1
    models.discard(None);efforts.discard(None)
    ledger=({'input_tokens':totals['input']+totals['cacheRead']+totals['cacheWrite'],'cached_input_tokens':totals['cacheRead'],'cache_write_input_tokens':totals['cacheWrite'],'output_tokens':totals['output']} if spec['host']=='pi' and headers else usage)
    native_checks={'model':models==set(metric['actualModels'])=={spec['id']},'effort':efforts==set(metric['actualEfforts'])=={spec['thinking']},'identity':len(headers)==1 and headers[0]['id']==metric['threadId'] and headers[0]['cwd']==str(work),'usage':ledger is not None and all(ledger.get(k,0)==(metric.get('usage') or {}).get(k,0) for k in ['input_tokens','cached_input_tokens','output_tokens'])}
    if spec['host']=='pi':native_checks['terminal_stop']=bool(stops) and stops[-1]==metric.get('finalStopReason');native_checks['total_tokens']=totals['totalTokens']==sum(totals[k] for k in ['input','output','cacheRead','cacheWrite'])
    # Terminal startup errors with no native inference metadata remain measured failures.
    native_audit={'id':row['id'],'method':'Native header/model/effort/usage/stop/event/custom-type metadata only; no private thinking content inspected.','sources':sources,'headers':headers,'models':sorted(models),'efforts':sorted(efforts),'usage':ledger,'maxPerRequestInputTokens':max_input,'compactions':compactions,'events':dict(events),'customTypes':dict(custom),'checks':native_checks}
    (directory/'native-ledger-audit.json').write_text(json.dumps(native_audit,ensure_ascii=False,indent=2)+'\n')
    tools=load(directory/'initial.tools.json');acceptance=load(directory/'initial.acceptance.json');assurance=load(directory/'initial.cairn-assurance.json') if row['arm']=='cairn' else None
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
    (directory/'initial.grade.json').write_text(json.dumps(grade,ensure_ascii=False,indent=2)+'\n')
    complete=bool(natural and present and grade['validAnswer'] and (row['arm']=='native' or assurance['completedCandidateCurrent']))
    correct=bool(grade['jointTop1']);effective=bool(complete and correct and acceptance['ok'] and not unexpected)
    u=ledger or metric.get('usage');known=u is not None;inp=(u or {}).get('input_tokens',0);out=(u or {}).get('output_tokens',0);cached=(u or {}).get('cached_input_tokens',0)
    errors=[e.get('message','') for e in metric.get('errors',[])];joined=' '.join(errors)
    if complete:reason='completed'
    elif not natural:
        if 'context' in joined.lower() and any(s in joined.lower() for s in ['length','limit','exceed']):reason='context_limit'
        elif any(s in joined.lower() for s in ['connection','timed out','429','503','terminated','stream','reconnect']):reason='transport_or_service'
        elif metric.get('launchError'):reason='cli_launch'
        elif metric.get('finalStopReason')=='length':reason='native_output_limit'
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
    cleanup=load(directory/'credential-cleanup.json');assert cleanup['removed'] and not Path(cleanup['path']).exists()
    assert load(directory/'launch.json')['evaluationBudgets'] is None and not metric['timedOut'] and not metric['budgetExceeded']
    all_threads.append(metric.get('threadId'))
    records.append({**row,'host':spec['host'],'validAnswer':bool(grade['validAnswer']),'actualModel':metric['actualModels'],'actualEffort':metric['actualEfforts'],'completed':complete,'correct':correct,'effectiveDelivery':effective,'falseCompletion':complete and not correct,'invalidCompletion':complete and not effective,'acceptancePassed':bool(acceptance['ok']),'naturalTermination':natural,'reason':reason,'wallSeconds':metric['wallSeconds'],'tokens':inp+out if known else None,'inputTokens':inp if known else None,'outputTokens':out if known else None,'cacheReadTokens':cached if known else None,'noncachedInputTokens':inp-cached-(u or {}).get('cache_write_input_tokens',0) if known else None,'cacheWriteTokens':(u or {}).get('cache_write_input_tokens',0) if known else None,'usageLowerBound':metric.get('usageIsLowerBound',True) or not known,'toolCalls':len(tools),'toolErrors':metric['toolErrors'],'cairnToolErrors':sum((t.get('name','').startswith('cairn_') or t.get('tool','').startswith('cairn_')) and bool(t.get('isError') or t.get('error') or t.get('status')=='failed' or (t.get('result') or {}).get('isError')) for t in tools),'errors':errors,'apiErrorMessages':len(errors),'compactions':compactions,'maxPerRequestInputTokens':max_input,'customTypes':dict(custom),'taskMarkedCompleted':any(t.get('status')=='completed' for t in tasks),'savedStateFalseCompletion':any(t.get('status')=='completed' for t in tasks) and not correct,'naturalStopMissingValidArtifacts':natural and (not present or not grade['validAnswer']),'unexpectedInputChanges':unexpected,'nativeChecks':native_checks,'acceptanceIssues':acceptance.get('issues',[]),'taskStates':[{'status':t['status'],'claimCount':len(t['claims']),'verification':t.get('verification',{}).get('status'),'verificationIssues':t.get('verification',{}).get('issues',[]),'continuation':t.get('continuation')} for t in tasks]})
timeline=[]
for row in manifest['schedule']:
    mt=load(ROOT/row['id']/'initial.metrics.json')
    timeline.extend([(mt['startedAt'],1,row['model']),(mt['finishedAt'],-1,row['model'])])
active=0;max_active=0;model_active=collections.Counter()
for at,delta,model in sorted(timeline,key=lambda e:(e[0],e[1])):
    active+=delta;model_active[model]+=delta;max_active=max(max_active,active)
    assert 0<=model_active[model]<=1 and 0<=active<=5
assert active==0 and max_active==ended['maxConcurrent']
assert len([t for t in all_threads if t])==len(set(t for t in all_threads if t))
def dist(values):
    values=[v for v in values if v is not None]
    if not values:return None
    mean=statistics.mean(values);cv=statistics.stdev(values)/mean if len(values)>1 and mean else None
    return {'n':len(values),'mean':mean,'median':statistics.median(values),'min':min(values),'max':max(values),'cv':cv,'maxMinRatio':max(values)/min(values) if min(values)>0 else None}
def group(rows):
    n=len(rows);good=sum(r['effectiveDelivery'] for r in rows);tokens=sum(r['tokens'] or 0 for r in rows);seconds=sum(r['wallSeconds'] for r in rows)
    return {'n':n,'validAnswers':sum(r['validAnswer'] for r in rows),'completed':sum(r['completed'] for r in rows),'correct':sum(r['correct'] for r in rows),'effectiveDelivery':good,'falseCompletion':sum(r['falseCompletion'] for r in rows),'invalidCompletion':sum(r['invalidCompletion'] for r in rows),'acceptancePassed':sum(r['acceptancePassed'] for r in rows),'recordedTokens':tokens,'noncachedInputTokens':sum(r['noncachedInputTokens'] or 0 for r in rows),'outputTokens':sum(r['outputTokens'] or 0 for r in rows),'cacheReadTokens':sum(r['cacheReadTokens'] or 0 for r in rows),'cacheWriteTokens':sum(r['cacheWriteTokens'] or 0 for r in rows),'missingUsage':sum(r['tokens'] is None for r in rows),'usageLowerBound':any(r['usageLowerBound'] for r in rows),'totalSeconds':seconds,'tokensPerEffectiveDelivery':tokens/good if good else None,'secondsPerEffectiveDelivery':seconds/good if good else None,'time':dist([r['wallSeconds'] for r in rows]),'tokens':dist([r['tokens'] for r in rows]),'completedTime':dist([r['wallSeconds'] for r in rows if r['completed']]),'completedTokens':dist([r['tokens'] for r in rows if r['completed']]),'naturalStops':sum(r['naturalTermination'] for r in rows),'savedTasksMarkedCompleted':sum(r['taskMarkedCompleted'] for r in rows),'savedStateFalseCompletion':sum(r['savedStateFalseCompletion'] for r in rows),'naturalStopsMissingValidArtifacts':sum(r['naturalStopMissingValidArtifacts'] for r in rows),'apiErrors':sum(r['apiErrorMessages'] for r in rows),'incompleteReasons':dict(collections.Counter(r['reason'] for r in rows if not r['completed']))}
groups={spec['slug']:{arm:group([r for r in records if r['model']==spec['slug'] and r['arm']==arm and r['kind']=='rca']) for arm in ['native','cairn']} for spec in manifest['models']}
per_case={spec['slug']:{case:{arm:group([r for r in records if r['model']==spec['slug'] and r['case']==case and r['arm']==arm]) for arm in ['native','cairn']} for case in ['new-01','new-02','new-03']} for spec in manifest['models']}
summary={'groups':groups,'perCase':per_case,'generic':{s['slug']:group([r for r in records if r['model']==s['slug'] and r['kind']=='generic']) for s in manifest['models']},'rows':records,'manifestSHA256':sha(ROOT/'manifest.json'),'reportReviewSHA256':sha(ROOT/'report-reviews.json'),'frozenIntact':True,'globalConfigChanges':[name for name,h in manifest['globalConfigHashes'].items() if not Path(name).exists() or sha(Path(name))!=h],'nativeCheckFailures':[{'id':r['id'],'checks':r['nativeChecks']} for r in records if not all(r['nativeChecks'].values())]}
(ROOT/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
(ROOT/'finished.json').write_text(json.dumps({'finishedAt':datetime.now().astimezone().isoformat(),'allActorsEndedBeforeGrading':True,'allPublicReportsReviewedBeforeGrading':True,'actors':len(records),'manifestSHA256':sha(ROOT/'manifest.json'),'reportReviewSHA256':sha(ROOT/'report-reviews.json')},indent=2)+'\n')
print(json.dumps({k:summary[k] for k in ['groups','generic','globalConfigChanges','nativeCheckFailures']},ensure_ascii=False,indent=2))
