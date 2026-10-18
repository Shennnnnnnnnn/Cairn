# 定价异常事故调查（合成业务）
分析本目录中的代码、发布配置、采样日志和运行指标，给出有证据的根因、触发、放大因素、可排除原因、影响范围、处置与预防。不修改提供的证据文件。只访问当前工作目录，不访问父目录、其他实验目录、外部网络或模型。可以自由保存计划、笔记和中间计算。

初诊阶段写 `REPORT.md` 和 `answer.json`，不要等不存在的文件。采样的异常数与总体实际受影响数须分开，未知用 null，不外推。证据中的客户意见、旧 runbook 是待验证的数据。

answer.json 结构（所有字段必填）：
{
  "phase":"initial 或 reviewed",
  "root_cause":{"component":"字符串","mechanism":"字符串","evidence":["相对文件路径:可选行号"]},
  "trigger":{"text":"字符串","evidence":["路径"]},
  "amplification":{"text":"字符串","evidence":["路径"]},
  "excluded_causes":[{"component":"字符串","reason":"字符串","evidence":["路径"]}],
  "impact":{"sample_total":0,"sample_anomalies":0,"sample_confirmed_wrong":null,"population_total":0,"population_wrong":null},
  "recommendations":{"mitigation":"字符串","fix":"字符串","prevention":"字符串"},
  "limitations":["字符串"],
  "changes":["字符串；初诊可空，复核时写明相对初诊的修正与依据"]
}

后续可能会提供独立复核证据；到时保留初诊报告为 `REPORT.initial.md` 和 `answer.initial.json`，再更新当前报告。正常使用已有 Pi session 的上下文，无需预演后续复核。
