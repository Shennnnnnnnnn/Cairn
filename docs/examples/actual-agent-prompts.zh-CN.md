# 实际发送给主／子 Agent 的提示词

日期：2026-10-16（Asia/Shanghai）。这是本次提示词优化后的**只读验收**，不是重新构造旧样例的委派记录。

## 原文文件

- [主 Agent 实发正文](prompts/main-agent.actual.zh-CN.txt)：本会话发送给 `/root/prompt_acceptance_main` 的完整任务 message。
- [子 Agent 实发正文](prompts/sub-agent.actual.zh-CN.txt)：主 Agent 在调用前保存、随后原样发送给 `/root/prompt_acceptance_main/independent_fixture_check` 的完整 message。

两份 UTF-8 文件保持实发内容，包括验收用的临时路径、权限和运行入口，不是精简模板。宿主额外提供的系统策略、私有推理及整段会话未导出。共享行为指令仍来自仓库的 [SKILL.md](../../skills/cairn/SKILL.md)；这些实跑记录不会被追加到通用 skill。

| 文件 | SHA-256 |
| --- | --- |
| main-agent.actual.zh-CN.txt | `ad12843522c8fe0f8466347fd963e88b188a1d4173d32479bf6b1be26a0e23f1` |
| sub-agent.actual.zh-CN.txt | `d3c56f5e750e28536a31b0a5c4b61c2d32e797cbf08ce26be6ccf7ecc8500c06` |

## 实际任务与结果

主任务核对合成报价表和请求表，检查八项价格、组合唯一性、顺序和验证范围。子任务只独立核对这两份 fixture，返回结论及依据，不修改文件，也不接管根目标。主 Agent 同时独立检查，再开始复核并接受助手结果。

- Cairn Task：`task_03eba394-1628-4ce8-92aa-41fd1c95b68a`。
- 主会话的十项断言与接受助手结果时的九项交叉检查均通过；两个输入文件哈希未改变。
- A 北／南 100／80，B 125／110，C 150／140，D 175／170；币种 CNY。
- 两表各八条、八个唯一 SKU＋market 组合；请求顺序是 A 北南、B 北南、C 北南、D 北南。
- 每个完整组合仅请求一次，因此不能据此证明缓存重复命中；本次未运行缓存实验。
- 目标已完成，验证条件无缺口；业务分支经历 pending → running → awaiting_review → reviewing → completed。

本次使用真实宿主主／子 Agent 与已构建的 Cairn CLI。验收子任务没有 Cairn MCP 工具及原生 hooks，使用显式 generic MCP 身份的 CLI 入口；Cairn 状态来源因此为 Agent 上报，不宣称原生生命周期覆盖。领域工具调用日志仍为空。

为了核验两份实发正文，本次验收输入指定了一个只读助手；这是测试约束，**不是通用任务的固定助手数量**。原验收工作区是 `/private/tmp/cairn-prompt-acceptance-mlho4z2x`，引用路径只对本机该次运行有效。跨机器使用时应按真实材料、工具接入与权限重新填写任务输入。

## 提示词职责与改进

共享 skill 集中定义目标、依据、即时状态、委派与恢复；参考文档只补充场景、参数和接入差异。工具说明只描述调用规则。动态上下文保存事实和身份，子 Agent hook 只补充角色边界。

本次实际出现的两次 scope_mismatch 被 Core 拒绝，主 Agent 修正后完成。工具说明据此补充：finding.scope 省略时继承任务范围，显式填写时必须覆盖任务范围；不是通过放松校验使测试通过。
