"""Read-only postprocessing: native metadata and public phase requests, no labels/thinking."""
import json,hashlib,collections
from pathlib import Path
root=Path(__file__).resolve().parent/'runs/2026-10-18-deepseek-original-context-round15'
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
keys=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens']
assert load(root/'execution-ended.json')['allActorsEnded']
m=load(root/'manifest.json');records=[]

def native(directory):
    total=dict.fromkeys(keys,0);headers=[];models=set();efforts=set();available=False
    for path in sorted((directory/'sessions').glob('*.jsonl')):
        for line in path.open():
            try:e=json.loads(line)
            except ValueError:continue
            if e.get('type')=='session':headers.append({'id':e.get('id'),'cwd':e.get('cwd'),'file':path.name,'sha256':sha(path)})
            if e.get('type')=='thinking_level_change':efforts.add(e.get('thinkingLevel'))
            msg=e.get('message') or {}
            if msg.get('role')!='assistant':continue
            models.add(msg.get('model'));usage=msg.get('usage')
            if usage:
                available=True
                total['input_tokens']+=sum(usage.get(k,0) for k in ['input','cacheRead','cacheWrite'])
                total['cached_input_tokens']+=usage.get('cacheRead',0);total['cache_write_input_tokens']+=usage.get('cacheWrite',0);total['output_tokens']+=usage.get('output',0)
    return {'usage':total if available else None,'headers':headers,'models':sorted(models-{None}),'efforts':sorted(efforts-{None})}

for row in m['schedule']:
    directory=root/row['id'];metrics=load(directory/'initial.metrics.json');phases=[];previous={};sum_usage=dict.fromkeys(keys,0)
    for p in metrics.get('phases',[]):
        phase_dir=directory/'phases'/p['phaseId'];phase=load(phase_dir/'initial.metrics.json');ledger=native(phase_dir)
        original=row['arm']=='original';request=load(phase_dir/('original.request.json' if original else 'scheduler.request.json'))
        session='pi:'+phase['threadId'];prior=previous.get(session,dict.fromkeys(keys,0));delta={k:ledger['usage'][k]-prior[k] for k in keys} if ledger['usage'] is not None else None
        previous[session]=ledger['usage'];declared=phase.get('usage')
        for k in keys:sum_usage[k]+=(declared or {}).get(k,0)
        resume=('pi:'+request['resumeId']) if original and request.get('resumeId') else request.get('resume')
        repair=bool(request.get('repair'));kind='parameter_repair' if repair else 'fault_conclude' if p['phase']=='conclude' else 'reason_coordinator_reuse' if p['phase']=='reason' and resume else 'fresh_phase'
        mode=p.get('contextMode') if original else request.get('contextMode')
        normal=phase.get('exitCode')==0 and phase.get('finalStopReason')=='stop' and not phase.get('turnFailed')
        context_ok=True
        if p['phase']=='reason' and not repair:
            if row['arm'] in ['original','cairn-fresh']:context_ok=not resume and (original or mode=='full')
            elif row['arm']=='cairn-reuse':context_ok=bool(resume and mode=='delta')
        phases.append({'phaseId':p['phaseId'],'phase':p['phase'],'kind':kind,'sessionRef':session,'resumedFrom':resume,'identityMatched':not resume or resume==session,'contextMode':mode,'contextPolicyPassed':context_ok,'normalEnded':normal,'promptBytes':len(request['prompt'].encode()),'seconds':phase['wallSeconds'],'usage':declared,'nativeIncrement':delta,'incrementMatches':delta==declared,'repairZeroActions':not repair or phase.get('toolCalls')==0,'usageLowerBound':phase.get('usageIsLowerBound',True)})
    ledger=native(directory);declared=metrics.get('usage');checks={'uniqueLedgerMatchesActor':ledger['usage']==declared,'phaseSumMatchesActor':not phases or sum_usage==declared,'phaseIncrementsMatch':all(p['incrementMatches'] for p in phases),'sessionIdentity':all(p['identityMatched'] for p in phases),'contextPolicy':all(p['contextPolicyPassed'] for p in phases),'repairZeroActions':all(p['repairZeroActions'] for p in phases)}
    record={**row,'checks':checks,'native':ledger,'recordedUsage':declared,'phases':phases};records.append(record)
    (directory/'context-accounting-audit.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
groups={}
for arm in m['arms']:
    values=[p for r in records if r['arm']==arm for p in r['phases']];groups[arm]={}
    for kind in sorted({p['kind'] for p in values}):
        selected=[p for p in values if p['kind']==kind]
        groups[arm][kind]={'n':len(selected),'seconds':sum(p['seconds'] for p in selected),'recordedTokens':sum((p['usage'] or {}).get('input_tokens',0)+(p['usage'] or {}).get('output_tokens',0) for p in selected),'normalEnded':sum(p['normalEnded'] for p in selected)}
result={'method':'Public requests and native header/model/effort/usage metadata only; does not inspect private thinking or hidden labels. Every resumed Pi phase is independently differenced against that exact session previous ledger.','groups':groups,'actors':records,'failures':[{'id':r['id'],'checks':r['checks']} for r in records if not all(r['checks'].values())]}
(root/'context-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'groups':groups,'failures':result['failures']},ensure_ascii=False,indent=2))
