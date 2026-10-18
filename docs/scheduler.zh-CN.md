# 可选的宿主调度层

Cairn 的六工具 harness 默认继续由当前宿主会话推进。只有显式运行 `cairn run` 或创建 SDK `Scheduler`，才启用自动 Bootstrap／Reason／Explore 闭环。当前调度器支持 `curated` 任务（不需要 profile 参数），不要求排障数据、固定工具或特定领域的结论格式。

调度器读取 SQLite 黑板，决定何时请求新的宿主阶段，并保存返回的事实、提案、完成条件和原生会话定位信息。模型调用、账号、工具能力、审批和原生会话仍由 Pi／Codex 执行；Cairn 不保存模型 API 凭据，也不直接请求模型 API。现有 `cairn_start` 等六个工具名称和普通接入方式不变。

## CLI 使用

需要 Node.js 24 或更新版本，并已配置可独立运行的 Pi 或 Codex CLI。默认通过 `PATH` 查找 `pi`／`codex`，不自动安装宿主或修改全局模型设置。

```sh
# 终端一：可选看板，使用当前工作区数据库。
cairn serve
```

```sh
# 终端二：先保存目标，再使用返回的实际 TASK_ID。
cairn submit --title "核对项目清单" \
  --origin "项目文件位于当前工作区" \
  --goal "确认项目名称与运行要求，并给出来源" \
  --criterion "项目名称有明确来源" \
  --criterion "运行要求有明确来源"

cairn run TASK_ID --executor pi \
  --model global:deepseek-v4.1-flash --effort high \
  --parallel 2 --start-mode auto --takeover

cairn status TASK_ID
cairn graph TASK_ID --format timeline
```

也可以选择 Codex：

```sh
cairn run TASK_ID --executor codex \
  --model gpt-6.1-sol --effort xhigh --parallel 2 --takeover
```

`submit` 先持久化目标，尚未启动模型。`run` 创建独立的通用 MCP 协调身份；已有任务属于其他会话时，必须显式 `--takeover`。可用 `--session-id ID` 指定协调身份；这个 ID 不冒充 Pi／Codex 的原生会话 ID。接管遵守既有 owner epoch 和租约检查。

`--parallel` 为 1–32，默认 1，限制同时执行的探索分支数量。它是进程资源并发设置，不是工具调用、token、费用或总运行时间预算。单次 Bootstrap／Reason 与一批 Explore 交替执行，不额外维持空转的模型会话。

`--model` 始终原样交给宿主解析，模型 ID 中的冒号不会被 Cairn 拆成 provider。例如 `global:deepseek-v4.1-flash` 可以是某个已配置 Pi provider 下的完整模型 ID。需要消除 Pi 中的 provider 歧义时，另加 `--provider YOUR_PI_PROVIDER`；SDK 对应 `CliHostOptions.provider`。该参数仅支持 Pi，不改变模型 ID；Codex 不接受此 Pi 专用参数。provider 的实际名称以宿主配置为准。

原生宿主的权限设置继续生效。Pi 的工具执行权限和项目加载策略由 Pi 配置；Codex 的 sandbox、审批和 hook 信任由 Codex 配置。适配器不添加绕过审批、sandbox 或 hook 信任的参数。Pi 阶段排除 `cairn_*` 工具，避免模型同时操作调度器内部状态；阶段提示要求使用宿主工具完成工作并返回结果。

可通过 `--db FILE`、`--root DIR` 指定数据库和工作区，`--log-dir DIR` 指定调度审计目录。需要自定义宿主启动方式时，用可信的 `--executor-command PATH` 与可重复的 `--executor-arg ARG` 设置可执行文件和 argv 前缀；参数通过 `spawn` 传递，不解释为 shell 命令。

## 启动策略

`--start-mode` 与协调上下文策略 `--coordinator-mode` 独立。SDK 对应 `SchedulerOptions.startMode`，默认 `auto`。

| 启动策略 | 首次执行 | 适用情况 |
|---|---|---|
| `auto` | 有已存工作先 Reason，否则 Bootstrap | 默认按公开黑板选择入口 |
| `bootstrap-first` | Bootstrap 先直接尝试原始目标 | 明确需要从目标直接执行，保留原版首轮策略 |
| `reason-first` | Reason 先审核现状与证据缺口 | 希望先确定探索方向，或已有工作需要复核 |

`auto` 在启动宿主前检查已保存的发现、观测、行动、未取消的进展、开放问题、下一步及产物/报告。有这些工作就先审阅，避免重新摸索；只有目标、约束、人工提示或产物要求的新任务先直接尝试。它不按领域关键词、目标字数或题目答案猜难度，也不额外调用模型做选路。真正的解题方向仍由首个宿主阶段依据目标和证据自主决定：Bootstrap 可以提交探索 Intent，Reason 也可以在依据充分时直接验收完成。Reason-first 不强制创建分支，也不保证更快或更准确。

选择会在任何阶段派发前保存为 `scheduler.start_selected`，包含请求模式、实际入口和原因；`status` 返回 `scheduler.start`，看板与 timeline 显示“选择启动方式”。它是调度元数据，不是新事实，不授予完成覆盖。

启动策略只决定首次进入。暂停恢复、重新接管或再次 `run` 会保留已保存的选择与进度，先处理在途阶段；更换参数不会重跑已执行的 Bootstrap，也不能绕过原生进程退出检查。旧任务没有选择记录时保留既有恢复语义，不伪造历史入口。需要对两种入口做实验，应创建输入相同的新任务，不能把重跑同一个已执行任务当成消融。

此选项是在 Round15 封存之后新增；此前模型成绩没有比较 Bootstrap-first 与 Reason-first，也没有覆盖本次新增的自动选路。当前回归只验证执行路径、状态恢复与验收，不能据此声称准确率或耗时改善。

## 自动闭环保存什么

1. **入口选择** 按 `start-mode` 决定先直接执行还是先审核。进入 **Bootstrap** 时先尝试原始目标；能完成的任务提交有依据的事实后直接验收，否则保存事实与缺口，再进入 Reason。
2. **Reason** 读取已保存的黑板、提示、提案和验收缺口，审核已有发现，并生成有区分力的探索 Intent。事实或提示发生有效变化时会重新审核；心跳时间变化不会单独触发推理。
3. **Explore** 在宿主原生会话中执行一个明确 Intent。不同分支使用协调身份和租约隔离，只能提交 `proposed` 发现，不能给主目标授予覆盖或宣布完成。
4. **审核与回写** 将提交的分支提案合入主黑板，但不自动提升为 `supported`。Reason 必须按完整 key 更新发现，给出依据、引用与明确的 criterion coverage。
5. **完成验收** 走现有 `engine.finishVerified(...)`，检查已保存事实和覆盖、要求的产物及可选宿主验证器。未通过时反馈缺口，继续探索或挂起。

保存的是 keyed findings 的真实增量、开放问题、后续动作、产物和交接，而不是用摘要替代结果。语义相同的 Intent 会去重；同一个 key 不能悄悄换成另一条探索方向。只修饰摘要、重复同一条完成请求或刷新租约，不构成有效进展。

阶段输出的字段、数组上限和文本长度由同一份 schema 生成紧凑提示并执行校验，避免提示遗漏实际限制。支持原始 JSON 或包住完整结果的一层 JSON 代码围栏；不从解释性文字中猜测结果。不合法的 Intent 会在提交前被拒绝；owner 的事实、计划、产物与阶段交接通过同一次 checkpoint 保存，避免格式失败留下部分覆盖。

默认 `--coordinator-mode fresh-full` 与原版一致：每次 Reason 新建宿主会话并发送完整公开黑板。它不继承 Bootstrap 的原生对话；完整图保留已保存的发现、来源、Intent 和提示。新会话不等于独立正确性证明，未保存的原生上下文也不会自动进入黑板。

可选 `--coordinator-mode reuse-delta` 在同一次 `run` 内复用已确认退出的协调会话。首次输入完整黑板，后续发送发生变化的记录、删除记录 ID，以及始终保留的目标、约束和完成条件。增量附带不可变完整快照路径及 SHA-256；历史压缩后应读取完整快照。创建快照失败或使用内存数据库时回退完整输入。游标仅记录实际派发的输入，接管或重启后重建完整输入。快照位于 `.cairn/scheduler-context/`，遵循工作区数据生命周期。Explore 在两种模式中都使用独立会话。

阶段输出继续只保存必要增量。Explore 只需返回 keyed findings 的文字与可选依据，宿主赋予 `proposed` 和空覆盖；显式越权的状态或覆盖仍被拒绝。`next` 字符串列表可以无损转为换行文本，非字符串和超长值仍拒绝。完成与新 Intent 互斥，避免一边宣布完成一边登记必需探索。来源、对象范围、时间、单位与缺测说明继续保存在可选的 `basis` 和 `references` 中；没有新增领域必填字段。

Bootstrap 保留直接完成路径，不增加强制模型复核。Reason 围绕原目标判断现有事实是否足够，只对明确矛盾、未满足条件或有区分力的证据缺口提出探索，不因存在与目标无关的未知项而强制开分支。已有验收器的检查范围保持独立，框架不会自动把检查通过解释为语义正确。

过时 Reason 的判断比较持久黑板和已保存验收状态，不把本阶段对产物的预期写入当作外部提示变化。重复完成守卫比较实际产物版本，因此仅修好宿主要求的文件后，可以用简短完成结果重新验收。文件变化不会自动刷新旧 finding 的引用依据；绑定旧版本的事实仍需明确复核后重新保存。

任务完成、产物验收和独立正确性是三个不同维度。模型提供 `basis`／`references` 并标记 `supported`，表示它已提交可复查的依据；这不构成独立正确性证明。`finishVerified` 的 pass 也只证明所配置验证器实际检查的范围。需要结论准确率时，仍应使用独立标签、测试或人工审核。

## 停止与恢复边界

调度器不设置固定轮数、token、工具调用数或总耗时预算，但仍会保存缺口并停止无进展的循环：没有新事实和可执行 Intent、宿主明确报告无法继续，或宿主／协议错误无法恢复时，不会把任务计为完成。失败的探索方向保留为阻塞记录，交由后续 Reason 审核；不会盲目重复外部操作。宿主自身的服务错误、上下文限制和账号限制仍然可能终止一次执行。

阶段结果沿用 checkpoint 的长度与依据约束。产物文件已经有效，并不保证阶段结果一定通过格式、schema 或事实依据校验。Round12 实测分别出现了最终输出不是原始 JSON、`references` 超过 8 项、`supported/refuted` 发现缺少依据的问题，详见 [Round12 实测报告](../evaluations/public-rca/comparison-round12.zh-CN.md)。现在这些阶段输出错误会携带简短字段路径反馈，恢复同一原生会话纠正最终 JSON；不会自动截断引用、补造依据或提升分支覆盖。

纠错只修改已取得结果的表达，不重新探索。Pi 使用 `--no-tools` 和最终 `--exclude-tools '*'` 禁用工具；Codex 由公开事件保守审计原生动作，发现动作或无法确认零动作则拒绝该候选。Codex 的此项机制是执行后拒绝，不能阻止已经发生的动作；started／updated／completed 按动作 ID 去重，无 ID 时保守计数。自定义宿主同样必须如实提供 `metrics.toolCalls: 0`，缺测不能当作零。服务、权限、取消和过期 owner 错误不作为格式纠错。每次调用有独立审计 ID，并保留原始阶段 ID、纠错次数、问题、耗时和 usage；相同字段错误签名再次出现即停止，防止交替错误循环。这是语义终止条件，不是固定调用预算。

支持的恢复方式是 **conclude 同一个原生会话**。Pi 的 session 文件路径、Codex 的 thread ID 在可用时立即保存。Bootstrap／Explore 失败或调度器恢复在途阶段时，可以请求该会话停止探索、整理已经取得的结果。本地适配器使用私有 registry 记录原生 PID、进程组与关闭状态；恢复前必须确认原进程组已退出。未知会话、PID 缺失、权限不足以检查或原进程仍存活时会拒绝恢复，不对未知 PID 发出终止信号。只有本适配器登记的会话可通过这个路径恢复。没有会话定位信息、Pi 原文件丢失、Codex 会话不可恢复或宿主继续报错时，会保留缺口；不会启动新会话并声称找回了未保存上下文。

租约和 owner epoch 用于阻止重复 dispatcher 与过时代次的结果写入。它们不证明旧进程仍在运行，也不能保证进程崩溃前所有工具结果都已保存。正常收到中断信号时，CLI 将取消信号传播给宿主进程组；这不构成外部进程监督或任意硬终止场景的恢复保证。已完成 checkpoint 留在 SQLite，未返回的宿主事实仍可能缺失。

## SDK 接入与回调

SDK 允许复用已有宿主执行能力，也提供 `createHostExecutor` 本地 CLI 适配。下面为 TypeScript 示例；运行它会使用已配置宿主调用模型。

```ts
import {
  Engine, Store, Scheduler, createHostExecutor,
  type HostExecutor, type Session,
} from 'cairn';

const cwd = process.cwd();
const store = new Store(`${cwd}/.cairn/state.db`);
const engine = new Engine(store);
const owner: Session = {
  host: 'mcp', sessionId: 'example-scheduler', cwd,
};
const task = engine.create(owner, {
  origin: '项目文件位于当前工作区',
  goal: '确认项目名称与来源',
  criteria: ['项目名称有明确来源'],
  evidenceMode: 'curated',
});
const native = createHostExecutor({
  executor: 'pi', model: 'global:deepseek-v4.1-flash', effort: 'high',
});
const executor: HostExecutor = {
  canResume: (sessionRef, cwd) => native.canResume?.(sessionRef, cwd) ?? false,
  async execute(request, signal) {
    const result = await native.execute({
      ...request,
      onSession(sessionRef) {
        // 必须保留调度器回调，使原生定位信息尽早落盘。
        request.onSession?.(sessionRef);
        process.stderr.write(`native session: ${sessionRef}\n`);
      },
    }, signal);
    // 可将公开的 usage／耗时送入宿主可观测系统。
    if (result.metrics) process.stderr.write(`${JSON.stringify(result.metrics)}\n`);
    return result;
  },
};

try {
  const result = await new Scheduler(engine, owner, executor, {
    maxParallel: 2, coordinatorMode: 'fresh-full', startMode: 'auto',
  }).run(task.id);
  console.log(result);
} finally {
  store.close();
}
```

接入已有任务时，先由调用者显式执行 `engine.resume(taskId, owner, true)` 接管，再调用 `run`。配置宿主完成验证器时，使用已有 `EngineOptions.completionVerifier`；CLI 则沿用 `CAIRN_VERIFY_COMMAND` 等可信宿主设置。

自定义 `HostExecutor.execute(request, signal)` 接收 `phase`、`prompt`、`cwd`、可选分支和 `resume`；`contextMode` 区分完整、增量和纠错输入，`repair` 提供原始阶段 ID、次数和校验问题。它应尽早调用 `request.onSession(sessionRef)`，在返回的 `output` 中提供最后一条公开 assistant JSON，并如实返回 `error`／`interrupted`／`metrics`。`resume` 要恢复指定原生会话；不能用新会话替代。正常 Reason 复用和跨调度进程恢复需实现 `canResume(sessionRef, cwd)`，确认原执行已退出；检查返回 false 时保留缺口，不启动竞争会话。阶段输出的 JSON 格式由调度器提示提供，业务输入不需要维护框架内部的 claim ID。

默认 CLI 审计位于 `<workspace>/.cairn/scheduler/` 的独立调用目录，包含阶段提示、经过筛选的公开事件和指标。Cairn 不把 private thinking 复制到这些审计事件或阶段结果；原生宿主自己的会话文件由宿主管理。早期重试错误会保留，最终成功以最后的宿主终态为准；缺测或可能遗漏的 token 标记为下界，不能按零费用解释。请求的模型／effort 与实际观测值分开记录；流中没有提供实际值时保持缺测。

## 4.9 与主线黑板能力的衔接

输入黑板包含语义 branches、原生 agentRuns 和 globalReview。auto 会将已有分支、执行记录和待审反馈视为应先复核的状态；不会根据领域词或文字长度判断任务难度。已有调度记录仍按原位恢复。

owner 阶段读取 globalReview.snapshot 对应状态后，可返回 review:{snapshot,summary}。这与 cairn_update review 是同一条完成门槛。读取后新增的事实或反馈仍需下一次复核；worker 无权确认全局复核，来源版本失效也不能靠确认来恢复。未确认时保持缺口或暂停，不自动豁免。

看板汇总实际返回的各阶段 token、工具次数和模型响应数字，带 scheduler 来源并按调用 ID 去重；错误或中断的已知用量仍保留，未知部分不估算。数字不参与事实证明，也不是预算。原生 hooks 的统计覆盖范围与各阶段 CLI 指标不同，比较成本时仍需检查原生完整账本和缺测。
