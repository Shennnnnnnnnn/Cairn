# 评测会话的 CC Switch 用量统计

评测继续使用独立的 `CODEX_HOME` / `PI_CODING_AGENT_DIR`、工作目录、凭据副本和任务数据库。宿主在子进程退出后，将原生 JSONL 日志单向同步到 CC Switch 的默认扫描目录：

| 宿主 | 统计副本位置 |
| --- | --- |
| Codex | `~/.codex/sessions/YYYY/MM/DD/rollout-时间-会话ID.jsonl` |
| Pi | `~/.pi/agent/sessions/--cairn-evaluations--/时间_会话ID.jsonl` |

原始日志留在各实验的 `sessions/` 中。同步不修改模型请求、用量字段、提示词、成绩、配置或 CC Switch 数据库；失败及中断会话也保留真实已发生的用量。Codex 在清理临时凭据目录前归档原生日志。CC Switch 自己负责解析、计价和入库。

当前运行器和驱动已接入退出后的同步；新的重复评测在准备阶段会一并冻结 `session-usage.mjs` 并记录其哈希。已完成及正在执行的冻结副本保持不变，使用下面的命令补录。

## 补录历史日志

在仓库根目录使用 Node.js 24 或更新版本。默认扫描 `evaluations/pi-ab/runs` 和 `evaluations/public-rca/runs`，只识别 `sessions/` 下的原生会话文件，不导入标准输出事件流、实验实现副本或凭据文件。

```sh
# 预检查，不创建统计副本
npm run usage:sync -- --dry-run --report .cairn/usage-backfill/plan.json

# 正式同步；可重复执行
npm run usage:sync -- --write --report .cairn/usage-backfill/import.json
```

可重复传入 `--root /实验目录` 限定来源，使用 `--home /独立目录` 测试统计副本；默认目标为当前用户主目录，不使用评测的临时配置目录。同步后，在 CC Switch 用量统计页点击“立即同步”，或等待其自动扫描。历史请求按日志原有时间归属；查看较早评测时需要扩大时间范围。

同步完成后，可以只读核对每个会话的原生请求数、输入、输出、缓存命中和缓存写入，以及副本是否已被 CC Switch 扫描：

```sh
node scripts/verify-evaluation-usage.mjs --report .cairn/usage-backfill/import.json --out .cairn/usage-backfill/audit.json

# 再次点击“立即同步”后，确认未变化的日志没有产生新的统计记录
node scripts/verify-evaluation-usage.mjs --report .cairn/usage-backfill/import.json --baseline .cairn/usage-backfill/audit.json --out .cairn/usage-backfill/rescan-audit.json
```

## 去重与增量

- 以宿主和原生会话 ID 为标识，先检查默认会话目录；Codex 同时检查归档会话。已有同一会话时复用原文件，避免换路径重复导入。
- 多份来源必须完全一致，或是同一份日志的前缀与续写；只发布最长的完整版本。
- 首次发布用原子操作创建完整副本。续写只追加新字节，保留 inode 和已有内容，让 CC Switch 继续使用原来的读取位置。重复运行不会重写相同内容。
- 同一 ID 内容分叉、目标已有多份副本、路径含符号链接时报告冲突，不覆盖文件。并发同步使用当前用户的 `~/.cairn/session-usage.lock` 串行执行。
- 正在写入的最后半行暂缓发布，下一次同步补齐。对仍在运行的冻结评测，可在其结束后再次执行补录命令，导入最后的增量。

各新评测会话的 `cc-switch-usage-sync.json` 和手动命令的 `--report` 文件记录来源、目标、SHA-256、创建/追加/跳过状态及冲突。统计同步失败会写出提示和记录，保留评测结果，之后可手动重试。设置 `CAIRN_USAGE_SYNC=0` 可关闭运行器的自动同步。
