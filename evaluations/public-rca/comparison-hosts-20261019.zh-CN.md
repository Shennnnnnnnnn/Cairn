# Pi / Claude Code / DSH × Cairn：DeepSeek Flash 实测（2026-10-19）

本轮使用同一模型路由 `global:deepseek-v4.1-flash`，比较三个原生宿主接入 Cairn 六工具后的实际行为。每个宿主使用此前三道公开题各跑一次，共 9 次正式执行，不设置任务执行预算。不是每题多次重复试验，不能据此判断长期稳定性。

结论：**本轮优先选择 Pi，DSH 的速度与记录 token 最优，Claude 的诊断命中良好但任务触发存在缺口。**

## 结果

正确要求首选对象、定位层级、资源类别三项联合命中，沿用此前三题冻结评分器。报告交付指平台实际存在原报告与附件，且回读与本地文件哈希一致；Cairn 闭环还要求同一原生会话的目标已完成。错误完成按已交付报告但严格诊断未命中统计，分母为各宿主 3 题。

| 宿主 | 固定版本 | 报告交付 | Cairn 闭环 | 严格正确 | 错误完成 | 平均耗时 | 平均主会话 tokens |
|---|---|---:|---:|---:|---:|---:|---:|
| Pi | 1.3.0 | 3/3 | 3/3 | 3/3 | 0/3 | 263.3s | 2,512,382 |
| Claude Code | 2.1.302 | 3/3 | 2/3 | 3/3 | 0/3 | 331.7s | 2,770,201 |
| DSH | 0.2.1-rc.2 | 3/3 | 3/3 | 2/3 | 1/3 | 215.3s | 2,214,701 |

- **Pi**：三题诊断与目标闭环均完成，耗时低于 Claude，本轮自动交付的综合选择最好。
- **DSH**：平均 215.3 秒、主会话 2.215M tokens，均为本轮最低。I/O 题选择了正确的 shippingservice / service / disk_io，但把副本说明拼进 `location`，原样精确评分未命中；这次不能描述成故障方向判断相反。
- **Claude**：三题答案命中，平均 331.7 秒、2.770M tokens。CPU 题只走取证与报告交付，未调用 `cairn_start`，因此报告完成而 Cairn 闭环未完成。真实会话中共享 skill 存在、工具可用，未见上下文丢失或工具参数重试；这次是未进入约定工作流。

## 逐题记录

| 题目 | 宿主 | 严格命中 | Cairn 闭环 | 耗时 | 主会话 tokens | Issue |
|---|---|---|---|---:|---:|---|
| new-01 | Pi | 是 | 完成 | 340s | 2,602,225 | [SHEN-11](https://multica.myhexin.com/shenbaojie/issues/01a15084-703a-7562-87f6-243c6d82fc3a) |
| new-01 | Claude Code | 是 | 完成 | 330s | 2,456,340 | [SHEN-20](https://multica.myhexin.com/shenbaojie/issues/01a1509a-cd69-70ca-9c8d-875a4af223d0) |
| new-01 | DSH | 否 | 完成 | 259s | 2,168,500 | [SHEN-17](https://multica.myhexin.com/shenbaojie/issues/01a15084-792d-7478-ad96-48718a82b8e6) |
| new-02 | Pi | 是 | 完成 | 181s | 2,366,551 | [SHEN-12](https://multica.myhexin.com/shenbaojie/issues/01a15084-71fd-7ee6-951e-3c67f651ba05) |
| new-02 | Claude Code | 是 | 未创建目标 | 334s | 3,881,452 | [SHEN-21](https://multica.myhexin.com/shenbaojie/issues/01a1509a-e484-7126-92e8-ba667ce825c5) |
| new-02 | DSH | 是 | 完成 | 182s | 2,761,796 | [SHEN-18](https://multica.myhexin.com/shenbaojie/issues/01a15084-7adc-7e20-bc10-487634911dda) |
| new-03 | Pi | 是 | 完成 | 269s | 2,568,370 | [SHEN-13](https://multica.myhexin.com/shenbaojie/issues/01a15084-7384-743e-b995-aa8a8bb7b2d5) |
| new-03 | Claude Code | 是 | 完成 | 331s | 1,972,811 | [SHEN-16](https://multica.myhexin.com/shenbaojie/issues/01a15084-7805-7522-820d-1a4589587307) |
| new-03 | DSH | 是 | 完成 | 205s | 1,713,808 | [SHEN-19](https://multica.myhexin.com/shenbaojie/issues/01a15084-7d02-783a-97f6-f5a985b50c01) |

## 配置与统计边界

- 三个宿主共享同一 CC Switch 模型来源与凭据；Pi、DSH 使用 Chat Completions。该凭据组拒绝 `/v1/messages`，Claude 经 CC Switch 本机路由转换为 Chat Completions，预检实际返回 `deepseek-v4.1-flash`。禁止用别的模型替代后仍称同模型。
- Pi 1.3.0、Claude Code 2.1.302、DSH 0.2.1-rc.2，平台 CLI/daemon 为 Multica 0.6.3。DSH 为 RC；平台桥采用官方仓库固定提交 `e29aae228449dfe50e88af60ef4281e38ca44e2a`。
- 同一份 777 字系统提示词、同一份任务正文与原始指标。各题 57 CSV，三题共 171 CSV；同题输入摘要跨宿主一致，原始工作区未改。Issue 正文不含框架说明。执行目录、原生会话、证据查询账本与交付文件分别隔离；未读取共享黑板任务列表或其他任务 ID。
- 每题预算为空，daemon `agent-timeout=0`。宿主自身的网络超时、重试和模型单次输出能力配置仍是原生行为。宿主默认提示词、工具协议、查询选择与 Claude 转换链路均包含在这次端到端比较中。
- Pi 与 DSH 的思考选项显式为 off，Claude 使用其原生默认路径及 CC Switch 转换；未宣称三个宿主的解码参数完全等价。本轮反映实际集成效果。
- tokens 来自对应完整原生主会话的数字记录，按响应去重。输入包含缓存读取/写入，输出不重复加推理。token 累计量不等于独立上下文长度，也不等于金额。Claude 使用完整会话账本，避免仅统计目标创建后的 hook 增量。
- DSH 的 zstd 会话按全部追加 frame 解码，其主会话与黑板数值对账一致。会话标题生成留下调用记录但没有用量，所以其整次宿主费用只知道下界；表中仅列主会话，未把辅助调用当作零成本。
- 严格诊断标签不评每一句因果解释、单位换算或处置建议的正确性；产物验收也不证明诊断正确。

## 接入修复与长期智能体

- Claude 复用原有插件与 hooks，修复最新版对顶层组合 schema 的过滤，并先设置 SQLite 等锁超时再启用 WAL。MCP 中显式登记六工具，隔离全局无关服务。
- DSH 以原生 Cordis/session/tool 接口复用六工具、增量事实、完成和恢复逻辑；使用真实会话、每 agent 独立工具目录、原生数值用量，没有新增模型调度循环或题目规则。
- Multica 已创建「Cairn 排障助手 · Claude」与「Cairn 排障助手 · DSH」，并保留原 Pi 助手。业务目录为 `/Users/shen/Documents/1028-emergency-pk`，每个 Issue 仍由平台提供独立执行目录。
- 长期配置已去掉三题绑定与离线专用查询器；统一为通用材料读取、文件范围控制和原文件交付/回读。系统提示词 785 字，明确调查前创建目标；可选的智能体业务工具入口检查实际会话已绑定活动目标，目标仍由模型调用创建。框架默认保持按需启用。
- 四次配置联调尝试单列：DSH 两次继承 SOCKS 代理而未拿到模型结果；Claude 一次缺少六工具、一次仍暴露无关 MCP。后两次换新 Issue 重跑以避免旧报告进入提示词。正式九次诊断未因答错而选择性重跑。

CC Switch 的代理账本与 Claude 原生记录在缓存计数上有差异；已单独保存核对结果。主表统一使用原生主会话口径，不据此换算完整账单。

完整记录见 [comparison-hosts-20261019.json](comparison-hosts-20261019.json)。九次原报告与附件保留在对应 Issue，原始会话与私有配置留在执行机器。

长期配置额外通用验收：`passed`，3/3。此验收不计入上面的排障准确率、耗时与 tokens。

后续补测：[Codex + GPT-6.1-Sol 极高对照](comparison-codex-host-20261019.zh-CN.md)，沿用本轮三题各一次。
