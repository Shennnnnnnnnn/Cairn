"""Report main runs separately from fresh-context recovery; never feed hidden grades back."""
import hashlib,json,re,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent;REPO=ROOT.parent.parent
RUN=ROOT/'runs'/(sys.argv[1] if len(sys.argv)>1 else '2026-10-17-aiops2022-round3c')
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
checks=[]
def check(name,passed):checks.append({'name':name,'pass':bool(passed)})
for name,sha in manifest['implementationHashes'].items():
 path=REPO/name if name.startswith(('dist/','skills/')) else REPO/'src'/name
 check('frozen implementation '+name,digest(path)==sha)
for name,key in [('verify-artifacts.mjs','verifierHash'),('verify-reproduction.py','numericVerifierHash'),('verify-submission.mjs','compositionVerifierHash'),('reproduction-contract.md','reproductionContractHash'),('grade.py','graderHash')]:check('frozen '+name,digest(ROOT/name)==manifest[key])
check('frozen runner',digest(RUN/'runner.frozen.mjs')==manifest['runnerHash'])
check('archived protocol',digest(RUN/'protocol.before.md')==manifest['protocolHash'])
check('archived source manifest',digest(RUN/'case-manifest.json')==manifest['sourceManifestHash'])
check('identifier policy',digest(RUN/'identifier-policy.json')==manifest['identifierPolicyHash']==digest(base/'identifier-policy.json'))
bm=load(base/'manifest.json')
for name in ['provider','model','thinking','piVersion','outputTokenLimit','maxTokensPerResponse','parallelExperiments','order','cases','graderHash','promptHash','sourceManifestHash']:check('same baseline '+name,manifest[name]==bm[name])
check('same primary time budget',manifest['deadlineSeconds']['initial']==bm['deadlineSeconds']['initial'])
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
 row={'case':case,'mode':mode,'metrics':metric,'grade':load(d/'initial.grade.json',{}),'acceptance':load(d/'initial.acceptance.json',{}),'tasks':load(d/'initial.cairn-tasks.json',[]),'recovery':None,'finishes':[],'handoffReads':0,'oldTaskReads':0}
 check(case+'/'+mode+' actual model',not metric['actualModels'] or metric['actualModels']==[manifest['provider']+'/'+manifest['model']])
 check(case+'/'+mode+' actual thinking',not metric['actualThinkingLevels'] or metric['actualThinkingLevels']==[manifest['thinking']])
 row['accepted']=any(accepted_submission(t,d,'initial') for t in row['tasks']) if mode=='pi-cairn' else not metric['timedOut'] and not metric['budgetExceeded'] and metric['exitCode']==0 and bool(row['grade'].get('validAnswer'))
 row['reviewedGrade']=reviewed(row['grade']);(d/'initial.reviewed-grade.json').write_text(json.dumps(row['reviewedGrade'],ensure_ascii=False,indent=2)+'\n')
 for line in (d/'initial.jsonl').read_text().splitlines():
  try:event=json.loads(line)
  except ValueError:continue
  if event.get('type')=='tool_execution_end' and event.get('toolName')=='cairn_finish':
   text='\n'.join(c.get('text','') for c in event.get('result',{}).get('content',[]) if c.get('type')=='text')
   try:receipt=json.loads(text);row['finishes'].append({'phase':receipt.get('phase'),'verification':receipt.get('verification'),'error':bool(event.get('isError'))})
   except ValueError:row['finishes'].append({'error':text[:500]})
 recovered=load(d/'recovery.metrics.json')
 if recovered:
  row['recovery']={'metrics':recovered,'grade':reviewed(load(d/'recovery.grade.json',{})),'acceptance':load(d/'recovery.acceptance.json',{}),'tasks':load(d/'cairn-tasks.json',[])}
  for line in (d/'recovery.jsonl').read_text().splitlines():
   try:event=json.loads(line)
   except ValueError:continue
   if event.get('type')=='message_end':
    for content in event.get('message',{}).get('content',[]):
     if content.get('name')=='cairn_read' and content.get('arguments',{}).get('view','context') in ['context','handoffs','details']:
      row['handoffReads']+=1
      if content.get('arguments',{}).get('task_id') in {t['id'] for t in row['tasks']}:row['oldTaskReads']+=1
  old_ids={t['id'] for t in row['tasks']}
  new_completed=any(accepted_submission(t,d,'recovery') and t['id'] not in old_ids for t in row['recovery']['tasks'])
  recovered_metrics=row['recovery']['metrics']
  row['recovery']['operationallyDelivered']=not recovered_metrics['timedOut'] and not recovered_metrics['budgetExceeded'] and recovered_metrics['exitCode']==0 and bool(row['recovery']['grade'].get('validAnswer')) and (mode=='pi' or new_completed)
  row['recovery']['acceptedCorrect']=row['recovery']['operationallyDelivered'] and bool(row['recovery']['grade'].get('jointTop1')) and bool(row['recovery']['acceptance'].get('ok'))
  row['recovery']['correctedWrongAnswer']=not row['reviewedGrade'].get('jointTop1',False) and bool(row['recovery']['grade'].get('jointTop1'))
  (d/'recovery.reviewed-grade.json').write_text(json.dumps(row['recovery']['grade'],ensure_ascii=False,indent=2)+'\n')
 if mode=='pi-cairn':
  for task in row['tasks']:
   argv=[v.replace('<episode>',str(d)) for v in manifest['verifierCommand']]
   verifier_id='command:'+hashlib.sha256(json.dumps({'argv':argv,'artifacts':manifest['artifactRequirements']},separators=(',',':')).encode()).hexdigest()
   check(case+' actual verifier command',task.get('completionVerifier')==verifier_id)
   check(case+' required artifacts',task.get('artifactRequirements')==manifest['artifactRequirements'])
   row.setdefault('handoffs',[]).extend(task.get('handoffs',[]))
   row.setdefault('artifacts',[]).extend(task.get('artifacts',[]))
   for handoff in task.get('handoffs',[]):
    if handoff.get('report'):row.setdefault('handoffReportLocations',[]).append({'report':handoff['report'],'exists':(d/'workspace'/handoff['report']).is_file(),'sessionRef':handoff.get('sessionRef')})
 currentInputs=load(d/'input-hashes.json',{})
 for name,sha in manifest['cases'][case].items():
  if name.startswith('evidence/'):
   check(case+'/'+mode+' original '+name,currentInputs.get(name)==sha and digest(d/'workspace'/name)==sha)
 rows.append(row)

def aggregate(items):
 results={}
 for mode in ['pi','pi-cairn']:
  group=[r for r in items if r['mode']==mode];completed=[r for r in group if r['accepted']]
  wrong=[r for r in completed if not r['reviewedGrade'].get('jointTop1')]
  results[mode]={'n':len(group),'top1Entity':sum(bool(r['reviewedGrade'].get('top1Entity')) for r in group),'jointTop1':sum(bool(r['reviewedGrade'].get('jointTop1')) for r in group),'accepted':len(completed),'wrongAccepted':len(wrong),'correctAccepted':len(completed)-len(wrong),'incompleteFinishes':sum(f.get('phase')=='incomplete' for r in group for f in r['finishes']),'finishErrors':sum(bool(f.get('error')) for r in group for f in r['finishes']),'rejectedFinishes':sum(f.get('phase')=='incomplete' or bool(f.get('error')) for r in group for f in r['finishes']),'falseCompletionAll':len(wrong)/len(group) if group else None,'falseCompletionAccepted':len(wrong)/len(completed) if completed else None,'timeouts':sum(bool(r['metrics']['timedOut']) for r in group),'budgetStops':sum(bool(r['metrics']['budgetExceeded']) for r in group),'wallSeconds':sum(r['metrics']['wallSeconds'] for r in group),'usage':{k:sum(r['metrics']['usage'].get(k,0) for r in group) for k in ['input','output','cacheRead','cacheWrite','totalTokens','reasoning']},'usageIsLowerBound':any(r['metrics']['usageIsLowerBound'] for r in group),'monetaryCostKnown':False,'nativeTools':sum(r['metrics']['nativeToolCalls'] for r in group),'cairnTools':sum(r['metrics']['cairnToolCalls'] for r in group),'replayPassed':sum(r['acceptance'].get('ok',False) for r in group),'handoffs':sum(len(r.get('handoffs',[])) for r in group),'handoffKeys':sum(len({h['key'] for h in r.get('handoffs',[])}) for r in group),'handoffReportsPresent':sum(v['exists'] for r in group for v in r.get('handoffReportLocations',[])),'recovery':{'n':sum(bool(r['recovery']) for r in group),'jointCorrect':sum(bool(r['recovery'] and r['recovery']['grade'].get('jointTop1')) for r in group),'replayPassed':sum(bool(r['recovery'] and r['recovery']['acceptance'].get('ok')) for r in group),'seconds':sum(r['recovery']['metrics']['wallSeconds'] for r in group if r['recovery']),'tokens':sum(r['recovery']['metrics']['usage']['totalTokens'] for r in group if r['recovery']),'handoffReads':sum(r['handoffReads'] for r in group),'oldTaskReads':sum(r['oldTaskReads'] for r in group),'operationallyDelivered':sum(bool(r['recovery'] and r['recovery']['operationallyDelivered']) for r in group),'acceptedCorrect':sum(bool(r['recovery'] and r['recovery']['acceptedCorrect']) for r in group),'correctedWrongAnswers':sum(bool(r['recovery'] and r['recovery']['correctedWrongAnswer']) for r in group)}}
 return results
summary={'analysisHash':digest(Path(__file__)),'manifest':manifest,'baseline':load(base/'summary.json')['byMode'],'byMode':aggregate(rows),'results':rows,'audit':{'passed':sum(c['pass'] for c in checks),'total':len(checks),'failures':[c for c in checks if not c['pass']]},'finished':(RUN/'finished.json').exists()}
(RUN/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'finished':summary['finished'],'episodes':len(rows),'byMode':summary['byMode'],'audit':summary['audit']},ensure_ascii=False,indent=2))
