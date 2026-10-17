"""Independent totals, input/config/cleanup checks after frozen finalization."""
import json,hashlib
from pathlib import Path
R=Path(__file__).resolve().parent/'runs/2026-10-18-pi-deepseek-round10-repeated';H=R.parent.parent
load=lambda p:json.loads(p.read_text());sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
s=load(R/'summary.json');m=load(R/'manifest.json');checks=[]
def check(name,value):checks.append({'name':name,'passed':bool(value)})
probe=load(R/'probe-attempts.json');cleanup=[]
for root in [R/r['id'] for r in m['schedule']]+[Path(p['root']) for p in probe['attempts']]:
 c=load(root/'credential-cleanup.json');cleanup.append(c);check('private config removed '+root.name,c['removed'] and not Path(c['path']).exists() and not c['credentialFilesArchived'])
for p,v in m['globalConfigHashes'].items():check('global config unchanged '+p,sha(Path(p))==v)
for arm in ['pi','cairn']:
 rows=[r for r in s['rows'] if r['arm']==arm];g=s['groups'][arm]
 check(arm+' all recorded usage components',g['totalTokens']==sum(sum(r['metric']['nativeUsage'][k] for k in ['input','output','cacheRead','cacheWrite']) for r in rows))
 check(arm+' independent correct deliveries',g['correctDelivery']==sum(r['completed'] and r['grade']['jointTop1'] and r['contractPassed'] and r['arithmeticPassed'] and not r['modifiedInputs'] for r in rows))
 check(arm+' all-attempt per-good costs',g['recordedTokensPerCorrectDelivery']==(g['totalTokens']/g['correctDelivery'] if g['correctDelivery'] else None))
 check(arm+' false completion exact',g['falseCompletion']==sum(r['completed'] and not r['grade']['jointTop1'] for r in rows))
 check(arm+' final stop governs completion',all(not r['completed'] or r['metric']['exitCode']==0 and r['metric']['finalStopReason']=='stop' for r in rows))
 check(arm+' original input unchanged',all(not r['modifiedInputs'] for r in rows))
check('probe all attempts cost',probe['recordedTokensAllAttempts']==sum(p['metrics']['nativeUsage']['totalTokens'] for p in probe['attempts']))
check('all 18 reviewed, semantic dimensions sealed',len(load(R/'qualitative-audit.json')['results'])==18 and all(set(r['semantics'])=={'time','units','missing'} for r in load(R/'qualitative-audit.json')['results']))
check('exactly 18 independent UUIDs',len({r['metric']['threadId'] for r in s['rows']})==18)
check('all independent native audits pass',load(R/'native-ledger-audit.json')['passed']==load(R/'native-ledger-audit.json')['checks'])
implementation=[]
for n,v in m['implementation'].items():implementation.append({'file':n,'archiveUnchanged':sha(R/'implementation'/n)==v,'currentEqualsFrozen':sha(H.parent.parent/n)==v})
# H is evaluations/public-rca, repo=H.parent.parent.
record={'passed':sum(c['passed'] for c in checks),'total':len(checks),'failures':[c for c in checks if not c['passed']],'checks':checks}
(R/'auxiliary-checks.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');(R/'cleanup.json').write_text(json.dumps({'copies':len(cleanup),'allRemoved':all(c['removed'] and not Path(c['path']).exists() for c in cleanup),'records':cleanup},indent=2)+'\n');(R/'runtime-final-check.json').write_text(json.dumps({'files':len(implementation),'allMatch':all(c['archiveUnchanged'] and c['currentEqualsFrozen'] for c in implementation),'checks':implementation},indent=2)+'\n');print(json.dumps({k:v for k,v in record.items() if k!='checks'}))
