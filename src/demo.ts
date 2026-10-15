import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as pause } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from './core/store.js';
import { CairnError, type Task } from './core/types.js';
import { gatewaySchema } from './gateway.js';
import { markdown, html } from './export.js';
import { readDemoScenario } from './demo-tools.js';
import { VERSION } from './version.js';

export interface DemoWorkspace { root: string; db: string; scenarioPath: string; promptPath: string }
export interface DemoStep {
  seq: number; name: string; phase: 'running' | 'suspended' | 'resumed' | 'completed' | 'aborted' | 'failed';
  at: string; demo: true; taskId?: string; detail?: string; pid?: number;
  tool?: string; arguments?: unknown; result?: unknown;
}
export interface DemoOptions {
  root: string; db: string; entry: string; delayMs?: number; signal?: AbortSignal;
  onStep?: (step: DemoStep) => void | Promise<void>;
}
export interface DemoResult {
  root: string; db: string; taskId: string; status: 'completed';
  reportPath: string; evidencePath: string; taskPath: string; executionPath: string;
}
const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const writeNew = (path: string, value: unknown) => writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const fixtureNames = ['service_health', 'price_sample', 'client_mapping', 'version_impact'];
const demoGateway = (root: string, entry: string) => gatewaySchema.parse({ servers: { demo: { command: process.execPath, args: [resolve(entry), 'demo-tools', '--root', resolve(root)] } }, tools: fixtureNames.map(name => ({ name, server: 'demo', upstream: name, role: 'read', resultRefPath: 'result_ref', scopePaths: { workspaceId: 'workspace_id' } })) });

/** Prepare a fresh, isolated workspace; never replace an existing scenario or task database. */
export function prepareDemo(requestedRoot?: string, entry = join(dirname(fileURLToPath(import.meta.url)), 'cairn.mjs')): DemoWorkspace {
  const root = requestedRoot ? resolve(requestedRoot) : mkdtempSync(join(tmpdir(), 'cairn-demo-'));
  if (requestedRoot) {
    if (existsSync(root)) {
      if (!lstatSync(root).isDirectory() || readdirSync(root).length) throw new CairnError('demo_directory_not_empty', 'Demo directory must be a new or empty directory; existing data is never overwritten');
    } else mkdirSync(root, { recursive: true, mode: 0o700 });
  }
  const db = join(root, '.cairn', 'state.db'), scenarioPath = join(root, 'scenario.json'), promptPath = join(root, 'PROMPT.md');
  const marker = { demo: true, origin: 'Cairn 本地虚构演示数据；不是线上观测或真实模型排障', workspace_id: 'demo-price-unit', captured_at: '2026-01-01T00:00:00.000Z' };
  const scenario = {
    demo: true, kind: 'cairn-price-unit-demo', schemaVersion: 1,
    origin: '本地确定性演示（虚构数据、general profile、无模型账号）',
    goal: '演示：定位自选股价格显示放大 100 倍的机制，确认影响范围并提出处置建议',
    criteria: ['用原始工具证据解释源价格与显示价格相差 100 倍的机制，并审查服务崩溃假设', '用版本分布证据确认影响范围，并交付止损、修复和预防建议'],
    budget: { maxCalls: 6, maxParallel: 2 },
    fixtures: {
      service_health: { ...marker, result_ref: 'demo:service-health', service: 'quote-display', process: 'healthy', crash_count: 0, success_rate: 1, window: 'fixture-window-001' },
      price_sample: {
        '1.4': { ...marker, result_ref: 'demo:price-sample-v1.4', symbol: 'DEMO.600001', version: '1.4', source: { value: 10.26, unit: 'CNY' }, display: { value: 1026, unit: 'CNY' }, ratio: 100 },
        '1.5': { ...marker, result_ref: 'demo:price-sample-v1.5', symbol: 'DEMO.600001', version: '1.5', source: { value: 10.26, unit: 'CNY' }, display: { value: 10.26, unit: 'CNY' }, ratio: 1 },
      },
      client_mapping: {
        '1.4': { ...marker, result_ref: 'demo:client-mapping-v1.4', version: '1.4', input_unit: 'CNY', output_unit: 'CNY', expression: 'display_price = source_price * 100', expected_expression: 'display_price = source_price', issue: '输入已是元，旧客户端仍重复乘以 100' },
        '1.5': { ...marker, result_ref: 'demo:client-mapping-v1.5', version: '1.5', input_unit: 'CNY', output_unit: 'CNY', expression: 'display_price = source_price', issue: null },
      },
      version_impact: { ...marker, result_ref: 'demo:version-impact', service: 'quote-display', window: 'fixture-window-001', total_users: 1000, affected_users: 300, affected_ratio: 0.3, versions: [{ version: '1.4', users: 300, affected: true }, { version: '1.5', users: 700, affected: false }], limitation: '仅覆盖此虚构窗口内这 1000 名用户，不能外推至真实生产环境' },
    },
  };
  writeNew(scenarioPath, scenario);
  writeNew(promptPath, `# Cairn 完整链路样例\n\n这是本地虚构诊断练习；所有结果都有 demo:true 和 demo: 引用。它不连接生产系统。\n\n## 在真实 CLI 中执行\n\n\`cairn demo --prepare --root DIR\` 会生成本目录。随后执行：\n\n1. \`cairn install --target codex --root DIR\`（可换成 pi 或 claude）；如果使用 \`cairn demo --prepare --target HOST\`，对应适配包已安装，无需重复。\n2. 进入 DIR 后先执行 \`export CAIRN_DB=${shellQuote(db)}\`，确保目录即使位于其他 Git 仓库内也使用本样例数据库；再启动对应 CLI，完成它要求的插件信任步骤，并把下面任务交给 Agent。\n3. 另一个终端运行 \`cairn ui --db ${shellQuote(db)}\` 查看同一个数据库。\n\n## 给 Agent 的任务\n\n开始前先核对 CAIRN_DB 是否准确指向本目录的 .cairn/state.db（${db}）；如果数据库不符，先停止并报告，避免写入父仓库的任务库。\n\n使用 Cairn 处理这个 general 任务：${scenario.goal}。以“本地虚构演示”为来源，约束为只使用当前的只读 demo 工具，工具预算 maxCalls=6、maxParallel=2。完成条件：\n\n${scenario.criteria.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n请调用 cairn_start 开始；使用 Cairn 暴露的 typed 工具 cairn_tool_service_health、cairn_tool_price_sample、cairn_tool_client_mapping、cairn_tool_version_impact 取证。工具参数从它们的 schema 获取：服务 quote-display，样例代码 DEMO.600001，客户端版本 1.4（1.5 可作对照）。原始证据由 Gateway 自动保存，结论引用实际返回的 E#，不要自行捏造引用。\n\n先查健康和价格样例，在 cairn_checkpoint 中记录服务崩溃的反证、当前结论和未解决问题；然后用 cairn_finish(outcome=suspended) 暂停。告诉我任务 ID 后结束此会话。下一次会话用 cairn_resume(task_id=实际任务ID,takeover=true) 显式接管，读取恢复上下文，补查单位映射与影响范围，一次 cairn_finish 提交结论、条件覆盖和报告。每条已支持的 finding 用 covers 关联 c1/c2；反驳用 against。报告给出止损、修复、预防建议，明确建议尚未在真实系统执行。\n\n## 无模型账号的演示\n\n\`cairn demo\` 由确定性 driver 执行相同五工具协议，并启动蓝白看板；\`cairn demo --no-ui --delay 0\` 执行后退出。它测试真实 stdio MCP、Gateway、暂停与新连接接管，不评估模型推理能力，也不冒充三种原生 CLI。完成后导出 report.md、evidence.html、task.json、execution.jsonl。\n`);
  const config = demoGateway(root, entry);
  writeNew(join(root, 'whitelist.json'), config);
  if (existsSync(db)) throw new CairnError('demo_directory_not_empty', 'Demo database already exists');
  const store = new Store(db);
  try { store.setConfig('gateway', config); } finally { store.close(); }
  return { root, db, scenarioPath, promptPath };
}

/** Use the same stdio MCP interface as a compatible CLI, including a real closed-session takeover. */
export async function runDemo(options: DemoOptions): Promise<DemoResult> {
  const { root, db, entry, signal } = options, scenario = readDemoScenario(root);
  if (resolve(db) !== join(resolve(root), '.cairn', 'state.db') || !existsSync(db)) throw new CairnError('invalid_demo_database', 'Use the isolated database created by prepareDemo in this demo directory');
  const configurationStore = new Store(db);
  try {
    if (JSON.stringify(configurationStore.config('gateway')) !== JSON.stringify(demoGateway(root, entry))) throw new CairnError('demo_config_changed', 'The deterministic demo only runs with its original local read-only fixture whitelist; prepare a fresh demo');
  } finally { configurationStore.close(); }
  const delayMs = options.delayMs ?? 900;
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 60000) throw new CairnError('invalid_input', 'Demo delay must be between 0 and 60000 milliseconds');
  const executionPath = join(root, 'execution.jsonl');
  writeNew(executionPath, '');
  let seq = 0, taskId: string | undefined, client: Client | undefined, transport: StdioClientTransport | undefined;
  const artifacts = { reportPath: join(root, 'report.md'), evidencePath: join(root, 'evidence.html'), taskPath: join(root, 'task.json'), executionPath };
  const emit = async (name: string, extra: Partial<DemoStep> = {}, notify = true) => {
    const step: DemoStep = { seq: ++seq, at: new Date().toISOString(), demo: true, phase: 'running', name, ...(taskId ? { taskId } : {}), ...extra };
    appendFileSync(executionPath, JSON.stringify(step) + '\n');
    if (notify) await options.onStep?.(step);
  };
  const wait = async () => { signal?.throwIfAborted(); if (delayMs) await pause(delayMs, undefined, { signal }); signal?.throwIfAborted(); };
  const close = async () => {
    const current = client, currentTransport = transport;
    client = undefined; transport = undefined;
    if (current) {
      await current.close().catch(() => {});
      // Also cover a transport created before client.connect failed.
      await currentTransport?.close().catch(() => {});
      await emit('mcp.closed', { pid: currentTransport?.pid ?? undefined }, false);
    }
  };
  const connect = async (sessionId: string) => {
    signal?.throwIfAborted();
    client = new Client({ name: 'cairn-deterministic-demo', version: VERSION });
    transport = new StdioClientTransport({ command: process.execPath, args: [resolve(entry), 'mcp', '--db', resolve(db), '--root', resolve(root), '--host', 'mcp', '--session-id', sessionId], cwd: root, stderr: 'pipe' });
    // Drain stderr without mixing warnings into MCP stdout or user-facing demo steps.
    let stderr = '';
    transport.stderr?.on('data', data => { stderr = (stderr + String(data)).slice(-4000); });
    try { await client.connect(transport, { timeout: 10000, signal }); }
    catch (error) { throw new CairnError('demo_mcp_failed', `${(error as Error).message}${stderr ? `\n${stderr}` : ''}`); }
    await emit('mcp.connected', { detail: sessionId, pid: transport.pid ?? undefined });
    signal?.throwIfAborted();
    const catalog = await client.listTools(undefined, { signal });
    const expected = ['cairn_start', 'cairn_resume', 'cairn_read', 'cairn_checkpoint', 'cairn_finish', ...Object.keys(scenario.fixtures).map(name => `cairn_tool_${name}`)];
    for (const name of expected) if (!catalog.tools.some(t => t.name === name)) throw new CairnError('demo_missing_tool', `MCP catalog is missing ${name}`);
    await emit('mcp.catalog', { detail: expected.join(', ') });
  };
  const call = async (tool: string, args: Record<string, unknown>, phase: DemoStep['phase'] = 'running') => {
    signal?.throwIfAborted();
    if (!client) throw new CairnError('demo_disconnected', 'Demo MCP connection is closed');
    const result = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 10000, signal });
    if (result.isError) throw new CairnError('demo_tool_failed', `${tool}: ${JSON.stringify(result.content)}`);
    const value = (result.structuredContent as { result?: any } | undefined)?.result;
    if (value === undefined) throw new CairnError('demo_invalid_result', `Missing structured result for ${tool}`);
    if (tool === 'cairn_start') taskId = value.taskId;
    const detail: Record<string, string> = {
      cairn_start: '建立目标与完成条件；工具预算 6 次、并发上限 2',
      cairn_tool_service_health: 'E1：虚构窗口内进程健康，未发现崩溃',
      cairn_tool_price_sample: 'E2：源价格 10.26 元，1.4 显示 1026 元',
      cairn_checkpoint: '保存崩溃假设反证、阶段结论和两个未解决问题',
      cairn_resume: '新会话显式接管；恢复目标、证据索引和未解决问题',
      cairn_tool_client_mapping: 'E3：单位已经是元，1.4 仍重复乘以 100',
      cairn_tool_version_impact: 'E4：虚构窗口内 1.4 的 300/1000 用户受影响',
      cairn_finish: args.outcome === 'suspended' ? '暂停任务并持久化；随后关闭旧 MCP 连接' : '校验目标覆盖与证据引用后完成报告',
    };
    await emit(tool, { phase:value.phase==='completed'?'completed':phase, tool, arguments: args, result: value, detail: detail[tool] });
    await wait();
    return value;
  };
  const snapshot = (): Task | undefined => {
    if (!taskId) return;
    const store = new Store(db);
    try { return store.get(taskId); } finally { store.close(); }
  };
  const exportSnapshot = (task: Task) => {
    writeNew(artifacts.taskPath, task);
    writeNew(artifacts.reportPath, `> 本地虚构数据演示；流程由确定性 driver 执行，未调用模型，建议未在真实系统执行。\n\n${markdown(task)}`);
    writeNew(artifacts.evidencePath, html(task));
  };
  try {
    await emit('demo.started', { detail: 'Local fixture data; actual stdio MCP and Gateway; no model or native CLI is impersonated.' });
    await connect('demo-first-session');
    await call('cairn_start', { origin: scenario.origin, goal: scenario.goal, criteria: scenario.criteria, constraints: ['仅使用本地虚构只读工具；不要访问生产系统', '建议尚未执行；结论只覆盖虚构样例窗口'], profile: 'general', scope: { workspaceId: 'demo-price-unit' }, budget: scenario.budget });
    await call('cairn_tool_service_health', { service: 'quote-display' });
    await call('cairn_tool_price_sample', { symbol: 'DEMO.600001', version: '1.4' });
    await call('cairn_checkpoint', {
      summary: '本地样例源价格 10.26 元、显示 1026 元，相差 100 倍；健康工具未发现进程崩溃。需要进一步查单位映射与版本影响范围。',
      findings: [
        { key: 'crash', text: '价格异常由 quote-display 进程崩溃引起', status: 'refuted', against: ['E1'] },
        { key: 'price-ratio', text: '1.4 客户端将样例源价格 10.26 元显示为 1026 元，放大 100 倍', evidence: ['E2'] },
      ],
      questions: ['1.4 客户端是否对已经是元的价格重复换算？', '这次虚构窗口中哪些版本、多少用户受影响？'],
      next: '新会话显式接管后查询 client_mapping 和 version_impact；补齐目标证据后交付建议。',
    });
    await call('cairn_finish', { outcome: 'suspended' }, 'suspended');
    await close();
    signal?.throwIfAborted();
    await connect('demo-resumed-session');
    const context = await call('cairn_resume', { task_id: taskId!, takeover: true }, 'resumed');
    if (context.owner?.epoch !== 2 || context.checkpoint?.questions?.length !== 2) throw new CairnError('demo_restore_failed', 'Takeover did not preserve the checkpoint and its questions');
    await call('cairn_tool_client_mapping', { version: '1.4' });
    await call('cairn_tool_version_impact', { service: 'quote-display' });
    const finished = await call('cairn_finish', {
      outcome: 'completed',
      summary: '本地虚构样例：源价格已经是元，1.4 客户端重复乘以 100，导致 10.26 元显示为 1026 元；进程健康证据反驳崩溃假设。该窗口仅 1.4 的 300/1000 用户受影响（30%）。建议止损为回退显示映射或引导升级 1.5，修复为按明确单位只换算一次，预防为增加单位契约与版本回归测试；这些建议尚未执行。',
      findings: [
        { key: 'unit-conversion', text: '1.4 的输入已经是 CNY 元，代码却再次乘以 100，与 10.26→1026 的样例吻合；进程崩溃假设已由 E1 反驳', evidence: ['E1', 'E2', 'E3'], covers: ['c1'] },
        { key: 'impact', text: '虚构窗口中 1.4 的 300 名用户受影响，占总计 1000 人的 30%；1.5 的 700 名用户未受影响。建议回退映射或升级、删除重复换算并增加单位契约及版本回归测试，尚未执行', evidence: ['E2', 'E3', 'E4'], covers: ['c2'] },
      ],
      questions: [], next: '演示已完成；真实环境需要实际验证修复效果。',
      report: {
        impact: { text: '仅此虚构窗口：1.4 客户端 300/1000 用户（30%）；1.5 不受影响，不能外推至生产环境。', scope: { workspaceId: 'demo-price-unit' }, observationIds: ['E4'] },
        rootCause: { text: '1.4 对单位已为 CNY 元的输入再次乘以 100。', level: 'code', trigger: '1.4 客户端读取已是元的源价格', amplification: '重复乘以 100 放大显示值' },
        solution: { mitigation: '建议回退该映射或引导 1.4 用户升级 1.5；未实际执行。', fix: '建议移除已是元时的重复乘以 100，按输入单位显式转换一次。', prevention: '建议加入价格单位契约、10.26 元样例与 1.4/1.5 对照回归，并监控源显示比值。' },
      },
    });
    if (finished.phase !== 'completed' || !finished.validation?.ok) throw new CairnError('demo_incomplete', `Demo completion validation failed: ${JSON.stringify(finished.validation)}`);
    await close();
    signal?.throwIfAborted();
    const task = snapshot();
    if (!task || task.status !== 'completed') throw new CairnError('demo_incomplete', 'Task was not durably completed');
    exportSnapshot(task);
    await emit('demo.completed', { phase: 'completed', detail: 'report.md, evidence.html, task.json and execution.jsonl saved.' });
    return { root, db, taskId: task.id, status: 'completed', ...artifacts };
  } catch (error) {
    const aborted = signal?.aborted || (error as Error).name === 'AbortError';
    // Preserve partial work through the current connection only. Never create a replacement session after an interruption.
    if (taskId && client && snapshot()?.status === 'active') {
      await client.callTool({ name: 'cairn_finish', arguments: { outcome: 'suspended', summary: aborted ? '本地演示被用户中断；保留当前证据，未完成诊断。' : '本地演示发生错误；保留当前证据，未完成诊断。' } }, undefined, { timeout: 2000 }).catch(() => {});
    }
    await close();
    const task = snapshot();
    if (task && !existsSync(artifacts.taskPath)) exportSnapshot(task);
    await emit(aborted ? 'demo.aborted' : 'demo.failed', { phase: aborted ? 'aborted' : 'failed', detail: (error as Error).message }, false);
    throw error;
  } finally { await close(); }
}
