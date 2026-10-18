"""Read-only provenance, credentials and source audit after grading."""
import hashlib,json
from pathlib import Path
base=Path(__file__).resolve().parent;root=base/'runs/2026-10-18-deepseek-original-context-round15';repo=base.parent.parent
load=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
m=load(root/'manifest.json');s=load(root/'summary.json');context=load(root/'context-audit.json')
assert load(root/'execution-ended.json')['allActorsEnded']
records=[];private=[]
for row in m['schedule']:
    directory=root/row['id'];metric=load(directory/'initial.metrics.json');phase_dirs=[directory/'phases'/p['phaseId'] for p in metric.get('phases',[])] if row['arm']!='native' else [directory]
    for phase in phase_dirs:
        launch=load(phase/'launch.json');clean=load(phase/'credential-cleanup.json');native=load(phase/'initial.metrics.json')
        assert launch['requestedProvider']==m['models'][0]['provider'] and launch['requestedModel']==m['models'][0]['id'] and launch['requestedEffort']==m['models'][0]['thinking']
        assert set(native.get('actualProviders',[])).issubset({m['models'][0]['provider']}) and set(native.get('actualModels',[])).issubset({m['models'][0]['id']})
        assert clean['removed'] and not Path(clean['path']).exists() and launch['evaluationBudgets'] is None
        private.append(clean['path'])
    records.append({'id':row['id'],'realNativeInvocations':len(phase_dirs),'metricSHA256':sha(directory/'initial.metrics.json')})
assert len(private)==len(set(private))
drift={key:[n for n,h in m[key].items() if not (root/prefix/n).exists() or sha(root/prefix/n)!=h] for key,prefix in [('implementation','implementation'),('original','original'),('cases','cases')]}
drift['evaluators']=[n for n,h in m['frozenFiles'].items() if sha(root/n)!=h]
drift['currentImplementation']=[n for n,h in m['implementation'].items() if not (repo/n).exists() or sha(repo/n)!=h]
original_root=Path('/Users/shen/Documents/Code/Cairn-main')
drift['originalSource']=[n for n,h in m['original'].items() if not (original_root/n).exists() or sha(original_root/n)!=h]
drift['sealedReports']=[r['id'] for r in load(root/'report-reviews.json') if r.get('readFinalReport') and sha(root/r['id']/'initial.REPORT.md')!=r['sha256']]
drift['globalConfig']=s['globalConfigChanges']
result={'actors':len(records),'realNativeInvocations':sum(r['realNativeInvocations'] for r in records),'uniquePrivateDirectories':len(private),'allPrivateDirectoriesRemoved':True,'paidProbes':0,'drift':drift,'nativeCheckFailures':s['nativeCheckFailures'],'contextAccountingFailures':context['failures'],'unexpectedInputChanges':[{'id':r['id'],'files':r['unexpectedInputChanges']} for r in s['rows'] if r['unexpectedInputChanges']],'recordedTokens':sum(r['tokens'] or 0 for r in s['rows']),'manifestSHA256':sha(root/'manifest.json'),'summarySHA256':sha(root/'summary.json'),'contextSHA256':sha(root/'context-audit.json'),'records':records,'limits':'Observed public commands and native receipts only; Pi is not OS sandboxed; provider-side routing is not independently attested.'}
assert not any(drift.values())
(root/'closeout-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='records'},ensure_ascii=False,indent=2))
