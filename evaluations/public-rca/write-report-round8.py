"""Render only after global review/grading barrier; no model calls."""
import json
from pathlib import Path
from datetime import datetime
H=Path(__file__).resolve().parent;R=H/'runs/2026-10-17-codex-sol-xhigh-round8-repeated';O=H/'runs/2026-10-17-codex-sol-xhigh-repeated'
load=lambda p:json.loads(p.read_text())
s=load(R/'summary.json');old=load(O/'summary.json');supp=load(R/'public-metadata-supplement.json');manifest=load(R/'manifest.json');reviews=load(R/'qualitative-audit.json');scope=load(R/'public-scope.review.json');cleanup=load(R/'cleanup.json')
assert s['audit']['passed']==s['audit']['total'] and cleanup['allPrivateHomesRemoved'] and cleanup['globalConfigurationsUnchanged']
g=s['groups'];og=old['groups'];C=g['cairn'];N=g['codex'];B=og['cairn']
f=lambda v:'未知' if v is None else f'{v:,.0f}'
pct=lambda v:'未知' if v is None else f'{v*100:.1f}%'
def delta(a,b):return '未知' if a is None or not b else f'{(a/b-1)*100:+.1f}%'
def rate(x,k):return f"{x[k]}/{x['n']}"
def dist(d):return f"{f(d['median'])} [{f(d['min'])}–{f(d['max'])}]；CV {pct(d['cv'])}"
wall=(datetime.fromisoformat(load(R/'execution-ended.json')['endedAt'].replace('Z','+00:00'))-datetime.fromisoformat(load(R/'execution-started.json')['startedAt'].replace('Z','+00:00'))).total_seconds()/60
lines=['# 第八轮同题重复对照：Codex Sol 极高与优化后的 Cairn','',f"同三题开发集，GPT-6.1-Sol / xhigh，{manifest['cliVersion']}。原生/新版各9个全新会话，每题每组3次，最多3并发，无评测预算。正式墙钟 {wall:.2f} 分钟；18次全部结束、完整公开报告审阅封存后，才统一隐藏标签评分。",'', '## 结果','', '| 配置 | 正确：对象＋族＋层级 | 完成 | 契约＋复算 | 有效交付 | 错误完成／全部 | 无效完成／全部 | 记录tokens | 每次有效交付tokens |','| --- | --- | --- | --- | --- | --- | --- | ---: | ---: |']
for title,x in [('上一轮原生（封存参考）',og['codex']),('上一轮Cairn（修改前）',B),('本轮原生Codex',N),('本轮新版Cairn',C)]:
 lines.append('| '+' | '.join([title,rate(x,'labelCorrect'),rate(x,'completed'),rate(x,'replayPassed'),rate(x,'correctDelivery'),rate(x,'falseCompletion'),rate(x,'invalidCompletion'),f(x['totalTokens']),f(x['recordedTokensPerCorrectDelivery'])])+' |')
lines+=['', '| 配置 | 对象命中 | 资源族命中 | 层级命中 |', '| --- | --- | --- | --- |']
for title,source,arm in [('旧Cairn',old,'cairn'),('本轮原生',s,'codex'),('本轮新版Cairn',s,'cairn')]:
 subset=[r for r in source['rows'] if r['arm']==arm]
 lines.append('| '+title+' | '+' | '.join(f"{sum(bool(r['grade'][k]) for r in subset)}/{len(subset)}" for k in ['top1Entity','top1Family','top1Level'])+' |')
lines+=['',f"本轮新版相对本轮原生：总记录tokens {delta(C['totalTokens'],N['totalTokens'])}，CLI时间求和 {delta(C['totalSeconds'],N['totalSeconds'])}，每次有效交付tokens {delta(C['recordedTokensPerCorrectDelivery'],N['recordedTokensPerCorrectDelivery'])}。相对封存旧Cairn：正确 {B['labelCorrect']}→{C['labelCorrect']}，有效交付 {B['correctDelivery']}→{C['correctDelivery']}，错误完成 {B['falseCompletion']}→{C['falseCompletion']}；总tokens {delta(C['totalTokens'],B['totalTokens'])}。这些是三题开发集的随机会话观测，不能把前后差异全部归因于某项修改。",'', '完成与正确性分开计量。原生完成要求自然结束、三文件非空和有效候选；Cairn另外要求真实owner唯一任务completed、报告有效、宿主验收proof当前。有效交付再要求格式/复算通过、标签联合命中和输入完整。错误完成=已完成但标签错；无效完成还包括格式或复算不通过。错误／已完成分母为本轮各组实际完成数，不以减少完成掩盖错误。', '',f"本轮错误／已完成：原生 {N['falseCompletion']}/{N['completed']}，Cairn {C['falseCompletion']}/{C['completed']}。格式通过：原生 {N['contractPassed']}/9，Cairn {C['contractPassed']}/9；算术通过：原生 {N['arithmeticPassed']}/9，Cairn {C['arithmeticPassed']}/9。",'', '## 成本与波动','', '| 配置 | 时间秒：中位 [范围]；CV | tokens：中位 [范围]；CV | 非缓存输入 | 缓存输入 | 输出 | 每次有效交付：非缓存输入＋输出 |','| --- | --- | --- | ---: | ---: | ---: | ---: |']
for title,x in [('旧Cairn',B),('本轮原生',N),('本轮新版Cairn',C)]:lines.append(f"| {title} | {dist(x['time'])} | {dist(x['tokens'])} | {f(x['noncachedInputTokens'])} | {f(x['cachedInputTokens'])} | {f(x['outputTokens'])} | {f(x['noncachedInputAndOutputPerCorrectDelivery'])} |")
lines+=['', '记录tokens=input_tokens+output_tokens；输入已含缓存，输出已含推理，不重复累加。全部尝试计入分子，未知usage保留未知/下界。它是流量指标，不是订阅账单或美元成本。并行单次时间求和不等于用户等待墙钟。', '', '| 题目 | 配置 | 正确／3 | 有效交付／3 | 时间秒CV | tokens CV | tokens最大／最小 | 波动标记 |','| --- | --- | --- | --- | ---: | ---: | ---: | --- |']
for case in manifest['caseList']:
 for title,x in [('旧Cairn',old['perCase'][case]['cairn']),('本轮原生',s['perCase'][case]['codex']),('本轮新版Cairn',s['perCase'][case]['cairn'])]:
  ratio=x['tokens']['maxMinRatio'];lines.append(f"| {case} | {title} | {x['labelCorrect']}/3 | {x['correctDelivery']}/3 | {pct(x['time']['cv'])} | {pct(x['tokens']['cv'])} | {ratio:.3f} | {'是' if x['tokens']['variable'] or x['time']['variable'] else '否'} |" if ratio is not None else f'| {case} | {title} | 数据不足 |')
lines+=['',f"同(case,repeat)匹配有效交付：{s['pairedOutcomes']}。重复会话没有相同随机种子，不是确定性成对干预。CV>0.25或max/min>2只是本样本描述标记；即使未触发，也不能认定长期稳定。只有3个独立事件，同题3次相关；原难度代理不等同独立验证的高难度。", '', '## 三处问题是否改善','', '| 公开MCP指标 | 旧Cairn | 新Cairn |','| --- | ---: | ---: |']
a=supp['baseline']['groups']['cairn'];b=supp['current']['groups']['cairn']
for key,label in [('checkpointCalls','checkpoint调用'),('checkpointFailures','checkpoint失败'),('stringFindingElements','字符串形式finding元素'),('blankOptionalNexts','空可选next'),('acceptedCompatibilityCalls','被兼容且成功的调用'),('publicMcpTextBytes','MCP公开文本字节'),('checkpointTextBytes','checkpoint公开文本字节')]:lines.append(f"| {label} | {f(a[key])} | {f(b[key])} |")
lines+=['',f"invalid_model_input：旧 {B['invalidModelInputs']}→新 {C['invalidModelInputs']}；全部标准工具错误：旧 {B['toolErrors']}→新 {C['toolErrors']}，本轮原生 {N['toolErrors']}。公开响应字节不是tokens：真实调用次数、请求内容及上下文前缀复用都可能变化。", '', f"本轮有 {b['acceptedCompatibilityCalls']} 次字符串finding兼容调用直接成功，剩余 {b['checkpointFailures']} 次拒绝均为artifacts对象数组被编码为字符串（一次还包含字符串handoff）。此兼容尚未覆盖，未宣称参数重试清零。", '', '参数层只解码单层合法finding JSON对象、空白可选next按省略处理，随后仍严格校验；不会把文本补成事实、添加coverage或刷新旧文件证据。收据精简仅作用于模型确认，SDK和显式恢复保留完整内容。范围审视要求比较原目标、结论主体/范围、最强替代解释和区别性证据；没有对象/资源/层级优先规则。', '', '固定通用请求的独立字节测量：','', '| 项目 | 修改前 | 修改后 | 变化 |','| --- | ---: | ---: | ---: |']
fx=supp['fixedGenericRequests']
for key,label in [('catalogBytes','工具catalog'),('skillBytes','skill'),('firstDeltaBytes','首次6事实收据'),('revisionBytes','单项修订收据'),('idempotentRetryBytes','相同重试收据'),('reminderBytes','长探索提醒'),('recoveryBytes','显式恢复')]:lines.append(f"| {label} | {f(fx['before'][key])} | {f(fx['after'][key])} | {delta(fx['after'][key],fx['before'][key])} |")
lines+=['', '完整恢复仍保留6事实、refuted排除项、原问题和下一步。恢复文字略增加，因为包含新的通用范围审视。未用删减恢复事实换取响应变小。', '', '## 逐次结果','', '| 会话 | 联合正确 | 完成 | 有效交付 | 契约 | 算术 | tokens | 秒 |','| --- | --- | --- | --- | --- | --- | ---: | ---: |']
for r in s['rows']:lines.append(f"| [{r['id']}](runs/{R.name}/{r['id']}/initial.REPORT.md) | {r['labelCorrect']} | {r['completed']} | {r['correctDelivery']} | {r['contractPassed']} | {r['arithmeticPassed']} | {f(r['tokens'])} | {r['wallSeconds']:.1f} |")
lines+=['', '所有模型公开报告的定性审阅记录在运行目录qualitative-audit.json，先于隐藏评分封存。下列问题来自正式全部尝试，未选择性重跑：','']
for r in s['rows']:
 if not r['correctDelivery']:
  preds=r['grade'].get('predictions',[]);loc={k:preds[0].get(k) for k in ['location','level','fault_family','confidence']} if preds else None
  lines.append(f"- **{r['id']}**：联合正确={r['labelCorrect']}，完成={r['completed']}，格式={r['contractPassed']}，算术={r['arithmeticPassed']}；top1={json.dumps(loc,ensure_ascii=False)}。")
for r in s['rows']:
 if not r['contractPassed']:
  answerPath=R/r['id']/'initial.answer.json'
  try:
   ev=load(answerPath).get('evidence',[])
   kinds={key:sorted(set(type(e.get(key)).__name__ for e in ev)) for key in ['before','after']}
   lines.append(f"  格式诊断：evidence的before/after实际类型为{kinds}，v2契约要求非空描述字符串；正文与复算正确不能代替序列化契约。")
  except (OSError,ValueError,TypeError):pass
if all(r['correctDelivery'] for r in s['rows']):lines.append('- 本轮未出现无效交付；三题九次不能证明不存在层级漂移或其他语义错误。')
issues=[(r['id'],r.get('materialNarrativeIssues',[]),r.get('minorNarrativeIssues',[])) for r in reviews['results'] if r.get('materialNarrativeIssues') or r.get('minorNarrativeIssues')]
lines+=['', '公开报告叙述核对：','']
if not issues:lines+=['未记录足以推翻主要论证的额外叙述问题；人工审阅没有穷尽正文全部数字。']
for name,major,minor in issues:lines.append(f"- {name}：重要问题={json.dumps(major,ensure_ascii=False)}；次要问题={json.dumps(minor,ensure_ascii=False)}。")
lines+=['', '## 判断', '', '本轮改善的是协议摩擦与重复上下文：对象和层级从旧版8/9提高到9/9，但资源族从9/9变成8/9，联合正确、完成、错误完成和有效交付均未优于旧Cairn。服务内存压力与同服务I/O起因的比较仍会漏项；层级自审不能替代机制判断。', '', f"Cairn记录tokens相对旧版 {delta(C['totalTokens'],B['totalTokens'])}，非缓存输入＋输出 {delta(C['noncachedInputTokens']+C['outputTokens'],B['noncachedInputTokens']+B['outputTokens'])}，CLI耗时求和 {delta(C['totalSeconds'],B['totalSeconds'])}。相对本轮原生，非缓存输入＋输出每有效交付仍 {delta(C['noncachedInputAndOutputPerCorrectDelivery'],N['noncachedInputAndOutputPerCorrectDelivery'])}；没有实际账单，不能把记录tokens下降直接当作费用下降。", '', '三题各三次没有证明长期稳定或正确率提升。保留本轮传输与收据优化有依据；若目标是更高排障正确率，仍需让对象范围与故障机制分别比较，并覆盖遗漏的替代解释。artifacts/handoffs等对象数组的通用规范化尚是明确剩余项。']
lines+=['', '## 恢复、验收与边界','',f"未注入预算、超时或强制中断，也没有实际恢复尝试，恢复效果为N/A。267/267测试与真实接入探针只证明被覆盖路径；探针消耗 {f(manifest['probe']['tokens'])} tokens，另列。",'',f"冻结审计 {s['audit']['passed']}/{s['audit']['total']}；公开范围扫描 {scope['actors']}个会话、{scope['tools']}项标准工具记录、{scope['fileChangeEvents']}项文件事件。确认范围违规 {scope['confirmedScopeViolations']}，临时目录惯例偏差 {scope['temporaryConventionDeviations']}，未能证实的临时文件可能性 {scope['unresolvedTemporaryPossibilities']}。静态记录不能证明所有脚本内部或操作系统级隔离；完整决定保留在public-scope.review.json。凭据副本已清理，全局配置哈希未变。没有新UI验证。",'', '输入和原生提示、v2契约、独立复算器、驱动、标签政策及调度与上一轮逐项字节一致；仅Cairn冻结版本变化。公开同日同testbed、3个事件和先前开发观察限制外推，也不能排除训练污染。宿主契约/数值验收不是根因真值；模型/effort来自客户端元数据，不是独立服务端证明。', '', '## 复核入口','',f"- [原始矩阵、冻结实现与summary](runs/{R.name}/summary.json)",f"- [公开报告预评分审阅](runs/{R.name}/qualitative-audit.json)",f"- [公开MCP与固定请求测量](runs/{R.name}/public-metadata-supplement.json)",f"- [修改前后可比性核对](runs/{R.name}/implementation-review.json)",'- [预登记](protocol-round8.zh-CN.md)','- [验收清单](acceptance-round8.zh-CN.md)','- [实现说明](../../docs/optimization-round8.zh-CN.md)','- [上一轮封存报告](comparison-codex-repeated.zh-CN.md)','']
(H/'comparison-round8.zh-CN.md').write_text('\n'.join(lines))
print(json.dumps(dict(report=str(H/'comparison-round8.zh-CN.md'),wallMinutes=wall,currentGroups=g,baselineCairn=B),ensure_ascii=False))
