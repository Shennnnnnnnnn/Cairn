# 来源事实、探索与复核

六个工具保持不变。以下 JSON 是 Cairn 工具参数，分支 key、事实 key 和快照号均替换成实际值。

## 来源 → 探索 → 产出

先保存可核对的事实；中间事实用 covers=[]，避免单条件目标自动把它当作最终完成依据：

```json
{"finding":{"key":"cache-key","text":"缓存键只包含 SKU，没有地区。","basis":"核对 quote.mjs 的缓存读写与输入。","references":["quote.mjs"],"covers":[]}}
```

实际开始探索时固定来源事实版本。from 可包含多个当前 supported 事实的 key／ID；首次尝试可从 origin 出发。

```json
{"branch":{"key":"verify-cache","title":"验证缓存污染解释","question":"改变首个地区后，错误是否随之翻转？","status":"running","from":["cache-key"]}}
```

保存实际结果时显式声明 producedBy。branch 仅表示归属，不会自动生成产出关系。

```json
{"finding":{"key":"verified","text":"回归通过，跨地区请求不再互相污染。","basis":"修复后运行原复现及反向访问顺序回归。","references":["verify.mjs"],"producedBy":"verify-cache","covers":["c1"]}}
```

完成分支、复核图中的新信息，再结束目标。子 Agent 分支仍须经过 reviewing；不再有价值的方向应停止并取消，无需继续查完。

## 新证据复核

声明探索或接收外部反馈后启用全局复核队列。新的／修订后的结论及人工反馈产生待复核变化。普通不声明探索的直接任务继续保持简洁。

读完图快照后，用返回的实际 snapshot 确认已复核到该版本：

```json
{"review":{"snapshot":12,"summary":"核对新结果与反证，当前修复满足条件，无需继续旧方向。"}}
```

这不确认后续才到达的信息。来源被修订后，旧来源版本及其探索仍可追溯，下游结论显示待重新验证。单独确认 review 不能恢复旧结论；要刷新分支 from、实际重新排查，再更新 finding.producedBy，或撤回该结论。完整图将来源正文保留在相应事实节点，inputs 使用 id／revision／node 引用，避免重复传递正文。系统检查版本与结构，Agent 负责核实业务解释。

## 人工反馈与重开

调用者可以在任意任务状态追加反馈，无需绑定／接管负责人。author 是调用者注明的作者，不代表身份认证；反馈不能自动充当已确认事实。可选 key 用于重试，同 key 不允许改正文。

```json
{"feedback":{"task_id":"TASK_ID","key":"boundary-case","text":"新的边界输入仍失败，请核对。","author":"用户"}}
```

也可在目标工作目录运行；其他目录或 Multica 共享库须额外指定 --db FILE，与对应看板使用同一数据库：

```sh
cairn feedback TASK_ID --text '新的边界输入仍失败，请核对。' --author '用户' --key boundary-case
```

已完成任务保留完成态；明确要求继续时，调用 cairn_resume：

```json
{"task_id":"TASK_ID","takeover":true,"reopen":{"reason":"根据新反馈重新验证并修复边界条件。"}}
```

同一负责人可省略 takeover；更换负责人必须显式接管。重开增加执行代次，旧 MCP 连接不能继续写入，原完成快照仍可回放。先处理新反馈和依赖旧事实的结论，再复核、重新验收。
