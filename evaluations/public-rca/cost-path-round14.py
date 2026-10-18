"""Public tool chronology and usage metadata only; private reasoning is ignored."""
import json
from pathlib import Path
from datetime import datetime

root=Path(__file__).resolve().parent/'runs/2026-10-18-kimi-scheduler-round14'
load=lambda p:json.loads(p.read_text())
assert load(root/'execution-ended.json')['allActorsEnded']
def stamp(event):
    value=event.get('timestamp')
    if isinstance(value,str):return datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
    value=(event.get('message') or {}).get('timestamp')
    return value/1000 if isinstance(value,(float,int)) else None
rows=[]
for row in load(root/'manifest.json')['schedule']:
    directory=root/row['id'];metric=load(directory/'initial.metrics.json')
    events=[]
    for path in sorted((directory/'sessions').glob('*.jsonl')):
        for line in path.open():
            try:event=json.loads(line)
            except ValueError:continue
            message=event.get('message') or {}
            if message.get('role') not in ['assistant','toolResult']:continue
            entry={'at':stamp(event),'role':message['role']}
            if message['role']=='assistant':
                entry['usage']=message.get('usage')
                entry['calls']=[{'id':c.get('id'),'name':c.get('name'),'path':(c.get('arguments') or {}).get('path')} for c in message.get('content',[]) if c.get('type')=='toolCall']
            else:entry.update(toolCallId=message.get('toolCallId'),isError=message.get('isError'))
            events.append(entry)
    events.sort(key=lambda e:e['at'] if e['at'] is not None else 0)
    calls=[c for e in events for c in e.get('calls',[])]
    writes=[c for c in calls if c['name']=='write' and str(c.get('path') or '').split('/')[-1]=='REPORT.md']
    first=writes[0] if writes else None
    completed=next((e for e in events if first and e.get('toolCallId')==first['id'] and not e.get('isError')),None)
    tail=[e for e in events if completed and e['at'] is not None and e['at']>completed['at']]
    tail_calls=[c for e in tail for c in e.get('calls',[])]
    tail_results=[e for e in tail if e['role']=='toolResult']
    tail_usage=[e['usage'] for e in tail if e.get('usage')]
    tokens=sum(sum(u.get(k,0) for k in ['input','cacheRead','cacheWrite','output']) for u in tail_usage)
    end=datetime.fromisoformat(metric['finishedAt'].replace('Z','+00:00')).timestamp()
    rows.append({**row,'seconds':metric['wallSeconds'],'recordedTokens':sum((metric.get('usage') or {}).get(k,0) for k in ['input_tokens','output_tokens']),'toolCalls':len(calls),'reportWriteCalls':len(writes),'firstReportWriteToolNumber':calls.index(first)+1 if first else None,'firstReportWriteFinishedAt':datetime.fromtimestamp(completed['at']).astimezone().isoformat() if completed and completed['at'] is not None else None,'afterFirstReportWriteSeconds':end-completed['at'] if completed else None,'afterFirstReportWriteDeclaredToolCalls':len(tail_calls) if completed else None,'afterFirstReportWriteCompletedToolCalls':len(tail_results) if completed else None,'afterFirstReportWriteRecordedTokens':tokens if completed else None,'afterFirstReportWriteCachedTokens':sum(u.get('cacheRead',0) for u in tail_usage) if completed else None,'method':'First successful native write tool to REPORT.md only; bash-based writes are not inferred. Declaration and result-completion timestamps are distinct: multiple tools may share one earlier assistant message. Tail may include useful corrections and scheduler output; not all tail work is waste.'})
result={'method':'Public native tool name/path/ID/time and usage metadata; never read reasoning content. Chronology after the first report is descriptive, not causal proof of waste.','rows':rows}
(root/'cost-path.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(sorted(rows,key=lambda r:r['recordedTokens'],reverse=True)[:3],ensure_ascii=False,indent=2))
