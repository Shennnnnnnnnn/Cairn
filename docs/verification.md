# Verification record

## 第九轮：四类对象数组兼容与因果比较

完整构建及272/272回归通过。Pi验证前prepareArguments与共同模型入口统一规范化；上轮三个真实拒绝载荷在本机Pi校验器重放3/3通过，严格字段/版本/所有权不放宽。固定无领域请求的普通增量收据大小保持不变。

真实Pi / global:deepseek-v4.1-flash / high，三题×每组三次，共18新会话，最多3并发、无预算，所有进程结束且报告封存后统一隐藏评分。原生/Cairn联合命中均9/9，完成和有效交付8/9、9/9，错误完成均0；原生连接失败后缺最终REPORT，已有候选与checks正确。格式17/18、数值18/18，Cairn当前完成proof9/9。记录tokens少39.3%、每次有效交付少46.0%，非缓存输入+输出每次少29.1%，CLI累计秒数少24.6%；用量下界，不推算账单。

冻结与记录581/581、原生会话/路由/用量独立核对126/126、额外统计36/36；19份临时私有配置均删除，全局配置未改。Pi无OS级沙箱；两次原生stdout写共享/tmp后删除、一次Cairn尝试外部cd后返回及冻结skill路径读取均已记录。I/O和CPU token成本仍波动；没有跨会话/交接恢复，恢复N/A。详见[完整报告](../evaluations/public-rca/comparison-round9.zh-CN.md)和[实现说明](optimization-round9.zh-CN.md)。

## 第八轮：范围审视、输入兼容和增量收据

2026-10-17（Asia/Shanghai）。通用模型协议优化后完整回归 **267/267**，5项新增测试与真实MCP传输覆盖；保留SDK/完整恢复、失效文件证据、owner/epoch和宿主验收约束。运行前冻结src/dist/skills的85文件，通过独立DB/真实会话/当前验收探针。

同三题开发集，GPT-6.1-Sol/xhigh，18个全新会话，每题每配置3次，最多3并发、无评测预算，全自然结束。18份完整公开报告审阅/哈希封存后统一隐藏评分，冻结与记录审计 **536/536**，独立统计核对 **19/19**。原生/Cairn联合正确9/9、8/9，完成均9/9，有效交付均8/9；契约8/9、9/9，算术均9/9。错误完成0/9、1/9；无效完成均1/9。

Cairn对象/层级由旧8/9到9/9，资源类别由9/9到8/9，仍有一次把IO起因选成memory；联合正确、有效交付及错误完成均未改善。参数错误9→3，8次字符串finding兼容调用直接成功；未覆盖artifacts/handoffs数组同类编码。MCP公开文本259,256→153,797字节（-40.7%）；Cairn记录tokens8,799,979→8,071,199（-8.3%），耗时求和-1.1%。本轮原生5,727,424 tokens；Cairn仍多40.9%，非缓存输入＋输出每有效交付多22.0%，不等同账单。

9个Cairn当前报告/验收proof均有效，19个私有凭据目录（含探针）已删除，全局配置哈希未变；297项标准工具记录/45文件事件完成范围核对。没有确认跨工作区访问；3项已观察缓存惯例偏差、2项历史缓存可能性单列。没有实际恢复尝试，恢复N/A；无新UI验证。

正式记录13,798,623 tokens，合成探针70,877另列。完整方法与逐次结果见[第八轮报告](../evaluations/public-rca/comparison-round8.zh-CN.md)及[实现说明](optimization-round8.zh-CN.md)。

## 三道新题、三次重复：原生 Codex 与新版 Cairn

验证日期：2026-10-17（Asia/Shanghai）。本轮保持第七轮框架不变，src/dist/skills的85个运行文件与此前 **262/262** 回归通过版本逐字节一致。只增加评测代码和记录。固定GPT-6.1-Sol/xhigh，3道此前未实际运行的公开事件×每配置3次，共18个全新会话，最多3个并发、无评测时长/token/调用预算，全部自然结束。目录 `2026-10-17-codex-sol-xhigh-repeated`。

- 历史仅四个窗口；从剩余29个事件按三个时间段和三个资源类别覆盖，最大化无模型的多对象变化代理。保持57个原始CSV全部对象，仅过滤前后600秒。难度代理未独立验证、同一测试床与公开答案污染边界保留；初始全I/O选择草稿在任何调用前归档，零模型成本。
- 18份完整公开报告全部审阅冻结后统一标签评分，冻结与记录审计 **527/527** 通过。9个Cairn任务分别核对真实私有DB、原生owner、宿主验收身份、当前报告和verification，全部当前有效；这不证明标签命中。
- 原生联合对象/类别/层级9/9、Cairn8/9；两组完成9/9。算术均9/9，产物契约原生8/9、Cairn9/9，有效交付均8/9。错误完成（标签错误）原生0/9、Cairn1/9；补充含契约失败的无效完成均1/9。原生内存题一次before/after对象不符字符串契约；Cairn I/O题第三次从shipping服务改为node-5。全部失败保留，不修文件或择优重跑。
- 原生5,547,408／Cairn8,799,979记录tokens；单次耗时中位5.75／7.70分钟，耗时求和52.81／69.84分钟。Cairn记录总tokens多58.6%、时间多32.3%；每有效交付693,426／1,099,997 tokens。未缓存输入＋输出的每有效交付差20.4%；记录用量含缓存，不估订阅金额。
- 每题tokens CV原生3.0%–17.7%、Cairn6.6%–23.5%；时间CV原生0.9%–6.2%、Cairn2.8%–14.4%。均未触发预定CV>25%或max/min>2，但三次相同不证明长期稳定，同题重复不能当作九道独立题。
- 326条标准命令/MCP记录、45个文件变更事件完成静态扫描，所有标记项人工复核；另记录一次失败补丁包装，其后两项未派发，静态代码出现次数不当作执行次数。无确认越界，四次条件缓存清理无法确认历史存在，不宣称OS隔离或穷尽脚本内部行为。私有凭据副本及探针副本均删除，全局配置哈希未变。
- 无实际恢复样本，恢复N/A，无新UI浏览器验证。探针额外86,490 tokens单列。完成后的统一格式/算术拆解使用原冻结组件，不改变原组合验收、标签规则或主指标。

完整逐次结果、失败归因、用量拆解与限制见 [重复对照报告](../evaluations/public-rca/comparison-codex-repeated.zh-CN.md)、[启动前协议](../evaluations/public-rca/protocol-codex-repeated.zh-CN.md)。本轮没有证实Cairn改善诊断准确率或有效交付效率。以下保留历史记录。

## 第七轮 Codex Sol 极高、事实版本与终态交接

验证日期：2026-10-17。完整生产构建及 **262/262** 测试通过。同一较难公开题 `case-03` 使用本机 Codex CLI 0.163.0-alpha.10.2、`gpt-6.1-sol/xhigh`，原生、冻结上一版、修改前及修改后 Cairn 各一个全新会话，不设评测预算，最大并发三组。正式目录 `2026-10-17-codex-sol-xhigh-round7b`，冻结与记录审计 **852/852** 通过。

- 显式引用已声明产物的 finding 绑定宿主计算的文件摘要；文件变化使有效覆盖、报告和验收过期，单独更新 artifacts 或 finish 不刷新旧事实。显式重新保存后绑定新版本，精确重试保持幂等，旧数据无追溯补证。候选报告、异步验收、匿名依赖别名和伪造宿主字段均有回归。
- 完成后的当前 agenda/交接停用旧行动并保留历史；旧数据库也通过只读投影生效。重开立即生成新 owner/epoch 交接，最多三条的恢复上下文保留 host/state；worker、挂起与接管边界保持。仍为五工具、短 finish，无新增依赖或后台模型。
- 首批三个 MCP 未收到 CAIRN 环境变量，误写默认 DB 且无运行中 verifier，整批四次作废。安装器显式 env_vars 转发变量名；评测加独立 --db、Git 内合成产物探针和真实任务 owner/验收身份核对。首批及探针共 3,614,407 记录 tokens 排除并保留，不计为模型失败或成功样本。
- 纠正后的四组均自然结束。逐份完整报告审阅冻结后再统一隐藏评分，完成/独立数值复算/对象＋类别均 **4/4**，错误完成 **0/4**；三组 Cairn 各自冻结引擎的内存检查确认报告与验收 proof 当前。修改版有4条绑定文件版本的事实。
- 修改前→后为410.54→395.71秒、1,001,652→681,455记录 tokens（-3.6%/-32.0%）；原生为316.64秒/472,280 tokens，仍最低。修改版仍有一次 checkpoint 对象字符串化及一次自写验证脚本失败后修正。单题、每组一次、不同宿主与推理等级限制模型/框架归因；不宣称准确率或稳定成本改善。
- 无实际超时或上下文恢复，恢复 N/A；回归不当作真实恢复率。本轮无新 UI 浏览器验证。四个私有凭据目录已删除、凭据未归档，临时测试包装器已清理，全局 CLI 配置哈希未变。

详见 [最终实测与历史模型比较](../evaluations/public-rca/comparison-codex-round7.zh-CN.md)、[实现与后续优先级](optimization-round7.zh-CN.md)。以下历史结果保留。

## 第六轮模型协议、增量 checkpoint 与自动交接

验证日期：2026-10-17。生产构建及 **242/242** 测试通过；真实 Pi CLI 本地探索／完成修正夹具分别 10／11 请求通过。DeepSeek 接入探针 13.04 秒、26020 tokens 单列。正式 `2026-10-17-aiops2022-round5` 用 global:deepseek-v4.1-flash/high 重新运行原生 Pi／旧版冻结 Cairn／新版 Cairn 各四例，十二个主阶段、十一段恢复全部结束后才生成隐藏评分；冻结检查 **923/923**。

- MCP、Pi 与自定义模型循环的 `invokeModel` 统一收窄 finish 为 outcome／summary，旧 SDK invoke 保留兼容。模型 checkpoint 要求 keyed Finding、显式 status／covers，拒绝摘要空转，事实精确重试不推进 revision。
- 宿主自动交接固定 source owner／epoch／revision／candidate，分支保存真实 worker 与 branchKey。SQLite 正文持久，私有 Markdown 是可选投影；失败不丢正文、不冒充接收方 ACK。新增回归验证幂等、重启、投影失败、旧会话／worker fencing 和验收指纹稳定。
- 十二个主阶段完整交付均为 0；含必要恢复旧版正确交付 4/4，新版和 Pi 为 3/4。已交付中的错误为 0/4、0/3、0/3，不代表未完成任务正确。新版最后一例没有 checkpoint，初始与恢复都没交付。Pi 网络例单次 length 退出，无额外恢复；没有时间超时样本。
- 新版成功恢复的 finish 最大 478 字节；主阶段事实更新覆盖 3/4，对照旧版 4/4。自动快照 7 份、含事实 3 份。各自冻结引擎的数据库副本基础恢复 8/8；完整有事实交接定位新版 3/4、旧版 0/4，非模型恢复率。
- 含恢复耗时旧版 1091.69 秒／新版 1134.98 秒；已记录 tokens 至少 5535666／5579487，金额未知。整体完成率、准确交付与成本没有改善；输出预算感知和模型不提交事实仍是工作流缺口。
- 23 份输出记录独立审阅，数值通过仍有单位、窗口、因果与拓扑问题。74 个显式文件路径与 410 条 bash 文本扫描标出两处相对切目录，人工确认均在本工作区 evidence 内；不据此声称 OS 隔离或证明所有动态路径。
- ego-browser 检查 33 项复盘列表、成功续接的 replay／结论通过、交接文件／会话定位、CPU 主任务未提交完整快照导致审查过期、网络主任务零事实／未评定。截图 `docs/images/dashboard-round5.png`。源状态 33/33 哈希未变，测试空间已清理，8012 保留。
- skill 的 7 段 JSON 通过实际模型 schema，当前指南 28 段 JSON 语法通过；source/dist/skills 的 85 个当前文件与冻结版本一致。

详见 [第五轮公开比较](../evaluations/public-rca/comparison-round5.zh-CN.md)、[第六轮实现](optimization-round6.zh-CN.md)与 [UI 入口](public-rca-ui.zh-CN.md)。以下保留历史记录，不能把 Kimi 跨模型差值归因为代码效果。

## 第五轮探索黑板、完成入口与独立结论状态

验证日期：2026-10-17（Asia/Shanghai）。生产构建及 **235/235** 测试通过，真实 Pi CLI 完成修正／探索闭环夹具各 9 请求通过，均使用本地模拟 API。正式 `2026-10-17-aiops2022-round4b` 的八个主阶段与两段恢复结束，冻结记录 **538/538** 通过。

- 新增有界探索议程、无逐工具遥测的去重提醒、已有事实／短输入完成、宿主必需文件自动收集；摘要仍不充当证据，未决假设不能作为短 finish 前提。自动收集的顺序／描述保留缺陷已先复现再修复并重跑全部正式案例。
- UI 与导出区分流程完成、产物验收和限定范围的结论审查。可信宿主通过 `Engine.assess` 写入绑定 proof／epoch 的审查，Agent 公共工具不能自报独立正确性。更换文件或候选后旧审查过期。
- Cairn 联合命中 3/4（上轮 2/4、同轮 Pi 3/4），主阶段完成 2/4（上轮 4/4、Pi 4/4），完成且复算正确交付 1/4（上轮与 Pi 均 2/4）。错误完成为 1/4，但已完成任务中的错误比例仍为 1/2＝50%。四例各一次，不能认定因果改善。
- Cairn 主阶段 2640.81 秒、至少 2765106 tokens，较上一轮观察耗时多 59.3%、记录用量下界高至少 20.5%。两次输出预算停止后，仅 CPU 续接成功；恢复共 351.82 秒、至少 283552 tokens。金额未知。
- 七次中途 checkpoint，五次摘要、两次结构化 Finding，最终十一条前提边；网络例成功使用短 finish，仍两次纠错。四个主阶段 handoff 均为零；副本基本接管保留检查通过，包含交接定位的完整重载检查 0/4，未实际覆盖有 handoff 的 focus 恢复。
- ego-browser 在当前 bundle 核验本轮网络例“已完成＋replay passed＋结论审查未通过”、审查范围、同页 CPU 主任务／续接任务切换及十八项列表。截图 `docs/images/dashboard-round4b.png`；原始来源状态 18/18 哈希未变，浏览器测试空间已清理，本地 8012 复盘服务保留。
- 主阶段 56 项显式路径与 131 条 bash 文本、恢复八项文件参数与十一条命令未观察到隐藏评分读取；评分只在所有模型结束后执行。未配置 OS 沙盒，不据扫描声称严格隔离。排除试运行另计 1041.04 秒、至少 1096745 tokens。

本轮整体交付效率回退；完整结论见 [第四轮公开比较](../evaluations/public-rca/comparison-round4.zh-CN.md)、[工程第五轮](optimization-round5.zh-CN.md)与 [UI 入口](public-rca-ui.zh-CN.md)。[OpenRig 设计对照](multi-session-reference.zh-CN.md)只用于多分支／会话边界与后续可选适配，不代表新派发能力已实现或实测。以下旧轮记录保留。

## 第四轮产物验收、分层交接与四例真实复验

验证日期：2026-10-17（Asia/Shanghai）。生产构建与 **225/225** 自动化测试通过。正式真实模型运行 `2026-10-17-aiops2022-round3c` 的八次主阶段及一次 Pi 恢复全部结束，冻结实现与记录完整性检查 **537/537** 通过。

- 显式提交普通文件，由宿主计算 SHA-256／字节数；必需文件、验收前后变化、通过后变化及 owner epoch 变化都会影响当前验收。独立验证器返回 method／scope；数值可复算不等于根因正确。
- 分层交接保存有 key 的追加记录、相关 Finding／work、报告与原会话定位；context 优先保留 focus 相关旧前提并保持预算。仍保留五个公共工具与 SQLite 状态，不增加后台模型。
- `serve / submit / status / graph / hint` 复用现有 UI 与共享任务状态。submit 返回 host-managed 任务，由原生宿主接管执行；独立 review 阶段不属于本轮。
- 同四例：新 Cairn 首选对象 3/4、对象＋大类 2/4，四个任务均完成、文件契约与数值复算均通过；两次错误完成 / 全部仍为 50%。旧 Cairn 对象 4/4、联合 2/4、完成 2/4、超时 2/4；因此不能声称准确率提升或绝对错误数下降。
- 新 Cairn 主阶段合计 1657.67 秒、2294918 tokens；同轮 Pi 2066.26 秒、至少 1628378 tokens，首选联合 4/4，其中一例输出预算停止、缺报告。新 Cairn 观察耗时比旧轮少 29.3%，旧轮 usage 为下界，本轮契约也有变化，不能推导金额节省或因果收益。
- Pi 预算停止例用新会话 142.78 秒、83480 tokens 补齐报告并保留原有正确诊断。Cairn 没有自然恢复样本；另对四份真实数据库副本做重开接管与旧验收失效检查，4/4 通过，这不是模型超时恢复成功率。四组 handoff 都在收尾保存，中途断线收益仍待实测。
- 主阶段路径扫描无可疑项；Pi 恢复曾列父目录文件名，未观察到隐藏评分内容读取。未配置 OS 沙盒，扫描不能证明隔离。两次排除试运行保留并单列至少 855376 tokens，不复用其结果。

完整方法、逐例语义问题、成本与限制见 [第三轮公开案例比较](../evaluations/public-rca/comparison-round3.zh-CN.md)；实现见 [第四轮优化记录](optimization-round4.zh-CN.md)和[产物／交接协议](artifacts-handoffs.zh-CN.md)。以下旧轮记录保留为历史。

## 第三轮必要修复与原版机制借鉴

验证日期：2026-10-17（Asia/Shanghai）。完整生产构建及 **211/211** 回归通过，其中 13 项新场景覆盖完成修正反馈、语义无进展、匿名重试及依赖别名、captured 条件覆盖、前向引用、分支隔离、Hint／探索变化、跨会话恢复、外部验证计数和收尾优先级。

- incomplete finish 返回有界 `repair`，明确缺失条件与补证／挂起动作；原样重试不会生成新匿名 Finding，也不会自动分配覆盖。修改摘要或进度文案不算新事实。
- 收尾窗口内不再回退到一般探索 continuation；两种证据模式过期后保持收尾优先，仅 Cairn 管理工具循环也可触发预算提醒。仍依赖宿主回调，不是独立超时监管器。
- 最终构建通过真实 Pi CLI 本地协议夹具：原场景 **7 请求**；新增 `--completion-feedback` 场景 **9 请求**，实际核验 incomplete → 重试 → suspended → epoch 2 接管 → 补齐条件 completed，未使用真实模型凭据。模拟模型只能证明协议行为。
- 技能文件的本地引用、JSON 示例和实际调用通过；脚本语法及差异检查通过。两篇原文分析、实际移植与仍待改进的范围见 [第三轮记录](optimization-round3.zh-CN.md)。
- 本轮没有新增四例真实模型运行；以下第二轮冻结比较保留为历史记录，不能据本轮代码回归声称准确率、延迟或用量改善。

## 第二轮通用优化与同四例复测

验证日期：2026-10-16—17（Asia/Shanghai），Pi 1.1.0、Node.js 24.19.0、配置模型 kimi-k3、实际 thinking=high。

- 完整构建及 **198/198 测试**通过；真实 Pi CLI 本地协议夹具 7 请求通过，跨会话接管到 epoch 2；可选验证器控制 12/12。实际 provider schema 探针通过后冻结实现并重新执行全部八次，中止启动及其额外用量另行保存。
- 同四组输入、原提示、评分、模型和每例 720 秒预算；Cairn 配置 90 秒提交预留及只检查产物契约的宿主验证器。按预先冻结的服务协议别名政策，本轮 Pi 对象／联合命中 4/4、4/4；Cairn 为 4/4、2/4，联合命中与第一轮相同。未经别名复核的原始联合分数为 Pi 3/4、Cairn 1/4，报告并列保留。
- Cairn 的 checkpoint 缺 summary 错误 20→0，写入回执中位字节 3659→777；仍有五次 incomplete finish 与一次输出截断工具错误。用时合计 Pi 1886.75 秒、Cairn 2345.95 秒；Cairn 两次进程超时，Pi 无超时。错误或中断的 token 按已记录下界报告。
- 两个 Cairn 任务 completed 且外部验证通过，类别均错误；另两个答案联合命中，但任务 active、进程超时。网络例保存一次 reserve 提醒仍未及时完成，CPU 例无提醒；宿主回调提示不能打断在途 API。当前验证器不校验数值与因果，其通过不等同排障正确。
- 实验记录检查 **54/54**、冻结实现及跨轮配置检查 **66/66**；八份答案逐例独立复算至少两项数值，仍发现窗口、单位、缺失值与反证问题。模型工作区未使用 OS 沙盒，路径扫描不视为严格隔离证明。
- [完整第二轮比较](../evaluations/public-rca/comparison-round2.zh-CN.md)与[实现验收记录](optimization-round2.zh-CN.md)记录结果及限制。单一测试床、每条件每例一次，不支持普遍准确率、显著性或稳定性能收益结论。

## 公开 AIOps 2022 案例对照

验证日期：2026-10-16（Asia/Shanghai），Pi 1.1.0、Node.js 24.19.0、配置模型 kimi-k3、thinking=high。

- 从同一天/同一测试床的公开比赛标签按时间取前四例，覆盖写 I/O、节点 CPU、容器内存、服务网络；运行 Pi / Pi+Cairn 共八次，输入和评分脚本预先固定。
- 首选对象＋类别联合命中 Pi 3/4、Pi+Cairn 2/4；服务协议后缀单独透明复核后，对象首选命中 3/4、4/4。四个 Cairn 保存任务都 completed 并通过 SDK 结构评估，内存类别仍错误、网络类别保留 unknown。
- 观察用时合计 Pi 2054.4 秒、Pi+Cairn 2614.5 秒；一例 Cairn 进程到达 720 秒上限，答案与 completed 状态此前已保存。两组均出现恢复后的 API 错误，token 只报告已记录下界，不估计金额或普遍性能收益。
- 54/54 项实验记录一致性检查通过；逐例语义复核仍发现单位、反证和数字问题。四次 Cairn 运行出现 20 次缺 summary 的 checkpoint 错误，另有一次修复后的分析脚本错误；schema/runtime 不一致另用内存数据库无模型复现。
- [最终报告与工程结论](../evaluations/public-rca/comparison.zh-CN.md)记录来源、原始与复核分数、超时、用量和语义审阅。此轮为指标切片离线诊断，不验证在线修复、多 worker、跨宿主接管或主动丢失原生上下文后的恢复。

## Pi 双案例真实模型对比

验证日期：2026-10-16（Asia/Shanghai），Pi 1.1.0、Node.js 24.19.0、配置的 kimi-k3，双方实际推理级别 high。

- 两份本地合成案例各执行 Pi 与 Pi+Cairn，共四个实验单元、六段真实模型执行；两阶段诊断均保留原生 Pi session。
- 代码修复双方通过相同独立检查 27/27；实际公开及新增测试分别为 28、15 项。
- 诊断复核双方文件均给出 84/1000 个错价请求。Cairn 复核触及共同的 240 秒硬时限，状态仍为 active、0/4 条件覆盖；保留超时现场，未将其计为成功完成的 Cairn 目标。
- 92 项实验记录一致性检查通过；质量规则分、关键词漏报、人工核查、provider 用量和单次样本限制均见[对比报告](../evaluations/pi-ab/comparison.zh-CN.md)。这些记录不代表全部宿主或跨会话丢失上下文场景的评测。

## 通用 Harness、原版思想恢复与人工协作

验证日期：2026-10-16（Asia/Shanghai），Node.js 24.19.0。

- `npm test` 完整通过 **186 项测试**，包含 TypeScript 检查、独立 bundle 和 ESM／类型声明构建。原有 captured／curated、网关回执、报告冻结、安装与跨宿主恢复测试保持通过。
- 新增回归覆盖：同批无序多源依赖、歧义引用、间接环路原子回滚、动态图超过五层、规范引用重试幂等；Claim 历史与完成快照、反馈重开和重新验收；受限分支提案、主会话审核与显式认可、过期／回收／暂停／接管后的 token 失效；长键可审核且不会跨分支碰撞；分支问题与下一步恢复。
- 同 native session 的旧工具连接固定绑定 epoch，人工暂停恢复或 reopen 后不能自动获得新写入权。相同 Owner 恢复暂停任务时，旧 captured 调用仍为 audit-only。
- 人工 HTTP 操作实际验证 loopback 监听、同源／Host 约束、CSRF、JSON 类型、请求大小、revision 冲突、Hint／暂停／重开以及 SSE 更新；初次沙箱禁止监听的环境错误在允许回环监听后重跑通过。
- 隔离的全局打包安装测试实际导入 ESM harness，返回相同五工具，确认安装包携带类型声明且无需运行时 npm 依赖。
- ego-browser 使用独立 SQLite 与明确标注的模拟任务，验证多跳图、结论修订展开、页面 Hint 提交、暂停后运行节点归零、已完成任务按反馈重开后目标条件变为待满足。浏览器测试空间和临时 HTTP 服务已清理。
- `docs/images/harness-graph.png` 是上述真实浏览器截图，内容为模拟数据；它不代表新的真实模型推理质量评测。没有重新声称验证全部宿主真实模型的闭环表现。
- 共享 skill 的 `quick_validate.py` 通过；13 个新增／更新 JSON 示例和本地文档链接检查通过；`git diff --check` 通过。SDK 引用验证与 conclude 引导的实际限制见 [接入指南](harness.zh-CN.md)。

Record date: 2026-10-15 (Asia/Shanghai). Results below identify the evidence mode and distinguish automated integration checks from real model executions.

## Cairn 3.1 MCP defaults and Multica installer

Verified locally on 2026-10-15 (Asia/Shanghai).

- **172 automated tests passed on Node 26.3.0 and Node 24.19.0**, including the shared build/typecheck. Shared skill validation and 11 JSON / 38 shell documentation blocks passed.
- Real stdio tests cover bare `cairn mcp` identity generation, startup without model-supplied session IDs, cross-directory recovery, explicit takeover and rejection of old connections. Generic MCP preferences remain independent of UI preferences; native adapters retain their actual-session requirements and workspace database selection.
- Multica installer tests use a deterministic injected runner: exact workspace/agent selection, remembered defaults, existing-registration adoption, unrelated binding preservation, known old-skill migration, user-edit protection, repeated updates and partial failure reconciliation. Runtime bundles/configurations are immutable versions; old successful receipts remain available. Interrupted skill upgrades retain the full prechecked baseline for retry.
- Global installer tests verify forwarding Multica options to the actual globally installed copy, source-independent paths, argument boundaries, failure propagation and archive cleanup. Without `--target`, global installation keeps its existing command-only behavior.
- Compatibility checks cover Multica write commands returning `null` or acknowledgement payloads: the installer confirms MCP identity and created skill content through subsequent reads, rather than assuming a full object response.
- Actual local Multica 0.4.41 setup was upgraded through `npm run install:global -- --target multica ... --adopt`. The partial receipt from an initial response-format mismatch was recovered by retry. A subsequent parameter-free `cairn update --target multica` reused the same MCP and skill IDs in the saved workspace. Doctor confirmed both bindings enabled and the installed runtime present; the imported skill matched the source. Model, effort, service tier, runtime, instructions, custom arguments, concurrency and access settings matched their pre-install snapshot.
- The actual generated MCP entry was exercised with an isolated temporary database and a PATH without Node: automatic identity, checkpoint, pause, cross-directory takeover, stale-owner rejection and completion passed, with zero tool records. This is an installed-runtime stdio protocol check, not a new Multica model reasoning run. MCP and UI preferences were confirmed to select the same persistent database.
- Multica MCP configuration is write-only. Doctor reports remote registration/binding state and the locally recorded last successful configuration; it cannot independently read back the server entry's full contents. This integration provides the generic curated MCP workflow, with explicit checkpoints/recovery rather than native capture hooks.

## Cairn 3.0.2 shorter dashboard command

Verified locally on 2026-10-15 (Asia/Shanghai).

- **137 automated tests passed on Node 26.3.0**, including typecheck and bundle build. The seven new preference/CLI tests also passed on Node 24.19.0.
- Real CLI subprocess tests verified that a successful `cairn ui --db FILE --remember` saves the database and a later plain `cairn ui` from another directory serves that same task data. Explicit `--db` and `CAIRN_DB` override the preference. `cairn task list` still selects its workspace database. `--forget` clears the UI preference and exits; subsequent UI startup uses the workspace database again.
- With port 8000 occupied, a plain UI command selected a free loopback port. An explicit occupied port failed and did not replace saved settings. Test subprocesses and temporary configuration were isolated and cleaned up.
- Unit checks covered private, atomic preference writes, cross-directory absolute paths, malformed settings with a recovery instruction, and clearing missing settings. UI layout and domain semantics were unchanged; the graph/browser verification below remains applicable.

## Cairn 3.0.1 relationship graph as the main view

Verified locally on 2026-10-15 (Asia/Shanghai).

- **130 automated tests passed on Node 26.3.0**, including typecheck and bundle build. The 12 graph/state projection tests also passed on Node 24.19.0.
- The separate task-progress tab/board and its header counters were removed. The graph now includes a distinct starting point and full goal, recorded work stages, basis/observations, conclusions and acceptance conditions. It reuses the earlier UI palette from commit `930c037`: teal start, rose goal, indigo completed/formed results, amber running work and pale dashed pending work. A satisfied goal retains its role color and receives a green check.
- New projection tests cover real evidence paths, connected starting context, explicit work-state colors, no invented dependency between plan items, no invented execution stages in legacy tasks, stale running suppression after pause/completion, and nonoverlapping nodes within bounds in both layouts.
- ego-browser verified an explicitly labelled synthetic fixture: graph selected by default, no progress-board tab, all nodes within the canvas in horizontal and vertical layouts, correct colors, stage detail inspection, zoom/fit and fullscreen entry/exit. Pausing from another SQLite connection updated through SSE without reloading: the running stage became blocked and all running edges disappeared.
- `docs/images/dashboard-graph.png` is the actual browser screenshot of that synthetic fixture. It is a UI demonstration, not a new model execution or a diagnostic-quality evaluation. The earlier progress-board screenshot and verification record below are historical.

## Cairn 3.0 goal workflow and progress UI

Verified locally on 2026-10-15 (Asia/Shanghai).

- **124 automated tests passed on Node 26.3.0 and Node 24.19.0**; typecheck and self-contained bundle build passed. The shared skill validator passed.
- Public five-tool tests cover default curated creation without an upstream or tool whitelist, findings with explanations/file/URL references, visible milestones, suspension, cross-host takeover, stale-owner rejection and completion/export. Calls and observations remain empty throughout.
- Pi, Claude Code and Codex normalized native events leave curated tools unrestricted and unrecorded. Shared adapter tests cover milestone/reference recovery for all three hosts. Curated hooks skip uncorrelated native plan results, including delayed plans after the same session changes goals. Captured Codex plans require a reserved eligible call belonging to the current task and epoch.
- Completion checks reject unsupported findings, cross-task report references and conclusions whose declared scope does not cover the goal. Imported inconsistent scope associations are independently rejected by evaluation. Curated checks validate recorded relationships, not external reference contents or causal correctness.
- General curated tasks have no call/concurrency quota; unobservable quota settings are rejected. Deadlines are advisory. Explicit captured and emergency constraints, receipt reconciliation, report freezing and human confirmation remain covered by regression tests. Repeated unsuccessful finish checks are visible and deduplicated; progress checkpoints preserve the final report summary.
- ego-browser inspected the installed blue-and-white UI. A separately labelled synthetic curated fixture displayed one running, one completed and one pending milestone, with goal coverage 1/2. A second SQLite connection paused it: SSE changed running to zero and retained blocked work without reloading. Explicit new-session takeover retained findings and did not invent running work. The basis view contained the submitted explanation/file reference and no raw-tool section.
- The already completed real Codex 2.1 captured example was opened with the new UI: 0 running, 2 completed criteria; milestone timeline distinguished evidence review, pause, takeover, failed completion check and completion. Its six observations and original records were preserved. This UI check is not a new real-model run in curated mode.
- `docs/images/dashboard-v3.png` is an actual browser screenshot using explicitly labelled synthetic data, not a model reasoning evaluation. The Chinese workflow guide explains the six design questions and provides a free-tool, pause/resume example. Earlier captured examples explicitly opt into captured mode.

These checks do not establish a new real-model closed loop in all three CLIs. Historical live runs and deterministic native-CLI fixtures remain recorded below, with their original limits.

## Cairn 2.1 global command and complete example

Verified locally on 2026-10-15 (Asia/Shanghai).

- **89 tests passed on Node 26.3.0 and Node 24.19.0**. Typecheck/build passed. The new checks cover global package installation, the diagnostic example and stdio EOF cleanup; the earlier 79 tests remain included.
- `npm run install:global -- --cache /private/tmp/cairn-npm-cache --offline` installed a real global package at the configured npm prefix. From `/private/tmp`, `cairn --version` returned `2.1.0`; the command resolved to `/opt/homebrew/lib/node_modules/cairn/bin/cairn.mjs`, independently of this checkout.
- Automated packaging checks use an empty npm cache and temporary prefix, remove the source fixture, then verify version/help, all three host plugin installations, actual MCP startup and Pi extension import. The installed package has no runtime npm dependencies or source symlink.
- Global `cairn demo --no-ui --delay 0 --json` completed actual stdio MCP calls in two connections, saved four Gateway observations with demo references, preserved a refuted hypothesis, explicitly took over at epoch 2, and exported consistent Markdown/HTML/JSON plus execution logs.
- Global `cairn demo --port 0 --delay 3000` was inspected with ego-browser. The page showed suspended progress at 0/2, then completed at 2/2 with one takeover and four observations, without navigation/reload. Mapping evidence exposed the original `source_price * 100` expression. All 15 graph nodes fit the canvas after live growth.
- The example uses fixed steps and explicitly fictional data. It calls no external model and does not establish reasoning quality or performance of Pi, Claude or Codex. `demo --prepare --target HOST` creates a separate native-CLI workspace for users to run with their own model/account.
- Preparation rejects nonempty directories. The generated prompt explicitly binds `CAIRN_DB`, including when the sample is nested inside another Git repository. The deterministic driver refuses a different database or modified upstream configuration. Abort tests preserve incomplete progress and verify that child processes exit.
- `docs/examples/price-incident.zh-CN.md` documents the complete sequence, actual tool arguments and results, short references, report artifacts and the native-host alternative. Its screenshot comes from the globally installed command.

## Cairn 2.0 verification

Verified locally on 2026-10-15 (Asia/Shanghai), with the current five-tool protocol. Model/provider failures below are recorded separately from protocol integration results.

| Check | Current record |
| --- | --- |
| Typecheck, build and complete automated suite | 79 tests passed on Node 24.19.0 and Node 26.3.0; includes build/typecheck |
| New five-tool MCP lifecycle and typed upstream schemas | Passed real stdio transport, one-time session binding, short references, schema defaults and concurrent catalog loading |
| Pi 1.1.0 native lifecycle and new-session recovery | Passed actual Pi CLI against a deterministic loopback model fixture: 7 requests, native read → E1 → one finish/suspend → takeover → finish; 1 observation, epoch 2 |
| Claude Code 2.1.296 hooks/MCP lifecycle and recovery | Passed actual CLI against a deterministic local Messages API fixture: 7 requests, 1 native observation, new-session takeover, completed at epoch 2 |
| Codex CLI 0.162.0 hooks/MCP lifecycle and recovery | Passed with the configured live model and a goal-level prompt: native read, evidence-backed suspended checkpoint, new-session takeover and completion; 1 observation, epoch 2 |
| Blue-and-white dashboard | Passed ego-browser checks using explicitly labelled simulated data: checkpoint summary/questions/next, E1 raw evidence, and live criterion coverage 1/2 → 2/2 with status completed and no page reload |
| Shared skill/manifest and package | Shared skill validation and Claude plugin validation passed. Package dry run includes all three self-contained manifests, UI runtime and Chinese README |
| Documentation checks | JSON examples, shell/JS syntax and git diff whitespace checks passed |

Pi's two configured-live-model attempts were interrupted by upstream 429 rate limits and 503 service-unavailable responses. The second attempt successfully called `cairn_start`, then failed before reading evidence. No provider/model configuration was changed. Claude's configured-live-model attempt failed before inference because its existing OAuth session was expired and could not refresh. Local fixtures validate actual CLI integration and recovery; they do not prove model reasoning quality.

New regression cases cover task identity pinned per connection, refusal to abandon another active goal on resume, cross-workspace takeover, original-task routing of late native results, execution epochs (including old calls without epoch), proposed findings remaining proposed on text edits, complete metadata/audit paging after recovery truncation, and concurrent typed-catalog loads without duplicate tools. Existing 1.x-style SQLite claims/reports resume through the new interface without being rewritten.

The screenshot in `docs/images/dashboard.png` uses marked simulated/manual observations. It demonstrates the UI rather than a real incident diagnosis.

### What the new verification must cover

- A simple start → native read → finish workflow, without separate claim, satisfy or report calls.
- One-time MCP identity binding, Pi native identity, cross-CLI takeover and rejection of stale owners.
- Stable E# aliases, atomic checkpoint revisions, counterevidence, criterion coverage, automatic report references, failed finish returning gaps, suspension and repeated finish handling.
- Recovery context size/truncation and complete on-demand evidence/history retrieval, including pre-existing TypeScript 1.x tasks and reports.
- Original upstream schemas, injected submit fields, concurrent connection reuse, cancellation/timeout isolation, raw failures and safe receipt reconciliation without repeated external submission.
- Accurate declared/observed capability reporting and missing-hook behavior.
- Read-only dashboard behavior, live cross-process progress and original evidence inspection.

Reproduce deterministic checks from the repository root:

```sh
npm test
npm pack --dry-run
```

Opt-in host executions use the current configured account and may consume quota:

```sh
node scripts/host-smoke.mjs pi
node scripts/host-smoke.mjs claude
node scripts/host-smoke.mjs codex
node scripts/pi-fixture-smoke.mjs
node scripts/claude-fixture-smoke.mjs
```

The Pi and Claude fixtures run actual CLIs against local Messages API fixtures instead of external models. Pi uses a separate blank credential store and a loopback-only dummy provider. Each smoke test prints and retains its temporary logs. Temporary hook trust in tests does not replace normal installation review.

## Historical checks — 1.x protocol and initial dashboard

The following checks were recorded before the five-tool refactor. Their model protocol used create/capture/claim/satisfy/report/suspend/complete. They document earlier integration behavior, not acceptance of the 2.0 interface.

### Automated and browser checks

- `npm test`: 40 tests passed on Node 24.19.0 and Node 26.3.0, including typecheck and build.
- Real stdio MCP client/server lifecycle: create, capture, claim, report, cross-host takeover and completion.
- Fixture upstream: whitelist discovery, genuine result references, failed calls, cancellation, submission gates, missing receipts and reconciliation.
- Pi/Claude/Codex normalized events: capture, restoration, duplicate events, interruption and ordinary work after suspension.
- Project/user installation: merging, repeated updates, uninstall, preflight conflicts and retention of modified registrations.
- Core: contradictory/unsupported claims, invalid scope, unrelated citations, late results, budgets, crash recovery, in-flight report freezing and shared match deadlines.
- Claude plugin manifest and shared skill validation, shell syntax and `git diff --check` passed.
- Package dry run included the CLI and all three self-contained plugin manifests. The standalone HTML export was opened in ego-browser.
- Dashboard HTTP/SSE checks covered criterion counts, report validation, same-task evidence isolation, read-only routes, cross-origin/Host rejection, export, occupied ports and changes from a second SQLite connection.
- Browser checks used explicitly labelled demo data: original blue-and-white overview/detail layout, raw evidence, graph orientation, hints/logs, resizing and progress changing from 2/3 to 3/3 without reloading.

### Actual host executions with the old protocol

| Host | Historical version | Historical result |
| --- | --- | --- |
| Pi | 1.1.0 | Configured live model passed native read, captured observation, supported claim, report, suspension, new-session takeover and completion at epoch 2 |
| Codex CLI | 0.162.0 | Configured live model passed the same lifecycle using scoped hooks/MCP without global plugin-cache activation |
| Claude Code | 2.1.296 | Actual CLI passed against a deterministic local Messages API fixture, including hooks, MCP, Read and takeover; 12 protocol requests |

Claude's separate historical live-model attempt failed before inference because the existing OAuth session was expired and could not refresh. No account credentials were changed. The local fixture verified integration behavior, not model diagnostic reasoning.

The historical Codex test approved only its temporary Cairn MCP server and trusted generated hooks for that invocation. These policies were not installed into normal user configuration.

## Integration inputs and limits

- The official competition whitelist, schemas and result/scope/receipt mappings remain external inputs. `profiles/emergency.example.json` is a template, not a verified connection to the organizer.
- Host coverage varies. Codex hosted tools can bypass local hooks. MCP-only setup cannot capture arbitrary native tools; typed gateway calls are its automatically recorded execution path.
- Reference validity and schema/state tests cannot prove causal correctness. Labelled cases in `evaluations/emergency-cases.json` support separate model assessment. No contest score, improved diagnostic accuracy or measured task-latency reduction is claimed.
- TypeScript 1.x SQLite task records are retained and tested to resume through the new protocol; no compatibility is offered for the removed 16 public tools. Older Python APIs/database formats are not automatically migrated.


Submitted-file integrity and the distinction between replay, inspection, contract checks and semantic correctness are specified in [artifacts and handoffs](artifacts-handoffs.zh-CN.md).
