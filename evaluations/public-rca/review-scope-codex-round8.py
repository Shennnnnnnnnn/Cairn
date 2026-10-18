"""Seal static scope coverage and human decisions on all flagged public fields."""
import hashlib,json
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parent/'runs/2026-10-17-codex-sol-xhigh-round8-repeated'
load=lambda path:json.loads(path.read_text())
manifest=load(ROOT/'manifest.json');scan=load(ROOT/'public-scope.scan.json');decisions=load(ROOT/'public-scope.decisions.json')
if not scan['allComplete'] or scan['actors']!=18:raise SystemExit('Scan all 18 finished actors first')
results=[]
for row in manifest['schedule']:
    directory=ROOT/row['id'];item=load(directory/'public-scope.scan.json')
    digest=hashlib.sha256((directory/'initial.tools.json').read_bytes()).hexdigest()
    if digest!=item['toolInputSha256']:raise SystemExit('Public tool record changed')
    decision=next((d for d in decisions['decisions'] if d['id']==row['id']),None)
    if item['flags'] or item['cacheOutsideTmp']:
        if decision is None or decision['toolInputSha256']!=digest:raise SystemExit('Review all flags for '+row['id'])
        if not set(flag['kind'] for flag in item['flags']).issubset(decision['kindsReviewed']):raise SystemExit('New flag needs review for '+row['id'])
        if item['cacheOutsideTmp'] and 'currentPythonCache' not in decision['kindsReviewed']:raise SystemExit('Review actual cache placement for '+row['id'])
    results.append(dict(id=row['id'],tools=item['tools'],fileChangeEvents=item['fileChangeEvents'],fileChangePaths=item['fileChangePaths'],nativeToolMetadata=len(item['nativeToolMetadata']),nativeCwds=item['nativeCwds'],flags=item['flags'],cacheOutsideTmp=item['cacheOutsideTmp'],decision=decision,unflaggedStaticScan=item['flags']==[] and item['cacheOutsideTmp']==[]))
record=dict(reviewedAt=datetime.now(timezone.utc).isoformat(),allFinishedActorsReviewed=True,actors=len(results),tools=sum(row['tools'] for row in results),fileChangeEvents=sum(row['fileChangeEvents'] for row in results),fileChangePaths=sum(row['fileChangePaths'] for row in results),nativeToolMetadata=sum(row['nativeToolMetadata'] for row in results),confirmedScopeViolations=sum(len((row['decision'] or {}).get('confirmedScopeViolations',[])) for row in results),temporaryConventionDeviations=sum(len((row['decision'] or {}).get('confirmedTemporaryDeviations',[])) for row in results),unresolvedTemporaryPossibilities=sum(len((row['decision'] or {}).get('unresolvedTemporaryPossibilities',[])) for row in results),method='All resolved public commands/MCP arguments, file-change paths and public native cwd/workdir metadata scanned; every flag manually reviewed. This does not assert manual full-script inspection or OS isolation.',privateReasoningInspected=False,hiddenGradesRead=False,results=results)
(ROOT/'public-scope.review.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:record[k] for k in ['actors','tools','fileChangeEvents','confirmedScopeViolations','temporaryConventionDeviations','unresolvedTemporaryPossibilities']},ensure_ascii=False))
