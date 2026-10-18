"""Host-only progress; never runs or displays hidden label grading."""
import json, collections
from pathlib import Path
from datetime import datetime, timezone
root=Path(__file__).resolve().parent/'runs/2026-10-18-kimi-scheduler-round14'
manifest=json.loads((root/'manifest.json').read_text());counts=collections.Counter();running=[];finished=[]
for row in manifest['schedule']:
    directory=root/row['id']
    if (directory/'actor-finished.json').exists():
        counts[row['model']]+=1;m=json.loads((directory/'initial.metrics.json').read_text());a=json.loads((directory/'initial.acceptance.json').read_text());finished.append({'id':row['id'],'finishedAt':m.get('finishedAt'),'wallSeconds':round(m['wallSeconds'],1),'acceptance':a['ok'],'lastStop':m.get('finalStopReason'),'apiErrors':len(m.get('errors',[]))})
    elif directory.exists():
        p=directory/'initial.progress.json';outer=json.loads(p.read_text()) if p.exists() else {};phase=outer.get('phaseId');phase_path=directory/'phases'/phase/'initial.progress.json' if phase else None;m=json.loads(phase_path.read_text()) if phase_path and phase_path.exists() else outer
        age=(datetime.now(timezone.utc)-datetime.fromisoformat(m['updatedAt'].replace('Z','+00:00'))).total_seconds() if m.get('updatedAt') else None
        running.append({'id':row['id'],'secondsAtLastEvent':round(m.get('elapsedSeconds',0),1),'lastEventAgeSeconds':round(age,1) if age is not None else None,'streamAgeSeconds':round(datetime.now(timezone.utc).timestamp()-(directory/'initial.jsonl').stat().st_mtime,1) if (directory/'initial.jsonl').exists() else None,'tools':m.get('toolCalls'),'lastTool':m.get('lastTool'),'phaseId':outer.get('phaseId'),'phase':outer.get('phase'),'phaseCount':outer.get('phaseCount')})
finished.sort(key=lambda x:x.get('finishedAt') or '')
print(json.dumps({'done':sum(counts.values()),'total':len(manifest['schedule']),'byModel':dict(counts),'running':running,'recent':finished[-8:]},ensure_ascii=False,indent=2))
