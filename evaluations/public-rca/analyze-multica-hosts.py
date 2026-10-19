"""Operator-only accounting and exact-label grading; never exposed to task agents."""
from pathlib import Path
from datetime import datetime,timezone
from collections import Counter
import argparse,json,subprocess,sqlite3,hashlib,re,os,statistics
p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True);p.add_argument('--grade',action='store_true');p.add_argument('--grader',type=Path);p.add_argument('--verify-platform',action='store_true');a=p.parse_args();root=a.root.resolve();manifest=json.loads((root/'manifest.json').read_text());status=json.loads((root/'status.json').read_text());here=Path(__file__).resolve().parent
if a.grade:
 import importlib.util
 grader_path=a.grader or Path(manifest['graderSource']);spec=importlib.util.spec_from_file_location('frozen_host_grader',grader_path);grader=importlib.util.module_from_spec(spec);spec.loader.exec_module(grader)
if a.grade:assert all(r['runtimeStatus'] in ['completed','failed','cancelled','aborted'] for r in status['cases']),'Wait for every formal case before labels'
platform=json.loads((Path(manifest['runtime'])/'runtime/multica-platform.json').read_text());env=os.environ.copy()
for k in ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','http_proxy','https_proxy','all_proxy']:env[k]=platform['proxy']
for k in ['NO_PROXY','no_proxy']:env[k]='localhost,127.0.0.1,::1'
def cli(*args):
 r=subprocess.run([platform['cli'],'--workspace-id',manifest['workspaceId'],*args,'--output','json'],env=env,capture_output=True,text=True,check=True,timeout=45);return json.loads(r.stdout)
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def flatten(rows):return [item for row in rows for item in [row,*flatten(row.get('replies') or row.get('children') or [])]]
c=sqlite3.connect('file:'+manifest['database']+'?mode=ro',uri=True);tasks={json.loads(row[0])['id']:json.loads(row[0]) for row in c.execute('select state from tasks')};c.close();records=[]
for row in status['cases']:
 out=Path(row['outputDirectory']) if row.get('outputDirectory') else None;task=tasks.get(row.get('cairnTaskId'));sid=row.get('nativeSessionId') or (out.parent.name if out else None);record={k:row.get(k) for k in ['host','case','id','identifier','runId','runtimeStatus','cairnTaskId','cairnStatus','queryCount','completed']};record['nativeSessionId']=sid
 run=row['run'];start=run.get('started_at');end=run.get('completed_at');record['seconds']=(datetime.fromisoformat(end)-datetime.fromisoformat(start)).total_seconds() if start and end else None
 created=run.get('created_at');record['queueAndPreparationSeconds']=(datetime.fromisoformat(start)-datetime.fromisoformat(created)).total_seconds() if created and start else None
 record['endToEndSeconds']=(datetime.fromisoformat(end)-datetime.fromisoformat(created)).total_seconds() if created and end else None
 record['strictToolsOnly']=None;record['platformVerified']=None;record['noBudget']=not task or task.get('budget',{})=={}
 native=None;native_tools=None
 if sid:
  if row['host']=='pi':
   paths=[]
   for f in (Path.home()/'.multica/pi-sessions').glob('**/*.jsonl'):
    try:
     with f.open() as stream:header=json.loads(stream.readline())
     if header.get('id')==sid:paths.append(f)
    except (ValueError,OSError):pass
  elif row['host']=='claude':paths=list((root/'claude-config/projects').glob('**/'+sid+'.jsonl'))
  elif row['host']=='codex':
   # Resolve only this run's trusted launcher record, then confirm the exact
   # session_meta header. Never choose a recent session from the shared home.
   launch=root/'launches'/(row['runId']+'.json');paths=[]
   if launch.exists():
    location=json.loads(launch.read_text())
    if location.get('issueId')!=row['id'] or location.get('runId')!=row['runId']:raise ValueError('Native launch record belongs to another run')
    for f in (Path(location['codeXHome'])/'sessions').glob('**/*'+sid+'*.jsonl'):
     with f.open() as stream:header=json.loads(stream.readline())
     if header.get('type')=='session_meta' and header.get('payload',{}).get('id')==sid:paths.append(f)
  else:paths=list((root.parents[1]/'.cairn/dsh-home/sessions').glob('**/'+sid+'/session.v4.jsonl.zstd'))
  if len(paths)==1:
   r=subprocess.run(['/opt/homebrew/bin/node',str(here/'native-host-usage.mjs'),row['host'],str(paths[0])],capture_output=True,text=True,check=True);native=json.loads(r.stdout);record['nativeTraceSHA256']=sha(paths[0]);record['nativeTrace']=str(paths[0])
   if row['host']=='codex':
    native_tools=[]
    for line in paths[0].read_text().splitlines():
     event=json.loads(line);payload=event.get('payload',{})
     if event['type']=='event_msg' and payload.get('type')=='item_completed' and payload.get('item',{}).get('type')=='McpToolCall':native_tools.append(payload['item'])
    allowed=lambda t:t.get('server') in ['cairn','application'] and t.get('tool','').startswith(('cairn_','platform_','evidence_query')) or t.get('server')=='codex' and t.get('tool') in ['list_mcp_resources','list_mcp_resource_templates']
    record['nativeToolAudit']={'source':'exact native rollout item_completed/McpToolCall','calls':len(native_tools),'onlyScopedToolsAndResourceDiscovery':all(allowed(t) for t in native_tools),'extraResourceDiscoveryCalls':sum(t.get('server')=='codex' for t in native_tools),'crossTaskListReads':sum(t.get('tool')=='cairn_read' and (t.get('arguments') or {}).get('view')=='tasks' for t in native_tools),'toolErrors':sum(t.get('status')!='completed' or bool((t.get('result') or {}).get('isError')) for t in native_tools),'counts':dict(Counter(t['tool'] for t in native_tools))}
 record['nativeUsage']=native;record['tokens']=(native or {}).get('tokens',{}).get('total');record['usageLowerBound']=bool(not native or native.get('usageLowerBound') or (task or {}).get('usage',{}).get('partial'));record['blackboardUsage']=(task or {}).get('usage');record['findings']=len(task['claims']) if task else 0
 if out and (out/'REPORT.md').exists() and (out/'answer.json').exists():
  report=(out/'REPORT.md').read_text();answer=json.loads((out/'answer.json').read_text());receipt=json.loads((out/'receipt.json').read_text());ledger=[json.loads(s) for s in (out/'evidence-calls.jsonl').read_text().splitlines() if s.strip()];refs={q['result_ref'] for q in ledger};report_refs=set(re.findall(r'replay-local:[a-f0-9-]{36}',report));record['inputHashes']=sorted(set(q['inputHash'] for q in ledger));record['artifactHashes']={f:sha(out/f) for f in ['REPORT.md','answer.json','receipt.json']};record['queryCount']=len(ledger)
  record['evidenceIsolationPassed']=bool(ledger and all(q['issueId']==row['id'] and q['sessionId']==sid for q in ledger) and all(e['result_ref'] in refs for e in answer['evidence']) and report_refs and report_refs<=refs)
  record['deliveryHashesPassed']=bool(receipt.get('confirmed') and receipt['issueId']==row['id'] and receipt['sessionId']==sid and sha(out/'REPORT.md')==receipt['reportSHA256'] and sha(out/'answer.json')==receipt['answerSHA256'])
  record['prediction']=answer['candidates'][0];record['artifactsDirectory']=str(out)
  if a.verify_platform:
   issue=cli('issue','get',row['id']);data=cli('issue','comment','list',row['id'],'--recent','100','--compact');comments=flatten(data if isinstance(data,list) else data.get('comments',data.get('items',[])));marker='<!-- multica-delivery:'+receipt['id']+' -->';found=[x for x in comments if marker in x.get('content','')];agent=manifest['agents'][row['host']]['id'];post=found[0] if len(found)==1 else {};attachments=post.get('attachments',[])
   record['platformVerified']=bool(issue['status']=='in_review' and issue['assignee_id']==agent and post.get('id')==receipt['commentId'] and post.get('author_id')==agent and post.get('content','').replace(marker,'').strip()==report.strip() and all(any(t.get('filename')==f and t.get('size_bytes')==(out/f).stat().st_size and t.get('uploader_id')==agent for t in attachments) for f in ['REPORT.md','answer.json']))
   assert not re.search('cairn|carin',issue['title']+issue['description'],re.I),'Task text leaked framework instructions'
  if a.grade:
   score=grader.grade(row['case'],out);record['grade']=score;record['correct']=score['jointTop1'];record['businessDelivered']=bool(row['runtimeStatus']=='completed' and record.get('deliveryHashesPassed'));record['falseCompletion']=bool(record['businessDelivered'] and not score['jointTop1']);record['harnessFalseCompletion']=bool(row.get('completed') and not score['jointTop1'])
  # Snapshot only structured tool events; do not interpret private reasoning as evidence.
  folder=root/'events';folder.mkdir(exist_ok=True);f=folder/(row['host']+'-'+row['case']+'.json')
  if not f.exists() and row['runtimeStatus'] in ['completed','failed']:f.write_text(json.dumps(cli('issue','run-messages',row['runId']),ensure_ascii=False))
  if f.exists():
   events=json.loads(f.read_text());names=[e.get('tool','') for e in events if e['type']=='tool_use'];record['tools']=dict(Counter(names));record['strictToolsOnly']=all(n.startswith(('cairn_','platform_','evidence_query','mcp__cairn__','mcp__application__')) or n in ['read','grep','find','ls'] for n in names);record['cairnStartCalls']=sum(n.endswith('cairn_start') for n in names)
 if native_tools is not None:
  record['platformTools']=record.get('tools');record['tools']=record['nativeToolAudit']['counts'];record['cairnStartCalls']=sum(t['tool']=='cairn_start' for t in native_tools)
  record['toolAuditSource']='native rollout; platform event uploads may be incomplete'
 records.append(record)
summary={}
for h in manifest['agents']:
 rows=[r for r in records if r['host']==h];seconds=[r['seconds'] for r in rows if r['seconds'] is not None];tokens=[r['tokens'] for r in rows if r['tokens'] is not None]
 summary[h]={'attempts':len(rows),'runtimeCompleted':sum(r['runtimeStatus']=='completed' for r in rows),'cairnAndDeliveryCompleted':sum(bool(r['completed']) for r in rows),'correct':sum(bool(r.get('correct')) for r in rows) if a.grade else None,'falseCompletions':sum(bool(r.get('falseCompletion')) for r in rows) if a.grade else None,'secondsMean':statistics.mean(seconds) if seconds else None,'secondsMedian':statistics.median(seconds) if seconds else None,'tokensMean':statistics.mean(tokens) if tokens else None,'tokensTotal':sum(tokens) if tokens else None,'usageLowerBoundCases':sum(r['usageLowerBound'] for r in rows)}
result={'at':datetime.now(timezone.utc).isoformat(),'graded':a.grade,'mainSessionTokensOnly':True,'summary':summary,'excludedSetupRuns':manifest.get('excludedSetupRuns',[]),'records':records};file=root/('final-comparison.json' if a.grade else 'accounting.json');file.write_text(json.dumps(result,ensure_ascii=False,indent=2));print(json.dumps({'saved':str(file),'summary':summary},ensure_ascii=False))
