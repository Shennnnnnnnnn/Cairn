"""Compact public execution metadata; no answer/report or hidden-label reads."""
import json
from pathlib import Path
root=Path(__file__).resolve().parent/'runs/2026-10-18-deepseek-original-context-round15'
load=lambda p:json.loads(p.read_text());m=load(root/'manifest.json')
for arm in m['arms']:
    done=[];live=[];accepted=0
    for row in m['schedule']:
        if row['arm']!=arm:continue
        directory=root/row['id']
        if (directory/'actor-finished.json').exists():
            done.append(row['id']);accepted+=bool(load(directory/'initial.acceptance.json')['ok'])
        elif directory.exists():
            paths=sorted((directory/'phases').glob('*/initial.progress.json')) or list(directory.glob('initial.progress.json'))
            if paths:
                p=paths[-1];v=load(p);live.append({'case':row['case'],'repeat':row['repeat'],'phase':p.parent.name,'lastEventElapsedSeconds':round(v.get('elapsedSeconds',0)),'turns':v.get('assistantTurns'),'tools':v.get('toolCalls'),'toolErrors':v.get('toolErrors'),'updatedAt':v.get('updatedAt')})
    print(json.dumps({'arm':arm,'ended':len(done),'accepted':accepted,'live':live},ensure_ascii=False))
if (root/'execution-ended.json').exists():print(json.dumps({'terminal':load(root/'execution-ended.json')},ensure_ascii=False))
