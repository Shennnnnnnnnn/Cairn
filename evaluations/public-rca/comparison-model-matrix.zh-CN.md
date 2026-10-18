> 历史记录：本文保留当轮版本、协议、数据和结论，不代表当前 4.9 的接口或性能。当前用法见[文档导航](../../docs/README.zh-CN.md)。

# 四模型难例实测：原生 Pi、上一版 Cairn、本版 Cairn

题目为公开 AIOps 2022 指标切片 `case-03`，四模型分别使用三个执行配置，共 12 次全新会话。上一轮原生 Pi 与两版 Cairn 在故障类型上分歧，因此在本轮开始前选定本题。每条件仅一次；这是一道题上的可用效果比较，不能据此得出通用模型排行榜。

[开跑前协议](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/protocol.before.md) · [完整结果与控制审计](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/summary.json) · [逐份报告审阅](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/qualitative-audit.json) · [运行中并行变更](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/parallel-amendment.json)

## 本次观测

| 模型 | 原生 Pi 正确交付 | 上一版 Cairn 正确交付 | 本版 Cairn 正确交付 |
|---|---:|---:|---:|
| global:deepseek-v4.1-flash（high） | 否 | 是† | 否 |
| cn:step-5-preview（high） | 否† | 否 | 是 |
| cn:glm-5.3（high） | 是 | 是 | 是 |
| cn:kimi-k3-1（off） | 否 | 是 | 否 |

† 工作区约束偏离另列：DeepSeek 上一版 Cairn 写入、读回并清理共享 `/tmp/analyze_out.txt`；Step 原生 Pi 曾尝试切换到一个外部目录，随后回到自己的工作区才读取证据。主分数保留冻结口径；严格剔除边界偏离的正确交付为 5/12，原口径为 6/12。命中标签不代表严格符合执行协议。

| 模型 | 仅对象＋故障族命中 | 正确交付 | 三配置累计分钟 | 累计输出 token | 累计总 token（含缓存） |
|---|---:|---:|---:|---:|---:|
| deepseek | 1/3 | 1/3 | 19.26 | ≥179,727 | ≥9,651,200 |
| step | 2/3 | 1/3 | 77.54 | ≥206,464 | ≥28,686,597 |
| glm | 3/3 | 3/3 | 25.53 | 84,988 | 5,486,425 |
| kimi | 2/3 | 1/3 | 19.27 | 32,753 | 1,089,350 |

累计分钟是三个会话各自生命周期之和，并非整个并行实验的经过时间。

正确交付同时要求：自然结束、对应执行配置完成、三项产物的数值复算通过、首选故障对象与故障族均命中标签。Cairn 的完成还要求当前 owner/验证器的验收和产物哈希有效；原生 Pi 的完成按正常结束、有效候选答案和三项产物存在判定。标签只评首选对象与故障族，不证明全文的指标语义和因果叙述。

| 执行配置 | 完成 | 数值复算通过 | 对象＋故障族命中 | 正确交付 | 错误完成（已完成但标签错） |
|---|---:|---:|---:|---:|---:|
| 原生 Pi | 4/4 | 2/4 | 3/4 | 1/4 | 1/4 |
| 上一版 Cairn | 4/4 | 4/4 | 3/4 | 3/4 | 1/4 |
| 本版 Cairn | 4/4 | 4/4 | 2/4 | 2/4 | 2/4 |

同一题上的四模型观测按配置汇总；这四次不是四道独立案例，不构成框架通用准确率。

| 模型 | 配置 | 完成 | 复算 | 对象＋故障族 | 错误完成 | 分钟 | 输出 token | 输入 token | 缓存读取 token | 总 token（含缓存） |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| deepseek | 原生 Pi | 是 | 是 | 否 | 是 | 6.03 | ≥55,786 | ≥71,011 | ≥2,779,776 | ≥2,906,573 |
| deepseek | 上一版 Cairn | 是 | 是 | 是 | 否 | 7.94 | ≥70,291 | ≥70,386 | ≥4,704,256 | ≥4,844,933 |
| deepseek | 本版 Cairn | 是 | 是 | 否 | 是 | 5.29 | 53,650 | 72,092 | 1,773,952 | 1,899,694 |
| step | 上一版 Cairn | 是 | 是 | 否 | 是 | 24.52 | ≥64,334 | ≥1,275,339 | ≥5,090,688 | ≥6,430,361 |
| step | 本版 Cairn | 是 | 是 | 是 | 否 | 33.13 | ≥92,967 | ≥2,075,319 | ≥11,884,032 | ≥14,052,318 |
| step | 原生 Pi | 是 | 否 | 是 | 否 | 19.89 | 49,163 | 1,433,667 | 6,721,088 | 8,203,918 |
| glm | 本版 Cairn | 是 | 是 | 是 | 否 | 10.49 | 34,888 | 753,271 | 2,152,878 | 2,941,037 |
| glm | 原生 Pi | 是 | 是 | 是 | 否 | 6.23 | 22,411 | 289,632 | 375,578 | 687,621 |
| glm | 上一版 Cairn | 是 | 是 | 是 | 否 | 8.81 | 27,689 | 571,710 | 1,258,368 | 1,857,767 |
| kimi | 原生 Pi | 是 | 否 | 是 | 否 | 5.09 | 8,153 | 17,490 | 82,688 | 108,331 |
| kimi | 本版 Cairn | 是 | 是 | 否 | 是 | 8.46 | 14,615 | 41,047 | 555,520 | 611,182 |
| kimi | 上一版 Cairn | 是 | 是 | 是 | 否 | 5.73 | 9,985 | 32,172 | 327,680 | 369,837 |

输入列为 Pi 记录的非缓存输入，缓存另列；输出包含已计入的推理 token，不能再次叠加。不同模型的分词、缓存计费和服务速度可能不同，记录 token 不能直接换算成钱；登记价格为零，实际金额未知。耗时为 Pi 进程生命周期，token 仅统计被测会话；后续宿主复算、评分和本对话编排另计。带 ≥ 的记录出现过错误或不完整用量，只是上报下界。

## 接入与框架行为

| 模型 | 配置 | 原生工具 / Cairn 工具 | 工具错误 | 请求错误 / 原生重试 | checkpoint / 含主张 | 首次 checkpoint 秒 | finish 完成 / 调用 | 有来源且含主张的交接 |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| deepseek | 原生 Pi | 38 / 0 | 3 | 1 / 1 | 0 / 0 | — | 0 / 0 | 0 |
| deepseek | 上一版 Cairn | 57 / 5 | 0 | 1 / 1 | 2 / 2 | 144.5 | 1 / 1 | 0 |
| deepseek | 本版 Cairn | 26 / 4 | 1 | 0 / 0 | 2 / 2 | 180.8 | 1 / 1 | 4 |
| step | 上一版 Cairn | 68 / 9 | 12 | 1 / 1 | 2 / 2 | 631.5 | 1 / 3 | 0 |
| step | 本版 Cairn | 102 / 7 | 11 | 3 / 3 | 3 / 3 | 453.8 | 1 / 2 | 6 |
| step | 原生 Pi | 85 / 0 | 2 | 0 / 0 | 0 / 0 | — | 0 / 0 | 0 |
| glm | 本版 Cairn | 46 / 9 | 4 | 0 / 0 | 6 / 4 | 189.1 | 1 / 2 | 9 |
| glm | 原生 Pi | 31 / 0 | 1 | 0 / 0 | 0 / 0 | — | 0 / 0 | 0 |
| glm | 上一版 Cairn | 29 / 8 | 4 | 0 / 0 | 2 / 2 | 176.9 | 1 / 3 | 0 |
| kimi | 原生 Pi | 14 / 0 | 1 | 0 / 0 | 0 / 0 | — | 0 / 0 | 0 |
| kimi | 本版 Cairn | 22 / 5 | 1 | 0 / 0 | 3 / 3 | 126.4 | 1 / 1 | 5 |
| kimi | 上一版 Cairn | 19 / 3 | 0 | 0 / 0 | 1 / 1 | 175.7 | 1 / 1 | 0 |

checkpoint 列记录成功调用及其中携带 findings 的次数，不是新增事实条数；保存的是执行者的观测、假设和问题等主张，不能一律当作已验证事实。有来源的交接也不等于其内容正确或下一步建议及时更新。原生重试是同会话 API 重试，不是 Cairn 中断恢复。本轮没有主动中断或自动续跑，实际恢复成功率为“不适用”。

## 报告质量复核

- **deepseek / 原生 Pi**（[报告](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/deepseek/case-03/pi/initial.REPORT.md)）：保留了替代解释，正确区分内存历史高水位与当前用量，也没有把触限直接当作 OOM。主要缺口是用单个大峰值主导的六点相关支持 I/O→内存的因果方向；从文件系统总占用和 inode 指标推断具体新增文件及容器可写层，缺少文件级与挂载证据。报告把未注明单位的 mrt 写成毫秒，缩写时间线的前缀也不一致，复算通过未覆盖这些叙述。
- **deepseek / 上一版 Cairn**（[报告](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/deepseek/case-03/pi-cairn-previous/initial.REPORT.md)）：内存触限、failcnt 增量、cache/mapped-file 下降和节点未饱和形成了较完整的证据链，也明确保留 I/O 口径与细类不确定性。但报告开头将峰值更晚扩大为磁盘读和 CPU 限流更晚出现：二者在 1647738960 已与内存信号同时变化。目标 pod 的 start_time 被误写为 1647523079，原始值为恒定的 1647734633；恒定性质仍成立。这些叙述未被六项数值复算覆盖。
- **deepseek / 本版 Cairn**（[报告](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/deepseek/case-03/pi-cairn/initial.REPORT.md)）：保留了内存替代解释和设备口径差异，但将 +16 线程与 17 inode 拼成并发文件 worker 的解释缺少进程证据，并由非单调性推定每采样区间读量。报告宣告的 after 窗口内 cache 均值约 2.45 MB，正文写成 3.32 MB；128 MB 高水位首次出现在 1647739020，cache 跌至 8 KB 在 1647739320，不能称为同一采样点同时出现。用低 RSS 的分钟样本排低瞬时内存压力也过强。
- **step / 上一版 Cairn**（[报告](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/step/case-03/pi-cairn-previous/initial.REPORT.md)）：定位有广泛的跨对象对照，但排低内存的关键理由错误：以 working_set 峰值 93.2 MB 推出未触及 128 MB 上限，忽略同一 pod 的历史高水位已达 128 MB。修复验收后九项都改为 mean，包含明确单调累计的 failcnt，未满足任务对累计计数器差分/速率的要求；并把会回落的 pgfault 称为单调不减。mrt 的秒单位未经提供，未重启也不能证明没有 OOM。数值复算通过没有验证这些语义和条件覆盖。
- **step / 本版 Cairn**（[报告](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/step/case-03/pi-cairn/initial.REPORT.md)）：首选解释使用了触限高水位和单调 failcnt 的正确速率，并对 CFS 统计域矛盾保留不确定性。但多处时间戳错位：fs_usage 阶跃写成 1647739120（原始为 1647739080），node r_s 峰值写为 1647739140（原始为 1647739200），mrt 峰值写为 1647739200（原始为 1647739260）。声称全部服务成功率恒 100% 也不成立，adservice-grpc 为约 41.56–51.76%。非单调读量口径未确认，却除以 60 写成 MB/s；最终只验十项，开头仍称 12/12。标签与产物通过不能替代这些正文核对。
- **step / 原生 Pi**（[报告](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/step/case-03/pi/initial.REPORT.md)）：分析能将 failcnt 差分、max_usage 触及历史高水位和节点内存对照组合，并保留因果方向不确定性，但最终交付未通过复算：after rate=92.4278 使用窗口内相邻点，而任务要求先对全序列差分再分窗，重算应为 89.2741667；验收器另拒绝同一 failcnt 源序列的第二种统计。公开契约只写“两个不同的时序构成两项证据”，对逐项排重表达不够明确，这部分不能完全归因于模型；即使放宽排重，前述 rate 仍失败。正文还有较多未经检查覆盖的错误：把 cfs_throttled_periods 的差分均值写成原始均值，得到负的“均值”；峰值 308、节点读盘峰值 5416、mrt 峰值的时间多处整体提前 180 秒；启动时间 1647734633 明明早于采样窗，却称落在采样窗口内。非单调只说明不能直接按干净累积计数器差分，不能据此断定已经是非累积或重采样指标。
- **glm / 本版 Cairn**（[报告](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-glm-lane/glm/case-03/pi-cairn/initial.REPORT.md)）：能比较同节点与同服务对照，明确内存细类、因果链和采集口径的限制；数值复算通过，但语义及跨产物一致性仍有明显缺口。failcnt 全程单调不减，报告却称“非单调”并用原始累计值均值作为主证据，answer 又混写“单调上升”和“非单调”；answer 中 before mean=0 与实际 332.45 及 REPORT 不一致。报告宣称全部服务 rr/sr=100%，与 adservice-grpc 的 sr 约 41.6–51.8 不符；将未标单位的 mrt 写成毫秒且忽略约 4.70 的最高峰；容器数与 CSV 数也有误。说明数值检查能拦格式/选择器/算术，却不能替代指标类型和正文一致性审阅。
- **glm / 原生 Pi**（[报告](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-glm-lane/glm/case-03/pi/initial.REPORT.md)）：8 项数值检查通过；failcnt 正确使用全序列差分后按后一时间戳分窗，并显式声明调整后的 before/after 窗口。报告保留内存细类、部署关系和采集口径不确定性，整体比仅依赖幅度排名更可复核。仍不能把标签/复算命中当作因果证明：它声称限流和读爆发发生在内存触顶之后，但 throttled_seconds 与 fs_reads 在 8960 已非零，历史 max_usage 达 128 要到 9020；由此推导“内存先、IO/CPU 后”不成立。max_usage 为历史高水位，不证明当前用量持续为 128。mrt 的毫秒单位没有来源；跨设备的 fs_read_seconds 全零也不足以排除物理磁盘问题。
- **glm / 上一版 Cairn**（[报告](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-glm-lane/glm/case-03/pi-cairn-previous/initial.REPORT.md)）：5 项检查通过，正确使用 failcnt rate、历史峰值 max 和同节点/同服务对照，且明确未见 limit 下降，不能确认压力来源。正文与答卷仍有未被复算覆盖的错误：last_seen 每点递增却称全程不变；把 memory_failures 整体称为首次非零、峰值 50，混淆了此前已有非零值的 pgfault 与 pgmajfault 子序列；服务候选把 mrt 最高点时间写成 9200，实际 9260。将“工作集触及 128MB”写成解释也过强，working_set 的观测峰值约 93.21MB，达到 128 的是 max_usage 历史峰值指标。正确承认 adservice sr 较低，但“常年背景噪声”不能由 20 分钟窗口证明；mrt 毫秒单位也没有来源。
- **kimi / 原生 Pi**（[报告](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-kimi-lane/kimi/case-03/pi/initial.REPORT.md)）：报告能区分观测与推断，保留内存细分类别、采集口径和稀疏采样的不确定性，并同时讨论 CPU、I/O、节点和网络替代解释；使用 failcnt 差分，注意到 max_usage=128 是峰值而 working_set 约 64 MB。交付检查不完整：fs_reads 的真实指标键含 ./dev/vda 后缀，checks.json 写成 container_fs_reads_MB，复算第 1 项找不到样本；最后只校验 JSON 语法，未发现选择器错误。正文将未标单位的 mrt 写成毫秒；failcnt 首次达到 56889 是 1647739320，而文中写 9380；报告总述的 before=[T0-600,T0) 包含已非零的 8960 点，与表中 before=0 不一致，详细 rate 检查另用了更早基线。
- **kimi / 本版 Cairn**（[报告](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-kimi-lane/kimi/case-03/pi-cairn/initial.REPORT.md)）：报告简洁，能定位到单一 pod，并列出内存/节点/CPU/网络替代解释；6 条检查的源选择器和均值均通过复算。主要推理缺口是用分钟采样的 usage 平稳、低于 limit 来弱化内存假设，却未纳入 max_usage 从 9020 起达到 128 的历史峰值；因此“未触及 limit”过强。failcnt 为单调累计序列却直接比较原始均值，不能由此判定每秒失败强度；对 fs_reads_MB 的每 60s 窗口口径未获来源证明。报告称重复时间戳，但按 entity+metric 分组后的目标 fs_reads_MB 序列并无重复；answer 将 7.66 写入 before 最大值，实际该值在 9020 属于 after。mrt 毫秒单位同样未被源文件明确。
- **kimi / 上一版 Cairn**（[报告](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-kimi-lane/kimi/case-03/pi-cairn-previous/initial.REPORT.md)）：用 4 项不同源时序交付，failcnt 按约定全序列差分后分窗，max_usage/limit 与稳定的 recommendationservice 历史大计数对照能支持新发异常定位；明确 memory 与 disk_io 的因果方向无法唯一识别。全部数值复算通过且无工具错误。正文仍将全部服务 sr 描述为 100%，与 adservice-grpc 不符，并给 mrt 擅加毫秒单位；非单调 CPU 值不能据此确认已是每区间增量。建议清理异常增长的约 24MB 文件数据也缺少具体文件/写入者证据，不能由文件系统聚合用量定位可删除对象。max_usage 恒为 128 是历史高水位，不能理解为当前 usage 持续顶格。

## 结论与使用建议

在当前接入配置和这道混合资源信号题上，**GLM-5.3 是下一轮默认模型的优先候选**：三个配置都通过复算并命中首选对象＋故障族。原生 Pi 用时 6.23 分钟、上报总 token 687,621；上一版 Cairn 8.81 分钟、1,857,767；本版 Cairn 10.49 分钟、2,941,037。单次诊断可以先用原生 Pi；需要保存任务图、来源交接和独立验收时再加 Cairn。本题的三次结果不足以证明其他任务也有相同排序，GLM 的正文同样有时间顺序、指标语义及一致性问题。

**Kimi 的上报用量最低，但可靠交付不稳定。** 三配置累计总 token 1,089,350、输出 32,753；对象＋故障族命中 2/3，正确交付 1/3。原生 Pi 结论命中却遗漏设备后缀，检查无法复算；本版 Cairn 可复算，却把磁盘 I/O 排在内存之前；上一版 Cairn 才同时满足两项。它适合作为低用量候选继续验证，不能仅据少量输出认定结果可靠。本轮请求 off，但网关仍返回 reasoning token，实际推理开关执行情况未知。

**DeepSeek 流程较快，本题类别判断波动较大。** 三配置累计 19.26 分钟，首选故障族仅上一版 Cairn 命中；原生 Pi 与本版 Cairn 均选择 disk_io，出现两次“已完成但标签错误”。唯一命中的单元还违反了临时文件目录约束：若按严格工作区资格过滤，合规正确交付为 0/3；冻结的产物＋标签口径仍保留 1/3。其累计上报总 token 至少 9,651,200、输出至少 179,727，不能由耗时较短推断计费更低。

**Step 本轮不宜作为优先配置。** 标签命中 2/3，但正确交付 1/3：原生 Pi 的 rate 与公开约定不同，上一版 Cairn 类别误判，本版 Cairn 才完成且命中。三配置累计 77.54 分钟、至少 28,686,597 总 token；两版 Cairn 分别有 12、11 次工具错误，且出现连接错误和同会话重试。应先查重复检查、编辑失败和接入稳定性，再判断模型是否能在同等质量下减少消耗；不能把这些数值全部归因于模型本身。

**本版 Cairn 的证据支持交付和交接能力，尚不支持根因更准的结论。** 两版 Cairn 均 4/4 完成并通过复算，原生 Pi 只有 2/4 复算通过；本版四模型均可使用收窄后的 finish，上一版的 Step、GLM 曾因 finish 传参规则被拒绝。但对象＋故障族命中为：原生 Pi 3/4、上一版 Cairn 3/4、本版 Cairn 2/4；正确交付分别 1/4、3/4、2/4。严格工作区资格过滤后，上一版的正确交付为 2/4。每配置只有同一道题上的四模型观测，不能把波动直接解释为代码改动的因果效果。

八份数据库副本的离线重载均通过，目标、约束、主张、产物和 owner epoch 检查完整；本版四份都有已保存且可定位来源的交接，上一版四份没有这类自动交接包。这证明保存和重载机制可用，**实际模型中断恢复成功率仍不适用**，因为本轮未主动中断或续跑。四份新版终态交接的 next 仍含已做过的步骤，GLM 的旧主张还描述 8 条检查而最终只剩 6 条：持久化成功不等于下一步及时更新，也不等于主张已经独立验证。

下一步宜保持通用和轻量：澄清公开验收说明中的逐项排重规则；结束时清理已完成的 next；同 key 主张在产物修订后及时更新，保留证据来源和未解决反证；让数值验收、指标语义、因果判断分别显示。后续模型选择应在未参与开发的多道题上复验，并统一推理开关与并发条件。本轮不为某个模型或此题硬编码根因规则，也未改动核心框架来迎合成绩。

## 可比性与复核边界

- 三个执行配置使用同一底层 Pi 和原生工具；两版 Cairn 从上一轮完整归档复制。旧版不是 Cairn-main。核心实现未因本轮结果调整。
- 四模型走同一已配置网关。接入端清单含四个 ID，Pi 会话中的请求标识已核对；这些不独立证明网关内部实际路由。DeepSeek、Step、GLM 请求 high；Kimi 沿用注册的 reasoning=false，记录 off。结论包含该接入配置差异。
- thinking 是客户端请求与 Pi 记录的等级；Kimi 即使请求 off，部分会话仍上报 reasoning token，不能据此确认服务端实际执行了关闭推理的请求。
- GLM 仅在仓库外临时配置中注册，登记参数来自本机 Pi 自带 zai/glm-5.3 目录；其余三个登记不改。输出登记分别为 128000、64000、131072、1049000，均不是评测器临时压低的上限，也不保证服务端兑现。
- 未设置评测时限、累计输出限额、单次回复覆盖、Cairn deadline/reserve；保留原生硬限制、压缩、API 重试和错误，不选择性重跑正式样本。
- 全新会话与工作区，共同增加各自 cwd/.tmp 的临时文件约束；与历史轮次不是严格相同提示，只比较本轮矩阵。没有操作系统沙箱，命令审查不能证明硬隔离。
- 全部执行者结束后统一评分；没有在线标签反馈。前五单元串行；按用户随后要求，Step 原生 Pi 继续运行，GLM、Kimi 各新增一路并行，模型内部三个配置仍串行。并发最多三个执行者，共用网关，耗时含时间段、缓存冷热和并发负载混杂，不按耗时推导严格模型速度排名。DeepSeek 另有整轮作废的前序案例校准，可能影响服务端缓存冷热；正式会话和答案均未复用。
- 题目与模型各单元只有一次观测，且此题已参与前几轮框架开发调试，不是未见过的保留集。标签命中、数值复算、语义审阅和任务完成分列，不将其中一项替代其他项。

- 评测契约仍有表达缺口：验收器逐项拒绝重复源序列，而公开文档仅写“两个不同的时序构成两项证据”。保留冻结规则，单独披露相关拒绝；Step 原生 Pi 即使放宽排重仍存在独立的 rate 口径错误。本轮后应澄清文档再开新实验。

控制审计：2104/2104 通过。

[运行清单](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/manifest.json) · [工具协议探针（与正式成绩分开）](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/preflight-probes.json) · [离线状态重载（不等于模型恢复）](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/handoff-restoration.json) · [工作区边界审查](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/scope-review.json) · [UI 源状态校验](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/ui-source-validation.json) · [UI 入口与画面复核限制](/Users/shen/Documents/Code/Cairn/docs/public-rca-ui.zh-CN.md)

## 正式成绩之外的消耗

目录名泄露故障类别的前序校准整轮作废，一个会话自然结束、另一个由宿主终止；没有隐藏评分或答案复用。工具探针中另有两次宿主空环境变量错误，修正后四模型全部通过。

- 接入探针 6 次：上报总 token 161,403。
- 作废校准 2 次：上报总 token 至少 1,832,020。
这些消耗不计入 12 单元成绩，但属于本次实际评测开销。[单独成本记录](/Users/shen/Documents/Code/Cairn/evaluations/public-rca/runs/2026-10-17-model-matrix-hardcase-unbudgeted/auxiliary-costs.json)
