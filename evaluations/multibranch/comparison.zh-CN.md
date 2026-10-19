# 新难题单会话／多会话实测（2026-10-19）

本批没有显示多会话的净收益。**单会话完成且联合标签命中5/9，多会话4/9；平均每题耗时8.07→12.86分钟，已报告token至少增加29.5%。** 多会话确有独立Explore参与，未完成主要由两次上游服务失败和一次收尾挂起构成，不能全部归为推理能力下降。

两组都使用当前Cairn与同一Pi／DeepSeek配置。生产框架未修改；新增内容仅在独立评测目录，没有创建Multica任务，也没有向比赛工作目录写入测试材料。

## 主结果及口径

每组9次，三题各三次。正确率为**首选服务名＋故障大类联合命中**；另列服务Top1。完成要求原生正常结束、唯一Cairn任务completed、三文件与独立复算均通过。错误完成=完成但联合标签未命中，分母全部9次。验收通过只表示结构、输入完整性和数值可复算。

| 指标 | 单会话 | 受控多会话 |
|---|---:|---:|
| 服务＋故障大类联合正确率 | 5/9（55.6%） | 4/9（44.4%） |
| 服务Top1（无答案计未命中） | 9/9（100.0%） | 7/9（77.8%） |
| 完成率 | 9/9（100.0%） | 6/9（66.7%） |
| 错误完成率 | 4/9（44.4%） | 2/9（22.2%） |
| 完成且联合正确 | 5/9（55.6%） | 4/9（44.4%） |
| 产物／数值验收通过 | 9/9（100.0%） | 7/9（77.8%） |
| 平均每题墙钟 | 8.07分钟 | 12.86分钟 |
| 墙钟中位数 | 6.96分钟 | 9.51分钟 |
| 平均每题token，含缓存 | 564.5万 | ≥731.2万 |
| 9次token总和 | 50,802,501 | ≥65,811,330 |

多会话平均耗时增加59.4%。只看自然完成样本，单会话9次均值8.07分钟，多会话6次均值13.40分钟；不同样本构成下也没有观察到整体提速。

**错误完成率降低不能单独算作准确性改善**：多会话同时增加3条未完成。两组16份可用答案的服务名都命中；第一题均2/3联合命中，第二题所有可用答案都命中，第三题所有可用答案都选socket而未命中预定application标签。没有观察到一致的机制分类增益。上游失败发生时窗不对称，主表不是纯推理能力的因果估计。

多会话3个样本有失败请求，部分API用量未知，token为下界。CV仅描述已记录用量；金额没有真实账单，不能把配置中的0价格当作免费。

## 数据、模式与实验边界

来源：[RCAEval作者数据集](https://huggingface.co/datasets/phamquiluan/RCAEval)，固定revision afeacb11bcc94dadfd1c8f483ee4377b2b8b614e；[官方实现](https://github.com/phamquiluan/RCAEval)、[论文](https://arxiv.org/abs/2412.17015)。

| 匿名题 | 原始样本 | 指标数 | 日志行 | span数 | 预定标签映射 |
|---|---|---:|---:|---:|---|
| mb-01 | re2tt_ts-order-service_loss_1 | 373 | 270,219 | 1,293,243 | ts-order-service / network |
| mb-02 | re3tt_ts-route-service_f3_1 | 315 | 75,260 | 189,488 | ts-route-service / application |
| mb-03 | re3ob_adservice_f5_1 | 69 | 69,134 | 162,900 | adservice / application |

RE3代码注入统一映射application，是事前固定的粗类规则。材料没有故障版本源码，不能评价是否定位具体缺失代码。第三题直接日志为端口绑定失败，socket与application存在“可见直接故障／初始触发”的粒度差异；保持原分数，同时保留正文意见，不能将所有类型不匹配都称为编造。

这些此前未在本项目运行的样本具有多源、跨服务、大数据量和竞争解释，确有可拆分调查工作；**本批不能证明必须多会话才能解决它们**，单会话服务定位已到9/9。公开数据也不保证训练未见。这是离线遥测诊断，没有部署原系统、在线注入故障或修复业务。

- Cairn 4.9.0，commit d75ba68218db8d0bb2898a46d44746a2df604735；Pi 1.3.0。
- 原生日志均报告sub2api-copy/global:deepseek-v4.1-flash、high。注册上下文1,000,000、单回复128,000保持原配置；未设置任务时间、token、调用数或阶段预算。
- 单会话：Pi＋Cairn六工具，一个原生会话内调查、checkpoint与finish。
- 多会话：真实Scheduler＋原生Pi执行器，Reason-first、fresh-full，初始指标／日志链路两个通用方向，Explore最多2并行。首轮真实Reason禁用工具仅规划，后续Reason正常复核。
- 两条actor lane按组并行，每组至多一题；沿用样本已结束后的补跑阶段只剩多会话lane，仍保留内部Explore并发。不是一次启动18个不限并发进程。
- 两组同输入、同调查要求、同4–8项checks与替代解释要求、同独立复算器。完整保留全部服务和行，逐单元格核对Parquet转换，未按故障对象筛选、补零或插值。

这是两套实际集成路径的比较：提示、工具、上下文和完成控制也不同，**不是只改会话数的纯消融**。初始方向受控预置，不能据此声称默认auto会自主选择相同分支，也未测复用增量图模式。

## 独立Explore实际参与

| 审计项 | 结果 |
|---|---:|
| 单会话每条恰有一个原生会话 | 9/9 |
| 多会话至少两个不同于Reason的真实工具型Explore | 9/9 |
| Explore实际执行区间有并发重叠 | 9/9 |
| 至少两路有依据提案保存、merged且有后续Reason | 7/9 |
| 主Reason可观察到读取分支材料 | 7/9 |
| 两路均有owner事实升格或from显式来源链 | 0/9 |
| 原生会话总数 | 54（单9＋多45） |

共20次Explore：18条初始调查＋2条替代调查。多会话49次阶段调用中，2次Conclude和2次格式修复复用原生会话，不算新助手。actor之间没有共享session ID。

| 多会话样本 | 分支工具数／保存事实数 | 并发重叠 | 主流程 |
|---|---|---:|---|
| mb-01-r1-multi | metric-evidence：48/9；trace-log-evidence：78/12 | 386.4s | 完成 |
| mb-02-r1-multi | metric-evidence：40/11；trace-log-evidence：36/8 | 327.8s | 完成 |
| mb-03-r1-multi | metric-evidence：41/0；trace-log-evidence：35/8 | 260.8s | 失败 |
| mb-02-r2-multi | metric-evidence：36/11；trace-log-evidence：48/10 | 289.5s | 完成 |
| mb-03-r2-multi | metric-evidence：32/11；trace-log-evidence：41/10 | 233.0s | 完成 |
| mb-01-r2-multi | metric-evidence：47/0；trace-log-evidence：32/6；metric-evidence-replacement：38/8 | 316.9s | 挂起 |
| mb-03-r3-multi | metric-evidence：43/0；trace-log-evidence：28/8；metric-evidence-replacement：19/7 | 157.7s | 完成 |
| mb-01-r3-multi | metric-evidence：40/11；trace-log-evidence：78/9 | 312.5s | 完成 |
| mb-02-r3-multi | metric-evidence：52/10；trace-log-evidence：65/0 | 387.7s | 失败 |

merged表示调度器接收提案和合并分支状态，**不等于事实已独立确认正确**。可汇总的7条确实看到了黑板提案，并通过cat/read/Python读取统计或脚本，有实质材料复用；强来源链仍未达到两路标准，只有2条分支各出现至少一条显式事实利用。不能说没有Explore，也不能冒充完整可追踪审查。会话ID和逐条证据见[主审计](runs/2026-10-19-deepseek-multibranch-v4/analysis.json)。

## 三次重复的波动

CV为样本标准差／均值，保留失败、挂起和长尾。

| 题目／组 | 联合正确 | 完成 | 错误完成 | 平均分钟 | 墙钟CV | 平均token万 | token CV |
|---|---:|---:|---:|---:|---:|---:|---:|
| mb-01／单 | 2/3 | 3/3 | 1/3 | 12.47 | 27.5% | 827.5 | 34.0% |
| mb-01／多 | 2/3 | 2/3 | 0/3 | 20.66 | 0.7% | 1,155.7 | 24.7% |
| mb-02／单 | 3/3 | 3/3 | 0/3 | 6.55 | 17.9% | 553.8 | 39.7% |
| mb-02／多 | 2/3 | 2/3 | 0/3 | 8.51 | 10.2% | ≥697.6 | 22.2% |
| mb-03／单 | 0/3 | 3/3 | 3/3 | 5.19 | 12.9% | 312.2 | 12.9% |
| mb-03／多 | 0/3 | 2/3 | 2/3 | 9.42 | 39.1% | ≥340.4 | 34.9% |

第一题多会话约20.5–20.8分钟，时间CV更低，但基线更高且一次挂起，token仍有24.7% CV。任务budget为空，源码没有20分钟执行截止。第二题记录用量CV下降，但一次服务失败使部分用量未知；第三题两种波动均变大。三次重复不能保证长期稳定，跨题总CV也不能当重复稳定性。

单会话第一题第二次有真实长尾：一条以bash调用结束的模型消息报告128,000输出token、stopReason=length、最终参数为空，随后同一会话自然恢复。仅采样宿主CPU堆栈，未杀进程、未读私有thinking；该条约1121万token全部保留，不能全部归为Cairn图开销。

| 样本 | 预测服务／大类 | 主流程 | 联合命中 | 分钟 | token万 | 公开报告 |
|---|---|---|---|---:|---:|---|
| mb-01-r1-single | ts-order-service / disk_io | 完成 | 否 | 10.11 | 559.4 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-01-r1-single/initial.REPORT.md) |
| mb-01-r1-multi | ts-order-service / network | 完成 | 是 | 20.72 | 1,192.2 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-01-r1-multi/initial.REPORT.md) |
| mb-02-r1-single | ts-route-service / application | 完成 | 是 | 6.96 | 606.9 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-02-r1-single/initial.REPORT.md) |
| mb-02-r1-multi | ts-route-service / application | 完成 | 是 | 8.00 | 520.6 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-02-r1-multi/initial.REPORT.md) |
| mb-03-r1-single | adservice / socket | 完成 | 否 | 5.06 | 302.6 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-03-r1-single/initial.REPORT.md) |
| mb-03-r1-multi | 无最终答案 | 失败 | 否 | 6.87 | ≥226.3 | 缺失 |
| mb-02-r2-multi | ts-route-service / application | 完成 | 是 | 9.51 | ≥806.0 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-02-r2-multi/initial.REPORT.md) |
| mb-02-r2-single | ts-route-service / application | 完成 | 是 | 7.46 | 742.3 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-02-r2-single/initial.REPORT.md) |
| mb-03-r2-multi | adservice / socket | 完成 | 否 | 7.75 | 331.6 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-03-r2-multi/initial.REPORT.md) |
| mb-03-r2-single | adservice / socket | 完成 | 否 | 5.91 | 356.5 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-03-r2-single/initial.REPORT.md) |
| mb-01-r2-multi | ts-order-service / disk_io | 挂起 | 否 | 20.49 | 853.8 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-01-r2-multi/initial.REPORT.md) |
| mb-01-r2-single | ts-order-service / network | 完成 | 是 | 16.40 | 1,121.1 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-01-r2-single/initial.REPORT.md) |
| mb-03-r3-single | adservice / socket | 完成 | 否 | 4.59 | 277.5 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-03-r3-single/initial.REPORT.md) |
| mb-03-r3-multi | adservice / socket | 完成 | 否 | 13.65 | 463.2 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-03-r3-multi/initial.REPORT.md) |
| mb-01-r3-single | ts-order-service / network | 完成 | 是 | 10.90 | 802.0 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-01-r3-single/initial.REPORT.md) |
| mb-01-r3-multi | ts-order-service / network | 完成 | 是 | 20.77 | 1,421.1 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-01-r3-multi/initial.REPORT.md) |
| mb-02-r3-single | ts-route-service / application | 完成 | 是 | 5.23 | 312.1 | [REPORT](runs/2026-10-19-deepseek-multibranch-v4/mb-02-r3-single/initial.REPORT.md) |
| mb-02-r3-multi | 无最终答案 | 失败 | 否 | 8.01 | ≥766.4 | 缺失 |

## 未完成和开销的直接原因

| 样本 | 终止原因 | 已完成工作与归因 |
|---|---|---|
| mb-03-r1-multi | 指标Explore 502，同会话Conclude及新Reason连续503 | 两个Explore执行工具，日志链路正常返回，无最终三文件；上游可用性失败 |
| mb-02-r3-multi | 日志链路Explore 502，同会话Conclude及新Reason连续503 | 指标Explore正常返回，另一分支已65次工具，无最终三文件；同类上游失败 |
| mb-01-r2-multi | 最后主动suspend，自称还需外部验收，未再次请求complete | 替代分支已merged，三文件事后验收通过；混淆了请求验收与已验收完成 |

挂起样本的保存状态经修正后控制谓词[零模型重放](runs/2026-10-19-deepseek-multibranch-v4/mb-01-r2-multi/final-treatment-control-replay.json)已通过两路条件；不是先前错误分支名门槛再次阻挡，也不是预算停止。

Reason参数形状修复可用：两条第一题multi把covers给成scalar，宿主复用原session约8–10秒纠正，未重查。Explore语义错误却未进入同一修复链：正式样本两次把metrics或evidence/metrics.csv填进from，提交时报Unknown dependency，整批提案未入库，触发替代Explore。from应引用已保存图事实，文件应放references；worker紧凑契约解释弱于owner。筹备样本另暴露同批局部finding键加branch命名空间后，from未同步映射。都是通用接口问题，不需要案例特判。

完整性护栏也带来回合：第一题第三次引用最终checks/REPORT作为事实依据，修改交付物后指纹过期，多个supported事实和c1覆盖失效，需要再开Reason审核保存。护栏正确阻止陈旧背书；更合理的依赖方向是稳定证据→事实→可编辑报告，避免报告变化反过来使科学结论整批失效。

三条第一题multi还被0/0日志检查拒绝并修改。**要求真实匹配观测是本评测预定契约**，不能把相应开销全算为框架固有缺陷；带覆盖证明的0错误本也可作负证据。原规则未在看到成绩后放宽。

## 上下文、因果和单位

所有原生会话未记录compaction，单会话最高单次输入243,611，多会话237,496，低于注册上限，未观察到context-limit错误。不能据此保证注意力从不遗漏证据，但没有证据把三条未完成直接归为上下文溢出／丢失。

第一题两组都可能锚定短时diskio大幅突发；较好报告使用持续尾部、起始先后和跨调用边等待反驳。多会话也会让两条模态调查会合到同一错误解释，独立会话不自动产生独立假设。第二题报告较好地区分启动CPU／内存峰与停机原因。第三题多会话后两份更明确保留socket直接失败与application初始触发的竞争解释，但联合分数未提高。

16套checks数值均可复算，缺测大多保持未知，span通常未冒充独立请求。单位仍不可靠：部分正文先使用ms／MB／字节／CPU核数，末尾又声明元数据未定义。算术验收不证明全部时序、单位和因果正确。[逐份意见与哈希](runs/2026-10-19-deepseek-multibranch-v4/public-report-read-notes.json)保留具体问题。

## Token账本

| API已记录组成 | 单会话9次 | 多会话9次 |
|---|---:|---:|
| 输入，含缓存 | 50,215,937 | ≥64,582,814 |
| 其中缓存输入 | 44,872,832 | ≥54,606,208 |
| 输出，按API报告，不读私有thinking | 586,564 | ≥1,228,516 |
| 非缓存输入＋输出 | 5,929,669 | ≥11,205,122 |
| 合计 | 50,802,501 | ≥65,811,330 |

18条均与session/message ID去重后的原生账本一致；缓存已经包含在输入中。非缓存输入＋输出至少增加89.0%，金额取决于代理计费，没有账单不能按总token直接换价格。

## 编排修订和额外成本

筹备阶段发生评测错误：v1把字符串消息按数组解析而启动失败；v2预置委派没有保证实际Explore；v3门槛绑定初始分支名，合法替代分支无法完成。均在隐藏评分前纠正，未作为产品正常失败计入主表。

v4无条件沿用全部9条自然结束single和1条未收到错误门槛反馈、处理等价的multi，原生会话、数据库、用量、时间均保留；只补齐其余8条multi，没有按成绩挑选。实现、输入和模型配置哈希一致，沿用时窗不同且后期两次上游故障是明显限制。

额外6条受影响／中断记录至少消耗**37,708,933 token**，另有v1两次启动用量未知，3条额外记录也只是下界。[附录账本](runs/2026-10-19-deepseek-multibranch-v4/additional-experiment-costs.json)按规范路径去重，不重复计算沿用actor。正式18条至少116,613,831 token；整次活动已记录至少154,322,764 token，另有未知请求用量，不包含本次分析对话自身消耗。

## 工作区、清理与有效性

108份actor输入哈希一致，冻结与当前生产实现一致，Pi全局models/settings未改。58份临时凭据副本与控制器配置已清理，未归档凭据。

公开工具审计的199个flag多数是branch目录回工作区的相对路径、trace parent字段、旧run显式框架skill或日志里的/tmp/javaagent文字。未观察到隐藏标签、其他案例、凭据或外部证据源访问；这是工具轨迹审阅，**不声称具备OS沙箱**。

4个multi样本确有全局/tmp输出，违反临时文件只在cwd/.tmp的约定：mb-01-r1、mb-01-r3、mb-03-r1、mb-03-r3，共5个确切路径。一份模型已删除，另4份经出生时间、执行窗口、命令、内容与哈希核对后归档到actor/audit-scratch并删除，没有清理其他/tmp文件。偏差保留，不据此换样本。

主表按预定框架状态和产物验收计算；后验补充的严格工作区合规交付为单9/9、多3/9，其中正确合规交付为单5/9、多2/9，单列不与标签评分混用。要求物理隔离时应复用宿主沙箱／容器，不能只靠TMPDIR和提示词。

比赛目录只读观察：tasks/events/sessions与handoffs/deliveries均0，用户已有2026-pk.md等文件未动。[完整性收据](runs/2026-10-19-deepseek-multibranch-v4/final-integrity.json)、[边界解释](runs/2026-10-19-deepseek-multibranch-v4/scope-review.json)、[临时文件清理](runs/2026-10-19-deepseek-multibranch-v4/scratch-cleanup.json)保留证据。

## 可据此考虑的通用优化

1. 收窄worker事实契约；from语义和局部命名空间错误也回原session修复，保留已取证文件，避免完整重派，不按案例字符串特判。
2. 明确complete表示请求宿主验收；避免把待验收当外部阻塞。事实引用稳定原始证据／测量，最终报告独立作为交付物。
3. owner低开销显式审核和连来源链，分支测试竞争解释，避免把同模型模态共识当因果证明。复用增量上下文可另测，本轮未证明其收益。
4. 可重试5xx由宿主退避和续接；仍不可用时保存文件与恢复点后报告基础设施阻塞，不冒充任务预算。

以上是轨迹提出的方向，本次未修改或宣称优化生产框架。本批支持保留单会话默认，按明确独立调查价值启用多会话，先修提交语义与收尾可靠性。

## 复核入口

- [预定规则与修订](protocol.zh-CN.md)
- [主评分／原生账本／分支审计](runs/2026-10-19-deepseek-multibranch-v4/analysis.json)
- [补充统计](runs/2026-10-19-deepseek-multibranch-v4/supplemental-summary.json)
- [公开元数据和阶段诊断](runs/2026-10-19-deepseek-multibranch-v4/observable-diagnostics.json)
- [报告阅读封存](runs/2026-10-19-deepseek-multibranch-v4/report-read-seal.json)：18条结束、48份公开文件读完后才统一载入标签；2条无产物单列。
- [零模型接入夹具](runs/2026-10-19-deepseek-multibranch-v4/integration-fixture.json)：只证明接线，不计模型成绩或用量。
