import type { TaskView, TaskSummary, TimelineEvent, ReplayPage, ReplayState } from './view.js';
import { usageTime, elapsedLabel } from './usage.js';
import type { Observation } from '../core/types.js';
import { projectGraph, layoutGraph, graphNodeSize, graphPalette, graphKindLabels } from './graph.js';
import type { GraphNode } from './graph.js';
import { compareCheckpoint, checkpointActors, type CheckpointDelta } from './replay.js';
import { ReplayClock, replayTimeline, replayDueOffset, replayIndexAt, type ReplayTimeline } from './replay-clock.js';

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
  'task.checkpoint': '保存阶段进展', 'task.finished': '更新完成状态',
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
let replayActive = false, replayPlaying = false, replayFrames: TimelineEvent[] = [], replayIndex = -1;
let replayTimer: ReturnType<typeof setTimeout> | undefined, replayGeneration = 0, replayMissing = 0, replayChanged = false;
let replayDelta: CheckpointDelta | undefined;
let replayFollow = true;
let replayAxis: ReplayTimeline = replayTimeline([]), replayClock = new ReplayClock(0), replayLoading = false;
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
    card.append(header,create('h2','',task.goal),create('div','card-summary',`${task.progress.satisfied}/${task.progress.total} 目标条件已满足 · ${task.metrics.supported} 条已形成结论${task.branchCounts.total?` · ${task.branchCounts.total} 个排查分支`:''}`),bottom);
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
  resetReplay();
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
      if (!overviewMode&&!tasks.some(t => t.id === selectedTask)) { resetReplay(); selectedTask = ''; overviewMode=true;selectedNode = 'origin'; needsFit = true; }
      renderTasks();
      applyMode();
      if (overviewMode) { current = undefined; showError(); continue; }
      if (replayActive) { renderReplay(); continue; }
      const requestedId = selectedTask;
      const [task, events] = await Promise.all([
        request<TaskView>(`/api/tasks/${encodeURIComponent(requestedId)}`),
        request<{ events: TimelineEvent[] }>(`/api/tasks/${encodeURIComponent(requestedId)}/events`),
      ]);
      if (requestedId !== selectedTask || replayActive) { refreshAgain = true; continue; }
      current = task; timeline = events.events; renderCurrent(); showError();
    } while (refreshAgain);
  } catch (error) { showError(error); }
  finally { refreshBusy = false; }
}
function stopReplayPlayback() {
  replayPlaying = false;
  replayClock.pause();
  if (replayTimer !== undefined) clearTimeout(replayTimer);
  replayTimer = undefined;
}
function resetReplay() {
  stopReplayPlayback(); replayGeneration++; replayActive = false; replayFrames = []; replayIndex = -1;
  replayMissing = 0; replayChanged = false; renderReplay();
  replayDelta = undefined; replayLoading = false;
  replayAxis = replayTimeline([]); replayClock = new ReplayClock(0);
}
function renderReplayTime() {
  renderUsage();
  const position = replayClock.position, event = replayFrames[replayIndex];
  text('replay-position', `${formatDuration(position)} / ${formatDuration(replayAxis.durationMs)}`);
  text('replay-time', replayFrames.length ? new Date(replayAxis.startMs + position).toLocaleString('zh-CN', { hour12: false }) : '');
  text('replay-elapsed', replayLoading ? '正在读取此时状态…' : event ? `画面依据 ${formatTime(event.at)} 的记录 · ${replayIndex + 1}/${replayFrames.length}` : '正在读取历史…');
  const seek = byId<HTMLInputElement>('replay-seek');
  seek.max = String(replayAxis.durationMs); seek.value = String(position);
  seek.setAttribute('aria-valuetext', `${formatDuration(position)}，共 ${formatDuration(replayAxis.durationMs)}`);
  seek.style.setProperty('--replay-progress', `${replayAxis.durationMs ? position / replayAxis.durationMs * 100 : 0}%`);
  text('replay-play', replayPlaying ? '暂停' : position >= replayAxis.durationMs && replayIndex >= 0 ? '重播' : '播放');
  byId<HTMLButtonElement>('replay-prev').disabled = replayIndex < 0 || position === 0;
}
function renderReplayMarkers() {
  const markers = byId('replay-markers'); markers.replaceChildren();
  const groups = new Map<number, number[]>();
  replayAxis.offsets.forEach((offset, index) => {
    const indices = groups.get(offset) ?? []; indices.push(index); groups.set(offset, indices);
  });
  for (const [offset, indices] of groups) {
    const event = replayFrames[indices.at(-1)!]!, marker = create('button', 'replay-marker');
    marker.dataset.replayOffset = String(offset); marker.style.left = `${replayAxis.durationMs ? offset / replayAxis.durationMs * 100 : 0}%`;
    const label = `${formatDuration(offset)} · ${formatTime(event.at)} · ${event.title}${indices.length > 1 ? `（同一时刻 ${indices.length} 条保存记录）` : ''}`;
    marker.title = label; marker.setAttribute('aria-label', label);
    marker.onclick = () => { void seekReplayTime(offset); }; markers.append(marker);
  }
  text('replay-range-start', replayFrames.length ? formatTime(new Date(replayAxis.startMs).toISOString()) : '');
  text('replay-range-end', replayFrames.length ? formatTime(new Date(replayAxis.startMs + replayAxis.durationMs).toISOString()) : '');
}
function renderReplay() {
  document.body.classList.toggle('replay-mode', replayActive);
  byId('replay-bar').hidden = !replayActive;
  byId<HTMLButtonElement>('replay-start').disabled = replayActive;
  byId('focus-change').hidden = !replayActive;
  for (const id of ['snapshot', 'download']) {
    byId<HTMLButtonElement>(id).disabled = replayActive;
    byId(id).title = replayActive ? '返回实时后导出最新任务状态' : '';
  }
  if (!replayActive) return;
  const event = replayFrames[replayIndex], ready = !!event;
  renderReplayTime();
  document.querySelectorAll<HTMLElement>('[data-replay-offset]').forEach(marker => {
    const offset = Number(marker.dataset.replayOffset);
    marker.classList.toggle('passed', offset <= replayClock.position);
    marker.setAttribute('aria-current', offset === replayAxis.offsets[replayIndex] ? 'step' : 'false');
  });
  text('replay-event', event ? `${event.title}${event.summary ? ` · ${short(event.summary,100)}` : ''}` : '');
  text('replay-summary',event?.summary??'');
  byId<HTMLButtonElement>('replay-prev').disabled = !ready || replayClock.position === 0;
  byId<HTMLButtonElement>('replay-next').disabled = !ready || replayIndex === replayFrames.length - 1;
  byId<HTMLButtonElement>('replay-play').disabled = !replayFrames.length || replayAxis.durationMs === 0;
  byId<HTMLButtonElement>('replay-restart').disabled = !replayFrames.length;
  const seek = byId<HTMLInputElement>('replay-seek'); seek.disabled = !replayFrames.length || replayAxis.durationMs === 0;
  const notices = ['按真实记录间隔连续播放；两次记录之间沿用最近已知状态。同次保存的多个变化不表示同时执行。'];
  if (replayAxis.adjusted) notices.push(`有 ${replayAxis.adjusted} 条时间缺失或倒退的记录，按保存顺序合并到相邻时刻。`);
  if (replayMissing) notices.push(`旧任务有 ${replayMissing} 条记录未保存对应状态，仅回放可还原的起点、最新状态及升级后记录。`);
  if (replayChanged) notices.push('实时任务有新记录，当前回放保持不变；返回实时可查看最新状态。');
  text('replay-notice', notices.join(' ')); byId('replay-notice').hidden = false;
  const actors=byId('replay-actors');actors.replaceChildren();
  if(ready&&current){
    const state=checkpointActors(current),main=[],sub=[];
    if(state.main.running)main.push(`执行中 ${state.main.running}`);
    if(state.main.review)main.push(`待复核 ${state.main.review}`);
    if(state.main.reviewing)main.push(`正在复核 ${state.main.reviewing}`);
    if(state.main.reviewed)main.push(`复核完成 ${state.main.reviewed}`);
    if(state.subagent.running)sub.push(`排查中 ${state.subagent.running}`);
    if(state.subagent.returned)sub.push(`已返回待汇总 ${state.subagent.returned}`);
    if(state.subagent.reviewed)sub.push(`已返回并复核 ${state.subagent.reviewed}`);
    if(state.subagent.pending)sub.push(`待启动 ${state.subagent.pending}`);
    actors.append(create('span','actor-caption','此时已知状态'),create('span','actor-summary main',`主 Agent · ${main.join(' / ')||'阶段推进'}`),create('span','actor-summary subagent',`子 Agent 分支 · ${sub.join(' / ')||'无执行中分支'}`));
    if(state.native.running||state.native.returned)actors.append(create('span','actor-summary native',`宿主自动记录 · ${state.native.running} 会话执行中 / ${state.native.returned} 会话已返回`));
  }
  const changes=byId('replay-changes');changes.replaceChildren();
  const delta=replayDelta;
  const caption=!ready?'读取保存状态后显示变化':delta?.baseline==='initial'?'起始状态 · 已建立的目标与分支':delta?.baseline==='gap'?`最近记录的累计变化 · 跨过 ${delta.missing} 条缺失状态`:delta?.baseline==='unknown'?'缺少前一状态，暂不推断节点变化':delta?.highlighted.length?`最近变化 · 高亮 ${delta.highlighted.length} 个节点`:'最近记录仅更新摘要、报告或检查结果，图中节点无变化';
  text('replay-change-heading',caption);
  for(const change of delta?.changes??[]){
    const role=change.actor==='main'?'主 Agent':change.actor==='subagent'?'子 Agent':'目标与依据';
    const button=create('button',`checkpoint-change ${change.change}`,`${role} · ${short(change.title,24)} · ${change.label}`);
    button.dataset.changeNodeId=change.nodeId;button.disabled=change.change==='removed';
    button.title=`${change.before?`${change.before} → `:''}${change.after??'已移除'}${change.relatedIds.length?'；同时高亮主 Agent 的复核节点':''}`;
    button.onclick=()=>{replayFollow=false;switchView('graph');inspect(change.relatedIds[0]??change.nodeId);focusNodes([change.relatedIds[0]??change.nodeId]);};changes.append(button);
  }
}
function scheduleReplay() {
  if (!replayPlaying || replayLoading) return;
  const due=replayDueOffset(replayAxis,replayIndex,replayClock.position);
  if(due!==undefined){void seekReplayTime(due,true);return;}
  if (replayClock.position >= replayAxis.durationMs) { stopReplayPlayback(); renderReplay(); return; }
  const next = replayAxis.offsets[replayIndex + 1] ?? replayAxis.durationMs;
  replayTimer = setTimeout(() => {
    replayTimer = undefined;
    if (!replayPlaying || !replayActive) return;
    if (replayClock.position >= next && replayIndex < replayFrames.length - 1) {
      // Buffer at a real transition while reading its immutable state. No fake
      // operation duration is inserted, and a slow response cannot skip a return.
      void seekReplayTime(next, true);
    } else { renderReplayTime(); tick(); scheduleReplay(); }
  }, Math.min(50, Math.max(1, (next - replayClock.position) / replayClock.rate)));
}
async function seekReplayTime(position: number, playing = false) {
  stopReplayPlayback();
  replayClock.seek(position);
  const index = replayIndexAt(replayAxis, replayClock.position), frame = replayFrames[index];
  if (!frame || !replayActive) return;
  replayPlaying = playing;
  const generation = ++replayGeneration, taskId = selectedTask;
  if (index === replayIndex && !replayLoading) {
    if (playing) replayClock.play(); renderReplay(); tick(); scheduleReplay(); return;
  }
  replayLoading = true; renderReplay();
  try {
    const saved = await request<ReplayState>(`/api/tasks/${encodeURIComponent(taskId)}/replay/${frame.seq}`);
    if (!replayActive || generation !== replayGeneration || selectedTask !== taskId) return;
    current = saved.task; timeline = saved.events; replayIndex = index; replayLoading = false;
    if (replayPlaying) replayClock.play();
    replayDelta=saved.checkpoint??compareCheckpoint(saved.task,undefined,{baseline:'unknown'});
    const primary=replayDelta.changes.find(change=>['branch','agent'].includes(change.kind)&&change.change!=='removed');
    detailGeneration++; selectedNode = primary?.relatedIds[0]??primary?.nodeId??(current.status==='completed'?'goal':'origin'); renderCurrent(); showError(); scheduleReplay();
  } catch (error) { if (generation === replayGeneration) { replayLoading = false; stopReplayPlayback(); renderReplay(); showError(error); } }
}
async function startReplay() {
  if (!current || replayActive) return;
  replayActive = true; replayFrames = []; replayIndex = -1; replayChanged = false; replayFollow=true; replayLoading = true;
  const generation = ++replayGeneration, taskId = selectedTask; renderReplay();
  try {
    let after = 0, head: number | undefined;
    do {
      const page = await request<ReplayPage>(`/api/tasks/${encodeURIComponent(taskId)}/replay?after=${after}${head === undefined ? '' : `&head=${head}`}`);
      if (!replayActive || generation !== replayGeneration || selectedTask !== taskId) return;
      replayFrames.push(...page.frames); replayMissing = page.missing; head = page.head;
      if (page.next === null) break; after = page.next;
    } while (true);
    if (!replayFrames.length) throw new Error('此任务暂无可回放的状态');
    replayAxis = replayTimeline(replayFrames); replayClock = new ReplayClock(replayAxis.durationMs);
    replayClock.setRate(Number(byId<HTMLSelectElement>('replay-speed').value)); renderReplayMarkers();
    needsFit = true; viewportCustomized = false;
    await seekReplayTime(0, true);
  } catch (error) { if (generation === replayGeneration) { resetReplay(); showError(error); void refresh(); } }
}
function renderCurrent() {
  const task = current!;
  text('task-id', `${task.id.slice(0, 19).toUpperCase()} · 通用任务`);
  text('goal', task.goal); text('phase', task.phase.label); byId('phase').className = `phase ${task.phase.key}`;
  text('owner', `${task.owner.host} · ${task.owner.epoch > 1 ? `接管 ${task.owner.epoch - 1} 次` : '主会话'}`);
  text('created', `创建于 ${new Date(task.createdAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}`);
  text('updated', `最近更新 ${formatTime(task.updatedAt)}`);
  byId('branch-meta').hidden=!task.branchCounts.total;
  text('branch-meta',`自主排查 · ${task.branchCounts.total} 个分支 · ${task.branchCounts.delegated} 个委派分支${task.branchCounts.review?` · ${task.branchCounts.review} 个待汇总`:''}`);
  tick(); renderGraph(); renderBasis(); renderEvents(); renderReport(); renderSidebar(); renderReplay(); void renderDetails();
}
function renderUsage(){
 if(!current)return;
 const u=current.resourceUsage,n=(value:number)=>value.toLocaleString('zh-CN');
 text('usage-tokens',u.tokens?n(u.tokens.total):'—');
 const tokenDetail=u.tokens?`输入 ${n(u.tokens.input)} / 输出 ${n(u.tokens.output)}`:'宿主尚未提供用量';
 text('usage-token-detail',tokenDetail);
 byId('usage-token-detail').title=u.tokens?`${tokenDetail} · 缓存读取 ${n(u.tokens.cacheRead)} · 缓存写入 ${n(u.tokens.cacheWrite)} · 推理 ${n(u.tokens.reasoning)}${u.modelCalls===null?'':` · 模型响应 ${n(u.modelCalls)} 次`}。缓存包含在输入中，推理包含在输出中。`:tokenDetail;
 text('usage-tools',u.toolCalls===null?'—':n(u.toolCalls));
 text('usage-tool-detail',u.toolCalls===null?'未接入原生计数':`另有 Cairn ${n(u.cairnCalls??0)} 次 · 失败 ${n(u.toolErrors??0)} 次`);
 byId('usage-tools').title='业务工具已返回的调用数，包含失败；Cairn 工具另计。工具内容不保存。';
 const time=usageTime(current,replayActive?replayAxis.startMs+replayClock.position:Date.now(),u.stoppedAt??current.updatedAt);
 text('usage-active',elapsedLabel(time.activeMs));text('usage-wall',elapsedLabel(time.wallMs));
 text('usage-active-detail',time.activeMs===null?'历史任务未采集执行时长':`${time.partial?'接入统计后累计 · ':''}执行状态累计，扣除暂停`);
 const hosts=[...new Set(u.sources.map(source=>source.split('/')[0]))];
 text('usage-note',`${replayActive?'历史时刻 · ':''}${hosts.length?hosts.join(' / ')+' · ':''}仅统计已观测的主会话用量，不保存工具内容`);
}
function tick() {
  if (!current) return;
  renderUsage();
  const deadline = current.budget.deadline, now = replayActive ? replayAxis.startMs + replayClock.position : Date.now();
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
  const changed=new Set(replayActive?replayDelta?.highlighted:[]);
  for(const lane of projection.lanes){
    const group=svg('g',{class:`actor-lane ${lane.actor}`,'data-actor-lane':lane.actor,'aria-label':lane.label});
    group.append(svg('rect',{x:lane.x,y:lane.y,width:lane.width,height:lane.height,rx:14,class:'lane-body'}),svg('text',{x:lane.x+12,y:lane.y+19,class:'lane-title'},lane.label));world.append(group);
  }
  for (const edge of projection.edges) {
    const a = nodes.get(edge.from)!, b = nodes.get(edge.to)!;
    const path = vertical
      ? `M${a.x + width / 2},${a.y + height} C${a.x + width / 2},${a.y + height + 34} ${b.x + width / 2},${b.y - 34} ${b.x + width / 2},${b.y}`
      : `M${a.x + width},${a.y + height / 2} C${a.x + width + 35},${a.y + height / 2} ${b.x - 35},${b.y + height / 2} ${b.x},${b.y + height / 2}`;
    const marker = edge.relation==='handoff'||edge.state==='review'?'arrow-review':edge.state === 'running' ? 'arrow-running' : edge.state === 'refuted' ? 'arrow-red' : edge.state === 'pending' || edge.state === 'context' ? 'arrow-pending' : 'arrow';
    const line = svg('path', { d: path, class: `edge ${edge.state} relation-${edge.relation}`, 'marker-end': `url(#${marker})`, 'data-edge-from': edge.from, 'data-edge-to': edge.to, 'data-relation': edge.relation });
    line.append(svg('title', {}, { context: '背景与记录', branch: '已保存的分支展开或结果归属，不表示因果关系', handoff:'子 Agent 返回结果，进入主 Agent 的复核流程',review:'由分支状态生成的主 Agent 复核关系',stage: '任务或分支包含此执行阶段，不表示阶段依赖顺序', basis: '已登记依据', supports: '支持结论', refutes: '反驳结论', criterion: '结论关联此目标条件', addresses:'涉及此目标条件，尚未构成完成依据', input:'来源事实 → 探索（固定事实版本）',produces:'探索 → 产出结论，不代表自动证明因果',explores:'分支包含这次探索',revises:'旧来源版本已被修订', goal: '目标与验收条件' }[edge.relation])); world.append(line);
    if(edge.relation==='input'||edge.relation==='produces')world.append(svg('text',{x:(a.x+b.x+width)/2,y:(a.y+b.y+height)/2-5,'text-anchor':'middle',class:'provenance-label'},edge.relation==='input'?`来源 · r${edge.revision??0}`:'产出'));
    if(edge.relation==='handoff')world.append(svg('text',{x:(a.x+b.x+width)/2,y:(a.y+b.y+height)/2-5,'text-anchor':'middle',class:'handoff-label'},edge.state==='review'?'返回 · 待复核':'返回 · 已复核'));
  }
  for (const node of nodes.values()) {
    const actor=node.actor==='main'?'主 Agent':node.actor==='subagent'?'子 Agent':'';
    const palette = graphPalette[node.status], group = svg('g', { class: `node status-${node.status}${selectedNode === node.id ? ' selected' : ''}${changed.has(node.id)?' checkpoint-changed':changed.size?' checkpoint-unchanged':''}`, transform: `translate(${node.x},${node.y})`, role: 'button', tabindex: '0', 'aria-label': `${actor?actor+'，':''}${graphKindLabels[node.kind]}：${node.label}，${node.state}${changed.has(node.id)?'，最近记录的变化':''}`, 'data-node-id': node.id, 'data-node-kind': node.kind, 'data-node-status': node.status,'data-node-actor':node.actor??'shared','data-checkpoint-changed':String(changed.has(node.id)) });
    if(changed.has(node.id))group.append(svg('rect',{x:-4,y:-4,width:width+8,height:height+8,rx:14,class:'change-outline',fill:'none',stroke:'#2563eb'}));
    group.append(svg('rect', { width, height, rx: 11, fill: palette.fill, stroke: palette.stroke,class:'node-body' }));
    const role=actor?(node.actor==='subagent'&&['basis','claim'].includes(node.kind)?'子 Agent 分支':actor)+' · ':'';
    group.append(svg('text', { x: 13, y: 18, class: 'type', fill: palette.muted }, role+graphKindLabels[node.kind]));
    if(changed.has(node.id))group.append(svg('circle',{cx:width,cy:0,r:5,fill:'#2563eb',class:'change-dot'}));
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
  if(replayActive&&replayFollow&&!viewportCustomized&&activeView==='graph')followReplayActivity();
}
function inspect(id: string) { selectedNode = id;switchInspector('details'); document.querySelectorAll<SVGElement>('.node').forEach(node => node.classList.toggle('selected', node.dataset.nodeId === id)); void renderDetails(); }
function focusNodes(ids:string[]){
  const targets=ids.map(id=>nodes.get(id)).filter((node):node is PositionedNode=>!!node);if(!targets.length)return;
  const rect=byId('graph').getBoundingClientRect(),left=Math.min(...targets.map(n=>n.x)),top=Math.min(...targets.map(n=>n.y)),right=Math.max(...targets.map(n=>n.x+graphNodeSize.width)),bottom=Math.max(...targets.map(n=>n.y+graphNodeSize.height));
  transform.scale=Math.max(.08,Math.min(1.1,(rect.width-70)/(right-left),(rect.height-70)/(bottom-top)));
  transform.x=rect.width/2-(left+right)/2*transform.scale;transform.y=rect.height/2-(top+bottom)/2*transform.scale;viewportCustomized=true;applyTransform();
}
function followReplayActivity(){
  const flow=[...nodes.values()].filter(node=>['branch','agent','review','exploration','global-review'].includes(node.kind));
  focusNodes(flow.length?flow.map(node=>node.id):replayDelta?.highlighted??[]);viewportCustomized=false;
}
function applyTransform() {
  document.getElementById('graph-world')!.setAttribute('transform', `translate(${transform.x},${transform.y}) scale(${transform.scale})`);
  const labels=document.querySelector('.graph-labels')!.children;
  labels[0]!.textContent=replayActive&&replayFollow?'聚焦分支执行与复核':'连线表示保存关系与分支复核状态';
  labels[1]!.textContent=replayActive&&replayFollow?'适应画布查看完整关系图':'来源 → 探索 → 产出；分支线仅表示归属';
  byId('focus-change').setAttribute('aria-pressed',String(replayActive&&replayFollow));
}
function fit() {
  viewportCustomized=false;
  const rect = byId('graph').getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) { needsFit = true; return; }
  transform.scale = Math.max(.1, Math.min(1.1, (rect.width - 45) / graphSize.width, (rect.height - 45) / graphSize.height));
  transform.x = (rect.width - graphSize.width * transform.scale) / 2; transform.y = (rect.height - graphSize.height * transform.scale) / 2; applyTransform();
}
function zoom(factor: number, x?: number, y?: number) {
  viewportCustomized=true;replayFollow=false;
  const rect = byId('graph').getBoundingClientRect(), mx = x ?? rect.width / 2, my = y ?? rect.height / 2;
  const scale = Math.min(2.5, Math.max(.08, transform.scale * factor)), ratio = scale / transform.scale;
  transform.x = mx - (mx - transform.x) * ratio; transform.y = my - (my - transform.y) * ratio; transform.scale = scale; applyTransform();
}
let dragged = false, drag: { x: number; y: number; tx: number; ty: number } | undefined;
const graph = byId('graph');
graph.onpointerdown = event => { if (event.button !== 0) return; drag = { x: event.clientX, y: event.clientY, tx: transform.x, ty: transform.y }; dragged = false; };
graph.onpointermove = event => { if (!drag) return; const dx = event.clientX - drag.x, dy = event.clientY - drag.y; if (Math.abs(dx) + Math.abs(dy) > 4) { if(!graph.hasPointerCapture(event.pointerId))graph.setPointerCapture(event.pointerId);dragged = true;viewportCustomized=true;replayFollow=false; graph.classList.add('dragging'); transform.x = drag.tx + dx; transform.y = drag.ty + dy; applyTransform(); } };
graph.onpointerup = event => { drag = undefined; graph.classList.remove('dragging'); if (graph.hasPointerCapture(event.pointerId)) graph.releasePointerCapture(event.pointerId); setTimeout(() => { dragged = false; }, 0); };
graph.onpointercancel = () => { drag = undefined; dragged = false; graph.classList.remove('dragging'); };
window.addEventListener('pointerup',()=>{drag=undefined;graph.classList.remove('dragging');setTimeout(()=>{dragged=false;},0);});
graph.addEventListener('wheel', event => { event.preventDefault(); const rect = graph.getBoundingClientRect(); zoom(Math.exp(-event.deltaY * .0015), event.clientX - rect.left, event.clientY - rect.top); }, { passive: false });
byId('zoom-in').onclick = () => zoom(1.2); byId('zoom-out').onclick = () => zoom(1 / 1.2); byId('fit').onclick = () => {replayFollow=false;fit();};

function metadata(parent: HTMLElement, key: string, value: unknown) { const row = create('div', 'meta'); row.append(create('span', '', key), create('span', '', String(value ?? '—'))); parent.append(row); }
function heading(parent: HTMLElement, value: string) { parent.append(create('h3', '', value)); }
function reference(parent: HTMLElement, id: string, kind: 'obs' | 'claim' | 'branch') {
  const node = nodes.get(`${kind}:${id}`), button = create('button', 'ref-button', node ? `${kind === 'obs' ? '↗ 原始观测' : kind === 'branch' ? '↗ 排查分支' : '↗ 结论'} · ${short(node.label, 30)}` : id);
  button.onclick = () => { replayFollow=false;switchView('graph'); inspect(`${kind}:${id}`);focusNodes([`${kind}:${id}`]); }; parent.append(button);
}
async function renderDetails() {
  const task = current; if (!task) return;
  const generation = ++detailGeneration, panel = byId('details'); panel.replaceChildren();
  const delta=replayActive?replayDelta?.changes.find(change=>change.nodeId===selectedNode||change.relatedIds.includes(selectedNode)):undefined;
  if(delta)panel.append(create('div','checkpoint-detail',`最近记录 · ${delta.label}${delta.before?`\n${delta.before} → ${delta.after??'已移除'}`:''}`));
  const reviewing=selectedNode.startsWith('review:');
  if(selectedNode.startsWith('agent:')){
    const run=task.agentRuns?.find(run=>`agent:${run.epoch}:${run.attempt}:${run.agentId}`===selectedNode);
    if(run){
      text('detail-kind','宿主执行会话');panel.append(create('h2','',run.status==='returned'?'子 Agent 执行已返回':'子 Agent 正在执行'));
      metadata(panel,'状态来源','原生生命周期事件 · 自动保存');metadata(panel,'原生 Agent ID',run.agentId);metadata(panel,'宿主',run.host);
      if(run.startedAt)metadata(panel,'启动时间',formatTime(run.startedAt));if(run.returnedAt)metadata(panel,'返回时间',formatTime(run.returnedAt));
      panel.append(create('div','notice','这是宿主实际执行会话，尚未与某个排查分支建立确切身份关联；它不是新增的排查方向。执行返回不代表结论已被主 Agent 接受。无需 Agent 转述生命周期，不保存工具调用或会话全文。'));
    }return;
  }
  if(selectedNode.startsWith('branch:')||reviewing){
    const branch=task.branches.find(item=>item.key===selectedNode.slice(7));
    if(branch){
      text('detail-kind',reviewing?'主 Agent 复核汇总':'排查分支');panel.append(create('div',`detail-tag ${branch.status}`,reviewing?(branch.status==='completed'?'复核完成':branch.status==='reviewing'?'正在复核':'返回待汇总 · 等待复核'):branch.statusLabel),create('h2','',branch.title));
      metadata(panel,'负责人',reviewing?'主 Agent':branch.executor==='subagent'?`子 Agent · ${branch.executorLabel}`:branch.executorLabel);metadata(panel,'分支标识',branch.key);
      if(reviewing)metadata(panel,'结果返回自',`子 Agent · ${branch.executorLabel}`);
      if(branch.agentId)metadata(panel,'宿主 Agent ID',branch.agentId);
      metadata(panel,'状态来源',reviewing?'保存记录中的分支复核状态':branch.activitySource==='host'?'主 Agent 状态与宿主生命周期':'主 Agent 报告');
      if(branch.activitySource==='host')metadata(panel,'最近宿主事件',branch.activityStatus==='returned'?'执行已结束':'开始执行');
      metadata(panel,'负责人代次',branch.epoch);metadata(panel,'最近更新',formatTime(branch.updatedAt));
      if(branch.question){heading(panel,'排查问题');panel.append(create('div','detail-text',branch.question));}
      if(branch.rationale){heading(panel,'选择此分支的原因');panel.append(create('div','detail-text',branch.rationale));}
      if(branch.summary){heading(panel,'结果 / 停止原因');panel.append(create('div','detail-text',branch.summary));}
      if(branch.parent){heading(panel,'所属分支');reference(panel,branch.parent,'branch');}
      const children=task.branches.filter(item=>item.parent===branch.key);if(children.length){heading(panel,'展开的子分支');for(const child of children)reference(panel,child.key,'branch');}
      heading(panel,'主 Agent 已登记的结论');for(const claim of task.claims.filter(item=>item.branch===branch.key))reference(panel,claim.id,'claim');
      if(!task.claims.some(item=>item.branch===branch.key))panel.append(create('p','note','尚未登记此分支的结论与依据。'));
      panel.append(create('div','notice',branch.status==='awaiting_review'?'助手执行已结束，主 Agent 尚未完成汇总验收。':branch.activitySource==='host'?'宿主事件表示最近一次生命周期状态；分支是否完成仍由主 Agent 审阅，不能据此判断进程此刻存活。':'此分支状态由主 Agent 保存；未匹配到原生生命周期，不代表已验证子 Agent 进程存活。'));
      return;
    }
  }
  if (selectedNode.startsWith('work:')) { const item = task.workItems.find(i => `work:${i.key}` === selectedNode); if (item) { text('detail-kind', '执行阶段'); panel.append(create('div', `detail-tag ${item.status}`, item.statusLabel), create('h2', '', item.title)); if (item.detail) panel.append(create('div', 'detail-text', item.detail)); metadata(panel, '最近更新', formatTime(item.updatedAt)); metadata(panel, '来源', item.source === 'agent' ? 'Agent 报告' : item.source === 'host' ? '宿主事件' : '历史任务记录'); panel.append(create('div', 'notice', '这是最近保存的阶段状态，不代表宿主进程实时存活。')); return; } }
  const node = nodes.get(selectedNode) ?? nodes.get('origin')!; if (!node) return;
  text('detail-kind', graphKindLabels[node.kind]);
  panel.append(create('div', 'detail-tag', node.state), create('h2', '', node.kind === 'origin' || node.kind === 'goal' ? task.goal : node.label));
  if(node.kind==='exploration'){
    metadata(panel,'探索分支',node.data.branch);metadata(panel,'执行代次 / 轮次',`${node.data.epoch} / ${node.data.attempt}`);
    heading(panel,'来源事实（固定版本）');for(const fact of node.data.inputs){panel.append(create('div','detail-text',`${fact.id} · r${fact.revision}\n${fact.text}`));if(fact.basis)panel.append(create('p','note',fact.basis));for(const ref of fact.references??[])sourceReference(panel,ref);}
    panel.append(create('div','notice','这是已登记的探索来源与产出关系，不是工具调用记录。'));return;
  }
  if(node.kind==='fact'){metadata(panel,'固定修订',node.data.revision);if(node.data.basis)panel.append(create('div','detail-text',node.data.basis));for(const ref of node.data.references??[])sourceReference(panel,ref);panel.append(create('div','notice','保留探索发生时使用的旧事实版本，当前版本已变化。'));return;}
  if(node.kind==='hint'){metadata(panel,'提供者',node.data.author);metadata(panel,'来源','调用者注明的人工反馈');metadata(panel,'时间',formatTime(node.data.at));panel.append(create('div','notice','人工输入是背景与方向，不自动变成已确认事实。'));return;}
  if(node.kind==='global-review'){metadata(panel,'已复核 / 最新',`${node.data.acknowledged} / ${node.data.generation}`);for(const reason of node.data.pending)panel.append(create('div','detail-text',reason.text));if(node.data.last){heading(panel,'最近复核');panel.append(create('div','detail-text',node.data.last.summary));metadata(panel,'快照',node.data.last.snapshot);}return;}
  if (node.kind === 'origin' || node.kind === 'goal') {
    if(task.checkpoint){
      heading(panel,'最新进展');panel.append(create('div','detail-text',task.checkpoint.summary));
      metadata(panel,'记录时间',formatTime(task.checkpoint.at));
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
    if(node.data.needsReview)panel.append(create('div','notice','来源版本已变化；仅确认全局复核不能恢复此结论，需要重新验证并更新产出关系，或撤回结论。'));
    if(node.data.derivation){heading(panel,'探索产出');metadata(panel,'探索分支',node.data.derivation.branch);metadata(panel,'轮次',node.data.derivation.attempt);}
    if(node.data.branch){heading(panel,'排查分支');reference(panel,node.data.branch,'branch');}
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
    if(claim.branch)reference(card,claim.branch,'branch');
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
  if (!task.report) { panel.append(create('p', 'note', '尚未保存报告。Agent 保存进展或完成任务时，会按结论及其证据生成报告引用。')); return; }
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
byId('show-goal').onclick = () => {replayFollow=false;inspect('goal');focusNodes(['goal']);};
byId('focus-change').onclick=()=>{replayFollow=true;followReplayActivity();};
byId('replay-start').onclick = () => { void startReplay(); };
byId('replay-live').onclick = () => { resetReplay(); void refresh(); };
byId('replay-prev').onclick = () => { void seekReplayTime(replayAxis.offsets.findLast(offset => offset < replayClock.position) ?? 0); };
byId('replay-next').onclick = () => { void seekReplayTime(replayAxis.offsets.find(offset => offset > replayClock.position) ?? replayAxis.durationMs); };
byId('replay-restart').onclick = () => { void seekReplayTime(0, true); };
byId('replay-play').onclick = () => {
  if (replayPlaying) { stopReplayPlayback(); renderReplay(); }
  else if (replayClock.position >= replayAxis.durationMs) void seekReplayTime(0, true);
  else if (!replayLoading && replayIndexAt(replayAxis, replayClock.position) !== replayIndex) void seekReplayTime(replayClock.position, true);
  else { replayPlaying = true; if (!replayLoading) replayClock.play(); renderReplay(); scheduleReplay(); }
};
byId<HTMLInputElement>('replay-seek').oninput = () => { void seekReplayTime(Number(byId<HTMLInputElement>('replay-seek').value)); };
byId<HTMLSelectElement>('replay-speed').onchange = () => {
  replayClock.setRate(Number(byId<HTMLSelectElement>('replay-speed').value));
  if (replayTimer !== undefined) clearTimeout(replayTimer);
  replayTimer = undefined; renderReplayTime(); scheduleReplay();
};
byId('snapshot').onclick=()=>{if(current)location.href=`/api/tasks/${encodeURIComponent(current.id)}/export?format=html`;};
byId('back-to-list').onclick=()=>{resetReplay();overviewMode=true;selectedTask='';current=undefined;detailGeneration++;history.replaceState(null,'',location.pathname);applyMode();void refresh();};
byId<HTMLSelectElement>('layout').onchange=()=>{layout=byId<HTMLSelectElement>('layout').value === 'vertical' ? 'vertical' : 'horizontal';needsFit=true;renderGraph();};
document.querySelectorAll<HTMLButtonElement>('[data-inspector]').forEach(button=>{button.onclick=()=>switchInspector(button.dataset.inspector!);});
byId('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await byId('graph-wrap').requestFullscreen();}catch(error){showError(error);}};
document.addEventListener('fullscreenchange',()=>{const button=byId('fullscreen');button.setAttribute('aria-label',document.fullscreenElement?'退出全屏':'全屏画布');requestAnimationFrame(()=>replayActive&&replayFollow?followReplayActivity():fit());});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.fullscreenElement)void document.exitFullscreen().catch(showError);});
const resizer=byId('panel-resizer'),board=document.querySelector<HTMLElement>('.board')!;
const resizePanel=(width:number)=>{const value=Math.max(270,Math.min(width,Math.min(700,board.clientWidth*.6)));board.style.setProperty('--inspector-width',`${value}px`);resizer.setAttribute('aria-valuenow',String(Math.round(value)));};
resizer.onpointerdown=event=>{event.preventDefault();resizer.setPointerCapture(event.pointerId);};
resizer.onpointermove=event=>{if(resizer.hasPointerCapture(event.pointerId))resizePanel(board.getBoundingClientRect().right-event.clientX);};
resizer.onpointerup=event=>{if(resizer.hasPointerCapture(event.pointerId))resizer.releasePointerCapture(event.pointerId);};
resizer.onkeydown=event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();resizePanel(document.querySelector<HTMLElement>('.inspector')!.getBoundingClientRect().width+(event.key==='ArrowLeft'?20:-20));}};
byId('download').onclick = () => { if (current) location.href = `/api/tasks/${encodeURIComponent(current.id)}/export?format=markdown`; };
new ResizeObserver(() => { if (current && activeView === 'graph') { if(replayActive&&replayFollow)followReplayActivity();else fit(); } }).observe(graph);
const stream = new EventSource('/api/stream');
stream.addEventListener('ready', () => { byId('connection').classList.remove('offline'); byId('connection').lastElementChild!.textContent = '实时同步'; void refresh(); });
stream.addEventListener('change', () => { if (replayActive) replayChanged = true; void refresh(); });
stream.onerror = () => { byId('connection').classList.add('offline'); byId('connection').lastElementChild!.textContent = '正在重连'; };
window.addEventListener('pagehide', () => { stopReplayPlayback(); stream.close(); });
setInterval(tick, 1000);
void refresh();
