"""Uniform public tool metadata; no hidden labels or native reasoning."""
import json,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parent/'runs/2026-10-17-pi-deepseek-round9-repeated'
load=lambda p:json.loads(p.read_text())
if not load(ROOT/'execution-ended.json')['allActorsEnded']:raise SystemExit('All actors must end first')
rows=[]
for row in load(ROOT/'manifest.json')['schedule']:
    p=ROOT/row['id'];tools=load(p/'initial.tools.json');cairn=[t for t in tools if t['name'].startswith('cairn_')];cp=[t for t in cairn if t['name']=='cairn_checkpoint']
    def text(t):return '\n'.join(c.get('text','') for c in (t.get('result') or {}).get('content',[]) if c.get('type')=='text')
    counts={f:sum(isinstance(v,str) for t in cp for v in (t['arguments'].get(f) if isinstance(t['arguments'].get(f),list) else [])) for f in ['findings','progress','artifacts','handoffs']}
    def encoded(t):return any(isinstance(v,str) for f in counts for v in (t['arguments'].get(f) or []) if isinstance(t['arguments'].get(f),list)) or isinstance(t['arguments'].get('next'),str) and not t['arguments']['next'].strip()
    errors=[dict(id=t['id'],tool=t['name'],message=text(t)) for t in tools if t.get('isError')]
    rows.append({**row,'toolCalls':len(tools),'toolErrors':len(errors),'cairnCalls':len(cairn),'checkpointCalls':len(cp),'checkpointFailures':sum(bool(t.get('isError')) for t in cp),'encodedElements':counts,'acceptedCompatibilityCalls':sum(encoded(t) and not t.get('isError') for t in cp),'publicCairnTextBytes':sum(len(text(t).encode()) for t in cairn),'publicCheckpointTextBytes':sum(len(text(t).encode()) for t in cp),'toolRecordSha256':hashlib.sha256((p/'initial.tools.json').read_bytes()).hexdigest(),'errors':errors})
groups={a:{**{k:sum(r[k] for r in rows if r['arm']==a) for k in ['toolCalls','toolErrors','cairnCalls','checkpointCalls','checkpointFailures','acceptedCompatibilityCalls','publicCairnTextBytes','publicCheckpointTextBytes']},'encodedElements':{f:sum(r['encodedElements'][f] for r in rows if r['arm']==a) for f in ['findings','progress','artifacts','handoffs']}} for a in ['pi','cairn']}
record={'method':'UTF-8 public Pi tool content only; bytes are not tokens. Direct extension results, not MCP transport. Compatibility counts require an accepted whole call. All failures retained.','rows':rows,'groups':groups}
(ROOT/'public-metadata-supplement.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');print(json.dumps(groups,ensure_ascii=False,indent=2))
