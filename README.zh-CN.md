# Cairn

[English](README.md) | 简体中文

**为 Pi、Claude Code、Codex 提供目标管理、证据链和可恢复的任务状态。**

Cairn 是运行在现有 AI CLI 中的本地插件。你继续使用原来的模型、账号、工具和会话；Cairn 负责记录任务目标、区分观测与推断、保存证据，以及在交付前检查完成条件。

适用于故障排查、根因定位、研究调查，以及其他需要多步探索、明确完成标准和证据追溯的任务。无需启动 Cairn 调度器、模型 worker 或常驻服务。

## 快速开始

### 1. 安装依赖并构建

需要 **Node.js 24 或更新版本**，以及已经安装、配置好模型或账号的目标 CLI。

在项目根目录执行：

```sh
npm install
npm run check
```

`npm run check` 会执行 TypeScript 类型检查、构建插件包并运行自动化测试，不调用真实模型。

### 2. 安装到目标 CLI

按实际使用的 CLI 选择一条命令；需要同时使用时，也可以分别安装。

```sh
node bin/cairn.mjs install --target pi
node bin/cairn.mjs install --target claude
node bin/cairn.mjs install --target codex
```

默认安装到**当前项目**。安装完成后，重新开启 CLI 会话。Codex 还需要信任项目，并通过 `/hooks` 检查和信任 Cairn 的 hooks。

在多个项目中使用时，可以改为用户级安装：

```sh
node bin/cairn.mjs install --target pi --scope user
```

`--root DIR` 可以指定安装根目录，适合隔离测试。插件会保留宿主的模型选择、账号认证和审批设置。

### 3. 开始任务

直接向 Agent 描述目标，例如：

> 使用 Cairn 排查这个接口的超时问题。先定义可以验证的完成条件，将观测结果与假设分开记录，按证据逐步缩小范围，最后给出影响面、根因、证据链和解决方案。证据不足时说明缺口并保存进度。

Agent 创建或恢复 Cairn 任务后，插件才开始处理该任务的状态。普通 CLI 工作可以继续按原来的方式进行。

## 核心思路

Cairn 将任务状态分为五类：

| 概念 | 含义 |
| --- | --- |
| **Goal（目标）** | 要解决的问题、可观测的完成条件、约束和预算 |
| **Observation（观测）** | 工具实际收到的参数、返回结果、时间、作用范围和来源引用 |
| **Claim（假设与结论）** | 对观测的解释，区分待验证、已支持、已反驳和证据不足 |
| **Action（行动）** | 一个有明确目的、结果和停止条件的步骤 |
| **Hint（人工提示）** | 人补充的背景和方向，保留人工来源 |

完成条件关联已支持的结论，结论再关联原始观测，形成可以追溯的证据链。原始观测不可修改，结论的历史修订保留在审计记录中。当前状态和对应事件在同一个 SQLite 事务中提交。

引用有效并不自动说明因果判断正确。Cairn 检查引用、作用范围和状态等结构条件；Agent 仍需判断证据是否支持结论、是否存在反证，以及结论是否超出了查询范围。

### 与旧版的变化

- 由宿主 CLI 管理模型、会话、工具调用与并发，主 Agent 在持续会话中自主推进。
- Cairn 保存目标、证据、假设和进度，不再维护固定的 bootstrap/reason/explore 任务交接与模型 worker 池。
- 每个任务默认由一个主会话负责，独立查询可在预算内有限并行。
- 通过外部状态包恢复任务，减少重新读取全部探索历史的需要。
- 旧 Python 服务、dispatcher、容器执行路径及其接口已被替换，旧配置和数据库格式不自动迁移。

## 三种 CLI 的接入方式

| 宿主 | 接入方式 |
| --- | --- |
| Pi | 注册自包含 Pi package，通过原生扩展处理工具事件和任务恢复，并提供原生 Cairn 工具 |
| Claude Code | 通过本地 marketplace 注册原生插件，包含 skills、hooks 和 stdio MCP |
| Codex | 注册项目级或用户级 hooks、MCP 和共享 skill，同时生成可用于原生 marketplace 分发的插件包 |

Codex 的项目级安装使用宿主原生配置，不依赖在用户全局插件缓存中激活项目插件。构建产物位于 `dist/plugins/pi`、`dist/plugins/claude` 和 `dist/plugins/codex`，每个包都包含自己的运行时，可独立于源码目录移动。

Claude Code 和 Codex 的启动 hook 会提供真实的 `session_id`，Agent 调用 Cairn MCP 工具时需要使用它。Pi 原生工具自动绑定当前会话，无需自行填写会话 ID。

其他支持 MCP 的 CLI 可以接入共享服务，并加载 `skills/cairn`：

```sh
node /absolute/path/to/Cairn/dist/cairn.mjs mcp --host mcp --session-id my-task-session
```

仅配置 MCP 时，不能自动捕获宿主原生工具调用；手动登记的证据会保留其手动来源标记。

## 查看、暂停和恢复任务

```sh
node bin/cairn.mjs task list
node bin/cairn.mjs task show TASK_ID
node bin/cairn.mjs doctor --target codex
```

将 `TASK_ID` 替换为实际任务 ID。`doctor` 检查宿主版本、安装情况、MCP 连通性、已观察到的生命周期事件和上游白名单工具。配置文件存在不代表 hooks 已获得信任或实际运行。

需要暂停时，让 Agent 调用 `cairn_suspend`，记录尚未解决的问题。中断不会被自动续跑提示覆盖，完成检查最多提供有界的补充提示。

### 跨 CLI 接管

在新的 CLI 会话中告诉 Agent：

> 使用 Cairn 恢复任务 TASK_ID，明确接管该任务（takeover=true）。先读取当前目标、假设、证据索引和未满足的完成条件，再继续工作。

接管会递增任务的执行代次。旧会话不能继续完成该任务，迟到的结果仅用于审计。恢复的是 Cairn 的外部状态包；原生对话历史仍由原来的 CLI 保存。

## 报告与证据图导出

```sh
node bin/cairn.mjs export TASK_ID --format json --out task.json
node bin/cairn.mjs export TASK_ID --format markdown --out report.md
node bin/cairn.mjs export TASK_ID --format html --out evidence.html
```

HTML 文件包含观测、结论、完成条件之间的关系图，以及可展开查看的原始工具结果。可以离线打开，无需启动服务。

## 数据存储

任务数据默认保存在 `<workspace>/.cairn/state.db`。可以通过 `CAIRN_DB` 环境变量或 `--db FILE` 指定其他数据库；`CAIRN_WORKSPACE` 可以指定工作区根目录。

原始工具结果可能包含任务中的敏感信息，应将 `.cairn` 保持为私有目录并排除在 Git 之外。插件安装和任务数据分别管理，卸载插件会保留任务数据。

## 受控工具与应急比赛模式

共享网关支持 stdio 和 Streamable HTTP MCP 上游，按显式白名单执行工具调用，记录原始结果，并控制截止时间、调用次数和并发。

```sh
node bin/cairn.mjs configure --file profiles/emergency.example.json
```

**示例文件尚未配置真实比赛环境。** 接入前必须根据主办方的正式工具定义替换命令、工具名、参数和字段映射。

`emergency` Profile 要求原生事件集成、白名单，以及 `teamId`、`roundId`、`issueId`、`matchId`。同一场比赛的所有关卡共用一个持久化的 **30 分钟截止时间**，重启会话或创建下一关任务不会重置计时，默认保留最后 30 秒用于提交与回执核对。

每关报告包含：

1. **影响面**：说明受影响的功能、用户和数据范围，区分样本与全量评估。
2. **根因**：给出明确结论和因果层次；证据充分时区分触发因与放大机制。
3. **证据链**：引用本队本关真实工具调用产生的 `result_ref`，解释每条证据支持的判断。
4. **解决方案**：给出针对已确认机制的应急止血、根因修复和防复发措施。

人工 Hint 和手动登记的观测不能作为比赛证据。比赛排查与提交通过 `cairn_tools`、`cairn_call` 使用配置好的白名单工具。

### 提交与确认

提交工具映射必须配置 `reportPath` 和 `receiptPath`。网关将校验后的已保存报告写入 `reportPath`；平台需要 Markdown 文本时，配置 `reportFormat: "markdown"`。

提交回执缺失或结果不明确时，需要先通过允许的回执查询工具核对，不会直接重复提交。取得真实回执后，由队伍在模型工具之外确认：

```sh
node bin/cairn.mjs confirm TASK_ID
```

随后 Agent 才能完成该比赛任务。最终的引用有效性、比赛完成状态与得分，以主办方平台判定为准。

### 工具覆盖范围

各宿主 hook 的覆盖范围不同。例如，Codex 的托管工具和部分特殊调用路径可能不经过本地 hooks。Cairn 网关对其管理的调用执行白名单和预算限制；其他原生工具仍遵循宿主的沙箱、审批与访问控制。

## 更新与卸载

```sh
node bin/cairn.mjs update --target pi
node bin/cairn.mjs uninstall --target pi
```

目标可以替换为 `claude` 或 `codex`，并应使用安装时相同的 `--scope` 和 `--root`。安装器会合并配置、记录自己写入的登记项；如果发现用户修改过登记项，卸载会报告并保留相应配置和运行时，任务数据始终独立保留。

## 供 Agent 使用的主要工具

| 工具 | 作用 |
| --- | --- |
| `cairn_create`、`cairn_resume` | 创建目标或恢复、接管已有任务 |
| `cairn_state`、`cairn_events` | 读取状态摘要或增量审计记录 |
| `cairn_evidence` | 读取原始证据或登记明确标记为手动的观测 |
| `cairn_claim`、`cairn_satisfy` | 修订假设，将已支持的结论关联到完成条件 |
| `cairn_action`、`cairn_hint` | 记录有目的的行动或人工背景 |
| `cairn_check`、`cairn_report`、`cairn_complete` | 检查目标、保存并校验报告、完成任务 |
| `cairn_suspend`、`cairn_delivery` | 保存未完成进度或核对真实交付回执 |
| `cairn_tools`、`cairn_call` | 发现并执行受控的上游 MCP 工具 |

## 开发与验证

```sh
npm test
npm pack --dry-run

# 可选：使用当前已配置的 CLI 和模型进行真实闭环测试
node scripts/host-smoke.mjs pi
node scripts/host-smoke.mjs claude
node scripts/host-smoke.mjs codex

# 使用真实 Claude Code CLI 连接本地固定响应 fixture，不请求外部模型
node scripts/claude-fixture-smoke.mjs
```

真实模型测试会使用现有账号并可能消耗额度，日志保存在测试打印的临时目录。Codex 自动化测试仅在本次执行中信任生成的 hooks，正常安装仍需按宿主要求进行信任检查。

当前验证记录包括 **34 项自动化测试通过**，以及 Pi、Codex 的真实模型任务闭环。Claude Code 的真实 CLI 接口已通过本地协议 fixture 验证；上次真实模型验证因已有 OAuth 会话过期而未通过。它们验证的范围不同，不能据此宣称已测得模型排障准确率提升。

进一步阅读：

- [架构与公共工具说明（英文）](docs/architecture.md)
- [完整验证记录（英文）](docs/verification.md)
- [带标准答案的合成排障案例与评分方法](evaluations/README.md)

## 背景与许可

Cairn 最初是一个目标驱动的协作探索引擎，并在腾讯云 AI 渗透测试挑战赛中得到验证。新版将其中的目标、证据和人工提示思想保留为可复用的 CLI 插件。

项目采用 [AGPL-3.0](LICENSE) 许可。
