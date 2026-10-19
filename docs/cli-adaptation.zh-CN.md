# CLI 适配检查（2026-10-19）

Cairn 的原生六工具接入支持 Pi、Claude Code、Codex 和 DSH。可选的 `cairn run` 自动 Scheduler 当前只支持 Pi/Codex；Claude/DSH 使用宿主本身的工具循环和委派。新 Scheduler 任务默认复用单会话，显式 `--session-mode multi` 才允许独立 Explore；此参数不控制其他宿主的原生代理扩展。

| 宿主 | 本机版本 | 接入与本轮验证 | 自动 Scheduler |
| --- | --- | --- | --- |
| Pi | 1.3.0 | 原生扩展、六工具；真实 CLI 的 captured、curated、完成反馈、探索恢复四组本地协议夹具通过，身份、事实保存、挂起和跨会话接管正确 | 支持；单会话恢复、独立 Explore、并发、纠错、用量和取消回归通过 |
| Claude Code | 2.1.220 | 原生插件＋MCP＋hooks；真实 CLI 在隔离配置下执行六工具、原生 Read 捕获、挂起和新会话接管，最终完成，owner epoch 为 2 | 暂不支持；由 Claude 自身执行 |
| Codex | 0.162.0 | 原生 CLI 成功解析并列出安装器生成的 MCP 注册；六工具/MCP、hooks、身份、用量与会话恢复回归通过 | 支持；真实子进程夹具确认继续同一 thread，独立 Explore、纠错与取消通过 |
| DSH | 本机未安装 | Cordis 原生工具端口、每 agent 身份/工具 schema 隔离、已返回结果、完成续行及缺测用量回归通过；本轮未重跑真实 DSH CLI | 暂不支持；由 DSH 自身执行 |

Pi/Claude 使用本机 HTTP 模拟模型服务与假凭据，验证当前安装 CLI 的协议接入，不调用付费模型。Codex 的模型执行、恢复和错误分支使用子进程夹具；本轮没有运行实际模型请求。DSH 此前已按用户选择清理，本轮不重新安装，因此不能把单元适配通过写成当前真实 CLI 已验证。旧版真实 DSH 验证记录不代替本轮检查。

## 修正与验证

- Claude 协议夹具隔离 HOME、CLAUDE_CONFIG_DIR 与账号/代理环境，显式检查六工具均暴露，并实际调用 `start/resume/read/update/checkpoint/finish`。
- 中文构建包列表补齐 DSH。多分支评测的当前驱动显式指定 multi，适配新的单会话默认值；历史冻结实现、驱动和成绩不变。
- 类型检查、运行时构建通过。493 项确定性回归中，沙箱内通过 483 项；另外 10 项因沙箱禁止监听回环端口，在沙箱外重跑全部通过。额外的五组真实 CLI 协议夹具通过；多分支无模型夹具确认两个独立 Explore 实际并发并进入主流程审核。
- 新旧会话策略、模型/工具权限与结论正确性保持分开。通过协议验证不说明任何模型更准确，也不保证远端账号或服务始终可用。

机器可读结果见[检查收据](reviews/2026-10-19-cli-adapters.json)，用法见[安装指南](../README.zh-CN.md)、[调度指南](scheduler.zh-CN.md)。本次不更改全局模型配置、比赛工作区或 Multica 智能体。
