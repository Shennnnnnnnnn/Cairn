"""Render round-two comparison only after all episodes and independent reviews exist."""
import json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parent
run=ROOT/'runs'/(sys.argv[1] if len(sys.argv)>1 else '2026-10-16-aiops2022-round2b')
assert (run/'finished.json').exists(),'All eight real runs must terminate first'
s=json.loads((run/'summary.json').read_text());old=json.loads((ROOT/'runs'/s['manifest']['baselineRun']/'summary.json').read_text())
assert len(s['results'])==8
qa=json.loads((run/'qualitative-audit.json').read_text())
assert {(q['case'],q['mode']) for q in qa}=={tuple(pair) for pair in s['manifest']['order']}
assert all(len(q['numericChecks'])>=2 and q['review'] for q in qa),'Each output needs a new semantic review and at least two quantitative checks'
audit=json.loads((run/'audit.json').read_text());extra=json.loads((run/'round2-audit.json').read_text())
state=json.loads((run/'round2-state-validation.json').read_text())
interaction=json.loads((run/'interaction-comparison.json').read_text())
scope=json.loads((run/'scope-audit.json').read_text())
assert len(state)==4
synthesis=(ROOT/'synthesis-round2.zh-CN.md').read_text().strip()
lines=['# 第二轮优化：同四组公开排障案例复测', '', f"运行标识：`{run.name}`。开始于 {s['manifest']['createdAt']}；结束于 {json.loads((run/'finished.json').read_text())['finishedAt']}。", '', synthesis,'','## 相同输入与比较边界','',
'四例沿用同一公开 AIOps 2022 归档、同一天测试环境和原始指标切片，每例包含全部节点、容器和服务的前后 600 秒。模型、Pi 版本、high 思考级别、输入、原始任务提示、8192 单回复限制、24000 累计输出和每例 720 秒上限保持一致。每条件每例一次，串行交替。没有重复采样、seed、在线修复或正式比赛榜单复现，不能据此作普遍提升或显著性结论。', '',
'Cairn 本轮使用冻结实现、更新 skill、90 秒提交预留和宿主输出契约验证器。这是组合改动比较，不能隔离各子功能的贡献。Pi 对照仍使用原提示及原生工具。原始 scorer 保持不动，服务 `-grpc` / `-http` 后缀等价政策在本轮首个输出前从第一轮复制并冻结；不会把 pod、node、service 层级相互等价。', '',
'验证器只检查 answer.json / REPORT.md 的字段、引用文件存在和第一候选在报告中出现；不读取标签，不核对数值含义或因果。12/12 控制检查表明八份旧输出（包括误判）均可通过，错误格式、缺失引用和候选不一致会被拒绝。其通过与根因正确分别统计。', '',
'此前 `2026-10-16-aiops2022-round2` 启动因 provider 拒绝缺显式 type 的条件 schema 而中止，保留两次 400 错误和已完成的 Pi 首例；整轮排除，不用其中单例替补本轮结果。schema 修复、198 项回归及独立真实 API 探针通过后，重新执行本轮全部八次。探针与中止试跑的用量不混入正式表格。', '', '## 四例结果','', '| 案例／标签 | 第一轮 Pi+Cairn | 本轮 Pi | 本轮 Pi+Cairn |','| --- | --- | --- | --- |']
def prediction(r):
 g=r['reviewedGrade'];p=g.get('predictions',[{}])[0]
 return f"`{p.get('location','无答案')}` / `{p.get('fault_family','?')}`；联合{'命中' if g.get('jointTop1') else '未命中'}"
for case in ['case-01','case-02','case-03','case-04']:
 r=[next(x for x in source['results'] if x['case']==case and x['mode']==arm) for source,arm in [(old,'pi-cairn'),(s,'pi'),(s,'pi-cairn')]]
 t=r[0]['grade']['truth'];lines.append(f"| {case} `{t['cmdb_id']}` / `{t['failure_type']}` | "+' | '.join(map(prediction,r))+' |')
lines+=['','## 汇总指标','', '| 指标 | 第一轮 Pi | 第一轮 Pi+Cairn | 本轮 Pi | 本轮 Pi+Cairn |','| --- | ---: | ---: | ---: | ---: |']
columns=[old['byMode']['pi'],old['byMode']['pi-cairn'],s['byMode']['pi'],s['byMode']['pi-cairn']]
for label,key in [('首选对象＋大类联合命中','reviewedJointTop1'),('首选对象命中','reviewedTop1Entity'),('对象 Top-3 命中','reviewedTop3Entity'),('资源大类命中','top1Family')]:lines.append('| '+label+' | '+' | '.join(f"{c[key]}/4" for c in columns)+' |')
for label,fmt in [('对象 MRR',lambda c:f"{c['reviewedMRR']:.3f}"),('观察到的总耗时（分钟）',lambda c:f"{c['wallSeconds']/60:.2f}"),('服务端报告 token（含缓存读取）',lambda c:('≥' if c['usageIsLowerBound'] else '')+f"{c['tokens']:,}"),('输出 token',lambda c:('≥' if c['usageIsLowerBound'] else '')+f"{c['outputTokens']:,}"),('原生工具 / Cairn 工具',lambda c:f"{c['nativeToolCalls']} / {c['cairnToolCalls']}"),('工具错误',lambda c:str(c['toolErrors'])),('实验进程超时',lambda c:str(c['timeouts'])),('模型错误响应／其中恢复',lambda c:f"{c['modelErrorResponses']} / {c['recoveredModelErrorResponses']}")]:lines.append('| '+label+' | '+' | '.join(fmt(c) for c in columns)+' |')
lines+=['',f"未经服务协议别名复核的原始 scorer 联合命中依次为 {old['byMode']['pi']['jointTop1']}/4、{old['byMode']['pi-cairn']['jointTop1']}/4、{s['byMode']['pi']['jointTop1']}/4、{s['byMode']['pi-cairn']['jointTop1']}/4。复核只按预先冻结的同层级服务后缀政策处理标识，不改变资源大类。",'', '耗时包含 API 延迟与重试；服务端返回模型名未独立核实底层身份。出现错误或中断时 token 为已完整记录回复的下界；含缓存读取，不等同实际账单。不得用两组下界相除报告精确节省比例。', '', '## 交互开销与未完成重试','', '| 原始回执口径 | 第一轮 Cairn | 本轮 Cairn |', '| --- | ---: | ---: |', f"| checkpoint 缺 summary 错误 | {interaction['baseline'].get('checkpointSummaryErrors',0)} | {interaction['current'].get('checkpointSummaryErrors',0)} |", f"| incomplete finish 回执 | {interaction['baseline'].get('finish_incomplete',0)} | {interaction['current'].get('finish_incomplete',0)} |", f"| 非工具错误的写入回执数 | {interaction['baseline']['replyBytes']['n']} | {interaction['current']['replyBytes']['n']} |", f"| 写入回执中位字节 | {interaction['baseline']['replyBytes']['median']} | {interaction['current']['replyBytes']['median']} |", f"| 写入回执总字节 | {interaction['baseline']['replyBytes']['sum']} | {interaction['current']['replyBytes']['sum']} |", '', '这里的字节是模型可见文本响应体积，不是token或账单。incomplete按每次工具回执计数；第一轮旧报告的4次是产生 task.finished 写入事件的次数，未包含一次无变化的重复检查，本表统一重数为5次。等待外部验证的内部结构检查单独记录，不算模型收到一次拒绝回执。', '', '## 每例独立复核','']
for q in sorted(qa,key=lambda x:(x['case'],x['mode'])):
 lines += [f"### {q['case']} / {q['mode']}", '',q['review'],'']
 for c in q['numericChecks']:lines.append(f"- **{c['verdict']}**：{c['claim']}；独立复算：{c['recomputed']}。来源 `{c['source']}`。")
 lines.append('')
lines+=['## 任务、验证与宿主状态','', '| 案例 | 任务状态 | 结构／当前验证凭据 | 宿主最近状态 | 独立根因联合命中 |','| --- | --- | --- | --- | --- |']
for r in state:lines.append(f"| {r['case']} | {r['status']} | {'通过' if r['structural']['ok'] else '未通过'} / {r.get('verificationStatus','未执行')}（当前完成检查{'通过' if r['completion']['ok'] else '未通过'}） | {r.get('hostExecution',{}).get('state','未观测')} | {'是' if r['independentReviewedJointTop1'] else '否'} |")
notices=sum(len(t['budgetNotices']) for r in extra['episodes'] for t in r['states'])
lines += ['',f'本轮四个 Cairn 目标均绑定宿主预算；实际收尾通知 {notices} 次。外部验证通过 {sum(r.get("verificationStatus")=="passed" for r in state)} 个目标，未运行 {sum(r.get("verificationStatus") is None for r in state)} 个。回调未运行或通过均不替代独立标签评分。','']
lines+=['','宿主状态是已观察到的生命周期事件，突然 SIGKILL 可能没有机会写入最终事件；runner 的进程终态记录作为补充。内部等待外部验证前的 structural check 缺口不等同模型收到一次失败的 finish；工具回执与 verifier 事件分别记录。', '', '## 接入试跑与额外用量', '', '正式复测前，中止启动包含两次 provider schema 400，以及一个完成的 Pi 首例和一个未完成的 Pi CPU 片段，完整回复的 token 已记录下界为 542,206。另有两次不含案例的 schema 探针（一次同因失败、一次成功），记录 token 合计 4,766。它们不混入正式性能比较，详情见本轮 startup-attempts.json；不能将正式表格理解为整个工程过程的全部消耗。', '', '## 可复核产物','',
 f"- 原始运行、工具与 provider usage：`runs/{run.name}/case-*/pi*/`。",f"- 记录一致性检查 {audit['passed']}/{audit['total']}；冻结实现／跨轮设置／宿主配置检查 {extra['passed']}/{extra['total']}。这些检查不等同内容正确性。",f"- 每例评分 `grade.json` / `reviewed-grade.json`，本轮逐项数值与语义审阅 `qualitative-audit.json`。",'- `summary.json`、`round2-audit.json`、`round2-state-validation.json`、`scope-audit.json` 和 `reference-stats.json` 单独保存。原始数据与运行日志均保留本地 ignored 目录。',f"- 路径范围检查 {scope['explicitPathChecks']} 项，显式违规标记 {len(scope['flaggedItems'])} 项；只检查可见参数和明显命令模式。模型工作区未施加 OS 沙盒，动态构造路径不能由该检查排除，不将其作为严格数据隔离证明。",'- 第一轮报告 [comparison.zh-CN.md](comparison.zh-CN.md) 保留；复现方法见 [README.zh-CN.md](README.zh-CN.md)。','']
(ROOT/'comparison-round2.zh-CN.md').write_text('\n'.join(lines))
print(ROOT/'comparison-round2.zh-CN.md')
