"""Host-owned independent arithmetic replay; no labels, inference oracle, or agent code execution."""
import csv,hashlib,json,math,statistics,sys
from pathlib import Path

task=json.load(sys.stdin);root=Path(task['owner']['cwd']).resolve();issues=[]
def local(name):
 p=(root/name).resolve()
 if not p.is_relative_to(root):raise ValueError('path escapes workspace')
 if not p.is_file():raise ValueError(f'missing file: {name}')
 return p
try:
 frozen=None
 if len(sys.argv)>1:
  frozen=json.loads(Path(sys.argv[1]).read_text())
  for name,digest in frozen.items():
   if name.startswith('evidence/') and hashlib.sha256(local(name).read_bytes()).hexdigest()!=digest:raise ValueError(f'original evidence changed: {name}')
 answer=json.loads(local('answer.json').read_text());checks=json.loads(local('checks.json').read_text())['checks']
 if not isinstance(checks,list) or not 2<=len(checks)<=10:raise ValueError('checks.json requires two to ten checks')
 seen=set()
 for i,c in enumerate(checks):
  try:
   source=local(c['file']);source_name=source.relative_to(root).as_posix()
   if frozen is not None and (not source_name.startswith('evidence/') or source_name not in frozen):raise ValueError('check file is not a frozen original evidence file')
   key=(source_name,c['entity'],c['metric']);operation=c['operation']
   if key in seen:raise ValueError('two checks must use distinct source series')
   seen.add(key)
   index=c['evidenceIndex'];evidence=answer['evidence'][index]
   if isinstance(index,bool) or not isinstance(index,int) or index<0:raise ValueError('invalid evidenceIndex')
   for k in ['file','entity','metric']:
    if not isinstance(c[k],str) or c[k] not in evidence[k]:raise ValueError(f'{k} differs from answer.json evidence')
   if operation not in ['mean','min','max','rate']:raise ValueError('unsupported operation')
   rows=[]
   with source.open() as stream:
    for row in csv.DictReader(stream):
     if 'value' in row:
      if row.get('cmdb_id')!=c['entity'] or row.get('kpi_name')!=c['metric']:continue
      value=float(row['value'])
     else:
      if row.get('service')!=c['entity']:continue
      value=float(row[c['metric']])
     timestamp=float(row['timestamp'])
     if math.isfinite(timestamp) and math.isfinite(value):rows.append((timestamp,value))
   rows.sort()
   if not rows:raise ValueError('no samples for this entity/metric')
   if len({ts for ts,_ in rows})!=len(rows):raise ValueError('duplicate timestamps require an explicit aggregation not supported by this checker')
   if operation=='rate':
    if any(rows[j][1]<rows[j-1][1] and any(c[w]['start']<=rows[j][0]<c[w]['end'] for w in ['before','after']) for j in range(1,len(rows))):raise ValueError('counter decreases; choose a reset-free series/window or describe the limitation')
    rows=[(ts,(v-rows[j-1][1])/(ts-rows[j-1][0])) for j,(ts,v) in enumerate(rows) if j]
   if c['before']['end']>c['after']['start']:raise ValueError('before/after windows overlap')
   for name in ['before','after']:
    window=c[name];start,end,expected=(window[k] for k in ['start','end','value'])
    if any(isinstance(v,bool) or not isinstance(v,(int,float)) or not math.isfinite(v) for v in [start,end,expected]) or start>=end:raise ValueError('window needs finite start < end and value')
    values=[v for ts,v in rows if start<=ts<end]
    if not values:raise ValueError(f'{name} has no samples')
    actual={'mean':statistics.mean,'min':min,'max':max,'rate':statistics.mean}[operation](values)
    if not math.isclose(actual,expected,rel_tol=.01,abs_tol=1e-6):raise ValueError(f'{name}: submitted={expected}, recomputed={actual}, n={len(values)}')
  except Exception as error:issues.append({'message':f'Numeric check {i}: {error}'})
except Exception as error:issues.append({'message':str(error)})
print(json.dumps({'ok':not issues,'issues':issues,'method':'replay','scope':'Recomputed checks.json against original CSVs and frozen input hashes. Does not establish causal attribution, category correctness, metric collection semantics, or every narrative number.'}))
