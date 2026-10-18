"""Targeted public-report review against immutable local CSVs; no actor code run."""
import csv,hashlib,json,statistics
from pathlib import Path

base=Path(__file__).resolve().parent
root=base/'runs/2026-10-18-kimi-scheduler-round14'
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
sealed={r['id']:r for r in load(root/'report-reviews.json')}
def report(actor,needles):
    path=root/actor/'initial.REPORT.md'
    assert sha(path)==sealed[actor]['sha256']
    lines=path.read_text().splitlines()
    return {'actor':actor,'path':str(path),'sha256':sha(path),'matches':[{'line':i+1,'text':text} for i,text in enumerate(lines) if any(n in text for n in needles)]}
def series(case,filename,entity,metric):
    path=root/'cases'/case/filename
    with path.open() as f:rows=list(csv.DictReader(f))
    if 'service' in rows[0]:points=[(int(r['timestamp']),float(r[metric])) for r in rows if r['service']==entity]
    else:points=[(int(r['timestamp']),float(r['value'])) for r in rows if r['cmdb_id']==entity and r['kpi_name']==metric]
    points.sort();assert points,(filename,entity,metric)
    return {'file':str(path),'sha256':sha(path),'entity':entity,'metric':metric,'points':points,'min':min(v for t,v in points),'max':max(v for t,v in points),'monotonicNondecreasing':all(a[1]<=b[1] for a,b in zip(points,points[1:]))}
usage=series('new-01','evidence/container/kpi_container_memory_usage_MB.csv','node-5.shippingservice-0','container_memory_usage_MB')
working=series('new-01','evidence/container/kpi_container_memory_working_set_MB.csv','node-5.shippingservice-0','container_memory_working_set_MB')
limit=series('new-01','evidence/container/kpi_container_spec_memory_limit_MB.csv','node-5.shippingservice-0','container_spec_memory_limit_MB')
reads=series('new-01','evidence/container/kpi_container_fs_reads_MB.csv','node-5.shippingservice-0','container_fs_reads_MB./dev/vda')
fs=series('new-01','evidence/container/kpi_container_fs_usage_MB.csv','node-5.shippingservice-0','container_fs_usage_MB./dev/vda1')
service=series('new-03','evidence/service/metric_service.csv','adservice-grpc','sr')
counter=series('new-03','evidence/container/kpi_container_memory_failcnt.csv','node-5.recommendationservice-2','container_memory_failcnt')
other=series('new-03','evidence/container/kpi_container_memory_failcnt.csv','node-6.currencyservice2-0','container_memory_failcnt')
node=series('new-03','evidence/node/kpi_cloudbed2_metric_0320.csv','node-5','system.mem.used')
findings=[
 {'topic':'Total usage and working set are different metrics','reports':[report('kimi-new-01-r1-cairn',['远未触及 limit','全程为 0']),report('kimi-new-01-r3-cairn',['远低于','未触及上限'])],'sources':[usage,working,limit,reads],'observation':'Total memory usage reaches about 255.97 MB against the configured 256 MB metric and device-qualified read samples are nonzero. A smaller working set cannot establish that total usage stays far below the limit. Numeric acceptance covers the submitted selected series, not this prose inference.'},
 {'topic':'First filesystem step shifted one sample','reports':[report('kimi-new-01-r1-cairn',['1647750900 采样点由'])],'sources':[fs],'observation':'Compare fs_usage at 1647750900 and 1647750960: the first large step is at 0960, not 0900. This is an observed-sample discrepancy; it does not independently fix the real unobserved injection onset.'},
 {'topic':'Blanket service success assertion','reports':[report('kimi-new-03-r1-native',['sr 全部 100%']),report('kimi-new-03-r1-cairn',['全部 11 个服务 sr/rr 全程 100%']),report('kimi-new-03-r2-cairn',['窗口保持 100%'])],'sources':[service],'observation':'adservice-grpc sr is below 100 throughout. It can be an existing baseline rather than the new fault, but should not be rewritten as perfect success.'},
 {'topic':'Inconsistent CPU dimensional description','reports':[report('kimi-new-01-r2-cairn',['核·秒/60s','CPU 升至约 2.4 核'])],'sources':[],'observation':'The same approximate 2.4 is called core-seconds per 60 seconds and cores. These differ by factor 60 under literal units. Raw collection semantics are undocumented, so this review does not pick one as the attested true unit.'},
 {'topic':'Fractional cumulative values do not imply non-monotonic gauge','reports':[report('kimi-new-03-r3-native',['语义非原始单调计数器','故按 gauge mean'])],'sources':[counter],'observation':'The actual sequence is nondecreasing, includes 1485.5 and stays at 2971. Fractional values do not by themselves justify abandoning cumulative semantics; arithmetic replay is not collection-semantics certification.'},
 {'topic':'Transient node change hidden by endpoint comparison','reports':[report('kimi-new-03-r3-native',['全程平稳（mem.used'])],'sources':[node],'observation':'The full node-5 memory-used series has an intermediate rise despite similar early/late endpoints. Endpoint comparison cannot establish whole-window stability.'},
 {'topic':'Existing counter growth described as constant','reports':[report('kimi-new-03-r3-cairn',['其他 failcnt 非零的容器'])],'sources':[other],'observation':'currencyservice2-0 failcnt continues increasing. Its approximately stable background rate may make it irrelevant to this new fault, but absolute values are not constant.'}
]
assert all(f['reports'] and all(r['matches'] for r in f['reports']) for f in findings)
result={'method':'Targeted follow-up of pre-grade public-report read notes, with sealed source hashes, exact line quotes and original CSV selectors/values. Performed after label scoring without changing scores. Not an exhaustive prose accuracy grade; no private reasoning or actor analysis scripts read/executed.','findings':findings,'sourceReportReviewSHA256':sha(root/'report-reviews.json')}
(root/'report-quality-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'findings':len(findings),'ioUsageMax':usage['max'],'ioLimit':limit['max'],'ioReadMax':reads['max'],'firstFsPoints':[p for p in fs['points'] if p[0] in [1647750840,1647750900,1647750960]],'adserviceSrRange':[service['min'],service['max']],'failcntNondecreasing':counter['monotonicNondecreasing'],'nodeMemoryRange':[node['min'],node['max']],'otherFailcntRange':[other['min'],other['max']]},ensure_ascii=False,indent=2))
