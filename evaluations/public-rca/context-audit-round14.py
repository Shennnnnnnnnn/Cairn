"""Public request/continuation and native cumulative usage audit; no hidden labels."""
import collections
import hashlib
import json
from pathlib import Path

root=Path(__file__).resolve().parent/'runs/2026-10-18-kimi-scheduler-round14'
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
assert load(root/'execution-ended.json')['allActorsEnded'], 'All actors must end first'
manifest=load(root/'manifest.json')
keys=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens']

def ledger_usage(directory,host):
    totals=dict.fromkeys(keys,0);files=[];present=False
    for path in sorted((directory/'sessions').glob('*.jsonl')):
        files.append({'path':path.name,'sha256':sha(path)});last=None
        for line in path.open():
            try:event=json.loads(line)
            except ValueError:continue
            if host=='pi':
                message=event.get('message') or {}
                if message.get('role')!='assistant':continue
                usage=message.get('usage')
                if not usage:continue
                present=True
                totals['input_tokens']+=sum(usage.get(key,0) for key in ['input','cacheRead','cacheWrite'])
                totals['cached_input_tokens']+=usage.get('cacheRead',0)
                totals['cache_write_input_tokens']+=usage.get('cacheWrite',0)
                totals['output_tokens']+=usage.get('output',0)
            elif event.get('type')=='event_msg' and (event.get('payload') or {}).get('type')=='token_count':
                last=(event['payload'].get('info') or {}).get('total_token_usage',last)
        if host=='codex' and last is not None:
            present=True
            for key in keys:totals[key]+=last.get(key,0)
    return (totals if present else None),files

records=[]
for row in manifest['schedule']:
    directory=root/row['id'];metrics=load(directory/'initial.metrics.json')
    spec=next(value for value in manifest['models'] if value['slug']==row['model'])
    phases=[]
    for phase in metrics.get('phases',[]):
        phase_dir=directory/'phases'/phase['phaseId'];request=load(phase_dir/'scheduler.request.json');native=load(phase_dir/'initial.metrics.json');launch=load(phase_dir/'launch.json')
        is_repair=bool(request.get('repair'));kind='parameter_repair' if is_repair else 'fault_conclude' if request['phase']=='conclude' else 'reason_coordinator_reuse' if request['phase']=='reason' and request.get('resume') else 'other_native_continuation' if request.get('resume') else 'fresh_phase'
        context=load(phase_dir/'request-context.json')
        assert context['promptBytes']==len(request['prompt'].encode()) and context['continuationKind']==kind
        repair_policy=None
        if is_repair:
            repair_policy=native.get('toolCalls')==0
            if spec['host']=='pi':repair_policy=repair_policy and launch.get('noToolsRequested') is True
            else:repair_policy=repair_policy and launch.get('outputOnlyRepair') is True and (native.get('repairActionAudit') or {}).get('observedNativeActions')==0
        phases.append({'phaseId':phase['phaseId'],'requestId':request['id'],'phase':request['phase'],'kind':kind,'contextMode':request.get('contextMode'),'repair':request.get('repair'),'repairToolPolicyPassed':repair_policy,'promptBytes':context['promptBytes'],'commonBytes':context['commonBytes'],'promptSHA256':hashlib.sha256(request['prompt'].encode()).hexdigest(),'resumedFrom':request.get('resume'),'sessionRef':phase.get('sessionRef'),'identityMatched':bool(request.get('resume') and request.get('resume')==phase.get('sessionRef')),'normalEnded':native.get('exitCode')==0 and not native.get('turnFailed') and (spec['host']!='pi' or native.get('finalStopReason')=='stop'),'nativeActions':native.get('toolCalls'),'seconds':native['wallSeconds'],'usage':native.get('usage'),'accountingDiagnostic':native.get('accountingDiagnostic'),'usageLowerBound':native.get('usageIsLowerBound',True),'hostError':phase.get('error')})
    summed={key:sum((phase['usage'] or {}).get(key,0) for phase in phases) for key in keys} if phases else metrics.get('usage')
    ledger,files=ledger_usage(directory,spec['host']);recorded=metrics.get('usage')
    phase_matches=summed is not None and all(summed.get(key,0)==(recorded or {}).get(key,0) for key in keys)
    ledger_matches=ledger is not None and all(ledger.get(key,0)==(recorded or {}).get(key,0) for key in keys)
    baseline_phases=[]
    records.append({**row,'host':spec['host'],'schedulerStatus':metrics.get('schedulerStatus'),'workflowCompleted':metrics.get('workflowCompleted'),'phases':phases,'baselinePhasePrompts':baseline_phases,'phaseSumMatchesActor':phase_matches,'uniqueSessionLedgerMatchesActor':ledger_matches,'ledgerUsage':ledger,'recordedUsage':recorded,'nativeSessionFiles':files,'ledgerUnavailable':ledger is None,'missingPhaseAccounting':metrics.get('phaseCount',len(phases))!=len(phases) if row['arm']=='cairn' else False})

summary={}
for spec in manifest['models']:
    selected=[phase for row in records if row['model']==spec['slug'] for phase in row['phases']]
    summary[spec['slug']]={}
    for kind in ['fresh_phase','reason_coordinator_reuse','parameter_repair','fault_conclude','other_native_continuation']:
        values=[phase for phase in selected if phase['kind']==kind]
        summary[spec['slug']][kind]={'requests':len(values),'identityMatched':sum(value['identityMatched'] for value in values),'normalEnded':sum(value['normalEnded'] for value in values),'promptBytes':sum(value['promptBytes'] for value in values),'seconds':sum(value['seconds'] for value in values),'recordedTokens':sum((value['usage'] or {}).get('input_tokens',0)+(value['usage'] or {}).get('output_tokens',0) for value in values),'usageLowerBoundCount':sum(value['usageLowerBound'] for value in values)}
result={'method':'Public HostRequest, launch/stop metadata and unique final native cumulative usage only; no private reasoning or hidden labels. Ordinary Reason reuse and output repair are not fault recovery. Identity match is not accepted/correct delivery. Synthetic integration fixtures excluded.','sourceManifestSHA256':sha(root/'manifest.json'),'summary':summary,'accountingDisagreements':[row['id'] for row in records if not row['phaseSumMatchesActor'] or not row['uniqueSessionLedgerMatchesActor']],'rows':records}
(root/'context-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({key:value for key,value in result.items() if key!='rows'},ensure_ascii=False,indent=2))
