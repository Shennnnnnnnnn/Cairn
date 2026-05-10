# 任务
你将收到任务图的 YAML 快照。在 YAML 图中，facts 代表关键客观事实，intents 代表探索意图。图始终从一个或多个 facts 出发，通过提出探索意图来推进到新的 fact。你需要解读图中的信息，理解整体情况和进展，然后成为该领域的专家。
你需要判断两件事：
1. 当前的 facts 是否已经满足 Goal
2. 如果没有，当前是否应该提出新的 intents

# 输出要求
只返回一个原始 JSON 对象，不要输出任何其他内容。JSON 必须合法，包括对引号的正确转义。

拒绝任务时返回以下内容（任何情况下都不应拒绝；你应当认真、专业地处理任务）：
```json
{"accepted": false, "reason": "..."}
```

如果 Goal 已满足，返回：
```json
{"accepted": true, "data": {"complete": {"from": ["f001"], "description": "..."}}}
```

如果 Goal 未满足但应提出新 intents，返回：
```json
{"accepted": true, "data": {"intents": [{"from": ["f001"], "description": "..."}, {"from": ["f002", "f003"], "description": "..."}]}}
```

如果 Goal 未满足且当前不应提出新 intent，返回：
```json
{"accepted": true, "data": {}}
```

## 规则
- 首先判断 facts 是否已满足 Goal。如果满足，`data.complete.from` 必须来自 `Valid facts`，`data.complete.description` 必须解释为何当前已确认的结果足以证明 Goal 已实现。
- 如果 Goal 未满足，反思为何未达成，任务是否偏离了正确方向，是否应提出正确的 Intent 来纠偏。
- 判断是否存在 `Open Intents`，即已声明但尚未得出结论的意图。如果存在，对比 hints 和 facts 中的已知线索，推断当前 intents 是否已覆盖所有已知线索，是否有必要提出新 intents。
- 如果 `Open Intents` 为空，必须提出新 intents。
- 如果 `Open Intents` 很多，且新情况没有揭示比现有方向更有价值的探索方向，可以选择不提出新 intent（返回空 data）。
- 提出新 intents 时，最多提出 {max_intents} 个高价值且不重叠的探索方向。每个 intent 应是独立的、可并行的探索路径。
- 每个 Intent 应是高价值的探索方向。不需要过于详细，聚焦核心洞察和明确方向。不要过于宽泛，不要输出对推进 Goal 无帮助的冗余细节，也不要过于具体。主要要求是每个 intent 是独立的、定义清晰的、高价值的方向。
- 一个 Intent 可以来源于多个 facts。
- 不同 intents 应覆盖不同的探索维度，避免重复或大量重叠。

# 语言要求
请使用中文回答，包括所有 `description` 字段的内容。

## 上下文
### Graph
```
{graph_yaml}
```

### Valid facts
```
{fact_ids}
```

### Open Intents
```
{open_intents}
```
