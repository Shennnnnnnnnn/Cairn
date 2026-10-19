"""Read-only progress, native-session/branch audits, and post-seal grading."""
from pathlib import Path
from datetime import datetime
from collections import Counter
import json,sys,hashlib,statistics,math,re

HERE=Path(__file__).resolve().parent
ROOT=HERE/'runs/2026-10-19-deepseek-multibranch-v4'

def load(p,default=None):
    try:return json.loads(p.read_text())
    except (FileNotFoundError,json.JSONDecodeError):return default

def lines(p):
    if not p.exists():return
    for line in p.read_text().splitlines():
        try:yield json.loads(line)
        except json.JSONDecodeError:continue

def tokens(usage):
    return None if usage is None else usage.get('input_tokens',0)+usage.get('output_tokens',0)

def progress(root=ROOT):
    manifest=load(root/'manifest.json');out=[]
    for row in manifest['schedule']:
        d=root/row['id'];done=load(d/'actor-finished.json');error=load(d/'infrastructure-failure.json')
        if not d.exists():continue
        item={**row,'finished':bool(done or error)}
        metric=load(d/'initial.metrics.json')
        if metric:item.update({'seconds':round(metric['wallSeconds'],1),'tokens':tokens(metric.get('usage')),'status':metric.get('schedulerStatus'),'phaseCount':metric.get('phaseCount',1),'accepted':load(d/'initial.acceptance.json',{}).get('ok')})
        else:
            samples=[]
            for p in sorted(d.glob('**/initial.progress.json')):
                if p==d/'initial.progress.json' and row['arm']=='multi':continue
                v=load(p,{})
                samples.append({'phase':p.parent.name,'seconds':round(v.get('elapsedSeconds',0),1),'turns':v.get('assistantTurns'),'tools':v.get('toolCalls'),'lastTool':v.get('lastTool')})
            item['active']=samples
        if error:item['error']=error
        out.append(item)
    return {'actorsStarted':len(out),'actorsFinished':sum(x['finished'] for x in out),'actorsPlanned':len(manifest['schedule']),'actors':out}

def native_ledger(directory):
    sessions={};seen=set();usage={'input_tokens':0,'output_tokens':0,'cached_input_tokens':0,'cache_write_input_tokens':0};samples=0;unknown=0
    for p in sorted((directory/'sessions').glob('*.jsonl')):
        sid=None
        for event in lines(p):
            if event.get('type')=='session':sid=event.get('id');sessions[sid]={'path':str(p),'id':sid,'cwd':event.get('cwd'),'samples':0,'models':set(),'tools':0}
            m=event.get('message',{})
            if m.get('role')!='assistant':continue
            identity=(sid,event.get('id') or m.get('timestamp'))
            if identity in seen:continue
            seen.add(identity)
            u=m.get('usage');unknown+=u is None
            if sid in sessions:
                sessions[sid]['samples']+=1
                if m.get('model'):sessions[sid]['models'].add(m['model'])
                sessions[sid]['tools']+=sum(part.get('type')=='toolCall' for part in m.get('content',[]) if isinstance(part,dict))
            if not u:continue
            samples+=1
            usage['input_tokens']+=u.get('input',0)+u.get('cacheRead',0)+u.get('cacheWrite',0)
            usage['output_tokens']+=u.get('output',0);usage['cached_input_tokens']+=u.get('cacheRead',0);usage['cache_write_input_tokens']+=u.get('cacheWrite',0)
    return {'sessions':[{**v,'models':sorted(v['models'])} for v in sessions.values()],'usage':usage,'samples':samples,'unknownUsageMessages':unknown}

def branch_audit(directory,metric,task):
    explores=[];owners={p['sessionRef'] for p in metric.get('phases',[]) if p['phase']=='reason'}
    all_events=list(lines(directory/'scheduler.trace.jsonl'))
    db_events=load(directory/'scheduler.events.json',[])
    grouped={}
    for p in metric.get('phases',[]):
        if not p.get('branch') or p['phase'] not in ['explore','conclude']:continue
        grouped.setdefault((p['branch']['key'],p.get('sessionRef')),[]).append(p)
    for (key,session_ref),attempts in grouped.items():
        attempts.sort(key=lambda p:p['startTime']);initial=attempts[0];last=attempts[-1]
        proposals=[];native_ids=[]
        for p in attempts:
            phase_dir=directory/'phases'/p['phaseId'];result=load(phase_dir/'scheduler.result.json',{})
            try:
                output=result.get('output','').strip();output=re.sub(r'^```(?:json)?\s*\n|\n```$','',output);output=json.loads(output)
            except (ValueError,TypeError):output={}
            candidate=(output.get('checkpoint') or {}).get('findings',[])
            if candidate:proposals=candidate
            for f in (phase_dir/'sessions').glob('*.jsonl'):
                header=next((e for e in lines(f) if e.get('type')=='session'),None)
                if header:native_ids.append('pi:'+header.get('id',''))
        claims=[c for c in task.get('claims',[]) if c.get('branchKey')==key]
        reviewed=[c for c in claims if c.get('status') in ['supported','refuted','inconclusive']]
        ids={c['id'] for c in claims};derived_review=[]
        for owner_claim in task.get('claims',[]):
            if owner_claim.get('branchKey')==key or owner_claim.get('status') not in ['supported','refuted','inconclusive']:continue
            used=[ref.removeprefix('claim:') for ref in owner_claim.get('from',[]) if ref.removeprefix('claim:') in ids]
            if used:derived_review.append({'ownerClaimId':owner_claim['id'],'sourceClaimIds':used,'status':owner_claim['status']})
        branch_progress=next((x for x in task.get('progress',[]) if x.get('key')==key),{})
        later_owners=[o for o in metric.get('phases',[]) if o['phase']=='reason' and o['startTime']>=last['endTime']]
        item={'phases':[p['phaseId'] for p in attempts],'branch':key,'sessionRef':session_ref,'nativeHeaderMatches':session_ref in native_ids,'independentOfOwner':session_ref not in owners,'toolCalls':sum(p.get('toolCalls',0) for p in attempts),'proposalCount':len(proposals),'groundedProposals':sum(bool(c.get('basis') or c.get('references')) for c in proposals),'savedBranchClaims':len(claims),'explicitlyReviewedClaims':len(reviewed),'ownerDerivedReview':derived_review,'explicitlyUtilizedClaims':len(set([c['id'] for c in reviewed]+[ref for r in derived_review for ref in r['sourceClaimIds']])),'merged':branch_progress.get('branchStatus')=='merged','laterOwnerReason':bool(later_owners),'startTime':initial['startTime'],'endTime':last['endTime'],'finalError':last.get('error'),'earlierErrors':[p['error'] for p in attempts[:-1] if p.get('error')],'actualExploreInvoked':any(p['phase']=='explore' for p in attempts)}
        item['participated']=bool(item['actualExploreInvoked'] and item['nativeHeaderMatches'] and item['independentOfOwner'] and item['toolCalls'] and item['groundedProposals'] and item['savedBranchClaims'] and item['explicitlyUtilizedClaims'] and item['merged'] and item['laterOwnerReason'] and not item['finalError'])
        explores.append(item)
    valid=[p for p in explores if p['participated']]
    overlap=[]
    for i,a in enumerate(valid):
        for b in valid[i+1:]:
            seconds=(min(a['endTime'],b['endTime'])-max(a['startTime'],b['startTime']))/1000
            if seconds>0:overlap.append({'a':a['branch'],'b':b['branch'],'seconds':seconds})
    executed=[p for p in explores if p['actualExploreInvoked'] and p['nativeHeaderMatches'] and p['independentOfOwner'] and p['toolCalls']]
    persisted=[p for p in executed if p['groundedProposals'] and p['savedBranchClaims'] and p['merged'] and p['laterOwnerReason'] and not p['finalError']]
    raw_overlap=[]
    for i,a in enumerate(executed):
        for b in executed[i+1:]:
            seconds=(min(a['endTime'],b['endTime'])-max(a['startTime'],b['startTime']))/1000
            if seconds>0 and a['branch']!=b['branch'] and a['sessionRef']!=b['sessionRef']:raw_overlap.append({'a':a['branch'],'b':b['branch'],'seconds':seconds})
    distinct=lambda rows:len({p['branch'] for p in rows})>=2 and len({p['sessionRef'] for p in rows})>=2
    execution={'twoRealToolUsingExploreSessions':distinct(executed),'twoGroundedMergedExploreSessions':distinct(persisted),'executedBranches':len(executed),'groundedMergedBranches':len(persisted),'parallelOverlap':raw_overlap,'note':'Actual execution and persisted grounded proposals are separate from explicit owner claim lineage; the stricter participated metric is preserved.'}
    return {'executionAudit':execution,'explores':explores,'distinctParticipatingBranches':len({p['branch'] for p in valid}),'distinctParticipatingSessions':len({p['sessionRef'] for p in valid}),'verifiedTwoIndependentExplores':len({p['branch'] for p in valid})>=2 and len({p['sessionRef'] for p in valid})>=2,'parallelOverlap':overlap,'reasonSessions':len(owners),'events':len(all_events),'databaseEvents':len(db_events)}

def descriptive(values):
    values=[v for v in values if v is not None]
    if not values:return None
    mean=statistics.mean(values)
    return {'n':len(values),'sum':sum(values),'mean':mean,'median':statistics.median(values),'min':min(values),'max':max(values),'cvPercent':statistics.stdev(values)/mean*100 if len(values)>1 and mean else None}

def analyze(root=ROOT):
    manifest=load(root/'manifest.json');ended=load(root/'execution-ended.json',{})
    if not ended.get('allActorsEnded'):raise SystemExit('All 18 formal actors must end before analysis/scoring')
    seal=load(root/'report-read-seal.json',{})
    if not seal.get('allAvailableReportsRead'):raise SystemExit('Read and seal every available public report before loading labels')
    labels={r['alias']:r for r in load(root/'hidden-labels.json')};starts={e['id']:e['at'] for e in lines(root/'progress.jsonl') if e.get('event')=='actor_start'}
    records=[]
    for row in manifest['schedule']:
        directory=root/row['id'];metric=load(directory/'initial.metrics.json',{});tasks=load(directory/'initial.cairn-tasks.json',[]);task=tasks[0] if len(tasks)==1 else {};acceptance=load(directory/'initial.acceptance.json',{});finished=load(directory/'actor-finished.json',{})
        answer=load(directory/'initial.answer.json',{}) or {};label=labels[row['case']]
        service_ok=isinstance(answer.get('root_cause_service'),str) and answer['root_cause_service'].strip().lower()==label['service'].lower()
        correct=service_ok and answer.get('fault_family')==label['family']
        if row['arm']=='single':native_ok=metric.get('exitCode')==0 and metric.get('finalStopReason')=='stop' and not metric.get('turnFailed');identity_ok=task.get('owner',{}).get('sessionId')==metric.get('threadId')
        else:native_ok=metric.get('exitCode')==0 and metric.get('schedulerStatus')=='completed';identity_ok=task.get('owner',{}).get('host')=='mcp'
        completed=bool(native_ok and identity_ok and len(tasks)==1 and task.get('status')=='completed' and acceptance.get('ok'))
        wall=(datetime.fromisoformat(finished['at'].replace('Z','+00:00'))-datetime.fromisoformat(starts[row['id']].replace('Z','+00:00'))).total_seconds() if finished.get('at') else metric.get('wallSeconds')
        ledger=native_ledger(directory);reported=metric.get('usage');accounting_match=reported==ledger['usage'] if reported is not None else ledger['samples']==0
        item={**row,'rootServiceCorrect':service_ok,'jointCorrect':correct,'completed':completed,'incorrectCompletion':completed and not correct,'correctDelivery':completed and correct,'accepted':bool(acceptance.get('ok')),'taskStatus':task.get('status'),'workflowStatus':metric.get('schedulerStatus'),'taskCount':len(tasks),'identityValid':identity_ok,'wallSeconds':wall,'hostMetricSeconds':metric.get('wallSeconds'),'tokens':tokens(reported),'cachedInputTokens':(reported or {}).get('cached_input_tokens'),'outputTokens':(reported or {}).get('output_tokens'),'noncachedInputOutputTokens':tokens(reported)-reported.get('cached_input_tokens',0)-reported.get('cache_write_input_tokens',0) if reported else None,'usageIsLowerBound':metric.get('usageIsLowerBound',True),'accountingMatch':accounting_match,'nativeLedger':ledger,'phaseCount':metric.get('phaseCount',1),'toolCalls':metric.get('toolCalls'),'error':metric.get('error') or load(directory/'infrastructure-failure.json'),'acceptanceIssues':acceptance.get('issues',[])}
        if row['arm']=='multi':item['multiSessionAudit']=branch_audit(directory,metric,task)
        records.append(item)
    groups=[]
    for arm in ['single','multi']:
        rows=[r for r in records if r['arm']==arm];done=sum(r['completed'] for r in rows)
        groups.append({'arm':arm,'attempts':len(rows),'rootServiceCorrect':sum(r['rootServiceCorrect'] for r in rows),'jointCorrect':sum(r['jointCorrect'] for r in rows),'completed':done,'incorrectCompletion':sum(r['incorrectCompletion'] for r in rows),'incorrectAmongCompleted':sum(r['incorrectCompletion'] for r in rows)/done if done else None,'correctDelivery':sum(r['correctDelivery'] for r in rows),'accepted':sum(r['accepted'] for r in rows),'wallSeconds':descriptive([r['wallSeconds'] for r in rows]),'tokens':descriptive([r['tokens'] for r in rows]),'completedWallSeconds':descriptive([r['wallSeconds'] for r in rows if r['completed']]),'lowerBoundActors':sum(r['usageIsLowerBound'] for r in rows),'allAccountingMatch':all(r['accountingMatch'] for r in rows),'verifiedMultiActors':sum(r.get('multiSessionAudit',{}).get('verifiedTwoIndependentExplores',False) for r in rows),'actualExploreActors':sum(r.get('multiSessionAudit',{}).get('executionAudit',{}).get('twoRealToolUsingExploreSessions',False) for r in rows),'groundedMergedMultiActors':sum(r.get('multiSessionAudit',{}).get('executionAudit',{}).get('twoGroundedMergedExploreSessions',False) for r in rows),'actualParallelActors':sum(bool(r.get('multiSessionAudit',{}).get('executionAudit',{}).get('parallelOverlap')) for r in rows),'parallelMultiActors':sum(bool(r.get('multiSessionAudit',{}).get('parallelOverlap')) for r in rows)})
    result={'records':records,'groups':groups,'byCase':[{ 'case':case,'arm':arm,'jointCorrect':sum(r['jointCorrect'] for r in records if r['case']==case and r['arm']==arm),'completed':sum(r['completed'] for r in records if r['case']==case and r['arm']==arm),'incorrectCompletion':sum(r['incorrectCompletion'] for r in records if r['case']==case and r['arm']==arm),'wallSeconds':descriptive([r['wallSeconds'] for r in records if r['case']==case and r['arm']==arm]),'tokens':descriptive([r['tokens'] for r in records if r['case']==case and r['arm']==arm])} for case in ['mb-01','mb-02','mb-03'] for arm in ['single','multi']]}
    (root/'analysis.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
    return result

if __name__=='__main__':
    mode=sys.argv[1] if len(sys.argv)>1 else '--progress'
    if mode=='--progress':print(json.dumps(progress(),ensure_ascii=False,indent=2))
    elif mode=='--analyze':print(json.dumps(analyze()['groups'],ensure_ascii=False,indent=2))
    else:raise SystemExit('Use --progress or --analyze')
