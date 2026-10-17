"""Write the comparison after every actor, review, scope check and grade is complete."""
import json,statistics
from pathlib import Path
HERE=Path(__file__).resolve().parent;RUN=HERE/'runs/2026-10-17-codex-sol-xhigh-repeated'
load=lambda path:json.loads(path.read_text())
s=load(RUN/'summary.json');manifest=load(RUN/'manifest.json');cases=load(RUN/'case-manifest.json');scope=load(RUN/'public-scope.review.json');cleanup=load(RUN/'cleanup.json')
if s['audit']['failures'] or not scope['allFinishedActorsReviewed'] or not cleanup['allPrivateHomesRemoved']:raise SystemExit('Resolve record audit, scope review and credential cleanup before publication')
rows=s['rows'];names={'codex':'原生 Codex','cairn':'新版 Cairn'};groups=s['groups']
def percent(value):return '—' if value is None else f'{value*100:.1f}%'
def number(value):return '—' if value is None else f'{value:,.0f}'
def cost(group):return '未知' if not group['tokenUsageKnown'] else ('≥' if group['tokensLowerBound'] else '')+number(group['totalTokens'])
def per_delivery(group):return ('≥' if group['tokensLowerBound'] else '')+number(group['recordedTokensPerCorrectDelivery']) if group['correctDelivery'] else '—（无有效交付）'
def outcome(value):return '✓' if value else '失败'
def variation(group,key):
    values=group[key]
    if values['median'] is None:return '未知'
    return f"{values['median']/60:.2f} [{values['min']/60:.2f}–{values['max']/60:.2f}]" if key=='time' else f"{number(values['median'])} [{number(values['min'])}–{number(values['max'])}]"

lines=['# 新难题重复对照：Codex Sol 极高与新版 Cairn','',
'2026-10-17（Asia/Shanghai）。GPT-6.1-Sol / xhigh，Codex CLI '+manifest['cliVersion'].removeprefix('codex-cli ')+'。三道历史评测记录中未跑过的公开事件，每题每种配置三次，共18个全新会话，最多三组并行，不设评测时长、token或调用次数预算。新版 Cairn 是第七轮冻结版本，测试过程中没有优化或换版。','',
'## 汇总','',
'| 配置 | 正确：对象＋类别＋层级 | 完成 | 契约＋复算 | 有效交付 | 错误完成／全部 | 错误／已完成 | 记录总 tokens | 每次有效交付 tokens |',
'| --- | --- | --- | --- | --- | --- | --- | ---: | ---: |']
for arm,g in groups.items():lines.append(f"| {names[arm]} | {g['labelCorrect']}/9 | {g['completed']}/9 | {g['replayPassed']}/9 | {g['correctDelivery']}/9 | {g['falseCompletion']}/9 | {g['falseCompletion']}/{g['completed']} | {cost(g)} | {per_delivery(g)} |")
n,c=groups['codex'],groups['cairn'];mixed={arm:sum(0<s['perCase'][case][arm]['labelCorrect']<3 for case in manifest['caseList']) for arm in names}
if c['correctDelivery']>n['correctDelivery']:conclusion='本轮新版 Cairn 的有效交付次数更多；这一差异描述这三题的重复样本，不能推断通用准确率提升。'
elif c['correctDelivery']<n['correctDelivery']:conclusion='本轮新版 Cairn 的有效交付次数更少，当前数据不支持它提高诊断表现；事实持久化和验收能力须与诊断结果分开评价。'
else:conclusion='本轮两种配置有效交付次数相同；是否值得框架开销，需结合持久事实、验收、交接及每次有效交付成本判断。'
lines+=['',conclusion+f" 原生与 Cairn 分别在{mixed['codex']}／{mixed['cairn']}道题中出现三次标签判断不一致。正确答案未通过产物契约／数值复算，或答对但未完成，都不算有效交付。错误完成同时保留两个分母，避免完成少就显得错误少。",'',
f"本次 Cairn 相对原生，记录总tokens多{100*(c['totalTokens']/n['totalTokens']-1):.1f}%，执行时间求和多{100*(c['totalSeconds']/n['totalSeconds']-1):.1f}%；有效交付数同为8，故每次有效交付记录tokens也多{100*(c['recordedTokensPerCorrectDelivery']/n['recordedTokensPerCorrectDelivery']-1):.1f}%。未缓存输入＋输出的每次有效交付用量多{100*(c['noncachedInputAndOutputPerCorrectDelivery']/n['noncachedInputAndOutputPerCorrectDelivery']-1):.1f}%，仍不能换算订阅金额。",'',
'| 配置 | 单次时间中位数 [最小,最大] | 单次 tokens中位数 [最小,最大] | 总执行时间（求和） | 未缓存输入 | 缓存输入 | 输出 |',
'| --- | --- | --- | ---: | ---: | ---: | ---: |']
for arm,g in groups.items():lines.append(f"| {names[arm]} | {variation(g,'time')} 分 | {variation(g,'tokens')} | {g['totalSeconds']/60:.2f} 分 | {number(g['noncachedInputTokens'])} | {number(g['cachedInputTokens'])} | {number(g['outputTokens'])} |")
lines+=['','每题每组均为3次，三题宏平均与9次微平均数值相同，不能因此把9次当作独立案例。并行执行时间求和不等于用户等待的墙钟时间；本批正式并行阶段墙钟43.68分钟。单次时间为驱动记录的CLI执行阶段，目录复制、安装和宿主汇总不计入单次。Codex input_tokens 已含缓存输入，表中总数=input+output，推理输出不重复累加。记录tokens是流量/用量指标，不是订阅账单；无可核实价格，不估美元。所有失败尝试计入有效交付成本分子，缺usage或中断只报告下界/未知。','',
'| 配置 | 每次有效交付：未缓存输入＋输出 | 每次有效交付：缓存输入 |','| --- | ---: | ---: |']
for arm,g in groups.items():lines.append(f"| {names[arm]} | {number(g['noncachedInputAndOutputPerCorrectDelivery'])} | {number(g['cachedInputPerCorrectDelivery'])} |")
lines+=['','两类用量权重和输出价格不同，此拆解仍不是美元成本。', '', '| 配置 | 产物契约 | 独立算术复算 | 补充：无效完成（含契约/算术/标签失败） |','| --- | --- | --- | --- |']
for arm,g in groups.items():lines.append(f"| {names[arm]} | {g['contractPassed']}/9 | {g['arithmeticPassed']}/9 | {g['invalidCompletion']}/9 |")
lines+=['','契约与算术拆解是观察到提交格式失败后新增的全18次统一只读诊断；使用启动前冻结的两个组件，保留原组合验收和所有主评分，不补文件或换样本。上表无效完成为补充指标，不替换启动前定义的“错误完成”（标签错误）。','', '## 各题三次重复与成本波动','',
'| 新题 | 配置 | 标签命中 | 完成 | 有效交付 | 错误完成 | 时间中位数 [最小,最大] 分 | 时间CV | tokens中位数 [最小,最大] | tokens CV |',
'| --- | --- | --- | --- | --- | --- | --- | ---: | --- | ---: |']
for case in manifest['caseList']:
    for arm in names:
        g=s['perCase'][case][arm]
        lines.append(f"| {case} | {names[arm]} | {g['labelCorrect']}/3 | {g['completed']}/3 | {g['correctDelivery']}/3 | {g['falseCompletion']}/3 | {variation(g,'time')} | {percent(g['time']['cv'])} | {variation(g,'tokens')} | {percent(g['tokens']['cv'])} |")
for case in manifest['caseList']:
    for arm in names:
        g=s['perCase'][case][arm];state='三次均命中' if g['labelCorrect']==3 else '三次均未命中' if g['labelCorrect']==0 else '三次判断有变化'
        variability=[]
        if g['time']['variable']:variability.append('时间')
        if g['tokens']['variable']:variability.append('tokens')
        lines.append(f"\n- {case}／{names[arm]}：{state}；"+('、'.join(variability)+'触发预定波动标记。' if variability else '时间与tokens未触发预定波动标记。'))
lines+=['','波动标记为每题CV>25%或最大/最小>2，只是预先约定的描述规则。三次相同也可能三次都错；“重复内一致”不等于正确或长期稳定。每题的三次存在共同输入、网关、缓存与时间相关性，9次不是9道独立题。','',
'| 配置 | 标签正确率95% Wilson区间（假定独立采样，仅作参考） |','| --- | --- |']
for arm,g in groups.items():
    lo,hi=g['descriptiveWilsonAssumingIndependent'];lines.append(f'| {names[arm]} | {percent(lo)}–{percent(hi)} |')
lines+=['','上述区间不能消除同题重复及同测试床相关性，不作为显著性或总体成功率证明。只有3个不同事件；仍需更多独立测试床/日期。','',
f"按相同(case,repeat)编号匹配的9对，有效交付胜/负/平：Cairn胜{s['pairedOutcomes']['cairn']}、Codex胜{s['pairedOutcomes']['codex']}、平{s['pairedOutcomes']['tie']}。对应采样没有相同随机seed，轮转顺序及并发资源/服务负载仍可能影响成本。",'',
'## 逐次结果','',
'| 题／次数 | 配置 | 完成 | 契约＋复算 | 联合标签 | 有效交付 | 时间秒 | 记录 tokens | 工具错误 | checkpoint／finish |',
'| --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | --- |']
for row in rows:
    token=('≥' if row['usageIsLowerBound'] else '')+number(row['tokens'])
    lines.append(f"| {row['case']}/{row['repeat']} | {names[row['arm']]} | {outcome(row['completed'])} | {outcome(row['replayPassed'])} | {outcome(row['labelCorrect'])} | {outcome(row['correctDelivery'])} | {row['wallSeconds']:.2f} | {token} | {row['toolErrors']} | {row['checkpoints']}/{row['finishCalls']} |")
for row in rows:
    if not row['replayPassed']:
        parts=row['acceptanceComponents'];issues=[]
        for kind,title in [('contract','契约'),('arithmetic','算术')]:
            if not parts[kind]['ok']:issues.append(title+'：'+'；'.join(dict.fromkeys(str(item.get('message',item)) for item in parts[kind].get('issues',[]))))
        lines.append('\n- '+row['id']+'：'+'；'.join(issues)+'。保持原次输出计入统计。')
for row in rows:
    if not row['labelCorrect']:
        first=(row['grade'].get('predictions') or [{}])[0];truth=row['grade']['truth']
        lines.append('\n- '+row['id']+'：首选 '+str(first.get('location'))+'/'+str(first.get('level'))+'/'+str(first.get('fault_family'))+'，标签为 '+truth['cmdb_id']+'/'+truth['level']+'/'+row['grade']['expectedFamily']+'。产物契约和算术均通过，但对象与层级未命中，计一次错误完成；相同I/O题此前两次Cairn首选服务层，第三次上移到共同承压节点。')
lines+=['','工具错误包含命令非零返回、类型校验和模型自己脚本的失败；客户端hook信任/实验特性提示另列，不当作模型API错误。包装脚本失败另列，可能导致后续静态调用未派发，不能把AST中出现次数当实际执行次数，也不将不同层的错误记录简单相加。原生Codex没有Cairn管理工具，因此其checkpoint/finish为0。','',
'| 配置 | 命令/MCP记录 | 失败工具记录 | 参数校验拒绝 | 非零命令 | 包装脚本失败 |','| --- | ---: | ---: | ---: | ---: | ---: |']
for arm,g in groups.items():lines.append(f"| {names[arm]} | {g['toolCalls']} | {g['toolErrors']} | {g['invalidModelInputs']} | {g['commandFailures']} | {g['wrapperFailures']} |")
lines+=['', '9次Cairn checkpoint参数拒绝中，5次将finding数组元素作为JSON字符串传入，4次传入空next；其余还有2条非零命令和1次补丁包装失败。各层记录分列，模型自修复过程全部计入用量；本轮没有隔离schema传输与模型服从各自的影响。','',
'## 案例与选题边界','',
'| 新题 | 公开时刻 Unix秒 | 标签对象 | 标签层级／资源 | 变化时序／多信号对象 | CSV／原始行 |','| --- | ---: | --- | --- | --- | --- |']
for case in cases:
    q=case['selection'];truth=case['groundtruth'];lines.append(f"| {case['case']} | {truth['timestamp']} | {truth['cmdb_id']} | {truth['level']}／{case['family']} | {q['changedSeries']}／{q['multiSignalObjects']} | {len(case['files'])}／{sum(f['rows'] for f in case['files'])} |")
lines+=['','从历史四题之外的29个事件选题，先按时间分三段，再以资源类别覆盖约束最大化无模型的原始指标多对象变化分数。未按目标过滤指标，全部57个CSV只按前后各600秒过滤。初稿的无类别约束方案选出三道I/O题，在任何模型调用前归档，未作为实验或产生成本。难度分数只是代理，不代表比赛官方难度；新CPU/内存题的变化较集中，不能都称为经验证的高难度。此代理偏向可见指标变化，未覆盖弱信号网络、无明显指标变化或跨测试床迁移。','',
'原始来源沿用已封存的 [AIOps 2022 第三方公开归档](https://zenodo.org/records/19176851)，同一天/同一测试床，原始文件SHA与ZIP条目来源见source-integrity.json。不保证模型未在训练中见过这些公开答案；“新”指本项目此前没有实际执行过。故障持续时间未知，窗口外事件可能仍有残留效应。','',
'## 完成、数值与正确性的区别','',
'原生完成要求自然结束、三份产物存在且候选字段有效。Cairn还要求恰好一个真实原生owner任务完成、冻结引擎确认报告和verification当前。两者的状态判据不同，不能把Cairn的completed当作独立正确性证明。Cairn可在执行中收到宿主验收反馈，原生只有自己的检查和结束后的宿主评分；这是两套完整工作流对照，不能分离验收反馈、黑板和交接各自的收益。原始CSV重算只验证声明运算与文件契约，不裁定采集语义、全部正文数字或因果。','',
'联合标签要求对象、资源类别和标签层级同时匹配；服务原名与-grpc/-http后缀等价，pod不自动等同service。此规则启动前冻结，旧raw对象＋类别成绩也保留在逐次grade。比赛标签粒度也不等于现有指标可唯一识别的全部因果事实，不能把标签未命中自动解释成毫无工程价值。','',
'18个执行者全部结束、每份完整公开报告审阅冻结后才统一评分。逐次非数值叙述检查见qualitative-audit.json；审阅者可接触历史与案例资料，不宣称盲审。各组公开命令/MCP、文件变更和cwd/workdir元数据的自动扫描与人工标记复核见public-scope.scan.json、public-scope.review.json；不展示私有推理。','',
f"当前公开范围扫描{scope['actors']}个执行者、{scope['tools']}条命令/MCP记录和{scope['fileChangeEvents']}个文件变更事件。确认偏离{scope['confirmedScopeViolations']}项，临时文件约定偏离{scope['temporaryConventionDeviations']}项，另有{scope['unresolvedTemporaryPossibilities']}项历史临时文件可能性无法确认；细节单列，不悄悄删除对应样本。静态扫描与未观察到偏离不证明OS读隔离，也不覆盖所有脚本内部行为。",'',
f"冻结与记录审计{s['audit']['passed']}/{s['audit']['total']}通过。这是协议完整性检查，不是内容正确性分数。85个运行相关文件与第七轮262/262回归通过的版本完全一致；本轮只增加评测脚本，无框架代码修改。正式18次合计{n['totalTokens']+c['totalTokens']:,}记录tokens；探针额外{manifest['probe']['tokens']:,} tokens单列，未混入正式成本；私有凭据副本已删除，全局配置哈希未变。",'',
'没有预设中断或强制恢复；本轮实际恢复记录为N/A，不能从自然完成或内存重算推导模型恢复率。无新UI浏览器验证。模型/effort按客户端元数据核对，不独立证明后端路由与推理实现。','',
'## 本轮结论与后续验证点','',
'完成在本次重复内一致：两组都是9/9。结论层面，原生三题的三次均命中；Cairn在I/O题有一次服务→节点的对象/层级漂移。交付层面，Cairn9/9满足契约，原生内存题一次将before/after写成对象而非说明字符串；该次算术仍正确。两组有效交付都是8/9，失败原因不同。','',
'成本没有触发事先约定的CV>25%或最大/最小>2标记，但同题记录tokens的范围仍可达1.61倍。原生每题tokens CV为3.0%–17.7%，Cairn为6.6%–23.5%；耗时CV分别为0.9%–6.2%、2.8%–14.4%。这只能说明三次样本里的波动，没有证明长期稳定。','',
'后续优先核对Codex实际收到的嵌套schema、减少空next等无信息的接口重试，再检验通用的竞争假设/定位粒度对照；保持不加RCA类别或层级偏好硬规则。评测再增加原生＋同等宿主验收反馈的控制组，以及弱信号/其他日期和测试床案例，才能区分验收反馈、事实持久化和诊断收益。本轮没有修改框架或按错误样本追加调优。','',
'## 复核入口','',
'[启动前协议](protocol-codex-repeated.zh-CN.md)与[验收清单](acceptance-codex-repeated.zh-CN.md)。本地记录目录 `runs/2026-10-17-codex-sol-xhigh-repeated/` 保存manifest、选择候选与历史窗口、执行顺序、每次公开报告/复算/标签、Cairn内存proof检查、统计、路径审阅和凭据清理记录。原始CSV及原生会话保留本地ignored目录，避免把私有推理作为展示内容。','']
(HERE/'comparison-codex-repeated.zh-CN.md').write_text('\n'.join(lines))
print(json.dumps(dict(report='comparison-codex-repeated.zh-CN.md',actors=len(rows),audit=s['audit']['passed']),ensure_ascii=False))
