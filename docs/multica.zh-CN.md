# Multica 接入：安装一次，直接使用 MCP 和关系图

适用于运行在同一台机器、同一执行用户下的 Multica 本机 Codex／Claude／Pi。Multica 负责模型、运行队列和会话；Cairn 提供目标、整理后的依据、完成检查和恢复状态。默认是 `curated`，不需要工具白名单，也不保存工具调用原文。

## 已有全局命令

先在 Multica 中创建 Agent 并选择在线运行时。在该运行时所在机器执行：

```sh
cairn install --target multica --agent "排障助手" --workspace-id WORKSPACE_ID
```

`WORKSPACE_ID` 替换为实际工作区 ID，可通过 `multica workspace list --output json` 查看。智能体使用精确名称或 ID；同名不唯一会要求消歧。安装器不会自动创建 Agent，也不会更改模型、思考等级或 Instructions。

已有手工配置的 `cairn` 工作区 MCP 服务时，显式交给安装器管理：

```sh
cairn install --target multica --agent "排障助手" --workspace-id WORKSPACE_ID --adopt
```

安装会完成：

1. 将自包含运行时和共享 skill 安装到用户的 `.cairn/installations/multica/`。
2. 登记使用绝对 Node 路径的 stdio MCP；启动参数只需 `mcp`，自动生成连接身份，无 shell／`uuidgen` 包装。
3. 在指定 Agent 上绑定并启用 Cairn MCP、共享 skill，保留其他服务与技能。
4. 默认固定到用户目录下 `.local/share/cairn/multica/state.db`，同时记住通用 MCP 与看板数据库。
5. 保存安装回执及最后成功的工作区／Agent，供幂等更新和故障重试使用。

可用 `--db /absolute/path/state.db` 更换该接入的数据库。路径属于实际执行机器；远端运行时应在对应机器安装并持久化该目录。

## 从源码一条命令安装

在 Cairn 仓库根目录准备好 Node.js 24+ 和 npm 依赖，然后执行：

```sh
npm ci
npm run install:global -- --target multica --agent "排障助手" --workspace-id WORKSPACE_ID
```

已有手工 Cairn 服务时，末尾增加 `--adopt`。原有 `--prefix`、`--cache` 和 `--offline` 继续可用；`--offline` 只控制 npm 阶段，Multica 登记仍需连接其服务。

安装脚本先构建并全局安装独立副本，再调用实际安装目录中的命令配置适配。省略 `--target` 时只安装／更新全局命令。

## 日常命令

```sh
# 打开同一份状态的关系图
cairn ui

# 更新最后一次成功接入的 Agent
cairn update --target multica

# 核对回执、运行时文件、MCP 与 skill 绑定
cairn doctor --target multica
```

首次成功安装后，上述更新和检查会使用保存的精确工作区与 Agent。即使 Multica CLI 默认工作区变化，也不会切到其他团队。切换工作区时应显式给出新的 `--workspace-id` 与 `--agent`。

## Agent 的使用方式

绑定共享 skill，并在 Agent Instructions 中要求：

```text
使用 Cairn 保存目标、阶段状态、依据、结论和文件/链接引用。
MCP 已绑定连接身份，省略 session_id。
普通任务自由使用当前工具，不记录逐次工具调用。
阶段变化时 checkpoint，满足目标后 finish；不能继续就保存缺口并暂停。
保留 Cairn task_id，新会话继续时显式 resume、takeover=true。
```

任务输入应给出真实项目路径、现象、时间范围、访问边界与完成条件。Multica 的临时工作目录可能没有业务仓库，不能用它代替实际项目路径。

## 独立通用 MCP

其他支持 stdio MCP 的客户端可以启动：

```sh
cairn mcp
```

每个进程有独立身份。通用 MCP 的数据库按 `--db` → `CAIRN_DB` → 已保存 MCP 配置 → 当前工作区选择。单独保存或清除：

```sh
cairn mcp --db /absolute/path/state.db --remember
cairn mcp --forget
```

`mcp` 是 stdio 协议服务，交给客户端启动；不要把它当 HTTP 服务。显式原生宿主的 `--host codex|claude|pi` 保持原有真实身份与工作区语义。

## 更新、失败和卸载

重复执行安装会复用已有登记。部分失败保存回执，解决错误后重试相同命令。用户修改过的 skill 不会被静默覆盖；已知原版旧 skill 的受控升级由安装器识别。

Multica 的 MCP 配置是 write-only；`doctor` 能核对登记和绑定，并说明本地回执记录的是最后一次成功写入，不能把它当成远端配置全文回读验证。

```sh
cairn uninstall --target multica
```

卸载仅解绑该安装记录负责的 Agent MCP 绑定。共享工作区服务、skill 及其绑定、本地版本运行时和任务数据会保留，便于其他 Agent 和历史任务继续使用；命令会明确列出保留项。

该接入使用通用 MCP，不安装原生取证 hooks。普通任务可显式保存与恢复；严格比赛模式仍需要它要求的原生能力和正式比赛工具映射。
