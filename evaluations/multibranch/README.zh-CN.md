# 新难例：单会话与多会话

本轮已结束，18条记录全部保留。[完整对比报告](comparison.zh-CN.md)：单会话完成且联合正确5/9，多会话4/9；均耗时8.07／12.86分钟，均token564.5万／至少731.2万。9/9多会话实际并行执行独立Explore，3条未完成分别为两次上游服务失败和一次主动挂起。详细来源链、波动、工作区约定偏差与编排额外成本均在报告中单列。

本目录独立于比赛工作目录 `/Users/shen/Documents/1028-emergency-pk`，不创建 Multica 项目或任务，不修改比赛智能体，也不改生产框架。

模型为 Pi + `sub2api-copy/global:deepseek-v4.1-flash` / high。三道新 RCAEval 案例、每题每组三次，共18次正式运行，无任务执行预算。single 使用当前 Cairn 六工具在一个 Pi 会话内执行；multi 使用当前 Scheduler 的 Reason-first、fresh-full 和两个并行 Explore。两组回答相同问题、读取相同输入并接受同一复算验收。

- [预先固定的实验规则](protocol.zh-CN.md)
- [数据下载](download.py)与[匿名材料准备](prepare.py)
- [原生 Pi 驱动](pi-driver.mjs)、[多会话驱动](scheduler-driver.mjs)、[运行器](run.mjs)
- [独立复算器](verify.py)与[无模型接入检查](fixture.mjs)
- [进度、原生账本及分支审计](analyze.py)

当前源码驱动已显式指定 `sessionMode: multi`，兼容新增的单会话默认策略；该改动只影响后续新执行，不修改运行目录中的冻结驱动、阶段提示或历史分数。

原始数据、运行目录与私有依赖均被本目录 `.gitignore` 排除。正式运行使用 `runs/2026-10-19-deepseek-multibranch-v4/` 中冻结的实现、驱动、题目与协议；现有运行不会覆盖。初次启动因测试驱动误解原生字符串消息而整体封存，额外调用和未知用量单列，不能当作零成本。

v2还发现“预置分支但Reason直接完成”的实验控制缺口。v3锁定首轮仅规划、由宿主确认独立Explore实际执行；三个自然结束的single原样沿用，其余15个正式样本新执行。v2其余记录及消耗保留为编排失配附录，详见协议修订。

查看进度（不读取隐藏标签、不调用模型）：

```sh
python3 evaluations/multibranch/analyze.py --progress
```

所有执行结束、全部公开报告阅读并封存后才能运行 `--analyze`。多会话参与另按真实会话ID、工具执行、提案持久化、主线审核及并行重叠审计；不同题并行与同会话纠错不算独立助手。

数据来源：[RCAEval 作者维护的数据](https://huggingface.co/datasets/phamquiluan/RCAEval)、[官方代码](https://github.com/phamquiluan/RCAEval)、[论文](https://arxiv.org/abs/2412.17015)。这些是公开数据上的离线遥测诊断，未部署原系统、复现在线故障注入或实际修复；“新”指本项目未跑过，不保证训练未见。三题三次不能保证长期稳定性或全部任务的泛化效果。

v4纠正测试门槛错误绑定初始分支名的问题，允许成功的替代分支。全部single自然结束后沿用，未受错误反馈影响的multi按同等轨迹沿用，其余补齐；所有受影响调用单列额外成本。实际Explore执行、提案保存和主会话显式来源链分开报告，详见协议。
