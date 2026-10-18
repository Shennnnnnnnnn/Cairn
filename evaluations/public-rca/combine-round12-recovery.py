"""Combine restored Pi36 with original Sol18 without dropping historical Pi36."""
import json,hashlib,collections
from pathlib import Path
from datetime import datetime
base=Path(__file__).resolve().parent/'runs';old=base/'2026-10-18-scheduler-three-model-round12-final';new=base/'2026-10-18-scheduler-pi-recovery-round12'
load=lambda path:json.loads(path.read_text())
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
save=lambda path,value:path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n')
original=load(old/'summary.json');restored=load(new/'summary.json');manifest=load(old/'manifest.json');new_manifest=load(new/'manifest.json')
assert load(old/'finished.json')['allPublicReportsReviewedBeforeGrading'] and load(new/'finished.json')['allPublicReportsReviewedBeforeGrading']
assert len(load(new/'review/report-reviews.json'))==90
assert manifest['implementation']==new_manifest['implementation'] and manifest['cases']==new_manifest['cases']
main_rows=[{**row,'cohort':'originalSol','sourceRoot':str(old)} for row in original['rows'] if row['model']=='sol']+[{**row,'cohort':'restoredPi','sourceRoot':str(new)} for row in restored['rows']]
historical=[{**row,'cohort':'historicalPi','sourceRoot':str(old)} for row in original['rows'] if row['model']!='sol']
all_rows=[*historical,*main_rows];assert len(main_rows)==54 and len(historical)==36 and len(all_rows)==90
main={'groups':{key:(original if key=='sol' else restored)['groups'][key] for key in ['deepseek','glm','sol']},'perCase':{key:(original if key=='sol' else restored)['perCase'][key] for key in ['deepseek','glm','sol']},'schedulerPhaseUsage':{key:(original if key=='sol' else restored)['schedulerPhaseUsage'][key] for key in ['deepseek','glm','sol']},'rows':main_rows,'cohortComposition':{'originalSol':18,'restoredPi':36},'allHistoricalPiRetained':True,'originalSummarySHA256':sha(old/'summary.json'),'restoredSummarySHA256':sha(new/'summary.json'),'globalReviewSHA256':sha(new/'review/report-reviews.json'),'frozenIntact':original['frozenIntact'] and restored['frozenIntact'],'nativeCheckFailures':original['nativeCheckFailures']+restored['nativeCheckFailures'],'globalConfigChanges':sorted(set(original['globalConfigChanges']+restored['globalConfigChanges']))}
save(new/'summary.main54.json',main)
save(new/'summary.all90.json',{'main54':main,'historicalPi36':{'groups':{key:original['groups'][key] for key in ['deepseek','glm']},'rows':historical},'rows':all_rows,'totalRecordedTokens':sum(row['tokens'] or 0 for row in all_rows),'totalActorSeconds':sum(row['wallSeconds'] for row in all_rows),'recordedAt':datetime.now().astimezone().isoformat()})

timeline=[]
for row in all_rows:
 metric=load(Path(row['sourceRoot'])/row['id']/'initial.metrics.json')
 timeline.extend([(metric['startedAt'],1,row['model'],row['cohort']),(metric['finishedAt'],-1,row['model'],row['cohort'])])
active=0;maximum=0;model_active=collections.Counter()
for at,delta,model,cohort in sorted(timeline,key=lambda item:(item[0],item[1])):
 active+=delta;model_active[model]+=delta;maximum=max(maximum,active)
 assert 0<=active<=3 and 0<=model_active[model]<=1,(at,model,cohort,dict(model_active))
assert active==0
save(new/'cross-cohort-concurrency-audit.json',{'allActors':90,'maxConcurrentActors':maximum,'perModelMaximum':1,'overlapFailures':[],'nativeModelSessionUniqueness':'Actor-level native session IDs checked by both independent native ledger audits; no cross-cohort same-model actor overlap.'})

recoveries=[]
for row in all_rows:
 directory=Path(row['sourceRoot'])/row['id'];metric=load(directory/'initial.metrics.json')
 if row['arm']!='cairn':continue
 for request in (metric.get('recovery') or {}).get('requests',[]):
  phase=next((phase for phase in metric.get('phases',[]) if phase['phaseId']==request['phaseId']),None)
  phase_metric=load(directory/'phases'/phase['phaseId']/'initial.metrics.json') if phase else None
  prior=[value for value in metric.get('phases',[]) if value['phaseId']<request['phaseId'] and value.get('sessionRef')==request['sessionRef']];preceding=prior[-1] if prior else None
  prior_metric=load(directory/'phases'/preceding['phaseId']/'initial.metrics.json') if preceding else None
  conclude_tools=load(directory/'phases'/phase['phaseId']/'initial.tools.json') if phase else []
  preceding_tools=load(directory/'phases'/preceding['phaseId']/'initial.tools.json') if preceding else []
  natural=bool(phase_metric and phase_metric.get('exitCode')==0 and (phase_metric.get('finalStopReason')=='stop' if row['host']=='pi' else not phase_metric.get('turnFailed')))
  recoveries.append({'cohort':row['cohort'],'id':row['id'],'model':row['model'],'phaseId':request['phaseId'],'requestedSameSessionRef':request['sessionRef'],'identityMatched':bool(phase and phase.get('sessionRef')==request['sessionRef']),'concludeHostEndedNormally':natural,'precedingPhase':preceding['phase'] if preceding else None,'precedingNativeToolCalls':len(preceding_tools),'precedingOutputTokens':(prior_metric.get('usage') or {}).get('output_tokens') if prior_metric else None,'concludeNativeToolCalls':len(conclude_tools),'concludeNativeToolNames':dict(collections.Counter(tool.get('name',tool.get('tool',tool.get('type'))) for tool in conclude_tools)),'newToolWorkAfterEmptyPriorPhase':bool(prior_metric and not preceding_tools and not (prior_metric.get('usage') or {}).get('output_tokens') and conclude_tools),'concludeWorkSemantics':'Requires manual public-tool review: identity continuation does not distinguish pure saving from renewed analysis','workflowCompletedAfterConclude':row['completed'],'savedTaskCompleted':row['taskMarkedCompleted'],'artifactsAccepted':row['acceptancePassed'],'rootCorrect':row['correct'],'effectiveCorrectDelivery':row['effectiveDelivery'],'usage':phase_metric.get('usage') if phase_metric else None,'wallSeconds':phase_metric.get('wallSeconds') if phase_metric else None})
save(new/'recovery-outcomes.json',{'method':'A matching same-session locator is identity continuation only. Normal conclude termination, workflow completion, artifact contract, root label and effective correct delivery are separate. No artificial fault injection.','requests':recoveries,'summary':{model:{'requested':len(rows:=[row for row in recoveries if row['model']==model]),'identityMatched':sum(row['identityMatched'] for row in rows),'normalConclude':sum(row['concludeHostEndedNormally'] for row in rows),'workflowCompleted':sum(row['workflowCompletedAfterConclude'] for row in rows),'effectiveCorrectDelivery':sum(row['effectiveCorrectDelivery'] for row in rows)} for model in ['deepseek','glm','sol']}})
print(json.dumps({'main54':{model:{arm:{key:group[key] for key in ['n','correct','completed','falseCompletion','recordedTokens']} for arm,group in groups.items()} for model,groups in main['groups'].items()},'all90Tokens':sum(row['tokens'] or 0 for row in all_rows),'maxConcurrentActors':maximum},ensure_ascii=False,indent=2))
