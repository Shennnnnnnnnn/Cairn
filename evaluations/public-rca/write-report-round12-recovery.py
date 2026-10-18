"""Render measured round12 tables after the sealed blind grading barrier."""
import json,collections
from pathlib import Path
from datetime import datetime

here=Path(__file__).resolve().parent;root=here/'runs/2026-10-18-scheduler-pi-recovery-round12';original_root=here/'runs/2026-10-18-scheduler-three-model-round12-final'
load=lambda path:json.loads(path.read_text())
s=load(root/'summary.main54.json');m=load(original_root/'manifest.json');done=load(root/'finished.json');d=load(root/'diagnostics.json');all90=load(root/'summary.all90.json')
previous=load(Path(m['previousRun'])/'summary.json');probes=load(root/'probes.json')
assert done['actors']==36 and done['allPublicReportsReviewedBeforeGrading'] and len(s['rows'])==54 and len(load(root/'review/report-reviews.json'))==90
names={'deepseek':'Pi / DeepSeek Flash · high','glm':'Pi / GLM 5.3 · high','sol':'Codex / GPT-6.1-Sol · xhigh'}
fmt=lambda value,n=1:'—' if value is None else f'{value:,.{n}f}'
median=lambda group:group['completedTime']['median'] if group['completedTime'] else None
change=lambda current,old:'—' if old in [None,0] or current is None else f'{(current/old-1)*100:+.1f}%'
stamp=lambda value:datetime.fromisoformat(value.replace('Z','+00:00'))
duration=(max(stamp(load(source/'execution-ended.json')['endedAt']) for source in [root,original_root])-min(stamp(load(source/'execution-started.json')['startedAt']) for source in [root,original_root])).total_seconds()
total_tokens=sum(row['tokens'] or 0 for row in s['rows'])
probe_tokens=sum((row['metrics'].get('usage') or {}).get('input_tokens',0)+(row['metrics'].get('usage') or {}).get('output_tokens',0) for row in probes)
lines=['# Round12：可选薄调度层与三模型复测','',
'本轮实际运行用户最后限定的三个组合：Pi＋global:deepseek-v4.1-flash、Pi＋cn:glm-5.3、Codex＋gpt-6.1-sol。沿用三道公开开发题，每题每模型三次、原生与新版 Cairn 两组，共54次。用户报告Pi服务恢复后，新增完整Pi36次，原54全部保留。主表为新Pi36＋原Sol18，历史Pi36单列，总计90次尝试＋3个原始探针；Sol与付费探针未重跑。新Pi各lane等待同模型旧lane结束后启动，跨批每模型最多一个活跃原生会话，无评测时间、token、调用数或探索轮数预算。', '',
'正式快照为round12-final。三个探针保留原round12快照及全部成本，未付费重跑；仅可信评测runner在正式运行前补齐全局取消传播和停止后续actor，核心src／dist／skills与原探针版逐字节一致。版本边界与原始哈希见probe-origin.json。', '',
'新版 Cairn 在调用模型之前保存唯一通用任务，通过真实 Scheduler 自动执行 Bootstrap／Reason／Explore／Conclude，执行仍由同一原生宿主完成。各模型阶段不加载 Cairn 五工具；持久黑板、分支租约、提交审核、宿主验收和下一阶段调度由可信宿主实现。调度 owner 使用独立 mcp 身份，每个真实模型 session 单独记录。', '',
'## 本轮主结果','',
'准确率按精确对象、层级和资源类别匹配隐藏注入标签。完成要求宿主最终自然结束、约定产物与有效答案；Cairn还要求唯一任务已completed且验收仍有效。错误完成是完成但根因标签错误。有效交付额外要求数值／文件合同通过、输入未改动。根因标签正确不代表报告每句话都正确。', '',
'| 宿主／模型 | 组 | 根因正确 | 完成 | 错误完成／全部 | 错误／已完成 | 有效交付 | 完成耗时中位(s) | 全部记录tokens(M) |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|']
for spec in m['models']:
 for arm in ['native','cairn']:
  g=s['groups'][spec['slug']][arm]
  lines.append(f"| {names[spec['slug']]} | {arm} | {g['correct']}/9 | {g['completed']}/9 | {g['falseCompletion']}/9 | {g['falseCompletion']}/{g['completed']} | {g['effectiveDelivery']}/9 | {fmt(median(g))} | {fmt(g['recordedTokens']/1e6,3)} |")
lines+=['','Cairn的耗时和tokens包含全部调度阶段、失败阶段及收尾／恢复；原生只执行一个会话。完成样本耗时中位数避免将快速服务报错当作速度优势；全部样本耗时和失败成本仍进入下方统计。没有真实账单，金额未知。Pi tokens包含input＋output＋cacheRead＋cacheWrite；Codex input已包含cached部分，推理输出不重复计入。同session恢复按原生累计账本去重。缺失usage不表示免费，错误请求已记录用量可能只是下界。', '',
'| 模型 | 组 | 文件合同通过 | 数值复算通过 | 当前已验收任务 | 验收后宿主失败 | 用量未知 | API错误消息 |',
'|---|---|---:|---:|---:|---:|---:|---:|']
for spec in m['models']:
 for arm in ['native','cairn']:
  g=s['groups'][spec['slug']][arm]
  lines.append(f"| {spec['slug']} | {arm} | {g['contractPassed']}/9 | {g['arithmeticPassed']}/9 | {g['savedTasksMarkedCompleted']}/9 | {g['acceptedTasksButCLIFailed']} | {g['missingUsage']} | {g['apiErrors']} |")
lines+=['','原生组没有Cairn任务，因此其任务状态列为0，不代表未交付。产物验收只检查格式、文件和声明的数值计算，不能代替独立根因语义判断。API错误消息包含原生重试，不能当作独立失败任务数。', '',
'## 与原生宿主以及 round11 对比', '',
'| 模型 | 本轮 Cairn 相对原生tokens | 本轮完成耗时中位变化 | 正确／完成变化 | 错误完成变化 |',
'|---|---:|---:|---|---|']
for spec in m['models']:
 native=s['groups'][spec['slug']]['native'];cairn=s['groups'][spec['slug']]['cairn']
 lines.append(f"| {spec['slug']} | {change(cairn['recordedTokens'],native['recordedTokens'])} | {change(median(cairn),median(native))} | {native['correct']}/9→{cairn['correct']}/9；{native['completed']}/9→{cairn['completed']}/9 | {native['falseCompletion']}/9→{cairn['falseCompletion']}/9 |")
lines+=['','| 模型 | 组 | round11→round12正确 | 完成 | 错误完成 | 记录tokens变化 | 完成耗时中位变化 |',
'|---|---|---|---|---|---:|---:|']
for spec in m['models']:
 for arm in ['native','cairn']:
  old=previous['groups'][spec['slug']][arm];new=s['groups'][spec['slug']][arm]
  lines.append(f"| {spec['slug']} | {arm} | {old['correct']}/9→{new['correct']}/9 | {old['completed']}/9→{new['completed']}/9 | {old['falseCompletion']}/9→{new['falseCompletion']}/9 | {change(new['recordedTokens'],old['recordedTokens'])} | {change(median(new),median(old))} |")
lines+=['','round11的Cairn是模型侧五工具接入，本轮是宿主预提交＋自动调度，比较的是完整集成方案。跨轮的服务状态、并发数、实现版本、阶段提示和任务初始化也变化，不能把全部变化单独归因于调度算法。Pi原生终止判定本轮使用末条assistant stop，原生成功重试仍保留历史错误及下界标记。', '',
'## 历史服务故障 cohort（全部保留）', '', '| 模型 | 组 | 正确／完成／错误完成 | 记录tokens(M) | 与恢复后cohort边界 |', '|---|---|---|---:|---|', *[f"| {model} | {arm} | {g['correct']}/9；{g['completed']}/9；{g['falseCompletion']}/9 | {fmt(g['recordedTokens']/1e6,3)} | 原始Pi36，不混入主表；全部保留并计入总成本 |" for model,arms in all90['historicalPi36']['groups'].items() for arm,g in arms.items()], '', '主表Pi与Sol处于不同时间窗口；新Pi还在原GLM旧队列结束后依次启动，服务状态混杂无法消除。恢复是用户陈述，实际错误与可用性仍按日志报告；不能把从故障批次到恢复后批次的提升归因于框架或基础模型能力。', '', '## 三次重复的波动与成本', '',
'每行只有同一道开发题的三次尝试。CV是样本标准差／均值。失败及零记录用量会影响全样本CV，需结合完成次数、未知用量及summary.json里的完成样本分布解释，不能由低CV直接推断长期稳定。', '',
'| 模型 | 组 | 题 | 正确／完成 | 耗时中位[最小–最大](s) | tokens中位(M) | tokens CV | tokens最大／最小 |',
'|---|---|---|---:|---:|---:|---:|---:|']
for spec in m['models']:
 for case in ['new-01','new-02','new-03']:
  for arm in ['native','cairn']:
   g=s['perCase'][spec['slug']][case][arm];t=g['time'];u=g['tokens']
   lines.append(f"| {spec['slug']} | {arm} | {case} | {g['correct']}/3；{g['completed']}/3 | {fmt(t['median'])}[{fmt(t['min'])}–{fmt(t['max'])}] | {fmt(u['median']/1e6,3) if u else '—'} | {fmt(u['cv'],3) if u else '—'} | {fmt(u['maxMinRatio'],2) if u else '—'} |")
lines+=['','| 模型 | 组 | 全尝试平均秒 | 全尝试中位秒 | 每有效交付秒 | 每有效交付tokens(M) | 非缓存输入(M) | 缓存读取(M) | 输出(M) |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|']
for spec in m['models']:
 for arm in ['native','cairn']:
  g=s['groups'][spec['slug']][arm]
  lines.append(f"| {spec['slug']} | {arm} | {fmt(g['time']['mean'])} | {fmt(g['time']['median'])} | {fmt(g['secondsPerEffectiveDelivery'])} | {fmt(g['tokensPerEffectiveDelivery']/1e6,3) if g['tokensPerEffectiveDelivery'] is not None else '—'} | {fmt(g['noncachedInputTokens']/1e6,3)} | {fmt(g['cacheReadTokens']/1e6,3)} | {fmt(g['outputTokens']/1e6,3)} |")
lines+=['','## 自动调度的实际使用与额外开销', '',
'| 模型 | 阶段 | 实际执行次数 | 合计宿主秒 | 记录tokens(M) | 终止错误阶段 |',
'|---|---|---:|---:|---:|---:|']
for spec in m['models']:
 for phase,g in s['schedulerPhaseUsage'][spec['slug']].items():
  lines.append(f"| {spec['slug']} | {phase} | {g['n']} | {fmt(g['seconds'])} | {fmt(g['recordedTokens']/1e6,3)} | {g['errors']} |")
lines+=['','| 模型+Cairn | 黑板事实合计 | 交接记录合计 | Explore分支执行 | 同session收尾请求／身份匹配 |',
'|---|---:|---:|---:|---:|']
for spec in m['models']:
 rows=[row for row in s['rows'] if row['model']==spec['slug'] and row['arm']=='cairn']
 attempts=sum((row.get('recovery') or {}).get('attempted',0) for row in rows);resumes=sum((row.get('recovery') or {}).get('nativeSessionResumes',0) for row in rows)
 lines.append(f"| {spec['slug']} | {sum(row['blackboard']['savedFindings'] for row in rows)} | {sum(row['blackboard']['handoffs'] for row in rows)} | {s['schedulerPhaseUsage'][spec['slug']]['explore']['n']} | {attempts}/{resumes} |")
lines+=['','Bootstrap允许直接解决目标，直接完成的尝试无需强制执行Reason／Explore。分支新发现先作为提案保存，Reason审核后才能提升为主事实和验收覆盖。每次scheduler.trace.jsonl、scheduler.events.json与phases目录保留真实调度及宿主调用证据。正常多阶段交接不等于故障恢复；身份匹配仅说明CLI续接同session，不称为恢复成功；另见recovery-outcomes.json的收尾正常结束、workflow完成与正确有效交付。收尾阶段若在前阶段没有有效输出后重新分析，不能称找回先前事实。没有主动故障注入，不能报告普适故障恢复率。', '',
'## 未完成的直接原因', '', '| 模型 | 组 | 公开证据分类 |', '|---|---|---|']
for spec in m['models']:
 for arm in ['native','cairn']:
  g=s['groups'][spec['slug']][arm];reasons='；'.join(f'{key}: {value}' for key,value in g['incompleteReasons'].items()) or '无'
  lines.append(f"| {spec['slug']} | {arm} | {reasons} |")
compacted=[row['id'] for row in s['rows'] if row['compactions']]
lines+=['',f"原生记录出现压缩／截断事件的尝试：{len(compacted)}/54。累计tokens不是单次上下文长度；事件存在不等于信息丢失，事件缺失也不能证明模型使用了全部信息。直接终止、工具／JSON协议错误、调度无进展、交付缺失和验收拒绝分别记录；不能凭未完成倒推提示词不完善或上下文丢失。具体逐例公开错误、最后工具、阶段和验收问题见diagnostics.json。", '',
'## 审计、范围与复现', '',
f"原54＋新Pi36全部90次墙钟跨度{duration/60:.1f}分钟；主54已记录tokens为{total_tokens/1e6:.3f}M，全90尝试共{all90['totalRecordedTokens']/1e6:.3f}M，三个原始独立合成探针另计{probe_tokens/1e6:.3f}M。cohort等待旧lane的时间不算单题actor耗时。本助手开发、编排与报告审阅的用量不包含在被测CLI账本中。全部公开报告审阅封存后才运行隐藏评分。原生日志审计异常{len(s['nativeCheckFailures'])}项，全局配置变化{len(s['globalConfigChanges'])}项；明细保留，未隐藏异常。", '',
'- 冻结协议、实现、manifest、全部原生会话、阶段与交付物：`runs/2026-10-18-scheduler-pi-recovery-round12/`与原`runs/2026-10-18-scheduler-three-model-round12-final/`。',
'- `progress-round12-recovery.py`只查看公开进度，不运行隐藏评分。',
'- `assess-round12-recovery.mjs`用冻结引擎只读核对任务验收；`check-components-round12-recovery.mjs`统一重放产物／数值合同，不替换原结果。',
'- `analyze-round12-recovery.py`在全批结束和报告阅读封存后统一评分；`diagnostics-round12-recovery.py`与`scope-round12-recovery.py`只整理公开事件、错误与命令路径。', '',
'这三题已经用于开发，存在公开训练数据污染和案例重复的限制；三次重复不是三道新题。框架核心没有针对题目对象、服务名、时间窗或根因标签分支。通用性由独立领域无关调度测试验证，不将这54次RCA测试外推为任意领域成功率。客户端模型ID无法证明网关内部路由；Pi没有OS沙箱，路径约束和静态命令审阅不能替代系统隔离证明。没有首轮提示或调度算法独立消融，不声称因果贡献比例。', '']
(here/'comparison-round12.zh-CN.md').write_text('\n'.join(lines))
print(here/'comparison-round12.zh-CN.md')
