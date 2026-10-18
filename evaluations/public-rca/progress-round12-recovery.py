"""Both cohorts, public execution metadata only; never reads hidden labels."""
import json,collections
from pathlib import Path
from datetime import datetime,timezone
base=Path(__file__).resolve().parent/'runs'
cohorts={'original':base/'2026-10-18-scheduler-three-model-round12-final','restoredPi':base/'2026-10-18-scheduler-pi-recovery-round12'}
load=lambda p:json.loads(p.read_text())
counts={};running=[];finished=[];open_models=collections.Counter()
for cohort,root in cohorts.items():
 manifest=load(root/'manifest.json');done=collections.Counter()
 for row in manifest['schedule']:
  directory=root/row['id']
  if (directory/'actor-finished.json').exists():
   done[row['model']]+=1;m=load(directory/'initial.metrics.json');finished.append({'cohort':cohort,'id':row['id'],'finishedAt':m['finishedAt'],'seconds':round(m['wallSeconds'],1),'apiErrors':len(m.get('errors',[])),'schedulerStatus':m.get('schedulerStatus'),'phases':m.get('phaseCount',1),'contractAccepted':load(directory/'initial.acceptance.json')['ok']})
  elif directory.exists():
   outer=load(directory/'initial.progress.json') if (directory/'initial.progress.json').exists() else {};phase=outer.get('phaseId');path=directory/'phases'/phase/'initial.progress.json' if phase else None
   inner=load(path) if path and path.exists() else outer;age=(datetime.now(timezone.utc)-datetime.fromisoformat(inner['updatedAt'].replace('Z','+00:00'))).total_seconds() if inner.get('updatedAt') else None
   running.append({'cohort':cohort,'id':row['id'],'phase':outer.get('phase'),'phaseId':phase,'phaseSecondsAtLastEvent':round(inner.get('elapsedSeconds',0),1),'lastEventAge':round(age,1) if age is not None else None,'tools':inner.get('toolCalls'),'lastTool':inner.get('lastTool'),'pid':inner.get('pid')});open_models[row['model']]+=1
 counts[cohort]={'done':sum(done.values()),'total':len(manifest['schedule']),'byModel':dict(done)}
finished.sort(key=lambda row:row['finishedAt'])
main=counts['restoredPi']['done']+counts['original']['byModel'].get('sol',0)
print(json.dumps({'revisedMain54Done':main,'all90Done':sum(value['done'] for value in counts.values()),'cohorts':counts,'openActorsByModel':dict(open_models),'running':running,'recent':finished[-8:]},ensure_ascii=False,indent=2))
