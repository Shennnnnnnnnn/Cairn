> 历史记录：本文保留当轮版本、协议、数据和结论，不代表当前 4.9 的接口或性能。当前用法见[文档导航](../../docs/README.zh-CN.md)。

# 第九轮：Pi / DeepSeek 同模型重复对照

两组均实际使用本机 Pi 1.1.0、`sub2api-copy/global:deepseek-v4.1-flash`、thinking=high。相同三道开发题各三次，共18个全新会话，最多3并发，不设评测时间/token/调用预算。原生提示、案例、产物契约、复算及隐藏标签政策与第八轮一致。全部尝试保留，未选择性重跑。

联合命中：原生 9/9，Cairn 9/9；有效交付分别 8/9、9/9。Cairn 的全部尝试 recorded tokens 相对原生 -39.3%，CLI累计耗时 -24.6%。这些是本开发集的描述结果，不能推断长期稳定性或单独归因于本轮修改。

本轮支持的结论是：Cairn交付更齐全、记录用量更低；两组联合正确率相同，没有证明根因判断更强。原生少一次交付直接源于连接失败，不能全部归因于框架。I/O题Cairn三次都保留同服务memory备选，但仍缺少证明因果方向的干预/日志证据。

| 指标 | 原生 Pi | Pi+Cairn |
|---|---:|---:|
| 对象+资源族+层级联合正确 | 9/9 | 9/9 |
| 完成 | 8/9 | 9/9 |
| 产物格式契约通过 | 8/9 | 9/9 |
| 独立数值复算通过 | 9/9 | 9/9 |
| 格式+数值验收通过 | 8/9 | 9/9 |
| 有效正确交付 | 8/9 | 9/9 |
| 错误完成：已完成但标签错 | 0/9 | 0/9 |
| 无效完成：已完成但未有效交付 | 0/9 | 0/9 |
| 服务错误消息 / 同会话恢复后正常结束次数 | 30 / 8 | 18 / 8 |
| 最终未正常结束 | 1/9 | 0/9 |
| 真实中断/交接恢复 | N/A | N/A |

完成要求原生最终正常stop（中途原生重试恢复不抹掉最终成功，错误仍另列）、三文件非空和候选有效；Cairn还要求唯一真实owner任务completed、报告有效和当前宿主验收proof。联合正确按精确对象、资源族和node/pod/service层级计；service仅允许既有-grpc/-http等价。有效交付还要求格式/数值验收通过且输入完整。完成、验收与结论正确性分开。

## 成本与波动

Pi记录的input为非缓存输入，cacheRead/cacheWrite另外记录；表内总量为input+output+cacheRead+cacheWrite，不重复加reasoning。所有尝试均计入每次有效交付成本。配置cost=0/缺失不能证明免费，实际金额未知。

| 指标 | 原生 Pi | Pi+Cairn |
|---|---:|---:|
| 全部recorded tokens | 33,899,676 | 20,578,755 |
| 非缓存输入tokens | 1,911,250 | 1,540,798 |
| 缓存读取tokens | 31,528,192 | 18,687,104 |
| 缓存写入tokens | 0 | 0 |
| 输出tokens（包含reasoning） | 460,234 | 350,853 |
| 全部CLI累计秒数 | 3,701.66 | 2,792.44 |
| 每次有效交付recorded tokens | 4,237,459.50 | 2,286,528.33 |
| 每次有效交付非缓存输入+输出tokens | 296,435.50 | 210,183.44 |

探针独立列账：31,528 tokens；正式总量 54,478,431。原生/Cairn用量下界标记：True/True。缓存分布、输出长度和服务批次均会影响成本，不只取决于工具数量。

| 题目 | 组别 | 联合正确 / 有效交付 | tokens中位数 [最小,最大] | tokens CV | 秒数中位数 | 时间CV |
|---|---|---|---:|---:|---:|---:|
| new-01 | pi | 3/3 / 2/3 | 5,703,762 [1,331,706,8,492,661] | 0.697 | 493.7 | 0.485 |
| new-01 | cairn | 3/3 / 3/3 | 1,552,176 [1,208,018,2,980,641] | 0.491 | 301.2 | 0.184 |
| new-02 | pi | 3/3 / 3/3 | 3,453,440 [3,151,506,4,157,737] | 0.144 | 424.2 | 0.159 |
| new-02 | cairn | 3/3 / 3/3 | 3,209,627 [1,977,658,4,283,607] | 0.366 | 344.5 | 0.233 |
| new-03 | pi | 3/3 / 3/3 | 2,469,027 [2,281,216,2,858,621] | 0.116 | 345.7 | 0.078 |
| new-03 | cairn | 3/3 / 3/3 | 1,793,553 [1,485,915,2,087,560] | 0.168 | 279.5 | 0.182 |

本轮Cairn在new-01（I/O）与new-02（CPU）的tokens CV分别为0.491、0.366，仍触发预登记波动阈值；内存题三次未触发该标记。CV>0.25或max/min>2仅标记本样本波动；3个事件内重复相关，不是9道独立题。没有真实强制中断、预算停止或新会话恢复，不能从门禁单测推算恢复率。

## 工程修改与实际协议行为

- findings/progress/artifacts/handoffs 共用有界单层对象解码，随后执行原严格校验；schema仍请求对象，finish接口不扩展。Pi增加文档支持的prepareArguments，避免宿主先验校验挡住兼容入口。
- 因果比较保持通用：先比较同一对象的不同机制，再比较层级。压力可能是起因、中介或后果，用区别性预测/时序/方向证据比较；缺证据保留不确定性。不新增模型、领域规则或强制报告字段。
- 完整回归272/272；本机Pi真实校验器6/6；上轮三份原始编码拒绝载荷重放3/3通过；真实合成探针独立DB/owner/验收proof通过。

| 公开工具元数据 | 原生 Pi | Pi+Cairn |
|---|---:|---:|
| 工具调用 | 419 | 341 |
| 工具错误 | 17 | 18 |
| Cairn调用 | 0 | 43 |
| checkpoint调用 | 0 | 20 |
| checkpoint失败 | 0 | 0 |
| 实际被接受的编码兼容调用 | 0 | 0 |
| Cairn公开返回文本字节 | 0 | 175710 |

对象字符串元素按findings/progress/artifacts/handoffs统计：{"findings": 0, "progress": 0, "artifacts": 0, "handoffs": 0}。直接Pi扩展调用的返回字节不是模型tokens，也不与上轮Codex MCP传输字节作等价节省比较。若正式调用未触发某种编码，兼容结论仅由明确的回归与实际宿主校验验证，不能声称该场景在正式题目中被触发。

## 完整报告审阅

下列观察在全部隐藏标签评分前记录。完整报告逐份阅读并SHA封存；既有开发案例已知，审阅不是盲审。

- **new-01-r1-pi**：shippingservice/service/disk_io；标签正确；有效交付=False。公开终态为Connection error，五条API错误；未产生最终REPORT.md，未手动恢复或重跑。已有尝试成本保留。

- **new-01-r1-cairn**：shippingservice-grpc/service/disk_io；标签正确；有效交付=True。完整报告选择shippingservice-grpc/service/disk_io，明确比较同服务内存压力、node-5宿主I/O与单pod范围，认为读负载/缓存解释更强；承认缺少注入命令、拓扑、精细时序与受控验证，未证明因果方向。报告的MB/min用语与其单位未文档化声明存在张力。五组数值待统一独立验收；未读取隐藏评分。 后续核对原始CSV：shippingservice-0的fs_usage在0960才从33.22升到656.20，0900先出现读负载和内存贴限；报告将三者均叙述为0900开始不准确，方向不能据该时间线证明。

- **new-02-r1-cairn**：node-2/node/cpu；标签正确；有效交付=True。完整报告选择node-2/node/cpu，用两点用户CPU上升及滞后load核对，同一节点网络/内存/I/O备选分别讨论，并承认node-2容器缺测不能细化pod。把散发网络尖峰直接称为采集伪影的排除语气过强；把40个有资源指标的容器称作全部容器，遗漏两个仅网络对象，且container文件数57应为55。数值与格式待统一验收，未读隐藏标签。

- **new-02-r1-pi**：node-2/node/cpu；标签正确；有效交付=True。完整报告选node-2/node/cpu，列出用户CPU/总CPU/短load的两点峰值与恢复，对同节点其他资源及node-5 I/O下降、pod网络尖峰、合法工作负载均保留不同解释；承认node-2容器缺测和无业务影响。量化三源gauge窗口清楚，数值与格式待统一验收。容器范围还单列redis-cart网络数据，未把40资源对象全当全集。

- **new-03-r1-pi**：node-5.recommendationservice-2/pod/memory；标签正确；有效交付=True。完整报告定位recommendationservice-2/pod/memory，比较单pod内存增长与父节点伴随变化，保留泄漏/压力注入/缓存细分和OOM缺少直接证据；将晚约468秒的node-3 I/O列为弱备选并承认服务影响轻微。四组gauge/counter-rate窗口、gap和failcnt采集口径有说明。一个“同node其他pod”示例却写node-6对象，属于叙述范围问题。终态stop，经历4条连接错误并原生继续；数值格式待统一验收。

- **new-03-r1-cairn**：node-5.recommendationservice-2/pod/memory；标签正确；有效交付=True。完整报告选recommendationservice-2/pod/memory，用RSS/工作集、max/failcnt与父节点增量比较同pod磁盘、node内存、流量和晚发node-3 I/O；保留注入/泄漏和OOM缺证。将相关内存指标称为相互独立证据不准确；叙述failcnt在触顶后增长与表中首次failcnt早于max=900的时序不一致；把node-3弱关联称例行刷盘缺直接依据。40×55覆盖简写未说明网络专有对象。四组数值待统一验收。 后续对原始CSV核对发现报告辅助CPU时间写6560/6860/6920，实际为6520/6820/6880，均错移40秒；主要checks为其他四个序列，不能据此声称全部叙述时间准确。

- **new-02-r2-cairn**：node-2/node/cpu；标签正确；有效交付=True。完整报告选node-2/node/cpu，比较全六节点CPU和同节点内存/磁盘，并将网络变化可能为伴随或独立流量保留；node-2容器缺测使具体进程/pod不可识别。五组gauge窗口包括同对象内存与另一节点CPU对照，明示未执行验证。给定时刻只作为线索，未过度声称注入已证实。数值格式待统一验收。

- **new-02-r2-pi**：node-2/node/cpu；标签正确；有效交付=True。完整报告选node-2/node/cpu，通过全部节点横向比较、同node其他资源与用户CPU/总CPU/load三源复核；保留未观测pod与合法负载并承认无业务影响，未把层级缺测自动转成service/pod结论。三组gauge统计明确，数值格式待统一验收。

- **new-03-r2-pi**：node-5.recommendationservice-2/pod/memory；标签正确；有效交付=True。完整报告选recommendationservice-2/pod/memory，四组gauge均值和父节点对应，区分一次性分配/泄漏/cache等尚未唯一确定；把晚发node-3 I/O、伴随CPU和网络尖峰作为弱备选，解释时间桶与给定时刻差12秒。保留节点/容器回落不完全同步。辅助时间线把454.631写成454.53，非主要check数值；未读隐藏标签。

- **new-03-r2-cairn**：node-5.recommendationservice-2/pod/memory；标签正确；有效交付=True。完整报告选recommendationservice-2/pod/memory，保留相同pod的泄漏/注入/分配/缓存细分，RSS增幅远大于cache增长；比较父节点、晚发node-3 I/O、伴随CPU与轻微服务变化。四个原始gauge/max检查窗口和边界采样gap明确，未把failcnt绝对值当速率。未声称具体机制已证实；数值格式待统一验收。

- **new-01-r2-cairn**：shippingservice-grpc/service/disk_io；标签正确；有效交付=True。完整报告选shippingservice-grpc/service/disk_io，明确将同服务memory保留为正式候选3，另讨论同节点I/O和pod范围；比较cache/RSS、文件增长、读负载与对照高I/O基线，并正确区分0900读/内存与0960 fs_usage阶跃。六组检查、failcnt差分和单位假设均说明。但“若内存为主应OOM/重启”并非必要条件，且非单调本身不能证明指标已是速率；因果方向仍缺受控证据，不应读成已证实。数值格式待统一验收。

- **new-01-r2-pi**：shippingservice-grpc/service/disk_io；标签正确；有效交付=True。完整长报告选shippingservice-grpc/service/disk_io，比较同服务file-backed内存压力与cache/RSS、node/多pod范围，明确42总对象/40资源对象和7个缺/dev/vda读序列，不能把缺测当零；承认节点/服务混杂及容器/节点读量不可直接相加。七组数值待验收。主要问题：把未知口径CPU total-user-system余量视为I/O等待缺证；报告称last_seen恒定，原始shipping-0有20个不同last_seen值，应为持续更新。详细探索成本较长但含有额外有效限制分析，不能全当无用开销。

- **new-03-r3-pi**：node-5.recommendationservice-2/pod/memory；标签正确；有效交付=True。完整报告选recommendationservice-2/pod/memory，四项working set/父节点/差分failcnt/max检查；RSS增幅远大于cache，并对线程/FD/生命周期与晚发node-3 I/O作交叉比较。明确机制、OOM和被杀进程尚不能证实。把last_seen+40s直接作为采样桶覆盖起始时刻的证明仍依赖未证实的时间戳语义；“40个具有容器级指标”口径需限定为资源指标覆盖。数值格式待统一验收。

- **new-03-r3-cairn**：node-5.recommendationservice-2/pod/memory；标签正确；有效交付=True。完整报告选recommendationservice-2/pod/memory，明确将同pod CPU节流视为竞争机制并给出只加CPU的区分预测，RSS/缓存和内存限额等原始观测与细分推断分开。五组数值待验收。主要剩余问题是把42个容器都算作有内存对照（实际40资源/2仅网络）、其余41与6节点均平稳的过广表述，以及node-3 await单位未经确认直接写s、其余采样均0与原始非零小值不符；不应把这些辅助叙述当验收已证实。

- **new-01-r3-cairn**：shippingservice/service/disk_io；标签正确；有效交付=True。完整报告选shippingservice-grpc/service/disk_io，正式候选2为同一对象memory、候选3为node-5 I/O，RSS/cache与文件增长/持续读分别比较；未确认语义的fs_reads仅作辅助，checks用两pod fs_usage+node速率+service gauge。保留部署/单pod不唯一与粗采样缺证。主要不足仍是把缺读序列的其他pod一概视为0，且从共现推到明确后果的语气略强；四组数值待验收。

- **new-01-r3-pi**：shippingservice-grpc/service/disk_io；标签正确；有效交付=True。完整报告选shippingservice-grpc/service/disk_io，比较同服务memory与node/pod粒度，依据RSS/cache与容器/节点读信号；九组mean/rate检查窗口避开0900过渡点。主要问题是开头称fs_usage在0900跳升而后面时间线正确写0960、未知CPU口径先换成0.04核下结论又在限制中否认确定核数、以及对未知单位的节点读/写量级比较过强。保留缺拓扑/注入命令和节点压力仍可能的限制；数值格式待验收。

- **new-02-r3-pi**：node-2/node/cpu；标签正确；有效交付=True。完整报告选node-2/node/cpu，以四组mean和节点横向/同node其他资源比对；明确未知node-2 pod与合法负载不能排除，给出最可能而非已证实根因。统计40资源/42总对象口径清楚。仍有last_seen恒定的辅助断言错误（该类值随采样更新），且非单调即cores gauge的单位判断不充分；主要数值格式待统一验收。

- **new-02-r3-cairn**：node-2/node/cpu；标签正确；有效交付=True。完整报告选node-2/node/cpu，比较用户态CPU/总CPU/load与同节点其他资源、全六节点峰值、网络单点及背景pod尖峰，保留上层共同事件与未观测pod；四项数值待验收。把非单调container指标断言已折算速率及network MB/s单位仍是未证实假设；约36% CPU不足以确定单核负载语义。没有把容器缺测直接当已发现具体pod，范围限制较清楚。

## 可比性与结论边界

公开API/流错误共48条：45条Connection error、1条terminated、1条429限流、1条503不可用；原生/Cairn分别30/18条。同会话最终恢复并正常结束的会话各8次；没有跨会话/owner交接恢复。原生连接失败的会话已生成正确候选和checks，但未交付最终REPORT，所以联合命中9/9并不意味着9/9完整完成。

本轮是原生Pi与新版Cairn的同模型对照。第八轮使用GPT-6.1-Sol/xhigh，原生/Cairn联合命中9/9、8/9，有效交付均8/9；这些只是跨模型历史参考。本轮没有同模型旧Cairn臂，不能测出本轮修改相对旧Cairn的独立增益。

冻结/记录审计 581/581 通过，输入哈希、模型/effort、会话唯一性、私有配置删除、全局配置未变及当前验收proof分别核对。Pi没有OS级执行沙箱；公开路径/命令检查不能证明所有脚本内部行为或访问完全隔离。

公开路径核对记录了目录约束例外：8次读取宿主注册的冻结skill路径；两次原生会话各把自身脚本stdout写入共享/tmp文件后自行删除（只见各自写者引用，未见其他会话引用这两个路径）；另一次Cairn命令尝试cd /Users/dsec，立即返回自己的工作区后才读取证据。这些不能被描述成严格隔离全部通过，详见public-scope-review.json和public-scope-manual.json。

数值验收只覆盖提交的checks，不能保证整篇报告的时序、单位、缺测处理和因果解释都准确。审阅已保留辅助时间错移40秒、将缺测当正常、过强OOM必要条件等问题；原生与Cairn都有相应叙述风险。

这三题是同一公开测试床的同日指标切片，已参与开发，可能存在训练污染。不能把数字复算通过等同因果正确，也不能用三次一致作长期稳定承诺。

实现与复现入口：[实现说明](../../docs/optimization-round9.zh-CN.md)、[预登记协议](protocol-round9.zh-CN.md)、[正式归档](runs/2026-10-17-pi-deepseek-round9-repeated/manifest.json)、[逐次结果与审计](runs/2026-10-17-pi-deepseek-round9-repeated/summary.json)、[公开协议错误明细](runs/2026-10-17-pi-deepseek-round9-repeated/public-metadata-supplement.json)。
