"""Render the final Chinese report from sealed measurements, without inference."""
import json,collections
from datetime import datetime
from pathlib import Path
here=Path(__file__).resolve().parent;root=here/'runs/2026-10-18-five-model-round11'
load=lambda p:json.loads(p.read_text())
s=load(root/'summary.json');m=load(root/'manifest.json');d=load(root/'diagnostics.json');done=load(root/'finished.json')
probes=load(root/'probes.json')
probe_tokens=sum((p['metrics'].get('usage') or {}).get('input_tokens',0)+(p['metrics'].get('usage') or {}).get('output_tokens',0) for p in probes)
formal_tokens=sum(r['tokens'] or 0 for r in s['rows'] if r['kind']=='rca')
generic_tokens=sum(r['tokens'] or 0 for r in s['rows'] if r['kind']=='generic')
parse_time=lambda x:datetime.fromisoformat(x.replace('Z','+00:00'))
batch_seconds=(parse_time(load(root/'execution-ended.json')['endedAt'])-parse_time(load(root/'execution-started.json')['startedAt'])).total_seconds()
assert done['actors']==100 and done['allPublicReportsReviewedBeforeGrading']
names={'deepseek':'Pi / DeepSeek Flash (high)','step':'Pi / Step 5 (high)','kimi':'Pi / Kimi K3 (off)','glm':'Pi / GLM 5.3 (high)','sol':'Codex / Sol (xhigh)'}
f=lambda x,n=1:'—' if x is None else f'{x:,.{n}f}'
lines=['# Round11：通用性、五模型对比与未完成原因','',
'本轮以启动时冻结的 Cairn 快照复测。共 **90 次排障运行**（5种模型×3题×3次×原生/Cairn两组），加 **10 次非排障任务**和5次独立接入探针。全部为真实 CLI，最多5并发、每模型1会话；无评测时间/token/调用预算，无挑选性重跑。运行期间当前工作区另有提交，版本边界见第7节。', '',
'## 1. 框架的通用性', '',
'核心是通用的目标、事实、依赖、交付与会话恢复 harness，默认 general + curated；宿主负责模型、工具、权限和执行。根因、平台回执等仅在可选 emergency 模式成为强制条件。代码边界见 [通用性核查](../../docs/generality-review.zh-CN.md)。原项目的 origin→goal、Fact/Intent/Hint、黑板驱动探索思想被保留；原 Dispatcher/Worker 的自动调度并未凭五工具完整复刻。', '',
'两道非排障任务分别是整数最大余数分配代码修复与混合单位/时区/缺测数据整理。10/10产物通过外部合同检查；原冻结运行的 Cairn 完成状态为9/10，Step算法题因新增评测验收器的 stdin/EPIPE 接入缺陷而挂起。统一修复后对全部10份快照重放宿主验收，10/10通过；没有重跑模型或改写原结果。这支持两类任务的可用路径，不能证明任意领域成功。', '',
'## 2. 排障主结果', '',
'准确=精确对象+层级+资源类别与注入标签一致/9（不等于报告所有细节正确）；完成=自然结束、约定文件和有效答案，Cairn另须唯一原生所有者任务、completed及当前有效验收。有效交付还要求独立数值/格式验收通过及输入未被改动。错误完成=完成但根因标签错误；报告语义正确性仍另有边界。', '',
'| 模型 / 宿主 | 组 | 准确 | 完成 | 错误完成 | 有效交付 | 完成样本CLI耗时中位数(s) | 已记录总tokens(M) | 每有效交付tokens(M) |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|']
for spec in m['models']:
 for arm in ['native','cairn']:
  x=s['groups'][spec['slug']][arm]
  lines.append(f"| {names[spec['slug']]} | {'原生' if arm=='native' else '+Cairn'} | {x['correct']}/9 | {x['completed']}/9 | {x['falseCompletion']}/9 | {x['effectiveDelivery']}/9 | {f(x['completedTime']['median']) if x['completedTime'] else '—'} | {f(x['recordedTokens']/1e6,3)} | {f(x['tokensPerEffectiveDelivery']/1e6,3) if x['tokensPerEffectiveDelivery'] is not None else '—'} |")
lines += ['', '统计范围为被测CLI的原生usage；本助手开发、编排与报告审阅的tokens未计入。全部尝试都进入成本分母，包括失败。tokens包含重复输入和cache；Pi为input+output+cacheRead+cacheWrite，Codex input已含cached部分，reasoning output不重复叠加。错误会话的用量可能是下界，缺失不表示免费。没有真实账单，不能据此给出货币成本或把不同模型的tokens视作等价价格。主表耗时中位数只取完成样本，避免把快速报错当成速度优势；全尝试耗时在后文分布及JSON中保留。CLI耗时含推理、原生工具与Cairn运行中的验收，不含准备工作区和事后独立复验。', '',
'| 模型 | 组 | 有效答案数 | 答案内准确 | 非缓存输入(M) | 缓存读取(M) | 输出(M) | 用量缺失 | API错误消息 |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|']
for spec in m['models']:
 for arm in ['native','cairn']:
  x=s['groups'][spec['slug']][arm]
  lines.append(f"| {spec['slug']} | {arm} | {x['validAnswers']}/9 | {x['correct']}/{x['validAnswers']} | {f(x['noncachedInputTokens']/1e6,3)} | {f(x['cacheReadTokens']/1e6,3)} | {f(x['outputTokens']/1e6,3)} | {x['missingUsage']} | {x['apiErrors']} |")
lines += ['', '“答案内准确”只描述已生成有效答案的样本，不能取代含失败尝试的主准确率。跨模型同时存在宿主、分词器、原生上下文、推理配置和网关差异；表格比较当前接入组合，不是控制了所有因素的基础模型能力榜单。', '',
'补充口径：严格完成率沿用冻结协议，要求CLI自然结束；summary.json另列保存的任务completed数、已验收任务但最终CLI失败数，以及标签/数值/文件合格但CLI未自然结束的交付。Kimi已观察到任务completed且验收passed后，最终回复遇到502/503；不能将它称作目标未完成。此补充不改原主指标。', '', '## 3. 同题三次的波动', '',
'CV为样本标准差/均值；每行只有3次。失败和0已记录tokens会改变全样本CV，需结合完成次数与summary.json里的completedTime/completedTokens分布。不同题不能合并后宣称稳定。', '',
'| 模型 | 组 | 题 | 准确/完成 | 耗时中位数[最小–最大](s) | tokens中位数(M) | tokens CV |',
'|---|---|---|---:|---:|---:|---:|']
for spec in m['models']:
 for case in ['new-01','new-02','new-03']:
  for arm in ['native','cairn']:
   x=s['perCase'][spec['slug']][case][arm];t=x['time'];u=x['tokens']
   lines.append(f"| {spec['slug']} | {arm} | {case} | {x['correct']}/3 · {x['completed']}/3 | {f(t['median'])}[{f(t['min'])}–{f(t['max'])}] | {f(u['median']/1e6,3) if u else '—'} | {f(u['cv'],3) if u else '—'} |")
lines += ['', '## 4. 未完成原因', '', '| 模型 | 组 | 未完成直接分类 |', '|---|---|---|']
for spec in m['models']:
 for arm in ['native','cairn']:
  x=s['groups'][spec['slug']][arm];reasons='；'.join(f'{key}: {value}' for key,value in x['incompleteReasons'].items()) or '无'
  lines.append(f"| {spec['slug']} | {arm} | {reasons} |")
rca=[r for r in s['rows'] if r['kind']=='rca'];compacted=[r['id'] for r in rca if r['compactions']]
lines += ['',f"原生记录中有压缩/截断事件的排障会话：{len(compacted)}/90。记录详见 `summary.json` 的compactions字段；事件存在不等于信息丢失，事件缺失也不能证明模型始终使用了全部信息。累计tokens不是单次上下文长度。", '',
'上一轮18次Pi/DeepSeek运行的事件回放：8次未交付均以Connection error终止，2次没有有效模型输出；全部18次没有原生压缩/截断事件。一例已有正确answer和checks、但未写REPORT就断线。直接证据支持客户端请求链路失败；仅凭笼统错误无法确定网络、代理或上游服务中的具体责任环节。', '',
'本轮新增的通用任务验收器问题是独立的已复现原因：原运行发生EPIPE；Step最终保存任务快照约136 KB，对这个快照重放原验收器再次发生EPIPE，只增加stdin drain后通过。136 KB是重放的最终快照大小，原当次候选stdin没有另行抓取，不能当作其精确字节数。不能把它记成模型不会编程、提示词不足或上下文丢失。原失败、挂起和重试成本保留。', '',
'没有进行首轮提示词A/B，因而不声称其贡献比例。原生首轮短提示列出answer/REPORT并要求阅读TASK，checks要求位于两组相同的完整TASK合同中；Cairn专用指导再次明确列出三份交付。这次对比的是宿主+Cairn协议/skill/提示整包集成，未单独控制交付要求复述，不能把差异全部归于黑板存储。已有TASK明确描述目标和交付合同；同一提示既成功也失败。工具参数错误、不可用工具名、重复探索、无变化finish重试属于可观察的执行问题，需与连接终止、缺产物、验收拒绝分别看。本轮采用模型start的插件路径：首轮请求失败时尚无黑板任务；GLM部分执行后失败的一例已有初始handoff但0条事实，属于尚未checkpoint。CLI submit已支持宿主在调用模型前保存目标，当前host-managed入口尚需宿主接管；默认接入可优先使用此方式提高启动阶段可观测性。持久黑板可保存已checkpoint的事实，不能恢复从未写入的原生工作，也不能自行修复正在失败的模型连接。本轮没有主动断线/跨会话恢复实验，不能据此声称恢复成功率。', '',
'## 5. 非排障任务单列', '', '| 模型 | 原冻结任务完成 | 外部产物合同通过 | 两任务合计CLI秒 | 已记录tokens(M) |', '|---|---:|---:|---:|---:|']
for spec in m['models']:
 x=s['generic'][spec['slug']];lines.append(f"| {spec['slug']} | {x['completed']}/2 | {x['acceptancePassed']}/2 | {f(x['totalSeconds'])} | {f(x['recordedTokens']/1e6,3)} |")
lines += ['', '## 6. 审计与复现', '',f'整批100次运行墙钟耗时{batch_seconds/60:.1f}分钟（并行，不能与各CLI秒数求和混同）。90次排障已记录{formal_tokens/1e6:.3f}M tokens；10次非排障{generic_tokens/1e6:.3f}M；5次接入探针另计{probe_tokens/1e6:.3f}M。适配器快照重放没有模型调用。', '',
f"冻结前完整回归291/291；运行结束后，含期间另行提交改动的当前工作区完整检查294/294；5模型接入探针通过。冻结文件、运行时、任务输入均已核对。原生模型/effort/会话/用量账本核查异常：{len(s['nativeCheckFailures'])}项；原全局配置发生变化：{len(s['globalConfigChanges'])}项，详见summary.json，异常不会隐藏。100个actor及5个探针共105份私有配置副本均确认删除。", '',
'- 冻结协议：`runs/2026-10-18-five-model-round11/protocol.frozen.md`。',
'- 冻结manifest、运行器、原生会话与每次产物位于同一run目录。已有actor不可覆盖或选择性重启。',
'- `python3 evaluations/public-rca/progress-round11.py` 查看完成进度，不运行隐藏评分。',
'- `assess-round11.mjs` 为冻结引擎的只读完成验收；`analyze-round11.py` 在全批结束及报告审阅封存后统一评分；`diagnostics-round11.py` 仅整理公开错误和原生元数据。',
'- `generic-verifier-replay.json` 与 `verify-generic-stdin-fixed.py` 保留统一适配器复验，不取代原始成绩。', '',
'三题是反复使用的开发案例，存在公开训练数据污染可能；三次重复不是三道新题。Pi只隔离cwd/config/DB/tmp并给出路径约束，没有OS沙箱；Codex使用workspace-write。客户端模型ID不能独立证明网关内部路由。并发5与历史轮次不同，不能将跨轮变化全部归因于框架。', '',
'官方参数背景参照 [Codex CLI文档](https://learn.chatgpt.com/docs/developer-commands?surface=cli) 与 [GPT-6.1-Sol模型文档](https://developers.openai.com/api/docs/models/gpt-6.1-sol)，实际调用身份以本轮原生日志为准。', '']
extra=['', '### 任务状态与会话结束分开看', '', '| 模型+Cairn | 原始任务标记completed | 其中标签错误 | 当前已验收任务但CLI失败 | 标签/数值/文件合格的内容交付 |', '|---|---:|---:|---:|---:|']
for spec in m['models']:
 x=s['groups'][spec['slug']]['cairn'];extra.append(f"| {spec['slug']} | {x['savedTasksMarkedCompleted']}/9 | {x['savedStateFalseCompletion']}/9 | {x['acceptedTasksButCLIFailed']} | {x['validatedCorrectArtifacts']}/9 |")
extra += ['', '完成但仍未有效交付的样本（标签错误、数值/合同不合格或输入变化单列，不改主指标）：', '', '| 会话 | 标签 | 文件合同 | 数值复算 | 输入变化 |', '|---|---|---|---|---|']
for r in s['rows']:
 if r['kind']=='rca' and r['completed'] and not r['effectiveDelivery']:extra.append(f"| {r['id']} | {r['correct']} | {r['contractPassed']} | {r['arithmeticPassed']} | {','.join(r['unexpectedInputChanges']) or '无'} |")
lines[lines.index('## 3. 同题三次的波动'):lines.index('## 3. 同题三次的波动')]=extra+['']
dn=s['groups']['deepseek']['native'];dc=s['groups']['deepseek']['cairn']
sn=s['groups']['sol']['native'];sc=s['groups']['sol']['cairn']
verdict=['## 本轮结论', '',
'**Cairn 的核心是通用 harness；本轮没有证明它能在所有模型上提高准确率或节省成本。** 非排障代码与数据任务产物10/10通过，但默认模型说明仍偏调查分析，原版自动 Reason/Explore 调度也没有完整复刻。', '',
f"- **Pi / DeepSeek**：两组根因标签均9/9、错误完成0/9；Cairn记录tokens由{dn['recordedTokens']/1e6:.3f}M降到{dc['recordedTokens']/1e6:.3f}M（-{(1-dc['recordedTokens']/dn['recordedTokens'])*100:.1f}%），完整流程完成9/9→8/9。少的一次是产物已齐、标签/数值合格，但模型在调用finish之前遭服务错误，任务仍active，不能算完成。完成样本CLI耗时中位数{dn['completedTime']['median']:.1f}→{dc['completedTime']['median']:.1f}秒。", '',
f"- **Codex / GPT-6.1-Sol xhigh**：两组完成均9/9、根因均8/9、错误完成均1/9，18次无API错误消息。Cairn记录tokens增加{(sc['recordedTokens']/sn['recordedTokens']-1)*100:.1f}%，完成样本耗时中位数{sn['completedTime']['median']:.1f}→{sc['completedTime']['median']:.1f}秒；本轮收益主要是状态/事实/交接和验收，未见准确率提升或用量节省。", '',
'- **Pi / Step**：两组均仅5/9完整完成、3/9标签正确。Cairn把有效交付2/9提高到3/9，已结束有效答案的数值/文件验收有所改善；仍有两次错误层级完成，完成样本耗时中位数约24–25分钟，且后期连续服务错误。不能称为轻量稳定。', '',
'- **Pi / Kimi、GLM**：Kimi标签均3/9，GLM为0/9→1/9；服务可用性严重混入结果。GLM有15/18次终止失败、13次未记录token也没调用工具，不能由这批结果判断其基础能力最差。Kimi一例在任务completed/验收passed后才发生最终回复错误，需与未完成目标分开。', '',
'同题成本没有普遍稳定：DeepSeek的I/O题token CV从0.367降至0.206，CPU从0.642降至0.317，但memory从0.492升至0.631（Cairn最大/最小约4.87倍）。Sol三题token CV约0.076–0.130，低于或接近原生，但总用量增加。只有每题3次，且是已反复开发使用的题，不能外推长期稳定性。', '',
'当前接入中，DeepSeek显示较好的本批准确率及相对Cairn用量收益；Sol显示较稳定的可用性和更谨慎的报告口径。它们各有一项不能替代另一项的优势；token数量也不能直接换成跨模型账单价格。', '']
idx=lines.index('## 1. 框架的通用性');lines[idx:idx]=verdict
config=['### 实际调用配置', '', '| 宿主 | 模型ID | 推理配置 | 注册来源 |', '|---|---|---|---|']
for spec in m['models']:
 config.append(f"| {spec['host']} | `{spec['id']}` | {spec['thinking']} | {'临时私有别名，沿用Pi内置zai/glm-5.3元数据' if spec['slug']=='glm' else '原用户注册不变' if spec['host']=='pi' else 'CLI原生模型及token_count记录'} |")
config += ['', 'Kimi的off来自当前Pi注册的reasoning=false，不表示该模型在所有服务上不支持推理。GLM别名只写入本批私有配置，没有修改用户全局模型文件；客户端ID不能独立核实网关后端。没有覆盖原注册的上下文/单次输出上限，也未施加运行预算；CLI自身重试与宿主验收器的安全超时保留。这些差异限制跨模型纯能力归因。', '']
idx=lines.index('## 2. 排障主结果');lines[idx:idx]=config
lines += ['## 7. 故障阶段、报告审阅与后续优化', '',
'90次正式运行有57次完整流程完成、33次未完成：32次直接终止于服务端502/503，1次为不透明的provider finish_reason错误（此前有连接错误）。正式运行另记录56条Connection、1条429、116条503、24条502及1条finish_reason错误消息；这些含重试，不能当作198次独立任务失败。28次失败没有记录token也没有工具输出。没有评测超时或预算终止。根本原因究竟是网关路由、上游容量或其他服务问题，缺少服务端日志，不能确定。', '',
'两种不同阶段的例子：DeepSeek CPU第三次Cairn已写完正确产物，但尚未finish，保存6条事实、任务active；Kimi CPU第二次Cairn已finish且验收passed、保存7条事实，随后最终回复失败。不能把前者提升为completed，也不能把后者称作目标没做完。33次未完成的直接分类不是“提示词不完善”或“上下文丢失”；首轮提示A/B未做、90次无原生压缩/截断事件，仍不能证明模型始终利用了全部信息或网关从未改写上下文。', '',
'**正确性薄弱点仍集中在定位层级。** 12次“流程完成但根因标签错误”全部来自同一道I/O题，标签是shippingservice/service/disk_io。Step用一个pod代表共同异常的副本组，Kimi/GLM还出现memory或node解释，Sol原生一例报node、Cairn一例报代表pod。Cairn的6次错误完成都通过了宿主产物验收，说明该验收检查计算与交付合同，没有独立证明注入对象/层级/因果结论。严格标签匹配与“现有指标是否能唯一识别注入点”的认识边界也需同时保留。', '',
'**报告全文已读，不等于全文语义自动评分通过。** 69份存在的REPORT全部读完，31份缺失逐一确认，98个文本分段审阅封存后才运行隐藏评分。确定的细节错误包括：Step memory第二次原生把6532写成位于6460和6520之间，并将7000−6532写为168秒（实为468）；Kimi I/O第一轮Cairn擅将mrt写为秒；Step I/O第一轮Cairn在非单调读量上选取恰好上升的子窗做rate，即使数值复算通过，也不证明计数器语义。通用任务也有叙述错误：Step把allocate(7,[2,3,5])说成整除、把UTC00:03描述为早于其余包括00:01的观测。这些没有被根因标签/选定checks或通用行为检查完整覆盖。Sol报告整体更谨慎，但也有个别42对象与实际40条内存时序的覆盖表述偏差。详见report-reviews.json；本轮不把主观阅读标成全报告准确率。', '',
'下一步按通用、轻量原则：', '',
'1. 宿主先submit保存目标及初始交接，异常退出记录“未开始/已有产物待验收/验收通过但回复失败”，恢复从已保存阶段继续；尊重Retry-After并区分可重试服务失败与模型工具修正，不靠无限重做探索。',
'2. 收窄general默认schema/skill，领域方法按需加载；优先重用已保存事实与计算记录，避免强模型为仪式性探索、重复整理支付额外输入开销。原版黑板应帮助选择下一步，但无需把完整多worker调度强塞回核心。',
'3. 保持文件、数值、结论审查的独立状态；用宿主可选验收规则校验对象集合与代表对象、时间差/窗口、单位依据和数据覆盖。不要把查到的一个代表成员自动替代群组结论。验收器先读完stdin；改进EPIPE时对退出码和完整JSON的处理，避免把本可返回结果的早关stdin一律当不可用。以上候选尚未做模型A/B，不宣称已获得收益。', '',
'### 冻结版本与路径边界', '',
'本轮没有改动冻结的框架实现。运行中工作区另行提交544597f（2026-10-18 01:27 +08:00），包括engine.complete改用completionCheck及导出时识别过期验收；与测试快照相比有2份源码及8份构建文件变化。全部actor只使用implementation/内的冻结版本；上述后续改动的模型效果没有被本轮90次测量。冻结前291/291、当前工作区另行294/294，两者不可混用。冻结存档及全部任务输入仍完整，105份临时私有配置均删除。', '',
'公开路径索引检查2294条命令/路径。8个Pi actor在13条命令中使用共享/tmp写读自己的中间输出，违反冻结提示的cwd/.tmp约束；另两次先尝试cd到拼错的public-rka/runs，随后回到自身workspace才读文件。已保留全部成绩与成本，没有选择性删样。索引未发现读取标签/凭据、联网或嵌套模型调用；这不是完整shell数据流证明，不能宣称Pi拥有OS隔离或绝无外部干扰。Step从.tmp列父目录实际仍在自身workspace；冻结skill读取与Sol的Path.parent源码路径匹配已区分。原始候选与审阅结论见public-scope-index.json及scope-review.json。', '']
(here/'comparison-round11.zh-CN.md').write_text('\n'.join(lines))
print(here/'comparison-round11.zh-CN.md')
