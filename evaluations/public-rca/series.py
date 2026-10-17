"""Read-only numeric review helper; no RCA ranking or labels. Python standard library only."""
import argparse,csv,json,statistics
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def series(case,file,entity,metric=None):
 path=ROOT/'cases'/case/file
 rows=list(csv.DictReader(path.open()))
 if rows and 'value' in rows[0]:
  return sorted((int(r['timestamp']),float(r['value'])) for r in rows if r['cmdb_id']==entity and (metric is None or r['kpi_name']==metric))
 return sorted((int(r['timestamp']),float(r[metric])) for r in rows if r['service']==entity)

def stats(rows,start=None,end=None):
 chosen=[(t,v) for t,v in rows if (start is None or t>=start) and (end is None or t<=end)]
 xs=[v for t,v in chosen]
 return {'n':len(xs),'mean':statistics.mean(xs) if xs else None,'min':min(xs) if xs else None,'max':max(xs) if xs else None,'sum':sum(xs),'rows':chosen}

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('case');p.add_argument('file');p.add_argument('entity');p.add_argument('--metric');p.add_argument('--start',type=int);p.add_argument('--end',type=int);a=p.parse_args()
 print(json.dumps(stats(series(a.case,a.file,a.entity,a.metric),a.start,a.end),ensure_ascii=False,indent=2))
