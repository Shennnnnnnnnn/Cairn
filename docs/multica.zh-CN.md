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
发现或阶段变化时 cairn_update；交接前 checkpoint 保存增量，满足目标后 finish {}。
curated 模式使用 basis 和 references；captured 模式才使用 evidence／against。
不能继续就保存缺口并暂停。
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

该接入使用通用 MCP，不安装原生取证 hooks。普通任务可显式保存与恢复；可选原始结果采集依赖宿主实际提供的事件。

## 原生 Pi 与独立执行目录

Pi 也可直接加载构建产物中的 `pi-extension.mjs` 和 Cairn skill。原生适配器绑定实际 Pi 会话，收集宿主数值用量；同一 Agent 选择通用 MCP 或原生 Pi 中的一种 Cairn 接入，核对实际可见的六个工具。模型和业务数据工具继续由宿主提供。

多个 Issue 使用 Multica 的独立执行目录。`local_directory` 资源选择 `execution_mode=worktree` 时，源目录必须是 Git 仓库。每次运行会取得独立 checkout；宿主可能在结束后释放它，因此报告、恢复材料和黑板引用应指向持久位置。不要用执行目录中的共享可变文件充当其他会话的任务身份。

可选的 `multica-platform.mjs` 提供当前 Issue 读取、状态与报告交付桥，不参与诊断或模型调度。它使用已有 Multica CLI 身份，固定原生会话的 Issue，按 **Issue＋原生会话** 分隔产物。配置文件默认位于该模块旁的 `multica-platform.json`：

```json
{
  "cli": "/absolute/path/to/multica",
  "serverUrl": "https://your-multica.example",
  "workspaceId": "WORKSPACE_ID",
  "artifactRoot": "/persistent/cairn/deliveries",
  "requireAnswer": true
}
```

原生 Pi 参数中先加载交付桥，再加载 Cairn：

```text
--extension /persistent/runtime/multica-platform.mjs
--extension /persistent/runtime/pi-extension.mjs
--skill /persistent/skills/cairn
```

宿主可信环境配置如下；路径需替换为实际绝对路径，不放入业务 Issue：

```text
CAIRN_DB=/persistent/cairn/state.db
CAIRN_VERIFY_COMMAND=["/absolute/path/to/node","/persistent/runtime/multica-verifier.mjs"]
```

交付桥在原生会话启动时确定持久产物路径，并在 Cairn 打开数据库前配置完成校验。`platform_report_save` 保存不可变版本并返回 `bundle_id`；`platform_report_submit` 仅接收这个编号，提交同一份文件、回读正文和附件、保存真实回执，然后转为 `in_review`。丢失响应时重试同一编号，不重新生成报告。完成校验核对当前会话回执及文件哈希；临时 checkout 释放后，持久文件仍可核验。

黑板服务与 Agent 显式使用同一数据库：

```sh
cairn serve --db /persistent/cairn/state.db --remember
```

Cairn 的产物验收与结论正确性分别展示。原生 Pi 只保留当前宿主回合绑定前的数值用量，成功 start／resume 后合并，前一个普通回合不会计入新目标；宿主请求出错时将用量标为不完整，而不声称失败请求没有成本。

`evaluations/public-rca/multica-replay-tools.mjs` 是独立的离线 CSV 回放数据工具，不属于 Cairn 内核。它保留真实查询编号、原始数据来源、单位与采样桶未知信息，并支持来源绑定的算术运算。其他业务应使用自身已授权的数据工具。


## Claude 与 DSH 原生宿主

Claude 复用现有 marketplace 插件与 hooks。Claude Code 2.1.302 会在接入阶段过滤带顶层 `oneOf/anyOf` 的工具；Cairn 仅调整该宿主的 MCP 声明，保留调用时的单操作、模式和 checkpoint 增量校验。首次同时启动 hook 与 MCP 时，数据库会先设置等待锁的超时再启用 WAL。

DSH 适配通过原生 Cordis、tool、agent 和 session 接口接入，复用 Pi 适配中的六工具与完成/恢复逻辑，不引入 DSH SDK 或另一套调度循环。每个原生 agent 有独立工具目录和真实 session 绑定；数字用量来自提交后的 session 事件，无数字的失败尝试标注缺测。

Multica 的 DSH 运行时另需官方 `multica-ai/dsh-multica-runtime` stdio 桥；安装 Cairn 的 overlay 本身不等于安装这个桥。桥和模型配置保留在执行机器，平台只负责排队和宿主执行。当前最新 DSH 为 RC，接入时固定已验收版本并通过 `--probe` 检查协议。

同一模型的 Chat 与 Anthropic API 可能有不同权限。需要转换时，使用已配置的 CC Switch 上游格式和本机路由，并核对实际返回模型；不要因协议不通而悄悄切换其他模型。测试报告应分别记录真实宿主版本、传输方式、主会话原生用量、缺测与交付验收。

原生接入时，宿主进程与应用工具必须使用同一真实会话身份。Claude 的可信启动器可以把原生 session ID 传给 `cairn mcp --host claude --session-id ID`，避免身份依赖模型重复填写。通用 `cairn mcp` 保留自动生成独立连接身份的默认行为。

对明确要求使用 Cairn 的智能体，可在应用侧为取证/产物写入工具增加活动目标入口检查：允许先读取当前 Issue，后续业务操作要求当前真实会话已绑定活动目标；失败时返回创建/恢复目标的指引，不执行业务动作。目标仍由模型调用创建。该策略属于显式启用的智能体工作协议，不改变 Cairn 默认按需启用的行为，也不包含题目规则。

本轮增加了普通材料核对与报告交付的非排障验收，三个宿主均完成真实目标创建、读取、保存、提交、回读和 finish。[三宿主对比记录](../evaluations/public-rca/comparison-hosts-20261019.zh-CN.md)分别报告诊断命中、平台交付、框架闭环和主会话用量。
