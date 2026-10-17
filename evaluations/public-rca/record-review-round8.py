"""Record a review only after the primary agent has read the entire named report."""
import sys,json,hashlib
from pathlib import Path
from datetime import datetime,timezone
R=Path(__file__).resolve().parent/'runs/2026-10-17-codex-sol-xhigh-round8-repeated'
p=R/'reviews.inprogress.json';d=json.loads(p.read_text()) if p.exists() else {'method':'Primary agent reads each whole final public report before all-actor hidden grading; causal and numeric semantics reviewed separately from host replay. Prior/public case material known, not blind. No private reasoning inspected.','results':[]}
row=json.loads(sys.stdin.read());name=row['id'];report=R/name/'initial.REPORT.md'
assert (R/name/'actor-finished.json').exists() and not (R/name/'initial.grade.json').exists()
assert not any(x['id']==name for x in d['results'])
row.update(reviewedAt=datetime.now(timezone.utc).isoformat(),readFinalReport=report.exists(),reportSha256=hashlib.sha256(report.read_bytes()).hexdigest() if report.exists() else None)
if not report.exists():assert row.get('missingReportConfirmed')
d['results'].append(row);p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'reviewsRecorded':len(d['results']),'id':name}))
