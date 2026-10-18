"""Post-run provenance and cleanup checks; does not call models or change scores."""
import hashlib,json
from pathlib import Path

base=Path(__file__).resolve().parent
root=base/'runs/2026-10-18-kimi-scheduler-round14'
repo=base.parent.parent
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
m=load(root/'manifest.json');summary=load(root/'summary.json');context=load(root/'context-audit.json')
assert load(root/'execution-ended.json')['allActorsEnded']
records=[];private_paths=[];phase_total=0
for row in m['schedule']:
    d=root/row['id'];metric=load(d/'initial.metrics.json')
    dirs=[d/'phases'/phase['phaseId'] for phase in metric.get('phases',[])] if row['arm']=='cairn' else [d]
    phase_total+=len(dirs)
    for p in dirs:
        launch=load(p/'launch.json');cleanup=load(p/'credential-cleanup.json')
        native=load(p/'initial.metrics.json')
        assert launch['requestedProvider']=='sub2api-copy-copy' and launch['requestedModel']=='kimi-k3' and launch['requestedEffort']=='high'
        assert set(native.get('actualProviders',[])).issubset({'sub2api-copy-copy'})
        assert set(native.get('actualModels',[])).issubset({'kimi-k3'})
        assert set(native.get('actualEfforts',[])).issubset({'high'})
        assert cleanup['removed'] and not Path(cleanup['path']).exists()
        assert launch['evaluationBudgets'] is None
        private_paths.append(cleanup['path'])
    records.append({'id':row['id'],'realNativeInvocations':len(dirs),'sourceMetricSHA256':sha(d/'initial.metrics.json'),'credentialCleanupConfirmed':True})
assert len(private_paths)==len(set(private_paths))
frozen_drift=[n for n,h in m['frozenFiles'].items() if sha(root/n)!=h]
implementation_drift=[n for n,h in m['implementation'].items() if sha(root/'implementation'/n)!=h]
current_drift=[n for n,h in m['implementation'].items() if not (repo/n).exists() or sha(repo/n)!=h]
reports=load(root/'report-reviews.json')
report_drift=[r['id'] for r in reports if r.get('readFinalReport') and sha(root/r['id']/'initial.REPORT.md')!=r['sha256']]
result={'actors':len(records),'realNativeInvocations':phase_total,'uniquePrivateCredentialDirectories':len(set(private_paths)),'allPrivateDirectoriesRemoved':True,'paidProbes':0,'frozenEvaluatorDrift':frozen_drift,'frozenImplementationDrift':implementation_drift,'currentImplementationDrift':current_drift,'sealedReportDrift':report_drift,'globalConfigChanges':summary['globalConfigChanges'],'nativeCheckFailures':summary['nativeCheckFailures'],'accountingDisagreements':context['accountingDisagreements'],'recordedTokens':sum((r['tokens'] or 0) for r in summary['rows']),'sourceManifestSHA256':sha(root/'manifest.json'),'summarySHA256':sha(root/'summary.json'),'contextAuditSHA256':sha(root/'context-audit.json'),'rows':records,'scopeLimit':'Private directories and observed public actions are checked; Pi has no OS sandbox. No claim of exhaustive isolation or provider-side routing attestation.'}
assert not any([frozen_drift,implementation_drift,current_drift,report_drift,result['globalConfigChanges'],result['accountingDisagreements']])
(root/'closeout-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='rows'},ensure_ascii=False,indent=2))
