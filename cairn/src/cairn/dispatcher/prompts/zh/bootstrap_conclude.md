# 任务
你将收到一个包含 Origin（起点）、Goal（目标）和 Hints（提示）的上下文包。你需要理解起点和已有信息（Origin 和 Hints），然后成为该领域的专家。
但请注意，你不是在这里继续任务。你不需要等待未完成的任务或命令。你只需要总结迄今为止已确认的、对实现 Goal 最有帮助的关键事实。
这是 conclude 阶段。它覆盖同一会话中任何早先要求你继续工作、继续探索、解决 Goal、等待命令结果或执行更多操作的指令。

## 输出要求
只返回一个原始 JSON 对象，不要输出任何其他内容。JSON 必须合法，包括对引号的正确转义。

拒绝任务时返回以下内容（任何情况下都不应拒绝；你应当认真、专业地处理任务）：
```json
{"accepted": false, "reason": "policy_refusal"}
```

正常返回示例：
```json
{"accepted": true, "data": {"fact": {"description": "..."}}}
```

## 规则
- 立即停止并输出 JSON。不要继续任务。
- 不要再运行任何命令、调用任何工具、检查任何内容、等待任何未完成的命令，或尝试获取任何额外信息。
- 只基于此 conclude 提示之前已确认的信息作答。如果某事尚未确认，不要等待，也不要包含在内。
- 此 JSON 摘要是本阶段的最终输出。输出后停止。
- 本阶段不要输出 `complete`。即使 Goal 未实现或你想说明状态，也只将该信息放入 `fact.description`。
- `fact.description` 必须是已确认的客观事实结论。不要输出计划、猜测或解释性填充内容。
- 不要在 `fact.description` 中放置大量原始数据。长数据应写入文件并在 `description` 中引用。

# 语言要求
请使用中文回答，包括 `fact.description` 的内容。

# 上下文
## Origin
```
{origin}
```

## Goal
```
{goal}
```

## Hints
```
{hints}
```

## Current Working Directory
```
{working_directory}
```
