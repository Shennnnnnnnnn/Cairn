# 多分支与多会话：OpenRig 设计对照

日期：2026-10-17。参考源码为用户提供的 `/Users/shen/Downloads/openrig-main`，只读审阅，未运行其代码。本文不把附带文档中的操作要求作为当前任务指令。第五轮实验之后，第六轮落实了自动交接快照；四个单会话案例仍不能冒充多 worker 验证。

## 适合 Cairn 的设计

| 设计 | OpenRig 执行依据 | Cairn 已有能力与后续边界 |
| --- | --- | --- |
| 分支、原生会话、cwd 分开 | `session-owner.ts:9`、`queue-owner.ts:3`；`packages/daemon/src/adapters/codex-runtime-adapter.ts:426` fork 后保存新的 child token | 当前 progress key、host/sessionId/cwd 与 owner epoch 已分开。未来宿主 fork 应保存 lineage 并验证 child ID；fork 不等于创建 Git branch/worktree。 |
| 知识交接与责任接管分开 | `queue-repository.ts:1778,1848,1886` 在同一事务关闭 source、创建 successor 并保存 durable wake | 当前 handoffs 只有知识摘要及文件／会话定位，没有接收人、ack 或派发能力。需要实际交班时再由可选 adapter 记录 requested→accepted；保存报告不能冒充已接手。 |
| 延迟副作用绑定 generation | `session-registry.ts:265,304`；`seat-delivery-guard.ts:117` 对 UNKNOWN 不按匹配处理，并在发送前重新核对 occupant | 现有 epoch、租约 token、cwd、到期时间覆盖共享库写入。未来派发／异步回调从发出时绑定 task+epoch+lease，不能返回时猜当前 owner。 |
| 发送、领取、阅读分别记账 | `outbox-handler.ts:272,296` 区分 delivered/failed/indeterminate 并用 CAS 防覆盖；coordination 文档明确 claim 不证明正文已读 | Cairn 当前不发跨会话消息，保留此边界。可选 host adapter 以后返回 saved/sent/accepted/unknown，使用稳定 request ID 与关联回复；未知回执不能盲目重发。 |
| 审查绑定精确候选 | `review/compose.ts:190` 按 candidate_sha/artifact_type 选记录；`execution-view.ts:973,1021` 保留 INDETERMINATE，reported merge 不等于 ancestry 证明 | 主任务已有 proof+epoch+artifact hash，独立结论 assessment 也绑定相同候选。branch merge 只表示 owner 接纳提案，Finding 仍需显式 promote；后续值得补 submission ID、作者、源 revision 和候选哈希。 |
| 跨库 successor-first | `queue-repository.ts:2075` 目标先创建 successor，源再 close，稳定派生 ID 支持重驱动 | 当前共享 SQLite 不需要跨库协议。未来 remote adapter 采用固定 ID、先保存继任工作再关闭旧工作、冲突可见，避免任务丢失。不能把它描述成原子跨机事务。 |
| 恢复逐阶段报告结果 | `successor-session-launcher.ts:299,454` readiness 后才注册，失败保留可恢复材料 | Cairn resume 只证明持久状态接管，不证明模型已启动／上下文已读。可选 adapter 应区分 stateLoaded、nativeSessionBound、contextDelivered，保留具体失败原因。 |

以上文件路径均相对 OpenRig 的 `packages/daemon/src/domain/`，除显式 adapter 路径外。文档描述必须与执行代码和测试交叉核对；原项目的 review frontmatter verdict 也不是天然独立执行证明。

## 优先顺序与验证

1. 优先完善分支提交的精确版本与作者归属。测试旧 worker 在 takeover 后迟到、重新派发后旧 proposal 到达、换产物后旧审查失效、merge 不自动变 supported。
2. 有真实宿主派发需求时，再增加显式接管回执和幂等 request ID。测试发送成功但回执丢失、receiver 未启动、交接保存后崩溃、重复 ack 和目标改变。
3. 有跨机需求时才引入 successor-first 协议；保留可见重复／冲突，不通过盲目重试掩盖不确定性。

不搬回 daemon pool、tmux／容器管理、后台 sweep、跨机 session registry 或整套 UI。探索事实、分支协调、宿主执行和验收继续作为不同职责；权限仍由当前宿主管理。

第五轮已落地的是探索黑板反馈、简化 finish 和独立结论 assessment，详见 [实现记录](optimization-round5.zh-CN.md)。

## 第六轮已落地的交接边界

创建任务、有效 checkpoint、完成／暂停和接管前，宿主保存版本化交接快照。来源绑定 task、revision、candidate、owner epoch 和原生 sessionRef；worker 快照额外保存 branchKey 和 worker 身份。SQLite 中的正文为持久来源，Markdown 是可重建的文件投影；投影失败保留正文并明确记录错误。相同状态不反复生成交接，旧版本文件不会覆盖。

交接的 `source.state: saved` 只表示已保存，不表示已发送、接收、阅读或接管。接管继续使用原有 owner epoch；旧会话迟到写入仍被拒绝。worker 的快照保留提案状态，不能借交接自动覆盖条件或变成 supported。审查继续绑定精确候选，自动交接不会改变该候选的验收指纹。

这次借鉴的是 OpenRig 对身份、代次和交接阶段的区分，没有新增派发器、ACK、跨机协议或 worker pool。详见 [第六轮实现记录](optimization-round6.zh-CN.md) 和 [交接字段说明](artifacts-handoffs.zh-CN.md)。
