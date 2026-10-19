"""Manual interpretation rules for the completed observable scope audit; not OS isolation."""
from pathlib import Path
import json,re,hashlib,datetime
from analyze import ROOT,load
assert load(ROOT/'execution-ended.json',{}).get('allActorsEnded')
audit=load(ROOT/'scope-audit.json');groups={};pending=[];deviations=[]
scratch=['/tmp/mb01_verify.out','/tmp/ev.out','/tmp/recompute_digest.txt','/tmp/run.log','/tmp/caller.log']
for row in audit['records']:
 for f in row['flags']:
  item={'actor':row['id'],'source':f['source'],'id':f['id'],'category':f['category']};reason=None
  if f['category']=='explicit_path_outside_workspace':
   if f.get('path','').endswith('/implementation/skills/cairn/SKILL.md'):reason='explicitly_loaded_frozen_skill'
  elif f['category']=='shared_tmp_reference':
   paths=[n for n in scratch if n in f['command']]
   if paths:reason='confirmed_global_tmp_scratch_deviation';deviations.append({**item,'paths':paths})
   elif '/tmp/opentelemetry-javaagent.jar' in f['command']:reason='incident_log_literal'
  elif f['category']=='parent_traversal':
   cmd=f['command'];paths=[x for x in re.findall(r'(?<!\.)\.\.(?:/\.\.)*(?:/[\w.*-]+)*',cmd) if x!='..']
   allowed=['../..','../../evidence','../../incident.json','../../incident.json.','../../DATA.md','../../TASK.md','../../answer.json','../../REPORT.md','../../checks.json','../../evidence/*']
   if paths and all(x in allowed or x.startswith('../../evidence/') or x.startswith('../evidence/') for x in paths):reason='branch_or_tmp_relative_path_inside_same_actor'
   elif not paths and ('.parent' in cmd or 'parents[' in cmd):reason='local_script_parent_or_trace_graph_identifier'
   elif not paths:reason='ellipsis_in_endpoint_or_report_text'
  if reason:groups.setdefault(reason,[]).append(item)
  else:pending.append({**item,**f})
result={'manualReview':True,'actors':len(audit['records']),'automaticAuditSHA256':hashlib.sha256((ROOT/'scope-audit.json').read_bytes()).hexdigest(),'interpretation':'Reviewed flagged path atoms, command cwd/script locations, log-literal uses and actual temp redirections. This is an observable tool audit, not an OS sandbox or exhaustive system-call trace.','groups':groups,'confirmedScratchDeviations':deviations,'scratchDeviationActors':sorted({x['actor'] for x in deviations}),'pending':pending,'noObservedHiddenLabelOtherCaseCredentialOrExternalEvidenceAccess':True,'primaryScoresNotChanged':True,'strictWorkspaceMetrics':'Report separately from framework completion; global /tmp redirections are not fully compliant even after cleanup.'}
(ROOT/'scope-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'classifiedFlags':sum(len(v) for v in groups.values()),'pending':len(pending),'scratchActors':result['scratchDeviationActors'],'scratchEvents':len(deviations)},ensure_ascii=False))
if pending:raise SystemExit('Review unclassified flags before final conclusions')
