"""Read native event timestamps and error metadata only, not message content."""
import json,collections
from pathlib import Path
R=Path(__file__).resolve().parent/'runs/2026-10-18-pi-deepseek-round10-repeated';load=lambda p:json.loads(p.read_text())
if not load(R/'execution-ended.json')['allActorsEnded']:raise SystemExit('All actors must end first')
rows=[];all_errors=collections.Counter()
for entry in load(R/'manifest.json')['schedule']:
 p=R/entry['id'];metric=load(p/'initial.metrics.json');errors=[];custom=collections.Counter()
 for f in (p/'sessions').glob('*.jsonl'):
  for line in f.read_text().splitlines():
   try:e=json.loads(line)
   except ValueError:continue
   m=e.get('message',{})
   if e.get('type')=='custom_message':custom[e.get('customType')]+=1
   if m.get('role')=='custom':custom[m.get('customType')]+=1
   if m.get('role')=='assistant' and m.get('errorMessage'):
    errors.append({'recordedAt':e.get('timestamp'),'messageTimestamp':m.get('timestamp'),'message':m['errorMessage'],'stopReason':m.get('stopReason')});all_errors[m['errorMessage']]+=1
 tasks=load(p/'initial.cairn-tasks.json') if entry['arm']=='cairn' else []
 rows.append({**entry,'startedAt':metric['startedAt'],'finishedAt':metric['finishedAt'],'finalStopReason':metric['finalStopReason'],'errors':errors,'customMessageTypes':dict(custom),'savedContinuation':[t.get('continuation') for t in tasks],'savedFacts':sum(len(t.get('claims',[])) for t in tasks),'savedHandoffs':sum(len(t.get('handoffs',[])) for t in tasks)})
record={'method':'Client-native event timestamps/stop/error/custom-type metadata only. Error messages are not necessarily HTTP request attempts. No private reasoning, provider health inference or cross-session recovery claim.','messages':dict(all_errors),'rows':rows}
(R/'provider-timeline.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'errorKinds':dict(all_errors),'customTypes':[r['customMessageTypes'] for r in rows if r['arm']=='cairn']},ensure_ascii=False))
