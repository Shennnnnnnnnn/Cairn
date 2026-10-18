# Verification record

## 当前 4.9 主线整合 — 2026-10-18

- `npm run check` **450/450 通过**：TypeScript、重新构建、HTTP/SSE、SQLite、安装打包、六工具、来源复核、自然时间回放、调度与恢复均通过。
- 新增 4 项跨分支回归覆盖：完整图中的共同前提与租约脱敏；阶段用量去重和缺测；worker 禁止确认全局复核及旧快照留下新反馈；auto 识别主线语义分支且保留完成门槛。
- 实际安装的 Pi CLI 通过隔离的本地 Messages API 夹具：curated、captured、完成反馈、探索恢复。夹具显式使用无真实凭据的 loopback provider，验证协议和恢复，不评估模型推理。
- 源码/脚本语法检查：126 个 Python 文件与 110 个 JavaScript 文件通过；23 份当前指南的本地链接完整。
- ego-browser 实际检查合成看板：用量与独立状态同时展示；自然时间回放还原历史数值，历史视图隐藏写操作；返回实时、报告和暂停通过。截图见[4.9 看板](images/dashboard-4.9.png)，不接触既有任务库。
- 当前文档入口为[文档导航](README.zh-CN.md)，合并边界见[4.9 说明](integration-4.9.zh-CN.md)。历史截图、轮次与成绩不代表本次代码的模型效果。

下文按当轮记录保存；旧测试总数、五工具描述和已退役接口属于历史事实。原始运行目录中的 JSON／会话链接可能只存在于本地归档，不是发布包依赖。当前安装与模型 API 以六工具指南为准。

## 历史验证记录

以下包含 2026-10-16 至 2026-10-18 两条开发线的记录。
## 可选启动策略与自动选路 — 2026-10-18

本轮完整 `npm run check` **384/384** 通过，包含类型检查、重新构建、HTTP/SSE、原生宿主夹具及所有已有回归。新增18项测试覆盖CLI默认/显式三种入口、SDK非法值、自动审核已存事实/问题/下一步/Intent/报告、显式覆盖初始策略、Reason-first→Explore→Reason在两种上下文策略下的会话隔离、SQLite重载后保留原入口、旧任务在途进程检查及可观察的选择事件。

新增CLI测试最初因创建第二个任务时复用了尚有活动目标的测试身份而失败，调整为每个独立任务使用独立身份后，定向测试及完整回归均通过；没有放宽真实任务所有者或恢复校验。所有宿主执行均为本地脚本化夹具，零新增付费模型调用。

`startMode` 默认 `auto`，仅按公开黑板状态选择初始入口，不额外调用模型预测任务难度；Bootstrap和Reason仍自主决定是否直接完成或提出探索。选择在首次派发前保存，暂停恢复不会因更换参数重跑已执行阶段。普通五工具入口不启用调度器。配置与恢复边界见[调度指南](scheduler.zh-CN.md#启动策略)。

这是Round15封存之后的实现变化；Round15的366项检查及模型成绩仍对应当时的冻结源码。本次没有重新运行模型、改写其封存结果或证明两种入口的准确率/耗时差异。

## 原版协调策略与阶段精简 — 2026-10-18（Round15）

本轮完整 `npm run check` **366/366** 通过，包含 TypeScript、重新构建、HTTP/SSE、宿主与通用 harness 回归。新增7项测试先验证旧版本缺失行为，再覆盖 fresh-full/reuse-delta 的完整图与增量、独立 Explore、两种模式直接完成、worker状态/覆盖由宿主赋予、next列表无损兼容和完成/新Intent互斥。原有输出纠错测试显式选择reuse-delta，避免把可选策略误当默认。

冻结后六个新版无模型 pipeline 夹具与两个原版 Python 运行时夹具全部通过，原版真实走通Bootstrap→Conclude→Reason→Explore→Reason。无额外付费探针；夹具不计模型成绩。正式DeepSeek四组36次对照及无预算适配按[运行前协议](../evaluations/public-rca/protocol-round15.zh-CN.md)执行。[检查与实现差异收据](../evaluations/public-rca/runs/2026-10-18-deepseek-original-context-round15/implementation-check.json)、[冻结夹具](../evaluations/public-rca/runs/2026-10-18-deepseek-original-context-round15/integration-fixture.json)、[实现说明](optimization-round15.zh-CN.md)。

正式36次均正常结束，36份报告共58个分片完整阅读、ACK封存后评分。原生Pi／原版Python／新版完整图／新版增量图各正确9/9、完成9/9、错误完成0/9；统一产物验收分别8/9、9/9、9/9、9/9。累计已记录tokens分别18.574M、24.337M、14.132M、17.334M，耗时中位251.2、265.1、259.3、262.5秒。新版默认相对原生少23.9%tokens、相对原版少41.9%，但多数差异发生在Bootstrap，不能归因于协调模式；完整图没有普通Reason，增量图仅一次成功产物反馈Reason，均没有真实Explore／Conclude或参数纠错。原版禁用阶段超时会去掉常用阶段切换触发器，不代表其默认分段表现。

37次真实Pi调用、37个私有凭据目录均清理；新旧源码、评分器、输入、封存报告和全局配置无漂移，独立session账本及阶段增量对账无差异。7个样本因8条可恢复连接错误保留用量下界；没有终局服务失败，也没有真实崩溃恢复证据。正文核查仍有时序、单位和缺测推断问题，标签正确不能视为全文正确。9个actor使用共享/tmp写自己的临时文件，1次父目录读取尝试失败；公开观察未见同名文件区间重叠或隐藏答案访问，不声称OS隔离。详见[Round15完整报告](../evaluations/public-rca/comparison-round15.zh-CN.md)及其中审计收据。

## 阶段契约与协调上下文 — 2026-10-18

Round13 冻结前 `npm run check` **359/359** 通过，包括 TypeScript、重新构建、原生宿主夹具和本地 HTTP/SSE。新增通用回归覆盖同会话参数纠错、交替重复错误终止、纠错期间新增提示、原子 Intent 提交、零动作校验、增量黑板与完整快照、不安全目录回退、取消、恢复旧 Reason 的进程隔离，以及产物修复重验与旧引用版本约束。产物修复及恢复隔离缺陷均先以失败测试复现后修正。

冻结后的真实调度调用路径另有 **8 项无模型接入夹具**通过，覆盖 Pi／Codex 的直接完成、同会话纠错及独立 Explore、仅修产物的 Reason、异常累计用量保留、started-only 动作拒绝；零新增付费探针。[冻结版本与检查记录](../evaluations/public-rca/runs/2026-10-18-scheduler-contract-round13-final/freeze-receipt.json)、[接入夹具](../evaluations/public-rca/runs/2026-10-18-scheduler-contract-round13-final/integration-fixture.json)独立保存。这些合成夹具不计模型成绩或恢复成功率。

[实现说明](optimization-round13.zh-CN.md)与[调度器指南](scheduler.zh-CN.md)记录行为和宿主限制。普通协调会话复用是新增开销优化；Codex 输出纠错的零动作检查是事后审计拒绝，不能声称执行前禁工具。模型效果以本轮 54 次冻结对照单独记录，不由这些夹具推断准确率。

54次无预算实测均结束；47份公开报告共71分片完整阅读封存，7份缺失均为GLM服务失败，之后才统一隐藏评分。DeepSeek原生／Cairn正确均9/9，记录tokens少44.9%、耗时中位少10.2%；Sol正确8/9→9/9，tokens多7.9%、耗时中位多12.8%。GLM原生／Cairn正确4/9、3/9，完成6/9、5/9，两组各两次错误完成；服务正常的五组配对正确均3/5。三次输出修复均同会话零工具并通过产物验收，根因正确仅1/3；四次Conclude均未恢复交付。实际没有Reason／Explore阶段，不能从本轮宣称delta或探索闭环的实测收益。额外数值、单位和缺测错误另列，标签正确不代表全文正确。详见[Round13完整报告](../evaluations/public-rca/comparison-round13.zh-CN.md)。

## Optional scheduler — 2026-10-18

After all Round12 model processes exited, the current workspace passed **332/332** tests through `npm run check`, including TypeScript, rebuilt bundles, CLI/provider compatibility, lease regressions and HTTP/SSE. The production Pi adapter now preserves opaque model IDs and accepts a separate optional provider. The frozen model experiments already used correct IDs through independent native drivers; the scheduler core and Engine are byte-identical to the measured version. [Version boundary and validation hashes](../evaluations/public-rca/runs/2026-10-18-scheduler-three-model-round12-final/post-freeze-cli-fix.json) record the two source and six generated-file differences.

Before freezing the implementation, `npm run check` passed **327/327** tests, including TypeScript checking, build and local HTTP/SSE tests. New domain-independent host fixtures cover direct Bootstrap completion through a verifier, parallel Explore proposals and explicit owner review, semantic no-progress termination, changing hints, duplicate dispatch exclusion, stale owner results, same-session conclude, cross-epoch recovery and blocked recovery when native liveness is unknown. Native CLI adapter checks cover argv, public-event filtering, token accounting, process-group cancellation and private session locks without model calls.

The five-tool harness remains the default. The optional [scheduler](scheduler.zh-CN.md) uses host execution; interface tests do not establish model accuracy or universally reliable process recovery. Round12 records real model results separately using a frozen implementation and all phase costs.

An additional lease regression file runs two native-host fixtures for 11.1 seconds with an initial 10-second lease: normal Explore and cross-epoch same-session recovery Conclude. Both dispatcher and actual worker leases renew, then proposals are reviewed and completed. The focused run passed 3/3 (parent plus two scenarios), with TypeScript checking; it changes no frozen implementation files.

[Round12](../evaluations/public-rca/comparison-round12.zh-CN.md) retains 90 attempts after the user requested a complete Pi rerun, plus three original probes. All 49 available public reports were read and hash-sealed before hidden grading. The latest comparison is restored Pi36 plus retained Sol18: DeepSeek is correct and completed 9/9 in both arms; Sol is correct 9/9 in both arms but completes 9/9 native versus 8/9 with Cairn. Restored GLM ends with service errors in all 18 attempts, so its inference performance cannot be ranked. One Sol task exercises a real Bootstrap→Reason→Explore→Reason artifact-repair loop; this does not establish a general diagnosis-accuracy benefit or reliable fault recovery. Shared `/tmp` writes in seven Pi actors and a failed parent-directory read are disclosed separately from unchanged input hashes; Pi has no OS sandbox.

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

## Exploration, review and feedback verification

- Ten focused tests exercise explicit multi-source fact → exploration → output relationships, version-pinned sources, intended membership without invented production, unsupported/foreign/scoped source rejection, cyclic derivation rollback, transitive invalidation, distinct retry attempts and preserved prior source bodies.
- Snapshot-fenced review clears only visible evidence generations, is idempotent and cannot repair stale derivations. External attributed feedback is append-only in active, suspended and completed tasks without owner binding; immutable keys prevent conflicting retries. Feedback alone does not reopen a task.
- Explicit reopen preserves the prior completed history and advances the owner epoch. Different owners require takeover. Already-bound MCP connections are fenced even when the native session ID is reused. Unknown old child returns do not acquire the reopened goal.
- Pi, Claude, Codex and generic MCP use the same six-tool contract. Model/UI share the exploration topology, while source bodies are represented once in graph nodes and inputs reference their versioned nodes. New UI states, timeline events and replay changes distinguish feedback, global review and reopening. Both layouts are checked for node overlap after feedback/reopen. Browser replay exposed a real end-boundary race where the playhead reached the end before loading the final completion frame. The scheduler now loads due records before stopping; a new regression covers a 1 ms final gap, delayed rendering and tied timestamps. Installed ego-browser playback at 60× reached 31/31 with the completed goal, and seeking the real source-change frame restored exactly three stale conclusions, the old source version and attributed feedback.
- A new real Codex exercise completed the initial regional-quote repair, then an independent tester reproduced a caller-mutation failure and appended attributed feedback. A second real Codex session explicitly reopened the same task. Narrowing the original explanation actually invalidated three downstream findings; the historical source node and blocked conclusions were checked in ego-browser and a pixel screenshot. Both real main sessions chose zero helpers. Final checks passed the original 4-case reproduction, original five regressions, external caller-mutation case and six new mutation regressions; an independent terminal reran all four. The same task completed in epoch 2 with 31 events/history frames over 703,826 ms, no pending review/stale supported derivations and zero calls/observations. Three existing check files and the first completion snapshot hash stayed unchanged. This uses synthetic business data, not a production fix.

## Prompt consolidation verification

- Shared SKILL.md is the canonical behavior policy. On-demand references add task examples or branch/host details, and six tool descriptions retain calling rules. Recovery/adapter context no longer repeats a separate delegation policy. Current instruction surfaces no longer require milestone-based state saving; historical verification notes retain their original provenance.
- Before/after UTF-8 sizes: shared skill 8,946 → 4,191 bytes; references 9,870 → 4,860 bytes. Tool descriptions were shortened by about half; these byte counts are not a measured token or billing reduction.
- A live read-only main/subagent run used the revised skill, independently reconciled the two synthetic fixtures, separately saved semantic branch transitions and completed the Cairn goal. Ten main assertions and nine review checks passed. Generic CLI reporting is accurately labelled agent-authored; no native lifecycle coverage is claimed in this acceptance run.
- Actual application-level task messages were saved before dispatch and published verbatim with SHA-256 hashes. They exclude host policies and private reasoning. A task-specific one-helper requirement belongs only to this acceptance input, not to the general skill.
- Two actual scope_mismatch rejections were repaired without relaxing Core checks; tool calling guidance now explicitly describes scope inheritance and coverage.
- The skill creator validator, JSON examples, shell syntax and local references were checked. Runtime schemas and persistence semantics remain unchanged; the existing regression suite verifies callable behavior rather than matching prompt wording.

## Full graph context verification

- Complete semantic graph reads retain old findings and full basis text beyond legacy summary limits. Small contexts inline the graph; large contexts expose a checksum-pinned historical snapshot. Source/raw-IO separation, unavailable references and all edge endpoints are explicit.
- Graph tests cover pinned pages across new writes and takeover, checksum/range checks, helper read-only access without owner binding, related competing findings and ancestry, complete topology indexes, semantic deltas and proof-edge reconstruction, task-scoped snapshots and privacy-mode changes.
- Native Claude/Codex startup/compaction fixtures verify graph access injection, exact parent identity and suppression of unrelated new-goal context on late child starts. UI and model evidence relations are checked through the shared projection.
- A live read-only helper received only a graph reference to a consistent copy of the earlier real Codex task, without its original conversation. It read snapshot 40 in three pages (37 nodes, 55 edges, 30,840 UTF-8 bytes), verified the checksum, and recovered the early 4/8 price anomaly, cache-key cause, rejected alternatives and recorded repair checks. Its answer distinguished historical agent-curated findings from newly executed verification; it did not open the referenced business files or rerun their tests. No parent ownership, task state or tool-call records changed. This validates using stored graph context, not a fresh native investigation on all three hosts.

## Current scope

Cairn manages goals, evidence relationships, immediate semantic updates, recovery and completion checks. The public workflow is start → host work and updates → recovery summary/resume when useful → finish. Users choose the tools and define observable acceptance criteria for their actual problem.

The domain-specific competition profile and its resources were removed from the implementation and public interfaces. There is no shared match clock, external submission/receipt orchestration, team confirmation command or fixed incident-report structure. Reports contain a free-form summary and evidence references. Ordinary task deadlines and optional captured evidence remain explicit choices.

## Automated verification

- **223 tests passed on Node 26.3.0 and Node 24.19.0**, including typecheck and self-contained bundle build.
- A practical public-interface test created a real local faulty implementation, reproduced its incorrect output through a separate Node process, saved findings, paused, restored from another host, fixed the file and ran actual regression inputs. The final report completed from its goal coverage and references, with no tool-call records.
- Interface tests verify that removed profile/budget/report fields are rejected, fresh databases contain no match-state table, and captured findings can complete without an external platform reference.
- Core checks cover contradictory/unsupported findings, scope coverage, reference membership, paging and bounded context, cancellation, interruption, cross-host takeover and stale-owner rejection.
- Optional gateway checks preserve the upstream input schema and arguments, share paginated catalogs/transports, isolate cancellation and retain original failures only when capture is explicitly selected.
- UI checks preserve the blue-and-white relationship graph, distinct start/goal/work states, evidence projection, read-only HTTP and live SSE behavior. The report projection uses the generic summary and completion result.
- Installer checks confirm that the published package and all native bundles omit removed resources and include the practical skill reference. Existing native registrations and user edits remain protected.
- Multica upgrade tests remove only obsolete files whose content matches an owned/published hash, preserve edited files, verify the final remote skill contents, and recover from failures before deletion or after a lost delete response without duplicate registrations.

## Autonomous branch verification

- Version 4.5 adds one-entity cairn_update persistence with compact receipts, no-op retries, native execution events before semantic branch association, a separate reviewing state, and independently sourced native execution graph nodes. Tests cover ownership and epoch fencing, restart recovery, historical native start/return, exact optional association without backdating, unknown stops, stale former-owner events, rollback on persistence failure, and automatic suspension on native parent-session end while child-session end remains isolated. Existing Pi/Claude/Codex and MCP/installer suites pass with the six-tool catalog.
- A new real local Codex CLI 0.162.0 / configured gpt-6.1-sol run independently selected one read-only assistant and two semantic branches. Its original regional-price reproduction failed 4/8; after the cache-key repair it passed 0/8, plus 160 order/cache calls including 120 verified real cache hits. A separate terminal reran the original reproduction and model-authored regression successfully.
- That native-adapter run completed task_1482ee76-2ad5-406f-ab1a-cc967ee02e66 with 40 events/history states over 278,384 ms, and zero calls/observations. Real SubagentStart and SubagentStop directly saved start/return snapshots without an agent reporting lifecycle or relaying an ID. The first diagnostic attempt exposed routing-name/native-ID mismatch; the final design shows unassociated native executions independently rather than guessing a branch mapping. No child transcripts or raw tool IO enter Cairn state. This is a real Codex/native run on synthetic input, not a claim of real-model native validation on Pi or Claude.
- ego-browser checked the recorded-time graph before native start, during native execution, after direct native return with main work continuing, during main-agent reviewing and after accepted completion. It confirmed separate semantic and execution sources, distinct main/subagent ownership and no page JavaScript error. Existing screenshot capture failure means no new pixel screenshot is claimed.

- Shared core, MCP/Pi schemas, skill and bounded recovery support optional branches, nested membership, main/subagent assignees, real host IDs and findings/progress linked to a branch. Invalid/cyclic parents, foreign branch references, repeated active bindings and premature completion roll back atomically.
- Pi, Claude and Codex runtime tests execute the same branch/checkpoint/pause/takeover/finish contract. A child returning remains awaiting_review until the main agent reviews its findings. Outstanding branches and known current-epoch running delegates keep completion incomplete; suspension remains immediate.
- Native adapter fixtures cover duplicate/stop-before-start events, reused assistants, unknown/internal agents, child tool/Stop isolation, late events across goals and owners, and a child returning while its original goal is paused and another goal owns the session binding. No child tool IO or transcript text enters curated records.
- Browser verification displays nested branches, assignees, pending/running/review/completed colors, evidence membership and source labels. Replay restores the prior branch set and lifecycle state. Layout keeps evidence in its branch's relative lane rather than result arrival order.
- A real local Codex CLI 0.162.0 run with the configured gpt-6.1-sol model autonomously selected one log assistant and three investigation branches. The main agent independently recomputed all 210 synthetic log records, reviewed the returned branch, fixed the runtime timeout and reran the original script from 4/6 timeouts to 0/6. All three branches and the goal completed, with report.md, five events/frames and zero curated raw tool records. An independent terminal check reran the script and verified the final database. See the runnable Chinese example.
- That run used generic MCP: branch statuses are explicitly main-agent reports, not claimed native lifecycle coverage. Real model/native hook end-to-end validation on all three CLIs is not claimed. The initial noninteractive attempt exposed default destructive MCP annotations; the five local core tools now truthfully advertise non-destructive, closed-world behavior while forwarded tools retain conservative defaults. The successful rerun used the normal workspace sandbox.
- The published example generator was actually executed and checked against daily log counts 0/1/0/32/33/33 and the 4-to-0 reproduction result. Skill validation, JSON examples, shell syntax and local links were checked.

## Replay verification

- Version 4.4 replaces fixed-delay checkpoint stepping with a continuous recorded-time timeline. The original real Codex fixture spans 298,100 ms, with five retained states at 0 / 15,809 / 115,822 / 191,332 / 298,100 ms. It still has five events/frames and no curated tool records; no intermediate operations or timestamps are invented.
- Deterministic clock tests cover unequal save intervals, state-at-or-before seeks, actual speed multipliers, delayed refreshes, changing speed without jumping, pause/buffering/resume, end clamping, equal timestamps, clock regressions/invalid times and empty/single-instant histories.
- ego-browser verified the full five-state run at 60×, a continuously advancing playhead, proportional markers and arbitrary seeks (01:00 = both agents executing; 02:00 = child returned with main work continuing). A measured 652.6 ms at 10× advanced 6,522 ms. Pausing an in-flight read stayed paused; an older delayed seek could not overwrite a newer one. Completion remained historical and live return restored export. Desktop and 390px geometry checks showed no horizontal overflow; no page JavaScript error was observed.
- The screenshot API still timed out on capture; no new 4.4 pixel screenshot is claimed. UI verification uses browser interactions and rendered DOM geometry.

- Version 4.3 labels every replay frame as a stage checkpoint, with save time, elapsed save interval, changed-node links and recorded actor states. The original five snapshots in the real Codex fixture remain five snapshots; no tool log or synthetic intermediate operation is added.
- Semantic-delta tests verify batch updates, a helper returning while another remains running, main-agent review and continued execution, dictionary/relation reordering, revision/timestamp-only saves, independent basis changes, removed nodes, actor reassignment, first/unknown baselines, and aggregate deltas across missing history. HTTP tests confirm that direct/backward seeks always compare to the preceding saved task frame and never mutate task state or events.
- Role-lane tests verify ownership, bounds and non-overlap in both layouts. Review nodes derive from saved branch status and group with the source branch's transition. Optional matched native starts/returns can advance a pending branch without changing tool-record policy; acknowledging the start retains its execution identity, and pause/resume does not infer continued liveness.
- ego-browser interaction checks on the original Codex task confirmed main/subagent parallel states, a returned helper with a separate main-agent review node, accurate changed-node sets, review completion while repair begins, backward seeks with reordered responses, pause during an in-flight frame, change-link navigation, full-graph/flow camera modes and cleared highlights on live return. No page JavaScript exception was reported in those checks.
- The screenshot API repeatedly timed out, including for an empty diagnostic page and direct CDP capture; no new 4.3 screenshot was generated or claimed. Existing screenshots retain their earlier-version provenance. Browser state, interactions and rendered DOM geometry were checked; pixel capture was unavailable.

- Every saved mutation and completion check retains a domain-state frame keyed by event sequence. Tests cover finding revisions, running/completed graph states, suspension, cross-host takeover, same-revision checks, and rollback when snapshot persistence fails.
- Historical API tests verify task isolation, invalid cursors, read-only access, omission of raw tool IO, curated privacy after a mode change, more than 200 records across pages, and a fixed replay head while new events arrive. Historical deadline labels use event time.
- Legacy migration retains known creation/head baselines, is idempotent, and rejects unavailable intermediate frames. It does not fabricate history from the final state.
- ego-browser verified all seven frames of a labelled synthetic UI fixture: initial execution, proposed finding, supported finding, pause, new owner, resumed execution, completion. It checked play/pause, step, keyboard seek, speed, end-of-playback retention, and live return.
- A deliberately delayed frame request exposed and then verified a fix for pausing while a frame loads. The paused replay stayed at its selected frame and did not restart. A separate live writer added hints during historical mode; they appeared only after returning live. No browser exception was reported in that flow.
- Desktop and 390px browser checks retained the blue-and-white graph and usable replay controls without horizontal overflow. These fixtures exercise UI behavior; they do not claim a new external-model investigation.

## Installed workflow checks

- The global 4.7.0 package and existing managed Multica integration were updated with the same server/skill IDs and remembered database. The new exploration reference and shared skill match their recorded remote hashes; doctor confirms enabled bindings and accurately reports MCP-only native lifecycle coverage for Multica.
- An unbound client using the installed stdio MCP read the final real task graph and handoff in ten 4,096-character pages each, verifying snapshot/checksum continuity. It found 33 nodes/57 edges, accepted validation and an empty review queue. The 31 events and zero calls/observations remained unchanged.

- The global 4.6.0 command and existing managed Multica MCP/skill were updated in place. Doctor confirmed enabled bindings and the new source-independent runtime; registration IDs, agent settings and remembered database were preserved. The installed shared skill includes graph-context.md. Multica remains MCP-only, so the main agent forwards the handoff rather than relying on a native child hook.
- An unbound installed stdio MCP client read the real Codex sample's copied graph and handoff in six 4,096-character pages each, with snapshot/checksum validation. The final projection contained 37 nodes, 55 edges and 31,005 UTF-8 bytes; this includes status metadata added after the live helper check above. The copied task hash, 40 events and zero calls/observations remained unchanged. The server ran from the global package outside the checkout.

- The global 4.5 command and managed Multica MCP/skill were updated in place, preserving IDs and remembered database. Multica accurately remains MCP-only; native automatic lifecycle coverage was verified in the separate Codex exercise, not falsely attributed to Multica. The new sample dashboard uses the installed global command on port 51921.

- The global 4.4 command and the existing managed Multica integration were updated in place with the same MCP/skill IDs and shared database preference. Doctor confirmed the bindings and accurately reported MCP-only lifecycle capabilities. The real Codex sample dashboard was restarted at its original port 50814 using the installed runtime. A read-only integrity comparison confirmed unchanged task SHA-256, five events/frames and zero calls/observations.

- The 4.3 global command and managed Multica runtime were updated in place. A source-independent installed MCP/CLI protocol check used explicitly labelled synthetic native lifecycle events to verify pending-to-running projection, pause/resume remaining blocked, returned-result review and completed acceptance. It confirmed zero tool records and no child response sentinel in the persisted task. The real Codex sample dashboard was restarted on its original URL with the installed runtime.

- The global 4.2 command and managed Multica MCP/skill were updated in place. Doctor confirmed enabled bindings and the source-independent runtime; the owned skill files include both practical-workflow and delegation references. The installed MCP passed an isolated branch start/read/pause/resume/finish protocol run with the five non-destructive core tools.

- The packed 4.0 command completed the labelled local demo through real stdio calls, pause, takeover, completion and export.
- ego-browser inspected that completed task in the blue-and-white graph and report view. The report displayed the generic result summary, completion state and evidence references without a page error.
- The existing local Multica integration was updated in place. Its MCP and skill bindings stayed enabled with the same IDs. The managed old reference was deleted and the final remote skill contained exactly the new practical reference and matching main instructions. The installed MCP passed another isolated pause/recovery/completion protocol check with no tool-call records.
- A Multica CLI compatibility check accounts for file deletion accepting no `--output` flag; successful deletion is followed by a full content check. The initial partial upgrade was safely retried from its pending receipt.

- The local global command and managed Multica MCP/skill were upgraded to 4.1 in place, retaining their registration IDs and database. Existing processes must restart to load the new runtime. The installed configuration also passed an isolated stdio MCP start/checkpoint/pause/takeover/finish run, rejected the old owner, stored no curated tool records and retained one replay frame per event.

## Evidence limits

The workflow and transport tests verify executable behavior and recorded relationships. They do not prove arbitrary causal conclusions or that every referenced document was read. Agent-curated basis, captured original results and human hints remain distinguishable.

Native capabilities depend on actual host events; hosted paths may bypass local hooks. Generic MCP/Multica supports explicit checkpoint/resume/finish without claiming native capture. Multica's server configuration is write-only, so doctor combines registration/binding reads with the last locally recorded successful configuration.

The local fixtures are labelled synthetic. The practical file-repair test executes real file changes and checks inside an isolated test directory; it is not a production fix or an external-model benchmark.

Reproduce from the repository root:

```sh
npm ci
npm test
npm pack --dry-run
```

The global installer packages a source-independent copy. For an existing managed Multica integration, `npm run install:global -- --target multica` also updates its MCP and shared skill while preserving the task database and the agent's model/instructions.


## Resource usage (4.8)

- Full Node 26 build/test suite: **234 passing tests**. Node 24 resource accounting and native adapter suites: **39 passing tests**.
- Added checks for privacy (including receipt/config tables), duplicate and failed returns, original-task attribution after switching goals, old-owner fencing, actual zero versus unavailable tokens, cache inclusion, cumulative baselines/restart/older events, numeric-only transcript import, paused/completed timers, takeover/reopen accumulation and historical projections. Usage updates do not increment the semantic revision.
- Real installed Pi 1.1.0 CLI with an isolated **local protocol fixture**, not a real model: `node scripts/pi-fixture-smoke.mjs --curated`. Two native sessions made seven fixed provider responses, producing **140 input + 210 output = 350 tokens**, **7 model responses**, **1 returned business tool** and **4 Cairn tools**; pause/resume/completion succeeded with **zero raw observations and zero captured calls**. This includes the model responses immediately before binding and after stopping the same native turn.
- Ego Lite browser verification: desktop 1512×828 and mobile 390×844, no horizontal overflow. The blue/white resource strip showed the exact saved totals; replay at creation showed unavailable counts, and the final 16/16 frame showed 350 tokens / 1 business tool. The narrow graph fitted within its canvas after resize. No model was called to manufacture the replay.

Claude/Codex accounting is verified with known numeric metadata fixtures and their existing hook adapters, not claimed as a new real-model or real-host acceptance run. Unknown transcript versions, missing native hooks, MCP-only hosts and unreported child usage remain explicit coverage limitations. The old real Codex samples were not backfilled with invented statistics.
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


## Round14 — unchanged framework, Pi Kimi K3 (2026-10-18)

[Measured comparison](../evaluations/public-rca/comparison-round14.zh-CN.md):18 fresh unbudgeted attempts, exact user-selected provider/model `sub2api-copy-copy/kimi-k3` (display `sub2api-kimi`), high. The src/dist/skills snapshot matches Round13 byte for byte; no production changes or new full-suite run. Three current no-model Pi pipeline fixtures passed.

Native/Cairn root matches6/9 each, workflow completions9/9 each, false completions3/9 each. Acceptance6/9→9/9; effective correct delivery5/9→6/9. Recorded tokens5,630,293→4,732,815; median CLI/workflow time488.4s→474.7s, noncached input361,536→474,239. Four ordinary same-session Reason/delta continuations and seven zero-action output repairs passed native identity/stop checks. These yielded two real artifact repair loops, not measured root-cause improvement or fault recovery; no actual Explore/Conclude occurred.

All18 public reports were read/ACK/sealed before hidden labels. Twenty-nine actual CLI invocations and credential cleanup receipts; ledger/phase/actor sums match, protected input and current implementation drift0. Two native connection errors recovered through Pi and keep usage lower-bound flags. Frozen analysis retained an old concurrency invariant; an audited derived analysis corrected only that check/self-source target with all18 grade hashes unchanged. The report retains this correction, targeted prose/CSV findings and public scope review.
