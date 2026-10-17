"""Generate the factual tables after all eight experiments reach terminal state."""
import json,sys
from pathlib import Path
ROOT=Path(__file__).parent
run=ROOT/'runs'/(sys.argv[1] if len(sys.argv)>1 else '2026-10-16-aiops2022')
s=json.loads((run/'summary.json').read_text());assert len(s['results'])==8 and (run/'finished.json').exists(),'Wait for all eight terminal results'
rows=s['results'];by={(r['case'],r['mode']):r for r in rows};agg=s['byMode'];labels=json.loads((run/'case-manifest.json').read_text())
def status(r):
 g=r['reviewedGrade'];prediction=r['grade'].get('predictions',[{}])[0]
 result='对象＋类别命中' if g['jointTop1'] else ('对象命中，类别保留 unknown' if g['top1Entity'] and prediction.get('fault_family')=='unknown' else '对象命中，类别错误' if g['top1Entity'] else '类别命中，对象第 '+str(round(1/g['reciprocalRank']))+' 候选' if g['top1Family'] and g['top3Entity'] else '类别命中，对象错误' if g['top1Family'] else '未命中')
 return result+('；进程超时' if r['metrics']['timedOut'] else '')
def tokens(r):return ('≥' if r['usageIsLowerBound'] else '')+f"{r['metrics']['usage']['totalTokens']:,}"
lines=['# 公开 AIOps 2022 排障案例对照与最终结论','',f"实测日期：2026-10-16。基于提交 `{s['manifest']['git']}`，Pi {s['manifest']['piVersion']}，API 配置模型 `{s['manifest']['provider']}/{s['manifest']['model']}`，thinking=high。模型名称为服务端返回标签，未独立验证底层模型身份。",'','## 本轮真实结果','','“命中”指第一候选的比赛同粒度对象与资源大类同时匹配标签。报告推理、任务状态和进程退出分别审阅。','', '| 案例 | 标签对象 / 故障 | Pi | Pi+Cairn | Pi 秒 | Pi+Cairn 秒 |', '| --- | --- | --- | --- | ---: | ---: |']
for m in labels:
 a,b=by[(m['case'],'pi')],by[(m['case'],'pi-cairn')]
 lines.append(f"| {m['case']} | {m['groundtruth']['cmdb_id']} / {m['groundtruth']['failure_type']} | {status(a)} | {status(b)} | {a['metrics']['wallSeconds']:.1f} | {b['metrics']['wallSeconds']:.1f} |")
lines+=['','| 指标（4 次合计） | Pi | Pi+Cairn |','| --- | ---: | ---: |']
for label,key in [('第一候选对象命中（标识符复核）','reviewedTop1Entity'),('对象 Top-3 命中（标识符复核）','reviewedTop3Entity'),('第一候选资源大类命中','top1Family'),('对象与大类同时命中（标识符复核）','reviewedJointTop1'),('MRR（标识符复核）','reviewedMRR'),('原始字面规则首选对象命中','top1Entity'),('原始字面规则对象 Top-3 命中','top3Entity'),('原始字面规则对象＋类别命中','jointTop1'),('累计观察用时，秒','wallSeconds'),('原生工具调用','nativeToolCalls'),('Cairn 工具调用','cairnToolCalls'),('工具返回错误','toolErrors'),('验收拒绝的 finish 次数','failedFinishAttempts'),('进程超时','timeouts'),('异常结束','abnormalRuns'),('模型错误响应','modelErrorResponses'),('后续恢复执行的错误响应','recoveredModelErrorResponses')]:
 vals=[agg[x][key] for x in ['pi','pi-cairn']];lines.append(f"| {label} | {vals[0]:.3f} | {vals[1]:.3f} |" if key in ['meanReciprocalRank','reviewedMRR','wallSeconds'] else f'| {label} | {vals[0]} | {vals[1]} |')
for label,key in [('总 token（含缓存读取）','tokens'),('输出 token（含推理，不重复相加）','outputTokens')]:
 vals=[('≥' if agg[x]['usageIsLowerBound'] else '')+f"{agg[x][key]:,}" for x in ['pi','pi-cairn']];lines.append(f'| {label} | {vals[0]} | {vals[1]} |')
lines += ['','上限为每次 720 秒；超时用时是实际观察时长，不是自然完成所需时间。中断和错误响应可能未返回完整 usage（错误响应常为全零），即使随后恢复，相关 token 也保守报告已记录下界。缓存 token 不等于等价计费输入，缺乏可核实单价，未估计金额。','','## 每次运行详情','','| 案例 | 模式 | 第一候选对象 / 类别 | 总 token | 原生 / Cairn 调用 | 工具错误 | 退出 | Cairn 状态 / 结论 / 依赖边 |','| --- | --- | --- | ---: | ---: | ---: | --- | --- |']
for r in rows:
 m=r['metrics'];c=r['grade'].get('predictions',[{}])[0];tasks=r['cairn'];state='—' if not tasks else '; '.join(f"{t['status']} / {t['claims']} / {t['dependencyLinks']}" for t in tasks)
 lines.append(f"| {r['case']} | {r['mode']} | {c.get('location','未提交')} / {c.get('fault_family','—')} | {tokens(r)} | {m['nativeToolCalls']} / {m['cairnToolCalls']} | {m['toolErrors']} | {m['exitCode']} {'timeout' if m['timedOut'] else m.get('finalStopReason','')} | {state} |")
lines+=['','## 来源、输入与公平性','','来源链为 RCLAgent 作者公开的 AIOps 2022 数据说明 → Zenodo 归档 19176851 → training_data_with_faults.zip。`2022-03-20-cloudbed2` 的标签文件按 timestamp 排序取前四行，在模型运行前固定。四例来自同一天、同一测试床，不能当作四个独立平台。镜像发布者说明原始入口已不可用，本轮使用其第三方归档；镜像声明的许可信息记录在 provenance.json，原始数据不随仓库再分发。','','每题仅保留故障标签时刻前后各 600 秒的全部 container/node/service 指标原始行，57 个 CSV、约 5.8 万行；未筛选故障对象、未合成指标、未提供答案。模型获得故障时刻，不需要从全天发现告警。没有提供日志、调用链、拓扑、指标类型元数据与在线系统。原始标签、镜像路径及独立评分器均在模型工作区之外。case-02 的前段仍含前一事件的尾部，保留了这种原始混杂。','','同一模型、高思考、maxTokens=8192/回复、完整回复输出上限 24000；单并发、交替先后顺序；全新工作区与原生会话。两组相同任务、证据、交付格式与时间上限，Cairn 额外加载扩展/skill 并要求 start/checkpoint/finish。Pi 基线可用脚本与文件记录。此处测试的是实际使用 Cairn 协议的额外收益与开销。目录访问依赖指令约束，无操作系统隔离，不能排除训练数据污染。','','原始自动评分在运行前冻结：对象精确匹配（允许 node 前缀规范化）、资源大类 CPU/memory/disk_io/network、Top-3/MRR；网络损坏/丢包/延迟等细分不从有限指标强行判别。本轮分数是自定义离线诊断分数，不等同官方比赛成绩。在查看网络题两组答案前补充标识符复核：service 的 -grpc/-http 后缀与无协议后缀标签视为同一服务；仅此拼写差异可归一，不把一个 pod 自动升级为整项 service 命中。原始评分完整保留，表中同时列出复核结果，依据见 identifier-policy.json。每组每题一次，无统计显著性或稳定加速结论。前轮采用不同任务与分阶段预算，两个实验轮次不直接汇总速度比。','','## 审计与产物','','原始 JSONL、provider usage、工具入参/结果、原生会话、answer.json、REPORT.md、SQLite 和 HTML 均在 `runs/'+run.name+'/`。独立复算忽略 agent_end 的重复消息；输入哈希、评分器/提示/runner 的冻结哈希与模型实际标签一起核对。`audit.json` 的 54/54 项实验记录一致性检查通过，不能当成内容正确率。`qualitative-audit.json` 记录语义复核与数字复算；`schema-repro.json` 记录无模型的接口复现。','','复现方法见 README.zh-CN.md；来源和原始文件 SHA256 见 provenance.json 与 source-files.json。']
synthesis=(ROOT/'synthesis.zh-CN.md').read_text()
lines[4:4]=['',synthesis,'']
qualitative=json.loads((run/'qualitative-audit.json').read_text())
assert len({(x['case'],x['mode']) for x in qualitative})==8,'Complete semantic review for all runs before finalizing'
lines+=['',(ROOT/'review.zh-CN.md').read_text()]
(ROOT/'comparison.zh-CN.md').write_text('\n'.join(lines)+'\n')
print('wrote',ROOT/'comparison.zh-CN.md')
