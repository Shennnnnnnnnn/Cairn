"""Explain observable failure boundaries, without reading private reasoning."""
import json,collections
from pathlib import Path
root=Path(__file__).resolve().parent/'runs/2026-10-18-scheduler-three-model-round12-final'
load=lambda p:json.loads(p.read_text())
summary=load(root/'summary.json');records=[]
for row in summary['rows']:
    directory=root/row['id'];tools=load(directory/'initial.tools.json');failures=[];finish_receipts=[];retries=[]
    for line in (directory/'initial.jsonl').open():
        try:event=json.loads(line)
        except ValueError:continue
        if event.get('type') in ['auto_retry_start','auto_retry_end']:
            retries.append({k:event[k] for k in ['type','attempt','maxAttempts','delayMs','errorMessage','success'] if k in event})
    for t in tools:
        result=t.get('result') or {};failed=bool(t.get('isError') or t.get('error') or t.get('status')=='failed' or result.get('isError') or (t.get('type')=='command_execution' and t.get('exitCode')!=0))
        name=t.get('name',t.get('tool',t.get('type')))
        if name=='cairn_finish':
            candidates=[result.get('details'),result.get('structuredContent'),result.get('structured_content'),result]
            for c in result.get('content',[]):
                if c.get('type')=='text':
                    try:candidates.append(json.loads(c.get('text','')))
                    except ValueError:pass
            receipt=next((c for c in candidates if isinstance(c,dict) and c.get('phase')),None)
            if receipt:
                finish_receipts.append({k:receipt.get(k) for k in ['phase','status','validation','repair','coverage']})
                if receipt['phase']=='incomplete' and not failed:failures.append({'tool':name,'category':'completion_gate','message':json.dumps(receipt.get('validation',{}),ensure_ascii=False)[:1400]})
        if not failed:continue
        name=t.get('name',t.get('tool',t.get('type')));texts=[c.get('text','') for c in result.get('content',[]) if c.get('type')=='text']
        text=' '.join(texts);lower=text.lower()
        category='native_execution'
        if 'not found' in lower and 'tool' in lower:category='unknown_tool_name'
        elif 'validation failed' in lower or 'invalid_model_input' in lower:category='model_parameter_schema'
        elif name in ['cairn_finish','finish'] and any(s in lower for s in ['coverage','required','missing','incomplete','verification','accept']):category='completion_gate'
        failures.append({'tool':name,'category':category,'message':text[:1400] if name and (name.startswith('cairn_') or category!='native_execution') else None,'exitCode':t.get('exitCode')})
    records.append({'id':row['id'],'completed':row['completed'],'reason':row['reason'],'naturalTermination':row['naturalTermination'],'apiErrors':dict(collections.Counter(row['errors'])),'compactions':row['compactions'],'maxPerRequestInputTokens':row['maxPerRequestInputTokens'],'lastPublicTools':[{'tool':t.get('name',t.get('tool',t.get('type'))),'status':t.get('status'),'isError':t.get('isError')} for t in tools[-5:]],'taskStates':row['taskStates'],'acceptanceIssues':row['acceptanceIssues'],'toolFailures':failures,'finishReceipts':finish_receipts,'nativeAutoRetryEvents':retries,'customTypes':row['customTypes'],'schedulerStatus':row.get('schedulerStatus'),'schedulerReason':row.get('schedulerReason'),'schedulerPhases':row.get('schedulerPhases',[]),'recovery':row.get('recovery'),'schedulerEventKinds':dict(collections.Counter(event['kind'] for event in load(directory/'scheduler.events.json'))) if (directory/'scheduler.events.json').exists() else {}})
result={'method':'Public tool failure receipts and native stop/usage/event-type metadata; no private thinking read. Direct stop cause is separated from unknown underlying server/network cause. No prompt A/B or artificial failure injection was performed. Automatic Scheduler conclude/native resume attempts are recorded individually and do not prove general fault recovery.','incompleteRCA':dict(collections.Counter(r['reason'] for r,s in zip(records,summary['rows']) if s['kind']=='rca' and not r['completed'])),'toolFailureCategories':dict(collections.Counter(f['category'] for r in records for f in r['toolFailures'])),'rows':records}
(root/'diagnostics.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='rows'},ensure_ascii=False,indent=2))
