# 本地投递队列修复（合成业务）
维护 `delivery_queue.py` 的现有公开 API，不引入第三方依赖。修复代码，增加有意义的回归测试，运行测试，并写 `REPORT.md`，说明根因、修改、验证与剩余限制。只访问当前工作目录内的文件；不能访问父目录、其他实验目录、外部网络或模型。可自由写计划和笔记。

契约：
1. `Queue.enqueue(tenant, request_id, payload, now)` 返回 job 字典。幂等范围是 `(tenant, request_id)`；相同 JSON 对象载荷（字典键顺序无关）返回原 job，不同载荷必须抛 ValueError，即使 job 已完成。不同租户可用同一 request_id。tenant/request_id 必须是非空字符串。
2. payload 是普通 JSON 对象，须深复制：调用者修改输入、返回 job、reserve 返回值或 snapshot 都不能改内部状态。job 保留 `id, tenant, request_id, payload, state, available_at, attempts, lease_token, lease_until, worker` 字段。
3. `reserve(worker, now, lease_seconds=30)` 按创建顺序选取到期的 queued job，或租约已过期的 leased job；无可用任务返回 None。每次成功 reserve 增加 attempts，并生成新 token。过期定义是 `now >= lease_until`，worker 必须非空，lease_seconds 必须是有限正数，所有 now 必须为有限数。
4. `ack(job_id, token, now)` 仅在 job 为 leased、token 匹配、租约仍有效时返回 True 并置 done；其他情况返回 False 且不修改状态。完成、释放、重租后旧 token 无效。
5. `fail(job_id, token, now, delay=0)` 同样校验租约，成功后置 queued、清空租约、`available_at=now+delay`，返回 True；过期/错误 token 返回 False。delay 必须有限且非负，否则 ValueError。done job 不能再被 reserve。
6. `snapshot()` 返回 `{"version":1,"next_id":整数,"jobs":[job,...]}`；`Queue.from_snapshot(snapshot)` 恢复幂等关系、租约、顺序和 next_id，不能与后续新 job ID 冲突，也不能与传入快照共享可变数据。仅要求读取本版本合法快照。

时间均是调用者传入的同一个单调秒时基，不读真实时间，不 sleep。使用 Python 标准库。公开测试是示例而非完整验收，禁止删除或弱化现有测试。
