import type { TaskView, TaskSummary, TimelineEvent } from './view.js';
import type { Observation } from '../core/types.js';

type GraphNode = { id: string; kind: 'origin' | 'call' | 'action' | 'observation' | 'basis' | 'claim' | 'criterion'; label: string; state: string; x: number; y: number; color: string; fill: string; data: any };
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
function graphLabel(value:string){let width=0,result='';for(const char of value){const next=/[\x00-\x7f]/.test(char)?0.6:1;if(width+next>14.2)return result+'…';width+=next;result+=char;}return result;}
const kinds: Record<string, string> = {
  'task.created': '创建目标', 'task.resumed': '恢复 / 接管任务', 'task.suspended': '暂停任务', 'task.completed': '完成任务',
  'task.checkpoint': '保存检查点', 'task.finished': '更新完成状态',
  'tool.started': '开始工具调用', 'observation.captured': '记录观测', 'claim.revised': '更新假设与结论',
  'criterion.updated': '更新完成条件', 'action.updated': '更新行动', 'hint.added': '收到人工提示',
  'report.saved': '保存报告', 'delivery.recorded': '记录交付回执', 'team.confirmed': '队伍确认', 'continuation.suggested': '检查未完成事项',
};
const statuses: Record<string, string> = { proposed: '待验证', supported: '已支持', refuted: '已反驳', inconclusive: '证据不足', planned: '已规划', running: '进行中', completed: '已完成', failed: '失败', cancelled: '已取消', success: '成功', error: '失败' };
let tasks: TaskSummary[] = [], current: TaskView | undefined, selectedTask = '', selectedNode = 'origin';
let timeline: TimelineEvent[] = [], nodes = new Map<string, GraphNode>(), activeView = 'progress';
let showAllEvents=false;
let overviewMode=true,activeInspector='details',layout='vertical';
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
    const bottom = create('div', 'task-bottom'); bottom.append(create('span', '', task.owner.host), create('span', '', `${task.progress.satisfied}/${task.progress.total} 条件 · ${task.workCounts.running} 执行中`));
    button.append(top, create('div', 'task-title', task.goal), bottom); button.onclick = () => selectTask(task.id); list.append(button);
  }
  if (!shown.length) list.append(create('div', 'task-empty', tasks.length ? '没有匹配的任务。' : '等待 CLI 创建第一个任务。'));
  const cards=byId('task-cards');cards.replaceChildren();
  for(const task of shown){
    const card=create('button','task-card');card.dataset.taskId=task.id;
    const header=create('div','task-card-header');header.append(create('span','mono',task.id.slice(0,18)),create('span',`phase ${task.phase.key}`,task.phase.label));
    const progress=create('progress');progress.max=task.progress.total||1;progress.value=task.progress.satisfied;
    progress.setAttribute('aria-label',`${task.goal}：${task.progress.satisfied}/${task.progress.total} 条件已满足`);
    const bottom=create('div','task-bottom');bottom.append(create('span','',`${task.owner.host} · 更新于 ${formatTime(task.updatedAt)}`),create('span','card-open','打开任务 →'));
    card.append(header,create('h2','',task.goal),create('div','card-progress',`${task.workCounts.running} 执行中 · ${task.workCounts.completed} 已完成阶段 · ${task.workCounts.questions} 问题`),progress,bottom);
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
  text('task-id', `${task.id.slice(0, 19).toUpperCase()} · ${task.profile === 'emergency' ? '应急比赛' : '通用任务'}`);
  text('goal', task.goal); text('phase', task.phase.label); byId('phase').className = `phase ${task.phase.key}`;
  text('owner', `${task.owner.host} · ${task.owner.epoch > 1 ? `接管 ${task.owner.epoch - 1} 次` : '主会话'}`);
  text('created', `创建于 ${new Date(task.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`);
  text('criteria-count', `${task.progress.satisfied} / ${task.progress.total}`);
  const progress = byId<HTMLProgressElement>('progress'); progress.max = task.progress.total || 1; progress.value = task.progress.satisfied;
  text('updated', `最近更新 ${formatTime(task.updatedAt)}`);
  text('running-count', task.workCounts.running); text('completed-count', task.workCounts.completed); text('question-count', task.workCounts.questions);
  tick(); renderGraph(); renderProgress(); renderBasis(); renderEvents(); renderReport(); renderSidebar(); void renderDetails();
}
function tick() {
  if (!current) return;
  const deadline = current.budget.deadline, now = Date.now();
  byId('clock-stat').hidden = !deadline || current.status === 'completed';
  text('clock-label', current.profile === 'emergency' ? '比赛剩余时间' : '提醒剩余时间');
  const clock = byId('clock'); clock.classList.toggle('expired', !!deadline && Date.parse(deadline) <= now);
  clock.textContent = deadline ? formatDuration(Date.parse(deadline) - now) : '';

}
const ns = 'http://www.w3.org/2000/svg';
function svg(tag: string, attributes: Record<string, string | number> = {}, content?: string): SVGElement {
  const element = document.createElementNS(ns, tag); for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (content !== undefined) element.textContent = content; return element;
}
function renderGraph() {
  const previousSize=graphSize;
  const task = current!, columns: GraphNode[][] = [[], [], [], []]; nodes.clear();
  const add = (column: number, kind: GraphNode['kind'], id: string, label: string, state: string, data: any, color: string, fill: string) => {
    const node: GraphNode = { id, kind, label, state, data, color, fill, x: column * 290 + 15, y: 0 }; columns[column]!.push(node); nodes.set(id, node);
  };
  add(0, 'origin', 'origin', task.origin, '起点 / 已知背景', task, '#0f8d83', '#0f8d83');
  if ((task.evidenceMode ?? 'captured') === 'curated') task.claims.forEach(c => {
    if (c.basis || c.references?.length) add(1, 'basis', `basis:${c.id}`, c.basis || c.references?.[0] || 'AI 整理的依据', 'Agent 整理 · 引用可核对', c, '#6573e9', '#eef2ff');
  });
  task.observations.forEach(o => add(1, 'observation', `obs:${o.id}`, `${o.ref} · ${o.tool}`, `${statuses[o.status]}${o.eligible ? '' : ' · 不参与完成判定'}`, o, o.status === 'error' ? '#d87b89' : '#6573e9', o.status === 'error' ? '#fff1f4' : '#6573e9'));
  task.claims.forEach(c => add(2, 'claim', `claim:${c.id}`, c.text, statuses[c.status] ?? c.status, c, c.status === 'refuted' ? '#d67e8b' : '#6872d9', c.status === 'refuted' ? '#fff2f5' : c.status === 'supported' ? '#6269e4' : '#e9edff'));
  task.criteria.forEach(c => add(3, 'criterion', `criterion:${c.id}`, c.text, task.check.unmet.includes(c.id) ? '尚未满足' : '已满足', c, '#df91a5', task.check.unmet.includes(c.id) ? '#fff3f6' : '#f6b6c5'));
  const count = Math.max(...columns.map(c => c.length), 2),vertical=layout==='vertical';
  graphSize = vertical?{width:count*255+30,height:565}:{ width: 1140, height: count * 106 + 25 };
  if(!viewportCustomized&&(graphSize.width!==previousSize.width||graphSize.height!==previousSize.height))needsFit=true;
  for (const [col,column] of columns.entries()) column.forEach((node, index) => {
    if(vertical){node.x=20+index*255+(graphSize.width-column.length*255-30)/2;node.y=20+col*145;}
    else node.y = 20 + index * 106 + (graphSize.height - column.length * 106 - 25) / 2;
  });
  const world = document.getElementById('graph-world')!; world.replaceChildren();
  const edge = (from: string, to: string, refutes = false) => {
    const a = nodes.get(from), b = nodes.get(to); if (!a || !b) return;
    const x = a.x + 225, y = a.y + 38, endY = b.y + 38;
    const path=vertical?`M${a.x+112},${a.y+79} C${a.x+112},${a.y+114} ${b.x+112},${b.y-35} ${b.x+112},${b.y}`:`M${x},${y} C${x + 35},${y} ${b.x - 35},${endY} ${b.x},${endY}`;
    world.append(svg('path', { d:path, class: `edge${refutes ? ' refutes' : ''}`, 'marker-end': `url(#${refutes ? 'arrow-red' : 'arrow'})` }));
  };
  task.claims.forEach(c => { edge('origin', `basis:${c.id}`); edge(`basis:${c.id}`, `claim:${c.id}`); });
  if (!task.observations.length && !task.claims.length) task.criteria.forEach(c => edge('origin', `criterion:${c.id}`));
  task.claims.forEach(c => { c.supports.forEach(o => edge(`obs:${o}`, `claim:${c.id}`)); c.refutes.forEach(o => edge(`obs:${o}`, `claim:${c.id}`, true)); });
  task.criteria.forEach(c => c.claimIds.forEach(ref => edge(`claim:${ref}`, `criterion:${c.id}`)));
  for (const node of nodes.values()) {
    const group = svg('g', { class: `node${selectedNode === node.id ? ' selected' : ''}`, transform: `translate(${node.x},${node.y})`, role: 'button', tabindex: '0', 'aria-label': `${node.label}，${node.state}`, 'data-node-id': node.id });
    group.append(svg('rect', { width: 225, height: 79, rx: 11, fill: node.fill, stroke: node.color }));
    const title = { origin: '目标背景', action: '历史行动', call: '历史工具调用', observation: '原始观测', basis: 'AI 整理的依据', claim: '假设与结论', criterion: '完成条件' }[node.kind];
    const solid=node.kind==='origin'||node.kind==='action'||node.kind==='observation'&&node.data.status==='success'||node.kind==='claim'&&node.data.status==='supported';
    group.append(svg('text', { x: 13, y: 18, class: 'type', fill:solid?'#e1e7ff':node.color }, title));
    group.append(svg('text', { x: 13, y: 40, class: 'label', fill:solid?'#fff':node.kind==='criterion'?'#8b4764':'#535fa3' }, graphLabel(node.label)));
    group.append(svg('text', { x: 13, y: 62, class: 'state', fill:solid?'#e6ecff':node.color }, short(node.state, 27)));
    group.append(svg('title', {}, `${node.label}\n${node.state}`));
    group.addEventListener('click', () => { if (!dragged) inspect(node.id); });
    group.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); inspect(node.id); } });
    world.append(group);
  }
  if (!nodes.has(selectedNode) && !selectedNode.startsWith('work:')) selectedNode = 'origin';
  if (needsFit&&activeView==='graph') { needsFit = false; fit(); } else applyTransform();
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
  if (selectedNode.startsWith('work:')) { const item = task.workItems.find(i => `work:${i.key}` === selectedNode); if (item) { text('detail-kind', '阶段进度'); panel.append(create('div', `detail-tag ${item.status}`, item.statusLabel), create('h2', '', item.title)); if (item.detail) panel.append(create('div', 'detail-text', item.detail)); metadata(panel, '最近更新', formatTime(item.updatedAt)); metadata(panel, '来源', item.source === 'agent' ? 'Agent 报告' : item.source === 'host' ? '宿主事件' : '历史任务记录'); panel.append(create('div', 'notice', '这是最近保存的阶段状态，不代表宿主进程实时存活。')); return; } }
  const node = nodes.get(selectedNode) ?? nodes.get('origin')!; if (!node) return;
  text('detail-kind', { origin: '目标', call: '历史工具调用', action: '历史行动', observation: '原始观测', basis: 'AI 整理的依据', claim: '假设与结论', criterion: '完成条件' }[node.kind]);
  panel.append(create('div', 'detail-tag', node.state), create('h2', '', node.kind === 'origin' ? task.goal : node.label));
  if (node.kind === 'origin') {
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
  if (node.kind === 'call') {
    metadata(panel, '开始时间', formatTime(node.data.startedAt)); metadata(panel, '状态', node.state);
    const observation = task.observations.find(o => o.callId === node.data.id);
    if (observation) { heading(panel, '返回结果'); reference(panel, observation.id, 'obs'); }
    else panel.append(create('p', 'note', '尚未记录返回结果；这条状态不等同于宿主进程的实时存活证明。')); return;
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
function renderProgress() {
  const task = current!, panel = byId('progress-panel'); panel.replaceChildren();
  const lead = create('section', `progress-lead ${task.status}`);
  const label = create('div', 'progress-lead-label'); label.append(create('span', `phase ${task.phase.key}`, task.phase.label), create('span', 'note', `Agent 最近报告 · ${formatTime(task.updatedAt)}`));
  lead.append(label, create('h2', '', task.checkpoint?.summary || (task.status === 'completed' ? '目标已完成，查看下方已满足的条件。' : task.status === 'suspended' ? '任务已暂停，恢复后可继续推进。' : '目标已建立，等待 Agent 报告具体阶段。')));
  if (task.checkpoint?.next && task.status !== 'completed') lead.append(create('p', '', `下一步：${task.checkpoint.next}`));
  panel.append(lead);
  const disclaimer = task.progressSource === 'historical' ? '此任务尚未记录独立阶段，下方展示已保存的目标条件与历史行动。' : task.progressSource === 'none' ? '尚未细分执行阶段。任务处于可继续状态，不代表 Agent 正在运行。' : '执行状态来自 Agent 最近一次阶段报告，不代表进程实时存活。';
  panel.append(create('p', 'progress-note', disclaimer));
  const board = create('div', 'work-board');
  for (const [key, title, empty] of [['running', '正在执行', task.status === 'suspended' ? '任务已暂停，当前没有执行阶段。' : task.status === 'completed' ? '目标已完成，当前没有执行阶段。' : '暂无 Agent 报告的执行中阶段。'], ['completed', '已完成', '尚无单独确认完成的阶段。'], ['waiting', '待推进 / 受阻', '暂无待推进或受阻的阶段。']] as const) {
    const column = create('section', `work-column ${key}`), items = task.workGroups[key];
    const header = create('div', 'work-column-heading'); header.append(create('h3', '', title), create('span', 'count', String(items.length))); column.append(header);
    for (const item of items) {
      const card = create('button', `work-card ${item.status}`); card.dataset.progressKey = item.key;
      const top = create('div', 'work-card-top'); top.append(create('span', `work-state ${item.status}`, item.statusLabel), create('span', 'work-source', item.source === 'agent' ? 'Agent 报告' : item.source === 'host' ? '宿主记录' : '历史记录'));
      card.append(top, create('h4', '', item.title)); if (item.detail) card.append(create('p', '', short(item.detail, 90)));
      card.append(create('small', '', `更新于 ${formatTime(item.updatedAt)}`)); card.onclick = () => { selectedNode = `work:${item.key}`; switchInspector('details'); void renderDetails(); }; column.append(card);
    }
    if (!items.length) column.append(create('div', 'work-empty', empty)); board.append(column);
  }
  panel.append(board);
  const criteria = create('section', 'goal-coverage'); criteria.append(create('h3', '', '目标完成条件'), create('p', 'note', `${task.progress.satisfied} / ${task.progress.total} 已满足 · 阶段完成不等于目标完成，以这些条件为最终检查。`));
  for (const item of task.criteria) { const met = !task.check.unmet.includes(item.id), button = create('button', `criterion coverage-row${met ? '' : ' open'}`); button.append(create('span', 'tick', met ? '✓' : '○'), create('span', '', item.text), create('small', '', met ? '已满足' : '待满足')); button.onclick = () => inspect(`criterion:${item.id}`); criteria.append(button); } panel.append(criteria);
  if (task.checkpoint?.questions.length) { const questions = create('section', 'open-questions'); questions.append(create('h3', '', '未解决问题')); task.checkpoint.questions.forEach(q => questions.append(create('p', '', q))); panel.append(questions); }
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
  const task = current!, panel = byId('report-panel'); panel.replaceChildren(create('h2', 'panel-title', '诊断与交付报告'));
  if (!task.report) { panel.append(create('p', 'note', '尚未保存报告。Agent 记录检查点或完成任务时，会按结论及其证据生成报告引用。')); return; }
  if(task.reportCheck&&!task.reportCheck.ok)panel.append(create('div','notice',`报告仍需补齐：${task.reportCheck.issues.join('；')}`));
  const section = (title: string, value: string | undefined) => { if (!value) return; const block = create('section', 'report-section'); block.append(create('h3', '', title), create('p', '', value)); panel.append(block); };
  section('结论摘要', task.report.summary); section('影响面', task.report.impact?.text);
  section(`根因${task.report.rootCause ? ` · ${{symptom:'现象级',service:'服务级',code:'代码级',root:'根因级'}[task.report.rootCause.level]}` : ''}`, task.report.rootCause?.text);
  section('触发因', task.report.rootCause?.trigger); section('放大机制', task.report.rootCause?.amplification);
  section('应急止血', task.report.solution?.mitigation); section('根因修复', task.report.solution?.fix); section('防复发', task.report.solution?.prevention);
  section('交付状态', task.delivered ? task.confirmedAt ? '已有交付回执，队伍已确认。' : '已有交付回执。' : task.profile==='emergency'?'尚未记录外部交付回执。':task.status==='completed'?'报告已保存，任务已完成。':'报告已保存，等待任务完成检查。');
  const citations = create('section', 'report-section'); citations.append(create('h3', '', '引用证据'));
  for (const item of task.report.curatedReferences ?? []) { const card = create('div', 'curated-citation'); card.append(create('p', '', item.statement)); if (item.basis) card.append(create('p', 'note', item.basis)); for (const ref of item.references) sourceReference(card, ref); citations.append(card); }
  for (const citation of task.report.citations) { reference(citations, citation.observationId, 'obs'); citations.append(create('p', 'note', citation.statement)); } panel.append(citations);
}
function switchView(view: string) {
  activeView = view;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => { const selected = button.dataset.view === view; button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); });
  for (const name of ['progress', 'basis', 'graph', 'timeline', 'report']) byId(`${name}-panel`).hidden = name !== view;
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
byId('show-goal').onclick = () => inspect('origin');
byId('snapshot').onclick=()=>{if(current)location.href=`/api/tasks/${encodeURIComponent(current.id)}/export?format=html`;};
byId('back-to-list').onclick=()=>{overviewMode=true;selectedTask='';current=undefined;detailGeneration++;history.replaceState(null,'',location.pathname);applyMode();void refresh();};
byId<HTMLSelectElement>('layout').onchange=()=>{layout=byId<HTMLSelectElement>('layout').value;needsFit=true;renderGraph();};
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
