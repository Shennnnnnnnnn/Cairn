"""Read-only audit and comparison. Never changes agent outputs or state."""
import collections,hashlib,json,sqlite3,sys,copy
from pathlib import Path
from grade import grade
ROOT=Path(__file__).parent
run=ROOT/'runs'/(sys.argv[1] if len(sys.argv)>1 else '2026-10-16-aiops2022')
m=json.loads((run/'manifest.json').read_text());rows=[];checks=[]
def check(name,ok):checks.append({'name':name,'pass':bool(ok)})
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
check('frozen grader',sha(ROOT/'grade.py')==m['graderHash'])
check('frozen runner',sha(ROOT/m.get('runnerFile','run.mjs'))==m['runnerHash'])
check('frozen prompt',sha(ROOT/'prompt.txt')==m['promptHash'])
check('case manifest identical to pre-run snapshot',sha(ROOT/'case-manifest.json')==m['sourceManifestHash']==sha(run/'case-manifest.json'))
check('protocol snapshot matches pre-run hash',sha(run/'protocol.before.md')==m['protocolHash'])
check('all eight runs reached terminal', (run/'finished.json').exists())
for case,mode in m['order']:
 d=run/case/mode
 if not (d/'episode.metrics.json').exists():continue
 metrics=json.loads((d/'initial.metrics.json').read_text());g=grade(case,d/'workspace')
 reviewed=copy.deepcopy(g)
 if g.get('truth',{}).get('level')=='service' and g.get('validAnswer'):
  def svc_entity(value):return str(value or '').removesuffix('-grpc').removesuffix('-http')
  rank=next((i for i,c in enumerate(g['predictions'],1) if svc_entity(c.get('location'))==g['truth']['cmdb_id'] and c.get('level')=='service'),None)
  reviewed.update(top1Entity=rank==1,top3Entity=rank is not None,reciprocalRank=1/rank if rank else 0,jointTop1=rank==1 and g['top1Family'])
  reviewed['identifierReview']='protocol suffix only, per identifier-policy.json; original frozen grade retained'
 (d/'reviewed-grade.json').write_text(json.dumps(reviewed,ensure_ascii=False,indent=2)+'\n')
 saved=json.loads((d/'grade.json').read_text());check(f'{case}/{mode}: reproducible scores',saved==g)
 hashes=json.loads((d/'input-hashes.json').read_text());check(f'{case}/{mode}: identical initial inputs',hashes==m['cases'][case])
 check(f'{case}/{mode}: evidence and task immutable',all(sha(d/'workspace'/p)==h for p,h in hashes.items()))
 check(f'{case}/{mode}: actual model/thinking',metrics['actualModels']==[m['provider']+'/'+m['model']] and metrics['actualThinkingLevels']==[m['thinking']])
 # Independently aggregate complete provider messages, ignoring final agent_end replay.
 complete=[];tools=[];seen=set()
 for line in (d/'initial.jsonl').read_text().splitlines():
  try:e=json.loads(line)
  except ValueError:continue
  if e.get('type')=='message_end' and e.get('message',{}).get('role')=='assistant':
   msg=e['message'];key=msg.get('responseId') or (str(msg.get('timestamp'))+':'+str(len(complete)))
   if key in seen:continue
   seen.add(key);complete.append(msg);tools += [c for c in msg.get('content',[]) if c.get('type')=='toolCall']
 usage={k:sum(x.get('usage',{}).get(k,0) for x in complete) for k in metrics['usage']}
 check(f'{case}/{mode}: raw usage and call counts',usage==metrics['usage'] and len(tools)==metrics['toolCalls'])
 check(f'{case}/{mode}: treatment boundary',any(t['name'].startswith('cairn_') for t in tools)==(mode=='pi-cairn'))
 states=[];db=d/'workspace/.cairn/state.db'
 if db.exists():
  con=sqlite3.connect(f'file:{db}?mode=ro',uri=True)
  for (state,) in con.execute('SELECT state FROM tasks ORDER BY rowid'):
   task=json.loads(state);events=[{'seq':s,'kind':k,'payload':json.loads(p),'at':a} for s,k,p,a in con.execute('SELECT seq,kind,payload,at FROM events WHERE task_id=? ORDER BY seq',(task['id'],))]
   (d/f"cairn-{task['id']}.events.json").write_text(json.dumps(events,ensure_ascii=False,indent=2)+'\n')
   states.append({'id':task['id'],'status':task['status'],'epoch':task['owner']['epoch'],'criteria':len(task['criteria']),'coveredCriteria':sum(bool(c.get('claimIds')) for c in task['criteria']),'claims':len(task['claims']),'claimStatuses':dict(collections.Counter(c['status'] for c in task['claims'])),'historySnapshots':sum(len(c.get('history',[])) for c in task['claims']),'dependencyLinks':sum(len(c.get('from',[])) for c in task['claims']),'progressDependencyLinks':sum(len(p.get('from',[])) for p in task.get('progress',[])),'failedFinishAttempts':sum(e['kind']=='task.finished' and e['payload'].get('validation',{}).get('ok') is False for e in events),'eventCounts':dict(collections.Counter(e['kind'] for e in events)),'revision':task['revision'],'evidenceMode':task['evidenceMode'],'exportHTML':(d/f"cairn-{task['id']}.html").exists()})
  con.close()
 modelErrors=[x for x in complete if x.get('stopReason')=='error']
 rows.append({'case':case,'mode':mode,'metrics':metrics,'grade':g,'reviewedGrade':reviewed,'cairn':states,'nativeSessionFiles':len(list((d/'sessions').glob('*.jsonl'))),'modelErrorResponses':len(modelErrors),'recoveredModelErrorResponses':sum(any(y.get('stopReason')!='error' for y in complete[i+1:]) for i,x in enumerate(complete) if x.get('stopReason')=='error'),'usageIsLowerBound':metrics['timedOut'] or metrics.get('finalStopReason')!='stop' or bool(modelErrors)})
summary={'manifest':m,'results':rows,'byMode':{}}
for mode in ['pi','pi-cairn']:
 rs=[r for r in rows if r['mode']==mode]
 summary['byMode'][mode]={'runs':len(rs),'reviewedTop1Entity':sum(r['reviewedGrade']['top1Entity'] for r in rs),'reviewedTop3Entity':sum(r['reviewedGrade']['top3Entity'] for r in rs),'reviewedJointTop1':sum(r['reviewedGrade']['jointTop1'] for r in rs),'reviewedMRR':sum(r['reviewedGrade']['reciprocalRank'] for r in rs)/len(rs) if rs else None,'top1Entity':sum(r['grade']['top1Entity'] for r in rs),'top3Entity':sum(r['grade']['top3Entity'] for r in rs),'top1Family':sum(r['grade']['top1Family'] for r in rs),'jointTop1':sum(r['grade']['jointTop1'] for r in rs),'meanReciprocalRank':sum(r['grade']['reciprocalRank'] for r in rs)/len(rs) if rs else None,'wallSeconds':sum(r['metrics']['wallSeconds'] for r in rs),'tokens':sum(r['metrics']['usage']['totalTokens'] for r in rs),'outputTokens':sum(r['metrics']['usage']['output'] for r in rs),'nativeToolCalls':sum(r['metrics']['nativeToolCalls'] for r in rs),'cairnToolCalls':sum(r['metrics']['cairnToolCalls'] for r in rs),'toolErrors':sum(r['metrics']['toolErrors'] for r in rs),'failedFinishAttempts':sum(t['failedFinishAttempts'] for r in rs for t in r['cairn']),'timeouts':sum(r['metrics']['timedOut'] for r in rs),'abnormalRuns':sum(r['metrics']['exitCode']!=0 or r['metrics'].get('finalStopReason')!='stop' for r in rs),'modelErrorResponses':sum(r['modelErrorResponses'] for r in rs),'recoveredModelErrorResponses':sum(r['recoveredModelErrorResponses'] for r in rs),'usageIsLowerBound':any(r['usageIsLowerBound'] for r in rs)}
(run/'summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
audit={'passed':sum(c['pass'] for c in checks),'total':len(checks),'checks':checks}
(run/'audit.json').write_text(json.dumps(audit,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'byMode':summary['byMode'],'audit':{k:audit[k] for k in ('passed','total')},'results':[{'case':r['case'],'mode':r['mode'],'prediction':r['grade'].get('predictions',[{}])[0].get('location'),'entity':r['grade']['top1Entity'],'family':r['grade']['top1Family'],'joint':r['grade']['jointTop1'],'seconds':round(r['metrics']['wallSeconds'],1),'tokens':r['metrics']['usage']['totalTokens'],'cairn':r['cairn']} for r in rows]},ensure_ascii=False,indent=2))
