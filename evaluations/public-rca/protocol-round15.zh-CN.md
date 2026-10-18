# Round15：原生 Pi、原版 Python Cairn、两种新版协调模式

仅使用已注册 `sub2api-copy/global:deepseek-v4.1-flash`，沿用注册的 reasoning/high、上下文和输出上限，不修改全局配置。四组：native、original、cairn-fresh、cairn-reuse。三道已反复使用的开发题，每题每组3次，共36个新 actor；不是未见集或泛化证明。

四条 lane 并行，每 lane 至多一个 actor；每个框架内部至多一个 native CLI，全局至多4个。题目按重复轮旋转，lane 内不并发。所有组相同源文件、TASK、产物合同、common/native prompt、Pi工具集与隔离配置。框架提示和接口是被测变量。无任务耗时、token、工具调用数或阶段数预算；保留原生模型限制、租约、验证器安全超时及新版语义无进展终止。用户取消向所有正在运行的组传递。每 actor 只运行一次；失败不选择性重跑。不另跑付费健康探针。

原版组使用冻结 Python 源码的真实 FastAPI 路由、DispatcherLoop、任务函数、阶段提示词、Fact/Intent 图、解析与完成接口。为适配环境：HTTP 使用私有 TestClient 传输；后端工作区及 graph 文件放入各 actor 内；进程桥复用其它组相同的真实 runPi（统一模型、权限、工具、公共系统提示、凭据隔离和用量归档），原始 assistant 输出不改写。原版配置 schema 要求正整数超时，适配层在加载后将阶段 timeout/conclude_timeout 设为 None，并使 communicate(None) 真正无任务截止时间；租约与服务安全时间保留。源文件不改写，所有适配保存单独收据。该结果描述此公开适配，不声称原版在其默认120/45/600秒配置下的表现。

新版本两组使用同一实现和任务配置，仅改变 coordinatorMode：fresh-full 每次 Reason 新建宿主会话、传完整公开黑板；reuse-delta 复用已退出的协调会话、传增量及完整快照定位。Explore 两组都独立会话，输出纠错和故障 Conclude 都恢复对应原会话。Bootstrap 保留直接完成；如果某个样本未触发普通 Reason，它不能为两种协调策略的差异提供直接证据。零模型 fixture 强制走 Reason/Explore 只验证路径，不当作真实模型效果。

产物均由相同独立验收器事后重放。新版运行中仍使用其真实宿主验收门；原版未注入其本来没有的额外验收门，避免改变被测完成语义。报告同时区分原生正常停止、框架完成声明、有效交付、标签正确率及错误完成率。主完成口径要求正常宿主结束、三个非空产物和有效答案结构；原版另要求 project=completed，新版另要求 task=completed 且当前验收通过。正确率仅表示根因对象/层级/资源家族匹配，不能证明全文语义正确。错误完成=主完成且标签错误；有效正确交付另要求统一验收通过和原始输入未变。

先冻结新旧实现、输入、驱动、评分器和分析脚本；跑六个新版和两个原版零模型 pipeline fixture 后，正式执行。全部 actor 结束、所有可用公开报告分批完整阅读并ACK封存后，才进行隐藏标签评分。原始 native session metadata 与 phase/actor 用量独立对账，不读取私有思考内容。所有纠错、Conclude、失败均计入耗时和已知tokens；缓存读取/写入与非缓存输入单列。缺测与重试下界不当作零，金额无账单即未知。每题三次仅描述小样本波动。

root：`runs/2026-10-18-deepseek-original-context-round15/`。不覆盖前轮证据。与 Round13/14 的历史变化包含服务时窗、并发和框架变化，不作为单项修改的因果证明。
