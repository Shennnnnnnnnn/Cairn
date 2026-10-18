> 历史记录：本文保留当轮版本、协议、数据和结论，不代表当前 4.9 的接口或性能。当前用法见[文档导航](../../docs/README.zh-CN.md)。

# 公开排障案例：Pi 与 Pi+Cairn 对照

最新见[第九轮同模型Pi对照](comparison-round9.zh-CN.md)：global:deepseek-v4.1-flash/high，相同三题各三次、两组18会话、最多3并发、无评测预算。两组联合命中均9/9；原生/Cairn完成与有效交付8/9、9/9，错误完成均0。原生少一次交付源于连接错误；Cairn记录tokens少39.3%，每次有效交付少46.0%，但I/O、CPU题token成本仍波动。用量为下界、金额未知；恢复N/A，不证明长期稳定。回归272/272，冻结/记录581/581，原生记录独立核对126/126。

历史见 [第八轮同题开发集复测](comparison-round8.zh-CN.md)：GPT-6.1-Sol/xhigh，3题×每组3次，共18新会话，最多3并发、无评测预算、均自然结束。原生/Cairn联合命中9/9、8/9，完成均9/9，有效交付均8/9；错误完成0/9、1/9。Cairn对象/层级命中9/9，但资源类别错一次，联合正确率未比旧版提高。参数错误9→3，MCP公开文本少40.7%，Cairn记录tokens比旧版少8.3%、仍比本轮原生多40.9%。剩余artifacts/handoffs编码重试未消除；恢复N/A，同题开发集不能证明长期稳定。框架回归267/267，冻结审计536/536。

上一轮见 [三道新题 × 三次重复：原生 Codex 与新版 Cairn](comparison-codex-repeated.zh-CN.md)：GPT-6.1-Sol/xhigh，18个全新会话、不设评测预算、最多三组并行，全部自然结束。原生对象＋类别＋层级命中9/9，Cairn为8/9；两组完成均9/9、有效交付均8/9。原生一次输出格式不合格，Cairn一次I/O定位从服务上移到节点，仍通过产物/算术验收。Cairn记录tokens多58.6%、耗时求和多32.3%。每题三次的成本未触发预定波动标记，但仅三个不同事件，不能推断长期稳定；三题难度为代理选择，非官方评级。测试中框架版本不变。

前轮单题见 [Codex GPT-6.1-Sol 极高与第七轮优化](comparison-codex-round7.zh-CN.md)：同一道难题在原生 Codex、冻结上一版、修改前和修改后 Cairn 各一个新会话，不设评测预算，最多三组并行。四组完成、独立数值复算及首选对象＋类别均通过；修改后相对修改前记录 tokens 少32.0%、耗时少3.6%，原生仍最低。单题各一次不能证明代码收益。首次接入遗漏造成整批作废，修复后四组全新重跑，作废与探针成本另列；该轮没有重跑四道题或新做 UI 浏览器验证。

前轮见 [四模型 × 三配置难例比较](comparison-model-matrix.zh-CN.md)：DeepSeek / Step / GLM / Kimi 各跑原生 Pi、上一版 Cairn、本版 Cairn，12 个全新会话无评测预算、均自然结束，运行中按用户要求并行。GLM 三配置均实现可复算且标签命中；不将单题结果当作通用排行榜。协议、额外开销、边界偏离和逐份语义审阅均单列。

此前四题的同模型无预算复验见 [第六轮](comparison-round6.zh-CN.md)，各历史轮协议和结果保留。

本轮目标：选择公开排障比赛案例、运行真实模型、独立比较，结合前轮实验给出最终结论。

验收清单：

- [x] 记录比赛来源、镜像限制、原始标签、下载文件校验值。
- [x] 在模型运行前固定案例、输入、提示、预算和评分方法；答案留在工作区外。
- [x] 运行四组 Pi / Pi+Cairn 对照，保留原始日志、失败和超时。
- [x] 独立核验定位、故障类别、证据引用以及 Cairn 的保存状态。
- [x] 写出最终结论，区分诊断能力、可观测性和成本。

候选选择已固定：`groundtruth-k8s-2-2022-03-20.csv` 按 timestamp 升序前四行；不依据模型输出选题。

本轮是公开比赛数据上的**指标切片离线诊断**，不是复现在线比赛排名、运行原系统故障注入或实际修复。每个案例提供注入时间前后各 600 秒的原始指标行，包含该时间窗全部节点、容器和服务；不按已知故障目标过滤。日志、调用链和其他比赛日不在本轮输入中。公开答案可能存在于模型训练数据，无法排除污染。

来源为 AIOps 2022 的第三方公开归档，非主办方当前直接下载；镜像声明 CC BY 4.0，不能据此保证原始比赛数据的再分发权。原始数据与模型运行产物保留本地并由 `.gitignore` 排除；仓库保存重建脚本、文件哈希和方法说明。

运行前冻结的主评分：第一候选的服务、比赛标签同粒度的具体对象、资源故障大类分别命中；另给对象 Top-3 和 MRR。类别采用 CPU / memory / disk_io / network 四类，不把网络损坏与延迟强行当作能从现有指标唯一识别。细分类别、量化证据、替代解释和建议由人工语义复核，单列而不冒充官方比赛分数。

两组统一使用 Pi 1.1.0、配置模型 `sub2api-copy-copy/kimi-k3`、thinking=high，单次 720 秒，单条回复 maxTokens=8192，完整回复累计输出上限 24000。每个案例每组运行一次；串行且交替先后顺序。输入完全相同，Cairn 组额外加载当前提交的扩展和 skill，并要求 start / checkpoint / finish。两组都保留原生会话、可写分析脚本与报告，不联网检索答案。边界靠提示约束，不构成操作系统隔离。没有模型 seed 或多次采样，本轮只能支持描述性比较。

自动评分读取固定格式的 `answer.json`，在实验进程结束后执行。成本只统计服务端报告的 token，包含缓存读取；中断时若最后回复没有完整 usage，则计数是下界。没有可核实的计费单价，因此不报告美元成本。

复现（从仓库根目录，先准备 Node 24+、Python 3.10+、curl 和已配置的 Pi CLI）：

```sh
python3 evaluations/public-rca/remote_zip.py
python3 evaluations/public-rca/remote_zip.py training_data_with_faults/training_data_with_faults_groundtruth/groundtruth-k8s-2-2022-03-20.csv evaluations/public-rca/sources/groundtruth.csv
python3 evaluations/public-rca/download.py
python3 evaluations/public-rca/prepare.py
node evaluations/public-rca/run.mjs --agent-dir /path/to/pi-agent-config --pi-cli /path/to/pi/dist/bundle/cli.js --run-id YOUR_NEW_RUN_ID
python3 evaluations/public-rca/summarize.py YOUR_NEW_RUN_ID
```

真实运行会调用模型并消耗额度；runner 从指定配置复制必要凭据到临时私有目录，结束后删除副本，不更改原配置。已存在的 run-id 会被拒绝覆盖。推理日志、原生会话、原始数据及 HTML 导出只保留在本地 ignored 目录；查看结果以 comparison.zh-CN.md、run 的 summary.json 与 qualitative-audit.json 为准。

`schema-repro.mjs` 是无模型的接口问题复现器，使用内存数据库，不修改正式任务。`reference.py` 只计算原始序列描述统计，不是参考 RCA 算法；其取样均值不能直接充当因果证明。数据说明表在运行开始后补读，仅用于审阅，未追加给任何一组模型。

本轮结果见 [最终对比报告](comparison.zh-CN.md)。8 次真实执行全部到达终态；Pi 对象＋大类首选联合命中 3/4，Pi+Cairn 2/4；标识符复核后的首选对象命中分别 3/4、4/4。54/54 项实验记录一致性检查通过，不代表 54 项内容正确性验证。四个 Cairn 保存任务都通过 SDK 结构评估，但内存题类别错误、网络题类别 unknown。

服务标识符复核使用 `runs/2026-10-16-aiops2022/identifier-policy.json`：在读取两组网络答案前，记录服务名的 `-grpc` / `-http` 后缀等价政策。原始冻结 scorer、分数和哈希保留不动，复核分数另存 `reviewed-grade.json`；该补充政策不改变 pod / node / service 的层级和资源类别。复核是透明的格式纠偏，不能描述为初始评分方案已包含它。

独立审阅/报告重建：

```sh
python3 evaluations/public-rca/reference.py YOUR_RUN_ID
python3 evaluations/public-rca/scope_audit.py YOUR_RUN_ID
node evaluations/public-rca/validate_states.mjs YOUR_RUN_ID
python3 evaluations/public-rca/write_report.py YOUR_RUN_ID
```

最后一步要求八次终态与八份逐例语义审阅齐全。当前 editorial 结论和逐例审阅分别保存在 synthesis.zh-CN.md / review.zh-CN.md；新一轮实验需据新结果重新审阅，不能直接复用这两份判断。`scope-audit.json` 的可疑相对路径也需人工复核，自动路径扫描不是代码安全证明。

## 第二轮冻结协议（2026-10-16）

`run-round2.mjs` 对相同四组切片重跑 8 次（四次 Pi、四次 Pi+Cairn），沿用第一轮模型、思考级别、原始提示、输入文件、串行交替顺序、720 秒和输出额度。保留原 scorer，并在首个模型输出前复制第一轮的服务协议后缀等价政策。新 manifest 冻结实现、扩展、skill、验证器及协议的哈希。

Cairn 组一次性采用本轮三项改动，并配置 90 秒提交预留以及宿主 `verify-artifacts.mjs`。后者只检查文件交付契约、引用文件存在和第一候选在报告中一致出现，不读取比赛答案，不判断指标数值语义或根因。八份第一轮产物均可通过此检查，包括错误类别；故其通过不能记为 RCA 正确。Pi 组继续原生能力与原始任务提示。此比较评估组合改动，不能隔离单一子功能的贡献。

```sh
node evaluations/public-rca/run-round2.mjs --agent-dir /path/to/pi-agent-config --pi-cli /path/to/pi/dist/bundle/cli.js --run-id YOUR_ROUND2_RUN_ID
python3 evaluations/public-rca/summarize.py YOUR_ROUND2_RUN_ID
```

第二轮结果单独保存为 `comparison-round2.zh-CN.md`，不得覆盖第一轮报告，也不得复制第一轮的语义判断代替重新审阅。

第二轮首次启动 `2026-10-16-aiops2022-round2` 因 provider 拒绝条件 schema 中缺少显式 type 而中止。其完整失败日志、已完成的 Pi 首例和冻结前代码均保留，不纳入正式比较，也不择取单例替补。修复后以 `2026-10-16-aiops2022-round2b` 重新运行全部八次；另有不含案例、thinking=off、输出最多 1024 token 的独立 schema 接入探针，不计入诊断质量与用量表。


## 第三轮冻结协议与结果（2026-10-17）

对应工程第四轮优化，正式 run ID `2026-10-17-aiops2022-round3c`。`run-round3.mjs` 沿用四份切片、模型、主预算和交错顺序；两组均追加 `reproduction-contract.md`，要求 `checks.json` 的 2–10 项精确源序列与窗口统计。Cairn 另外显式提交 answer.json／REPORT.md／checks.json，并保存分层交接。宿主 `verify-submission.mjs` 组合文件契约与 `verify-reproduction.py` 独立 CSV 复算；不执行模型提交脚本，不读取隐藏 RCA 标签，不从名称猜测指标采集口径。

自然超时或输出预算停止，才用全新会话、同一工作区追加 180 秒；恢复成绩和消耗另列。两组新协议相同，但相对旧轮增加了数值文件要求和恢复阶段，历史差异不能隔离单项功能效果。

```sh
node evaluations/public-rca/run-round3.mjs --agent-dir /path/to/pi-agent-config --pi-cli /path/to/pi/dist/bundle/cli.js --run-id YOUR_NEW_RUN_ID
python3 evaluations/public-rca/analyze-round3.py YOUR_NEW_RUN_ID
python3 evaluations/public-rca/scope_audit.py YOUR_NEW_RUN_ID
node evaluations/public-rca/restore-handoffs.mjs YOUR_NEW_RUN_ID
```

最后一项在已结束的四份 Cairn 数据库副本上调用生产接管逻辑，不调用模型、不改原库，验证 focus 前提、交接定位、owner epoch 与旧验收失效；不能当成真实超时恢复实验。真实执行源码以 run 内 `runner.frozen.mjs` 为准，方法与排除规则见 `acceptance-policy.json`。

[第三轮结果](comparison-round3.zh-CN.md)：Cairn 联合正确 2/4、对象 3/4、完成 4/4、组合验收 4/4；Pi 联合正确 4/4、正常完成 3/4、组合验收 2/4。一例 Pi 输出预算停止后花 142.78 秒、83480 tokens 补齐报告并保留正确结论。Cairn 没有自然停止样本，四份状态副本重载 4/4 通过。工程测试 225/225、记录完整性 537/537；均不能充当领域准确率证明。

`round3`／`round3b` 两次开发试运行中止并完整排除，共至少 855376 tokens，不复用其中单例。新 Pi 预算停止与中止试运行的 usage 按下界报告，单价未知。主阶段未观察到越界显式路径；恢复曾列父目录中的文件名，未观察到读取隐藏评分内容。评测未启用 OS 沙盒，必须保留这一隔离限制。


## 第四轮协议：探索闭环与独立状态（2026-10-17）

`run-round4.mjs` 重跑同四例 Pi／Cairn 八次，基线为 `2026-10-17-aiops2022-round3c`。沿用相同原始输入、checks.json 契约、评分与后缀政策、模型、high thinking、720 秒／24000 输出软预算及交错顺序。Cairn 改为从增量事实和探索方向结案触发短黑板议程，保存关键 checkpoint；finish 复用已有事实并自动收集宿主明确要求的文件。没有独立 reason worker，也不提供领域答案提示。

只有主阶段自然时间／输出停止才增加全新会话的 180 秒恢复，成绩与用量单列。所有隐藏标签评分推迟到八个主阶段及其恢复进程全部结束后；各阶段待评分答案先保存在宿主临时目录，运行中的 episode 父目录不生成评分内容。这减少恢复时接触评分的机会，但仍未配置 OS 沙盒，不能宣称严格隔离。

本轮会保存完整 src／dist／skills 冻结副本，分析器对该副本核验；历史轮的实现保留，不用修改后的工作树重算成旧版结果。独立正确性审查仅在模型结束后导入 UI 复盘副本，未审查的真实任务显示未评定。

```sh
node evaluations/public-rca/run-round4.mjs --agent-dir /path/to/pi-agent-config --pi-cli /path/to/pi/dist/bundle/cli.js --run-id YOUR_NEW_RUN_ID
python3 evaluations/public-rca/analyze-round4.py YOUR_NEW_RUN_ID
```


第四轮初次启动 `2026-10-17-aiops2022-round4` 因新增自动文件收集在内部 finish 重试时丢失描述元数据而中止；该字段属于提交指纹，导致通过验收后多出重试。已先以失败测试复现，再修复为保留原顺序／描述。该试运行全部排除，三段运行消耗 1041.04 秒、至少 1096745 tokens，记录于其 excluded-costs.json。正式替代运行 `2026-10-17-aiops2022-round4b` 完整重跑八次，不复用已完成的 Pi／Cairn 首例。最终生产构建及 235 项测试通过。

正式结果：Cairn 联合命中 3/4、主阶段完成 2/4、复算通过 3/4、完成且复算正确交付 1/4；Pi 为 3/4、4/4、3/4、2/4。Cairn 两次输出预算停止，CPU 新会话恢复成功、I/O 恢复仍超时；成绩与用量另列。七次 checkpoint 中五次只写摘要，两次提交结构化 Finding；主阶段 handoff 为零，完整交接重载检查 0/4。538/538 冻结记录检查通过，八份主产物与两份恢复均已独立审阅。观察耗时和记录 token 下界上升，不能认定整体优于上一版。

报告重建还需读取本轮逐例审阅和 `synthesis-round4.zh-CN.md`，然后运行 `python3 evaluations/public-rca/write_report_round4.py YOUR_NEW_RUN_ID`。UI 仅在全部模型结束后导入副本，见 [复盘入口](../../docs/public-rca-ui.zh-CN.md)。


## 第五轮：DeepSeek 同模型三组协议（2026-10-17）

对应工程第六轮，使用用户指定的 `sub2api-copy/global:deepseek-v4.1-flash`（high）。在同四例上运行原生 Pi、上版冻结 Cairn、新版 Cairn 各一次，共十二个主阶段。这样分离模型切换与代码改动；历史 Kimi 数据保留但不作为同模型效果差值。两组 Cairn 共享通用运行指引，分别加载自己的冻结实现、模型工具协议与 skill。

沿用 checks.json 数值契约、评分／别名政策、720 秒主预算、24000 输出软限、8192 单回复上限；Cairn 同为 90 秒收尾预留。只在自然时间／输出预算停止时追加 180 秒全新会话恢复，原任务时限不续期，成绩和成本另列。全部隐藏标签评分在十二个主阶段及必要恢复结束后执行。冻结完整 src/dist/skills，并核对上版冻结实现的原哈希。源数据只靠提示约束，不构成 OS 沙盒。

```sh
node evaluations/public-rca/run-round5.mjs --agent-dir /path/to/pi-agent-config --pi-cli /path/to/pi/dist/bundle/cli.js --provider sub2api-copy --model global:deepseek-v4.1-flash --run-id YOUR_NEW_RUN_ID
```

正式运行前的无 RCA 接入探针和本地模拟夹具成本单列，不混入四例正确率。结果在全部运行及独立审阅后补齐。

## 第五轮同模型三组协议（2026-10-17）

对应工程第六轮，正式 ID `2026-10-17-aiops2022-round5`。三组分别为原生 Pi、上轮冻结 Cairn、新版 Cairn；均显式使用 `sub2api-copy/global:deepseek-v4.1-flash`、high、相同 8192 单次回复上限与 24000 完整回复输出软预算。每组四例，串行交错顺序共十二个主阶段；Cairn 两组同样保留 90 秒时间预留。初始 720 秒、自然预算停止后新上下文恢复 180 秒、四份切片和所有评分／数值验收政策不变。软上限在回复完成后检查，可能超出一个回复；中断用量仍按下界。

两个 Cairn 条件接收同一通用指引，加载各自冻结的 skill 和 catalog；完整 src/dist/skills 均归档校验。旧归档必须来自 `2026-10-17-aiops2022-round4b/implementation`，runner 会先验证旧哈希，不会拿新引擎冒充旧版。历史 Kimi 分数保留，跨模型差值不归因为代码效果。

本轮组合改动为收窄模型 finish、强制小批 keyed Finding 增量及宿主自动交接。独立逐例审阅覆盖已保存正文、单位与窗口、因果方向、替代解释；不能把验收通过当作全文正确。隐藏评分推迟到全部十二个主阶段和必要恢复进程结束，阶段答案／报告此前仅保存在宿主私有临时目录。

```sh
node evaluations/public-rca/run-round5.mjs --agent-dir /path/to/pi-agent-config --pi-cli /path/to/pi/dist/bundle/cli.js --provider sub2api-copy --model global:deepseek-v4.1-flash --run-id YOUR_NEW_RUN_ID
python3 evaluations/public-rca/analyze-round5.py YOUR_NEW_RUN_ID
python3 evaluations/public-rca/scope-round5.py YOUR_NEW_RUN_ID
node evaluations/public-rca/restore-round5.mjs YOUR_NEW_RUN_ID
python3 evaluations/public-rca/write_report_round5.py YOUR_NEW_RUN_ID
```

报告生成前必须独立填写该 run 的 qualitative-audit.json 与 synthesis-round5.zh-CN.md。restore 脚本分别加载新旧冻结 runtime，只操作临时数据库副本；基础图恢复和有事实的完整 handoff 分开统计，不能冒充模型恢复率。报告同时保留主阶段、恢复阶段，以及每例取最后阶段结果的补充交付视图，成本加上所有阶段。正式用量不含单独的模型接入探针；probe-model.mjs 可在不含 RCA 案例的临时目录验证新 provider/schema，凭据副本在结束后清理。

## 第六轮：取消评测预算（2026-10-17）

用户要求不设置预算，再完整运行四例。三组和顺序与第五轮相同，直接复制并逐文件验证第五轮的新旧实现冻结归档；不修改 harness。模型仍为 `sub2api-copy/global:deepseek-v4.1-flash`、high，案例、任务、共享指引、验收和隐藏标签政策不变。

移除 720 秒总时限、24,000 累计输出限额、8,192 单次回复覆盖值，并清除继承的 Cairn deadline/reserve；无 watchdog、无自动限时恢复。私有模型配置保留注册的 128,000 单回复上限和 1,000,000 上下文，Pi/provider 原生限制和异常照实记录。自然停止后收集产物，全部十二次结束后再生成隐藏评分；没有中断实验时恢复率为“不适用”。金额未知，token 与耗时分开比较。

[开跑前验收清单与协议](protocol-round6-unbudgeted.zh-CN.md)。[完整结果](comparison-round6.zh-CN.md)：三组完成和复算均 4/4；Pi 联合命中 3/4、错误完成 1/4，两版 Cairn 联合命中均 4/4、错误完成均 0/4。新版记录 token 至少 16,714,857，旧版至少 14,630,208，Pi 至少 10,416,831；金额未知。副本基础重载 8/8，新版交接材料完整性 4/4，但未做模型中断恢复。1013/1013 冻结审计通过；补充审阅同时发现八次运行使用工作区外临时文件，严格隔离不成立，见报告。复现使用 Node 24+ 和 Python 3。

```sh
node evaluations/public-rca/run-round6.mjs --agent-dir /path/to/pi-agent-config --pi-cli /path/to/pi/dist/bundle/cli.js --run-id YOUR_NEW_RUN_ID
python3 evaluations/public-rca/progress-round6.py YOUR_NEW_RUN_ID
python3 evaluations/public-rca/analyze-round6.py YOUR_NEW_RUN_ID
python3 evaluations/public-rca/scope-round5.py YOUR_NEW_RUN_ID
python3 evaluations/public-rca/write_report_round6.py YOUR_NEW_RUN_ID
```

报告生成器要求完整十二例、冻结审计通过，以及独立填写的 qualitative-audit.json 和 synthesis-round6.zh-CN.md；不以进程启动或临时进度充当结果。
