# Pi 与 Pi+Cairn 本地对比

这是两份人工编写的离线案例，使用本机真实模型执行，不是模型输出 fixture。所有业务数据均为合成数据。

验收范围：

- [x] 生成两份可独立运行的案例及独立评分器。
- [x] 每份分别执行原生 Pi、Pi+Cairn，共四个实验单元；诊断案例各包含相同的初诊和复核两个阶段。
- [x] 同模型、同推理级别、同原生工具、同输入文件、同任务提示、同时间上限；仅 Cairn 组加载当前项目的扩展与 skill，并收到必要的启用说明。
- [x] 保存提示、原始 JSONL、原生 session、产物、评估结果和 Cairn 状态，不保存模型凭据。
- [x] 比较独立质量检查、耗时、provider 返回的 token 用量、工具调用及可观测性；不把 Cairn 自报完成作为质量评分。
- [x] 输出中文对比报告，明确单次小样本与测试边界。

案例一：修复租户隔离、重试幂等和租约过期语义的本地投递队列。模型可以运行公开测试；评分器在工作目录之外执行额外断言。

案例二：分析合成服务事故，区分触发、放大、健康干扰和影响范围。初诊后交付新的复核数据，要求修正结论并保存变化。两组都使用各自原来的 Pi session 继续，原生 Pi 也可以自由写笔记，不人为清空它的上下文。

`prepare.py` 确定性生成输入；`run.mjs` 执行真实 Pi；`grade.py` 独立评分。评分代码和第二阶段数据不放进初始工作目录，模型被明确要求只访问自己的工作目录。该边界是运行协议，不是操作系统沙箱。

`runs/` 保存本地实验记录，不加入 Git。`comparison.zh-CN.md` 汇总本次实际结果。凭据只在权限为 0700 的临时 Pi 配置目录中使用，不进入案例或记录。

## 重跑

需要 Node.js >=24、Python 3，以及已安装、已配置可用模型的 Pi。不会更改全局 Pi 配置；运行器只复制 `auth.json`、`models.json` 和必要模型设置到权限为 0700 的临时目录，完成后删除复制件。运行会使用当前模型连接并消耗其额度。

```sh
python3 evaluations/pi-ab/prepare.py
node evaluations/pi-ab/run.mjs \
  --agent-dir /Users/shen/.pi/agent \
  --pi-cli /opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js \
  --provider sub2api-copy-copy --model kimi-k3 \
  --run-id another-run
python3 evaluations/pi-ab/summarize.py another-run
python3 evaluations/pi-ab/audit.py another-run
```

路径和 provider/model 参数替换为本机实际值；当前运行器通过复制的 models.json 自定义模型定义设置回复上限，替换为其他模型时需要对应的受控定义。先构建 Cairn（`npm run build`），让 `dist/pi-extension.mjs` 与待评估源码一致。运行器对已存在的 run-id 报错，不覆盖记录。每个实验从独立副本开始；代码案例 480 秒，诊断初诊 480 秒、复核 240 秒；每阶段输出 token 上限 24,000（按整条回复结束时检查），每条模型回复上限 8,192。四个实验串行，顺序为代码 Pi→Pi+Cairn、诊断 Pi+Cairn→Pi。

## 文件和评分边界

- `cases/`：模型能看到的初始材料，不含正确答案。
- `review-input/`：仅在诊断初诊退出后复制到各自工作目录的 `review/`。
- `prompts/`：共用业务提示。Cairn 组额外收到启用、检查点、完成和复核重开说明；通过显式路径加载当前扩展和 skill，其他扩展、MCP、上下文自动发现均关闭。
- `grade.py`：代码案例 27 项检查（24 项行为检查与公开测试保留、新增回归测试、报告存在）；诊断初诊 19 项、复核 22 项结构、数字、证据路径和关键语义检查。异常身份参数接受 ValueError 或 TypeError，因为契约没有规定异常类。诊断初诊的 sample_confirmed_wrong 接受保守的 null，或依据配置价目表推导的 10；不要求模型忽略已给配置，也不接受将 12 条异常直接视为已确认错价。
- `runs/<id>/<case>/<mode>/`：各阶段 prompt、JSONL、stderr、metrics、tools、独立 grade、原生 session 与 workspace；Cairn 组还保留 SQLite、任务快照、事件和独立 HTML。

诊断语义检查含关键词规则，代码检查只覆盖列明的行为；分数不能代表全部业务正确性。报告还需人工比对产物与引用。模型生成的回归测试数表示覆盖投入，不代表测试质量；独立断言仍可能漏掉其他边界。总 token 为 provider 报告的逐次请求总量，含反复读入和缓存，不等于新增文本 token。外部硬中断可能留下未结束的模型回复，其最终 usage 不可得，汇总将此类记录标为下界。未配置价格时返回的零费用不能解释为免费。

这两份案例没有模拟强制压缩、崩溃恢复、跨宿主接管、多人分支协作或大规模并发。诊断复核沿用原生 session，避免人为削弱 Pi 自有的历史恢复能力。不能据此推断这些未测场景的效果。
