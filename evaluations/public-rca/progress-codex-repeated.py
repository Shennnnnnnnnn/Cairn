"""Compact progress without opening grades or private reasoning."""
import json
from datetime import datetime, timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parent/'runs/2026-10-17-codex-sol-xhigh-repeated'
manifest=json.loads((ROOT/'manifest.json').read_text());rows=[];ended=[]
for row in manifest['schedule']:
    directory=ROOT/row['id'];path=directory/'initial.progress.json'
    if (directory/'actor-finished.json').exists(): ended.append(row['id']);continue
    if path.exists():
        progress=json.loads(path.read_text());age=(datetime.now(timezone.utc)-datetime.fromisoformat(progress['updatedAt'].replace('Z','+00:00'))).total_seconds()
        rows.append(dict(id=row['id'],elapsedSeconds=round(progress['elapsedSeconds']+age),toolCalls=progress['toolCalls'],lastTool=progress.get('lastTool'),lastUpdateAgeSeconds=round(age),turnFailed=progress['turnFailed']))
print(json.dumps(dict(ended=len(ended),total=len(manifest['schedule']),active=rows,pending=len(manifest['schedule'])-len(ended)-len(rows),finishedIds=ended),ensure_ascii=False,indent=2))
