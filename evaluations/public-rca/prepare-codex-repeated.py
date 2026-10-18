"""Select new difficult windows before inference; never uses model outcomes.

Difficulty is an observable ambiguity proxy, not an established contest rating.
Labels supply event times, coarse resource-family coverage and the sealed grading reference; target objects never influence selection.
"""
import bisect, collections, csv, hashlib, itertools, json, math, re
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUN = HERE / 'runs/2026-10-17-codex-sol-xhigh-repeated'
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def save(path, value): path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
def family(row):
    kind=row['failure_type'].lower()
    result='cpu' if 'cpu' in kind else 'memory' if '内存' in kind else 'network' if '网络' in kind else 'disk_io' if 'io' in kind or '磁盘' in kind else None
    if result is None: raise SystemExit('Unmapped resource family')
    return result

if RUN.exists(): raise SystemExit('Never overwrite a prepared batch')
old = json.loads((HERE / 'case-manifest.json').read_text())
history = []
for path in sorted((HERE / 'runs').glob('*/manifest.json')):
    value = json.loads(path.read_text())
    ids = sorted(set(re.findall(r'case-\d+', json.dumps({k: value.get(k) for k in ['case', 'cases']}))))
    if ids: history.append(dict(run=path.parent.name, manifestSha256=digest(path), cases=ids))
used = {case for item in history for case in item['cases']}
unknown = used - {item['case'] for item in old}
if unknown: raise SystemExit(f'Unknown previous case ids: {unknown}')
used_windows = [(item['windowStart'], item['windowEnd']) for item in old if item['case'] in used]
faults = sorted(csv.DictReader((HERE / 'sources/groundtruth.csv').open()), key=lambda r: int(r['timestamp']))
times_all = [int(row['timestamp']) for row in faults]
eligible = [row for row in faults if not any(int(row['timestamp'])-600 <= end and int(row['timestamp'])+600 >= start for start,end in used_windows)
            and not any(0 < abs(int(row['timestamp'])-t) <= 600 for t in times_all)]
if len(eligible) < 9: raise SystemExit('Insufficient new single-event windows')
times = [int(row['timestamp']) for row in eligible]
stats = [collections.defaultdict(lambda: [0,0.,0.,0,0.,0.]) for _ in times]
source_entries = json.loads((HERE / 'source-files.json').read_text())
sources = sorted((HERE / 'sources/metrics').rglob('*.csv'))
if len(sources) != 57: raise SystemExit('Unexpected source coverage')
for source in sources:
    item = next(item for item in source_entries if item['localPath'] == str(source.relative_to(HERE)))
    if digest(source) != item['sha256']: raise SystemExit('Source changed: ' + str(source))
    rel = str(source.relative_to(HERE / 'sources/metrics'))
    with source.open(newline='') as stream:
        for row in csv.DictReader(stream):
            timestamp = float(row['timestamp'])
            first, last = bisect.bisect_left(times, timestamp-600), bisect.bisect_right(times, timestamp+600)
            if first == last: continue
            entity = row.get('cmdb_id') or row.get('service')
            values = [(row['kpi_name'], row['value'])] if 'value' in row else [(k,row[k]) for k in ['rr','sr','mrt','count']]
            for metric, raw in values:
                value = float(raw)
                if not math.isfinite(value): continue
                for index in range(first, last):
                    offset = 0 if timestamp < times[index] else 3
                    result = stats[index][(rel,entity,metric)]
                    result[offset] += 1; result[offset+1] += value; result[offset+2] += value*value

ranking = []
for index, time in enumerate(times):
    entities = collections.Counter(); layers = collections.Counter(); changed = 0
    for (file, entity, metric), row in stats[index].items():
        n0,s0,q0,n1,s1,q1 = row
        if min(n0,n1) < 2: continue
        m0,m1 = s0/n0,s1/n1
        scale = max(abs(m0),abs(m1),1e-9)
        sd0 = math.sqrt(max(0,q0/n0-m0*m0)); sd1 = math.sqrt(max(0,q1/n1-m1*m1))
        if abs(m1-m0)/scale >= .25 and abs(m1-m0)/(sd0+sd1+.01*scale+1e-9) >= 1:
            changed += 1; entities[(file.split('/')[0],entity)] += 1
    multi = [(layer,entity) for (layer,entity),count in entities.items() if count >= 2]
    layers.update(layer for layer,_ in multi)
    score = len(multi)*100 + len(layers)*10 + changed/1000
    stratum = min(2,index*3//len(times))
    ranking.append(dict(timestamp=time,stratum=stratum+1,resourceFamily=family(eligible[index]),score=score,changedSeries=changed,multiSignalObjects=len(multi),multiSignalLayers=len(layers),sourceSeries=len(stats[index])))
combinations = [rows for rows in itertools.product(*[[row for row in ranking if row['stratum']==stratum] for stratum in range(1,4)])
                if len({row['resourceFamily'] for row in rows})==3 and all(abs(a['timestamp']-b['timestamp'])>1200 for a,b in itertools.combinations(rows,2))]
if not combinations: raise SystemExit('Cannot select three strata with three resource families')
selected = list(min(combinations,key=lambda rows:(-sum(row['score'] for row in rows),tuple(row['timestamp'] for row in rows))))
selected_times = {row['timestamp'] for row in selected}
for row in ranking: row['selected'] = row['timestamp'] in selected_times

RUN.mkdir(parents=True)
save(RUN/'history.json',dict(manifests=history,previousCases=sorted(used),previousWindows=used_windows))
save(RUN/'selection.json',dict(frozenAt=datetime.now(timezone.utc).isoformat(),rule='Exclude all historical windows and windows containing another recorded event; split eligible timestamps chronologically into three strata; choose one per stratum with three distinct resource families and nonoverlapping windows, maximize total multiSignalObjects*100+multiSignalLayers*10+changedSeries/1000, tie earlier timestamp tuple.',seriesChange='At least two samples on each side; |mean change|/max(|means|,1e-9)>=.25 AND |mean change|/(sd_before+sd_after+.01*max(|means|)+1e-9)>=1; objects require two changed source series. Raw values are a selection proxy only, not valid physical counter rates or causal evidence.',outcomesUsed=False,labelTargetObjectsUsedForSelection=False,resourceFamiliesUsedForStratification=True,eligible=len(eligible),candidates=ranking,limitations=['Difficulty proxy is not independently validated','Same public day/testbed, cross-case dependence and possible training contamination','Event durations unknown; other events outside the window may have lingering effects']))

template = (HERE/'cases/case-01/TASK.md').read_text()
template_time = int(old[0]['groundtruth']['timestamp'])
manifest = []
for index, selected_row in enumerate(selected,1):
    time = selected_row['timestamp']; name=f'new-{index:02d}'
    truth=next(row for row in faults if int(row['timestamp'])==time)
    work=RUN/'cases'/name;work.mkdir(parents=True)
    task=template.replace(str(template_time-600),str(time-600)).replace(str(template_time+600),str(time+600)).replace(str(template_time),str(time))
    (work/'TASK.md').write_text(task)
    manifest.append(dict(case=name,groundtruth=truth,family=family(truth),windowStart=time-600,windowEnd=time+600,selection=selected_row,files=[],taskHash=digest(work/'TASK.md')))
for source in sources:
    rel=source.relative_to(HERE/'sources/metrics'); handles=[]
    with source.open(newline='') as stream:
        reader=csv.DictReader(stream)
        for item in manifest:
            out=RUN/'cases'/item['case']/'evidence'/rel;out.parent.mkdir(parents=True,exist_ok=True)
            handle=out.open('w',newline='');writer=csv.DictWriter(handle,fieldnames=reader.fieldnames);writer.writeheader()
            handles.append((item,out,handle,writer,[]))
        for row in reader:
            timestamp=float(row['timestamp'])
            for item,out,handle,writer,timestamps in handles:
                if item['windowStart'] <= timestamp <= item['windowEnd']:writer.writerow(row);timestamps.append(timestamp)
        for item,out,handle,writer,timestamps in handles:
            handle.close()
            if not timestamps: raise SystemExit('Empty required source: '+str(out))
            item['files'].append(dict(path=str(out.relative_to(RUN/'cases'/item['case'])),rows=len(timestamps),sha256=digest(out),firstTimestamp=min(timestamps),lastTimestamp=max(timestamps)))
save(RUN/'case-manifest.json',manifest)
save(RUN/'source-integrity.json',dict(source='https://zenodo.org/records/19176851',archive='https://zenodo.org/api/records/19176851/files/aiops2022.zip/content',originalSourceFilesSha256=digest(HERE/'source-files.json'),groundtruthSha256=digest(HERE/'sources/groundtruth.csv'),files=[dict(path=str(p.relative_to(HERE)),sha256=digest(p),bytes=p.stat().st_size) for p in sources]))
print(json.dumps(dict(run=str(RUN),eligible=len(eligible),selected=[dict(case=m['case'],timestamp=m['groundtruth']['timestamp'],score=m['selection']['score'],objects=m['selection']['multiSignalObjects'],files=len(m['files']),rows=sum(f['rows'] for f in m['files'])) for m in manifest]),ensure_ascii=False,indent=2))
