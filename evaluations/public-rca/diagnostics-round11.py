"""Explain observable failure boundaries, without reading private reasoning."""
import json,collections
from pathlib import Path
root=Path(__file__).resolve().parent/'runs/2026-10-18-five-model-round11'
load=lambda p:json.loads(p.read_text())
summary=load(root/'summary.json');records=[]
for row in summary['rows']:
    directory=root/row['id'];tools=load(directory/'initial.tools.json');failures=[]
    for t in tools:
        result=t.get('result') or {};failed=bool(t.get('isError') or t.get('error') or t.get('status')=='failed' or result.get('isError') or (t.get('type')=='command_execution' and t.get('exitCode')!=0))
        if not failed:continue
        name=t.get('name',t.get('tool',t.get('type')));texts=[c.get('text','') for c in result.get('content',[]) if c.get('type')=='text']
        text=' '.join(texts);lower=text.lower()
        category='native_execution'
        if 'not found' in lower and 'tool' in lower:category='unknown_tool_name'
        elif 'validation failed' in lower or 'invalid_model_input' in lower:category='model_parameter_schema'
        elif name in ['cairn_finish','finish'] and any(s in lower for s in ['coverage','required','missing','incomplete','verification','accept']):category='completion_gate'
        failures.append({'tool':name,'category':category,'message':text[:1400] if name and (name.startswith('cairn_') or category!='native_execution') else None,'exitCode':t.get('exitCode')})
    records.append({'id':row['id'],'completed':row['completed'],'reason':row['reason'],'naturalTermination':row['naturalTermination'],'apiErrors':dict(collections.Counter(row['errors'])),'compactions':row['compactions'],'maxPerRequestInputTokens':row['maxPerRequestInputTokens'],'lastPublicTools':[{'tool':t.get('name',t.get('tool',t.get('type'))),'status':t.get('status'),'isError':t.get('isError')} for t in tools[-5:]],'taskStates':row['taskStates'],'acceptanceIssues':row['acceptanceIssues'],'toolFailures':failures,'customTypes':row['customTypes']})
result={'method':'Public tool failure receipts and native stop/usage/event-type metadata; no private thinking read. Direct stop cause is separated from unknown underlying server/network cause. No prompt A/B or forced cross-session recovery was performed.','incompleteRCA':dict(collections.Counter(r['reason'] for r,s in zip(records,summary['rows']) if s['kind']=='rca' and not r['completed'])),'toolFailureCategories':dict(collections.Counter(f['category'] for r in records for f in r['toolFailures'])),'rows':records}
(root/'diagnostics.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k!='rows'},ensure_ascii=False,indent=2))
