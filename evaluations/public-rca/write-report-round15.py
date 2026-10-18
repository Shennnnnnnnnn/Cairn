"""Presentation only; never changes frozen scoring or source artifacts."""
import json,statistics
from pathlib import Path
base=Path(__file__).resolve().parent;root=base/'runs/2026-10-18-deepseek-original-context-round15'
load=lambda p:json.loads(p.read_text());s=load(root/'summary.json');m=load(root/'manifest.json');c=load(root/'context-audit.json');groups=s['groups']['deepseek']
labels={'native':'原生 Pi','original':'原版 Python Cairn','cairn-fresh':'新版：新会话＋完整图','cairn-reuse':'新版：复用会话＋增量图'}
lines=['# Round15：DeepSeek 原生、原版与新版上下文对照','', '四组均使用 Pi / `sub2api-copy/global:deepseek-v4.1-flash` / high，三道开发题各三次，每组9次，共36次。全局最多四个CLI并发，每组内部一个；不设任务耗时或token预算。实现、输入、运行与评分脚本先冻结；全部结束并完整阅读封存公开报告后评分。','', '新版两组只有协调模式不同：默认 fresh-full 与可选 reuse-delta。原版运行其真实 Python server/dispatcher/任务提示/图/解析/完成接口；私有 HTTP 传输、统一 Pi 进程桥和禁用阶段超时属于公开评测适配，源码未改。详见[运行前协议](protocol-round15.zh-CN.md)和[实现说明](../../docs/optimization-round15.zh-CN.md)。','', '## 主结果','', '| 指标 | '+' | '.join(labels[a] for a in m['arms'])+' |','|---|'+'---:|'*4]
fields=[('根因正确','correct'),('流程完成','completed'),('错误完成（标签错）','falseCompletion'),('完成但无效交付','invalidCompletion'),('统一产物验收通过','acceptancePassed'),('有效正确交付','effectiveDelivery')]
for title,key in fields:lines.append('| '+title+' | '+' | '.join(f"{groups[a][key]}/9" for a in m['arms'])+' |')
for title,key in [('累计 tokens（含缓存）','recordedTokens'),('非缓存输入 tokens','noncachedInputTokens'),('缓存读取 tokens','cacheReadTokens'),('缓存写入 tokens','cacheWriteTokens'),('输出 tokens','outputTokens')]:lines.append('| '+title+' | '+' | '.join(f"{groups[a][key]:,}" for a in m['arms'])+' |')
lines.append('| 用量下界样本 | '+' | '.join(str(sum(r['usageLowerBound'] for r in s['rows'] if r['arm']==a))+'/9' for a in m['arms'])+' |')
for title,key in [('耗时中位数（秒）','median'),('耗时均值（秒）','mean')]:lines.append('| '+title+' | '+' | '.join(f"{groups[a]['time'][key]:.1f}" for a in m['arms'])+' |')
lines.append('| 九次累计执行秒 | '+' | '.join(f"{groups[a]['totalSeconds']:.1f}" for a in m['arms'])+' |')
for title,key in [('整体耗时 CV','time'),('整体 tokens CV','tokens')]:lines.append('| '+title+' | '+' | '.join(f"{groups[a][key]['cv']*100:.1f}%" for a in m['arms'])+' |')
lines+=['', '正确率按冻结标签匹配第一候选对象及资源家族，不代表全文语义正确。完成要求正常宿主停止、三个非空产物和有效答案；原版额外要求project完成，新版额外要求当前task完成及其验收通过。有效交付另要求根因正确、统一验收通过及受保护输入未变。原版没有被注入新版验收门，四组均事后统一重放。','', '缓存读取已包含在输入中，仅统计一次。总tokens下降不直接等于账单下降；无实际账单，金额未知。缺测与错误重试下界单列。','',
 '## 本批结论','',
 '1. 没有观察到标签正确率或流程完成率下降，四组都是9/9；也没有观察到标签准确率提升。新版两种模式及原版验收均9/9，原生Pi为8/9。原生new-01 r3的六项evidence缺少约定的before/after等字段，算术重放仍通过；属于产物合同失配，不是根因答错。',
 '2. 新版默认fresh-full的累计已记录tokens比原生少23.9%、比公开适配的原版少41.9%；非缓存输入分别少35.3%、45.9%。平均耗时比原生低1.0%、比原版低20.3%，但中位耗时比原生高3.2%、比原版低2.2%，不能概括为每题明显加速。memory题中位耗时原生186.6秒，新版完整图259.3秒。',
 '3. 本批fresh-full比reuse-delta少18.5%已记录tokens，耗时中位数低1.2%；多数用量差异发生在尚未进入Reason的Bootstrap，不能归因于完整图优于增量图。完整图组没有真实普通Reason，增量图组仅有一次；不存在足够的同阶段配对比较。',
 '4. fresh-full在每道题的tokens CV都低于本批原生，但CPU题29.3%高于原版17.8%；内存题仍为34.7%。每题仅3次，且涉及连接重试与时间窗差异，只能说本批波动较小，不能宣称长期成本稳定。',
 '5. 默认回到原版的新会话＋完整图，复用＋增量作为显式选项，依据是保留原版探索语义与简单性；本批模型数据尚未证明哪种协调模式更准确或更省。无强制二次审查，不用案例标签驱动框架。','',
 '## 分题与波动','', '| 题目 | 组别 | 正确/完成/错误完成（各3次） | 验收通过 | 耗时中位秒 | tokens中位数 | tokens CV | 耗时 CV |','|---|---|---|---|---:|---:|---:|---:|']
for case in ['new-01','new-02','new-03']:
    for arm in m['arms']:
        g=s['perCase']['deepseek'][case][arm]
        cv=lambda v:f"{v*100:.1f}%" if v is not None else '未知'
        lines.append(f"| {case} | {labels[arm]} | {g['correct']}/{g['completed']}/{g['falseCompletion']} | {g['acceptancePassed']}/3 | {g['time']['median']:.1f} | {g['tokens']['median']:,.0f} | {cv(g['tokens']['cv'])} | {cv(g['time']['cv'])} |")
lines+=['','每题只有三次；CV用于描述本批波动，不保证长期稳定性。三题已反复用于开发，不能证明泛化。','', '## 实际阶段与上下文','', '| 组别 | 阶段/续接类别 | 调用数 | 正常结束 | 秒 | 已知tokens |','|---|---|---:|---:|---:|---:|']
for arm,values in c['groups'].items():
    for kind,g in values.items():lines.append(f"| {labels[arm]} | {kind} | {g['n']} | {g['normalEnded']} | {g['seconds']:.1f} | {g['recordedTokens']:,} |")
lines+=['','ordinary Reason、参数纠错、故障Conclude分别统计。没有触发普通Reason的样本不能证明协调模式效果；零模型闭环只验证接入路径。新会话完整图与复用增量图都不能自动保证事实正确，完整快照可读也不等于已读。','',
 '实际原版9次全部在Bootstrap完成，新版完整图9次也全部Bootstrap完成。增量图new-01 r1首次完成因checks.json引用路径缺少evidence/而被拒；后续普通Reason在同一Pi session中收到增量和验收问题，修复后完成。该次Reason耗时58.71秒，增量用量971,599tokens（其中缓存845,184），已计入actor总量且独立对账，没有重复计算整段会话。它是产物反馈循环，既不是阶段参数自动纠错，也不是崩溃恢复。','',
 '真实运行没有Explore、故障Conclude、阶段参数重试或next列表兼容样本。因此本轮实现的分支、收敛和兼容路径仅有零模型夹具及单元回归证据。原版常用的Bootstrap阶段超时会触发Conclude及后续调度；本轮按用户要求去掉阶段截止时间，也去掉了这个常见切换触发器。不能把本轮原版全Bootstrap解释成原版原本没有探索能力，或声称已比较其默认分段方案。','',
 '## 未完成与错误完成','']
for arm in m['arms']:
    bad=[r for r in s['rows'] if r['arm']==arm and (not r['completed'] or not r['correct'])]
    lines.append(f"- {labels[arm]}："+('无流程未完成或标签错误。' if not bad else '；'.join(f"{r['case']} r{r['repeat']}，完成={r['completed']}、正确={r['correct']}、原因={r['reason']}" for r in bad)))
lines+=['','模型/服务错误与任务推理错误需要结合公开执行记录区分；当前评分不推断模型私有思考或单独证明上下文丢失。','',
 '本轮没有终局服务失败、评测超时或未完成任务。Pi自动重试产生8条Connection error，分布在原生2个、原版3个、增量图2个样本；完整图为0个。所有这些任务最终正常结束，但失败调用可能不返回用量，所以相关账本仍标为下界。它们不是Cairn恢复率。本轮没有注入崩溃/超时，不能给出恢复成功率，也不能依据无未完成样本推断首轮提示词已充分或上下文永不丢失。','',
 '## 正确标签之外的报告问题','',
 '36份报告全部读完后，对可疑断言独立核对冻结CSV；这是定性抽查，不改变冻结评分，也不是全文准确率。核对结果见[正文与原始数据核查](runs/'+m['runId']+'/report-quality-review.json)。','',
 '- 时序：shippingservice-0的fs_usage在0900仍为33.22、0960才升至656.20，1380仍为656.28、1440才回落55.70。原版IO r2把该指标起止提前/延后；增量图IO r2又把回落写到1380。应逐指标保留观测点，不能用一个统一异常桶代替全部KPI。',
 '- 单位：原版CPU r3按Unix秒差分得到23115.05、23310.97，却标注“/分钟”，分母差60倍。增量图报告把未确认采集语义的CPU值称作核、r_await称作秒，证据不足；此处也不擅自改判为毫秒。',
 '- 缺测：原版memory r3、增量图memory r1声称11个服务rr/sr都100%，而adservice-grpc的sr实际70.88–75.46。没有事件同步恶化不等于基线健康。增量图IO r2称node-6同服务副本无异常，但输入中的四个shipping容器全在node-5，没有该对照实体。',
 '- 被排除的疑点也保留：完整图IO r3的UTC换算经标准库复核正确，未把最初怀疑当作缺陷。','',
 '因此当前的主要剩余问题是事实与正文断言的一致性、无预算下的重复分析尾部成本，以及缺少真正需要多轮分支的未见任务证据。可以继续用通用basis/references记录来源、时间窗、分母与覆盖边界，按验收发现的具体缺口触发Reason；不应把这些RCA数值或判定规则写入通用框架。','',
 '## 开销与重复工作的观察','',
 '累计用量74,376,984tokens，包含缓存。原版memory r3最长503.77秒、4,263,048tokens；首次成功write REPORT.md之后仍有142.29秒、15个工具调用和1,958,058tokens（其中缓存1,892,864）。后续工具可能包含必要校验，不能把整段都当作浪费；但说明无预算的长尾不只来自图上下文。原生CPU r3也达到3,811,789tokens、377.14秒。部分报告由bash写入，不能用缺失write工具事件断言没有尾部。详见[公开工具成本路径](runs/'+m['runId']+'/cost-path.json)。','',
 '## 实现与验证','',
 '生产改动只涉及协调策略、阶段输出归一化及CLI导出：fresh-full默认、reuse-delta可选；worker可省略宿主掌握的status/covers；纯文本next列表无损兼容；complete与新intents互斥，写入前校验；Reason按原目标找矛盾/证据缺口且避免重复探索。保持Bootstrap直接完成、独立Explore与原会话纠错，无新增依赖或领域必填字段。','',
 '完整npm run check为366/366，新增7项回归；六个新版pipeline与两个真实原版Python运行时零模型夹具全部通过。夹具覆盖直接完成、Reason→Explore→Reason、参数纠错及产物修复；它们不作为模型正确率或恢复率。','',
 '## 审计与限制','',f"原生模型/身份/用量检查失败：{len(s['nativeCheckFailures'])}；阶段独立增量与唯一session账本检查失败：{len(c['failures'])}。全局配置变化：{s['globalConfigChanges']}。所有新增修改仅涉及通用阶段协议与协调策略，无案例名称或指标判断写入框架。",'',
 '36个actor对应37次真实Pi CLI调用（唯一多阶段样本复用同一session），37个私有凭据目录均删除，未额外运行付费探针。新旧源码、实现快照、评分器、输入、封存报告与全局配置哈希均无漂移，受保护输入未修改。全部运行完成后才读完58个报告分片并封存，再执行隐藏评分。见[收尾审计](runs/'+m['runId']+'/closeout-audit.json)。','',
 '公开路径审计包含1,262项工具参数、334项候选。9个actor曾在/tmp写入自己的临时输出或脚本，违背工作区内写文件的约定；完整图memory r2还尝试cd ..读取checks.json但失败。相同临时文件名的actor完整执行区间未重叠，未观察到读取对方产物、隐藏答案或额外模型CLI。Pi没有OS沙箱，不能宣称完整隔离；这些偏差保留，不重跑或挑选样本。见[路径审阅](runs/'+m['runId']+'/public-scope-review.json)。','',
 '本轮只有同一模型、三道重复开发题各三次；不是独立未见集，不证明通用任务效果、长期稳定性或协调模式因果优势。原版为真实Python逻辑加公开无截止时间适配，不是其默认Docker/阶段超时部署。并发四条lane、轮次旋转仍不能消除服务时变、缓存与抽样差异；提供者内部模型路由也没有独立证明。','',
 '原始证据：[manifest](runs/'+m['runId']+'/manifest.json)、[summary](runs/'+m['runId']+'/summary.json)、[上下文与用量对账](runs/'+m['runId']+'/context-audit.json)、[完整报告阅读封存](runs/'+m['runId']+'/report-reviews.json)。','']
path=base/'comparison-round15.zh-CN.md';assert not path.exists(),'Never overwrite manually reviewed conclusions';path.write_text('\n'.join(lines));print(path)
