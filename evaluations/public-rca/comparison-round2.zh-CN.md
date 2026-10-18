> 历史记录：本文保留当轮版本、协议、数据和结论，不代表当前 4.9 的接口或性能。当前用法见[文档导航](../../docs/README.zh-CN.md)。

# 第二轮优化：同四组公开排障案例复测

运行标识：`2026-10-16-aiops2022-round2b`。开始于 2026-10-16T15:42:54.624Z；结束于 2026-10-16T16:53:28.066Z。

**结论：保留本轮通用工程改进，但当前证据不支持宣称排障准确率提高，也不支持把 Cairn 默认设为排障加速器。** 四例的 Cairn 首选对象仍全部命中，首选对象＋资源大类联合命中仍为 2/4。网络例由 unknown 改为正确的 network，写 I/O 例却由正确的 disk_io 改判 memory；内存例仍误判 disk_io。两个正确联合答案均在进程超时时保持 active；两个 completed 且外部验证通过的目标，资源大类均错误。同轮重新执行的裸 Pi 为 4/4 联合命中、0 次超时，观察总耗时 31.45 分钟；Cairn 为 39.10 分钟。第一轮 Cairn 为 43.57 分钟，但本轮仍比同轮 Pi 慢，且超时由 1 次增至 2 次；单次样本、API 延迟及缓存差异不支持稳定性能提升结论。

本轮保留原版黑板、Finding、依赖、修订历史、Hint 与反馈重开机制，继续使用五个固定工具、SQLite 和宿主执行边界，没有新增运行时依赖。三个优先级对应的实际改动如下：

1. **工具契约和交互体积。** 普通 checkpoint 在 schema 与运行时均要求 summary，分支心跳等操作有明确例外；写入默认返回简短回执，完整状态按需读取。相同无效参数会得到具体字段修正提示。本轮缺 summary 错误降至 0，provider 条件 schema 的兼容问题经独立探针修复后全轮重新执行。
2. **可选的宿主验证和反证。** 宿主可注入异步验证回调或 JSON argv 子进程；验证凭据绑定任务内容、revision 和 owner epoch，过期、超时、失败均不能放行完成。完成后反证沿既有 reopen 语义保留历史、撤销覆盖并开启新 epoch。真实案例使用的验证器只查产物契约，因此其通过没有阻止两次类别误判；超时、异步竞争和重开行为由回归测试验证，本轮真实模型没有实际触发验证失败后的重开。
3. **预算和可观测性。** 接入宿主 deadline 与提交预留，任务完成状态、验证状态、宿主执行状态分别保存、展示和导出。四例均绑定相同 720 秒硬上限及 90 秒提交预留；网络例保存了一次 reserve 提醒，但仍未及时完成验收，CPU 例未出现提醒便超时。提示依赖新的工具或生命周期回调，不能打断在途 API 请求或代替宿主强制终止。

**仍需保留的限制：** CPU 例五次收到 incomplete finish 后仍未添加可覆盖条件的 Finding，第六次调用又因模型输出截断而失败；参数错误提示不解决“参数合法但提交状态没有进展”的重试。四个任务均未建立 Finding 依赖边，只有三个任务各有一次中间 checkpoint，不能据此声称原版 DAG 已指导了实际推理。反证记录比第一轮更清楚，但统计窗口、指标单位和缺失值原因仍可能被解释错误，通用验证回调不自带领域判断能力。

下一步适合继续小步处理两项通用问题：让重复的 incomplete finish 回执指出最小的未满足条件及可执行修正，并在宿主到达预留窗口时提供能独立于原生工具完成回调的收尾信号。领域数值核查应作为可选宿主验证器或领域适配层实现；比赛标签、RCA 判断规则与额外调度框架不应进入通用核心。

## 相同输入与比较边界

四例沿用同一公开 AIOps 2022 归档、同一天测试环境和原始指标切片，每例包含全部节点、容器和服务的前后 600 秒。模型、Pi 版本、high 思考级别、输入、原始任务提示、8192 单回复限制、24000 累计输出和每例 720 秒上限保持一致。每条件每例一次，串行交替。没有重复采样、seed、在线修复或正式比赛榜单复现，不能据此作普遍提升或显著性结论。

Cairn 本轮使用冻结实现、更新 skill、90 秒提交预留和宿主输出契约验证器。这是组合改动比较，不能隔离各子功能的贡献。Pi 对照仍使用原提示及原生工具。原始 scorer 保持不动，服务 `-grpc` / `-http` 后缀等价政策在本轮首个输出前从第一轮复制并冻结；不会把 pod、node、service 层级相互等价。

验证器只检查 answer.json / REPORT.md 的字段、引用文件存在和第一候选在报告中出现；不读取标签，不核对数值含义或因果。12/12 控制检查表明八份旧输出（包括误判）均可通过，错误格式、缺失引用和候选不一致会被拒绝。其通过与根因正确分别统计。

此前 `2026-10-16-aiops2022-round2` 启动因 provider 拒绝缺显式 type 的条件 schema 而中止，保留两次 400 错误和已完成的 Pi 首例；整轮排除，不用其中单例替补本轮结果。schema 修复、198 项回归及独立真实 API 探针通过后，重新执行本轮全部八次。探针与中止试跑的用量不混入正式表格。

## 四例结果

| 案例／标签 | 第一轮 Pi+Cairn | 本轮 Pi | 本轮 Pi+Cairn |
| --- | --- | --- | --- |
| case-01 `recommendationservice2-0` / `k8s容器写io负载` | `node-6.recommendationservice2-0` / `disk_io`；联合命中 | `node-6.recommendationservice2-0` / `disk_io`；联合命中 | `node-6.recommendationservice2-0` / `memory`；联合未命中 |
| case-02 `node-6` / `node节点CPU故障` | `node-6` / `cpu`；联合命中 | `node-6` / `cpu`；联合命中 | `node-6` / `cpu`；联合命中 |
| case-03 `cartservice2-0` / `k8s容器内存负载` | `node-6.cartservice2-0` / `disk_io`；联合未命中 | `node-6.cartservice2-0` / `memory`；联合命中 | `node-6.cartservice2-0` / `disk_io`；联合未命中 |
| case-04 `productcatalogservice` / `k8s容器网络资源包损坏` | `productcatalogservice-grpc` / `unknown`；联合未命中 | `productcatalogservice-grpc` / `network`；联合命中 | `productcatalogservice-grpc` / `network`；联合命中 |

## 汇总指标

| 指标 | 第一轮 Pi | 第一轮 Pi+Cairn | 本轮 Pi | 本轮 Pi+Cairn |
| --- | ---: | ---: | ---: | ---: |
| 首选对象＋大类联合命中 | 3/4 | 2/4 | 4/4 | 2/4 |
| 首选对象命中 | 3/4 | 4/4 | 4/4 | 4/4 |
| 对象 Top-3 命中 | 4/4 | 4/4 | 4/4 | 4/4 |
| 资源大类命中 | 4/4 | 2/4 | 4/4 | 2/4 |
| 对象 MRR | 0.833 | 1.000 | 1.000 | 1.000 |
| 观察到的总耗时（分钟） | 34.24 | 43.57 | 31.45 | 39.10 |
| 服务端报告 token（含缓存读取） | ≥1,833,464 | ≥3,660,389 | 1,729,514 | ≥1,819,406 |
| 输出 token | ≥63,585 | ≥77,762 | 61,415 | ≥64,942 |
| 原生工具 / Cairn 工具 | 95 / 0 | 94 / 37 | 85 / 0 | 73 / 15 |
| 工具错误 | 0 | 21 | 1 | 1 |
| 实验进程超时 | 0 | 1 | 0 | 2 |
| 模型错误响应／其中恢复 | 2 / 2 | 3 / 3 | 0 / 0 | 1 / 1 |

未经服务协议别名复核的原始 scorer 联合命中依次为 3/4、2/4、3/4、1/4。复核只按预先冻结的同层级服务后缀政策处理标识，不改变资源大类。

耗时包含 API 延迟与重试；服务端返回模型名未独立核实底层身份。出现错误或中断时 token 为已完整记录回复的下界；含缓存读取，不等同实际账单。不得用两组下界相除报告精确节省比例。

## 交互开销与未完成重试

| 原始回执口径 | 第一轮 Cairn | 本轮 Cairn |
| --- | ---: | ---: |
| checkpoint 缺 summary 错误 | 20 | 0 |
| incomplete finish 回执 | 5 | 5 |
| 非工具错误的写入回执数 | 13 | 10 |
| 写入回执中位字节 | 3659 | 777.0 |
| 写入回执总字节 | 67285 | 9760 |

这里的字节是模型可见文本响应体积，不是token或账单。incomplete按每次工具回执计数；第一轮旧报告的4次是产生 task.finished 写入事件的次数，未包含一次无变化的重复检查，本表统一重数为5次。等待外部验证的内部结构检查单独记录，不算模型收到一次拒绝回执。

## 每例独立复核

### case-01 / pi

首选 pod 与 disk_io 大类正确，保留了内存与节点 I/O 的替代解释；fs_usage、节点 I/O 和业务延迟的主要样本可复算。报告把 fs_writes_MB 的非单调序列直接认定为区间写入量，再换算 81/118 MB/s 与 24.3GB，缺少采集口径支持。把 450MB 上限称为仅推断，遗漏已有 spec_memory_limit_MB 的 20 行 450MB；io.util 的峰值倍数也混入了均值倍数。正确标签不等同报告全部量化成立。

- **通过**：fs_usage 基线约 54.67MB，峰值 2906.22MB；独立复算：1647735960–6500 的 10 点均值 54.66536458MB；峰值 2906.22265625MB。来源 `evidence/container/kpi_container_fs_usage_MB.csv`。
- **部分错误**：node-6 io.util 基线 0.41%，峰值 30.95%（报告称峰值约 47 倍）；独立复算：1647735960–6440 均值 0.41111111，峰值 30.95，峰值/基线=75.2838 倍；约 47 倍对应异常段均值而非峰值。来源 `evidence/node/kpi_cloudbed2_metric_0320.csv`。
- **遗漏直接证据**：450MB 内存上限只是推断，未直接观测；独立复算：目标 pod 的 spec_memory_limit_MB 全窗 20 个样本均为 450；该独立字段已提供。来源 `evidence/container/kpi_container_spec_memory_limit_MB.csv`。
- **原始值通过，速率语义未证实**：五点写入量合计 24297MB，均值 81MB/s、峰值 118MB/s；独立复算：1647736500–6740 五点原始值之和 24297.39192708，最大 7092.03971354；非单调性本身不能证明这是每分钟区间量，MB/s 换算依赖未提供的口径。来源 `evidence/container/kpi_container_fs_writes_MB.csv`。

### case-01 / pi-cairn

首选 pod 正确，但把标签中的 disk_io 排成 memory，联合命中失败；报告明确保留磁盘写为替代解释，不能据此计为类别命中。相比第一轮该例，四项交付标准完整保存且无缺 summary 错误，外部输出契约验证 passed、任务 completed、宿主 closed，仍没有验证根因语义。数字审阅还发现报告声明的 6500 分界与实际按 6507 切窗不一致，failcnt 速率和业务均值因此无法按所述窗口复现；fs_writes 的原始均值被称作差分。四条 Finding 在最后 finish 一次写入，没有中间 checkpoint 或依赖边，本例不能证明黑板指导了探索。

- **触限通过，窗口均值不一致**：max_usage 自 1647736500 起为 450，等于独立 limit；故障前均值 110.1MB；独立复算：max_usage 自 6500 起全部 450，limit 全窗 20 行均为 450，通过；按声明 before=[5960,6500) 的九点均值为 72.3125，110.08125 来自含 6500 异常点的十点窗口。来源 `evidence/container/kpi_container_memory_max_usage_MB.csv + kpi_container_spec_memory_limit_MB.csv`。
- **时间窗与差分口径不一致**：failcnt 在 before=[5960,6500) 速率均值 450.1/s，after=[6500,7107] 为 3865.1/s；独立复算：所述 before 九点全为 0，内部八段速率均值 0；以右端点归属对全序列差分，after 十一段均值 4597.863636/s。450.1 和 3865.1 可由按给定异常时刻6507分窗且在各窗内差分复现，和报告明示的窗口/跨界处理不一致。来源 `evidence/container/kpi_container_memory_failcnt.csv`。
- **峰值通过，差分措辞错误**：fs_usage 峰值 1647736680 为 2906.2MB；fs_writes 差分均值 208→2260；独立复算：fs_usage 峰值时刻与数值通过；208.29648 和 2260.12461 是按6507分窗的原始 fs_writes_MB 样本均值，不是差分均值。来源 `evidence/container/kpi_container_fs_usage_MB.csv + kpi_container_fs_writes_MB.csv`。
- **窗口不一致**：service mrt 按 [5960,6500) 与 [6500,7107] 从 3.16 变为 6.59ms；独立复算：按声明窗口分别为 3.04884810、6.37008379；3.15671610、6.59433936 对应以6507分界的十点窗口。来源 `evidence/service/metric_service.csv`。

### case-02 / pi

node-6 / cpu 联合命中，正常 stop；将 CPU 用户态尖峰与其余节点、IO/内存/业务指标交叉核对，数字主体复算通过，并保留了未监控 pod/进程的归属限制。容器 CPU 原始序列非单调确实可观测，但据此认定“已经验证为每秒速率、单位cores”仍缺采集口径；节点百分比与容器原始样本之和不具备已证明的可比单位。其节点归属是合理候选推断，不能升级为直接观察到宿主机压力进程。

- **通过**：node-6 user CPU 基线2.96%，三点50.19/49.70/49.54%；独立复算：6740–7220均值2.96000000，7280/7340/7400为[50.19, 49.7, 49.54]。来源 `evidence/node/kpi_cloudbed2_metric_0320.csv/system.cpu.user`。
- **原始和通过，单位未证实**：node-6 七容器原始CPU样本合计1.044→1.228/1.156/1.174；独立复算：{'1647737220': 1.04417672, '1647737280': 1.22816508, '1647737340': 1.1562075, '1647737400': 1.17437268}；数值可复算，cores单位及每秒口径未由输入证明。来源 `evidence/container/kpi_container_cpu_usage_seconds.csv`。
- **通过**：load.1 由均值0.73升至7.37；独立复算：6740–7220九点均值0.73333333；7400峰值7.37。来源 `evidence/node/kpi_cloudbed2_metric_0320.csv/system.load.1`。

### case-02 / pi-cairn

节点 node-6 与 cpu 大类正确，节点 CPU 三个峰值和 load.1 峰值复算通过；保留了未监控 pod/节点进程等归属不确定性。容器 CPU 被写成“已按60s差分的增量”，需要采集口径支持；低容器序列不能单独证明压力进程一定在容器之外。状态方面，未按 TASK.md 分列四项标准，创建时省略 criteria，自动成为一个宽泛 c1；checkpoint/finish 只有 summary，没有保存任何 Finding。六次 finish 调用中五次返回缺少 supported conclusion，末次因模型回复达到长度上限未执行；随后触及720秒，含一条连接错误。最终文件存在且标签正确，任务仍 active，验证器未运行，宿主 closed；没有实际预算收尾通知。本例揭示语义验收反馈仍不能确保模型纠错，且提醒依赖后续宿主事件。

- **通过**：CPU 基线4.71%，三点52.11/51.70/51.60%，恢复后4.81%；独立复算：1647736740–7220九点均值4.71111111；7280/7340/7400为52.11、51.70、51.60；7460–7880八点均值4.8075。来源 `evidence/node/kpi_cloudbed2_metric_0320.csv/system.cpu.pct_usage`。
- **通过**：load.1 峰值7.37，峰前1.50→5.22→7.37；独立复算：7280、7340、7400分别1.50、5.22、7.37；6740–7220均值0.73333333。来源 `evidence/node/kpi_cloudbed2_metric_0320.csv/system.load.1`。
- **原始值通过，差分/归属语义不足**：容器CPU已按60秒差分，最大productcatalog约0.39；独立复算：7280/7340/7400 的原始值为[0.39126389, 0.35876091, 0.39553767]，非单调；约0.39是原始值而非相邻差分。输入未提供采集预处理说明，不能把该口径直接对齐节点百分比。来源 `evidence/container/kpi_container_cpu_usage_seconds.csv`。

### case-03 / pi

首选 cartservice2-0 / memory 联合命中，正常 stop。failcnt 的增量/平均速率以及 max_usage 到128的证据成立，恢复计划使用 failcnt 增量与 cache，而未要求历史峰值自行下降。仍错误声称没有独立 spec_memory_limit_MB（目标20行均为128）；把CPU、读盘峰值记早了60秒，把cache最低点记早60秒，数值核对并未全部完成。CPU单位与配额的可比性在limitations中承认存疑；内存压力→回收→读盘/CPU的机制保持推断身份，不能等同观察到注入动作。

- **通过**：failcnt 从3324.5增至56889，600秒增量53564.5，约89/s；独立复算：1647738960=3324.5、9560=56889；差53564.5/600=89.27416667/s；8420–8900九点全为0。来源 `evidence/container/kpi_container_memory_failcnt.csv`。
- **遗漏直接证据**：容器无显式 spec_memory_limit_MB，128仅由swap_limit推断；独立复算：kpi_container_spec_memory_limit_MB.csv 已提供该pod全窗20行，全部128；max_usage 自9020起十点为128。来源 `evidence/container/kpi_container_spec_memory_limit_MB.csv + kpi_container_memory_max_usage_MB.csv`。
- **数值通过，峰值时刻错误**：cache最低8192B在9260；CPU9.314/读盘238.2/node读5416峰值在9140；独立复算：cache最低8192B首次9320（9260=2592768B）；CPU9.313819402、throttled53.779047399、容器读238.17578125和node读5416的峰值均在9200。来源 `evidence/container/kpi_container_memory_cache.csv + kpi_container_cpu_usage_seconds.csv + kpi_container_cpu_cfs_throttled_seconds.csv + kpi_container_fs_reads_MB.csv + evidence/node/kpi_cloudbed2_metric_0320.csv`。

### case-03 / pi-cairn

pod 定位正确，首选 disk_io 仍与 memory 标签不符；memory 以0.3置信度排第二，明确记录 limit=128、max_usage顶限及failcnt，较第一轮遗漏这些反证更可审阅，但其“内存只是伴随症状”的解释未由独立证据证实。fs_usage阶跃、节点读峰值、服务延迟复算通过；memory_max的before均值却混入声明窗口之外的点。对CPU非单调序列一律按reset剔除负差分缺少采集口径和重启证据。四项标准、三条supported Finding、一次checkpoint、宿主验证passed均保存，任务completed、宿主closed；没有依赖边，也未触发收尾提醒。

- **通过**：fs_usage 从3.4699MB升至25.2171MB，9080跃升约23.7MB；独立复算：8420–8960十点均值3.46985677；9020–9560十点25.21705729；9020=3.734375、9080=27.435546875。来源 `evidence/container/kpi_container_fs_usage_MB.csv`。
- **通过**：node-6 rkb_s 从5.0升至541.6KB/s，9200峰值5416；独立复算：8420–8960十点仅8480=50，其余0，均值5；9020–9560十点仅9200=5416，均值541.6。来源 `evidence/node/kpi_cloudbed2_metric_0320.csv/system.io.rkb_s`。
- **顶限通过，before窗口不一致**：memory_max before=[8420,8900]均值65.30MB，之后128等于limit；独立复算：所述九点均值61.98531539；65.30240885是含8960=95.15625的十点均值；自9020起128及独立limit全窗128均通过。来源 `evidence/container/kpi_container_memory_max_usage_MB.csv + kpi_container_spec_memory_limit_MB.csv`。
- **通过**：cartservice mrt均值1.064→1.667ms，9260峰值4.704；独立复算：同声明十点窗口均值分别1.06400723、1.66706133；9260=4.70360360，sr全为100。来源 `evidence/service/metric_service.csv`。

### case-04 / pi

首选 productcatalogservice-grpc / service / network 联合命中，717.08秒正常结束，接近720秒上限；一次Python括号SyntaxError随后修复。节点和主要业务统计可复算；缺失采样桶数错误，checkout峰值有遗漏。报告明确把调用拓扑、丢包细分和缺失原因列为推断/待补证，但正文仍出现“无完成请求”和“排除其他资源”的过强表达。网络/CPU均按负差归零后再求差分速率；非单调样本不构成重启或原始累计口径证据，单位及“积压回补”因果均未独立证实。

- **原始均值通过，速率单位依赖采集口径**：node-5重传0.010→1.3538，UDP错误0.003→0.5212；node-6重传0.005→0.4363，UDP错误0→0.1625；独立复算：9680–0220十点与0280–0700八点的均值依次为node-5 retrans 0.01→1.35375、udp 0.003→0.52125；node-6 retrans 0.005→0.43625、udp 0→0.1625。。来源 `evidence/node/kpi_cloudbed2_metric_0320.csv/system.net.tcp.retrans_segs + system.net.udp.in_errors`。
- **主体数值通过，缺失桶数错误**：productcatalog count基线930.3→216，0340–0640四桶缺失；恢复mrt=4827.9/2653.6；独立复算：基线十点count均值930.3，0280 count=216；0340、0400、0460、0520、0580、0640共六个60秒桶缺行，不是四个。0700/0760 mrt分别4827.88659170/2653.64669632；缺失原因无法仅由表格确定。。来源 `evidence/service/metric_service.csv`。
- **均值通过，checkout峰值错误**：故障窗口frontend mrt均值25414、sr58.4，recommendation均值843.4，checkout峰值5946；独立复算：0280–0700八点frontend mrt均值25414.03707302、sr均值58.36273201；recommendation mrt均值843.42890047；checkout均值2596.94375、峰值14760.75，5946.3只是其中一点。。来源 `evidence/service/metric_service.csv`。
- **给定计算规则可复算，倍数范围及口径有问题**：四副本接收速率1.45/3.70/4.68/7.51→0.66/0.70/0.68/0.49，均降低5–15倍，之后24.4/22.0/19.9；独立复算：按相邻样本正差分截零并除以所述窗口秒数，pre/fault/post依次为{"node-5.productcatalogservice-0": [1.4475, 0.66009281, 24.4408284], "node-5.productcatalogservice-1": [3.70166667, 0.69721578, 22.03550296], "node-5.productcatalogservice-2": [4.68083333, 0.67517401, 19.93491124], "node-6.productcatalogservice2-0": [7.51, 0.49458623, 8.57692308]}；首副本仅约2.2倍下降，不是5倍。全部四条原始序列均有负差，缺少证据证明应视为计数器reset；截零差分与pkt/s单位、积压回补解释均待采集元数据确认。。来源 `evidence/container/kpi_container_network_receive_packets.csv`。

### case-04 / pi-cairn

首选 productcatalogservice-grpc / service / network 联合命中（按预先冻结的服务协议别名归一化），相比第一轮 unknown 更贴近标签。核心业务降级与节点重传数值成立，但拓扑未提供，报告把调用依赖和缺失行等同无完成请求写入直接观测，随后才承认缺失也可能来自采集；因果强度仍偏高。CPU after 均值省略过渡点而未声明窗口。四项标准与四条Finding保存（其中一条inconclusive），没有依赖边，覆盖均为空；90秒reserve提醒实际触发，但未调用finish便在720秒超时，任务active、宿主closed，外部验证未运行。答案正确与任务完成是两个独立结果。

- **数值通过，缺失原因未证实**：productcatalog 基线mrt约3.4、count约930；0280 count=216，0700 mrt=4827.9、sr=90.5，0760 mrt=2653.6；独立复算：9680–0220十点mrt均值3.41245991、count均值930.3；0280 count=216；0700 mrt=4827.88659170、sr=90.48442907；0760 mrt=2653.64669632。0340–0640确实缺六行，但原始数据不能区分无完成请求与采集缺失。。来源 `evidence/service/metric_service.csv`。
- **主体数值通过，z与零基线表述有误**：node-5 retrans均值0.010→1.35，范围1.26–1.46/s；udp错误0→0.39–0.60/s，z约53.6；独立复算：9680–0220 retrans均值0.01；0280–0700八点均值1.35375、min/max=1.26/1.46；按基线总体标准差z=67.1875（样本标准差为63.73965909），不是53.6。udp基线均值0.003，after均值0.52125、范围0.39–0.60；单位速率未由预处理元数据独立证实。。来源 `evidence/node/kpi_cloudbed2_metric_0320.csv/system.net.tcp.retrans_segs + system.net.udp.in_errors`。
- **遗漏过渡点，窗口未声明**：productcatalog-0 CPU在0280–0700为0.023–0.042，均值约0.031，约1/12；独立复算：基线十点均值0.3637327024；声明八点窗口min/max=0.022506089/0.155575261，均值0.04577563794。0.03008997750不含0280过渡点，约1/12仅对七点子窗成立。。来源 `evidence/container/kpi_container_cpu_usage_seconds.csv`。
- **数值通过，拓扑未证实**：frontend mrt峰值38410.2、sr最低40%，recommendation峰值1453.6；cart保持1.0–1.2；独立复算：0280–0700 frontend mrt最大38410.15909091、sr最小40；recommendation最大1453.55909091；cart mrt范围1.04750000–1.19000000、均值1.08134301。调用关系是推断，非该指标表提供的事实。。来源 `evidence/service/metric_service.csv`。

## 任务、验证与宿主状态

| 案例 | 任务状态 | 结构／当前验证凭据 | 宿主最近状态 | 独立根因联合命中 |
| --- | --- | --- | --- | --- |
| case-01 | completed | 通过 / passed（当前完成检查通过） | closed | 否 |
| case-02 | active | 未通过 / 未执行（当前完成检查未通过） | closed | 是 |
| case-03 | completed | 通过 / passed（当前完成检查通过） | closed | 否 |
| case-04 | active | 未通过 / 未执行（当前完成检查未通过） | closed | 是 |

本轮四个 Cairn 目标均绑定宿主预算；实际收尾通知 1 次。外部验证通过 2 个目标，未运行 2 个。回调未运行或通过均不替代独立标签评分。


宿主状态是已观察到的生命周期事件，突然 SIGKILL 可能没有机会写入最终事件；runner 的进程终态记录作为补充。内部等待外部验证前的 structural check 缺口不等同模型收到一次失败的 finish；工具回执与 verifier 事件分别记录。

## 接入试跑与额外用量

正式复测前，中止启动包含两次 provider schema 400，以及一个完成的 Pi 首例和一个未完成的 Pi CPU 片段，完整回复的 token 已记录下界为 542,206。另有两次不含案例的 schema 探针（一次同因失败、一次成功），记录 token 合计 4,766。它们不混入正式性能比较，详情见本轮 startup-attempts.json；不能将正式表格理解为整个工程过程的全部消耗。

## 可复核产物

- 原始运行、工具与 provider usage：`runs/2026-10-16-aiops2022-round2b/case-*/pi*/`。
- 记录一致性检查 54/54；冻结实现／跨轮设置／宿主配置检查 66/66。这些检查不等同内容正确性。
- 每例评分 `grade.json` / `reviewed-grade.json`，本轮逐项数值与语义审阅 `qualitative-audit.json`。
- `summary.json`、`round2-audit.json`、`round2-state-validation.json`、`scope-audit.json` 和 `reference-stats.json` 单独保存。原始数据与运行日志均保留本地 ignored 目录。
- 路径范围检查 42 项，显式违规标记 0 项；只检查可见参数和明显命令模式。模型工作区未施加 OS 沙盒，动态构造路径不能由该检查排除，不将其作为严格数据隔离证明。
- 第一轮报告 [comparison.zh-CN.md](comparison.zh-CN.md) 保留；复现方法见 [README.zh-CN.md](README.zh-CN.md)。
