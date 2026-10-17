"""Independent native session metadata/usage audit. Never accesses message content."""
import json,hashlib,collections
from pathlib import Path
R=Path(__file__).resolve().parent/'runs/2026-10-18-pi-deepseek-round10-repeated'
load=lambda p:json.loads(p.read_text())
if not load(R/'execution-ended.json')['allActorsEnded']:raise SystemExit('All 18 actors must end first')
records=[]
for row in load(R/'manifest.json')['schedule']:
    p=R/row['id'];metric=load(p/'initial.metrics.json');totals={k:0 for k in ['input','output','cacheRead','cacheWrite','totalTokens']};models=set();providers=set();efforts=set();headers=[];stops=[];event_types=collections.Counter();sources={}
    for f in sorted((p/'sessions').glob('*.jsonl')):
        sources[f.name]=hashlib.sha256(f.read_bytes()).hexdigest()
        for line in f.read_text().splitlines():
            try:e=json.loads(line)
            except ValueError:continue
            event_types[e.get('type')]+=1
            if e.get('type')=='session':headers.append({k:e.get(k) for k in ['id','cwd']})
            if e.get('type')=='thinking_level_change':efforts.add(e.get('thinkingLevel'))
            m=e.get('message',{})
            if m.get('role')=='assistant':
                models.add(m.get('model'));providers.add(m.get('provider'));stops.append(m.get('stopReason'))
                for k in totals:totals[k]+=m.get('usage',{}).get(k,0)
    checks={'native_usage_matches_stream':totals==metric['nativeUsage'],'native_model_matches':models==set(metric['actualModels'])=={'global:deepseek-v4.1-flash'},'native_provider_matches':providers==set(metric['actualProviders'])=={'sub2api-copy'},'native_effort_matches':efforts==set(metric['actualEfforts'])=={'high'},'native_session_identity':len(headers)==1 and headers[0]['id']==metric['threadId'] and headers[0]['cwd']==str(p/'workspace'),'terminal_stop_matches':bool(stops) and stops[-1]==metric.get('finalStopReason'),'total_no_double_count':totals['totalTokens']==sum(totals[k] for k in ['input','output','cacheRead','cacheWrite'])}
    record={**row,'method':'Read only native JSONL header/model/thinking/usage/stopReason/event-type metadata; no message content inspected. Compare independently with JSON event stream metrics.','nativeUsage':totals,'nativeHeaders':headers,'actualModels':sorted(models),'actualProviders':sorted(providers),'actualEfforts':sorted(efforts),'eventTypes':event_types,'nativeFilesSha256':sources,'checks':checks,'passed':all(checks.values())}
    target=p/'native-ledger-audit.json'
    if target.exists():raise SystemExit('Never overwrite audit: '+row['id'])
    target.write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');records.append(record)
result={'actors':len(records),'checks':sum(len(r['checks']) for r in records),'passed':sum(sum(r['checks'].values()) for r in records),'failures':[r['id'] for r in records if not r['passed']]}
(R/'native-ledger-audit.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
