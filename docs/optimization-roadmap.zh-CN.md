> 历史记录：本文保留当轮版本、协议、数据和结论，不代表当前 4.9 的接口或性能。当前用法见[文档导航](README.zh-CN.md)。

# Cairn 架构演进对比与优化路线图

> 本文前四节保留优化前的差距分析；第五节记录 2026-10-16 的实际实现与边界。原版行为已对照本地 `Cairn-main` 源码复核。

本文档对比原版 **[oritera/Cairn](https://kitploit.com/en/tools/github/oritera/cairn)**（基于黑板架构与 Docker 容器调度的通用状态空间搜索引擎，参见[腾讯云智能渗透挑战赛复盘报道](http://mchz.com.cn/news/details4345)）与当前 **[Cairn 3.0 / v3.1.0](../README.zh-CN.md)**（面向 Pi、Claude Code、Codex、Multica 的内置目标与证据链插件），梳理当前版本在轻量化重构过程中弱化或缺失的核心思想，并给出落地的模块级优化方案。

## 一、架构演进核心对比

| 维度 | 原项目（[oritera/Cairn](https://kitploit.com/en/tools/github/oritera/cairn)） | 当前设计（[Cairn v3.1.0](architecture.md)） | 演进得失评估 |
| --- | --- | --- | --- |
| **系统形态与控制流** | 外部控制面（`cairn-server` + `cairn-dispatcher`）轮询调度 Docker 或本地 CLI Worker，并保存可恢复 session | 内嵌在宿主 CLI 会话中的轻量插件（5 个 MCP/原生工具 + Hooks + 单文件 SQLite） | **得**：不再要求 Docker 与双常驻进程，复用宿主会话上下文与权限；**失**：失去了外部调度器对超时/异常进程的强制收尾控制 |
| **图谱拓扑结构** | 任意深度的多跳有向无环图（DAG），支持超边（`Intent.from: ["f002", "f004"]`）表达多事实交汇推导 | 固定 5 层（Rank 0~4）星型/分层拓扑（[`src/ui/graph.ts`](../src/ui/graph.ts)）：`origin → work/basis/obs → claim → criterion → goal` | **得**：验收条件（`Criteria`）覆盖关系一目了然；**失**：结论（`Claim`）与阶段（`Work`）无法首尾相连，丢失了“一步垒一块石头”的多跳探索脉络 |
| **多智能体协同机制** | 基于共享黑板的信息素协同（Stigmergy）：多 Worker 通过 `claim / heartbeat / release / conclude` 并发认领不同 `Intent` | 单任务单 Owner 强排他锁（[`src/core/engine.ts`](../src/core/engine.ts) `own()` + `epoch` 代次隔离） | **得**：防止旧会话迟到写入污染状态；**失**：宿主派发的子 Agent（Subagents）无法直接认领分支或并发写入阶段发现 |
| **完成态纠偏与重开** | 提供 `POST /projects/{id}/reopen`，外部验证失败时可撤销完成边并将反馈注入为新 `Fact` 继续探索 | `completed` 状态不可变（`Completed tasks are immutable`），报错要求新建任务 | **得**：保证已交付报告的审计不可篡改性；**失**：线上验证或集成测试未通过时无法在原证据图上直接回退续跑 |
| **状态时序演化** | `Fact` 只增不改，状态变化（如“获得 shell”→“shell 断开”）通过追加新节点体现时序因果 | 鼓励复用 `finding.key` 原位覆盖同一个 `Claim` | **得**：保持当前结论列表紧凑；**失**：关系图主视图上掩盖了“假设被推翻、路径转向”的试错历史 |

## 二、当前项目缺失的原版核心思想

1. **多跳因果链与“超边”（Hyperedge）组合推理**
   - 原版协议中，每条探索意图（`Intent`）都明确声明其出发事实集合 `from: ["f002", "f004"]`，产出新事实 `to: "f006"`，从而在图上形成任意深度的递进推理链（如“利用 `f004` 泄露的凭据登录 `f002` 发现的管理后台”）。
   - 当前 [`src/ui/graph.ts`](../src/ui/graph.ts) 将所有执行阶段（`work`）、整理依据（`basis`）和原始观测（`observation`）硬编码连接到 `origin`（Rank 1），所有 `claim` 固定在 Rank 2，无法表达“结论 A 与结论 B 共同推导出下一步探索 C，进而得出结论 D”的多跳依赖。
2. **围绕共享黑板的子任务认领（Stigmergy 并发协作）**
   - 原版允许 Reasoner 一次性提出多个正交的高价值探索方向（`Open Intents`），由不同 Worker 并发认领执行。
   - 当前 [`src/core/engine.ts`](../src/core/engine.ts) 的 `own(task, session)` 要求每次写操作必须严格匹配单一主会话的 `host + sessionId + cwd + epoch`。当用户在 Claude Code 或 Codex 中开启多个子 Agent 并行排查不同子模块时，子 Agent 无法各自认领一个 `progress` 项并直接写入 `proposed` 结论。
3. **外部验证证伪后的原位重开（`reopen` 闭环）**
   - 复杂排障与安全测试经常出现“模型认为已完成并调用 `cairn_finish`，但外部裁判或测试脚本验证未通过”的场景。原版通过 `reopen` 将外部反馈化为图内新节点并恢复 `active`，而当前版本只能放弃原图新建 Task。
4. **超时或中断时的“二阶段强制收尾”（Two-Phase Conclude Fallback）**
   - 原版在探索超时或输出异常时，会复用同一会话执行 `explore_conclude`（“停止继续探索，仅将目前已确认的事实或已排除的死胡同总结落图”），尽量保留已确认的增量事实；两阶段均失败、取消或租约失效时没有强制保证。当前版本在会话异常中止时仅将 `running` 进度标为 `blocked`，缺少提取未落盘思考的收尾引导。

## 三、具体优化方向与落地方案

### P0：恢复多跳 DAG 拓扑与超边依赖（核心表达力升级）

* **涉及文件**：[`src/core/types.ts`](../src/core/types.ts)、[`src/tools.ts`](../src/tools.ts)、[`src/core/engine.ts`](../src/core/engine.ts)、[`src/ui/graph.ts`](../src/ui/graph.ts)
* **改动方案**：
  1. **扩展数据结构**：在 `ProgressInput`、`Claim` 及 `CheckpointInput.findings` 中新增可选字段 `from?: string[]`（允许引用已有的 `finding.key`、`claim.id` 或 `progress.key`）。
  2. **引擎校验**：在 [`src/core/engine.ts`](../src/core/engine.ts) 的 `checkpointOn()` 与 `progressOn()` 中校验 `from` 引用是否存在且不构成环路（DAG 无环校验）；若未传 `from`，默认保持向后兼容连回 `origin`。
  3. **动态分层布局**：改造 [`src/ui/graph.ts`](../src/ui/graph.ts) 中的 `projectGraph()` 与 `layoutGraph()`，取消固定的 5 列 Rank 限制，改为根据最长前驱路径 `max(rank(predecessor)) + 1` 动态计算每个节点的 `rank`，并将 `criterion` 与 `goal` 置于最大深度右侧（或底部），还原原版“从起点层层垒石推进到终点”的多跳超边关系图。

### P0：支持任务原位重开（`reopen`）与外部反馈注入

* **涉及文件**：[`src/core/engine.ts`](../src/core/engine.ts)、[`src/tools.ts`](../src/tools.ts)、[`src/cli.ts`](../src/cli.ts)
* **改动方案**：
  1. **Engine 新增 `reopen` 方法**：在 [`src/core/engine.ts`](../src/core/engine.ts) 中允许对 `status === 'completed'`（非已冻结交付的比赛终态，或支持比赛换轮重开）的任务执行 `reopen(taskId, session, feedback)`：
     - 将 `task.status` 重新设为 `'active'`，递增 `task.owner.epoch` 与 `task.revision`。
     - 自动将 `feedback` 记录为一条带有 `[REOPEN]` 标记的 `Hint`（或一条 `status: 'inconclusive'` 的新阶段记录），若指定了失效的 `finding.key`，自动将其状态从 `supported` 降级为 `proposed` 或 `refuted`，使对应完成条件（`Criterion`）重新变为未满足。
  2. **工具与 CLI 暴露**：
     - 在 `cairn_resume`（[`src/tools.ts`](../src/tools.ts)）中增加可选参数 `reopen_reason?: string`。
     - 在 CLI（[`src/cli.ts`](../src/cli.ts)）中增加 `cairn task reopen TASK_ID --reason "外部验证未通过原因"`。

### P1：引入子 Agent 分支认领与合并机制（轻量级 Stigmergy）

* **涉及文件**：[`src/core/types.ts`](../src/core/types.ts)、[`src/core/engine.ts`](../src/core/engine.ts)、[`src/tools.ts`](../src/tools.ts)
* **改动方案**：
  1. **分支级委派标识**：在 `ProgressItem` 中增加 `assignee?: string` 与 `branchStatus?: 'open' | 'claimed' | 'merged'`。
  2. **受限子会话写入**：允许子 Agent 在调用 `cairn_checkpoint` 时传入 `task_id` 与所认领的 `progress_key`。当检测到调用者非主 `Owner` 但指定了有效的待认领 `progress_key` 时：
     - 允许其更新该 `progress_key` 的状态，并写入 `status: 'proposed'`（待主会话复核）的分支 `findings`（标记 `provenance: 'subagent'`）。
     - 禁止子 Agent 直接调用 `cairn_finish` 或将结论直接标为 `supported` 覆盖主目标条件，最终验收仍由主 Owner 会话汇总确认。

### P1：CLI 易用性与本地 Web 看板（`cairn ui`）轻交互增强

* **涉及文件**：[`src/cli.ts`](../src/cli.ts)、[`src/ui/server.ts`](../src/ui/server.ts)、[`src/ui/client.ts`](../src/ui/client.ts)
* **改动方案**：
  1. **简化 CLI `hint` 与管理命令**：目前 `cairn task hint TASK_ID --input file.json --host ... --session-id ...` 需要手写临时 JSON 文件并传入会话身份（[`src/cli.ts`](../src/cli.ts)）。应支持直接执行 `cairn task hint TASK_ID "优先排查连接池配置" --author human`，且人工注入 `Hint` 属于图外输入，无需校验当前活跃 Agent 的 `sessionId` 排他锁（与原版协议“任何状态下均可补充 Hint”对齐）。
  2. **看板安全写接口**：在 [`src/ui/server.ts`](../src/ui/server.ts) 保持 Loopback 绑定、Host/Origin 校验的基础上，引入启动时生成的本地 CSRF Token，开放三个高频人工协同操作：
     - 在页面直接输入并提交人工提示（`POST /api/tasks/:id/hints`）。
     - 一键暂停处于卡死状态的任务（`POST /api/tasks/:id/suspend`）。
     - 对已完成但验证失败的任务发起重开（`POST /api/tasks/:id/reopen`）。

### P2：增强 `curated` 模式引用校验与中断时的二阶段收尾引导

* **涉及文件**：[`src/core/engine.ts`](../src/core/engine.ts)、[`src/adapters/hooks.ts`](../src/adapters/hooks.ts)、[`src/ui/graph.ts`](../src/ui/graph.ts)
* **改动方案**：
  1. **工作区本地文件引用校验**：在 `curated` 模式下，当 Agent 提交 `references: ["src/core/engine.ts"]` 等相对路径时，在 `evaluateReport` 中基于 `task.owner.cwd` 做一次轻量存在性检查（`existsSync`）。若引用的本地文件不存在，在 `validation.issues` 中返回明确提示，防止模型幻觉捏造文件路径。
  2. **Stop / PreCompact 二阶段收尾提示**：在 [`src/adapters/hooks.ts`](../src/adapters/hooks.ts) 处理 `PreCompact` 或 `Stop` 事件时，若检测到当前任务存在 `running` 状态的 `progress` 项且最近未保存 `checkpoint`，注入原版 `explore_conclude` 风格的收尾提示——引导模型在上下文压缩或停止前，将已排除的假设记录为 `status: "refuted"` 的 Finding，避免下一会话重复踩坑。
  3. **保留结论演化的可视化轨迹**：在 [`src/ui/graph.ts`](../src/ui/graph.ts) 与右侧详情面板中，对于发生过多次 `revision` 修订的 `Claim`（例如从 `proposed` 变为 `refuted` 或修改了结论文本），支持展开查看历次修订时间线，兼顾主图整洁度与探索过程的可追溯性。


## 五、本轮已落地的实现与校正（2026-10-16）

| 目标 | 实际实现 | 保留的约束 |
| --- | --- | --- |
| 通用 harness | 任意 stdio MCP 宿主共用五工具协议；新增 ESM／TypeScript `createHarness` 嵌入入口 | 宿主拥有模型、执行、审批与进程；没有新增模型运行时 |
| 多跳探索 | findings／progress 的 `from`；同批无序解析、规范 ID、歧义与 DAG 校验；动态布局及 HTML 快照 | 一个节点的全部来源作为共同前提组；依赖不替代证据或验收 |
| 修订历史 | Claim 当前视图加历史快照，节点详情展开；保持既有审计事件 | 不伪造升级前不存在的历史快照 |
| 原位重开 | `resume.reopen_reason`、CLI／看板；上一轮报告快照、图内反馈、新 epoch、重新验收 | 仅显式失效的 Finding 降级；已交付和 emergency 仍冻结 |
| 分支协作 | Owner 显式 `delegated`，Worker claim／heartbeat／release／checkpoint，Owner merge | 有期限与 token 的租约，绑定 Owner epoch；Worker 只写自己的 proposed Findings |
| 人工操作 | 无 Agent 身份的 hint、暂停、重开；看板 CSRF＋同源＋revision 校验 | Hint 仍是图外输入，不能直接充当自动取证 |
| 引用诊断 | 本地存在性检查、advisory／strict 策略及可替换验证函数 | 不读取 URL、不把存在性视为真实性；远程工作区可替换校验 |
| 二阶段收尾思想 | 有界 conclude 请求、requested／saved 状态、Stop／Pi 压缩集成 | 宿主内尽力保存，不能声称具备外部进程强制收尾能力 |

对原版思想的关键校正：

- 原版已提供 `LocalBackend`，也保存 CLI session；通用性不等于退回容器调度。
- 原版 reopen 将外部反馈追加为 Fact，并撤销 goal 完成边，而非自动修改旧 Fact。本轮保留普通 Finding 和完成历史，追加反馈，要求重新确认所有完成覆盖。
- 原版图表达知识，reason lease 是图外协调状态。本轮租约也不成为证据；比仅有 `assignee`／`branchStatus` 多出 token、到期与执行代次校验。
- 五个工具名称保持稳定，通过可选字段扩展能力；旧任务未声明依赖或引用策略时保持兼容。

完整参数、嵌入示例及限制见 [通用 Harness 接入与协作](harness.zh-CN.md)；验证结果见 [verification.md](verification.md)。

## 六、可选宿主调度闭环（2026-10-18）

在默认五工具 harness 之外增加 `Scheduler` / `cairn run`：先 Bootstrap 直接尝试；根据事实修订、提示、探索方向和验收缺口触发 Reason；由宿主执行 Explore，提交 proposed 发现，再由 Reason 显式审核覆盖并调用既有 `finishVerified`。不要求领域字段、不直接接入模型 API、不设置轮数/token/任务时间预算。

复用现有分支租约与 owner epoch，持久保存阶段、待应用公开结果及原生 sessionRef。调度器自身有互斥租约；默认本地 Pi/Codex 适配器另用私有进程登记和会话锁，只有确认旧进程组已退出才允许同会话 conclude。无法确认时保留缺口，租约不冒充进程监督。没有可执行方向或候选无变化却反复验收失败时挂起，不空转推理。

完整构建、类型检查与回归为 327/327；覆盖领域无关的完整闭环、并行提案审核、暂停/接管、旧会话恢复、迟到结果和无进展退出。真实模型效果由独立冻结的 Round12 测量，不能用测试通过替代正确率结论。使用入口与恢复限制见 [可选的宿主调度层](scheduler.zh-CN.md)。
