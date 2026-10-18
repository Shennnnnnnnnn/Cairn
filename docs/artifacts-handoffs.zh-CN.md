# 产物验收与分层交接

当前 4.9 在六工具、SQLite 和宿主 Adapter 上提供产物验收与交接。宿主继续负责模型、工具、权限、进程与实际时限；默认工具接入不启动调度；可选 cairn run 复用宿主执行阶段，见[调度指南](scheduler.zh-CN.md)。

## 提交物与验收

模型通过 `cairn_checkpoint` 提交下列可选字段；SDK 旧 `invoke` 的完整 finish 输入保持兼容，Pi／MCP 的模型 finish 不接受这些字段：

```json
{"summary":"已保存结果与复现材料","artifacts":[{"path":"answer.json","description":"最终结果"},{"path":"REPORT.md"}]}
```

Cairn 读取明确提交的本地普通文件，以流式 SHA-256 保存内容摘要和字节数。支持相对工作区路径或明确的绝对路径；最多 16 个文件，总计 64 MiB；不展开 glob、不抓取 URL、不执行提交物。目录、缺失文件及读取中变化的文件不能提交。此限制适合小型可重现输入、脚本、报告或大产物的清单，大文件应由宿主提供合适的验证器。

宿主可以配置固定验收命令及必需提交物：

```sh
export CAIRN_VERIFY_COMMAND='["python3","/absolute/path/to/verify.py"]'
export CAIRN_VERIFY_ARTIFACTS='["answer.json","REPORT.md"]'
```

在启动宿主前设置这些变量。Codex 的 stdio MCP 会筛选环境；`cairn install/update --target codex` 的受管注册用 `env_vars` 显式转发数据库、验收和时限配置的变量名，不把其值写入配置文件。已有安装需更新后重启 MCP/宿主连接。自定义 Codex 注册也必须配置对应 env/env_vars，不能仅因父进程已 export 就假定验证器生效；应核对任务的 completionValidation、必需产物及真实 verification 回执。

命令从 stdin 接收任务的公开快照，包括原始目标、约束、提交物摘要。必需文件列表来自宿主，保存在任务内；Agent 无法通过提交空数组删除要求。验收回执绑定原始任务要求、证据/报告状态、提交物摘要和执行 epoch。验收前后均检查文件，不能把验证器修改后的文件当作原提交接受。通过后文件被替换、删除或修改，当前回执失效；重复 finish 不会继续返回完成，需要显式重开并重新提交/验收。历史完成记录仍保留。

验收脚本应先读完 stdin，再输出结果；只检查文件时也要排空输入，例如 Python 的 `sys.stdin.read()`。大任务快照尚未写完时，提前退出的脚本可能使宿主收到 `write EPIPE`，按验证器不可用处理。Round11 对十份真实任务快照的统一复验确认了这条接入边界；修复验收器不应追溯改写原任务的完成状态。

返回格式兼容已有 `{ok,issues}`，建议声明检查方式和范围：

```json
{"ok":true,"method":"replay","scope":"在原始输入上重跑提交样本，核对输出"}
```

`method` 支持 replay、inspection、contract。未声明显示 unspecified。结构验收不等于语义正确，回执中的方式/范围是宿主声明，不是执行隔离证明。通用核心不执行领域判断，也不保证验证器只读；必要的干净目录、进程权限、来源只读保护由宿主提供。若验收者必须修补提交物才能成功，应返回缺口；修改原提交会被内容检查拒绝。

不配置验证器时仍可使用产物摘要，完成依据为结构检查和文件完整性。旧任务无 artifacts 字段时保持原有行为。

## 三层交接

1. 图：简短结论、成立条件、依据及真实的联合前提。
2. 探索报告：方法、输入/命令、失败条件、产物位置、未验证假设和下一步。
3. 原始会话：由宿主保存，按 sessionRef 追查；默认不复制工具输出或对话。

先保存报告与材料，再提交引用：

```json
{"summary":"已排除输入 A；条件 B 尚未验证","handoffs":[{"key":"attempt-1","summary":"输入 A 在步骤 3 失败，不能排除条件 B","report":"EXPLORATION.md","artifacts":["analysis.py","sample.json"],"sessionRef":"pi:original-session-id","from":["finding-key"],"next":"在条件 B 下复跑并保留输入"}]}
```

handoffs 独立于最终 report，不授予 criterion 覆盖。相同 key 内容变化会追加新记录；精确重试不重复写入。来源通过现有事实/工作身份解析，同批新 finding 可以被引用。sessionRef 默认记录当时的宿主/会话身份；它是定位信息，宿主需要提供实际查阅能力。报告与材料引用不自动抓取或执行，也不自动证明内容可靠。

恢复时先读短上下文，再按需展开：

```json
{"view":"context","task_id":"task_…","focus":"c1"}
```

```json
{"view":"handoffs","task_id":"task_…","ref":"attempt-1"}
```

focus 可为 criterion ID、finding key/ID 或规范工作引用。上下文优先当前工作/criterion 关联结论和前置依赖，再补最近记录；相关交接报告优先。视图仍有字节预算，truncated 会报告省略数量及依赖；完整记录通过 details/evidence/handoffs/history 分页读取。不会用向量数据库或全量会话注入替代这一机制。

## 直接使用 CLI

以下命令在目标工作区执行，默认数据库为 `.cairn/state.db`；也可统一传 `--db /absolute/path/state.db`。

```sh
cairn serve
```

这是现有 `cairn ui` 的别名，只启动本地看板；执行仍由 Pi、Claude Code、Codex 或嵌入式宿主负责。

在另一个终端：

```sh
cairn submit --title "复现问题" \
  --origin "输入与说明位于当前工作区，原始输入只读" \
  --goal "提交可重现输入和验证记录" \
  --criterion "输入文件已保存" \
  --criterion "验证记录符合原始目标" \
  --constraint "不修改原始输入"
cairn status task_…
cairn status task_… --focus c1
cairn graph task_… --format timeline
cairn graph task_… --format html --out task.html
cairn hint task_… "请检查结论是否覆盖目标环境"
```

submit 创建持久化目标，回执明确 executionMode=host-managed；接着在宿主中用 cairn_resume(task_id, takeover=true) 接手执行。它不会暗中启动模型，也没有后台任务队列。review 尚未实现为独立审查阶段，本轮不提供会造成误解的同名空命令。

## 本轮验证与评测

实现回归覆盖明确提交、必需产物、验收期间修改、验收后变化、重新提交、新会话交接、旧依赖保留、历史与归因、worker 写入限制、独立数值复算及 CLI 工作流。

公开案例沿用 `evaluations/public-rca/cases/case-01` 至 case-04 和原始 CSV。新 runner 为 `run-round3.mjs`，旧 runner/结果保持冻结。两组均追加相同 checks.json 复现格式要求，Cairn 另使用独立 CSV 重算 Adapter；它不读取隐藏故障标签，也不执行 Agent 的分析脚本；仅按声明的方法复算，不依据指标名称裁定采集口径。隐藏标签只在进程结束后用于正确率评分。

主轮保持原模型、顺序和 720 秒预算。自然超时后的全新上下文恢复使用额外 180 秒单列；原任务 deadline 不静默延期，Cairn 建立引用原图与交接的续接任务。旧轮未执行相同恢复阶段，因此旧新恢复率不能直接作因果比较。费用字段为零配置时显示“货币费用未知”，用耗时、输入/输出/缓存 token 与工具数衡量可观测成本；不把 reasoning 重复加进 totalTokens。


## 四例复验结果与使用边界

[本轮公开案例比较](../evaluations/public-rca/comparison-round3.zh-CN.md)中，Cairn 四例都完成并通过文件／数值验收，但根因联合正确仍是 2/4。四份真实状态副本的交接重载检查通过，实际模型没有自然超时恢复样本。交接记录都在收尾产生，不能据此推断中途断线时的恢复成功率。接入方应按任务选择验证器、明确验收范围；通用核心不会把交付合格自动解释为领域结论正确。


## 探索闭环与简化完成（第五轮）

长探索应在第一批可复用事实出现、假设改变、反证出现或方向结束时保存小型 checkpoint；回执的 `exploration` 汇总当前黑板并要求重新判断目标、偏航和下一项检验。超过 60 秒未保存时，原生宿主可附带一次有界提醒；不是固定阶段、工具配额或独立 watchdog。

已保存发现覆盖条件后，使用 `cairn_finish {}`。模型 finish 只接收 outcome 与短 summary；短任务同样先用一个带状态、依据和显式 covers 的 keyed Finding 保存结果，再完成。完整旧写法只保留在 SDK invoke，模型调用由 invokeModel 校验。摘要单独不能形成 checkpoint 增量或证据。

宿主已配置的必需文件在 finish 自动收集；其他文件仍需 artifacts 显式声明。现有文件被修改后，需要新快照及验收，已完成目标仍需显式重开。

UI 的结论审查独立于 Agent Finding 和产物 verifier。可信接入方可在真实独立核验后调用 `harness.engine.assess(taskId,{status:"passed"|"failed"|"inconclusive",summary,scope,reviewer})`；没有对应公共 Agent 工具。审查绑定提交内容与 owner epoch，候选变化后过期。不要把验收方法 replay／inspection 自行推断成结论语义已核验。


## 第六轮自动交接

宿主从已保存状态自动生成 handoff，覆盖创建、有效 checkpoint、挂起／结束和接管前。source 固定生成时的身份、epoch、revision 与候选指纹，state=saved 仅表示知识已保存。详细报告在 SQLite 保留，私有 Markdown 为可选投影；projectionError 会显式说明文件不可用。分支记录包含真实 worker、branchKey 与当时代次，保留 proposed 状态；没有接收者启动、派发或 ACK 的隐含承诺。

## 第七轮：引用版本与终态交接

对 finding 的显式 `references`，宿主只对已声明产物、同次提交产物或宿主必需文件的精确本地路径记录 SHA-256/字节数；支持相对路径、绝对路径、file URL 及既有行号后缀。URL、未声明路径和 basis 文本不会触发内容读取。宿主必需文件应先保存再引用；已声明但不存在的引用会拒绝保存。新字段 `referenceArtifacts` 为宿主元数据，不属于模型输入。

文件替换、删除或退出产物清单后，旧 finding 的声明状态与覆盖链接保留，但其有效覆盖和当前验收失效。context/回执的 `referenceState` 分列 current、stale、untracked；current 仅表示文件版本一致，不证明语义正确。仅重新提交 artifacts 或 finish 自动收集文件不会重新绑定旧事实。检查新文件并显式重存相同 finding key 才会绑定新版本；相同事实、相同字节的重试保持幂等。读取中的比较最多检查 16 个不同文件、合计 64 MiB；缺快照的旧记录保持 untracked，不在恢复时追溯生成校验。

完成后的当前 agenda 不再提示探索或再次 finish；context 将旧 checkpoint.next 标为 historicalNext，持久化 checkpoint 与历史 handoff 不改写。当前自动交接说明完成后的复用边界，显式 reopen 当场保存新 owner/epoch 的重验交接。最多三条的恢复视图为最新 host/state 保留一个位置，其他位置仍按相关性选择。worker 分支和挂起任务继续保留可执行 next。

依赖图 `from` 的版本失效传播暂未加入；本轮只跟踪明确文件引用。接入方仍需用领域验证器和独立审查判断因果与事实语义。

## 即时状态与交接快照

4.9 的 cairn_update 保存即时变化，完整图读取当前黑板；自动 handoff 在创建、checkpoint、暂停、完成及恢复边界保存。handoff 的 source.revision/at 表示当时的快照，不能当作持续刷新的当前状态。交接前保存增量 checkpoint，再把图快照或 handoff 定位信息交给接收会话。
