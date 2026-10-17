"""Render actual sealed outcomes; no hardcoded performance conclusion."""
import json,collections
from pathlib import Path
H=Path(__file__).resolve().parent;R=H/'runs/2026-10-18-pi-deepseek-round10-repeated'
load=lambda p:json.loads(p.read_text());s=load(R/'summary.json');q=load(R/'stability-quality.json');p=load(R/'public-metadata-supplement.json');io=load(R/'io-cost-diagnostics.json');m=load(R/'manifest.json');a=load(R/'auxiliary-checks.json');native=load(R/'native-ledger-audit.json');runtime=load(R/'runtime-final-check.json');cleanup=load(R/'cleanup.json');reviews=load(R/'qualitative-audit.json');probe=load(R/'probe-attempts.json');tests=load(R/'tests.json')
g=s['groups'];n=g['pi'];c=g['cairn'];old=q['priorAllAttemptGroups']['cairn']
f=lambda x:'N/A' if x is None else f'{x:,.0f}'
def pct(x):return 'N/A' if x is None else f'{100*x:.1f}%'
def ratio(v,b):return 'N/A' if v is None or not b else f'{100*(v/b-1):+.1f}%'
def count(k):return f'| {k[0]} | {n[k[1]]}/9 | {c[k[1]]}/9 |'
def dist(v):return f"{f(v['median'])} [{f(v['min'])}, {f(v['max'])}]；CV={v['cv']:.2f}"
rows=['# 第十轮：事实复用与报告语义的同模型对照','','2026-10-18，Pi / global:deepseek-v4.1-flash / high；同三道开发题×每题三次×两组，共18次新会话，最多3并发、无评测预算。所有失败保留，未选择性重跑；全局完成并完整阅读公开报告后才隐藏评分。','',
'## 主要结果','','| 指标 | 原生 Pi | Pi+Cairn |','|---|---:|---:|']
lead=(f"本轮功能改动已落地，但没有验证到成本更稳定或报告语义问题得到解决。原生 Pi / Cairn 的联合标签正确为 {n['labelCorrect']}/9 / {c['labelCorrect']}/9，完成与有效交付为 {n['correctDelivery']}/9 / {c['correctDelivery']}/9；错误完成（仅按根因标签）均为0。Cairn有一份正确答案缺最终报告，不能算完成。实际有格式有效答案时分别3/3、8/8正确，不支持推理准确率提升的结论。"
      f" Cairn每次有效交付 recorded tokens 相对原生{ratio(c['recordedTokensPerCorrectDelivery'],n['recordedTokensPerCorrectDelivery'])}，相对历史Cairn{ratio(c['recordedTokensPerCorrectDelivery'],old['recordedTokensPerCorrectDelivery'])}，但I/O三次均成功仍相差2.78倍；三题tokens均触发预登记波动标记，历史为2/3题。7份Cairn报告有5份确认至少一类时序/单位/缺测问题，原生为2/3份；缺报告不计质量通过。188条连接/流错误、8次终态失败和小样本限制比较，不能把均值下降当作稳定性或本轮改动的因果收益。")
rows.insert(2,lead+'\n')
for label,key in [('联合标签正确（对象/资源/层级）','labelCorrect'),('任务完成','completed'),('有效正确交付','correctDelivery'),('错误完成（完成但标签错）','falseCompletion'),('无效完成（完成但未有效交付）','invalidCompletion'),('产物契约通过','contractPassed'),('所选定量证据复算通过','arithmeticPassed')]:rows.append(count((label,key)))
valid={arm:sum(bool(r['grade']['validAnswer']) for r in s['rows'] if r['arm']==arm) for arm in ['pi','cairn']}
rows.append(f"| 可用且格式有效的答案 | {valid['pi']}/9 | {valid['cairn']}/9 |")
rows.append(f"| 可用答案中的联合正确率（条件指标） | {pct(n['labelCorrect']/valid['pi'] if valid['pi'] else None)} | {pct(c['labelCorrect']/valid['cairn'] if valid['cairn'] else None)} |")
rows+=['',f"本轮 Cairn 相对原生：全部 recorded tokens {ratio(c['totalTokens'],n['totalTokens'])}，每次有效交付 recorded tokens {ratio(c['recordedTokensPerCorrectDelivery'],n['recordedTokensPerCorrectDelivery'])}。错误完成以所有9次为分母；完成后条件错误率原生 {pct(n['falseAmongCompleted'])}、Cairn {pct(c['falseAmongCompleted'])}。标签正确、任务完成和全报告质量不是同一个指标。",'',
'## 成本与波动','','| 全部尝试 | 原生 Pi | Pi+Cairn |','|---|---:|---:|']
for label,key in [('recorded tokens（含缓存）','totalTokens'),('非缓存输入','noncachedInputTokens'),('缓存读取','cachedInputTokens'),('输出（含reasoning，不重复加）','outputTokens'),('tokens/有效交付','recordedTokensPerCorrectDelivery'),('非缓存输入+输出/有效交付','noncachedInputAndOutputPerCorrectDelivery'),('累计CLI秒','totalSeconds'),('CLI秒/有效交付','recordedSecondsPerCorrectDelivery'),('公开工具调用','toolCalls')]:rows.append(f'| {label} | {f(n[key])} | {f(c[key])} |')
rows+=['','逐题同组三次的 tokens 中位数 [最小,最大] 与样本CV；失败也计入，不只选成功样本。CV>0.25或max/min>2标记波动。','', '| 题 | 原生 Pi | 新版 Cairn | 历史 round9 Cairn |','|---|---|---|---|']
for case in m['caseList']:rows.append(f"| {case} | {dist(q['currentPerCase'][case]['pi']['tokens'])} | {dist(q['currentPerCase'][case]['cairn']['tokens'])} | {dist(q['previousPerCase'][case]['cairn']['tokens'])} |")
rows+=['','| 题 | 原生非缓存+输出 CV | Cairn非缓存+输出 CV | 原生耗时 CV | Cairn耗时 CV |','|---|---:|---:|---:|---:|']
for case in m['caseList']:
 z=q['currentPerCase'][case];rows.append('| '+case+' | '+' | '.join(f"{v:.2f}" for v in [z['pi']['noncachedPlusOutput']['cv'],z['cairn']['noncachedPlusOutput']['cv'],z['pi']['seconds']['cv'],z['cairn']['seconds']['cv']])+' |')
rows+=['','| 题 | 原生完成/有效交付 | Cairn完成/有效交付 |','|---|---:|---:|']
for case in m['caseList']:
 z=s['perCase'][case];rows.append(f"| {case} | {z['pi']['completed']}/3；{z['pi']['correctDelivery']}/3 | {z['cairn']['completed']}/3；{z['cairn']['correctDelivery']}/3 |")
flags=lambda source,arm,key:sum(q[source][case][arm][key]['variable'] for case in m['caseList'])
rows+=['',f"新版 Cairn 的 tokens 波动标记 {flags('currentPerCase','cairn','tokens')}/3题，非缓存输入+输出 {flags('currentPerCase','cairn','noncachedPlusOutput')}/3题，耗时 {flags('currentPerCase','cairn','seconds')}/3题。历史 round9 Cairn 对应 {flags('previousPerCase','cairn','tokens')}/3、{flags('previousPerCase','cairn','noncachedPlusOutput')}/3、{flags('previousPerCase','cairn','seconds')}/3。",f"相对历史 round9 Cairn：全部 recorded tokens {ratio(c['totalTokens'],old['totalTokens'])}，每有效交付 tokens {ratio(c['recordedTokensPerCorrectDelivery'],old['recordedTokensPerCorrectDelivery'])}，非缓存输入+输出/有效交付 {ratio(c['noncachedInputAndOutputPerCorrectDelivery'],old['noncachedInputAndOutputPerCorrectDelivery'])}。历史不是本轮随机化旧版本对照，不能隔离代码收益。",'',
'有连接错误的调用可能不返回完整usage，用量为记录下界；实际价格和账单未知，配置cost=0不等于免费。两次接入探针全部66,423 recorded tokens另计，不进入正式两组成本。缓存变化使总tokens不直接等于费用变化。只有三种事件，重复样本相关，不能证明长期稳定。','',
'## 报告语义（相同标准，独立于标签）','','| 人工全报告审查 | 原生 Pi | Pi+Cairn |','|---|---:|---:|']
for label,key in [('可用最终报告','reportsAvailable'),('三维均未确认问题','noConfirmedIssuesAllThree'),('至少一维有确认问题','anyConfirmedIssue'),('无报告，不能判为质量通过','unavailable')]:rows.append(f"| {label} | {q['groups']['pi'][key]} | {q['groups']['cairn'][key]} |")
for dim,label in [('time','时序问题'),('units','单位问题'),('missing','缺测/覆盖问题')]:rows.append(f"| {label} | {q['groups']['pi']['confirmedIssues'][dim]} | {q['groups']['cairn']['confirmedIssues'][dim]} |")
rows+=['','每份可同时涉及多维；“未确认问题”不等于全报告正确。只有选中的checks数值通过，也不能排除辅助文字错写、无依据单位或把缺测视为正常。逐份证据如下：','']
for r in reviews['results']:
 issues=[dim+'：'+v['evidence'] for dim,v in r['semantics'].items() if v['status']=='confirmed_issue']
 if issues:rows.append('- `'+r['id']+'`：'+'；'.join(issues))
rows+=['','完整审查含未确认问题和缺报告记录，见 [qualitative-audit.json]('+str(R.relative_to(H))+'/qualitative-audit.json)。审查非盲测，已知公共案例与历史结论；未更改隐藏标签政策。','',
'## 服务错误、恢复与开销来源','','| 项目 | 原生 Pi | Pi+Cairn |','|---|---:|---:|']
for label,key in [('API/stream错误消息','providerErrorMessages'),('终态失败','terminalFailures'),('出现错误后同会话自然结束','providerRecoveredEpisodes'),('Cairn工具错误','cairnToolErrors'),('原生工具错误','nativeToolErrors')]:rows.append(f'| {label} | {n[key]} | {c[key]} |')
rows+=['','本轮记录188条API/stream错误：187条Connection error和1条Request timed out。Cairn既有的有界停止反馈在4个会话的连接错误终态之后触发同会话继续，其中3个随后完成有效交付、1个仍失败；不是本轮新增机制，也没有旧版同轮对照可隔离其收益。表内“出现错误后同会话自然结束”还包括原生自动重试，不能全称为纯连接重试。本轮未做强制中断、接管或新owner恢复，跨会话handoff恢复 N/A。全部失败保留。','', '| 公开工具I/O诊断 | 原生 Pi | Pi+Cairn |','|---|---:|---:|']
for label,key in [('原生工具输入字节','nativeInputBytes'),('原生工具输出字节','nativeOutputBytes'),('Cairn输入字节','cairnInputBytes'),('Cairn输出字节','cairnOutputBytes'),('输入和结果完全相同的重复调用','identicalInputResultRepeats')]:rows.append(f"| {label} | {f(io['current']['groups']['pi'][key])} | {f(io['current']['groups']['cairn'][key])} |")
rows+=['',f"Cairn定向事实读取实际调用：{io['current']['groups']['cairn']['cairnReads'].get('focusedEvidence',0)}。若为0，真实评测不能证明该分支带来收益，结构性正确性来自回归测试。字节不是tokens，重复调用可能是必要复验。静态工具说明增加324字节、skill增加1684字节；普通增量回执大小不变。",'',
'## 实现、完整性和限制','',
'本轮只改工具的定向事实读取、最近修订议程和通用技能指导：沿用已有basis/references/from/questions/next，无新增模型侧字段、模型工作者或硬预算。引用current只说明绑定文件版本未变，不说明因果正确；读不会刷新旧事实。时间、单位和缺测由模型按通用证据规则处理，尚无任意自由报告的自动语义验证器。',
f"冻结完整测试 {tests['passed']}/{tests['total']}，保留并发用量统计改动后的当前工作区291/291；冻结/记录检查 {s['audit']['passed']}/{s['audit']['total']}；独立原生记录 {native['passed']}/{native['checks']}；额外核对 {a['passed']}/{a['total']}；冻结运行时 {runtime['files']}文件均未变；当前7个生成包仅嵌入usage:sync元数据不同（原字节一致性结果仍为False，未改成通过）。{cleanup['copies']}份独立配置副本全部删除={cleanup['allRemoved']}，Pi 两份配置未变；Codex 配置在期间发生未知来源的哈希变化，原审计和额外核对均保留这一失败项，未改写为通过。",f"两次合成接入探针一败一成功，全部成本单列 {f(probe['recordedTokensAllAttempts'])} recorded tokens；正式统计只有18次。当前运行器/驱动也新增了并发用量同步钩子，已保留；正式18次使用的冻结副本不含这项后续改动，详见concurrent-work-observation.json。Pi无OS沙箱，独立目录、配置、DB和tmp加指令约束不是访问隔离证明，公开路径检查保留两个例外：Cairn 一次在父运行目录查找框架 skill（返回4份冻结副本）；原生 Pi 一次写入/执行共享 /tmp/calc.py 后删除并移入自身 .tmp。未观察到其他案例、评分器或凭据内容读取，但这不证明完整访问隔离。",'',
'相同三题已经多次开发复测，非未见留出集；公共训练污染、同日测试环境关联、仅三次随机采样、服务连接噪声，以及客户端模型元数据未独立鉴证，均限制推广结论。','',
'实现：[optimization-round10](../../docs/optimization-round10.zh-CN.md)；预登记：[protocol-round10](protocol-round10.zh-CN.md)；归档：[manifest]('+str(R.relative_to(H))+'/manifest.json)、[summary]('+str(R.relative_to(H))+'/summary.json)、[stability-quality]('+str(R.relative_to(H))+'/stability-quality.json)。']
(H/'comparison-round10.zh-CN.md').write_text('\n'.join(rows)+'\n');print(json.dumps({'report':str(H/'comparison-round10.zh-CN.md'),'groups':{k:{x:v[x] for x in ['labelCorrect','completed','correctDelivery','falseCompletion','totalTokens']} for k,v in g.items()}},ensure_ascii=False))
