"""Layer observable execution failures after global review and sealed root grading."""
import json,collections
from pathlib import Path
base=Path(__file__).resolve().parent/'runs';old=base/'2026-10-18-scheduler-three-model-round12-final';new=base/'2026-10-18-scheduler-pi-recovery-round12'
load=lambda path:json.loads(path.read_text())
assert load(old/'finished.json')['allPublicReportsReviewedBeforeGrading'] and load(new/'finished.json')['allPublicReportsReviewedBeforeGrading']
assert len(load(new/'review/report-reviews.json'))==90
rows=[]
for cohort,root in [('original',old),('restoredPi',new)]:
 for row in load(root/'summary.json')['rows']:
  directory=root/row['id'];metric=load(directory/'initial.metrics.json');events=load(directory/'scheduler.events.json') if row['arm']=='cairn' else [];phases=[];requests={}
  for phase in metric.get('phases',[]):
   request=load(directory/'phases'/phase['phaseId']/'scheduler.request.json');native=load(directory/'phases'/phase['phaseId']/'initial.metrics.json');requests[request['id']]={'phaseId':phase['phaseId'],'phase':phase['phase'],'native':native}
  for event in events:
   if event['kind']!='scheduler.phase_failed':continue
   payload=event['payload'];source=requests.get(payload.get('id'),{});native=source.get('native') or {};error=payload.get('error','');category='scheduler_protocol_or_execution_unclassified';schema_issues=[]
   if native.get('interrupted'):category='actual_native_interruption'
   elif native.get('turnFailed') or native.get('exitCode')!=0:category='native_host_failure'
   elif 'raw json object' in error.lower():category='public_final_not_raw_json'
   else:
    try:
     parsed=json.loads(error)
     if isinstance(parsed,list) and all(isinstance(item,dict) and item.get('code') and 'path' in item for item in parsed):schema_issues=parsed;category='phase_schema_validation'
    except ValueError:pass
   phases.append({'phaseId':source.get('phaseId'),'phase':payload.get('phase'),'category':category,'error':error,'schemaIssues':schema_issues})
  rejections=[event['payload'].get('validation',{}) for event in events if event['kind']=='scheduler.completion_rejected']
  rows.append({'cohort':cohort,'id':row['id'],'model':row['model'],'arm':row['arm'],'naturalTermination':row['naturalTermination'],'workflowCompleted':row['completed'],'savedTaskCompleted':row['taskMarkedCompleted'],'strictIncompleteReason':row['reason'],'apiErrorMessages':len(metric.get('errors',[])),'terminalAPIError':metric.get('errors',[])[-1].get('message') if metric.get('errors') else None,'schedulerStatus':metric.get('schedulerStatus'),'schedulerReason':(metric.get('schedulerResult') or {}).get('reason'),'hostErrorPhaseCount':metric.get('phaseErrors',0),'schedulerRejectedPhases':phases,'completionRejections':rejections,'contractPassed':row['contractPassed'],'numericReplayPassed':row['arithmeticPassed'],'hostAcceptanceIssues':row['acceptanceIssues'],'rootCorrect':row['correct'],'falseCompletion':row['falseCompletion'],'effectiveCorrectDelivery':row['effectiveDelivery']})
result={'method':'Independent layers, not mutually exclusive causes: native/API stop metadata; Scheduler raw-final/schema rejection; artifact contract/numeric replay; coverage; hidden root label only after global90 review+grading. No private reasoning inspected. API messages do not prove which backend component failed.','rows':rows,'phaseFailureCategories':dict(collections.Counter(phase['category'] for row in rows for phase in row['schedulerRejectedPhases']))}
(new/'failure-layers.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'actors':len(rows),'phaseFailureCategories':result['phaseFailureCategories']},ensure_ascii=False,indent=2))
