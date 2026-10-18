"""Render Round13 after execution, public review seal and frozen scoring."""
import json
from datetime import datetime
from pathlib import Path

here=Path(__file__).resolve().parent
root=here/'runs/2026-10-18-scheduler-contract-round13-final'
load=lambda path:json.loads(path.read_text())
s=load(root/'summary.json');m=load(root/'manifest.json');done=load(root/'finished.json');d=load(root/'diagnostics.json');context=load(root/'context-audit.json');fixture=load(root/'integration-fixture.json')
old=load(Path(m['previousRun'])/m['previousSummaryFile'])
assert done['actors']==54 and done['allPublicReportsReviewedBeforeGrading'] and fixture['paidModelCalls']==0
fmt=lambda value,n=1:'—' if value is None else f'{value:,.{n}f}'
median=lambda group:group['completedTime']['median'] if group['completedTime'] else None
change=lambda value,prior:'—' if prior in [None,0] or value is None else f'{(value/prior-1)*100:+.1f}%'
names={'deepseek':'Pi / DeepSeek Flash · high','glm':'Pi / GLM 5.3 · high','sol':'Codex / GPT-6.1-Sol · xhigh'}
stamp=lambda value:datetime.fromisoformat(value.replace('Z','+00:00'))
duration=(stamp(load(root/'execution-ended.json')['endedAt'])-stamp(load(root/'execution-started.json')['startedAt'])).total_seconds()
lines=['# Round13：阶段契约、Reason 同会话纠错与上下文开销','',
'三模型各三道原题、每题三次、原生与可选 Scheduler+Cairn 两组，共54次。模型／effort为 Pi global:deepseek-v4.1-flash/high、Pi cn:glm-5.3/high、Codex gpt-6.1-sol/xhigh。三lane并行、每模型1活跃CLI，无评测时间、token、调用数或探索轮数预算；保留全部失败，无选择性重跑。','',
'common prompt、TASK、证据、产物合同和独立验收／评分器沿用Round12；本轮改变Cairn阶段契约、Reason协调会话续接与参数纠错、完整／增量上下文。native默认argv不变。仅repair模式Pi增加--no-tools和--exclude-tools=*；Codex依靠明确提示与公开动作零次审计，未声称系统禁用工具。','',
'当前冻结pipeline只作无模型脚本化接入fixture，检查真实调度调用路径、合成会话账本、同会话纠错与验收；它不证明当前provider可用性。未调用新付费探针，旧三个探针仅为历史。','',
'## 主结果','',
'精确对象／层级／资源类别按隐藏注入标签独立评分。workflow完成要求宿主正常终止、产物和答案有效，Cairn另要求唯一任务completed且验收仍有效。有效交付额外要求根因正确、合同和数值通过、输入未变。合格且正确的产物可以出现在workflow未完成的尝试；它们分别列出。','',
'| 模型 | 组 | 根因正确／全部 | workflow完成／全部 | 错误完成／全部 | 错误／已完成 | 有效交付 | 合格且正确产物 | 完成耗时中位s | 全部tokens M |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
for spec in m['models']:
 for arm in ['native','cairn']:
  g=s['groups'][spec['slug']][arm];false_completed=f"{g['falseCompletion']}/{g['completed']}" if g['completed'] else '—（无完成样本）'
  lines.append(f"| {names[spec['slug']]} | {arm} | {g['correct']}/9 | {g['completed']}/9 | {g['falseCompletion']}/9 | {false_completed} | {g['effectiveDelivery']}/9 | {g['validatedCorrectArtifacts']}/9 | {fmt(median(g))} | {fmt(g['recordedTokens']/1e6,3)} |")
lines+=['','| 模型 | 组 | 文件合同 | 数值复算 | 当前已验收Cairn任务 | usage空缺记录 | 用量下界样本 | API错误消息 |','|---|---|---:|---:|---:|---:|---:|---:|']
for spec in m['models']:
 for arm in ['native','cairn']:
  g=s['groups'][spec['slug']][arm];rows=[row for row in s['rows'] if row['model']==spec['slug'] and row['arm']==arm]
  lines.append(f"| {spec['slug']} | {arm} | {g['contractPassed']}/9 | {g['arithmeticPassed']}/9 | {str(g['savedTasksMarkedCompleted'])+'/9' if arm=='cairn' else 'N/A'} | {g['missingUsage']} | {sum(row['usageLowerBound'] for row in rows)} | {g['apiErrors']} |")
lines+=['','usage空缺为0也不代表失败请求实际免费；有零tokens和错误的记录仍可能只是用量下界。Pi总量为input＋output＋cacheRead＋cacheWrite；Codex input已含cached部分，reasoning output不重复添加。累计原生会话账本只计一次，所有phase与失败／纠错成本进入总计。无真实账单，金额未知。API消息包含原生重试，不等于独立失败任务数。','',
'## 与native和Round12主54比较','',
'| 模型 | 本轮Cairn相对native tokens | 完成耗时中位变化 | 正确变化 | workflow完成变化 |','|---|---:|---:|---|---|']
for spec in m['models']:
 a=s['groups'][spec['slug']]['native'];b=s['groups'][spec['slug']]['cairn']
 lines.append(f"| {spec['slug']} | {change(b['recordedTokens'],a['recordedTokens'])} | {change(median(b),median(a))} | {a['correct']}/9→{b['correct']}/9 | {a['completed']}/9→{b['completed']}/9 |")
lines+=['','| 模型 | 组 | Round12→13正确 | workflow完成 | 错误完成 | tokens变化 | 完成耗时中位变化 |','|---|---|---|---|---|---:|---:|']
for spec in m['models']:
 for arm in ['native','cairn']:
  prior=old['groups'][spec['slug']][arm];now=s['groups'][spec['slug']][arm]
  lines.append(f"| {spec['slug']} | {arm} | {prior['correct']}/9→{now['correct']}/9 | {prior['completed']}/9→{now['completed']}/9 | {prior['falseCompletion']}/9→{now['falseCompletion']}/9 | {change(now['recordedTokens'],prior['recordedTokens'])} | {change(median(now),median(prior))} |")
lines+=['','Round12主54基线由恢复批Deep18＋恢复批GLM18＋原始Sol18组成；原始GLM含故障时段的混合cohort未合并。基线GLM18均服务终态，不可把跨轮服务恢复当框架准确率改善。新旧服务时窗和实际推理路径不同，本轮同时修改多个通用机制，不能作单机制因果消融。','',
'## 三次波动与全部成本','',
'| 模型 | 组 | 题 | 正确／完成 | 全部耗时中位[最小–最大]s | tokens中位M | tokens CV | 最大／最小 |','|---|---|---|---:|---:|---:|---:|---:|']
for spec in m['models']:
 for case in ['new-01','new-02','new-03']:
  for arm in ['native','cairn']:
   g=s['perCase'][spec['slug']][case][arm];t=g['time'];u=g['tokens']
   lines.append(f"| {spec['slug']} | {arm} | {case} | {g['correct']}/3；{g['completed']}/3 | {fmt(t['median'])}[{fmt(t['min'])}–{fmt(t['max'])}] | {fmt(u['median']/1e6,3) if u else '—'} | {fmt(u['cv'],3) if u else '—'} | {fmt(u['maxMinRatio'],2) if u else '—'} |")
lines+=['','| 模型 | 组 | 全部平均／中位秒 | 完成平均／中位秒 | 全部tokens中位M | 完成tokens中位M | 每有效交付tokens M | 非缓存输入M | 缓存读取M | 输出M |','|---|---|---:|---:|---:|---:|---:|---:|---:|---:|']
for spec in m['models']:
 for arm in ['native','cairn']:
  g=s['groups'][spec['slug']][arm];completed=g['completedTime'];u=g['completedTokens']
  lines.append(f"| {spec['slug']} | {arm} | {fmt(g['time']['mean'])}／{fmt(g['time']['median'])} | {fmt(completed['mean'])+'／'+fmt(completed['median']) if completed else '—'} | {fmt(g['tokens']['median']/1e6,3) if g['tokens'] else '—'} | {fmt(u['median']/1e6,3) if u else '—'} | {fmt(g['tokensPerEffectiveDelivery']/1e6,3) if g['tokensPerEffectiveDelivery'] is not None else '—'} | {fmt(g['noncachedInputTokens']/1e6,3)} | {fmt(g['cacheReadTokens']/1e6,3)} | {fmt(g['outputTokens']/1e6,3)} |")
lines+=['','CV按样本标准差／均值，只有每题三次，且失败／零记录用量会影响全样本波动；不能由少量重复宣称长期稳定。','',
'## 阶段、上下文与续接','',
'| 模型 | 阶段 | 次数 | 合计宿主秒 | tokens M | 宿主错误阶段 |','|---|---|---:|---:|---:|---:|']
for spec in m['models']:
 for phase,g in s['schedulerPhaseUsage'][spec['slug']].items():lines.append(f"| {spec['slug']} | {phase} | {g['n']} | {fmt(g['seconds'])} | {fmt(g['recordedTokens']/1e6,3)} | {g['errors']} |")
lines+=['','| 模型 | 续接类型 | 请求数 | 同session身份匹配 | 宿主正常结束 | prompt字节 | 合计秒 | tokens M |','|---|---|---:|---:|---:|---:|---:|---:|']
for spec in m['models']:
 for kind,g in context['summary'][spec['slug']].items():
  lines.append(f"| {spec['slug']} | {kind} | {g['requests']} | {g['identityMatched']} | {g['normalEnded']} | {g['promptBytes']} | {fmt(g['seconds'])} | {fmt(g['recordedTokens']/1e6,3)} |")
lines+=['','普通Reason协调会话复用与参数纠错不等于故障恢复。身份匹配只说明续接同一个原生session；正常末条结束也不能代替框架接受、任务完成或正确交付。只有Conclude归为故障收尾，不能把无新证据后的重新分析称作找回已丢事实。prompt字节只衡量发送增量，不等于完整模型上下文或账单tokens。','',
'| 模型+Cairn | Round12阶段prompt字节合计 | Round13合计 | 变化 |','|---|---:|---:|---:|']
for spec in m['models']:
 rows=[row for row in context['rows'] if row['model']==spec['slug'] and row['arm']=='cairn'];before=sum(p['promptBytes'] for row in rows for p in row['baselinePhasePrompts']);after=sum(p['promptBytes'] for row in rows for p in row['phases'])
 lines.append(f"| {spec['slug']} | {before} | {after} | {change(after,before)} |")
lines+=['','## 未完成与报告质量','', '| 模型 | 组 | 公开终态分类 |','|---|---|---|']
for spec in m['models']:
 for arm in ['native','cairn']:
  g=s['groups'][spec['slug']][arm];reasons='；'.join(f'{key}: {value}' for key,value in g['incompleteReasons'].items()) or '无'
  lines.append(f"| {spec['slug']} | {arm} | {reasons} |")
lines+=['','HTTP状态只按公开前缀／结构化字段分类，保留全部原文；协议、schema、checkpoint、产物、服务错误分开。不能凭未完成推断首轮提示有缺陷或上下文丢失。标签正确不证明单位、时序、缺测处理和因果解释都正确；公开报告阅读notes和原生停止／压缩元数据保留以供逐例审阅。','',
'## 审计与限制','',
f"本轮54次墙钟跨度{duration/60:.1f}分钟，记录tokens合计{sum(row['tokens'] or 0 for row in s['rows'])/1e6:.3f}M，无新增付费probe。脚本化fixture共{len(fixture['results'])}项，不计模型成绩／耗时／tokens。所有54次结束且公开报告阅读封存后才隐藏评分；原生审计异常{len(s['nativeCheckFailures'])}项、全局配置变化{len(s['globalConfigChanges'])}项、阶段账目对账候选异常{len(context['accountingDisagreements'])}项，明细不隐藏。",'',
'冻结实现、输入、提示和评分代码均随manifest保存；后续workspace修改若有，须另披露版本边界。Pi没有OS沙箱，公开静态审计不能证明完整隔离，共享/tmp等真实偏差保留。助手编排／开发／报告审阅不计入被测CLI账本。','',
'这三道RCA题已用于多轮开发，存在重复案例与公开训练污染限制；三次重复不是独立新事件。本轮不构成通用能力榜单、长期稳定性保证或阶段调度纯消融。通用性另由领域无关实现和测试边界判断。','']
output=here/'comparison-round13.zh-CN.md';output.write_text('\n'.join(lines));print(output)
