"""Read public Scheduler phase traces only; never runs/reads hidden root grades."""
import json,hashlib,collections
from pathlib import Path
base=Path(__file__).resolve().parent/'runs';roots={'original':base/'2026-10-18-scheduler-three-model-round12-final','restoredPi':base/'2026-10-18-scheduler-pi-recovery-round12'}
load=lambda path:json.loads(path.read_text())
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
assert all((root/'execution-ended.json').exists() and load(root/'execution-ended.json')['allActorsEnded'] for root in roots.values())
records=[]
for cohort,root in roots.items():
 for actor in load(root/'manifest.json')['schedule']:
  if actor['arm']!='cairn':continue
  directory=root/actor['id'];metric=load(directory/'initial.metrics.json')
  if not any(phase['phase'] in ['reason','explore'] for phase in metric.get('phases',[])):continue
  phases=[]
  for phase in metric['phases']:
   stage=directory/'phases'/phase['phaseId'];request=load(stage/'scheduler.request.json');final=stage/'initial.final.md';text=final.read_text() if final.exists() else ''
   output=None;parse_error=None;board=None
   try:output=json.loads(text)
   except ValueError as error:parse_error=str(error)
   try:board=json.loads(request['prompt'].rsplit('\nSaved blackboard:\n',1)[1])
   except (IndexError,ValueError):pass
   phases.append({'phaseId':phase['phaseId'],'phase':phase['phase'],'branch':phase.get('branch'),'requestId':request['id'],'sessionRef':phase.get('sessionRef'),'resumedFrom':phase.get('resumedFrom'),'seconds':phase['wallSeconds'],'usage':phase.get('usage'),'hostError':phase.get('error'),'publicFinalSHA256':sha(final) if final.exists() else None,'publicFinal':output,'parseError':parse_error,'boardBefore':board})
  events=load(directory/'scheduler.events.json');tasks=load(directory/'initial.cairn-tasks.json')
  checkpoints=[{'seq':event['seq'],'kind':event['kind'],'at':event['at'],'payload':event['payload']} for event in events if event['kind'] in ['task.checkpoint','branch.checkpoint','branch.merge','task.verified','task.completed','scheduler.phase_failed','scheduler.completion_rejected','scheduler.explore_failed','scheduler.reasoned','scheduler.stale_reason']]
  records.append({'cohort':cohort,'id':actor['id'],'model':actor['model'],'case':actor['case'],'repeat':actor['repeat'],'schedulerStatus':metric['schedulerStatus'],'schedulerReason':(metric.get('schedulerResult') or {}).get('reason'),'totalSeconds':metric['wallSeconds'],'totalUsage':metric.get('usage'),'phaseCounts':dict(collections.Counter(phase['phase'] for phase in phases)),'phases':phases,'blackboardAndValidationEvents':checkpoints,'finalTasks':[{'id':task['id'],'status':task['status'],'criteria':task['criteria'],'claims':[{'key':claim.get('key'),'text':claim['text'],'status':claim['status'],'from':claim.get('from'),'branchKey':claim.get('branchKey'),'covers':claim.get('relatedCriteria'),'provenance':claim.get('provenance')} for claim in task['claims']],'verification':task.get('verification')} for task in tasks]})
result={'method':'Public final assistant JSON, pre-phase saved blackboards, native session identity/usage and public engine checkpoint/branch/verification events only. No private reasoning inspected. No hidden root grades read or executed.','actualReasonExploreActors':len(records),'records':records}
out=roots['restoredPi']/'public-scheduler-paths.json';out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'actualReasonExploreActors':len(records),'actors':[{'cohort':row['cohort'],'id':row['id'],'schedulerStatus':row['schedulerStatus'],'phaseCounts':row['phaseCounts']} for row in records]},ensure_ascii=False,indent=2))
