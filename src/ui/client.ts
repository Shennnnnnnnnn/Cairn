import type { TaskView, TaskSummary } from './view.js';
import type { Observation } from '../core/types.js';

type TimelineEvent = { seq: number; kind: string; at: string; subject: string; observationId?: string };
type GraphNode = { id: string; kind: 'origin' | 'call' | 'action' | 'observation' | 'claim' | 'criterion'; label: string; state: string; x: number; y: number; color: string; fill: string; data: any };
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
let timeline: TimelineEvent[] = [], nodes = new Map<string, GraphNode>(), activeView = 'graph';
let overviewMode=true,activeInspector='details',layout='vertical';
let refreshBusy = false, refreshAgain = false, detailGeneration = 0;
let graphSize = { width: 1180, height: 260 }, transform = { x: 15, y: 15, scale: .7 }, needsFit = true;
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
    const bottom = create('div', 'task-bottom'); bottom.append(create('span', '', task.owner.host), create('span', '', `${task.progress.satisfied}/${task.progress.total} 条件 · ${task.metrics.observations} 观测`));
    button.append(top, create('div', 'task-title', task.goal), bottom); button.onclick = () => selectTask(task.id); list.append(button);
  }
  if (!shown.length) list.append(create('div', 'task-empty', tasks.length ? '没有匹配的任务。' : '等待 CLI 创建第一个任务。'));
  const cards=byId('task-cards');cards.replaceChildren();
  for(const task of shown){
    const card=create('button','task-card');card.dataset.taskId=task.id;
    const header=create('div','task-card-header');header.append(create('span','mono',task.id.slice(0,18)),create('span',`phase ${task.phase.key}`,task.phase.label));
    const progress=create('progress');progress.max=task.progress.total||1;progress.value=task.progress.satisfied;
    progress.setAttribute('aria-label',`${task.goal}：${task.progress.satisfied}/${task.progress.total} 条件已满足`);
    const bottom=create('div','task-bottom');bottom.append(create('span','',`${task.owner.host} · ${task.metrics.observations} 观测`),create('span','card-open','打开任务 →'));
    card.append(header,create('h2','',task.goal),create('div','card-progress',`${task.progress.satisfied} / ${task.progress.total} 完成条件 · ${task.metrics.inFlight} 在途调用`),progress,bottom);
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
  text('observation-count', task.metrics.observations); text('running-count', task.metrics.inFlight);
  text('call-budget', task.budget.maxCalls ? `累计 ${task.metrics.calls} / ${task.budget.maxCalls} 次` : `累计 ${task.metrics.calls} 次`);
  tick(); renderGraph(); renderEvents(); renderCalls(); renderReport(); renderSidebar();void renderDetails();
}
function tick() {
  if (!current) return;
  const deadline = current.budget.deadline, now = Date.now();
  text('clock-label', deadline ? '剩余任务预算' : current.status === 'completed' ? '创建时间' : '任务经过时间');
  const clock = byId('clock'); clock.classList.toggle('expired', !!deadline && Date.parse(deadline) <= now);
  clock.textContent = deadline ? formatDuration(Date.parse(deadline) - now) : current.status === 'completed' ? formatTime(current.createdAt) : formatDuration(now - Date.parse(current.createdAt));
  document.querySelectorAll<HTMLElement>('[data-started-at]').forEach(element => { element.textContent = formatDuration(now - Date.parse(element.dataset.startedAt!)); });
}
const ns = 'http://www.w3.org/2000/svg';
function svg(tag: string, attributes: Record<string, string | number> = {}, content?: string): SVGElement {
  const element = document.createElementNS(ns, tag); for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (content !== undefined) element.textContent = content; return element;
}
function renderGraph() {
  const task = current!, columns: GraphNode[][] = [[], [], [], []]; nodes.clear();
  const add = (column: number, kind: GraphNode['kind'], id: string, label: string, state: string, data: any, color: string, fill: string) => {
    const node: GraphNode = { id, kind, label, state, data, color, fill, x: column * 290 + 15, y: 0 }; columns[column]!.push(node); nodes.set(id, node);
  };
  add(0, 'origin', 'origin', task.origin, '起点 / 已知背景', task, '#0f8d83', '#0f8d83');
  task.actions.forEach(a => add(0, 'action', `action:${a.id}`, a.purpose, statuses[a.status] ?? a.status, a, '#6875e8', '#6875e8'));
  const actionObservations=new Set(task.actions.flatMap(a=>a.observationIds));
  Object.entries(task.calls).filter(([id,c])=>c.status==='running'||!task.observations.some(o=>o.callId===id&&actionObservations.has(o.id))).forEach(([id, c]) => add(0, 'call', `call:${id}`, c.tool, c.status === 'running' ? '进行中' : '调用已结束', { id, ...c }, '#8190df', '#eef2ff'));
  task.observations.forEach(o => add(1, 'observation', `obs:${o.id}`, `${o.ref} · ${o.tool}`, `${statuses[o.status]}${o.eligible ? '' : ' · 不参与完成判定'}`, o, o.status === 'error' ? '#d87b89' : '#6573e9', o.status === 'error' ? '#fff1f4' : '#6573e9'));
  task.claims.forEach(c => add(2, 'claim', `claim:${c.id}`, c.text, statuses[c.status] ?? c.status, c, c.status === 'refuted' ? '#d67e8b' : '#6872d9', c.status === 'refuted' ? '#fff2f5' : c.status === 'supported' ? '#6269e4' : '#e9edff'));
  task.criteria.forEach(c => add(3, 'criterion', `criterion:${c.id}`, c.text, task.check.unmet.includes(c.id) ? '尚未满足' : '已满足', c, '#df91a5', task.check.unmet.includes(c.id) ? '#fff3f6' : '#f6b6c5'));
  const count = Math.max(...columns.map(c => c.length), 2),vertical=layout==='vertical';
  graphSize = vertical?{width:count*255+30,height:565}:{ width: 1140, height: count * 106 + 25 };
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
  task.actions.forEach(a => a.observationIds.forEach(o => edge(`action:${a.id}`, `obs:${o}`)));
  task.observations.forEach(o => edge(`call:${o.callId}`, `obs:${o.id}`));
  task.claims.forEach(c => { c.supports.forEach(o => edge(`obs:${o}`, `claim:${c.id}`)); c.refutes.forEach(o => edge(`obs:${o}`, `claim:${c.id}`, true)); });
  task.criteria.forEach(c => c.claimIds.forEach(ref => edge(`claim:${ref}`, `criterion:${c.id}`)));
  for (const node of nodes.values()) {
    const group = svg('g', { class: `node${selectedNode === node.id ? ' selected' : ''}`, transform: `translate(${node.x},${node.y})`, role: 'button', tabindex: '0', 'aria-label': `${node.label}，${node.state}`, 'data-node-id': node.id });
    group.append(svg('rect', { width: 225, height: 79, rx: 11, fill: node.fill, stroke: node.color }));
    const title = { origin: 'ORIGIN', action: 'ACTION', call: 'TOOL CALL', observation: 'OBSERVATION', claim: 'CLAIM', criterion: 'GOAL CRITERION' }[node.kind];
    const solid=node.kind==='origin'||node.kind==='action'||node.kind==='observation'&&node.data.status==='success'||node.kind==='claim'&&node.data.status==='supported';
    group.append(svg('text', { x: 13, y: 18, class: 'type', fill:solid?'#e1e7ff':node.color }, title));
    group.append(svg('text', { x: 13, y: 40, class: 'label', fill:solid?'#fff':node.kind==='criterion'?'#8b4764':'#535fa3' }, graphLabel(node.label)));
    group.append(svg('text', { x: 13, y: 62, class: 'state', fill:solid?'#e6ecff':node.color }, short(node.state, 27)));
    group.append(svg('title', {}, `${node.label}\n${node.state}`));
    group.addEventListener('click', () => { if (!dragged) inspect(node.id); });
    group.addEventListener('keydown', e => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); inspect(node.id); } });
    world.append(group);
  }
  if (!nodes.has(selectedNode)) selectedNode = 'origin';
  if (needsFit) { fit(); needsFit = false; } else applyTransform();
}
function inspect(id: string) { selectedNode = id;switchInspector('details'); document.querySelectorAll<SVGElement>('.node').forEach(node => node.classList.toggle('selected', node.dataset.nodeId === id)); void renderDetails(); }
function applyTransform() { document.getElementById('graph-world')!.setAttribute('transform', `translate(${transform.x},${transform.y}) scale(${transform.scale})`); }
function fit() {
  const rect = byId('graph').getBoundingClientRect();
  transform.scale = Math.max(.1, Math.min(1.1, (rect.width - 45) / graphSize.width, (rect.height - 45) / graphSize.height));
  transform.x = (rect.width - graphSize.width * transform.scale) / 2; transform.y = (rect.height - graphSize.height * transform.scale) / 2; applyTransform();
}
function zoom(factor: number, x?: number, y?: number) {
  const rect = byId('graph').getBoundingClientRect(), mx = x ?? rect.width / 2, my = y ?? rect.height / 2;
  const scale = Math.min(2.5, Math.max(.08, transform.scale * factor)), ratio = scale / transform.scale;
  transform.x = mx - (mx - transform.x) * ratio; transform.y = my - (my - transform.y) * ratio; transform.scale = scale; applyTransform();
}
let dragged = false, drag: { x: number; y: number; tx: number; ty: number } | undefined;
const graph = byId('graph');
graph.onpointerdown = event => { if (event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y }; dragged = false; };
graph.onpointermove = event => { if (!drag) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) { if(!graph.hasPointerCapture(event.pointerId))graph.setPointerCapture(event.pointerId);dragged = true; graph.classList.add('dragging'); transform.x = drag.tx + dx; transform.y = drag.ty + dy; applyTransform(); } };
graph.onpointerup = event => { drag = undefined; graph.classList.remove('dragging'); if (graph.hasPointerCapture(event.pointerId)) graph.releasePointerCapture(event.pointerId); setTimeout(() => { dragged = false; }, 0); };
graph.onpointercancel = () => { drag = undefined; dragged = false; graph.classList.remove('dragging'); };
window.addEventListener('pointerup',()=>{drag=undefined;graph.classList.remove('dragging');setTimeout(()=>{dragged=false;},0);});
graph.addEventListener('wheel', event => { event.preventDefault(); const rect = graph.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .0015), event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });
byId('zoom-in').onclick = () => zoom(1.2); byId('zoom-out').onclick = () => zoom(1 / 1.2); byId('fit').onclick = fit;

function metadata(parent: HTMLElement, key: string, value: unknown) { const row = create('div', 'meta'); row.append(create('span', '', key), create('span', '', String(value ?? '—'))); parent.append(row); }
function heading(parent: HTMLElement, value: string) { parent.append(create('h3', '', value)); }
function reference(parent: HTMLElement, id: string, kind: 'obs' | 'claim') {
  const node = nodes.get(`${kind}:${id}`), button = create('button', 'ref-button', node ? `${kind === 'obs' ? '↗ 观测' : '↗ 结论'} · ${short(node.label, 30)}` : id);
  button.onclick = () => { switchView('graph'); inspect(`${kind}:${id}`); }; parent.append(button);
}
async function renderDetails() {
  const task = current; if (!task) return;
  const generation = ++detailGeneration, panel = byId('details'); panel.replaceChildren();
  const node = nodes.get(selectedNode) ?? nodes.get('origin')!; if (!node) return;
  text('detail-kind', { origin: 'GOAL', call: 'TOOL CALL', action: 'ACTION', observation: 'OBSERVATION', claim: 'CLAIM', criterion: 'CRITERION' }[node.kind]);
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
    panel.append(create('div', 'notice', task.phase.key === 'starting' ? '开局先做最有价值的一步。简单目标可直接完成，复杂问题随证据调整方向。当前还没有工具调用。' : '连线表示行动与证据的记录关联。判断业务因果时，还需核对原始结果及反证。'));
    return;
  }
  if (node.kind === 'criterion') {
    metadata(panel, '条件编号', node.data.id); metadata(panel, '当前状态', node.state);
    heading(panel, '关联结论'); node.data.claimIds.forEach((id: string) => reference(panel, id, 'claim'));
    if (!node.data.claimIds.length) panel.append(create('p', 'note', '尚未关联有证据支持的结论。')); return;
  }
  if (node.kind === 'claim') {
    metadata(panel, '结论修订', node.data.revision); metadata(panel, '当前状态', node.state);
    heading(panel, '支持证据'); node.data.supports.forEach((id: string) => reference(panel, id, 'obs'));
    heading(panel, '反驳证据'); node.data.refutes.forEach((id: string) => reference(panel, id, 'obs'));
    if (!node.data.supports.length && !node.data.refutes.length) panel.append(create('p', 'note', '这是待验证的假设，还没有关联观测。')); return;
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
function eventElement(event: TimelineEvent, full = false) {
  const row = create('div', full ? 'timeline-row' : 'mini-event'); row.append(create('span', 'event-time', formatTime(event.at)));
  const content = create('div', full ? '' : 'event-text');
  content.append(create(full ? 'strong' : 'span', '', kinds[event.kind] ?? event.kind));
  if (event.subject) content.append(create(full ? 'p' : 'span', '', `${full ? '' : ' · '}${short(String(event.subject), full ? 180 : 50)}`)); row.append(content);
  if (event.observationId) { const button = create('button', 'event-link', '查看'); button.onclick = () => inspect(`obs:${event.observationId}`); row.append(button); }
  return row;
}
function renderEvents() {
  const recent = byId('recent-events'), full = byId('timeline-panel'); recent.replaceChildren(); full.replaceChildren(create('h2', 'panel-title', '任务时间线'));
  for (const event of timeline.slice(-4).reverse()) recent.append(eventElement(event));
  for (const event of [...timeline].reverse()) full.append(eventElement(event, true));
  if (!timeline.length) { recent.append(create('p', 'note', '下一次任务变化会自动显示在这里。')); full.append(create('p', 'note', '尚无审计事件。')); }
  else { text('last-updated', `最近记录 ${formatTime(timeline.at(-1)!.at)}`); full.append(create('p', 'note', '显示最近 100 条事件，完整审计记录可通过 Cairn 工具读取。')); }
}
function renderCalls() {
  const task = current!, panel = byId('calls-panel'); panel.replaceChildren(create('h2', 'panel-title', '工具调用记录'));
  for (const [id, call] of Object.entries(task.calls).sort((a, b) => b[1].startedAt.localeCompare(a[1].startedAt))) {
    const observation = task.observations.find(o => o.callId === id), button = create('button', 'call-row');
    button.append(create('span', 'call-name mono', call.tool));
    const label = call.status === 'running' ? '进行中' : observation ? statuses[observation.status] : '已结束 / 已接管';
    button.append(create('span', `pill${call.status === 'running' ? ' running' : observation?.status === 'error' ? ' error' : ''}`, label));
    const duration = create('small', 'mono', formatTime(call.startedAt)); if (call.status === 'running') duration.dataset.startedAt = call.startedAt;
    button.append(duration); button.onclick = () => inspect(observation ? `obs:${observation.id}` : `call:${id}`); panel.append(button);
  }
  if (!Object.keys(task.calls).length) panel.append(create('p', 'note', '尚未开始工具调用。主 Agent 可以直接选择最有价值的一步推进。'));
  for (const observation of task.observations.filter(o => !task.calls[o.callId])) {
    const button = create('button', 'call-row'); button.append(create('span', 'call-name', observation.tool), create('span', 'pill', observation.source === 'manual' ? '手动登记' : '已采集观测')); button.onclick = () => inspect(`obs:${observation.id}`); panel.append(button);
  }
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
  for (const citation of task.report.citations) { reference(citations, citation.observationId, 'obs'); citations.append(create('p', 'note', citation.statement)); } panel.append(citations);
}
function switchView(view: string) {
  activeView = view;
  document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach(button => { const selected = button.dataset.view === view; button.classList.toggle('active', selected); button.setAttribute('aria-selected', String(selected)); });
  for (const name of ['graph', 'calls', 'timeline', 'report']) byId(`${name}-panel`).hidden = name !== view;
  if (view === 'graph') requestAnimationFrame(() => { if (needsFit) { fit(); needsFit = false; } });
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
  const logs=byId('log-panel');logs.replaceChildren();for(const event of [...timeline].reverse())logs.append(eventElement(event,true));
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
