"""Render the final Chinese report from sealed measurements, without inference."""
import json,collections
from pathlib import Path
here=Path(__file__).resolve().parent;root=here/'runs/2026-10-18-five-model-round11'
load=lambda p:json.loads(p.read_text())
s=load(root/'summary.json');m=load(root/'manifest.json');d=load(root/'diagnostics.json');done=load(root/'finished.json')
assert done['actors']==100 and done['allPublicReportsReviewedBeforeGrading']
names={'deepseek':'Pi / DeepSeek Flash (high)','step':'Pi / Step 5 (high)','kimi':'Pi / Kimi K3 (off)','glm':'Pi / GLM 5.3 (high)','sol':'Codex / Sol (xhigh)'}
f=lambda x,n=1:'—' if x is None else f'{x:,.{n}f}'
lines=['# Round11：通用性、五模型对比与未完成原因','',
'本轮是冻结的当前 Cairn 版本复测。共 **90 次排障运行**（5种模型×3题×3次×原生/Cairn两组），加 **10 次非排障任务**和5次独立接入探针。全部为真实 CLI，最多5并发、每模型1会话；无评测时间/token/调用预算，无挑选性重跑。', '',
'## 1. 框架的通用性', '',
'核心是通用的目标、事实、依赖、交付与会话恢复 harness，默认 general + curated；宿主负责模型、工具、权限和执行。根因、平台回执等仅在可选 emergency 模式成为强制条件。代码边界见 [通用性核查](../../docs/generality-review.zh-CN.md)。原项目的 origin→goal、Fact/Intent/Hint、黑板驱动探索思想被保留；原 Dispatcher/Worker 的自动调度并未凭五工具完整复刻。', '',
'两道非排障任务分别是整数最大余数分配代码修复与混合单位/时区/缺测数据整理。10/10产物通过外部合同检查；原冻结运行的 Cairn 完成状态为9/10，Step算法题因新增评测验收器的 stdin/EPIPE 接入缺陷而挂起。统一修复后对全部10份快照重放宿主验收，10/10通过；没有重跑模型或改写原结果。这支持两类任务的可用路径，不能证明任意领域成功。', '',
'## 2. 排障主结果', '',
'准确=精确对象+层级+资源类别答对/9；完成=自然结束、约定文件和有效答案，Cairn另须唯一原生所有者任务、completed及当前有效验收。有效交付还要求独立数值/格式验收通过及输入未被改动。错误完成=完成但根因标签错误；报告语义正确性仍另有边界。', '',
'| 模型 / 宿主 | 组 | 准确 | 完成 | 错误完成 | 有效交付 | CLI耗时中位数(s) | 已记录总tokens(M) | 每有效交付tokens(M) |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|']
for spec in m['models']:
 for arm in ['native','cairn']:
  x=s['groups'][spec['slug']][arm]
  lines.append(f"| {names[spec['slug']]} | {'原生' if arm=='native' else '+Cairn'} | {x['correct']}/9 | {x['completed']}/9 | {x['falseCompletion']}/9 | {x['effectiveDelivery']}/9 | {f(x['time']['median'])} | {f(x['recordedTokens']/1e6,3)} | {f(x['tokensPerEffectiveDelivery']/1e6,3) if x['tokensPerEffectiveDelivery'] is not None else '—'} |")
lines += ['', '全部尝试都进入成本分母，包括失败。tokens包含重复输入和cache；Pi为input+output+cacheRead+cacheWrite，Codex input已含cached部分，reasoning output不重复叠加。错误会话的用量可能是下界，缺失不表示免费。没有真实账单，不能据此给出货币成本或把不同模型的tokens视作等价价格。CLI耗时含推理、原生工具与Cairn运行中的验收，不含准备工作区和事后独立复验。', '',
'| 模型 | 组 | 有效答案数 | 答案内准确 | 非缓存输入(M) | 缓存读取(M) | 输出(M) | 用量缺失 | API错误消息 |',
'|---|---|---:|---:|---:|---:|---:|---:|---:|']
for spec in m['models']:
 for arm in ['native','cairn']:
  x=s['groups'][spec['slug']][arm]
  lines.append(f"| {spec['slug']} | {arm} | {x['validAnswers']}/9 | {x['correct']}/{x['validAnswers']} | {f(x['noncachedInputTokens']/1e6,3)} | {f(x['cacheReadTokens']/1e6,3)} | {f(x['outputTokens']/1e6,3)} | {x['missingUsage']} | {x['apiErrors']} |")
lines += ['', '“答案内准确”只描述已生成有效答案的样本，不能取代含失败尝试的主准确率。跨模型同时存在宿主、分词器、原生上下文、推理配置和网关差异；表格比较当前接入组合，不是控制了所有因素的基础模型能力榜单。', '',
'## 3. 同题三次的波动', '',
'CV为样本标准差/均值；每行只有3次。失败和0已记录tokens会改变全样本CV，需结合完成次数与summary.json里的completedOnly分布。不同题不能合并后宣称稳定。', '',
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
'本轮新增的通用任务验收器问题是独立的已复现原因：Step保存任务约136 KB，原验收器不读stdin便退出，宿主写入发生EPIPE；同任务同产物只增加stdin drain后通过。不能把它记成模型不会编程、提示词不足或上下文丢失。原失败、挂起和重试成本保留。', '',
'没有进行首轮提示词A/B，因而不声称其贡献比例。已有TASK明确描述目标和交付合同；同一提示既成功也失败。工具参数错误、不可用工具名、重复探索、无变化finish重试属于可观察的执行问题，需与连接终止、缺产物、验收拒绝分别看。持久黑板可保存已checkpoint的事实，不能恢复从未写入的原生工作，也不能自行修复正在失败的模型连接。本轮没有主动断线/跨会话恢复实验，不能据此声称恢复成功率。', '',
'## 5. 非排障任务单列', '', '| 模型 | 原冻结任务完成 | 外部产物合同通过 | 两任务合计CLI秒 | 已记录tokens(M) |', '|---|---:|---:|---:|---:|']
for spec in m['models']:
 x=s['generic'][spec['slug']];lines.append(f"| {spec['slug']} | {x['completed']}/2 | {x['acceptancePassed']}/2 | {f(x['totalSeconds'])} | {f(x['recordedTokens']/1e6,3)} |")
lines += ['', '## 6. 审计与复现', '',
f"当前完整回归291/291；5模型接入探针通过。冻结文件、运行时、任务输入均已核对。原生模型/effort/会话/用量账本核查异常：{len(s['nativeCheckFailures'])}项；原全局配置发生变化：{len(s['globalConfigChanges'])}项，详见summary.json，异常不会隐藏。全部actor独立私有配置的清理记录已检查。", '',
'- 冻结协议：`runs/2026-10-18-five-model-round11/protocol.frozen.md`。',
'- 冻结manifest、运行器、原生会话与每次产物位于同一run目录。已有actor不可覆盖或选择性重启。',
'- `python3 evaluations/public-rca/progress-round11.py` 查看完成进度，不运行隐藏评分。',
'- `assess-round11.mjs` 为冻结引擎的只读完成验收；`analyze-round11.py` 在全批结束及报告审阅封存后统一评分；`diagnostics-round11.py` 仅整理公开错误和原生元数据。',
'- `generic-verifier-replay.json` 与 `verify-generic-stdin-fixed.py` 保留统一适配器复验，不取代原始成绩。', '',
'三题是反复使用的开发案例，存在公开训练数据污染可能；三次重复不是三道新题。Pi只隔离cwd/config/DB/tmp并给出路径约束，没有OS沙箱；Codex使用workspace-write。客户端模型ID不能独立证明网关内部路由。并发5与历史轮次不同，不能将跨轮变化全部归因于框架。', '',
'官方参数背景参照 [Codex CLI文档](https://learn.chatgpt.com/docs/developer-commands?surface=cli) 与 [GPT-6.1-Sol模型文档](https://developers.openai.com/api/docs/models/gpt-6.1-sol)，实际调用身份以本轮原生日志为准。', '']
(here/'comparison-round11.zh-CN.md').write_text('\n'.join(lines))
print(here/'comparison-round11.zh-CN.md')
