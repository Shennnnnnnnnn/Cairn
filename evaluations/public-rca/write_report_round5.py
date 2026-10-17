"""Render a three-arm same-model report only after frozen runs and manual review."""
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
run=sys.argv[1] if len(sys.argv)>1 else '2026-10-17-aiops2022-round5'
r=ROOT/'runs'/run
s=json.loads((r/'summary.json').read_text());q=json.loads((r/'qualitative-audit.json').read_text())
assert s['finished'] and len(s['results'])==12
assert not s['audit']['failures'] and s['audit']['passed']==s['audit']['total']
assert all(row['case']+'/'+row['mode'] in q['reviews'] for row in s['results'])
assert all(row['case']+'/'+row['mode']+'/recovery' in q['reviews'] for row in s['results'] if row['recovery'])
assert all('referenceReview' in review for review in q['reviews'].values())
MODES=['pi','pi-cairn-previous','pi-cairn']
NAMES={'pi':'原生 Pi','pi-cairn-previous':'旧版 Cairn','pi-cairn':'新版 Cairn'}
metrics=[s['byMode'][mode] for mode in MODES]
def table(headers,rows):
 return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join('---' for _ in headers)+' |']+['| '+' | '.join(str(v) for v in row)+' |' for row in rows])
def frac(m,key):return f"{m[key]}/{m['n']}"
def tokens(m):return ('≥' if m['usageIsLowerBound'] else '')+f"{m['usage']['totalTokens']:,}"
def rtokens(m):return ('≥' if m['recovery']['usageIsLowerBound'] else '')+f"{m['recovery']['tokens']:,}"
primary=[
 ('有效答案已保存',lambda m:frac(m,'validAnswers')),
 ('对象＋故障大类联合命中',lambda m:frac(m,'jointTop1')),
 ('运行完成',lambda m:frac(m,'accepted')),
 ('完成＋复算通过＋联合命中',lambda m:frac(m,'acceptedReplayCorrect')),
 ('错误完成 / 全部运行',lambda m:frac(m,'wrongAccepted')),
 ('错误完成 / 已完成',lambda m:f"{m['wrongAccepted']}/{m['accepted']}" if m['accepted'] else '—（无完成）'),
 ('文件契约＋数值复算通过',lambda m:frac(m,'replayPassed')),
 ('时间 / 输出预算停止',lambda m:f"{m['timeouts']} / {m['budgetStops']}"),
 ('单次回复 length 终止',lambda m:str(m['responseLengthStops'])),
 ('主阶段合计秒数',lambda m:f"{m['wallSeconds']:.2f}"),
 ('已记录总 tokens（含缓存）',tokens),
 ('输出 tokens',lambda m:f"{m['usage']['output']:,}"),
 ('原生 / Cairn 工具请求',lambda m:f"{m['nativeTools']} / {m['cairnTools']}"),
 ('被拒绝的 finish',lambda m:str(m['rejectedFinishes']))]
mechanisms=[
 ('有成功 checkpoint 的主阶段',lambda m:frac(m,'episodesWithCheckpoint')),
 ('成功 checkpoint / 实际状态更新',lambda m:f"{m['checkpoints']} / {m['persistedCheckpoints']}"),
 ('实际含 Finding 的状态更新',lambda m:str(m['persistedFindingCheckpoints'])),
 ('成功的仅摘要 checkpoint',lambda m:str(m['summaryOnlyCheckpoints'])),
 ('finish 请求 JSON 总字节 / 最大单次',lambda m:f"{m['finishPayloadBytes']} / {m['maxFinishPayloadBytes']}"),
 ('自动 handoff / 含事实引用的 handoff',lambda m:f"{m['automaticHandoffs']} / {m['handoffsWithFacts']}"),
 ('handoff 文件投影存在',lambda m:str(m['handoffReportsPresent']))]
recovery=[
 ('自然停止后恢复样本',lambda m:str(m['recovery']['n'])),
 ('恢复正常交付 / 恢复样本',lambda m:f"{m['recovery']['operationallyDelivered']}/{m['recovery']['n']}" if m['recovery']['n'] else '—'),
 ('恢复交付＋复算＋联合命中',lambda m:str(m['recovery']['acceptedCorrect'])),
 ('恢复合计秒数',lambda m:f"{m['recovery']['seconds']:.2f}"),
 ('恢复 tokens',rtokens),
 ('恢复时读取旧任务次数',lambda m:str(m['recovery']['oldTaskReads'])),
 ('恢复时明确读取旧交接文件次数',lambda m:str(m['recovery']['handoffReportReads'])),
 ('恢复 finish 参数总字节 / 最大单次',lambda m:f"{m['recovery']['finishPayloadBytes']} / {m['recovery']['maxFinishPayloadBytes']}")]
def mtable(spec,cols=metrics):return table(['指标']+[NAMES[m] for m in MODES],[(name,*(fn(m) for m in cols)) for name,fn in spec])
case_rows=[]
for case in ['case-01','case-02','case-03','case-04']:
 entries=[]
 for mode in MODES:
  row=next(v for v in s['results'] if v['case']==case and v['mode']==mode)
  candidate=(row['reviewedGrade'].get('predictions') or [{}])[0]
  label=f"`{candidate.get('location','未交付')}` / `{candidate.get('fault_family','unknown')}`"
  entries.append(label+f"；{'联合命中' if row['reviewedGrade'].get('jointTop1') else '未命中'}，{'完成' if row['accepted'] else '未完成'}")
 case_rows.append((case,*entries))
usage=table(['主阶段 usage']+[NAMES[m] for m in MODES],[(key,*(f"{m['usage'][key]:,}" for m in metrics)) for key in ['input','output','cacheRead','cacheWrite']])
editorial=(ROOT/'synthesis-round5.zh-CN.md').read_text()
text=f'''# 第五轮公开案例复验：小型 finish、增量 checkpoint 与自动交接

日期：2026-10-17。工程第六轮，正式运行 `{run}`。本轮三组均重新运行 **sub2api-copy/global:deepseek-v4.1-flash、high**；旧版加载上一轮冻结的实现，新版加载本轮冻结实现。历史 Kimi 结果保留在[上一轮报告](comparison-round4.zh-CN.md)，不能把跨模型差值归因为代码改进。

## 主阶段：同模型三组对照

{mtable(primary)}

每组四例、每例一次。“联合命中”检查保存答案的首选对象及故障大类；未保存有效答案不计命中。“运行完成”沿用冻结政策：Cairn 为 completed、当前 owner 代次的验收通过且提交文件与阶段快照相同；Pi 为正常退出、无预算停止且有有效答案。两者是各自运行协议的完成口径。数值验收不判断诊断正确，故单列完成＋复算＋联合命中。错误完成同时给出全部运行和已完成两个分母；没有完成不能据此宣称错误率改善。

{table(['案例']+[NAMES[m] for m in MODES],case_rows)}

## 加上必要恢复后的端到端交付

{table(['指标']+[NAMES[mode] for mode in MODES],[(label,*(fn(m['withRecovery']) for m in metrics)) for label,fn in [('最终首选对象＋类别命中',lambda m:f"{m['jointTop1']}/{m['n']}"),('正常交付',lambda m:f"{m['delivered']}/{m['n']}"),('交付＋复算＋联合命中',lambda m:f"{m['correctReplayDelivered']}/{m['n']}"),('错误交付 / 已交付',lambda m:f"{m['wrongDelivered']}/{m['delivered']}" if m['delivered'] else '—'),('总秒数',lambda m:f"{m['wallSeconds']:.2f}"),('已记录总 tokens',lambda m:('≥' if m['usageIsLowerBound'] else '')+f"{m['tokens']:,}")]])}

每例只取最后一次阶段结果计交付与正确性，成本则加上全部主阶段及必要恢复。Cairn 的续接完成不改变原主任务的未完成状态。这个视图不能代替上面的首次完成率。

## 三项机制的实际使用

{mtable(mechanisms)}

成功调用与实际状态更新分开：无变化请求不应推进 revision。仅摘要计数只覆盖成功调用；被 schema 拒绝的调用不算保存事实。finish 字节数按模型已声明的 JSON 参数统计，不包含响应，也不是 token 节省估算。自动 handoff 包含任务刚创建时的空快照，因此另列含事实引用的数量；保存文件不等于接收方已阅读或接管。

## 恢复与成本

{mtable(recovery)}

只对主阶段自然时间／输出停止追加同工作区、全新原生上下文的固定 180 秒。Cairn 恢复按冻结协议读取旧任务，再创建新期限的后续任务；旧任务 deadline 不延长。正常交付、独立复算和联合命中分别统计。保留已有正确答案不等于纠正错误诊断；没有自然停止样本时不计算恢复成功率。

{usage}

Reasoning 已包含在 output，不重复相加。中断、异常或非终态 usage 报告为下界；缓存读取包含在总 tokens 内。provider 未提供可靠计价，配置中的 0 不表示免费，因此不计算金额或金额节省。正式表格不含接入探针：探针另用 13.04 秒、26020 tokens；本轮没有排除后重跑的 RCA 开发试验。

{editorial}

## 完整性与复现

构建及 **242/242** 测试通过；真实 Pi CLI 本地探索夹具 10 请求、完成修正夹具 11 请求通过。冻结文件、协议和运行记录检查 **{s['audit']['passed']}/{s['audit']['total']}** 通过；它们不证明领域正确性。所有隐藏评分在十二个主阶段及必要恢复结束后才执行，答案／报告先保存在宿主私有临时目录，actor 无评分反馈。

两个 Cairn 条件共享同一通用指引，各自使用冻结 skill 和 catalog；工具协议、提示与自动保存是组合改动，无法从本实验分离单一机制的因果效应。没有 OS 沙盒，路径与命令审阅不能证明严格隔离。四例无 seed、无重复抽样、可能存在训练污染，只能作描述性比较；单会话测试也不能替代多 worker、跨机或消息 ACK 验证。

- [完整聚合、逐例及冻结检查](runs/{run}/summary.json)
- [独立逐例语义审阅](runs/{run}/qualitative-audit.json)
- [冻结 runner](runs/{run}/runner.frozen.mjs)
- [协议与预算](runs/{run}/protocol.before.md)
- [路径与命令检查](runs/{run}/scope-audit.json)
- [离线持久状态恢复检查](runs/{run}/handoff-restoration.json)
- [242 项测试记录](runs/{run}/implementation-tests.log)
- [工程实现](../../docs/optimization-round6.zh-CN.md)
- [OpenRig 设计对照与边界](../../docs/multi-session-reference.zh-CN.md)

运行目录是本地 ignored 材料，其他机器需要重建数据与实验。作者须先独立审阅全部主阶段和恢复产物，再填写 synthesis-round5.zh-CN.md。重建分析：

```sh
python3 evaluations/public-rca/analyze-round5.py {run}
python3 evaluations/public-rca/scope-round5.py {run}
python3 evaluations/public-rca/write_report_round5.py {run}
```
'''
(ROOT/'comparison-round5.zh-CN.md').write_text(text)
print('Wrote comparison-round5.zh-CN.md')
