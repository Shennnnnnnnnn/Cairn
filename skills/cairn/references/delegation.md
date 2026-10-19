# 分支参数与宿主接入

委派决策、即时保存、复核和恢复规则以共享 SKILL.md 为准。本文件仅补充分支字段、调用示例和宿主覆盖差异。

默认先在主会话推进，独立问题有明确收益时才委派。语义分支不等于新原生会话；可用 executor=main 记录主会话探索。自动 Scheduler 新任务默认 single，显式 session-mode multi 才允许独立 Explore。

## 创建与更新分支

一次 `cairn_update` 创建一个方向。以下为参数示例，使用实际问题和材料替换内容：

```json
{"branch":{"key":"logs","title":"核对超时日志","executor":"subagent","assignee":"日志助手","status":"pending","question":"超时集中在哪个环节？","rationale":"日志可独立核对，与主会话的配置复现互补。"}}
```

已有分支以 key 更新，title 可省略。例如开始审阅已返回的结果：

```json
{"branch":{"key":"logs","status":"reviewing"}}
```

## 字段约定

| 字段 | 约定 |
| --- | --- |
| key、title、status | 稳定标识、名称和当前业务状态；新分支需要 title |
| executor、assignee | main／subagent，以及可读名称或宿主路由地址 |
| parent | 当前任务内的父分支 key；表示归属，null 清除，不表示因果或执行依赖 |
| question、rationale | 有界排查问题与简短选择原因 |
| agentId | 可选确切原生执行 ID；null 清除；不知道时省略 |
| summary | completed／cancelled 必填：实际结果或停止理由 |

业务状态为 pending、running、awaiting_review、reviewing、completed、blocked、cancelled。分支必须属于当前目标，父关系不能成环。同一执行身份不能同时绑定多个未关闭分支；可用 parent 表达同一调查的子问题。finding 和 progress 的 branch 字段引用这个 key。

## 身份与来源

宿主路由名可能是 `/root/logs`，原生 hook 身份可能是 UUID。它们不一定相同。未建立确切关联时，原生会话与语义分支分别展示；不通过名字、数量或时间接近猜测映射。分支记录本身不证明进程已经启动。

## 宿主覆盖

| 宿主 | 接入方式与覆盖 |
| --- | --- |
| Codex／Claude 原生适配 | hooks 保存实际子会话生命周期；未关联的执行独立展示；返回定位到原目标、负责人和代次 |
| Pi | 使用环境实际具备的委派扩展；没有可靠原生事件时通过单项状态更新保存业务状态 |
| 仅 MCP／Multica | 提供共享领域工具和 skill；不自动安装原生 hooks，也不增加宿主原本没有的委派能力 |

未知返回和旧负责人事件不能推断一个新目标。接管后，先核对已保存的分支和执行记录；它们不保证旧助手仍存活。原生能力以 doctor 和实际观测为准。
