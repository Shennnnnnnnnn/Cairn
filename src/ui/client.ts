import type { TaskView, TaskSummary, TimelineEvent } from './view.js';
import type { Observation } from '../core/types.js';
import { projectGraph, layoutGraph, graphNodeSize, graphPalette, graphKindLabels } from './graph.js';
import type { GraphNode } from './graph.js';

type PositionedNode = GraphNode & { x: number; y: number };
const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const create = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element;
};
const text = (id: string, value: unknown) => { byId(id).textContent = String(value); };
const formatTime = (value: string) => new Date(value).toLocaleTimeString('zh-CN', { hour12: false });
const formatDuration = (ms: number) => {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
};
const short = (value: string, length = 24) => [...value].length > length ? [...value].slice(0, length - 1).join('') + '…' : value;
function graphLines(value: string, maxWidth = 15.2): string[] {
  const lines: string[] = []; let line = '', width = 0;
  for (const char of value.replace(/\s+/g, ' ').trim()) {
    const next = /[\x00-\x7f]/.test(char) ? .56 : 1;
    if (width + next > maxWidth) { lines.push(line); line = ''; width = 0; if (lines.length === 2) break; }
    line += char; width += next;
  }
  if (line && lines.length < 2) lines.push(line);
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (lines.join('').length < normalized.length && lines[1]) lines[1] = lines[1].slice(0, -1) + '…';
  return lines.length ? lines : ['未命名'];
}
const kinds: Record<string, string> = {
  'task.created': '创建目标', 'task.resumed': '恢复 / 接管任务', 'task.suspended': '暂停任务', 'task.completed': '完成任务',
  'task.checkpoint': '保存检查点', 'task.finished': '更新完成状态',
  'tool.started': '开始工具调用', 'observation.captured': '记录观测', 'claim.revised': '更新假设与结论',
  'criterion.updated': '更新完成条件', 'action.updated': '更新行动', 'hint.added': '收到人工提示',
  'report.saved': '保存报告', 'continuation.suggested': '检查未完成事项',
};
const statuses: Record<string, string> = { proposed: '待验证', supported: '已支持', refuted: '已反驳', inconclusive: '证据不足', planned: '已规划', running: '进行中', completed: '已完成', failed: '失败', cancelled: '已取消', success: '成功', error: '失败' };
let tasks: TaskSummary[] = [], current: TaskView | undefined, selectedTask = '', selectedNode = 'origin';
let timeline: TimelineEvent[] = [], nodes = new Map<string, PositionedNode>(), activeView = 'graph';
let showAllEvents=false;
let overviewMode=true,activeInspector='details',layout: 'vertical' | 'horizontal' = 'horizontal';
let refreshBusy = false, refreshAgain = false, detailGeneration = 0;
let graphSize = { width: 1180, height: 260 }, transform = { x: 15, y: 15, scale: .7 }, needsFit = true;
let viewportCustomized=false;
const rawCache = new Map<string, Observation>();
try { selectedTask = decodeURIComponent(location.hash.slice(1)); } catch { /* invalid fragments return to the task overview */ }
overviewMode=!selectedTask;

async function request<T>(path: string): Promise<T> {
  const response = await fetch(path, { cache: 'no-store' });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? `请求失败 (${response.status})`); return result;
}
function showError(error?: unknown) { const banner = byId('error'); banner.hidden = !error; if (error) banner.textContent = `暂时无法更新：${(error as Error).message}`; }
function renderTasks() {
  const query = byId<HTMLInputElement>('search').value.trim().toLowerCase(), filter = byId<HTMLSelectElement>('filter').value;
  const list = byId('tasks'); list.replaceChildren(); text('task-count', tasks.length);
  const shown = tasks.filter(t => (filter === 'all' || t.status === filter) && `${t.goal} ${t.id}`.toLowerCase().includes(query));
  for (const task of shown) {
    const button = create('button', `task${task.id === selectedTask ? ' selected' : ''}`); button.dataset.taskId = task.id;
    button.setAttribute('aria-current', task.id === selectedTask ? 'true' : 'false');
    const top = create('div', 'task-top'); top.append(create('i', `dot ${task.status}`), create('span', '', task.phase.label));
    const bottom = create('div', 'task-bottom'); bottom.append(create('span', '', task.owner.host), create('span', '', `${task.progress.satisfied}/${task.progress.total} 目标条件`));
    button.append(top, create('div', 'task-title', task.goal), bottom); button.onclick = () => selectTask(task.id); list.append(button);
  }
  if (!shown.length) list.append(create('div', 'task-empty', tasks.length ? '没有匹配的任务。' : '等待 CLI 创建第一个任务。'));
  const cards=byId('task-cards');cards.replaceChildren();
  for(const task of shown){
    const card=create('button','task-card');card.dataset.taskId=task.id;
    const header=create('div','task-card-header');header.append(create('span','mono',task.id.slice(0,18)),create('span',`phase ${task.phase.key}`,task.phase.label));
    const bottom=create('div','task-bottom');bottom.append(create('span','',`${task.owner.host} · 更新于 ${formatTime(task.updatedAt)}`),create('span','card-open','打开任务 →'));
    card.append(header,create('h2','',task.goal),create('div','card-summary',`${task.progress.satisfied}/${task.progress.total} 目标条件已满足 · ${task.metrics.supported} 条已形成结论`),bottom);
    card.onclick=()=>selectTask(task.id);cards.append(card);
  }
  if(!shown.length)cards.append(create('div','task-empty','没有匹配的任务。'));
}
function applyMode(){
  document.body.classList.toggle('detail-mode',!overviewMode);
  byId(overviewMode?'global-status':'head-status').append(byId('connection'));
  byId('overview').hidden=!overviewMode||!tasks.length;byId('empty').hidden=!overviewMode||!!tasks.length;byId('task-view').hidden=overviewMode;
}
function selectTask(id: string) {
  overviewMode=false;applyMode();
  if (selectedTask !== id) { selectedTask = id; selectedNode = 'origin'; needsFit = true; current = undefined; rawCache.clear(); }
  history.replaceState(null, '', `#${encodeURIComponent(id)}`); renderTasks(); void refresh();
}
async function refresh() {
  if (refreshBusy) { refreshAgain = true; return; }
  refreshBusy = true;
  try {
    do {
      refreshAgain = false;
      const list = await request<{ tasks: TaskSummary[] }>('/api/tasks'); tasks = list.tasks;
      if (!overviewMode&&!tasks.some(t => t.id === selectedTask)) { selectedTask = ''; overviewMode=true;selectedNode = 'origin'; needsFit = true; }
      renderTasks();
      applyMode();
      if (overviewMode) { current = undefined; showError(); continue; }
      const requestedId = selectedTask;
      const [task, events] = await Promise.all([
        request<TaskView>(`/api/tasks/${encodeURIComponent(requestedId)}`),
        request<{ events: TimelineEvent[] }>(`/api/tasks/${encodeURIComponent(requestedId)}/events`),
      ]);
      if (requestedId !== selectedTask) { refreshAgain = true; continue; }
      current = task; timeline = events.events; renderCurrent(); showError();
    } while (refreshAgain);
  } catch (error) { showError(error); }
  finally { refreshBusy = false; }
}
function renderCurrent() {
  const task = current!;
  text('task-id', `${task.id.slice(0, 19).toUpperCase()} · 通用任务`);
  text('goal', task.goal); text('phase', task.phase.label); byId('phase').className = `phase ${task.phase.key}`;
  text('owner', `${task.owner.host} · ${task.owner.epoch > 1 ? `接管 ${task.owner.epoch - 1} 次` : '主会话'}`);
  text('created', `创建于 ${new Date(task.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`);
  text('updated', `最近更新 ${formatTime(task.updatedAt)}`);
  tick(); renderGraph(); renderBasis(); renderEvents(); renderReport(); renderSidebar(); void renderDetails();
}
function tick() {
  if (!current) return;
  const deadline = current.budget.deadline, now = Date.now();
  byId('clock-stat').hidden = !deadline || current.status === 'completed';
  text('clock-label', '提醒剩余时间');
  const clock = byId('clock'); clock.classList.toggle('expired', !!deadline && Date.parse(deadline) <= now);
  clock.textContent = deadline ? formatDuration(Date.parse(deadline) - now) : '';

}
const ns = 'http://www.w3.org/2000/svg';
function svg(tag: string, attributes: Record<string, string | number> = {}, content?: string): SVGElement {
  const element = document.createElementNS(ns, tag); for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (content !== undefined) element.textContent = content; return element;
}
function renderGraph() {
  const previousSize = graphSize, task = current!, projection = layoutGraph(projectGraph(task), layout);
  graphSize = { width: projection.width, height: projection.height };
  nodes = new Map(projection.nodes.map(node => [node.id, node]));
  if (!viewportCustomized && (graphSize.width !== previousSize.width || graphSize.height !== previousSize.height)) needsFit = true;
  const world = document.getElementById('graph-world')!; world.replaceChildren();
  const vertical = layout === 'vertical', { width, height } = graphNodeSize;
  for (const edge of projection.edges) {
    const a = nodes.get(edge.from)!, b = nodes.get(edge.to)!;
    const path = vertical
      ? `M${a.x + width / 2},${a.y + height} C${a.x + width / 2},${a.y + height + 34} ${b.x + width / 2},${b.y - 34} ${b.x + width / 2},${b.y}`
      : `M${a.x + width},${a.y + height / 2} C${a.x + width + 35},${a.y + height / 2} ${b.x - 35},${b.y + height / 2} ${b.x},${b.y + height / 2}`;
    const marker = edge.state === 'running' ? 'arrow-running' : edge.state === 'refuted' ? 'arrow-red' : edge.state === 'pending' || edge.state === 'context' ? 'arrow-pending' : 'arrow';
    const line = svg('path', { d: path, class: `edge ${edge.state} relation-${edge.relation}`, 'marker-end': `url(#${marker})`, 'data-edge-from': edge.from, 'data-edge-to': edge.to, 'data-relation': edge.relation });
    line.append(svg('title', {}, { context: '背景与记录', stage: '任务包含此执行阶段，不表示阶段依赖顺序', basis: '已登记依据', supports: '支持结论', refutes: '反驳结论', criterion: '结论关联此目标条件', goal: '目标与验收条件' }[edge.relation])); world.append(line);
  }
  for (const node of nodes.values()) {
    const palette = graphPalette[node.status], group = svg('g', { class: `node status-${node.status}${selectedNode === node.id ? ' selected' : ''}`, transform: `translate(${node.x},${node.y})`, role: 'button', tabindex: '0', 'aria-label': `${graphKindLabels[node.kind]}：${node.label}，${node.state}`, 'data-node-id': node.id, 'data-node-kind': node.kind, 'data-node-status': node.status });
    group.append(svg('rect', { width, height, rx: 11, fill: palette.fill, stroke: palette.stroke }));
    group.append(svg('text', { x: 13, y: 18, class: 'type', fill: palette.muted }, graphKindLabels[node.kind]));
    const lines = graphLines(node.label);
    lines.forEach((line, i) => group.append(svg('text', { x: 13, y: lines.length === 1 ? 47 : 40 + i * 18, class: 'label', fill: palette.text }, line)));
    group.append(svg('text', { x: 13, y: 80, class: 'state', fill: palette.muted }, short(node.state, 27)));
    const met = node.kind === 'goal' ? task.status === 'completed' || task.check.ok : node.kind === 'criterion' ? !task.check.unmet.includes(node.data.id) : node.status === 'completed';
    if (met) {
      group.append(svg('circle', { cx: width - 17, cy: 16, r: 8, fill: node.status === 'goal' ? '#d1fae5' : '#eef2ff' }));
      group.append(svg('text', { x: width - 17, y: 20, 'text-anchor': 'middle', class: 'node-tick', fill: node.status === 'goal' ? '#047857' : '#4f46e5' }, '✓'));
    }
    group.append(svg('title', {}, `${graphKindLabels[node.kind]} · ${node.label}\n${node.state}`));
    group.addEventListener('click', () => { if (!dragged) inspect(node.id); });
    group.addEventListener('keydown', event => { if ((event as KeyboardEvent).key === 'Enter' || (event as KeyboardEvent).key === ' ') { event.preventDefault(); inspect(node.id); } });
    world.append(group);
  }
  if (!nodes.has(selectedNode)) selectedNode = 'origin';
  if (needsFit && activeView === 'graph') { needsFit = false; fit(); } else applyTransform();
}
function inspect(id: string) { selectedNode = id;switchInspector('details'); document.querySelectorAll<SVGElement>('.node').forEach(node => node.classList.toggle('selected', node.dataset.nodeId === id)); void renderDetails(); }
function applyTransform() { document.getElementById('graph-world')!.setAttribute('transform', `translate(${transform.x},${transform.y}) scale(${transform.scale})`); }
function fit() {
  viewportCustomized=false;
  const rect = byId('graph').getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) { needsFit = true; return; }
  transform.scale = Math.max(.1, Math.min(1.1, (rect.width - 45) / graphSize.width, (rect.height - 45) / graphSize.height));
  transform.x = (rect.width - graphSize.width * transform.scale) / 2; transform.y = (rect.height - graphSize.height * transform.scale) / 2; applyTransform();
}
function zoom(factor: number, x?: number, y?: number) {
  viewportCustomized=true;
  const rect = byId('graph').getBoundingClientRect(), mx = x ?? rect.width / 2, my = y ?? rect.height / 2;
  const scale = Math.min(2.5, Math.max(.08, transform.scale * factor)), ratio = scale / transform.scale;
  transform.x = mx - (mx - transform.x) * ratio; transform.y = my - (my - transform.y) * ratio; transform.scale = scale; applyTransform();
}
let dragged = false, drag: { x: number; y: number; tx: number; ty: number } | undefined;
const graph = byId('graph');
graph.onpointerdown = event => { if (event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y }; dragged = false; };
graph.onpointermove = event => { if (!drag) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) { if(!graph.hasPointerCapture(event.pointerId))graph.setPointerCapture(event.pointerId);dragged = true;viewportCustomized=true; graph.classList.add('dragging'); transform.x = drag.tx + dx; transform.y = drag.ty + dy; applyTransform(); } };
graph.onpointerup = event => { drag = undefined; graph.classList.remove('dragging'); if (graph.hasPointerCapture(event.pointerId)) graph.releasePointerCapture(event.pointerId); setTimeout(() => { dragged = false; }, 0); };
graph.onpointercancel = () => { drag = undefined; dragged = false; graph.classList.remove('dragging'); };
window.addEventListener('pointerup',()=>{drag=undefined;graph.classList.remove('dragging');setTimeout(()=>{dragged=false;},0);});
graph.addEventListener('wheel', event => { event.preventDefault(); const rect = graph.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .0015), event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });
byId('zoom-in').onclick = () => zoom(1.2); byId('zoom-out').onclick = () => zoom(1 / 1.2); byId('fit').onclick = fit;

function metadata(parent: HTMLElement, key: string, value: unknown) { const row = create('div', 'meta'); row.append(create('span', '', key), create('span', '', String(value ?? '—'))); parent.append(row); }
function heading(parent: HTMLElement, value: string) { parent.append(create('h3', '', value)); }
function reference(parent: HTMLElement, id: string, kind: 'obs' | 'claim') {
  const node = nodes.get(`${kind}:${id}`), button = create('button', 'ref-button', node ? `${kind === 'obs' ? '↗ 原始观测' : '↗ 结论'} · ${short(node.label, 30)}` : id);
  button.onclick = () => { switchView('graph'); inspect(`${kind}:${id}`); }; parent.append(button);
}
async function renderDetails() {
  const task = current; if (!task) return;
  const generation = ++detailGeneration, panel = byId('details'); panel.replaceChildren();
  if (selectedNode.startsWith('work:')) { const item = task.workItems.find(i => `work:${i.key}` === selectedNode); if (item) { text('detail-kind', '执行阶段'); panel.append(create('div', `detail-tag ${item.status}`, item.statusLabel), create('h2', '', item.title)); if (item.detail) panel.append(create('div', 'detail-text', item.detail)); metadata(panel, '最近更新', formatTime(item.updatedAt)); metadata(panel, '来源', item.source === 'agent' ? 'Agent 报告' : item.source === 'host' ? '宿主事件' : '历史任务记录'); panel.append(create('div', 'notice', '这是最近保存的阶段状态，不代表宿主进程实时存活。')); return; } }
  const node = nodes.get(selectedNode) ?? nodes.get('origin')!; if (!node) return;
  text('detail-kind', graphKindLabels[node.kind]);
  panel.append(create('div', 'detail-tag', node.state), create('h2', '', node.kind === 'origin' || node.kind === 'goal' ? task.goal : node.label));
  if (node.kind === 'origin' || node.kind === 'goal') {
    if(task.checkpoint){
      heading(panel,'最新进展');panel.append(create('div','detail-text',task.checkpoint.summary));
      metadata(panel,'检查点时间',formatTime(task.checkpoint.at));
      if(task.checkpoint.questions.length){heading(panel,'未解决问题');for(const question of task.checkpoint.questions)panel.append(create('div','detail-text',`· ${question}`));}
      if(task.checkpoint.next&&task.status!=='completed'){heading(panel,'下一步');panel.append(create('div','detail-text',task.checkpoint.next));}
    }
    heading(panel, '已知背景'); panel.append(create('div', 'detail-text', task.origin));
    heading(panel, '完成条件');
    for (const c of task.criteria) {
      const unmet = task.check.unmet.includes(c.id), row = create('div', `criterion${unmet ? ' open' : ''}`);
      row.append(create('span', 'tick', unmet ? '○' : '✓'), create('span', '', c.text)); panel.append(row);
    }
    if (task.constraints?.length) { heading(panel, '任务约束'); task.constraints.forEach(c => panel.append(create('div', 'detail-text', `· ${c}`))); }
    if (task.hints.length) { heading(panel, '人工提示'); task.hints.forEach(h => { panel.append(create('div', 'detail-text', h.text), create('small', 'note', `来自 ${h.author}`)); }); }
    panel.append(create('div', 'notice', task.evidenceMode === 'curated' ? '依据与引用由 Agent 整理。文件或链接是否真实支持结论，需要结合原文判断；系统不把它们标记为已自动验证。' : '目标条件是否满足由保存的结论与依据关联计算。原始工具记录放在「结论与依据」的高级记录中。'));
    return;
  }
  if (node.kind === 'criterion') {
    metadata(panel, '条件编号', node.data.id); metadata(panel, '当前状态', node.state);
    heading(panel, '关联结论'); node.data.claimIds.forEach((id: string) => reference(panel, id, 'claim'));
    if (!node.data.claimIds.length) panel.append(create('p', 'note', '尚未关联有证据支持的结论。')); return;
  }
  if (node.kind === 'claim' || node.kind === 'basis') {
    if (node.kind === 'basis') panel.append(create('div', 'detail-text', node.data.text));
    metadata(panel, '结论修订', node.data.revision); metadata(panel, '当前状态', statuses[node.data.status] ?? node.data.status);
    metadata(panel, '依据来源', node.data.provenance === 'agent' ? 'AI 整理' : '采集记录与 Agent 解释');
    if (node.data.basis) { heading(panel, '整理的依据'); panel.append(create('div', 'detail-text', node.data.basis)); }
    if (node.data.references?.length) { heading(panel, '文件与链接引用'); for (const ref of node.data.references) sourceReference(panel, ref); }
    if (node.data.supports.length) { heading(panel, '支持的原始观测'); node.data.supports.forEach((id: string) => reference(panel, id, 'obs')); }
    if (node.data.refutes.length) { heading(panel, '反驳的原始观测'); node.data.refutes.forEach((id: string) => reference(panel, id, 'obs')); }
    if (!node.data.basis && !node.data.references?.length && !node.data.supports.length && !node.data.refutes.length) panel.append(create('p', 'note', '尚未记录具体依据。'));
    return;
  }
  if (node.kind === 'action') {
    heading(panel, '停止条件'); panel.append(create('div', 'detail-text', node.data.stopCondition));
    heading(panel, '行动结果'); node.data.observationIds.forEach((id: string) => reference(panel, id, 'obs')); return;
  }
  metadata(panel,'证据编号',node.data.ref);metadata(panel, '记录时间', formatTime(node.data.capturedAt)); metadata(panel, '来源', { hook: '宿主自动采集', gateway: '受控网关', manual: '手动登记' }[node.data.source as string]);
  metadata(panel, '可用于完成判定', node.data.eligible ? '是（仍需判断证据相关性）' : '否，迟到或任务已停止');
  if (node.data.actor) metadata(panel, '采集会话', `${node.data.actor.host} · ${node.data.actor.sessionId.slice(0, 12)}`);
  if (node.data.resultRef) metadata(panel, 'result_ref', node.data.resultRef);
  const loading = create('p', 'note', '正在读取原始记录…'); panel.append(loading);
  try {
    const cacheKey = `${task.id}:${node.data.id}`;
    let observation = rawCache.get(cacheKey);
    if (!observation) { observation = await request<Observation>(`/api/tasks/${encodeURIComponent(task.id)}/observations/${encodeURIComponent(node.data.id)}`); rawCache.set(cacheKey, observation); }
    if (generation !== detailGeneration || task.id !== current?.id) return;
    loading.remove(); heading(panel, '调用参数'); panel.append(create('pre', 'raw', JSON.stringify(observation.input, null, 2)));
    heading(panel, '原始返回'); panel.append(create('pre', 'raw', JSON.stringify(observation.output, null, 2)));
  } catch (error) { if (generation === detailGeneration) loading.textContent = (error as Error).message; }
}
function sourceReference(parent: HTMLElement, value: string) {
  let url: URL | undefined; try { const parsed = new URL(value); if (['http:', 'https:'].includes(parsed.protocol)) url = parsed; } catch { /* Local paths are displayed without opening or reading files. */ }
  if (url) { const link = create('a', 'source-reference', value); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; parent.append(link); }
  else parent.append(create('div', 'source-reference file-reference', value));
}

function renderBasis() {
  const task = current!, panel = byId('basis-panel'); panel.replaceChildren(create('h2', 'panel-title', '结论与依据'));
  panel.append(create('p', 'note', task.evidenceMode === 'curated' ? '保留 Agent 整理的依据、结论及文件 / 链接引用。引用的真实性和因果支持程度由 Agent 与用户核对。' : '结论解释和原始观测分别保留。原始工具记录可在下方高级记录中展开。'));
  for (const claim of task.claims) {
    const card = create('section', `basis-card ${claim.status}`), top = create('div', 'basis-header');
    top.append(create('span', `pill ${claim.status}`, statuses[claim.status]), create('span', 'note', claim.provenance === 'agent' ? 'AI 整理的依据' : '采集记录与 Agent 解释'));
    card.append(top, create('h3', '', claim.text));
    if (claim.basis) card.append(create('p', 'basis-text', claim.basis));
    if (claim.references?.length) { const refs = create('div', 'source-references'); for (const ref of claim.references) sourceReference(refs, ref); card.append(refs); }
    if (claim.supports.length || claim.refutes.length) { const refs = create('div', 'source-references'); claim.supports.forEach(id => reference(refs, id, 'obs')); claim.refutes.forEach(id => reference(refs, id, 'obs')); card.append(refs); }
    if (!claim.basis && !claim.references?.length && !claim.supports.length && !claim.refutes.length) card.append(create('p', 'note', '尚未补充具体依据。'));
    const open = create('button', 'text-button', '查看结论详情 →'); open.onclick = () => inspect(`claim:${claim.id}`); card.append(open); panel.append(card);
  }
  if (!task.claims.length) panel.append(create('div', 'work-empty', '尚未保存结论与依据。Agent 推进到有价值的阶段后会同步到这里。'));
  if ((task.evidenceMode ?? 'captured') === 'captured') {
    const advanced = create('details', 'advanced-records'); advanced.append(create('summary', '', `历史取证记录（高级） · ${task.metrics.observations} 条原始观测`));
    advanced.append(create('p', 'note', `历史取证次数 ${task.metrics.calls}${task.budget.maxCalls ? ` / ${task.budget.maxCalls}` : ''}。次数用于限制采集成本，不是目标完成标准。`));
    const records = create('div');
    for (const observation of task.observations) { const button = create('button', 'call-row'); button.append(create('span', 'call-name', `${observation.ref} · ${observation.tool}`), create('span', 'pill', statuses[observation.status]), create('small', '', formatTime(observation.capturedAt))); button.onclick = () => inspect(`obs:${observation.id}`); records.append(button); }
    for (const [id, call] of Object.entries(task.calls).filter(([id]) => !task.observations.some(o => o.callId === id))) { const row = create('div', 'call-row'); row.append(create('span', 'call-name', call.tool), create('span', 'pill', task.status !== 'active' ? '未记录返回 / 会话已停止' : call.status === 'running' ? '最近记录等待返回' : '已结束')); records.append(row); }
    if (!task.observations.length && !Object.keys(task.calls).length) records.append(create('p', 'note', '没有保存原始工具记录。')); advanced.append(records); panel.append(advanced);
  }
}
function eventElement(event: TimelineEvent, full = false) {
  const row = create('article', full ? `timeline-event ${event.status ?? event.category}` : 'mini-event');
  const time = create('time', 'event-time', formatTime(event.at)); time.dateTime = event.at;
  const content = create('div', 'event-card'); const header = create('div', 'event-card-heading'); header.append(create('strong', '', event.title || kinds[event.kind] || '更新任务记录'), time); content.append(header);
  if (event.summary) content.append(create('p', 'event-summary', short(event.summary, full ? 130 : 50)));
  if (event.detail || (event.summary?.length ?? 0) > 130) { const details = create('details', 'event-details'); details.append(create('summary', '', '展开详情')); if (event.summary?.length > 130) details.append(create('p', '', event.summary)); if (event.detail) details.append(create('p', '', event.detail)); content.append(details); }
  if (event.observationId) { const button = create('button', 'event-link', '查看原始依据 →'); button.onclick = () => inspect(`obs:${event.observationId}`); content.append(button); }
  row.append(content); return row;
}
function renderEvents() {
  const recent = byId('recent-events'), full = byId('timeline-panel'); recent.replaceChildren(); full.replaceChildren();
  const header = create('div', 'timeline-heading'); header.append(create('h2', 'panel-title', '任务时间线'));
  if ((current!.evidenceMode ?? 'captured') === 'captured') { const label = create('label', 'timeline-filter'), checkbox = create('input'); checkbox.type = 'checkbox'; checkbox.checked = showAllEvents; checkbox.onchange = () => { showAllEvents = checkbox.checked; renderEvents(); }; label.append(checkbox, document.createTextNode('包括历史取证记录')); header.append(label); }
  full.append(header, create('p', 'note', '按时间展示目标、阶段进展、暂停、接管和完成检查。'));
  const milestones = timeline.filter(e => e.category !== 'advanced'), shown = showAllEvents ? timeline : milestones;
  for (const event of milestones.slice(-4).reverse()) recent.append(eventElement(event));
  const list = create('div', 'timeline-list'); for (const event of shown) list.append(eventElement(event, true)); full.append(list);
  if (!shown.length) full.append(create('p', 'note', '尚无阶段进展记录。'));
  if (timeline.length) { text('last-updated', `最近记录 ${formatTime(timeline.at(-1)!.at)}`); full.append(create('p', 'note', '显示最近 100 条保存记录中的关键进展。'));
  } else recent.append(create('p', 'note', '下一次任务变化会自动显示在这里。'));
}
function renderReport() {
  const task = current!, panel = byId('report-panel'); panel.replaceChildren(create('h2', 'panel-title', '任务结果与依据'));
  if (!task.report) { panel.append(create('p', 'note', '尚未保存报告。Agent 记录检查点或完成任务时，会按结论及其证据生成报告引用。')); return; }
  if(task.reportCheck&&!task.reportCheck.ok)panel.append(create('div','notice',`报告仍需补齐：${task.reportCheck.issues.join('；')}`));
  const section = (title: string, value: string | undefined) => { if (!value) return; const block = create('section', 'report-section'); block.append(create('h3', '', title), create('p', '', value)); panel.append(block); };
  section('结果总结', task.report.summary);
  section('完成状态', task.status==='completed'?'目标条件与依据校验已通过，任务已完成。':'报告已保存，等待目标完成检查。');
  const citations = create('section', 'report-section'); citations.append(create('h3', '', '引用证据'));
  for (const item of task.report.curatedReferences ?? []) { const card = create('div', 'curated-citation'); card.append(create('p', '', item.statement)); if (item.basis) card.append(create('p', 'note', item.basis)); for (const ref of item.references) sourceReference(card, ref); citations.append(card); }
  for (const citation of task.report.citations) { reference(citations, citation.observationId, 'obs'); citations.append(create('p', 'note', citation.statement)); } panel.append(citations);
}
function switchView(view: string) {
  activeView = view;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => { const selected = button.dataset.view === view; button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); });
  for (const name of ['basis', 'graph', 'timeline', 'report']) byId(`${name}-panel`).hidden = name !== view;
  if (view === 'graph') requestAnimationFrame(() => { if (needsFit) { needsFit = false; fit(); } });
}
function switchInspector(name:string){
  activeInspector=name;
  document.querySelectorAll<HTMLButtonElement>('[data-inspector]').forEach(button=>{const active=button.dataset.inspector===name;button.classList.toggle('active',active);button.setAttribute('aria-selected',String(active));});
  byId('details').hidden=name!=='details';byId('hints-panel').hidden=name!=='hints';byId('log-panel').hidden=name!=='log';
  document.querySelector<HTMLElement>('.detail-kindbar')!.hidden=name!=='details';
}
function renderSidebar(){
  text('hint-count',current!.hints.length);
  const hints=byId('hints-panel');hints.replaceChildren();
  for(const hint of current!.hints){const card=create('div','hint-card');card.append(create('p','',hint.text),create('small','',`人工提示 · ${hint.author}`));hints.append(card);}
  if(!current!.hints.length)hints.append(create('p','note','暂无人工提示。在 CLI 中补充的 Hint 会同步到这里。'));
  const logs=byId('log-panel');logs.replaceChildren();for(const event of timeline.filter(e=>e.category!=='advanced').slice(-12).reverse())logs.append(eventElement(event,true));
  if(!timeline.length)logs.append(create('p','note','尚无任务事件。'));
  switchInspector(activeInspector);
}
document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => { button.onclick = () => switchView(button.dataset.view!); });
byId<HTMLInputElement>('search').oninput = renderTasks; byId<HTMLSelectElement>('filter').onchange = renderTasks;
byId('show-goal').onclick = () => inspect('goal');
byId('snapshot').onclick=()=>{if(current)location.href=`/api/tasks/${encodeURIComponent(current.id)}/export?format=html`;};
byId('back-to-list').onclick=()=>{overviewMode=true;selectedTask='';current=undefined;detailGeneration++;history.replaceState(null,'',location.pathname);applyMode();void refresh();};
byId<HTMLSelectElement>('layout').onchange=()=>{layout=byId<HTMLSelectElement>('layout').value === 'vertical' ? 'vertical' : 'horizontal';needsFit=true;renderGraph();};
document.querySelectorAll<HTMLButtonElement>('[data-inspector]').forEach(button=>{button.onclick=()=>switchInspector(button.dataset.inspector!);});
byId('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await byId('graph-wrap').requestFullscreen();}catch(error){showError(error);}};
document.addEventListener('fullscreenchange',()=>{const button=byId('fullscreen');button.setAttribute('aria-label',document.fullscreenElement?'退出全屏':'全屏画布');requestAnimationFrame(fit);});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.fullscreenElement)void document.exitFullscreen().catch(showError);});
const resizer=byId('panel-resizer'),board=document.querySelector<HTMLElement>('.board')!;
const resizePanel=(width:number)=>{const value=Math.max(270,Math.min(width,Math.min(700,board.clientWidth*.6)));board.style.setProperty('--inspector-width',`${value}px`);resizer.setAttribute('aria-valuenow',String(Math.round(value)));};
resizer.onpointerdown=event=>{event.preventDefault();resizer.setPointerCapture(event.pointerId);};
resizer.onpointermove=event=>{if(resizer.hasPointerCapture(event.pointerId))resizePanel(board.getBoundingClientRect().right-event.clientX);};
resizer.onpointerup=event=>{if(resizer.hasPointerCapture(event.pointerId))resizer.releasePointerCapture(event.pointerId);};
resizer.onkeydown=event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();resizePanel(document.querySelector<HTMLElement>('.inspector')!.getBoundingClientRect().width+(event.key==='ArrowLeft'?20:-20));}};
byId('download').onclick = () => { if (current) location.href = `/api/tasks/${encodeURIComponent(current.id)}/export?format=markdown`; };
new ResizeObserver(() => { if (current && activeView === 'graph') fit(); }).observe(graph);
const stream = new EventSource('/api/stream');
stream.addEventListener('ready', () => { byId('connection').classList.remove('offline'); byId('connection').lastElementChild!.textContent = '实时同步'; void refresh(); });
stream.addEventListener('change', () => { void refresh(); });
stream.onerror = () => { byId('connection').classList.add('offline'); byId('connection').lastElementChild!.textContent = '正在重连'; };
window.addEventListener('pagehide', () => stream.close());
setInterval(tick, 1000);
void refresh();
