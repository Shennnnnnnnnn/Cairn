# 图上下文读取协议

共享 SKILL.md 定义何时读取和怎样使用图。本文件补充调用参数。图包含全部已存语义节点与关系，不包含布局、原始工具输入／输出或私有会话。

## 读取完整快照

```json
{"view":"graph"}
```

未绑定的助手可指定 task_id 只读查询，无需调用 start／resume。普通上下文的 graph.read 已提供准确参数。

小图直接返回 data，complete=true。大图返回 JSON 文本 chunk、snapshot、checksum、offset、nextOffset；继续时保留原参数并带上返回的 snapshot、checksum 和 nextOffset 作为新 offset，直到 nextOffset 缺失。拼接全部 chunk 后解析 JSON，并按 UTF-8 校验 SHA-256。offset/limit 以字符位置计，bytes 另行给出。

snapshot 是该任务的历史事件序号，不是修订号。新证据到来或跨 CLI 接管不会改变已选快照。隐私模式或投影版本改变导致校验值变化时，读取会拒绝混合页面，应重新获取 context 引用或从 offset=0 发起不带旧 checksum 的新查询。checksum 绑定本次 view／ref／format／since 选项，改变选项时也应开始新的查询。

## 全局索引与相关子图

format=index 保留全部节点标识、状态和关系，省略节点正文；它用于定位，不替代读取实际证据。ref 可选图节点 ID（如 branch:logs、claim:实际ID、criterion:c1）或无歧义分支 key。相关子图保留证据连通部分、关联的其他假设、分支祖先及人工提示；它明确说明全局中有多少节点／关系未被选择。

```json
{"view":"graph","ref":"branch:logs"}
```

## 委派包

```json
{"view":"handoff","ref":"branch:logs","question":"哪些证据支持或反驳这一解释？"}
```

返回任务边界、根目标与条件、约束、相关子图和全图读取引用。该包按相同快照协议分页。它不启动助手、不转移主目标负责人、不证明任何文件内容或结论为真。

## 增量

since 指定已读的旧快照；snapshot 可指定本次目标快照。省略 snapshot 时第一次读取选定当前快照，其后分页仍固定版本。

```json
{"view":"graph","since":10,"snapshot":15}
```

返回 added／updated／removed 节点及 addedEdges／removedEdges，并带上最新全局元数据。示例序号必须替换成同一任务真实存在的快照。ref 同时存在时，增量仅表示该相关子图投影的变化；移出子图不代表全局删除。
