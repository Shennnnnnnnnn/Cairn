"""Observe bounded same-session continuation; no private message content."""
import json,hashlib
from pathlib import Path
R=Path(__file__).resolve().parent/'runs/2026-10-18-pi-deepseek-round10-repeated';load=lambda p:json.loads(p.read_text());s=load(R/'summary.json');rows=[]
for row in s['rows']:
 if row['arm']!='cairn':continue
 events=[];previous=None;sources={}
 for p in (R/row['id']/'sessions').glob('*.jsonl'):
  sources[p.name]=hashlib.sha256(p.read_bytes()).hexdigest()
  for line in p.read_text().splitlines():
   e=json.loads(line);m=e.get('message',{})
   if m.get('role')=='assistant':previous={'stopReason':m.get('stopReason'),'errorMessage':m.get('errorMessage'),'at':e.get('timestamp')}
   if (e.get('type')=='custom_message' and e.get('customType')=='cairn-check') or (m.get('role')=='custom' and m.get('customType')=='cairn-check'):events.append({'at':e.get('timestamp'),'precedingAssistant':previous})
 tasks=load(R/row['id']/'initial.cairn-tasks.json');rows.append({'id':row['id'],'events':events,'savedContinuation':[t.get('continuation') for t in tasks],'eventuallyCompleted':row['completed'],'eventuallyEffectiveDelivery':row['correctDelivery'],'nativeSourceSha256':sources})
active=[r for r in rows if r['events']]
record={'method':'Client-native metadata of same-session cairn-check and preceding stop/error; independent persisted continuation counts. This is existing bounded host feedback, not a new model worker, cross-session handoff or proof of counterfactual benefit.','sessionsWithContinuation':len(active),'events':sum(len(r['events']) for r in active),'precededByConnectionError':sum(e['precedingAssistant']['stopReason']=='error' and e['precedingAssistant']['errorMessage']=='Connection error.' for r in active for e in r['events']),'eventuallyEffectiveDeliveries':sum(r['eventuallyEffectiveDelivery'] for r in active),'rows':rows}
(R/'cairn-continuation-metadata.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v for k,v in record.items() if k!='rows'}))
