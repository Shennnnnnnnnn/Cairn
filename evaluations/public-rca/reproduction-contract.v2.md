> 历史记录：本文保留当轮版本、协议、数据和结论，不代表当前 4.9 的接口或性能。当前用法见[文档导航](../../docs/README.zh-CN.md)。

# 可重现数值记录（契约 v2：排重说明澄清）

TASK.md 的目标、证据范围和 answer.json 字段保持不变。为使独立验收能重算定量证据，请另提交 checks.json：至少两项、至多十项，与 answer.json.evidence 的索引对应。不要访问验收器或隐藏标签。

```json
{"checks":[{"evidenceIndex":0,"file":"evidence/container/实际文件.csv","entity":"实际 cmdb_id 或 service","metric":"实际 kpi_name 或服务指标列名","operation":"mean","before":{"start":1,"end":2,"value":0.0},"after":{"start":2,"end":3,"value":0.0}}]}
```

- 上面的时间和值只是格式，不是任务线索。用本次证据中的实际值。
- 时间窗统一为 Unix 秒半开区间 `[start,end)`，start < end，两个窗口不能重叠，before.end <= after.start。
- operation 可用 mean、min、max、rate。前三项对窗口内原始采样值做相应统计；rate 先对整条时序相邻采样计算 `(当前值-前值)/(当前时间-前时间)`，按后一个采样时间落入窗口选择速率，再取均值。遇到计数器下降（可能重置）不能静默略过。
- 累积读写、流量或包计数器使用 rate；使用量、占比、工作集等 gauge 可用 mean/min/max。保留单位与未确认的语义。不能仅凭指标名称认定采集口径；不能确认是否已做差分时，另选口径明确的证据并说明限制。独立验收只复算声明的方法，不自动裁定指标类型或物理单位。
- 每条记录的 file、entity、metric 必须对应 answer.json.evidence[evidenceIndex] 的原始来源。每条 check 必须使用不同的 `(规范化 file, entity, metric)` 源时序；同一时序换 operation 或时间窗仍不能另列一项。两项证据至少来自两条不同源时序。
- 独立复算允许数值约 1% 的舍入误差。验收只证明这些计算与提交物契约，不证明资源类别或根因推断正确。
- 可保存分析脚本、EXPLORATION.md，注明尝试、失败条件、脚本和下一步，便于后续会话接手。
