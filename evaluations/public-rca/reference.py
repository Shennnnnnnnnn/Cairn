"""Independent per-series checks; descriptive statistics, not an RCA algorithm."""
import csv,json,statistics,math,sys
from pathlib import Path
from collections import defaultdict
ROOT=Path(__file__).parent
result={}
for m in json.loads((ROOT/'case-manifest.json').read_text()):
 t=int(m['groundtruth']['timestamp']);series=defaultdict(list)
 for p in (ROOT/'cases'/m['case']/'evidence').rglob('*.csv'):
  for r in csv.DictReader(p.open()):
   if 'value' in r:
    v=float(r['value'])
    if math.isfinite(v):series[(str(p.relative_to(ROOT/'cases'/m['case'])),r['cmdb_id'],r['kpi_name'])].append((int(r['timestamp']),v))
   else:
    for k in ['rr','sr','mrt','count']:
     v=float(r[k])
     if math.isfinite(v):series[(str(p.relative_to(ROOT/'cases'/m['case'])),r['service'],k)].append((int(r['timestamp']),v))
 def stats(xs):
  return {'n':len(xs),'mean':statistics.mean(xs),'median':statistics.median(xs),'min':min(xs),'max':max(xs)} if xs else None
 data=[]
 for (file,entity,metric),rows in series.items():
  rows.sort();pre=[v for ts,v in rows if t-600<=ts<t];post=[v for ts,v in rows if t<=ts<=t+600]
  rates=[(ts,(v-rows[i-1][1])/(ts-rows[i-1][0])) for i,(ts,v) in enumerate(rows) if i and ts>rows[i-1][0]]
  data.append({'file':file,'entity':entity,'metric':metric,'before':stats(pre),'after':stats(post),'derivativeBefore':stats([v for ts,v in rates if ts<t]),'derivativeAfter':stats([v for ts,v in rates if ts>=t]),'decreases':sum(rows[i][1]<rows[i-1][1] for i in range(1,len(rows)))})
 result[m['case']]=data
out=ROOT/'runs'/(sys.argv[1] if len(sys.argv)>1 else '2026-10-16-aiops2022')/'reference-stats.json';out.parent.mkdir(parents=True,exist_ok=True);out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
for m in json.loads((ROOT/'case-manifest.json').read_text()):
 target=m['groundtruth']['cmdb_id'];metrics={'disk_io':['container_fs_writes_MB','container_fs_usage_MB'],'cpu':['system.cpu.user','system.cpu.idle'],'memory':['container_memory_usage_MB','container_memory_working_set_MB'],'network':['sr','mrt']}[m['family']]
 print(m['case'],target)
 for r in result[m['case']]:
  if (r['entity']==target or r['entity'].endswith('.'+target) or r['entity']==target+'-grpc') and r['metric'] in metrics:
   print(r['metric'],r['before'],r['after'])
