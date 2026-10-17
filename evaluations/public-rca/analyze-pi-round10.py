"""Descriptive repeated-case comparison. Reads only host results and public metadata."""
import hashlib,json,math,statistics
from datetime import datetime
from pathlib import Path
HERE=Path(__file__).resolve().parent
RUN=HERE/'runs/2026-10-18-pi-deepseek-round10-repeated'
def load(path):return json.loads(path.read_text())
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
manifest=load(RUN/'manifest.json');finish=load(RUN/'finished.json');audit=[]
if not finish['allActorsEndedBeforeGrading'] or not finish['allPublicReportsReviewedBeforeGrading']:raise SystemExit('Global finalization required')
def check(name,ok):audit.append(dict(name=name,passed=bool(ok)))
check('manifest remained frozen',sha(RUN/'manifest.json')==load(RUN/'execution-started.json')['manifestSha256']==finish['manifestSha256'])
check('all complete public reports reviewed before grading',sha(RUN/'qualitative-audit.json')==finish['qualitativeAuditSha256'])
check('evaluator concurrency',finish['maxConcurrent']<=3 and finish['actors']==18)
for name,expected in manifest['frozenFiles'].items():check('frozen/'+name,sha(RUN/name)==expected)
for name,expected in manifest['implementation'].items():check('implementation/'+name,sha(RUN/'implementation'/name)==expected)
for name,expected in manifest['cases'].items():check('cases/'+name,sha(RUN/'cases'/name)==expected)
for name,expected in manifest['sourceAtStart'].items():check('current source/'+name,sha(HERE/'../../src'/name)==expected)
for name,expected in manifest['globalConfigHashes'].items():check('global configuration unchanged/'+name,sha(Path(name))==expected)
check('successful integration probe sealed',sha(RUN/manifest['probe']['file'])==manifest['probe']['sha256'] and load(RUN/manifest['probe']['file'])['success'])
rows=[]
for entry in manifest['schedule']:
    directory=RUN/entry['id'];work=directory/'workspace'
    metric=load(directory/'initial.metrics.json');grade=load(directory/'initial.grade.json');acceptance=load(directory/'initial.acceptance.json');tools=load(directory/'initial.tools.json');launch=load(directory/'launch.json')
    tasks=load(directory/'initial.cairn-tasks.json') if entry['arm']=='cairn' else []
    components=load(directory/'initial.acceptance-components.json')
    check(entry['id']+' actor ended before grading',datetime.fromisoformat(metric['finishedAt'].replace('Z','+00:00'))<=datetime.fromisoformat(finish['gradingStartedAt'].replace('Z','+00:00')))
    check(entry['id']+' grade written after barrier',datetime.fromtimestamp((directory/'initial.grade.json').stat().st_mtime).astimezone()>=datetime.fromisoformat(finish['allActorsEndedAt'].replace('Z','+00:00')))
    metadata=metric['actualModels']==['global:deepseek-v4.1-flash'] and metric['actualEfforts']==['high']
    failed_before_inference=(metric.get('exitCode')!=0 or metric['turnFailed']) and not metric['actualModels'] and not metric['actualEfforts']
    check(entry['id']+' native model/effort or retained startup failure',metadata or failed_before_inference)
    check(entry['id']+' no evaluation budgets',launch['evaluationBudgets'] is None and not metric['timedOut'] and not metric['budgetExceeded'])
    check(entry['id']+' identical requested prompt',(directory/'initial.prompt.txt').read_text()==(RUN/'prompt.frozen.txt').read_text()+(manifest['cairnGuidance'] if entry['arm']=='cairn' else ''))
    expected=dict((name,expected) for name,expected in manifest['cases'].items() if name.startswith(entry['case']+'/'))
    expected={name.split('/',1)[1]:value for name,value in expected.items()}
    task_text=(RUN/'cases'/entry['case']/'TASK.md').read_text()+'\n\n'+(RUN/'reproduction-contract.frozen.md').read_text()
    expected['TASK.md']=hashlib.sha256(task_text.encode()).hexdigest()
    initial_hashes=load(directory/'input-hashes.json')
    check(entry['id']+' all original inputs copied identically',initial_hashes==expected)
    modifications=[name for name,digest in initial_hashes.items() if not (work/name).is_file() or sha(work/name)!=digest]
    check(entry['id']+' no early hidden grade inside workspace',not (work/'initial.grade.json').exists() and not (work/'case-manifest.json').exists())
    assurance=None;accepted_task=False
    if entry['arm']=='cairn':
        assurance=load(directory/'initial.cairn-assurance.json');check(entry['id']+' private protocol',load(directory/'initial.cairn-protocol.json')['valid'] and assurance['privateProtocolValid'])
        check(entry['id']+' assurance uses frozen source',assurance['engineSha256']==manifest['implementation']['dist/index.js'] and assurance['taskSnapshotSha256']==sha(directory/'initial.cairn-tasks.json'))
        check(entry['id']+' assurance is read only',not assurance['sourceDatabaseWritten'] and not assurance['modelCalled'] and not assurance['externalVerifierExecuted'])
        accepted_task=assurance['completedCandidateCurrent']
        check(entry['id']+' task has no model-specified budgets',all(not any(k in t.get('budget',{}) for k in ['deadline','maxCalls','maxParallel','submitReserveMs']) for t in tasks))
        host=launch['hostEnvironment']
        check(entry['id']+' own Pi DB',host['CAIRN_DB']==str(work/'.cairn/state.db') and host['CAIRN_WORKSPACE']==str(work))
        check(entry['id']+' no inherited deadline','CAIRN_DEADLINE' not in host and 'CAIRN_SUBMIT_RESERVE_MS' not in host)
        check(entry['id']+' frozen extension path',launch['implementation']==str(RUN/'implementation'))
    invalid_inputs=sum(bool(t.get('isError')) and ('invalid_model_input' in json.dumps(t.get('result')) or 'Validation failed' in json.dumps(t.get('result'))) for t in tools)
    command_failures=sum(t.get('name')=='bash' and bool(t.get('isError')) for t in tools)
    natural=metric.get('exitCode')==0 and metric.get('finalStopReason')=='stop'
    present=all((directory/('initial.'+name)).is_file() and (directory/('initial.'+name)).stat().st_size for name in ['answer.json','REPORT.md','checks.json'])
    complete=bool(natural and present and grade['validAnswer'] and (entry['arm']=='pi' or accepted_task))
    usage=metric.get('usage');inp=(usage or {}).get('input_tokens',0);cached=(usage or {}).get('cached_input_tokens',0);output=(usage or {}).get('output_tokens',0)
    native_audit=load(directory/'native-ledger-audit.json');native_usage=native_audit['nativeUsage']
    check(entry['id']+' independent native session audit',native_audit['passed'])
    if usage:check(entry['id']+' usage agrees with native token-count ledger',native_usage is not None and usage.get('input_tokens')==native_usage['input']+native_usage['cacheRead']+native_usage['cacheWrite'] and usage.get('output_tokens')==native_usage['output'] and inp+output==native_usage['totalTokens'])
    row={**entry,'naturalTermination':natural,'completed':complete,'labelCorrect':bool(grade['jointTop1']),'replayPassed':bool(acceptance['ok']),'correctDelivery':bool(complete and grade['jointTop1'] and acceptance['ok'] and not modifications),'falseCompletion':bool(complete and not grade['jointTop1']),'wallSeconds':metric['wallSeconds'],'tokens':inp+output if usage else None,'noncachedInputTokens':metric['nativeUsage']['input'] if usage else None,'cachedInputTokens':cached if usage else None,'outputTokens':output if usage else None,'usageIsLowerBound':metric['usageIsLowerBound'],'toolCalls':len(tools),'fileChangeItems':metric['counts'].get('file_change',0),'toolErrors':metric['toolErrors'],'invalidModelInputs':invalid_inputs,'commandFailures':command_failures,'mcpCalls':sum(t['type']=='mcp_tool_call' for t in tools),'checkpoints':sum(t.get('tool')=='cairn_checkpoint' for t in tools),'finishCalls':sum(t.get('tool')=='cairn_finish' for t in tools),'handoffs':sum(len(t.get('handoffs',[])) for t in tasks),'boundClaims':sum(bool(c.get('referenceArtifacts')) for t in tasks for c in t.get('claims',[])),'modifiedInputs':modifications,'actualRecovery':None,'metric':metric,'grade':grade,'acceptance':acceptance,'assurance':assurance}
    row['contractPassed']=bool(components['contract']['ok']);row['arithmeticPassed']=bool(components['arithmetic']['ok']);row['acceptanceComponents']=components
    check(entry['id']+' private credential copy removed',load(directory/'credential-cleanup.json')['removed'] and not Path(load(directory/'credential-cleanup.json')['path']).exists())
    row['invalidCompletion']=bool(row['completed'] and not row['correctDelivery'])
    row['wrapperFailures']=0
    row['cacheWriteTokens']=metric['nativeUsage']['cacheWrite']
    row['providerErrorMessages']=len(metric.get('errors',[]))
    row['terminalFailure']=not natural
    row['providerRecoveredInSameSession']=natural and bool(metric.get('errors'))
    row['configuredCost']=metric.get('configuredCost');row['monetaryCostKnown']=metric.get('monetaryCostKnown',False)
    row['nativeToolErrors']=sum(bool(t.get('isError')) and not t.get('name','').startswith('cairn_') for t in tools)
    row['cairnToolErrors']=sum(bool(t.get('isError')) and t.get('name','').startswith('cairn_') for t in tools)
    check(entry['id']+' configured thinking and model',launch['requestedModel']==manifest['model'] and launch['requestedEffort']==manifest['effort'])
    rows.append(row)
threads=[row['metric'].get('threadId') for row in rows if row['metric'].get('threadId')]
check('fresh native invocations without reused thread',len(threads)==len(set(threads)))
check('nine samples per arm',all(sum(row['arm']==arm for row in rows)==9 for arm in ['pi','cairn']))
for case in manifest['caseList']:
    for arm in ['pi','cairn']:check(case+'/'+arm+' exactly repeats 1/2/3',sorted(row['repeat'] for row in rows if row['case']==case and row['arm']==arm)==[1,2,3])
def distribution(values):
    values=[value for value in values if value is not None]
    if not values:return dict(n=0,median=None,min=None,max=None,mean=None,stddev=None,cv=None,maxMinRatio=None,variable=None)
    mean=statistics.mean(values);sd=statistics.stdev(values) if len(values)>1 else 0;ratio=max(values)/min(values) if min(values)>0 else None;cv=sd/mean if mean else None
    return dict(n=len(values),median=statistics.median(values),min=min(values),max=max(values),mean=mean,stddev=sd,cv=cv,maxMinRatio=ratio,variable=bool((cv is not None and cv>.25) or (ratio is not None and ratio>2)))
def wilson(success,n):
    if not n:return None
    z=1.959963984540054;p=success/n;d=1+z*z/n;c=(p+z*z/(2*n))/d;h=z*math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d
    return [max(0,c-h),min(1,c+h)]
def summarize(items):
    n=len(items);complete=sum(row['completed'] for row in items);correct=sum(row['labelCorrect'] for row in items);good=sum(row['correctDelivery'] for row in items);false=sum(row['falseCompletion'] for row in items);total=sum(row['tokens'] or 0 for row in items)
    return dict(n=n,completed=complete,labelCorrect=correct,replayPassed=sum(row['replayPassed'] for row in items),correctDelivery=good,falseCompletion=false,completionRate=complete/n,labelAccuracy=correct/n,falseCompletionRate=false/n,falseAmongCompleted=false/complete if complete else None,effectiveDeliveryRate=good/n,descriptiveWilsonAssumingIndependent=wilson(correct,n),totalTokens=total,tokenUsageKnown=sum(row['tokens'] is not None for row in items),tokensLowerBound=any(row['usageIsLowerBound'] or row['tokens'] is None for row in items),totalSeconds=sum(row['wallSeconds'] for row in items),recordedTokensPerCorrectDelivery=total/good if good else None,noncachedInputAndOutputPerCorrectDelivery=sum((row['noncachedInputTokens'] or 0)+(row['outputTokens'] or 0) for row in items)/good if good else None,cachedInputPerCorrectDelivery=sum(row['cachedInputTokens'] or 0 for row in items)/good if good else None,recordedSecondsPerCorrectDelivery=sum(row['wallSeconds'] for row in items)/good if good else None,tokens=distribution([row['tokens'] for row in items]),time=distribution([row['wallSeconds'] for row in items]),noncachedInputTokens=sum(row['noncachedInputTokens'] or 0 for row in items),cachedInputTokens=sum(row['cachedInputTokens'] or 0 for row in items),outputTokens=sum(row['outputTokens'] or 0 for row in items),toolCalls=sum(row['toolCalls'] for row in items),contractPassed=sum(row['contractPassed'] for row in items),arithmeticPassed=sum(row['arithmeticPassed'] for row in items),invalidCompletion=sum(row['invalidCompletion'] for row in items),toolErrors=sum(row['toolErrors'] for row in items),invalidModelInputs=sum(row['invalidModelInputs'] for row in items),commandFailures=sum(row['commandFailures'] for row in items),wrapperFailures=sum(row.get('wrapperFailures',0) for row in items))
groups={arm:summarize([row for row in rows if row['arm']==arm]) for arm in ['pi','cairn']}
per_case={case:{arm:summarize([row for row in rows if row['case']==case and row['arm']==arm]) for arm in ['pi','cairn']} for case in manifest['caseList']}
pairs=[]
for case in manifest['caseList']:
    for repeat in [1,2,3]:
        native=next(row for row in rows if row['case']==case and row['repeat']==repeat and row['arm']=='pi');cairn=next(row for row in rows if row['case']==case and row['repeat']==repeat and row['arm']=='cairn')
        pairs.append(dict(case=case,repeat=repeat,piCorrectDelivery=native['correctDelivery'],cairnCorrectDelivery=cairn['correctDelivery'],winner='tie' if native['correctDelivery']==cairn['correctDelivery'] else 'cairn' if cairn['correctDelivery'] else 'pi',tokenRatio=cairn['tokens']/native['tokens'] if native['tokens'] and cairn['tokens'] is not None else None,timeRatio=cairn['wallSeconds']/native['wallSeconds']))
for arm,group in groups.items():
    selected=[row for row in rows if row['arm']==arm]
    group.update(cacheWriteTokens=sum(row['cacheWriteTokens'] for row in selected),providerErrorMessages=sum(row['providerErrorMessages'] for row in selected),terminalFailures=sum(row['terminalFailure'] for row in selected),providerRecoveredEpisodes=sum(row['providerRecoveredInSameSession'] for row in selected),nativeToolErrors=sum(row['nativeToolErrors'] for row in selected),cairnToolErrors=sum(row['cairnToolErrors'] for row in selected),actualCheckpointHandoffRecoveryAttempts=0,monetaryCostKnown=all(row['monetaryCostKnown'] for row in selected))
result=dict(run=str(RUN),rows=rows,groups=groups,perCase=per_case,pairs=pairs,pairedOutcomes={arm:sum(row['winner']==arm for row in pairs) for arm in ['pi','cairn','tie']},macroCaseAccuracy={arm:statistics.mean(per_case[case][arm]['labelAccuracy'] for case in manifest['caseList']) for arm in ['pi','cairn']},audit=dict(passed=sum(row['passed'] for row in audit),total=len(audit),failures=[row for row in audit if not row['passed']],checks=audit),probeCost=manifest['probe'],caveats=manifest['caveats'])
(RUN/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(groups=groups,paired=result['pairedOutcomes'],audit={key:result['audit'][key] for key in ['passed','total','failures']}),ensure_ascii=False,indent=2))
