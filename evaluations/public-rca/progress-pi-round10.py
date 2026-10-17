import json
from pathlib import Path
R=Path(__file__).resolve().parent/'runs/2026-10-18-pi-deepseek-round10-repeated'
rows=[]
for entry in json.loads((R/'manifest.json').read_text())['schedule']:
    p=R/entry['id'];f=p/'initial.progress.json'
    if not f.exists():continue
    d=json.loads(f.read_text());rows.append({'id':entry['id'],'ended':(p/'actor-finished.json').exists(),**{k:d.get(k) for k in ['elapsedSeconds','assistantTurns','toolCalls','toolErrors','lastTool','outputTokens']}})
print(json.dumps({'ended':sum(r['ended'] for r in rows),'active':[r for r in rows if not r['ended']],'finished':[r['id'] for r in rows if r['ended']],'executionEnded':(R/'execution-ended.json').exists()},ensure_ascii=False))
