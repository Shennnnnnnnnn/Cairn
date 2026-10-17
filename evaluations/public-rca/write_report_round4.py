"""Render measured tables after all episodes and independent editorial reviews exist."""
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
run=sys.argv[1] if len(sys.argv)>1 else '2026-10-17-aiops2022-round4b'
r=ROOT/'runs'/run
s=json.loads((r/'summary.json').read_text())
q=json.loads((r/'qualitative-audit.json').read_text())
assert s['finished'] and len(s['results'])==8
assert s['audit']['passed']==s['audit']['total'] and not s['audit']['failures']
assert len([k for k in q['reviews'] if not k.endswith('/recovery')])==8
editorial=(ROOT/'synthesis-round4.zh-CN.md').read_text()
b=s['baseline']['pi-cairn'];c=s['byMode']['pi-cairn'];p=s['byMode']['pi']
def tokens(m):return ('≥' if m['usageIsLowerBound'] else '')+f"{m['usage']['totalTokens']:,}"
def wrong(m):return f"{m['wrongAccepted']}/{m['n']}"
def acceptance(m):return f"{m['replayPassed']}/{m['n']}"
def recovery_tokens(m):return ('≥' if m['recovery'].get('usageIsLowerBound') else '')+f"{m['recovery']['tokens']:,}"
def wrong_among_completed(m):return f"{m['wrongAccepted']}/{m['accepted']}" if m['accepted'] else '—（无完成样本）'
rows=[]
for case in ['case-01','case-02','case-03','case-04']:
 a=next(x for x in s['results'] if x['case']==case and x['mode']=='pi')
 z=next(x for x in s['results'] if x['case']==case and x['mode']=='pi-cairn')
 def candidate(x):
  t=(x['reviewedGrade'].get('predictions') or [{}])[0]
  return f"`{t.get('location','未交付')}` / `{t.get('fault_family','unknown')}`（{'命中' if x['reviewedGrade'].get('jointTop1') else '未命中'}）"
 delay=z.get('firstCheckpointSeconds')
 rows.append(f"| {case} | {candidate(a)} | {candidate(z)} | {z.get('persistedCheckpoints',0)} / {delay:.1f}s | {a['metrics']['wallSeconds']:.1f} / {z['metrics']['wallSeconds']:.1f} |" if delay is not None else f"| {case} | {candidate(a)} | {candidate(z)} | 0 / — | {a['metrics']['wallSeconds']:.1f} / {z['metrics']['wallSeconds']:.1f} |")
text=f'''# 第四轮公开案例复验：探索闭环、finish 与独立结论审查

实验日期：2026-10-17（Asia/Shanghai）。工程第五轮，正式运行 `{run}`。基线为 `2026-10-17-aiops2022-round3c`；[上一轮报告](comparison-round3.zh-CN.md)保留不变。

## 主阶段数据

| 指标 | 上一轮 Cairn | 本轮 Cairn | 同轮原生 Pi |
| --- | ---: | ---: | ---: |
| 首选具体对象命中 | {b['top1Entity']}/4 | {c['top1Entity']}/4 | {p['top1Entity']}/4 |
| 对象＋故障大类联合命中 | {b['jointTop1']}/4 | {c['jointTop1']}/4 | {p['jointTop1']}/4 |
| 运行完成 | {b['accepted']}/4 | {c['accepted']}/4 | {p['accepted']}/4 |
| 完成＋复算通过＋联合命中 | {b['acceptedReplayCorrect']}/4 | {c['acceptedReplayCorrect']}/4 | {p['acceptedReplayCorrect']}/4 |
| 语义错误完成 / 全部运行 | {wrong(b)} | {wrong(c)} | {wrong(p)} |
| 语义错误完成 / 已完成 | {wrong_among_completed(b)} | {wrong_among_completed(c)} | {wrong_among_completed(p)} |
| 文件契约＋独立数值复算通过 | {acceptance(b)} | {acceptance(c)} | {acceptance(p)} |
| 时间 / 输出预算停止 | {b['timeouts']} / {b['budgetStops']} | {c['timeouts']} / {c['budgetStops']} | {p['timeouts']} / {p['budgetStops']} |
| 合计耗时 | {b['wallSeconds']:.2f} 秒 | {c['wallSeconds']:.2f} 秒 | {p['wallSeconds']:.2f} 秒 |
| 已记录总 tokens，含缓存 | {tokens(b)} | {tokens(c)} | {tokens(p)} |
| 输出 tokens | {b['usage']['output']:,} | {c['usage']['output']:,} | {p['usage']['output']:,} |
| 被拒绝的 finish 请求 | {b['rejectedFinishes']} | {c['rejectedFinishes']} | {p['rejectedFinishes']} |
| 原生 / Cairn 工具请求 | {b['nativeTools']} / {b['cairnTools']} | {c['nativeTools']} / {c['cairnTools']} | {p['nativeTools']} / {p['cairnTools']} |

“运行完成”沿用冻结政策：Cairn 必须 completed、当前 owner epoch 的验收通过且所提交文件与阶段结束快照匹配；Pi 为正常退出、无时间／输出停止且保存有效 answer。两者是不同运行层面的口径。文件与数值验收单列，不等于根因正确。“错误完成”仅指已完成任务的首选对象或故障大类未命中独立标签；全文语义问题另外审阅。工具数是声明请求，预算停止时并非都已执行。

## 黑板是否进入探索

本轮 Cairn 有 **{c.get('episodesWithCheckpoint',0)}/4** 例成功调用 checkpoint，共 {c.get('checkpoints',0)} 次成功调用、{c.get('persistedCheckpoints',0)} 次实际状态更新；成功调用中 {c.get('summaryOnlyCheckpoints',0)} 次仅写摘要、{c.get('findingCheckpoints',0)} 次提交 Finding、{c.get('otherCheckpoints',0)} 次更新其他结构。最终图有 {c.get('prerequisiteEdges',0)} 条 Finding 前提边、{c.get('explorationReviewRequests',0)} 次去重回看提醒。上一轮四例没有中途 checkpoint，交接都在 finish 保存。调用计数不证明发现有价值，需结合下表时间和逐例语义审阅。

| 案例 | Pi 首选 | Cairn 首选 | Cairn checkpoint 状态更新 / 首次保存距主阶段开始 | 秒数 Pi / Cairn |
| --- | --- | --- | ---: | ---: |
{chr(10).join(rows)}

## 用量与恢复

| 主阶段 usage | Cairn | Pi |
| --- | ---: | ---: |
| input | {c['usage']['input']:,} | {p['usage']['input']:,} |
| output | {c['usage']['output']:,} | {p['usage']['output']:,} |
| cacheRead | {c['usage']['cacheRead']:,} | {p['usage']['cacheRead']:,} |
| cacheWrite | {c['usage']['cacheWrite']:,} | {p['usage']['cacheWrite']:,} |

Reasoning 已包含在 output，不重复相加。中断／异常／非终态 usage 按下界报告；provider 配置没有可靠价格，0 不代表免费，不计算金额节省。

自然预算停止的恢复单列：Cairn {c['recovery']['n']} 例、{c['recovery']['seconds']:.2f} 秒、{recovery_tokens(c)} tokens；Pi {p['recovery']['n']} 例、{p['recovery']['seconds']:.2f} 秒、{recovery_tokens(p)} tokens。没有自然停止样本时不计算实际恢复成功率；保留已正确答案不是纠正错误诊断。

{editorial}

## 验证与复现记录

生产构建及 **235/235** 测试通过；真实 Pi CLI 的本地探索夹具 9 请求通过，不调用真实模型。冻结实现与运行记录检查 **{s['audit']['passed']}/{s['audit']['total']}** 通过；它们不是领域正确性检查。

所有隐藏标签评分均在八个主阶段及其必要恢复结束后执行。阶段答案／报告先保存在宿主私有临时目录，运行中不在 episode 父目录生成评分文件。原始数据仍只靠提示约束，没有 OS 沙盒；路径扫描不能证明严格隔离。四例、每条件一次、无 seed、可能训练污染，因此只支持描述性比较。黑板反馈、提示词和 finish 是组合改动，不能分离单一机制的因果效果。

首次 run4 因自动文件收集丢失描述字段、导致内部 finish 使验收指纹变化而中止；先补失败回归再修复。三段试运行全部排除，共 1041.04 秒、至少 1096745 tokens，不复用任何单例。详见 [排除成本](runs/{run}/excluded-trial-costs.json)。正式 run4b 是修复后新工作区的完整八轮。

- [聚合、逐例数据与完整性检查](runs/{run}/summary.json)
- [逐例独立语义审阅](runs/{run}/qualitative-audit.json)
- [冻结的实际 runner](runs/{run}/runner.frozen.mjs)
- [验收与恢复口径](runs/{run}/acceptance-policy.json)
- [235 项测试记录](runs/{run}/implementation-tests.log)
- [工程实现与原版回查](../../docs/optimization-round5.zh-CN.md)
- [OpenRig 多会话设计对照](../../docs/multi-session-reference.zh-CN.md)

运行目录是本地 ignored 材料；其他机器需重建原始数据及实验。重建本轮汇总与报告：

```sh
python3 evaluations/public-rca/analyze-round4.py {run}
python3 evaluations/public-rca/write_report_round4.py {run}
```

作者需先独立审阅八份输出并填写 synthesis-round4.zh-CN.md；不能把前轮判断复制成新轮结果。
'''
(ROOT/'comparison-round4.zh-CN.md').write_text(text)
print('Wrote comparison-round4.zh-CN.md')
