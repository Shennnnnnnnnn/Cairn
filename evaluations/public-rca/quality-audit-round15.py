"""Targeted report assertions checked against frozen CSVs, not a new scorer."""
import csv,datetime,hashlib,json,statistics
from pathlib import Path

root=Path(__file__).resolve().parent/'runs/2026-10-18-deepseek-original-context-round15'
load=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
sealed={r['id']:r for r in load(root/'report-reviews.json')}
def report(actor,needles):
    path=root/actor/'initial.REPORT.md'
    assert sha(path)==sealed[actor]['sha256']
    return {'actor':actor,'sha256':sha(path),'matches':[
      {'line':i,'text':line} for i,line in enumerate(path.read_text().splitlines(),1)
      if any(n in line for n in needles)]}
def series(case,file,entity,metric):
    path=root/'cases'/case/'evidence'/file
    rows=list(csv.DictReader(path.open()))
    pts=sorted((int(r['timestamp']),float(r[metric] if 'service' in r else r['value']))
      for r in rows if (r['service']==entity if 'service' in r else r['cmdb_id']==entity and r['kpi_name']==metric))
    assert pts
    return {'file':str(path),'sha256':sha(path),'entity':entity,'metric':metric,'points':pts}
fs=series('new-01','container/kpi_container_fs_usage_MB.csv','node-5.shippingservice-0','container_fs_usage_MB./dev/vda1')
counter=series('new-02','container/kpi_container_memory_failcnt.csv','node-6.currencyservice2-0','container_memory_failcnt')
rates=[(b[0],(b[1]-a[1])/(b[0]-a[0])) for a,b in zip(counter['points'],counter['points'][1:])]
pre=statistics.mean(v for t,v in rates if t<1647762523)
post=statistics.mean(v for t,v in rates if t>=1647762523)
sr=series('new-03','service/metric_service.csv','adservice-grpc','sr')
entities_path=root/'cases/new-01/evidence/container/kpi_container_memory_usage_MB.csv'
entities=sorted({r['cmdb_id'] for r in csv.DictReader(entities_path.open()) if 'shippingservice' in r['cmdb_id']})
findings=[
 {'topic':'Per-metric temporal alignment','status':'confirmed-report-error',
  'reports':[report('deepseek-new-01-r2-original',['1647750900`：过渡','1647751440`：仍','1647751500`：恢复']),report('deepseek-new-01-r2-cairn-reuse',['1647751380 起回落'])],
  'sources':[fs],
  'observation':'For shippingservice-0 fs_usage the values are 33.22265625 at 0900, 656.1953125 at 0960, 656.27734375 at 1380, 55.69921875 at 1440. Original r2 shifts the file-usage onset earlier and recovery later; reuse r2 shifts recovery earlier. Different KPIs need distinct observed onset/recovery points.'},
 {'topic':'Rate denominator label','status':'confirmed-report-error',
  'reports':[report('deepseek-new-02-r3-original',['/分钟'])],
  'sources':[counter],'computed':{'prePerSecond':pre,'postPerSecond':post,'prePerMinute':pre*60,'postPerMinute':post*60},
  'observation':'The generated script divides adjacent differences by Unix-second deltas. Its 23115.05 and 23310.97 are raw counter units/second; labeling the same numbers /minute is a factor-60 denominator error. The physical counter unit remains unverified.'},
 {'topic':'Stable baseline versus universally healthy','status':'confirmed-report-error',
  'reports':[report('deepseek-new-03-r3-original',['11 个服务的 `rr`']),report('deepseek-new-03-r1-cairn-reuse',['11 个服务 rr/sr'])],
  'sources':[sr],'computed':{'adserviceSRMin':min(v for t,v in sr['points']),'adserviceSRMax':max(v for t,v in sr['points'])},
  'observation':'adservice-grpc sr ranges 70.8772–75.4579, so the claim that all 11 services rr/sr are 100% is false. No event-aligned deterioration does not establish universally healthy baseline. The recommendationservice-specific 100% claim is a separate, supported observation.'},
 {'topic':'Missing comparison entity','status':'unsupported-report-claim',
  'reports':[report('deepseek-new-01-r2-cairn-reuse',['node-6 上同服务'])],
  'sources':[{'file':str(entities_path),'sha256':sha(entities_path),'shippingEntities':entities}],
  'observation':'All four observed shipping container entities are on node-5. No node-6 shipping peer is present in these container metrics; its absence cannot establish no anomaly on a supposed second node.'},
 {'topic':'Unconfirmed physical unit conversion','status':'unsupported-report-claim',
  'reports':[report('deepseek-new-01-r2-cairn-reuse',['2.45 核']),report('deepseek-new-01-r3-cairn-reuse',['2.04 s','r_await ~2 s'])],
  'observation':'CSV values alone do not document the collector transformation for container_cpu_usage_seconds or the unit of system.io.r_await. Calling them cores or seconds needs collection metadata. No substitute ms conversion is asserted here.'},
 {'topic':'UTC conversion candidate rejected','status':'verified-correct',
  'reports':[report('deepseek-new-01-r3-cairn-fresh',['UTC'])],
  'computed':{str(t):datetime.datetime.fromtimestamp(t,datetime.timezone.utc).isoformat() for t in [1647750360,1647750907,1647750960,1647751380]},
  'observation':'The UTC conversions in this report are correct; initial suspicion was rejected after deterministic conversion. The separate recovery-bucket description still requires per-metric alignment.'},
]
result={'method':'All 36 reports were fully read and sealed before frozen grading. This follow-up verifies selected public prose assertions against immutable CSVs with independent standard-library arithmetic; no actor script executed, no report edited, no scores changed. It is not an exhaustive prose accuracy metric.','findings':findings}
(root/'report-quality-review.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'findings':[{ 'topic':r['topic'],'status':r['status']} for r in findings],'rateValues':{'before':pre,'after':post}},ensure_ascii=False,indent=2))
