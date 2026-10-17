"""Post-run engineering comparison; never opens private reasoning items."""
import hashlib,json,sqlite3
from datetime import datetime
from pathlib import Path

HERE=Path(__file__).resolve().parent
RUN=HERE/'runs/2026-10-17-codex-sol-xhigh-round7b'
def load(p,default=None):return json.loads(p.read_text()) if p.exists() else default
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def successful_starts(tools):
 ids=[]
 for tool in tools:
  if tool.get('type')!='mcp_tool_call' or tool.get('tool')!='cairn_start' or tool.get('status')!='completed' or tool.get('error') or (tool.get('result') or {}).get('isError'):continue
  result=tool.get('result') or {};values=[result.get('structuredContent'),result.get('structured_content'),result]
  for content in result.get('content',[]):
   if content.get('type')=='text':
    try:values.append(json.loads(content['text']))
    except (ValueError,TypeError):pass
  for value in values:
   if isinstance(value,dict) and isinstance(value.get('taskId'),str) and value['taskId'] not in ids:ids.append(value['taskId'])
 return ids
manifest=load(RUN/'manifest.json');finished=load(RUN/'finished.json',{})
if not finished.get('allActorsEndedBeforeGrading'):raise SystemExit('All four actors must end before analysis')
if not finished.get('allCairnProtocolsVerified') or not finished.get('allImplementationsFrozenBeforeActors'):raise SystemExit('Every private Cairn protocol and pre-launch freeze must be verified')
audit=[]
def check(name,ok):audit.append(dict(name=name,passed=bool(ok)))
check('reviews frozen before grading',sha(RUN/'qualitative-audit.json')==finished['qualitativeAuditSha256'])
check('manifest frozen at grading',sha(RUN/'manifest.json')==finished['manifestSha256'])
check('corrected integration probe sealed',sha(RUN/'corrected-probe.json')==manifest['correctedProbeSha256'] and load(RUN/'corrected-probe.json')['success'])
for name,key in [('runner.frozen.mjs','runnerHash'),('driver.frozen.mjs','driverHash'),('driver.after.mjs','driverAfterHash'),('prompt.frozen.txt','promptHash'),('reproduction-contract.frozen.md','contractHash')]:check(name,sha(RUN/name)==manifest[key])
for name,expected in manifest['verifiers'].items():check('verifier/'+name,sha(RUN/name)==expected)
prior=load(HERE/'runs'/manifest['baselineRun']/'manifest.json')
check('reference labels match sealed earlier run',sha(RUN/'case-manifest.json')==prior['sourceManifestHash'])
check('identifier policy matches sealed earlier run',sha(RUN/'identifier-policy.json')==prior['identifierPolicyHash'])
for name,expected in manifest['afterSourceHashes'].items():check('repository source matches tested after/'+name,sha(HERE/'../../src'/name)==expected)
for version,files in manifest['implementations'].items():
 archive=RUN/({'before':'implementation','previous':'implementation-previous','after':'implementation-after'}[version])
 for name,expected in files.items():check(version+'/'+name,sha(archive/name)==expected)
 if version!='after':check(version+' matches Pi baseline archive',files==prior['archiveHashesByArm']['pi-cairn-previous' if version=='previous' else 'pi-cairn'])
check('before archive matches its original pre-optimization source',all(manifest['implementations']['before'].get('src/'+name)==expected for name,expected in manifest['beforeSourceAtStart'].items()))
for excluded in manifest.get('invalidatedDevelopmentRuns',[]):
 check('excluded development record '+excluded['runId'],sha(HERE/'runs'/excluded['runId']/'invalidated.json')==excluded['recordSha256'])
for name,expected in manifest['globalConfigHashes'].items():check('global config unchanged '+name,sha(Path(name))==expected)
rows=[];task_hash=None
for arm in manifest['arms']:
 d=RUN/arm;work=d/'workspace';metric=load(d/'initial.metrics.json');grade=load(d/'initial.grade.json');acceptance=load(d/'initial.acceptance.json');tools=load(d/'initial.tools.json');tasks=load(d/'initial.cairn-tasks.json',[]);launch=load(d/'launch.json');assurance=None
 check(arm+' every implementation frozen before launch',datetime.fromisoformat(manifest['afterPreparedAt'].replace('Z','+00:00'))<=datetime.fromisoformat(metric['startedAt'].replace('Z','+00:00')))
 metadata=metric['actualModels']==['gpt-6.1-sol'] and metric['actualEfforts']==['xhigh']
 unavailable=(metric['exitCode']!=0 or metric['turnFailed']) and not metric['actualModels'] and not metric['actualEfforts']
 check(arm+' model metadata or recorded pre-inference failure',metadata or unavailable)
 check(arm+' no evaluator budgets',launch['evaluationBudgets'] is None and not metric['timedOut'] and not metric['budgetExceeded'])
 check(arm+' prompt', (d/'initial.prompt.txt').read_text()==(RUN/'prompt.frozen.txt').read_text()+(manifest['cairnGuidance'] if arm!='codex' else ''))
 check(arm+' grade after all actors',datetime.fromtimestamp((d/'initial.grade.json').stat().st_mtime).astimezone()>=datetime.fromisoformat(finished['allActorsEndedAt'].replace('Z','+00:00')))
 for name,expected in load(d/'input-hashes.json').items():check(arm+' input/'+name,(work/name).exists() and sha(work/name)==expected)
 actual=sha(work/'TASK.md');task_hash=task_hash or actual;check(arm+' identical TASK contract',actual==task_hash)
 for name,expected in manifest['cases'].items():
  if name.startswith('evidence/'):check(arm+' original/'+name,sha(work/name)==expected)
 if arm!='codex':
  starts=successful_starts(tools);db=work/'.cairn/state.db';local_tasks=[]
  if db.is_file():
   with sqlite3.connect(db.as_uri()+'?mode=ro',uri=True) as connection:local_tasks=[json.loads(row[0]) for row in connection.execute('SELECT state FROM tasks ORDER BY rowid')]
  if local_tasks!=tasks:raise SystemExit('Invalid experiment: live local task differs from frozen task for '+arm)
  mcp=launch['options']['mcp_servers.cairn'];env=launch.get('hostEnvironment',{});argv=[mcp['command'],str(RUN/'verify-submission.mjs'),str(d/'input-hashes.json')];required=['answer.json','REPORT.md','checks.json']
  identity='command:'+hashlib.sha256(json.dumps(dict(argv=argv,artifacts=required),ensure_ascii=False,separators=(',',':')).encode()).hexdigest()
  for started in starts:
   task=next((task for task in tasks if task['id']==started),None)
   protocol_ok=task is not None and task.get('owner',{}).get('host')=='codex' and task['owner'].get('sessionId')==metric.get('threadId') and task['owner'].get('cwd')==str(work) and task.get('completionVerifier')==identity and sorted(task.get('artifactRequirements',[]))==sorted(required)
   if not protocol_ok:raise SystemExit('Invalid experiment: successful start receipt is missing or owner/verifier/requirements differ for '+arm)
  if not load(d/'initial.cairn-protocol.json',{}).get('valid'):raise SystemExit('Invalid experiment: private Cairn protocol failed for '+arm)
  forwarded=['CAIRN_DB','CAIRN_WORKSPACE','CAIRN_VERIFY_COMMAND','CAIRN_VERIFY_ARTIFACTS','CAIRN_VERIFY_TIMEOUT_MS','CAIRN_DEADLINE','CAIRN_SUBMIT_RESERVE_MS']
  check(arm+' explicit MCP forwarding',all(name in mcp.get('env_vars',[]) for name in forwarded))
  check(arm+' explicit MCP private database','--db' in mcp['args'] and mcp['args'][mcp['args'].index('--db')+1]==str(db))
  check(arm+' host environment identity',env.get('CAIRN_DB')==str(db) and env.get('CAIRN_WORKSPACE')==str(work) and json.loads(env.get('CAIRN_VERIFY_COMMAND','null'))==argv and json.loads(env.get('CAIRN_VERIFY_ARTIFACTS','null'))==required)
  check(arm+' no inherited deadlines','CAIRN_DEADLINE' not in env and 'CAIRN_SUBMIT_RESERVE_MS' not in env)
  archive=RUN/('implementation-previous' if arm.endswith('previous') else 'implementation-after' if arm.endswith('after') else 'implementation')
  assurance=load(d/'initial.cairn-assurance.json')
  if assurance is None:raise SystemExit('Run check-codex-assurance.mjs after all four actors end before analyzing '+arm)
  check(arm+' frozen assurance task snapshot',assurance.get('sourceTaskSnapshotSha256')==sha(d/'initial.cairn-tasks.json'))
  version='previous' if arm.endswith('previous') else 'after' if arm.endswith('after') else 'before'
  check(arm+' frozen assurance engine',assurance.get('engineArtifactSha256')==manifest['implementations'][version]['dist/index.js'])
  check(arm+' frozen assurance after all actors',datetime.fromisoformat(assurance['assessedAt'].replace('Z','+00:00'))>=datetime.fromisoformat(finished['allActorsEndedAt'].replace('Z','+00:00')))
  check(arm+' frozen assurance is read only',assurance.get('externalVerifierExecuted') is False and assurance.get('modelCalled') is False and assurance.get('sourceDatabaseOpened') is False)
  plugin=Path(launch['plugin'])
  for name,expected in manifest['implementations']['previous' if arm.endswith('previous') else 'after' if arm.endswith('after') else 'before'].items():
   if name.startswith('dist/plugins/codex/'):
    local=name.removeprefix('dist/plugins/codex/')
    if local in ['.mcp.json','hooks/hooks.json']:
     config=load(archive/name);node=launch['options']['mcp_servers.cairn']['command']
     if local=='.mcp.json':config['mcpServers']['cairn']['command']=node
     else:
      quote=lambda s:"'"+str(s).replace("'","'\\''")+"'"
      for entries in config['hooks'].values():
       for entry in entries:
        for hook in entry.get('hooks',[]):
         if hook.get('type')=='command':hook['command']=quote(node)+' '+quote(plugin/'scripts/hook.mjs')
     check(arm+' deterministic installation path rewrite/'+local,load(plugin/local)==config)
    else:check(arm+' installed/'+name,sha(plugin/local)==expected)
  check(arm+' installed project skill',sha(work/'.agents/skills/cairn/SKILL.md')==sha(archive/'skills/cairn/SKILL.md'))
 usage=metric.get('usage') or {};raw_input=usage.get('input_tokens',0);cached=usage.get('cached_input_tokens',0);output=usage.get('output_tokens',0)
 natural=metric['exitCode']==0 and not metric['turnFailed'];present=all((d/('initial.'+f)).exists() for f in ['answer.json','REPORT.md','checks.json'])
 accepted=[]
 for t in tasks:
  v=t.get('verification',{});snapshots={a['path']:a for a in t.get('artifacts',[])}
  current=t['status']=='completed' and v.get('status')=='passed' and v.get('epoch')==t['owner']['epoch']
  checked=next((row for row in (assurance or {}).get('tasks',[]) if row.get('taskId')==t['id']),{})
  current=current and checked.get('verificationCurrent') is True and checked.get('reportCheck',{}).get('ok') is True
  current=current and all(str(work/f) in snapshots and sha(d/('initial.'+f))==snapshots[str(work/f)]['sha256'] for f in ['answer.json','REPORT.md','checks.json']) if present else False
  accepted.append(current)
 complete=bool(natural and present and (grade.get('validAnswer') if arm=='codex' else len(tasks)==1 and len(successful_starts(tools))==1 and any(accepted)))
 mcp=[t for t in tools if t['type']=='mcp_tool_call'];finish=[t for t in mcp if t['tool']=='cairn_finish']
 row=dict(arm=arm,model=manifest['model'],effort=manifest['effort'],wallSeconds=metric['wallSeconds'],naturalTermination=natural,completed=complete,artifactReplayPassed=bool(acceptance.get('ok')),jointLabelCorrect=bool(grade.get('jointTop1')),correctDelivery=bool(complete and acceptance.get('ok') and grade.get('jointTop1')),falseCompletion=bool(complete and not grade.get('jointTop1')),top1Entity=grade.get('top1Entity'),top1Family=grade.get('top1Family'),prediction=grade.get('predictions'),inputTokensIncludingCache=raw_input,noncachedInputTokens=max(0,raw_input-cached),cachedInputTokens=cached,outputTokens=output,totalTokens=raw_input+output,reasoningOutputTokens=usage.get('reasoning_output_tokens'),usageIsLowerBound=metric['usageIsLowerBound'],toolCalls=len(tools),fileChangeItems=metric['counts'].get('file_change',0),observedToolItems=len(tools)+metric['counts'].get('file_change',0),toolErrors=metric['toolErrors'],mcpCalls=len(mcp),mcpErrors=sum(bool(t.get('error') or (t.get('result') or {}).get('isError') or t.get('status')=='failed') for t in mcp),checkpoints=sum(t['tool']=='cairn_checkpoint' for t in mcp),finishCalls=len(finish),handoffs=sum(len(t.get('handoffs',[])) for t in tasks),referenceBoundClaims=sum(bool(c.get('referenceArtifacts')) for t in tasks for c in t.get('claims',[])),lastHandoffs=[t.get('handoffs',[])[-1] for t in tasks if t.get('handoffs')],actualRecovery=None,metric=metric,acceptance=acceptance,grade=grade)
 row['frozenAssurance']=assurance
 rows.append(row)
threads=[r['metric']['threadId'] for r in rows if r['metric'].get('threadId')]
check('four fresh invocations; no native session reuse',len(rows)==4 and len(set(threads))==len(threads))
result=dict(run=str(RUN),model=manifest['model'],effort=manifest['effort'],rows=rows,excludedDevelopmentRuns=manifest.get('invalidatedDevelopmentRuns',[]),audit=dict(passed=sum(c['passed'] for c in audit),total=len(audit),failures=[c for c in audit if not c['passed']],checks=audit),caveats=manifest['caveats'])
(RUN/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(dict(rows=[{k:r[k] for k in ['arm','completed','artifactReplayPassed','jointLabelCorrect','falseCompletion','wallSeconds','totalTokens','outputTokens','toolCalls','toolErrors','mcpErrors','checkpoints','finishCalls','referenceBoundClaims']} for r in rows],audit=result['audit']['failures'],passed=result['audit']['passed'],total=result['audit']['total']),ensure_ascii=False,indent=2))
