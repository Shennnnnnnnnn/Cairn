"""Report main runs separately from fresh-context recovery; never feed hidden grades back."""
import hashlib,json,re,sys,sqlite3
from datetime import datetime
from pathlib import Path
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parent.parent
RUN=ROOT/'runs'/(sys.argv[1] if len(sys.argv)>1 else '2026-10-17-aiops2022-round6-unbudgeted')
manifest=json.loads((RUN/'manifest.json').read_text());base=ROOT/'runs'/manifest['baselineRun']
def load(p,default=None):return json.loads(p.read_text()) if p.exists() else default
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def reviewed(grade):
 g=dict(grade)
 if g.get('truth',{}).get('level')=='service':
  def entity(candidate):
   if candidate.get('level')!='service':return None
   return re.sub(r'-(grpc|http)$','',candidate.get('location','').lower())
  truth=g['truth']['cmdb_id'].lower();rank=next((i for i,c in enumerate(g.get('predictions',[]),1) if entity(c)==truth),None)
  g.update(top1Entity=rank==1,top3Entity=rank is not None,reciprocalRank=1/rank if rank else 0,jointTop1=rank==1 and g.get('top1Family',False),identifierReview='Frozen service protocol suffix rule; pod/node scoring unchanged')
 return g
MODES=['pi','pi-cairn-previous','pi-cairn']
checks=[]
def check(name,passed):checks.append({'name':name,'pass':bool(passed)})
finished=load(RUN/'finished.json',{})
check('all actors ended before hidden grading',finished.get('allActorsEndedBeforeGrading') is True)
if finished.get('allActorsEndedBeforeGrading') is True:
 last_actor_end=max(datetime.fromisoformat(load(RUN/case/mode/'initial.metrics.json')['finishedAt'].replace('Z','+00:00')).timestamp() for case,mode in manifest['order'])
 for case,mode in manifest['order']:check(case+'/'+mode+' grade timestamp after all actors', (RUN/case/mode/'initial.grade.json').stat().st_mtime>=last_actor_end)
for mode,entries in manifest['archiveHashesByArm'].items():
 archive=RUN/(manifest['previousImplementationArchive'] if mode=='pi-cairn-previous' else manifest['implementationArchive'])
 for name,sha in entries.items():check('frozen '+mode+' '+name,digest(archive/name)==sha)
for name,key in [('verify-artifacts.mjs','verifierHash'),('verify-reproduction.py','numericVerifierHash'),('verify-submission.mjs','compositionVerifierHash'),('reproduction-contract.md','reproductionContractHash'),('grade.py','graderHash')]:check('frozen '+name,digest(ROOT/name)==manifest[key])
check('frozen runner',digest(RUN/'runner.frozen.mjs')==manifest['runnerHash'])
check('archived protocol',digest(RUN/'protocol.before.md')==manifest['protocolHash'])
check('archived source manifest',digest(RUN/'case-manifest.json')==manifest['sourceManifestHash'])
check('identifier policy',digest(RUN/'identifier-policy.json')==manifest['identifierPolicyHash']==digest(base/'identifier-policy.json'))
bm=load(base/'manifest.json')
for name in ['provider','model','thinking','piVersion','parallelExperiments','cases','graderHash','promptHash','sourceManifestHash','cairnGuidanceHash','artifactRequirements','verifierHash','numericVerifierHash','compositionVerifierHash','reproductionContractHash','order','archiveHashesByArm']:check('same baseline '+name,manifest[name]==bm[name])
check('same selected model',manifest['model']=='global:deepseek-v4.1-flash' and manifest['crossRoundModelComparable'] is True)
check('twelve ordered primary episodes',len(manifest['order'])==12 and all(sum(mode==m for _,mode in manifest['order'])==4 for m in MODES))
check('no primary time limit',manifest['deadlineSeconds'] is None)
check('no cumulative output limit',manifest['outputTokenLimit'] is None)
check('no per-response evaluator override',manifest['maxTokensPerResponse'] is None)
check('no host submit reserve',manifest['hostReserveMs'] is None)
check('native model cap retained',manifest['registeredModelLimits']['maxTokens']==128000)
check('launch README reconstructed and hash verified',digest(RUN/'shared-protocol.at-launch.md')==manifest['sharedProtocolHash'])
check('prior protocol archive hash verified',digest(base/'protocol.before.md')==bm['protocolHash'])
runner=(RUN/'runner.frozen.mjs').read_text()
check('no actor watchdog', 'setTimeout' not in runner)
check('no actor maxTokens rewrite', 'm.maxTokens=' not in runner)
check('host deadline/reserve removed', 'delete env.CAIRN_DEADLINE;delete env.CAIRN_SUBMIT_RESERVE_MS;' in runner)
old_runner=(base/'runner.frozen.mjs').read_text()
for prompt_name in ['common','cairnInitial']:
 check('same shared '+prompt_name,re.search(r'const '+prompt_name+r"='([^']*)';",runner).group(1)==re.search(r'const '+prompt_name+r"='([^']*)';",old_runner).group(1))
def accepted_submission(task,d,phase):
 if task['status']!='completed':return False
 verification=task.get('verification',{})
 if verification.get('status')!='passed' or verification.get('epoch')!=task['owner']['epoch'] or verification.get('verifier')!=task.get('completionVerifier'):return False
 for required in manifest['artifactRequirements']:
  expected=str((Path(task['owner']['cwd'])/required).resolve())
  artifact=next((a for a in task.get('artifacts',[]) if a['path']==expected),None)
  snapshot=d/(phase+'.'+required)
  if artifact is None or not snapshot.is_file() or digest(snapshot)!=artifact['sha256']:return False
 return True
rows=[]
for case,mode in manifest['order']:
 d=RUN/case/mode;metric=load(d/'initial.metrics.json')
 if not metric:continue
 if not (RUN/'finished.json').exists():continue
 row={'case':case,'mode':mode,'metrics':metric,'grade':load(d/'initial.grade.json',{}),'acceptance':load(d/'initial.acceptance.json',{}),'tasks':load(d/'initial.cairn-tasks.json',[]),'recovery':None,'finishes':[],'handoffReads':0,'oldTaskReads':0,'handoffReportReads':0}
 expected_prompt=(ROOT/'prompt.txt').read_text()+(re.search(r"const cairnInitial='([^']*)';",runner).group(1) if mode!='pi' else '')
 check(case+'/'+mode+' saved actual prompt', (d/'initial.prompt.txt').read_text()==expected_prompt)
 check(case+'/'+mode+' actual model',not metric['actualModels'] or metric['actualModels']==[manifest['provider']+'/'+manifest['model']])
 check(case+'/'+mode+' no evaluator interruption',not metric['timedOut'] and not metric['budgetExceeded'])
 check(case+'/'+mode+' no automatic recovery',not (d/'recovery.metrics.json').exists())
 check(case+'/'+mode+' actual thinking',not metric['actualThinkingLevels'] or metric['actualThinkingLevels']==[manifest['thinking']])
 row['accepted']=any(accepted_submission(t,d,'initial') for t in row['tasks']) if mode!='pi' else not metric['timedOut'] and not metric['budgetExceeded'] and metric['exitCode']==0 and bool(row['grade'].get('validAnswer'))
 row['reviewedGrade']=reviewed(row['grade']);(d/'initial.reviewed-grade.json').write_text(json.dumps(row['reviewedGrade'],ensure_ascii=False,indent=2)+'\n')
 declared_tools={call['id']:call for call in load(d/'initial.tools.json',[])}
 row['finishPayloadBytes']=[len(json.dumps(call.get('arguments',{}),ensure_ascii=False,separators=(',',':')).encode()) for call in declared_tools.values() if call['name']=='cairn_finish']
 phase_output=0;output_at_call={}
 for line in (d/'initial.jsonl').read_text().splitlines():
  try:event=json.loads(line)
  except ValueError:continue
  if event.get('type')=='auto_retry_start':row['nativeRetries']=row.get('nativeRetries',0)+1
  if event.get('type')=='auto_retry_end':row.setdefault('nativeRetryResults',[]).append({k:v for k,v in event.items() if k not in ['message','content']})
  if event.get('type')=='message_end' and event.get('message',{}).get('role')=='assistant':
   if event['message'].get('stopReason')=='error':row['providerRequestErrors']=row.get('providerRequestErrors',0)+1
   phase_output+=event['message'].get('usage',{}).get('output',0)
   for content in event['message'].get('content',[]):
    if content.get('type')=='toolCall':output_at_call[content['id']]=phase_output
   row['maxResponseOutput']=max(row.get('maxResponseOutput',0),event['message'].get('usage',{}).get('output',0))
   row['responseLengthEvents']=row.get('responseLengthEvents',0)+int(event['message'].get('stopReason')=='length')
  if event.get('type')=='tool_execution_end' and event.get('toolName')=='cairn_checkpoint' and not event.get('isError'):
   row['checkpoints']=row.get('checkpoints',0)+1
   row.setdefault('checkpointTimes',[]).append(event.get('toolCallId'))
   args=declared_tools.get(event.get('toolCallId'),{}).get('arguments',{})
   if args.get('findings') and 'firstFindingCheckpointOutputTokens' not in row:row['firstFindingCheckpointOutputTokens']=output_at_call.get(event.get('toolCallId'))
   key='findingCheckpoints' if args.get('findings') else 'summaryOnlyCheckpoints' if set(args)<= {'summary','task_id'} else 'otherCheckpoints'
   row[key]=row.get(key,0)+1
  if event.get('type')=='tool_execution_end' and event.get('toolName')=='cairn_finish':
   text='\n'.join(c.get('text','') for c in event.get('result',{}).get('content',[]) if c.get('type')=='text')
   try:receipt=json.loads(text);row['finishes'].append({'phase':receipt.get('phase'),'verification':receipt.get('verification'),'error':bool(event.get('isError'))})
   except ValueError:row['finishes'].append({'error':text[:500]})
 recovered=load(d/'recovery.metrics.json')
 if recovered:
  recovery_tools=load(d/'recovery.tools.json',[])
  row['recovery']={'finishPayloadBytes':[len(json.dumps(call.get('arguments',{}),ensure_ascii=False,separators=(',',':')).encode()) for call in recovery_tools if call['name']=='cairn_finish'],'metrics':recovered,'grade':reviewed(load(d/'recovery.grade.json',{})),'acceptance':load(d/'recovery.acceptance.json',{}),'tasks':load(d/'cairn-tasks.json',[])}
  for line in (d/'recovery.jsonl').read_text().splitlines():
   try:event=json.loads(line)
   except ValueError:continue
   if event.get('type')=='message_end':
    contents=event.get('message',{}).get('content',[])
    if not isinstance(contents,list):continue
    for content in contents:
     if not isinstance(content,dict):continue
     if content.get('name')=='cairn_read' and content.get('arguments',{}).get('view','context') in ['context','handoffs','details']:
      row['handoffReads']+=1
      if content.get('arguments',{}).get('task_id') in {t['id'] for t in row['tasks']}:row['oldTaskReads']+=1
  old_reports=[h['report'] for t in row['tasks'] for h in t.get('handoffs',[]) if h.get('report')]
  for call in load(d/'recovery.tools.json',[]):
   args=call.get('arguments',{})
   if call['name']=='read' and any(Path(args.get('path',args.get('file_path',''))).name==Path(report).name for report in old_reports):row['handoffReportReads']+=1
   if call['name']=='bash' and re.search(r'\bcat\s+',args.get('command','')) and any(Path(report).name in args.get('command','') for report in old_reports):row['handoffReportReads']+=1
  old_ids={t['id'] for t in row['tasks']}
  new_completed=any(accepted_submission(t,d,'recovery') and t['id'] not in old_ids for t in row['recovery']['tasks'])
  recovered_metrics=row['recovery']['metrics']
  row['recovery']['operationallyDelivered']=not recovered_metrics['timedOut'] and not recovered_metrics['budgetExceeded'] and recovered_metrics['exitCode']==0 and bool(row['recovery']['grade'].get('validAnswer')) and (mode=='pi' or new_completed)
  row['recovery']['acceptedCorrect']=row['recovery']['operationallyDelivered'] and bool(row['recovery']['grade'].get('jointTop1')) and bool(row['recovery']['acceptance'].get('ok'))
  row['recovery']['correctedWrongAnswer']=bool(row['grade'].get('validAnswer')) and not row['reviewedGrade'].get('jointTop1',False) and bool(row['recovery']['grade'].get('jointTop1'))
  (d/'recovery.reviewed-grade.json').write_text(json.dumps(row['recovery']['grade'],ensure_ascii=False,indent=2)+'\n')
 if mode!='pi':
  database=d/'workspace/.cairn/state.db'
  if database.exists():
   sql=sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)
   persisted=[dict(zip(['kind','at','payload'],event)) for event in sql.execute('SELECT kind,at,payload FROM events WHERE at<=? ORDER BY seq',(metric['finishedAt'],)).fetchall()]
   sql.close()
   milestones=[event for event in persisted if event['kind']=='task.checkpoint']
   row['persistedCheckpoints']=len(milestones)
   row['persistedFindingCheckpoints']=sum(bool(json.loads(event['payload']).get('input',{}).get('findings')) for event in milestones)
   row['firstCheckpointSeconds']=(datetime.fromisoformat(milestones[0]['at'].replace('Z','+00:00'))-datetime.fromisoformat(metric['startedAt'].replace('Z','+00:00'))).total_seconds() if milestones else None
   row['explorationReviewRequests']=sum(event['kind']=='exploration.review_requested' for event in persisted)
  for task in row['tasks']:
   check(case+'/'+mode+' no task-level budget',not task.get('budget'))
   argv=[v.replace('<episode>',str(d)) for v in manifest['verifierCommand']]
   verifier_id='command:'+hashlib.sha256(json.dumps({'argv':argv,'artifacts':manifest['artifactRequirements']},separators=(',',':')).encode()).hexdigest()
   check(case+' actual verifier command',task.get('completionVerifier')==verifier_id)
   check(case+' required artifacts',task.get('artifactRequirements')==manifest['artifactRequirements'])
   row.setdefault('handoffs',[]).extend(task.get('handoffs',[]))
   row['automaticHandoffs']=row.get('automaticHandoffs',0)+sum(bool(h.get('source')) for h in task.get('handoffs',[]))
   row['handoffsWithFacts']=row.get('handoffsWithFacts',0)+sum(bool(h.get('from')) for h in task.get('handoffs',[]))
   for handoff in task.get('handoffs',[]):
    if handoff.get('source'):
     source=handoff['source']
     check(case+'/'+mode+' handoff source '+handoff['id'],source.get('taskId')==task['id'] and source.get('state')=='saved' and handoff.get('sessionRef')==source.get('host','')+':'+source.get('sessionId','') and source.get('epoch',0)<=task['owner']['epoch'] and len(source.get('candidate',''))==64 and bool(handoff.get('detail')))
   row.setdefault('artifacts',[]).extend(task.get('artifacts',[]))
   for handoff in task.get('handoffs',[]):
    if handoff.get('report'):row.setdefault('handoffReportLocations',[]).append({'report':handoff['report'],'exists':(d/'workspace'/handoff['report']).is_file(),'sessionRef':handoff.get('sessionRef')})
 currentInputs=load(d/'input-hashes.json',{})
 for name,sha in manifest['cases'][case].items():
  if name.startswith('evidence/'):
   check(case+'/'+mode+' original '+name,currentInputs.get(name)==sha and digest(d/'workspace'/name)==sha)
 row['exceededFormerCumulativeOutput']=metric['usage']['output']>bm['outputTokenLimit']
 row['exceededFormerWallTime']=metric['wallSeconds']>bm['deadlineSeconds']['initial']
 row['exceededFormerResponseOutput']=row.get('maxResponseOutput',0)>bm['maxTokensPerResponse']
 row['modelDeclaredBudgets']=[t.get('budget',{}) for t in row['tasks']]
 rows.append(row)

def aggregate(items):
 results={}
 for mode in MODES:
  group=[r for r in items if r['mode']==mode];completed=[r for r in group if r['accepted']]
  wrong=[r for r in completed if not r['reviewedGrade'].get('jointTop1')]
  results[mode]={'n':len(group),'validAnswers':sum(bool(r['grade'].get('validAnswer')) for r in group),'top1Entity':sum(bool(r['reviewedGrade'].get('top1Entity')) for r in group),'jointTop1':sum(bool(r['reviewedGrade'].get('jointTop1')) for r in group),'accepted':len(completed),'wrongAccepted':len(wrong),'correctAccepted':len(completed)-len(wrong),'acceptedReplayCorrect':sum(bool(r['reviewedGrade'].get('jointTop1')) and bool(r['acceptance'].get('ok')) for r in completed),'incompleteFinishes':sum(f.get('phase')=='incomplete' for r in group for f in r['finishes']),'finishErrors':sum(bool(f.get('error')) for r in group for f in r['finishes']),'rejectedFinishes':sum(f.get('phase')=='incomplete' or bool(f.get('error')) for r in group for f in r['finishes']),'falseCompletionAll':len(wrong)/len(group) if group else None,'falseCompletionAccepted':len(wrong)/len(completed) if completed else None,'responseLengthStops':sum(r['metrics'].get('finalStopReason')=='length' for r in group),'timeouts':sum(bool(r['metrics']['timedOut']) for r in group),'budgetStops':sum(bool(r['metrics']['budgetExceeded']) for r in group),'wallSeconds':sum(r['metrics']['wallSeconds'] for r in group),'usage':{k:sum(r['metrics']['usage'].get(k,0) for r in group) for k in ['input','output','cacheRead','cacheWrite','totalTokens','reasoning']},'usageIsLowerBound':any(r['metrics']['usageIsLowerBound'] for r in group),'monetaryCostKnown':False,'nativeTools':sum(r['metrics']['nativeToolCalls'] for r in group),'cairnTools':sum(r['metrics']['cairnToolCalls'] for r in group),'replayPassed':sum(r['acceptance'].get('ok',False) for r in group),'summaryOnlyCheckpoints':sum(r.get('summaryOnlyCheckpoints',0) for r in group),'findingCheckpoints':sum(r.get('findingCheckpoints',0) for r in group),'otherCheckpoints':sum(r.get('otherCheckpoints',0) for r in group),'persistedCheckpoints':sum(r.get('persistedCheckpoints',0) for r in group),'explorationReviewRequests':sum(r.get('explorationReviewRequests',0) for r in group),'checkpoints':sum(r.get('checkpoints',0) for r in group),'episodesWithCheckpoint':sum(r.get('checkpoints',0)>0 for r in group),'prerequisiteEdges':sum(len(c.get('from',[])) for r in group for task in r.get('tasks',[]) for c in task.get('claims',[])),'persistedFindingCheckpoints':sum(r.get('persistedFindingCheckpoints',0) for r in group),'finishPayloadBytes':sum(sum(r.get('finishPayloadBytes',[])) for r in group),'maxFinishPayloadBytes':max([n for r in group for n in r.get('finishPayloadBytes',[])]or[0]),'automaticHandoffs':sum(r.get('automaticHandoffs',0) for r in group),'handoffsWithFacts':sum(r.get('handoffsWithFacts',0) for r in group),'handoffs':sum(len(r.get('handoffs',[])) for r in group),'handoffKeys':sum(len({h['key'] for h in r.get('handoffs',[])}) for r in group),'handoffReportsPresent':sum(v['exists'] for r in group for v in r.get('handoffReportLocations',[])),'recovery':{'n':sum(bool(r['recovery']) for r in group),'jointCorrect':sum(bool(r['recovery'] and r['recovery']['grade'].get('jointTop1')) for r in group),'replayPassed':sum(bool(r['recovery'] and r['recovery']['acceptance'].get('ok')) for r in group),'seconds':sum(r['recovery']['metrics']['wallSeconds'] for r in group if r['recovery']),'tokens':sum(r['recovery']['metrics']['usage']['totalTokens'] for r in group if r['recovery']),'usageIsLowerBound':any(r['recovery']['metrics']['usageIsLowerBound'] for r in group if r['recovery']),'handoffReads':sum(r['handoffReads'] for r in group),'oldTaskReads':sum(r['oldTaskReads'] for r in group),'handoffReportReads':sum(r['handoffReportReads'] for r in group),'finishPayloadBytes':sum(sum(r['recovery']['finishPayloadBytes']) for r in group if r['recovery']),'maxFinishPayloadBytes':max([n for r in group if r['recovery'] for n in r['recovery']['finishPayloadBytes']]or[0]),'operationallyDelivered':sum(bool(r['recovery'] and r['recovery']['operationallyDelivered']) for r in group),'acceptedCorrect':sum(bool(r['recovery'] and r['recovery']['acceptedCorrect']) for r in group),'correctedWrongAnswers':sum(bool(r['recovery'] and r['recovery']['correctedWrongAnswer']) for r in group)}}
 for mode in MODES:
  group=[r for r in items if r['mode']==mode]
  final=[{'delivered':r['recovery']['operationallyDelivered'] if r['recovery'] else r['accepted'],'grade':r['recovery']['grade'] if r['recovery'] else r['reviewedGrade'],'replay':r['recovery']['acceptance'].get('ok',False) if r['recovery'] else r['acceptance'].get('ok',False)} for r in group]
  results[mode]['withRecovery']={'n':len(group),'delivered':sum(v['delivered'] for v in final),'jointTop1':sum(bool(v['grade'].get('jointTop1')) for v in final),'correctReplayDelivered':sum(v['delivered'] and v['replay'] and bool(v['grade'].get('jointTop1')) for v in final),'wrongDelivered':sum(v['delivered'] and not v['grade'].get('jointTop1') for v in final),'wallSeconds':results[mode]['wallSeconds']+results[mode]['recovery']['seconds'],'tokens':results[mode]['usage']['totalTokens']+results[mode]['recovery']['tokens'],'usageIsLowerBound':results[mode]['usageIsLowerBound'] or results[mode]['recovery']['usageIsLowerBound']}
 return results
baseline_summary=load(base/'summary.json');baseline=baseline_summary['byMode']
for mode,metrics in baseline.items():metrics['acceptedReplayCorrect']=sum(bool(row.get('accepted')) and bool(row.get('reviewedGrade',{}).get('jointTop1')) and bool(row.get('acceptance',{}).get('ok')) for row in baseline_summary['results'] if row['mode']==mode)
summary={'analysisHash':digest(Path(__file__)),'manifest':manifest,'budgetedBaseline':baseline,'sameModelControl':'pi-cairn-previous','byMode':aggregate(rows),'results':rows,'audit':{'passed':sum(c['pass'] for c in checks),'total':len(checks),'failures':[c for c in checks if not c['pass']]},'finished':(RUN/'finished.json').exists()}
(RUN/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'finished':summary['finished'],'episodes':len(rows),'byMode':summary['byMode'],'audit':summary['audit']},ensure_ascii=False,indent=2))
