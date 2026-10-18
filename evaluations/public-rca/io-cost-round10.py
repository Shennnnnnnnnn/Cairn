"""Public I/O is a cost diagnostic, not billed tokens or proof of wasted work."""
import json,hashlib,collections
from pathlib import Path
H=Path(__file__).resolve().parent;R=H/'runs/2026-10-18-pi-deepseek-round10-repeated';P=H/'runs/2026-10-17-pi-deepseek-round9-repeated'
load=lambda p:json.loads(p.read_text())
if not load(R/'execution-ended.json')['allActorsEnded']:raise SystemExit('All actors must end before final I/O comparison')
def inspect(root):
 rows=[]
 for row in load(root/'manifest.json')['schedule']:
  tools=load(root/row['id']/'initial.tools.json');seen=collections.Counter();repeated=0;io=collections.Counter();reads=collections.Counter();largest=[]
  for t in tools:
   args=t.get('arguments',{});body=json.dumps(args,ensure_ascii=False,sort_keys=True,separators=(',',':'));out='\n'.join(c.get('text','') for c in (t.get('result') or {}).get('content',[]) if c.get('type')=='text')
   kind='cairn' if t['name'].startswith('cairn_') else 'native';io[kind+'InputBytes']+=len(body.encode());io[kind+'OutputBytes']+=len(out.encode());io[kind+'Calls']+=1
   key=(t['name'],body,hashlib.sha256(out.encode()).hexdigest(),bool(t.get('isError')))
   if seen[key]:repeated+=1
   seen[key]+=1
   if t['name']=='cairn_read':reads['focusedEvidence' if args.get('view')=='evidence' and args.get('ref') else args.get('view','context')]+=1
   largest.append({'id':t['id'],'tool':t['name'],'outputBytes':len(out.encode())})
  rows.append({**row,**io,'identicalInputResultRepeats':repeated,'cairnReads':reads,'largestPublicOutputs':sorted(largest,key=lambda v:v['outputBytes'],reverse=True)[:3]})
 groups={a:{**{k:sum(r.get(k,0) for r in rows if r['arm']==a) for k in ['nativeInputBytes','nativeOutputBytes','nativeCalls','cairnInputBytes','cairnOutputBytes','cairnCalls','identicalInputResultRepeats']},'cairnReads':dict(sum((collections.Counter(r['cairnReads']) for r in rows if r['arm']==a),collections.Counter()))} for a in ['pi','cairn']}
 return {'groups':groups,'rows':rows}
record={'method':'Only public tool arguments and text outputs. UTF-8 bytes are not model tokens; identical input+output repeats can be useful revalidation, not automatically waste. No private reasoning inspected.','previous':inspect(P),'current':inspect(R)}
(R/'io-cost-diagnostics.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n');print(json.dumps({k:v['groups'] for k,v in record.items() if isinstance(v,dict)},ensure_ascii=False,indent=2))
