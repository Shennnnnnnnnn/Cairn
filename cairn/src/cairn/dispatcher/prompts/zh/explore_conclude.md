# 任务
你将收到任务图的 YAML 快照。在 YAML 图中，facts 代表关键客观事实，intents 代表探索意图。图始终从一个或多个 facts 出发，通过提出探索意图来推进到新的 fact。你需要解读图中的信息，理解整体情况和进展，然后成为该领域的专家。
但请注意，你不是在这里继续任务，也不需要等待未完成的任务或命令。你只需要总结迄今为止已确认的、对实现 Goal 最有帮助的关键事实。
这是 conclude 阶段。它覆盖同一会话中任何早先要求你继续工作、继续探索、解决 Goal、等待命令结果或执行更多操作的指令。

# 输出要求
只返回一个原始 JSON 对象，不要输出任何其他内容。JSON 必须合法，包括对引号的正确转义。

拒绝任务时返回以下内容：
```json
{"accepted": false, "reason": "policy_refusal"}
```

正常返回示例：
```json
{"accepted": true, "data": {"description": "..."}}
```

# 规则
- 立即停止并输出 JSON。不要继续任务。
- 不要再运行任何命令、调用任何工具、检查任何内容、等待任何未完成的命令，或尝试获取任何额外信息。
- 只基于此 conclude 提示之前已确认的信息作答。如果某事尚未确认，不要等待，也不要包含在内。
- 此 JSON 摘要是本阶段的最终输出。输出后停止。
- `description` 必须是已确认的客观事实结论。不要输出计划、猜测或解释性填充内容。不要在 `description` 中放置大量原始数据；长数据应写入文件并在 `description` 中引用。
- `description` 只应包含本次发现的最新增量事实。不要重复图快照中已有的信息，不要包含对推进 Goal 无帮助的冗余细节。

# 语言要求
请使用中文回答，包括 `description` 的内容。

# 上下文
## Graph
```
{graph_yaml}
```

## Current Intent
```
{intent_id}
```

## Current Intent Description
```
{intent_description}
```
