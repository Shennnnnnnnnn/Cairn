> 历史记录：本文保留当轮版本、协议、数据和结论，不代表当前 4.9 的接口或性能。当前用法见[文档导航](../../docs/README.zh-CN.md)。

# Round13 验收记录

- [x] 最新范围：DeepSeek／GLM／Sol，原三题每题三次、native／可选 Scheduler+Cairn，共54次。
- [x] 原模型index0／1／2的案例与arm交错顺序保持Round12一致。
- [x] 原生common／输入／合同／checkers及默认执行argv不改；驱动差异限归档命名、repair-only工具策略／动作审计，以及累计usage异常保留诊断与下界的统计处理。
- [x] HTTP前缀／结构化状态回归覆盖Cloudflare ray ID中的401／403误命中。
- [x] 最终实现359／359 check通过、重建dist后才冻结src／dist／skills及评测协议。
- [x] 当前冻结pipeline八项无模型fixture通过；零新增付费probe，旧probe仅历史。
- [x] 每模型1活跃CLI、三模型并行，实测maxConcurrent=3；没有评测时间／token／调用／探索轮数预算。
- [x] 全54终态和所有错误成本保留，没有选择性补跑或按结果改提示／评分。
- [x] 47份公开REPORT的71片全部完整阅读ACK，7份缺失确认；54条阅读记录封存后才隐藏评分。
- [x] 普通Reason协调续接／参数纠错／故障Conclude分别统计，不把身份匹配称正确恢复。
- [x] 三次真实Pi Bootstrap repair均同session且0工具；Codex实际未触发repair，脚本化fixture覆盖公开动作审计及违规拒收，未声称系统禁工具。
- [x] 同session累计usage与各phase增量和最终原生账本独立对账，0差异；失败请求未上报用量仍标下界。
- [x] 正确率／完成率／错误完成双分母／有效交付／正确合格产物分别报告。
- [x] 全尝试与completed-only耗时／tokens、三次波动和上下文字节分别报告。
- [x] 冻结／输入／全局配置／私有凭据／真实范围偏差审计完成；61个实际CLI临时私有配置均清理。
- [x] 说明服务时窗、重复开发题、非纯消融与Pi无OS隔离等限制。

正式根目录为 `runs/2026-10-18-scheduler-contract-round13-final`，manifest SHA-256 为 `51235c888e5eb3dc0219c5423e4ac32cb51dd5c7ba9b51c420d429c7a11a408d`。最初 `…round13` 只遇到fixture断言错误（首个Reason可以续接Bootstrap）；原失败快照保留，0次付费调用。修正断言后以字节一致的实现、输入及native驱动建立独立final快照，预检与冻结fixture均通过才开始54次。

DeepSeek正确／完成为native 9／9、Cairn 9／9；Sol为native 8／9、Cairn 9／9；GLM为native 4／6、Cairn 3／5（均以9次为分母）。GLM末段7次服务终态失败保留，两组错误完成各2次；独立验收没有因框架完成而默认根因正确。正式未进入Reason／Explore，不能把合成fixture的闭环覆盖写成真实案例效果。

范围审计的231项候选中224项为误报；真实偏差是3个DeepSeek原生actor使用共享 `/tmp`，5次stdout写入及2次rm。所有54次中未观察到同名路径跨actor读写；公开命令和结果一致于读自身重定向，但静态审计无法排除外部进程或动态访问，Pi仍无OS隔离。没有因此剔除样本，也未删除未知临时文件。

最终记录见 [比较报告](comparison-round13.zh-CN.md)、正式根内 `summary.json`、`context-audit.json`、`closeout-audit.v2.json`、`credential-cleanup-review.json` 和 `report-reviews.json`。closeout初版的43只统计Pi launch字段；v2保留原版并补入Codex cleanup路径，经逐路径去重确认61次CLI、61份receipt及61个不同临时配置目录（Pi43／Codex18），均已清理。本验收文档是封存后更新，不替换任何冻结协议、模型产物或原始评分结果。
