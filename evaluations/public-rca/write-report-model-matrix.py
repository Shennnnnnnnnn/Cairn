"""Render the finished matrix only after every final report has a recorded review."""
import hashlib, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUN = ROOT / 'runs' / sys.argv[1]
summary = json.loads((RUN / 'summary.json').read_text())
reviews = json.loads((RUN / 'qualitative-audit.json').read_text())
scope = json.loads((RUN / 'scope-review.json').read_text()) if (RUN / 'scope-review.json').exists() else None
if len(summary['results']) != 12 or summary['audit']['failures']:
    raise SystemExit('A completed, audited twelve-cell matrix is required')
review_by_key = {(v['modelSlug'], v['mode']): v for v in reviews['results']}
for row in summary['results']:
    review = review_by_key[(row['modelSlug'], row['mode'])]
    report = Path(row['episodeDirectory']) / 'initial.REPORT.md'
    if report.exists() and review.get('reportSha256') != hashlib.sha256(report.read_bytes()).hexdigest():
        raise SystemExit('Review must correspond to saved report: ' + str(report))
    inspected = review.get('readFinalReport') if report.exists() else review.get('missingReportConfirmed')
    if not inspected or not review.get('independentReview'):
        raise SystemExit('Missing independent final report review')

MODE_NAMES = {'pi': '原生 Pi', 'pi-cairn-previous': '上一版 Cairn', 'pi-cairn': '本版 Cairn'}
def flag(value):
    return '是' if value else '否'

def link(label, path):
    return f'[{label}]({path.resolve()})'

def count(value):
    return f'{value:,}'

lines = [
    '# 四模型难例实测：原生 Pi、上一版 Cairn、本版 Cairn', '',
    '题目为公开 AIOps 2022 指标切片 `case-03`，四模型分别使用三个执行配置，共 12 次全新会话。'
    '上一轮原生 Pi 与两版 Cairn 在故障类型上分歧，因此在本轮开始前选定本题。'
    '每条件仅一次；这是一道题上的可用效果比较，不能据此得出通用模型排行榜。', '',
    link('开跑前协议', RUN / 'protocol.before.md') + ' · ' + link('完整结果与控制审计', RUN / 'summary.json') +
    ' · ' + link('逐份报告审阅', RUN / 'qualitative-audit.json') + ' · ' + link('运行中并行变更', RUN / 'parallel-amendment.json'), '',
    '## 本次观测', '',
    '| 模型 | 原生 Pi 正确交付 | 上一版 Cairn 正确交付 | 本版 Cairn 正确交付 |',
    '|---|---:|---:|---:|'
]
for spec in summary['manifest']['models']:
    rs = {r['mode']: r for r in summary['results'] if r['modelSlug'] == spec['slug']}
    def cell(mode):
        marked = scope and next(r for r in scope['results'] if r['modelSlug'] == spec['slug'] and r['mode'] == mode)['observedPolicyDeviation']
        return flag(rs[mode]['correctDelivery']) + ('†' if marked else '')
    lines.append('| ' + spec['id'] + '（' + spec['thinking'] + '） | ' + ' | '.join(cell(m) for m in MODE_NAMES) + ' |')
if scope:
    lines += ['', '† 工作区约束偏离另列：DeepSeek 上一版 Cairn 写入、读回并清理共享 `/tmp/analyze_out.txt`；Step 原生 Pi 曾尝试切换到一个外部目录，随后回到自己的工作区才读取证据。'
              f"主分数保留冻结口径；严格剔除边界偏离的正确交付为 {scope['strictEligibleCorrectDeliveries']}/12，原口径为 {scope['primaryCorrectDeliveries']}/12。"
              '命中标签不代表严格符合执行协议。']
lines += ['', '| 模型 | 仅对象＋故障族命中 | 正确交付 | 三配置累计分钟 | 累计输出 token | 累计总 token（含缓存） |',
          '|---|---:|---:|---:|---:|---:|']
for spec in summary['manifest']['models']:
    rows = [r for r in summary['results'] if r['modelSlug'] == spec['slug']]
    prefix = '≥' if any(r['metrics']['usageIsLowerBound'] for r in rows) else ''
    lines.append(f"| {spec['slug']} | {sum(bool(r['grade'].get('jointTop1')) for r in rows)}/3 | {sum(r['correctDelivery'] for r in rows)}/3 | {sum(r['metrics']['wallSeconds'] for r in rows)/60:.2f} | {prefix}{count(sum(r['metrics']['usage']['output'] for r in rows))} | {prefix}{count(sum(r['metrics']['usage']['totalTokens'] for r in rows))} |")
lines += ['', '累计分钟是三个会话各自生命周期之和，并非整个并行实验的经过时间。', '',
          '正确交付同时要求：自然结束、对应执行配置完成、三项产物的数值复算通过、首选故障对象与故障族均命中标签。'
          'Cairn 的完成还要求当前 owner/验证器的验收和产物哈希有效；原生 Pi 的完成按正常结束、有效候选答案和三项产物存在判定。'
          '标签只评首选对象与故障族，不证明全文的指标语义和因果叙述。', '',
          '| 执行配置 | 完成 | 数值复算通过 | 对象＋故障族命中 | 正确交付 | 错误完成（已完成但标签错） |',
          '|---|---:|---:|---:|---:|---:|']
for mode, name in MODE_NAMES.items():
    rows = [r for r in summary['results'] if r['mode'] == mode]
    values = [sum(r['completed'] for r in rows), sum(bool(r['acceptance'].get('ok')) for r in rows),
              sum(bool(r['grade'].get('jointTop1')) for r in rows), sum(r['correctDelivery'] for r in rows),
              sum(r['falseCompletion'] for r in rows)]
    lines.append('| ' + name + ' | ' + ' | '.join(f'{v}/4' for v in values) + ' |')
lines += ['', '同一题上的四模型观测按配置汇总；这四次不是四道独立案例，不构成框架通用准确率。', '',
          '| 模型 | 配置 | 完成 | 复算 | 对象＋故障族 | 错误完成 | 分钟 | 输出 token | 输入 token | 缓存读取 token | 总 token（含缓存） |',
          '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
for row in summary['results']:
    metric, usage = row['metrics'], row['metrics']['usage']
    prefix = '≥' if metric['usageIsLowerBound'] else ''
    joint = bool(row['grade'].get('jointTop1'))
    lines.append(f"| {row['modelSlug']} | {MODE_NAMES[row['mode']]} | {flag(row['completed'])} | {flag(row['acceptance'].get('ok'))} | {flag(joint)} | {flag(row['falseCompletion'])} | {metric['wallSeconds']/60:.2f} | {prefix}{count(usage['output'])} | {prefix}{count(usage['input'])} | {prefix}{count(usage['cacheRead'])} | {prefix}{count(usage['totalTokens'])} |")
lines += ['', '输入列为 Pi 记录的非缓存输入，缓存另列；输出包含已计入的推理 token，不能再次叠加。'
          '不同模型的分词、缓存计费和服务速度可能不同，记录 token 不能直接换算成钱；登记价格为零，实际金额未知。耗时为 Pi 进程生命周期，token 仅统计被测会话；后续宿主复算、评分和本对话编排另计。'
          '带 ≥ 的记录出现过错误或不完整用量，只是上报下界。', '',
          '## 接入与框架行为', '',
          '| 模型 | 配置 | 原生工具 / Cairn 工具 | 工具错误 | 请求错误 / 原生重试 | checkpoint / 含主张 | 首次 checkpoint 秒 | finish 完成 / 调用 | 有来源且含主张的交接 |',
          '|---|---|---:|---:|---:|---:|---:|---:|---:|']
for row in summary['results']:
    metric = row['metrics']
    first = row.get('firstCheckpointSeconds')
    first = f'{first:.1f}' if first is not None else '—'
    finishes = row['finishCalls']
    lines.append(f"| {row['modelSlug']} | {MODE_NAMES[row['mode']]} | {metric['nativeToolCalls']} / {metric['cairnToolCalls']} | {metric['toolErrors']} | {row['providerErrors']} / {row['nativeRetries']} | {row['checkpoints']} / {row['findingCheckpoints']} | {first} | {sum(not f['error'] and f.get('phase') == 'completed' for f in finishes)} / {len(finishes)} | {row['handoffsWithSourceAndClaims']} |")
lines += ['', 'checkpoint 列记录成功调用及其中携带 findings 的次数，不是新增事实条数；保存的是执行者的观测、假设和问题等主张，不能一律当作已验证事实。'
          '有来源的交接也不等于其内容正确或下一步建议及时更新。原生重试是同会话 API 重试，不是 Cairn 中断恢复。'
          '本轮没有主动中断或自动续跑，实际恢复成功率为“不适用”。', '',
          '## 报告质量复核', '']
for row in summary['results']:
    review = review_by_key[(row['modelSlug'], row['mode'])]
    folder = Path(row['episodeDirectory'])
    report = folder / 'initial.REPORT.md'
    reference = link('报告', report) if report.exists() else link('运行记录', folder / 'initial.metrics.json')
    lines.append(f"- **{row['modelSlug']} / {MODE_NAMES[row['mode']]}**（{reference}）：{review['independentReview']}")
lines += ['', '## 结论与使用建议', '', (ROOT / 'synthesis-model-matrix.zh-CN.md').read_text().strip(), '',
          '## 可比性与复核边界', '',
          '- 三个执行配置使用同一底层 Pi 和原生工具；两版 Cairn 从上一轮完整归档复制。旧版不是 Cairn-main。核心实现未因本轮结果调整。',
          '- 四模型走同一已配置网关。接入端清单含四个 ID，Pi 会话中的请求标识已核对；这些不独立证明网关内部实际路由。DeepSeek、Step、GLM 请求 high；Kimi 沿用注册的 reasoning=false，记录 off。结论包含该接入配置差异。',
          '- thinking 是客户端请求与 Pi 记录的等级；Kimi 即使请求 off，部分会话仍上报 reasoning token，不能据此确认服务端实际执行了关闭推理的请求。',
          '- GLM 仅在仓库外临时配置中注册，登记参数来自本机 Pi 自带 zai/glm-5.3 目录；其余三个登记不改。输出登记分别为 128000、64000、131072、1049000，均不是评测器临时压低的上限，也不保证服务端兑现。',
          '- 未设置评测时限、累计输出限额、单次回复覆盖、Cairn deadline/reserve；保留原生硬限制、压缩、API 重试和错误，不选择性重跑正式样本。',
          '- 全新会话与工作区，共同增加各自 cwd/.tmp 的临时文件约束；与历史轮次不是严格相同提示，只比较本轮矩阵。没有操作系统沙箱，命令审查不能证明硬隔离。',
          '- 全部执行者结束后统一评分；没有在线标签反馈。前五单元串行；按用户随后要求，Step 原生 Pi 继续运行，GLM、Kimi 各新增一路并行，模型内部三个配置仍串行。并发最多三个执行者，共用网关，耗时含时间段、缓存冷热和并发负载混杂，不按耗时推导严格模型速度排名。DeepSeek 另有整轮作废的前序案例校准，可能影响服务端缓存冷热；正式会话和答案均未复用。',
          '- 题目与模型各单元只有一次观测，且此题已参与前几轮框架开发调试，不是未见过的保留集。标签命中、数值复算、语义审阅和任务完成分列，不将其中一项替代其他项。', '',
          '- 评测契约仍有表达缺口：验收器逐项拒绝重复源序列，而公开文档仅写“两个不同的时序构成两项证据”。保留冻结规则，单独披露相关拒绝；Step 原生 Pi 即使放宽排重仍存在独立的 rate 口径错误。本轮后应澄清文档再开新实验。', '',
          f"控制审计：{summary['audit']['passed']}/{summary['audit']['total']} 通过。", '',
          link('运行清单', RUN / 'manifest.json') + ' · ' + link('工具协议探针（与正式成绩分开）', RUN / 'preflight-probes.json')]
if (RUN / 'handoff-restoration.json').exists():
    lines[-1] += ' · ' + link('离线状态重载（不等于模型恢复）', RUN / 'handoff-restoration.json')
if (RUN / 'scope-review.json').exists():
    lines[-1] += ' · ' + link('工作区边界审查', RUN / 'scope-review.json')
if (RUN / 'ui-source-validation.json').exists():
    lines[-1] += ' · ' + link('UI 源状态校验', RUN / 'ui-source-validation.json') + ' · ' + link('UI 入口与画面复核限制', ROOT.parent.parent / 'docs/public-rca-ui.zh-CN.md')
auxiliary = json.loads((RUN / 'auxiliary-costs.json').read_text())
lines += ['', '## 正式成绩之外的消耗', '',
          '目录名泄露故障类别的前序校准整轮作废，一个会话自然结束、另一个由宿主终止；没有隐藏评分或答案复用。'
          '工具探针中另有两次宿主空环境变量错误，修正后四模型全部通过。', '',
          f"- 接入探针 {auxiliary['protocolProbes']['count']} 次：上报总 token {count(auxiliary['protocolProbes']['usage']['totalTokens'])}。",
          f"- 作废校准 {auxiliary['excludedWholeCalibration']['count']} 次：上报总 token 至少 {count(auxiliary['excludedWholeCalibration']['usage']['totalTokens'])}。",
          '这些消耗不计入 12 单元成绩，但属于本次实际评测开销。' + link('单独成本记录', RUN / 'auxiliary-costs.json')]
output = ROOT / 'comparison-model-matrix.zh-CN.md'
output.write_text('\n'.join(lines) + '\n')
print(str(output))
