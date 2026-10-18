"""Presentation only; reads sealed, scored results without changing any outcome."""
import json
from pathlib import Path

base=Path(__file__).resolve().parent
root=base/'runs/2026-10-18-kimi-scheduler-round14'
load=lambda p:json.loads(p.read_text())
s=load(root/'summary.json');m=load(root/'manifest.json');audit=load(root/'closeout-audit.json');ctx=load(root/'context-audit.json')
native=s['groups']['kimi']['native'];cairn=s['groups']['kimi']['cairn']
def num(x):return f'{x:,.0f}'
def sec(x):return f'{x:.1f}'
def delta(a,b):return f'{(b/a-1)*100:+.1f}%' if a else '未知'
def cv(x):return f'{x*100:.1f}%' if x is not None else '未知'
lines=['# Round14：Pi Kimi K3 原生与 Cairn 对照','',
'本轮仅换模型，框架 src/dist/skills 与 Round13 完全一致。用户确认的模型显示名为 `sub2api-kimi`，实际配置键为 `sub2api-copy-copy`，模型 ID `kimi-k3`，两组均 high。没有改写模型注册或用户全局配置。','',
'## 主结果','',
'三道原开发题，每题每组 3 次，共 18 次。每组分母均为 9；错误完成指“完成且根因标签错误”。正确标签要求对象、层级、资源类别同时匹配。','',
'| 指标 | 原生 Pi | Pi + Scheduler/Cairn |',
'|---|---:|---:|']
for title,key in [('根因正确','correct'),('流程完成','completed'),('错误完成','falseCompletion'),('产物验收通过','acceptancePassed'),('有效正确交付','effectiveDelivery')]:lines.append(f'| {title} | {native[key]}/9 | {cairn[key]}/9 |')
for title,key in [('累计 tokens（含缓存输入）','recordedTokens'),('非缓存输入 tokens','noncachedInputTokens'),('缓存读取 tokens','cacheReadTokens'),('输出 tokens','outputTokens')]:lines.append(f'| {title} | {num(native[key])} | {num(cairn[key])} |')
for title,key in [('耗时中位数（秒）','median'),('耗时均值（秒）','mean')]:lines.append(f'| {title} | {sec(native["time"][key])} | {sec(cairn["time"][key])} |')
lines+=['',f'Cairn 相对原生：累计 tokens {delta(native["recordedTokens"],cairn["recordedTokens"])}，耗时中位数 {delta(native["time"]["median"],cairn["time"]["median"])}。',
f'未知用量样本：{native["missingUsage"]}/{cairn["missingUsage"]}；任一用量下界标记：{native["usageLowerBound"]}/{cairn["usageLowerBound"]}。金额没有实际账单，不能把配置价格或 tokens 直接称为费用。','',
'完成率不等于正确率；结构/算术验收不等于整篇报告语义正确。原生流程完成与 Cairn 流程完成保留 Round13 口径，Cairn 额外要求框架任务完成且验收为当前状态。有效交付同时要求流程完成、根因正确、验收通过、受保护输入未修改。','',
'## 分题与波动','',
'| 题目 | 组别 | 正确/完成/错误完成 | 有效交付 | 耗时中位数秒 | tokens 中位数 | tokens CV | 最大/最小 tokens |',
'|---|---|---|---:|---:|---:|---:|---:|']
for case,arms in s['perCase']['kimi'].items():
 for arm,g in arms.items():
  lines.append(f'| {case} | {arm} | {g["correct"]}/{g["completed"]}/{g["falseCompletion"]}（各3次） | {g["effectiveDelivery"]}/3 | {sec(g["time"]["median"])} | {num(g["tokens"]["median"])} | {cv(g["tokens"]["cv"])} | {g["tokens"]["maxMinRatio"]:.2f} |')
lines+=['','CV 为样本标准差/均值；每格只有三次重复，不能据此保证稳定性。失败、纠错与恢复的全部已知用量均计入，缓存 tokens 在输入内只统计一次。','',
'## 阶段与恢复','',
'| 调用类别 | 请求次数 | 续接身份匹配 | 原生正常结束 | 累计秒 | 已知 tokens |',
'|---|---:|---:|---:|---:|---:|']
for kind,g in ctx['summary']['kimi'].items():
 lines.append(f'| {kind} | {g["requests"]} | {g["identityMatched"]} | {g["normalEnded"]} | {sec(g["seconds"])} | {num(g["recordedTokens"])} |')
lines+=['','普通 Reason 会话复用、输出参数纠错、故障 Conclude 分别计数。身份匹配不等于恢复成功，恢复成功也不等于结论正确。没有触发的路径不能凭 fixture 声称真实模型验证成功。','',
'## 与 Round13 的历史参照','',
'相同三道开发题与相同框架，服务时窗和模型不同；Round13 每模型最多一个 CLI，本轮同一模型最多两个 CLI。以下仅为历史描述，不能当作受控模型速度排名。','',
'| 模型/轮次 | 原生正确/完成/错完 | Cairn 正确/完成/错完 | 原生/Cairn 耗时中位数秒 | 原生/Cairn 累计 tokens |',
'|---|---|---|---|---|']
old=load(base/'runs/2026-10-18-scheduler-contract-round13-final/summary.json')
for model,groups in [*old['groups'].items(),('kimi-round14',s['groups']['kimi'])]:
 a,b=groups['native'],groups['cairn']
 lines.append(f'| {model} | {a["correct"]}/{a["completed"]}/{a["falseCompletion"]} | {b["correct"]}/{b["completed"]}/{b["falseCompletion"]} | {sec(a["time"]["median"])}/{sec(b["time"]["median"])} | {num(a["recordedTokens"])}/{num(b["recordedTokens"])} |')
lines+=['','Round13 GLM 有七次上游服务终止，不能把其全样本均值、用量直接解读为模型推理效率。三题反复用于开发，不能证明框架或模型对未见任务的泛化。','',
'## 未完成与错误样本','']
for arm,g in [('native',native),('cairn',cairn)]:lines.append(f'- {arm} 未完成直接原因：`{json.dumps(g["incompleteReasons"],ensure_ascii=False)}`。')
for row in s['rows']:
 if not row['correct'] or not row['completed'] or not row['acceptancePassed']:
  lines.append(f'- `{row["id"]}`：完成={row["completed"]}，正确={row["correct"]}，验收={row["acceptancePassed"]}，原因=`{row["reason"]}`；预测=`{json.dumps(row["prediction"],ensure_ascii=False)}`；验收问题=`{json.dumps(row["acceptanceIssues"],ensure_ascii=False)}`。')
lines+=['','## 可追溯性与限制','',
f'- 18 个正式 actor，共 {audit["realNativeInvocations"]} 次真实原生 CLI 调用（包含额外阶段）；付费探针 0 次。3 个 Pi 无模型 fixture 另计。',
f'- {audit["uniquePrivateCredentialDirectories"]} 个私有凭据目录全部已删除，未将凭据归档。',
f'- 评分前阅读全部可用公开 REPORT 并 ACK/封存；manifest SHA256：`{audit["sourceManifestSHA256"]}`。',
f'- 冻结评测文件、实现、当前 src/dist/skills、已封存报告与用户全局配置漂移均为空；原生 usage、phase 增量及 actor 总计对账差异：`{audit["accountingDisagreements"]}`。',
f'- 原生 metadata 核验差异：`{json.dumps(audit["nativeCheckFailures"],ensure_ascii=False)}`。公开 provider/model 是请求与宿主观察，不能独立证明网关内部路由。',
'- Pi 没有操作系统级沙箱。公开命令索引与人工范围复核不能证明穷尽隔离；偏离记录保留，不据此删除样本。',
'- 不设置评测预算，但原生模型限制、验收器子进程超时、调度无进展终止仍然存在。','',
'原始证据位于 [Round14 运行目录](runs/2026-10-18-kimi-scheduler-round14/)，包括 manifest、summary、diagnostics、context-audit、公开报告与 seal、原生用量账本、scope 和 cleanup。']
(base/'comparison-round14.zh-CN.md').write_text('\n'.join(lines)+'\n')
print(base/'comparison-round14.zh-CN.md')
