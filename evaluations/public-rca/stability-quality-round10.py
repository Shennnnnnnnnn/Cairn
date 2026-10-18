"""Descriptive postprocessing only; frozen label policy is unchanged."""
import json,statistics,hashlib
from pathlib import Path
H=Path(__file__).resolve().parent;R=H/'runs/2026-10-18-pi-deepseek-round10-repeated';P=H/'runs/2026-10-17-pi-deepseek-round9-repeated'
load=lambda p:json.loads(p.read_text())
s=load(R/'summary.json');old=load(P/'summary.json');audit=load(R/'qualitative-audit.json')
assert len(audit['results'])==18
deviations=load(R/'audit-deviations.json')
assert [r['name'] for r in s['audit']['failures']]==deviations['acknowledgedCheckNames']
# Original failing checks remain failures; reporting is allowed with explicit deviations.
def dist(v):
 mean=statistics.mean(v);sd=statistics.stdev(v) if len(v)>1 else 0;cv=sd/mean if mean else None;ratio=max(v)/min(v) if min(v)>0 else None
 return dict(n=len(v),median=statistics.median(v),min=min(v),max=max(v),mean=mean,cv=cv,maxMinRatio=ratio,variable=bool(cv is not None and cv>.25 or ratio is not None and ratio>2))
def per_case(rows):
 return {case:{arm:{key:dist([v for row in rows if row['case']==case and row['arm']==arm for v in [row['tokens'] if key=='tokens' else row['wallSeconds'] if key=='seconds' else (row['noncachedInputTokens'] or 0)+(row['outputTokens'] or 0)]]) for key in ['tokens','noncachedPlusOutput','seconds']} for arm in ['pi','cairn']} for case in ['new-01','new-02','new-03']}
groups={}
for arm in ['pi','cairn']:
 rows=[r for r in audit['results'] if r['id'].endswith('-'+arm)]
 groups[arm]={'attempts':len(rows),'reportsAvailable':sum(r['readFinalReport'] for r in rows),'confirmedIssues':{dim:sum(r['semantics'][dim]['status']=='confirmed_issue' for r in rows) for dim in ['time','units','missing']},'noConfirmedIssuesAllThree':sum(r['readFinalReport'] and all(v['status']=='no_confirmed_issue' for v in r['semantics'].values()) for r in rows),'unavailable':sum(any(v['status']=='unavailable' for v in r['semantics'].values()) for r in rows),'anyConfirmedIssue':sum(any(v['status']=='confirmed_issue' for v in r['semantics'].values()) for r in rows)}
record={'method':'Predeclared equal whole-report review rubric. No-confirmed-issue is not proof of full correctness; no report is unavailable, never quality pass. Historical cost comparison uses sealed R9 same-model results and cannot isolate treatment effect.','groups':groups,'currentPerCase':per_case(s['rows']),'previousPerCase':per_case(old['rows']),'baselineSummarySha256':hashlib.sha256((P/'summary.json').read_bytes()).hexdigest(),'qualitativeAuditSha256':hashlib.sha256((R/'qualitative-audit.json').read_bytes()).hexdigest(),'priorAllAttemptGroups':old['groups']}
(R/'stability-quality.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');print(json.dumps(groups,ensure_ascii=False,indent=2))
