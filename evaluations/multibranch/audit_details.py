"""Post-run observable diagnostics. No labels, no private thinking, no model calls."""
from pathlib import Path
import json,sys,re
from collections import Counter
from analyze import ROOT,load,lines,native_ledger

assert load(ROOT/'execution-ended.json',{}).get('allActorsEnded'),'Wait for all formal execution'
manifest=load(ROOT/'manifest.json');records=[]
for row in manifest['schedule']:
    directory=ROOT/row['id'];m=load(directory/'initial.metrics.json',{});tasks=load(directory/'initial.cairn-tasks.json',[]);task=tasks[0] if len(tasks)==1 else {};event_counts=Counter();semantic=[];repairs=[];material=[];exposure=[];validation=[]
    for e in load(directory/'scheduler.events.json',[]):
        event_counts[e.get('kind')]+=1
        if e.get('kind')=='task.checked':validation.append({'at':e['at'],'phase':e['payload'].get('phase'),'validation':e['payload'].get('validation')})
        if e.get('kind')=='scheduler.explore_failed':semantic.append({'at':e['at'],**e['payload']})
        if e.get('kind')=='scheduler.repair_requested':repairs.append({'at':e['at'],**e['payload']})
    branch_claims=[c for c in task.get('claims',[]) if c.get('branchKey')]
    for phase in m.get('phases',[]):
        if phase.get('phase')!='reason':continue
        pd=directory/'phases'/phase['phaseId'];request=load(pd/'scheduler.request.json',{});prompt=request.get('prompt','')
        exposed=[{'id':c['id'],'branch':c['branchKey']} for c in branch_claims if c['id'] in prompt or (c.get('key') and c['key'] in prompt)]
        exposure.append({'phase':phase['phaseId'],'promptBytes':phase.get('promptBytes'),'savedBranchClaimsVisibleByKey':exposed})
        for t in load(pd/'initial.tools.json',[]):
            name=t.get('name');args=t.get('arguments') or {};body=str(args.get('path') or args.get('command') or '')
            if name not in ['read','bash'] or t.get('isError'):continue
            # Mere write/here-doc text mentioning a branch is not evidence of reading it.
            if name=='bash' and (re.search(r'\b(?:cat|printf)\s+>',body) or body.lstrip().startswith(('echo ','printf '))):continue
            paths=sorted(set(re.findall(r'\.branches/[\w.-]+/[\w./-]+',body)))
            if paths:material.append({'phase':phase['phaseId'],'tool':name,'toolId':t.get('id'),'paths':paths,'commandContainsReadOrRun':name=='read' or bool(re.search(r'\b(?:cat|sed|head|tail|python3?|rg|grep|open)\b',body))})
    stops=Counter();native_event_types=Counter();lengths=[];max_input=0;models=set();providers=set();efforts=set();tool_parameter_errors=0
    for p in sorted((directory/'sessions').glob('*.jsonl')):
        sid=None
        for e in lines(p):
            native_event_types[e.get('type')]+=1
            if e.get('type')=='session':sid=e.get('id')
            if e.get('type')=='thinking_level_change':efforts.add(e.get('thinkingLevel'))
            msg=e.get('message') or {}
            if msg.get('role')!='assistant':continue
            stop=msg.get('stopReason');stops[stop]+=1
            if msg.get('model'):models.add(msg['model'])
            if msg.get('provider'):providers.add(msg['provider'])
            u=msg.get('usage') or {};max_input=max(max_input,u.get('input',0)+u.get('cacheRead',0)+u.get('cacheWrite',0))
            if stop=='length':lengths.append({'session':sid,'messageId':e.get('id'),'outputTokens':u.get('output'),'toolNames':[c.get('name') for c in msg.get('content',[]) if isinstance(c,dict) and c.get('type')=='toolCall']})
    records.append({**row,'models':sorted(models),'providers':sorted(providers),'nativeThinkingLevels':sorted(x for x in efforts if x),'stopReasons':dict(stops),'nativeEventTypeCounts':dict(native_event_types),'nativeCompactionEvents':sum(v for k,v in native_event_types.items() if k and 'compact' in k.lower()),'lengthReplies':lengths,'maxNativeInputTokensPerReply':max_input,'workflowTerminationReason':load(directory/'scheduler.result.json',{}).get('reason'),'phaseHostErrors':[{'phase':p['phaseId'],'error':p.get('error')} for p in m.get('phases',[]) if p.get('error')],'eventCounts':dict(event_counts),'taskValidationEvents':validation,'exploreSubmissionFailures':semantic,'sameSessionProtocolRepairs':repairs,'ownerObservedMaterialAccess':material,'ownerBranchClaimExposure':exposure,'phasePromptBytesTotal':sum(p.get('promptBytes',0) for p in m.get('phases',[])),'phaseCost':[{'phase':p['phaseId'],'role':p['phase'],'branch':(p.get('branch') or {}).get('key'),'seconds':p.get('wallSeconds'),'usage':p.get('usage'),'repair':p.get('repair'),'error':p.get('error')} for p in m.get('phases',[])],'evaluationBudgets':m.get('evaluationBudgets')})
result={'postHocObservableAudit':True,'primaryScoringChanged':False,'privateThinkingInspected':False,'records':records}
(ROOT/'observable-diagnostics.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'actors':len(records),'submissionFailures':sum(len(r['exploreSubmissionFailures']) for r in records),'protocolRepairs':sum(len(r['sameSessionProtocolRepairs']) for r in records),'lengthReplies':sum(len(r['lengthReplies']) for r in records),'multiOwnerAccessActors':sum(bool(r['ownerObservedMaterialAccess']) for r in records)},ensure_ascii=False))
