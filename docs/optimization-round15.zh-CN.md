# 保留原版探索闭环与可选协调上下文

本轮保持默认五工具 harness 与可选 Scheduler，不增加模型服务、依赖或领域流程。

- 默认协调策略改为 `fresh-full`：Reason 每次新建宿主会话、读取完整公开黑板，贴近原版 Python Cairn。`reuse-delta` 仍可显式选择；两种策略都保留独立 Explore、原会话输出纠错与故障 Conclude。接管或恢复的旧进程退出检查继续生效。
- Explore 输出去掉宿主掌握的必填状态与覆盖：只提交 keyed 发现及可选依据，宿主补 `proposed` 与空覆盖。旧格式仍兼容，显式越权依然拒绝。没有自动把提案升级为证据。
- 字符串 `next` 列表可无损转为换行文本，避免为表达形式重复调用模型；非文本元素、空项和合并后超长值不被截断或猜测。
- 完成与新 Intent 互斥，矛盾结果在任何 checkpoint 写入前拒绝。Reason 明确围绕原目标检查漂移、矛盾及有区分力的证据缺口；已有探索可以覆盖缺口，避免重复分支。
- Bootstrap 可直接完成；未新增强制完成复核。来源、时间、单位、对象范围及缺测继续使用可选 basis/references，不新增排障字段或领域必填项。

CLI 使用 `cairn run TASK_ID ... --coordinator-mode fresh-full|reuse-delta`，SDK 使用 `SchedulerOptions.coordinatorMode`。输出纠错仍恢复原来那一次阶段的宿主会话，与普通 Reason 是否复用分开。

完整检查366/366通过，新增测试先复现旧版本缺失行为后修复。六个新版 pipeline 夹具覆盖两种协调策略的直接完成、Reason→Explore→Reason、同会话参数纠错及产物修复；两个实际 Python 运行时夹具覆盖原版直接完成与 Bootstrap→Conclude→Reason→Explore→Reason。全部为零模型测试，不作准确率证据。

正式比较：DeepSeek/high，原三道开发题每题每组三次，原生 Pi、原版 Python Cairn、新版 fresh-full、新版 reuse-delta 四组共36次。相同模型与输入，无评测运行预算；原版为私有传输与禁用阶段截止时间的公开适配，未改源码，但关闭超时也去掉一个常见阶段切换触发器。详细规则见 [Round15运行前协议](../evaluations/public-rca/protocol-round15.zh-CN.md)。若真实样本未触发普通 Reason，就不能据 Bootstrap 的随机差异推断协调策略优劣。

实测四组正确与完成都是9/9、错误完成都是0/9。新版完整图已记录tokens比原生少23.9%、比原版少41.9%，耗时中位与两者差异均约3%以内。原生有1份产物合同失配，其余三组全部验收通过。完整图与原版全部Bootstrap直接完成，增量图仅1次普通Reason修复引用路径；没有真实Explore、故障Conclude或参数纠错，不能从这批数据判定两种协调上下文谁更好。每题3次与报告正文错误仍限制结论。详见[Round15实测报告](../evaluations/public-rca/comparison-round15.zh-CN.md)。
