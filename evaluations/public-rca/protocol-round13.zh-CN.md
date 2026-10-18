> 历史记录：本文保留当轮版本、协议、数据和结论，不代表当前 4.9 的接口或性能。当前用法见[文档导航](../../docs/README.zh-CN.md)。

# Round13：阶段契约、Reason 同会话纠错与上下文开销（推理前协议）

本轮按用户最新补充包含三个组合：Pi／`global:deepseek-v4.1-flash`／high、Pi／`cn:glm-5.3`／high、Codex／`gpt-6.1-sol`／xhigh。沿用原三道公开 RCA 开发题，每模型每题三次、原生宿主与同宿主＋新版可选 Scheduler+Cairn 两组，共 54 次。三模型 lane 并行，每模型最多一个活跃原生 CLI。保留 Round12 模型原 index 0／1／2 的题目与 arm 交错顺序。

没有评测墙钟、token、调用数或探索轮数预算；宿主原生限制、产物验收子进程安全超时、调度结构化输出及无进展终止仍保留。每个正式 actor 只运行一次，全部失败与用量保留，不选择性补跑，不按结果修改提示或评分。SIGINT／SIGTERM 传播同一个 AbortSignal，等待当前 CLI 关闭并停止后续 actor，不自动发起新阶段或其他模型调用。

基线为 Round12 的完整主 54：恢复批 DeepSeek18、恢复批 GLM18、原始 Sol18。基线 GLM18 仍服务失败，不能据它作能力排名；原始 GLM 混合时窗 cohort 可单独附列，不合并充当成功基线。新旧实际服务窗口不同，不将跨轮差异当严格因果消融。

原生宿主的 common prompt、TASK.md、原始证据、产物合同、完整模型 ID、effort、CLI 原生工具及独立验收器／隐藏评分器与 Round12 保持一致。原生／默认驱动 argv 与 usage 逻辑不变，驱动仅新增 Round13 归档命名和 repair 专用策略：Pi 同时添加 `--no-tools --exclude-tools '*'`；Codex 不猜系统禁工具参数，依靠明确提示与公开动作零次审计（file_change 等也计入）。Pi 的 prompt-only 路径约束保持一致，不能用更严格的新 native prompt 改变控制组。

新版 Cairn 由可信宿主预提交唯一 general／curated 任务，自动执行 Bootstrap／Reason／Explore／Conclude。模型阶段仅使用原生工具，不安装五工具接口。阶段输出契约、Reason 原协调会话复用、参数纠错与增量上下文由框架实现，评测不伪造新会话冒充续接。HostRequest 原文、公开最终回复、真实原生 session、阶段上下文模式和 prompt UTF-8 字节均保存。

分别统计普通 Reason coordinator 续接、参数纠错、故障 Conclude 的请求／身份匹配与实际正常终止／任务完成／正确交付，不能把它们都称为故障恢复。每个 phase 和失败 phase 的耗时、tokens 进入 actor 总计。Pi 流式 usage 是新产生消息用量，最终会话账本按唯一 session 汇总；Codex resume 账本按终值减起始累计量计算每段增量，最终原生累计账本再独立对账。正常usage路径沿用Round12；若累计差值为负或反常，保留raw ledger／baseline／诊断，把该段usage标未知或已证实下界，不抛弃actor及后续队列，也不改变原生／任务终态。缓存输入不重复累加，未知用量不猜0，金额没有实际账单则未知。

收到实现最终检查通过通知后，才创建不可覆盖的新正式 root `runs/2026-10-18-scheduler-contract-round13-final/`，冻结 src／dist／skills、原题输入、提示、驱动、协议、验收器、评分器与顺序。冻结后通过同一 runScheduled pipeline 的无模型脚本化 native fixture 验证当前接入、会话账本与任务验收。fixture 明确 synthetic，不计入模型准确率／耗时／tokens；本轮不调用付费模型探针。旧三个探针仅作历史记录，不称为 Round13 当前验证，也不重新计费。

全 54 次结束，封存所有公开 REPORT，存在的报告逐份分段完整阅读并显式确认、缺失的报告逐项确认后，才执行隐藏标签评分。隐藏答案、评分器与凭据不进入 actor 上下文，不读取模型私有思维。HTTP 故障解释只识别状态前缀或结构化 status，不以 ray ID／HTML 中任意 401／403 数字子串判为认证错误；原始错误原文保留。

主表分别给出精确对象／层级／资源类别正确率、workflow 完成率、错误完成数／全部与错误完成数／已完成、有效交付和验证合格且正确但 workflow 未完成的产物。另列文件合同、独立数值复算、Cairn 当前验收状态。耗时和 tokens 同时给出全部尝试与完成样本的分布、每题三次波动、阶段和纠错成本、缓存／非缓存／输出拆分。报告文本里的时序、单位、缺测与因果推断问题独立记录，标签正确不能代替报告质量。

Pi 无 OS 沙箱，独立 cwd／tmp／config 和指令不能证明完整隔离。公开工具、写入脚本和文件变化须作范围审计：内部 cd、Path.parent 不能全部当越界，共享 `/tmp` 的真实写读必须保留路径／actor／时间并检查跨 actor 重叠。核对原题输入、冻结实现、全局配置未变，以及私有凭据目录 finally 删除。不追溯改变评分定义掩盖范围偏差。

这三题已经反复用于开发，三次重复不等于三个新事件，也不能建立长期可靠性或任意任务成功率。通用性来自领域无关接口、没有案例专用逻辑的实现与独立非 RCA 测试；本轮比较整个宿主＋框架＋阶段协议方案，不把改善全部归功于单个改动。
