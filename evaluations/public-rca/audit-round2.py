"""Audit frozen implementation, treatment traces and cross-round inputs without changing outputs."""
import collections, hashlib, json, statistics, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
REPO=ROOT.parent.parent
run=ROOT/'runs'/(sys.argv[1] if len(sys.argv)>1 else '2026-10-16-aiops2022-round2b')
m=json.loads((run/'manifest.json').read_text())
base=ROOT/'runs'/m['baselineRun'];bm=json.loads((base/'manifest.json').read_text())
checks=[];rows=[]
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def check(name,passed):checks.append({'name':name,'pass':bool(passed)})
for path,digest in m['implementationHashes'].items():
 p=REPO/path if path.startswith(('dist/','skills/')) else REPO/'src'/path
 check('frozen implementation: '+path,sha(p)==digest)
check('frozen verifier',sha(ROOT/'verify-artifacts.mjs')==m['verifierHash'])
check('frozen compatibility probe',sha(ROOT/'schema-probe-fixed.json')==m['compatibilityProbeHash'])
check('frozen skill',sha(REPO/'skills/cairn/SKILL.md')==m['skillHash'])
check('identifier policy frozen before outputs',sha(run/'identifier-policy.json')==m['identifierPolicyHash']==sha(base/'identifier-policy.json'))
for key in ['provider','model','thinking','piVersion','deadlineSeconds','outputTokenLimit','maxTokensPerResponse','parallelExperiments','order','cases','graderHash','promptHash','sourceManifestHash']:
 check('same first-round setting: '+key,m[key]==bm[key])
for case,mode in m['order']:
 d=run/case/mode
 if not (d/'initial.metrics.json').exists():continue
 metrics=json.loads((d/'initial.metrics.json').read_text());results=[];model_errors=[];calls=[];schema_errors=[]
 for line in (d/'initial.jsonl').read_text().splitlines():
  try:e=json.loads(line)
  except ValueError:continue
  if e.get('type')=='message_end' and e.get('message',{}).get('role')=='assistant':
   msg=e['message'];calls.extend(c for c in msg.get('content',[]) if c.get('type')=='toolCall')
   if msg.get('stopReason')=='error':model_errors.append(msg.get('errorMessage'))
  if e.get('type')=='tool_execution_end':
   content='\n'.join(c.get('text','') for c in e.get('result',{}).get('content',[]) if c.get('type')=='text')
   if e.get('toolName','').startswith('cairn_'):
    results.append({'name':e['toolName'],'error':bool(e.get('isError') or e.get('result',{}).get('isError')),'bytes':len(content.encode()),'content':content})
    if 'summary' in content and ('Invalid input' in content or 'requires summary' in content):schema_errors.append(e.get('toolCallId'))
 finishes=[]
 for r in results:
  if r['name']!='cairn_finish':continue
  try:receipt=json.loads(r['content']);finishes.append({'phase':receipt.get('phase'),'status':receipt.get('status'),'verification':receipt.get('verification'),'bytes':r['bytes']})
  except ValueError:finishes.append({'error':r['content'][:250],'bytes':r['bytes']})
 tasks=json.loads((d/'cairn-tasks.json').read_text()) if (d/'cairn-tasks.json').exists() else []
 states=[]
 for task in tasks:
  ep=d/f"cairn-{task['id']}.events.json"
  events=json.loads(ep.read_text()) if ep.exists() else []
  notices=[e for e in events if e['kind']=='budget.conclude_requested']
  verifies=[e['payload']['verification'] for e in events if e['kind']=='task.verified']
  states.append({'task':task['id'],'status':task['status'],'execution':task.get('execution'),'verification':task.get('verification'),'verifierScope':task.get('completionVerifier'),'criteria':len(task['criteria']),'covered':sum(bool(c.get('claimIds')) for c in task['criteria']),'budget':task['budget'],'budgetNotices':notices,'verifications':verifies,'eventCounts':dict(collections.Counter(e['kind'] for e in events)),'completionAttemptsDeferredForVerifier':sum(e['kind'] in ('task.finished','task.checked') and any('external' in i.lower() and 'required' in i.lower() for i in e['payload'].get('validation',{}).get('issues',[])) for e in events)})
  if mode=='pi-cairn':
   check(f'{case}: host deadline configured',bool(task['budget'].get('deadline')) and task['budget'].get('submitReserveMs')==m['hostReserveMs'])
   check(f'{case}: verifier attached',task.get('completionVerifier','').startswith('command:'))
 check(f'{case}/{mode}: same prompt as old arm',(d/'initial.prompt.txt').read_bytes()==(base/case/mode/'initial.prompt.txt').read_bytes())
 lengths=[r['bytes'] for r in results if r['name'] in ('cairn_checkpoint','cairn_finish') and not r['error']]
 rows.append({'case':case,'mode':mode,'nativeTools':metrics['nativeToolCalls'],'cairnTools':metrics['cairnToolCalls'],'toolErrors':metrics['toolErrors'],'checkpointSummaryErrors':len(schema_errors),'finishReceipts':finishes,'mutationReplyBytes':{'n':len(lengths),'sum':sum(lengths),'median':statistics.median(lengths) if lengths else None,'max':max(lengths) if lengths else None},'modelErrors':model_errors,'states':states})
result={'runId':m['runId'],'checks':checks,'passed':sum(c['pass'] for c in checks),'total':len(checks),'episodes':rows,'caveats':['Byte counts are text response sizes, not token billing.','Deferred internal structural checks before a verifier are not rejected user finish calls.','Verifier scope is output contract only; receipt pass is separate from independent RCA grading.']}
(run/'round2-audit.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'passed':result['passed'],'total':result['total'],'completedEpisodes':len(rows),'episodes':[{k:r[k] for k in ['case','mode','checkpointSummaryErrors','mutationReplyBytes']} for r in rows]},ensure_ascii=False,indent=2))
