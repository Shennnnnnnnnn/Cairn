> 历史记录：本文保留当轮版本、协议、数据和结论，不代表当前 4.9 的接口或性能。当前用法见[文档导航](../../docs/README.zh-CN.md)。

# 第八轮同题重复对照：Codex Sol 极高与优化后的 Cairn

同三题开发集，GPT-6.1-Sol / xhigh，codex-cli 0.163.0-alpha.10.2。原生/新版各9个全新会话，每题每组3次，最多3并发，无评测预算。正式墙钟 46.54 分钟；18次全部结束、完整公开报告审阅封存后，才统一隐藏标签评分。

## 结果

| 配置 | 正确：对象＋族＋层级 | 完成 | 契约＋复算 | 有效交付 | 错误完成／全部 | 无效完成／全部 | 记录tokens | 每次有效交付tokens |
| --- | --- | --- | --- | --- | --- | --- | ---: | ---: |
| 上一轮原生（封存参考） | 9/9 | 9/9 | 8/9 | 8/9 | 0/9 | 1/9 | 5,547,408 | 693,426 |
| 上一轮Cairn（修改前） | 8/9 | 9/9 | 9/9 | 8/9 | 1/9 | 1/9 | 8,799,979 | 1,099,997 |
| 本轮原生Codex | 9/9 | 9/9 | 8/9 | 8/9 | 0/9 | 1/9 | 5,727,424 | 715,928 |
| 本轮新版Cairn | 8/9 | 9/9 | 9/9 | 8/9 | 1/9 | 1/9 | 8,071,199 | 1,008,900 |

| 配置 | 对象命中 | 资源族命中 | 层级命中 |
| --- | --- | --- | --- |
| 旧Cairn | 8/9 | 9/9 | 8/9 |
| 本轮原生 | 9/9 | 9/9 | 9/9 |
| 本轮新版Cairn | 9/9 | 8/9 | 9/9 |

本轮新版相对本轮原生：总记录tokens +40.9%，CLI时间求和 +9.0%，每次有效交付tokens +40.9%。相对封存旧Cairn：正确 8→8，有效交付 8→8，错误完成 1→1；总tokens -8.3%。这些是三题开发集的随机会话观测，不能把前后差异全部归因于某项修改。

完成与正确性分开计量。原生完成要求自然结束、三文件非空和有效候选；Cairn另外要求真实owner唯一任务completed、报告有效、宿主验收proof当前。有效交付再要求格式/复算通过、标签联合命中和输入完整。错误完成=已完成但标签错；无效完成还包括格式或复算不通过。错误／已完成分母为本轮各组实际完成数，不以减少完成掩盖错误。

本轮错误／已完成：原生 0/9，Cairn 1/9。格式通过：原生 8/9，Cairn 9/9；算术通过：原生 9/9，Cairn 9/9。

## 成本与波动

| 配置 | 时间秒：中位 [范围]；CV | tokens：中位 [范围]；CV | 非缓存输入 | 缓存输入 | 输出 | 每次有效交付：非缓存输入＋输出 |
| --- | --- | --- | ---: | ---: | ---: | ---: |
| 旧Cairn | 462 [411–549]；CV 8.8% | 953,106 [733,429–1,221,698]；CV 17.0% | 856,689 | 7,730,560 | 212,730 | 133,677 |
| 本轮原生 | 429 [345–493]；CV 11.1% | 637,146 [471,982–768,808]；CV 15.6% | 662,092 | 4,885,248 | 180,084 | 105,272 |
| 本轮新版Cairn | 442 [390–546]；CV 13.3% | 915,052 [677,320–1,274,564]；CV 22.4% | 816,771 | 7,043,840 | 210,588 | 128,420 |

记录tokens=input_tokens+output_tokens；输入已含缓存，输出已含推理，不重复累加。全部尝试计入分子，未知usage保留未知/下界。它是流量指标，不是订阅账单或美元成本。并行单次时间求和不等于用户等待墙钟。

| 题目 | 配置 | 正确／3 | 有效交付／3 | 时间秒CV | tokens CV | tokens最大／最小 | 波动标记 |
| --- | --- | --- | --- | ---: | ---: | ---: | --- |
| new-01 | 旧Cairn | 2/3 | 2/3 | 7.5% | 23.5% | 1.612 | 否 |
| new-01 | 本轮原生 | 3/3 | 2/3 | 15.1% | 14.8% | 1.316 | 否 |
| new-01 | 本轮新版Cairn | 2/3 | 2/3 | 10.4% | 16.4% | 1.355 | 否 |
| new-02 | 旧Cairn | 3/3 | 3/3 | 2.8% | 6.6% | 1.141 | 否 |
| new-02 | 本轮原生 | 3/3 | 3/3 | 6.2% | 23.7% | 1.629 | 否 |
| new-02 | 本轮新版Cairn | 3/3 | 3/3 | 13.1% | 21.7% | 1.559 | 否 |
| new-03 | 旧Cairn | 3/3 | 3/3 | 14.4% | 17.9% | 1.429 | 否 |
| new-03 | 本轮原生 | 3/3 | 3/3 | 7.0% | 13.1% | 1.291 | 否 |
| new-03 | 本轮新版Cairn | 3/3 | 3/3 | 2.6% | 6.1% | 1.127 | 否 |

同(case,repeat)匹配有效交付：{'codex': 1, 'cairn': 1, 'tie': 7}。重复会话没有相同随机种子，不是确定性成对干预。CV>0.25或max/min>2只是本样本描述标记；即使未触发，也不能认定长期稳定。只有3个独立事件，同题3次相关；原难度代理不等同独立验证的高难度。

## 三处问题是否改善

| 公开MCP指标 | 旧Cairn | 新Cairn |
| --- | ---: | ---: |
| checkpoint调用 | 49 | 39 |
| checkpoint失败 | 9 | 3 |
| 字符串形式finding元素 | 14 | 42 |
| 空可选next | 4 | 0 |
| 被兼容且成功的调用 | 0 | 8 |
| MCP公开文本字节 | 259,256 | 153,797 |
| checkpoint公开文本字节 | 166,402 | 91,277 |

invalid_model_input：旧 9→新 3；全部标准工具错误：旧 11→新 6，本轮原生 6。公开响应字节不是tokens：真实调用次数、请求内容及上下文前缀复用都可能变化。

本轮有 8 次字符串finding兼容调用直接成功，剩余 3 次拒绝均为artifacts对象数组被编码为字符串（一次还包含字符串handoff）。此兼容尚未覆盖，未宣称参数重试清零。

参数层只解码单层合法finding JSON对象、空白可选next按省略处理，随后仍严格校验；不会把文本补成事实、添加coverage或刷新旧文件证据。收据精简仅作用于模型确认，SDK和显式恢复保留完整内容。范围审视要求比较原目标、结论主体/范围、最强替代解释和区别性证据；没有对象/资源/层级优先规则。

固定通用请求的独立字节测量：

| 项目 | 修改前 | 修改后 | 变化 |
| --- | ---: | ---: | ---: |
| 工具catalog | 12,918 | 12,352 | -4.4% |
| skill | 8,691 | 6,640 | -23.6% |
| 首次6事实收据 | 3,302 | 2,119 | -35.8% |
| 单项修订收据 | 3,355 | 1,347 | -59.9% |
| 相同重试收据 | 3,348 | 1,191 | -64.4% |
| 长探索提醒 | 1,932 | 449 | -76.8% |
| 显式恢复 | 8,689 | 8,721 | +0.4% |

完整恢复仍保留6事实、refuted排除项、原问题和下一步。恢复文字略增加，因为包含新的通用范围审视。未用删减恢复事实换取响应变小。

## 逐次结果

| 会话 | 联合正确 | 完成 | 有效交付 | 契约 | 算术 | tokens | 秒 |
| --- | --- | --- | --- | --- | --- | ---: | ---: |
| [new-01-r1-codex](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-01-r1-codex/initial.REPORT.md) | True | True | True | True | True | 721,371 | 464.4 |
| [new-01-r1-cairn](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-01-r1-cairn/initial.REPORT.md) | False | True | False | True | True | 940,679 | 532.6 |
| [new-02-r1-cairn](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-02-r1-cairn/initial.REPORT.md) | True | True | True | True | True | 684,444 | 422.9 |
| [new-02-r1-codex](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-02-r1-codex/initial.REPORT.md) | True | True | True | True | True | 672,799 | 406.9 |
| [new-03-r1-codex](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-03-r1-codex/initial.REPORT.md) | True | True | True | True | True | 637,146 | 455.1 |
| [new-03-r1-cairn](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-03-r1-cairn/initial.REPORT.md) | True | True | True | True | True | 677,320 | 390.2 |
| [new-02-r2-cairn](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-02-r2-cairn/initial.REPORT.md) | True | True | True | True | True | 1,066,974 | 546.1 |
| [new-02-r2-codex](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-02-r2-codex/initial.REPORT.md) | True | True | True | True | True | 768,808 | 365.6 |
| [new-03-r2-codex](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-03-r2-codex/initial.REPORT.md) | True | True | True | True | True | 746,237 | 428.6 |
| [new-03-r2-cairn](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-03-r2-cairn/initial.REPORT.md) | True | True | True | True | True | 737,793 | 411.2 |
| [new-01-r2-cairn](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-01-r2-cairn/initial.REPORT.md) | True | True | True | True | True | 1,274,564 | 532.1 |
| [new-01-r2-codex](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-01-r2-codex/initial.REPORT.md) | True | True | False | False | True | 582,978 | 344.6 |
| [new-03-r3-codex](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-03-r3-codex/initial.REPORT.md) | True | True | True | True | True | 577,924 | 492.5 |
| [new-03-r3-cairn](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-03-r3-cairn/initial.REPORT.md) | True | True | True | True | True | 763,197 | 403.0 |
| [new-01-r3-cairn](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-01-r3-cairn/initial.REPORT.md) | True | True | True | True | True | 1,011,176 | 441.9 |
| [new-01-r3-codex](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-01-r3-codex/initial.REPORT.md) | True | True | True | True | True | 548,179 | 436.3 |
| [new-02-r3-codex](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-02-r3-codex/initial.REPORT.md) | True | True | True | True | True | 471,982 | 408.8 |
| [new-02-r3-cairn](runs/2026-10-17-codex-sol-xhigh-round8-repeated/new-02-r3-cairn/initial.REPORT.md) | True | True | True | True | True | 915,052 | 465.7 |

所有模型公开报告的定性审阅记录在运行目录qualitative-audit.json，先于隐藏评分封存。下列问题来自正式全部尝试，未选择性重跑：

- **new-01-r1-cairn**：联合正确=False，完成=True，格式=True，算术=True；top1={"location": "shippingservice-grpc", "level": "service", "fault_family": "memory", "confidence": 0.84}。
- **new-01-r2-codex**：联合正确=True，完成=True，格式=False，算术=True；top1={"location": "shippingservice-grpc", "level": "service", "fault_family": "disk_io", "confidence": 0.82}。
  格式诊断：evidence的before/after实际类型为{'before': ['dict'], 'after': ['dict']}，v2契约要求非空描述字符串；正文与复算正确不能代替序列化契约。

公开报告叙述核对：

- new-01-r1-cairn：重要问题=["主要比较把memory绑定服务、disk_io绑定节点，未充分讨论同一服务异常读负载导致页缓存/内存贴限的替代链。四副本各自贴限且新增failcnt能说明局部压力，但也可能是读负载后果，因而不足以区分memory起因与同服务disk_io起因；这是候选比较覆盖缺口，报告本身也保留因果未证实。"]；次要问题=[]。
- new-03-r1-cairn：重要问题=[]；次要问题=["开头称全数据覆盖40个容器对象；独立读取55个container CSV后cmdb_id并集为42，memory_usage确为40，未区分全量对象与内存/CPU覆盖范围。此范围说明不影响主要内存证据。"]。
- new-01-r2-cairn：重要问题=[]；次要问题=["数据范围称全部40个容器对象；本案例所有container文件对象并集为42，usage等资源文件为40，遗漏两个仅网络对象的范围说明。其后36个资源对象对照仍与主计算口径一致。"]。
- new-03-r3-cairn：重要问题=[]；次要问题=["正文称全部其余41个pod都有usage均值对照；本案例全量对象42，但memory_usage仅覆盖40，因此可比较的其他usage对象为39。不能把两个只有网络数据的对象算入已验证资源平稳对照；不影响目标主证据。"]。

## 判断

本轮改善的是协议摩擦与重复上下文：对象和层级从旧版8/9提高到9/9，但资源族从9/9变成8/9，联合正确、完成、错误完成和有效交付均未优于旧Cairn。服务内存压力与同服务I/O起因的比较仍会漏项；层级自审不能替代机制判断。

Cairn记录tokens相对旧版 -8.3%，非缓存输入＋输出 -3.9%，CLI耗时求和 -1.1%。相对本轮原生，非缓存输入＋输出每有效交付仍 +22.0%；没有实际账单，不能把记录tokens下降直接当作费用下降。

三题各三次没有证明长期稳定或正确率提升。保留本轮传输与收据优化有依据；若目标是更高排障正确率，仍需让对象范围与故障机制分别比较，并覆盖遗漏的替代解释。artifacts/handoffs等对象数组的通用规范化尚是明确剩余项。

## 恢复、验收与边界

未注入预算、超时或强制中断，也没有实际恢复尝试，恢复效果为N/A。267/267测试与真实接入探针只证明被覆盖路径；探针消耗 70,877 tokens，另列。

冻结审计 536/536；公开范围扫描 18个会话、297项标准工具记录、45项文件事件。确认范围违规 0，临时目录惯例偏差 3，未能证实的临时文件可能性 2。静态记录不能证明所有脚本内部或操作系统级隔离；完整决定保留在public-scope.review.json。凭据副本已清理，全局配置哈希未变。没有新UI验证。

输入和原生提示、v2契约、独立复算器、驱动、标签政策及调度与上一轮逐项字节一致；仅Cairn冻结版本变化。公开同日同testbed、3个事件和先前开发观察限制外推，也不能排除训练污染。宿主契约/数值验收不是根因真值；模型/effort来自客户端元数据，不是独立服务端证明。

## 复核入口

- [原始矩阵、冻结实现与summary](runs/2026-10-17-codex-sol-xhigh-round8-repeated/summary.json)
- [公开报告预评分审阅](runs/2026-10-17-codex-sol-xhigh-round8-repeated/qualitative-audit.json)
- [公开MCP与固定请求测量](runs/2026-10-17-codex-sol-xhigh-round8-repeated/public-metadata-supplement.json)
- [修改前后可比性核对](runs/2026-10-17-codex-sol-xhigh-round8-repeated/implementation-review.json)
- [预登记](protocol-round8.zh-CN.md)
- [验收清单](acceptance-round8.zh-CN.md)
- [实现说明](../../docs/optimization-round8.zh-CN.md)
- [上一轮封存报告](comparison-codex-repeated.zh-CN.md)
