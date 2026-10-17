"""Render the unbudgeted experiment after all twelve actors and independent review."""
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
run=sys.argv[1] if len(sys.argv)>1 else '2026-10-17-aiops2022-round6-unbudgeted'
r=ROOT/'runs'/run
s=json.loads((r/'summary.json').read_text());q=json.loads((r/'qualitative-audit.json').read_text())
assert s['finished'] and len(s['results'])==12 and not s['audit']['failures']
assert all(row['case']+'/'+row['mode'] in q['reviews'] for row in s['results'])
assert all('referenceReview' in review for review in q['reviews'].values())
MODES=['pi','pi-cairn-previous','pi-cairn'];NAMES={'pi':'原生 Pi','pi-cairn-previous':'旧版 Cairn','pi-cairn':'新版 Cairn'}
def table(headers,rows):return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join('---' for _ in headers)+' |']+['| '+' | '.join(str(v) for v in row)+' |' for row in rows])
def tok(n,lb=False):return ('≥' if lb else '')+f'{n:,}'
def count(m,k):return f"{m[k]}/{m['n']}"
def ratio(a,b):return f'{a}/{b}' if b else '—（无完成）'
metrics=[s['byMode'][m] for m in MODES]
primary=[('有效答案已保存',lambda m:count(m,'validAnswers')),('对象＋故障大类联合命中',lambda m:count(m,'jointTop1')),('运行协议完成',lambda m:count(m,'accepted')),('文件契约＋数值复算通过',lambda m:count(m,'replayPassed')),('完成＋复算＋联合命中',lambda m:count(m,'acceptedReplayCorrect')),('错误完成 / 全部',lambda m:count(m,'wrongAccepted')),('错误完成 / 已完成',lambda m:ratio(m['wrongAccepted'],m['accepted'])),('评测时间 / 输出停止',lambda m:f"{m['timeouts']} / {m['budgetStops']}"),('单次回复 length 终止',lambda m:m['responseLengthStops']),('累计秒数',lambda m:f"{m['wallSeconds']:.2f}"),('累计 tokens（含缓存）',lambda m:tok(m['usage']['totalTokens'],m['usageIsLowerBound'])),('输出 tokens',lambda m:tok(m['usage']['output'])),('原生 / Cairn 工具请求',lambda m:f"{m['nativeTools']} / {m['cairnTools']}"),('finish 拒绝次数',lambda m:m['rejectedFinishes'])]
main=table(['指标']+[NAMES[m] for m in MODES],[(label,*(fn(m) for m in metrics)) for label,fn in primary])
comparisons=[]
for mode in MODES:
 old=s['budgetedBaseline'][mode];new=s['byMode'][mode];end=old['withRecovery']
 comparisons.append((NAMES[mode],f"{old['acceptedReplayCorrect']}/4",f"{end['correctReplayDelivered']}/4",f"{new['acceptedReplayCorrect']}/4",f"{old['wallSeconds']:.1f} / {end['wallSeconds']:.1f} / {new['wallSeconds']:.1f}",f"{tok(old['usage']['totalTokens'],old['usageIsLowerBound'])} / {tok(end['tokens'],end['usageIsLowerBound'])} / {tok(new['usage']['totalTokens'],new['usageIsLowerBound'])}"))
comparison=table(['条件','上轮首次正确交付','上轮含恢复正确交付','本轮正确交付','秒：上轮首次 / 含恢复 / 本轮','tokens：上轮首次 / 含恢复 / 本轮'],comparisons)
case_rows=[]
for case in ['case-01','case-02','case-03','case-04']:
 entries=[]
 for mode in MODES:
  row=next(v for v in s['results'] if v['case']==case and v['mode']==mode);g=row['reviewedGrade'];c=(g.get('predictions') or [{}])[0]
  entries.append(f"`{c.get('location','未交付')}` / `{c.get('fault_family','unknown')}`；{'联合命中' if g.get('jointTop1') else '未命中'}，{'协议完成' if row['accepted'] else '未完成'}，{'复算通过' if row['acceptance'].get('ok') else '复算未通过'}")
 case_rows.append((case,*entries))
mechanisms=[('有成功 checkpoint 的案例',lambda m:count(m,'episodesWithCheckpoint')),('成功 checkpoint / 实际状态更新',lambda m:f"{m['checkpoints']} / {m['persistedCheckpoints']}"),('含 Finding 的状态更新',lambda m:m['persistedFindingCheckpoints']),('成功的仅摘要 checkpoint',lambda m:m['summaryOnlyCheckpoints']),('finish JSON 总字节 / 最大单次',lambda m:f"{m['finishPayloadBytes']} / {m['maxFinishPayloadBytes']}"),('自动快照 / 含发现引用快照',lambda m:f"{m['automaticHandoffs']} / {m['handoffsWithFacts']}"),('handoff 文件存在',lambda m:m['handoffReportsPresent'])]
mechanism=table(['指标']+[NAMES[m] for m in MODES],[(label,*(fn(m) for m in metrics)) for label,fn in mechanisms])
errors=table(['案例','条件','自然退出原因','曾记录请求错误','原生请求重试','秒','输出 tokens'],[(row['case'],NAMES[row['mode']],row['metrics'].get('finalStopReason'),str(row['metrics'].get('modelError','—')).replace('|','/').replace('\n',' ')[:250],row.get('nativeRetries',0),f"{row['metrics']['wallSeconds']:.1f}",tok(row['metrics']['usage']['output'])) for row in s['results']])
usage=table(['Provider usage']+[NAMES[m] for m in MODES],[(key,*(tok(m['usage'][key]) for m in metrics)) for key in ['input','output','cacheRead','cacheWrite']])
editorial=(ROOT/'synthesis-round6.zh-CN.md').read_text()
text=f'''# 取消预算后，四组公开排障案例复验

正式运行 `{run}`。三组固定 **sub2api-copy/global:deepseek-v4.1-flash、high**，四例各运行一次，共十二次。两版 Cairn 逐文件复制并验证第五轮冻结归档，任务、案例、共享指引、验收器和评分规则相同。此次只移除评测侧预算，未修改 harness。

## 本轮结果

{main}

“联合命中”检查保存答案的首选对象与故障大类。“运行协议完成”沿用前轮口径：Cairn 要求 completed、当前 owner 代次验收通过且产物哈希与快照一致；Pi 为正常退出、有有效答案且无外部预算中断。表中的正确交付仅指协议完成、复算和参考标签联合命中，不保证全文、指标物理语义或因果链正确。错误完成同时列出全部与已完成两个分母；缺少交付不能算诊断正确。

{table(['案例']+[NAMES[m] for m in MODES],case_rows)}

## 与有预算的第五轮比较

{comparison}

前轮首次限制为 720 秒、累计输出 24,000 tokens、单次回复 8,192 tokens；自然预算停止后可额外恢复 180 秒。本轮不设置这些限制，也不做自动恢复。前轮主阶段与含恢复数据分别比较，不能只选更有利的一列。串行顺序不变，但模型随机性、provider 状态与缓存仍可能变化，四个样本不能证明稳定提升。

## finish、checkpoint 与 handoff

{mechanism}

小型 finish 的字节数不等于模型 token 节省；无变化 checkpoint 不应产生新 revision。自动 handoff 含初始空快照，另列 from 非空、包含已保存发现引用的条目；发现可包含假设，不代表领域事实已独立证实。生成不等于被下一会话使用。

## 自然结束、恢复与成本

{errors}

未设置代理总时限、累计输出限额、单次回复覆盖值或 Cairn deadline/reserve；没有评测 watchdog。注册模型的原生上限为单次 128,000 tokens、上下文 1,000,000，Pi 仍可能按可用上下文裁剪，服务端也可能自行终止。`high` 推理等级和 Pi/provider 自身重试逻辑保留。模型错误、长度停止与用户取消不改写成完成。

{usage}

本轮六次 Connection error 均由 Pi 原生请求重试后成功继续（Pi 2、旧版 3、新版 1），不是跨会话接管。本轮未主动中断执行者，超时恢复率为“不适用”。本轮副本基础重载 8/8 通过，只证明持久状态可读，不能代替真实模型恢复实验。本地数值验证及 HTML 导出的 15 秒 I/O 超时不停止代理。

Token 只统计十二个 Pi 执行者的 provider 已报告 usage，含缓存，不含宿主开发／审阅对话；reasoning 已包含于 output，不重复相加。异常、未报告或长度终止的数据为下界。计价配置为零，不能推断金额或免费，也不能将总 token 的比例直接当成费用比例。

{editorial}

## 完整性与复现

冻结归档、输入、协议和评分检查 **{s['audit']['passed']}/{s['audit']['total']}** 通过。全部隐藏标签评分在十二个执行者结束后生成，逐例产物另作独立语义审阅。代理范围由提示约束，未启用 OS 沙盒；路径与命令审计不能证明严格隔离。这四例均为单会话指标任务，未覆盖跨领域通用性、多分支实际恢复或在线修复效果，公开数据也可能存在训练污染。本轮未改变核心实现，沿用前轮 242 项测试与真实 Pi 夹具验证；本轮 runner 做语法和预算移除检查，没有把旧测试冒充本轮重跑。

- [完整逐例数据与冻结审计](runs/{run}/summary.json)
- [逐例语义审阅](runs/{run}/qualitative-audit.json)
- [开跑前协议](runs/{run}/protocol.before.md)
- [冻结执行器](runs/{run}/runner.frozen.mjs)
- [路径和命令检查](runs/{run}/scope-audit.json)
- [补充命令审阅与临时文件越界](runs/{run}/scope-audit-addendum.json)
- [副本状态重载与交接完整性](runs/{run}/handoff-restoration.json)
- [历史 README 差异及启动哈希说明](runs/{run}/shared-protocol-note.json)
- [第五轮报告](comparison-round5.zh-CN.md)
- [UI 复盘入口与本轮截图](../../docs/public-rca-ui.zh-CN.md)
- [UI 原始状态及实现未改动检查](runs/{run}/ui-source-validation.json)

本地运行归档为 ignored 文件。重建分析：

```sh
python3 evaluations/public-rca/analyze-round6.py {run}
python3 evaluations/public-rca/scope-round5.py {run}
python3 evaluations/public-rca/write_report_round6.py {run}
```
'''
(ROOT/'comparison-round6.zh-CN.md').write_text(text)
print('Wrote comparison-round6.zh-CN.md')
