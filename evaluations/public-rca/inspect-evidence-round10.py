"""Host-only raw source catalog and exact point lookup; no grading or model calls."""
import csv,json,sys,collections,hashlib
from pathlib import Path
R=Path(__file__).resolve().parent/'runs/2026-10-18-pi-deepseek-round10-repeated'
case=sys.argv[1] if len(sys.argv)>1 else 'new-01';pattern=sys.argv[2] if len(sys.argv)>2 else None;entity=sys.argv[3] if len(sys.argv)>3 else None
catalog=[]
for f in sorted((R/'cases'/case/'evidence').rglob('*.csv')):
 rows=list(csv.DictReader(f.open()));metrics=collections.defaultdict(list)
 for row in rows:
  if 'kpi_name' in row:metrics[row['kpi_name']].append(row)
  else:
   for metric in ['rr','sr','mrt','count']:
    if metric in row:metrics[metric].append({**row,'cmdb_id':row.get('service'),'kpi_name':metric})
 if pattern and pattern not in f.name and not any(pattern in k for k in metrics):continue
 if pattern:
  selected=[r for r in rows if (pattern in f.name or pattern in r.get('kpi_name','') or pattern in r) and (entity is None or entity==r.get('cmdb_id',r.get('service')))]
  print(json.dumps({'file':str(f.relative_to(R/'cases'/case)),'rows':selected},ensure_ascii=False));continue
 catalog.append({'file':str(f.relative_to(R/'cases'/case)),'sha256':hashlib.sha256(f.read_bytes()).hexdigest(),'headers':list(rows[0]) if rows else [],'rows':len(rows),'subjects':len({r.get('cmdb_id',r.get('service')) for r in rows}),'metrics':{k:{'subjects':len({r.get('cmdb_id') for r in v}),'timestamps':sorted({r['timestamp'] for r in v})} for k,v in metrics.items()}})
if not pattern:
 target=R/(case+'-source-catalog.json');target.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n');print(json.dumps({'case':case,'files':len(catalog),'rows':sum(v['rows'] for v in catalog),'saved':str(target)}))
