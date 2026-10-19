"""Independent contract/numeric verifier. Never reads hidden root-cause labels or executes submitted scripts."""
from pathlib import Path
import csv,gzip,json,hashlib,math,statistics,sys

def rows(path):
    opener=gzip.open if str(path).endswith('.gz') else open
    with opener(path,'rt',encoding='utf-8',newline='') as f:yield from csv.DictReader(f)

def number(value):
    try:x=float(value)
    except (ValueError,TypeError):return None
    return x if math.isfinite(x) else None

def verify(work, manifest):
    issues=[]
    def bad(message):issues.append({'message':message})
    for name,digest in manifest.items():
        p=work/name
        if not p.is_file() or hashlib.sha256(p.read_bytes()).hexdigest()!=digest:bad('Original input changed: '+name)
    for name in ['answer.json','REPORT.md','checks.json']:
        if not (work/name).is_file() or not (work/name).stat().st_size:bad('Missing nonempty '+name)
    if issues:return {'ok':False,'issues':issues,'method':'contract','scope':'Input integrity and delivery structure'}
    answer=json.loads((work/'answer.json').read_text());checks=json.loads((work/'checks.json').read_text()).get('checks',[])
    if not isinstance(answer,dict) or not isinstance(answer.get('root_cause_service'),str) or not answer['root_cause_service'].strip():bad('answer.root_cause_service must be a nonempty string')
    if answer.get('fault_family') not in ['cpu','memory','disk_io','socket','network','application','unknown']:bad('answer.fault_family is outside the documented categories')
    if not isinstance(answer.get('mechanism'),str) or not answer['mechanism'].strip():bad('answer.mechanism is required')
    confidence=answer.get('confidence')
    if not isinstance(confidence,(float,int)) or isinstance(confidence,bool) or not 0<=confidence<=1:bad('answer.confidence must be 0..1')
    alternatives=answer.get('alternatives',[])
    if not isinstance(alternatives,list) or len(alternatives)<2 or any(not isinstance(a,dict) or any(not isinstance(a.get(k),str) or not a[k].strip() for k in ['hypothesis','verdict','basis']) for a in alternatives):bad('answer.alternatives requires two concrete hypotheses, verdicts and bases')
    if answer.get('root_cause_service','') not in (work/'REPORT.md').read_text():bad('REPORT must state the submitted primary service')
    if not isinstance(checks,list) or not 4<=len(checks)<=8:bad('checks must contain 4..8 entries')
    if issues:return {'ok':False,'issues':issues,'method':'contract','scope':'Delivery structure, no root-cause labels'}
    required={'metric_mean':'evidence/metrics.csv','log_count':'evidence/logs.csv.gz','trace_summary':'evidence/traces.csv.gz'}
    if not set(required).issubset({c.get('kind') for c in checks}):bad('All three evidence modalities must be covered')
    keys=[c.get('key') for c in checks]
    if any(not isinstance(k,str) or not k.strip() for k in keys) or len(set(keys))!=len(keys):bad('Each check needs a unique key')
    boundary=json.loads((work/'incident.json').read_text())['incident_time']
    groups={kind:[] for kind in required};actuals={}
    for c in checks:
        kind=c.get('kind');key=c.get('key')
        if kind not in required or c.get('file')!=required.get(kind):bad(str(key)+': wrong kind/file');continue
        if not isinstance(c.get('purpose'),str) or not c['purpose'].strip():bad(str(key)+': missing purpose')
        if not isinstance(c.get('expected'),dict):bad(str(key)+': missing expected');continue
        if kind=='metric_mean' and not isinstance(c.get('column'),str):bad(str(key)+': missing column');continue
        if kind!='metric_mean' and not isinstance(c.get('service'),str):bad(str(key)+': missing service');continue
        if kind=='log_count' and (not isinstance(c.get('contains'),str) or not c['contains']):bad(str(key)+': missing literal contains');continue
        groups[kind].append(c);actuals[key]={'before':[],'after':[],'before_count':0,'after_count':0}
    for kind,items in groups.items():
        if not items:continue
        for row in rows(work/required[kind]):
            timestamp=number(row.get('time') if kind=='metric_mean' else row.get('timestamp') if kind=='log_count' else row.get('startTimeMillis'))
            if timestamp is None:continue
            if kind=='trace_summary':timestamp/=1000
            period='before' if timestamp<boundary else 'after'
            for c in items:
                out=actuals[c['key']]
                if kind=='metric_mean':
                    if c['column'] not in row:raise ValueError('Unknown metrics column: '+c['column'])
                    value=number(row[c['column']])
                    if value is None:continue
                elif kind=='log_count':
                    if row['container_name']!=c['service'] or c['contains'] not in row['message']:continue
                    value=None
                else:
                    if row['serviceName']!=c['service'] or 'operation' in c and row['operationName']!=c['operation']:continue
                    value=number(row.get('duration'))
                out[period+'_count']+=1
                if value is not None:out[period].append(value)
    verified=[]
    for c in checks:
        if c.get('key') not in actuals:continue
        out=actuals[c['key']];actual={k:out[k] for k in ['before_count','after_count']}
        kind=c['kind']
        if kind!='log_count':
            func=statistics.mean if kind=='metric_mean' else statistics.median
            suffix='_mean' if kind=='metric_mean' else '_duration_median'
            actual.update({period+suffix:func(out[period]) if out[period] else None for period in ['before','after']})
        if actual['before_count']+actual['after_count']==0:bad(c['key']+': no matching observations')
        for field,value in actual.items():
            supplied=c['expected'].get(field,'missing')
            valid=supplied is None if value is None else isinstance(supplied,(int,float)) and not isinstance(supplied,bool) and math.isfinite(supplied) and (supplied==value if field.endswith('_count') else math.isclose(supplied,value,rel_tol=1e-4,abs_tol=1e-6))
            if not valid:bad(c['key']+'.expected.'+field+': recomputed '+json.dumps(value)+', submitted '+json.dumps(supplied))
        verified.append({'key':c['key'],'kind':kind,'actual':actual})
    return {'ok':not issues,'issues':issues,'method':'replay','scope':'Unchanged inputs, delivery structure and independent metric/log/trace numeric replay; not diagnostic correctness','checks':verified}

if __name__=='__main__':
    try:
        manifest=json.loads(Path(sys.argv[1]).read_text());task=json.loads(sys.stdin.read() or '{}');work=Path(task.get('owner',{}).get('cwd') or '.').resolve()
        result=verify(work,manifest)
    except Exception as error:result={'ok':False,'issues':[{'message':type(error).__name__+': '+str(error)}],'method':'contract','scope':'Malformed submission, no root-cause labels'}
    print(json.dumps(result,ensure_ascii=False,allow_nan=False))
