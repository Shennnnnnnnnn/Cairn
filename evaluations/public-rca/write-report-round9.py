"""Render final descriptive report from sealed results, never invent outcomes."""
import json
from pathlib import Path
H=Path(__file__).resolve().parent;R=H/'runs/2026-10-17-pi-deepseek-round9-repeated'
load=lambda p:json.loads(p.read_text())
s=load(R/'summary.json');p=load(R/'public-metadata-supplement.json');m=load(R/'manifest.json');reviews=load(R/'qualitative-audit.json')
assert s['audit']['passed']==s['audit']['total'] and len(reviews['results'])==18
g=s['groups'];a=g['pi'];b=g['cairn'];ratio=lambda x,y:f'{(x/y-1)*100:+.1f}%' if y else 'N/A'
rows=['# 第九轮：Pi / DeepSeek 同模型重复对照','',
'两组均实际使用本机 Pi 1.1.0、`sub2api-copy/global:deepseek-v4.1-flash`、thinking=high。相同三道开发题各三次，共18个全新会话，最多3并发，不设评测时间/token/调用预算。原生提示、案例、产物契约、复算及隐藏标签政策与第八轮一致。全部尝试保留，未选择性重跑。',
'',f'联合命中：原生 {a["labelCorrect"]}/9，Cairn {b["labelCorrect"]}/9；有效交付分别 {a["correctDelivery"]}/9、{b["correctDelivery"]}/9。Cairn 的全部尝试 recorded tokens 相对原生 {ratio(b["totalTokens"],a["totalTokens"])}，CLI累计耗时 {ratio(b["totalSeconds"],a["totalSeconds"])}。这些是本开发集的描述结果，不能推断长期稳定性或单独归因于本轮修改。',
'','本轮支持的结论是：Cairn交付更齐全、记录用量更低；两组联合正确率相同，没有证明根因判断更强。原生少一次交付直接源于连接失败，不能全部归因于框架。I/O题Cairn三次都保留同服务memory备选，但仍缺少证明因果方向的干预/日志证据。','', '| 指标 | 原生 Pi | Pi+Cairn |','|---|---:|---:|']
for title,key in [('对象+资源族+层级联合正确','labelCorrect'),('完成','completed'),('产物格式契约通过','contractPassed'),('独立数值复算通过','arithmeticPassed'),('格式+数值验收通过','replayPassed'),('有效正确交付','correctDelivery'),('错误完成：已完成但标签错','falseCompletion'),('无效完成：已完成但未有效交付','invalidCompletion')]:rows.append(f'| {title} | {a[key]}/9 | {b[key]}/9 |')
rows+=[f'| 服务错误消息 / 同会话恢复后正常结束次数 | {a["providerErrorMessages"]} / {a["providerRecoveredEpisodes"]} | {b["providerErrorMessages"]} / {b["providerRecoveredEpisodes"]} |',f'| 最终未正常结束 | {a["terminalFailures"]}/9 | {b["terminalFailures"]}/9 |','| 真实中断/交接恢复 | N/A | N/A |','','完成要求原生最终正常stop（中途原生重试恢复不抹掉最终成功，错误仍另列）、三文件非空和候选有效；Cairn还要求唯一真实owner任务completed、报告有效和当前宿主验收proof。联合正确按精确对象、资源族和node/pod/service层级计；service仅允许既有-grpc/-http等价。有效交付还要求格式/数值验收通过且输入完整。完成、验收与结论正确性分开。',
'','## 成本与波动','',
'Pi记录的input为非缓存输入，cacheRead/cacheWrite另外记录；表内总量为input+output+cacheRead+cacheWrite，不重复加reasoning。所有尝试均计入每次有效交付成本。配置cost=0/缺失不能证明免费，实际金额未知。',
'','| 指标 | 原生 Pi | Pi+Cairn |','|---|---:|---:|']
for title,key in [('全部recorded tokens','totalTokens'),('非缓存输入tokens','noncachedInputTokens'),('缓存读取tokens','cachedInputTokens'),('缓存写入tokens','cacheWriteTokens'),('输出tokens（包含reasoning）','outputTokens'),('全部CLI累计秒数','totalSeconds'),('每次有效交付recorded tokens','recordedTokensPerCorrectDelivery'),('每次有效交付非缓存输入+输出tokens','noncachedInputAndOutputPerCorrectDelivery')]:
    def f(v):return f'{v:,.2f}' if isinstance(v,float) else f'{v:,}' if isinstance(v,int) else 'N/A'
    rows.append(f'| {title} | {f(a[key])} | {f(b[key])} |')
rows+=['',f'探针独立列账：{m["probe"]["tokens"]:,} tokens；正式总量 {a["totalTokens"]+b["totalTokens"]:,}。原生/Cairn用量下界标记：{a["tokensLowerBound"]}/{b["tokensLowerBound"]}。缓存分布、输出长度和服务批次均会影响成本，不只取决于工具数量。',
'','| 题目 | 组别 | 联合正确 / 有效交付 | tokens中位数 [最小,最大] | tokens CV | 秒数中位数 | 时间CV |','|---|---|---|---:|---:|---:|---:|']
for case,arms in s['perCase'].items():
    for arm,v in arms.items():
        t=v['tokens'];w=v['time'];rows.append(f'| {case} | {arm} | {v["labelCorrect"]}/3 / {v["correctDelivery"]}/3 | {t["median"]:,.0f} [{t["min"]:,.0f},{t["max"]:,.0f}] | {t["cv"]:.3f} | {w["median"]:.1f} | {w["cv"]:.3f} |')
rows+=['','本轮Cairn在new-01（I/O）与new-02（CPU）的tokens CV分别为0.491、0.366，仍触发预登记波动阈值；内存题三次未触发该标记。CV>0.25或max/min>2仅标记本样本波动；3个事件内重复相关，不是9道独立题。没有真实强制中断、预算停止或新会话恢复，不能从门禁单测推算恢复率。',
'','## 工程修改与实际协议行为','',
'- findings/progress/artifacts/handoffs 共用有界单层对象解码，随后执行原严格校验；schema仍请求对象，finish接口不扩展。Pi增加文档支持的prepareArguments，避免宿主先验校验挡住兼容入口。',
'- 因果比较保持通用：先比较同一对象的不同机制，再比较层级。压力可能是起因、中介或后果，用区别性预测/时序/方向证据比较；缺证据保留不确定性。不新增模型、领域规则或强制报告字段。',
'- 完整回归272/272；本机Pi真实校验器6/6；上轮三份原始编码拒绝载荷重放3/3通过；真实合成探针独立DB/owner/验收proof通过。',
'','| 公开工具元数据 | 原生 Pi | Pi+Cairn |','|---|---:|---:|']
for title,key in [('工具调用','toolCalls'),('工具错误','toolErrors'),('Cairn调用','cairnCalls'),('checkpoint调用','checkpointCalls'),('checkpoint失败','checkpointFailures'),('实际被接受的编码兼容调用','acceptedCompatibilityCalls'),('Cairn公开返回文本字节','publicCairnTextBytes')]:rows.append(f'| {title} | {p["groups"]["pi"][key]} | {p["groups"]["cairn"][key]} |')
rows+=['',f'对象字符串元素按findings/progress/artifacts/handoffs统计：{json.dumps(p["groups"]["cairn"]["encodedElements"],ensure_ascii=False)}。直接Pi扩展调用的返回字节不是模型tokens，也不与上轮Codex MCP传输字节作等价节省比较。若正式调用未触发某种编码，兼容结论仅由明确的回归与实际宿主校验验证，不能声称该场景在正式题目中被触发。',
'','## 完整报告审阅','',
'下列观察在全部隐藏标签评分前记录。完整报告逐份阅读并SHA封存；既有开发案例已知，审阅不是盲审。']
notes={r['id']:r for r in reviews['results']}
for r in s['rows']:
    n=notes[r['id']];pred=r['grade'].get('predictions',[{}])[0];top='/'.join(str(pred.get(k,'?')) for k in ['location','level','fault_family']);label='正确' if r['labelCorrect'] else '未命中'
    rows+=['',f'- **{r["id"]}**：{top}；标签{label}；有效交付={r["correctDelivery"]}。'+n.get('note',n.get('notes',''))]
rows+=['','## 可比性与结论边界','',
'公开API/流错误共48条：45条Connection error、1条terminated、1条429限流、1条503不可用；原生/Cairn分别30/18条。同会话最终恢复并正常结束的会话各8次；没有跨会话/owner交接恢复。原生连接失败的会话已生成正确候选和checks，但未交付最终REPORT，所以联合命中9/9并不意味着9/9完整完成。', '', '本轮是原生Pi与新版Cairn的同模型对照。第八轮使用GPT-6.1-Sol/xhigh，原生/Cairn联合命中9/9、8/9，有效交付均8/9；这些只是跨模型历史参考。本轮没有同模型旧Cairn臂，不能测出本轮修改相对旧Cairn的独立增益。',
'',f'冻结/记录审计 {s["audit"]["passed"]}/{s["audit"]["total"]} 通过，输入哈希、模型/effort、会话唯一性、私有配置删除、全局配置未变及当前验收proof分别核对。Pi没有OS级执行沙箱；公开路径/命令检查不能证明所有脚本内部行为或访问完全隔离。',
'','公开路径核对记录了目录约束例外：8次读取宿主注册的冻结skill路径；两次原生会话各把自身脚本stdout写入共享/tmp文件后自行删除（只见各自写者引用，未见其他会话引用这两个路径）；另一次Cairn命令尝试cd /Users/dsec，立即返回自己的工作区后才读取证据。这些不能被描述成严格隔离全部通过，详见public-scope-review.json和public-scope-manual.json。', '', '数值验收只覆盖提交的checks，不能保证整篇报告的时序、单位、缺测处理和因果解释都准确。审阅已保留辅助时间错移40秒、将缺测当正常、过强OOM必要条件等问题；原生与Cairn都有相应叙述风险。', '', '这三题是同一公开测试床的同日指标切片，已参与开发，可能存在训练污染。不能把数字复算通过等同因果正确，也不能用三次一致作长期稳定承诺。',
'','实现与复现入口：[实现说明](../../docs/optimization-round9.zh-CN.md)、[预登记协议](protocol-round9.zh-CN.md)、[正式归档](runs/2026-10-17-pi-deepseek-round9-repeated/manifest.json)、[逐次结果与审计](runs/2026-10-17-pi-deepseek-round9-repeated/summary.json)、[公开协议错误明细](runs/2026-10-17-pi-deepseek-round9-repeated/public-metadata-supplement.json)。']
(H/'comparison-round9.zh-CN.md').write_text('\n'.join(rows)+'\n')
print(json.dumps({'report':str(H/'comparison-round9.zh-CN.md'),'groups':{k:{x:v[x] for x in ['labelCorrect','completed','correctDelivery','falseCompletion','totalTokens']} for k,v in g.items()}},ensure_ascii=False))
