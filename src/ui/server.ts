import { createServer, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { Engine } from '../core/engine.js';
import { CairnError, publicTask } from '../core/types.js';
import { html, markdown } from '../export.js';
import { renderPage } from './page.js';
import { projectTask, summaries, projectEvent } from './view.js';
import { compareCheckpoint } from './replay.js';

export interface UiOptions { port?: number; host?: string; pollMs?: number }
export async function startUi(engine: Engine, options: UiOptions = {}) {
  const host = options.host ?? '127.0.0.1', port = options.port ?? 8000;
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new CairnError('invalid_host', 'The evidence dashboard binds only to loopback addresses');
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CairnError('invalid_port', 'Port must be an integer from 0 to 65535');
  const clients = new Map<ServerResponse, number>();
  const csrfToken=randomBytes(32).toString('base64url');
  const sequence = () => Number(engine.store.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events').get()!.seq);
  const send = (response: ServerResponse, event: string, seq: number) => response.write(`id: ${seq}\nevent: ${event}\ndata: ${JSON.stringify({ sequence: seq })}\n\n`);
  const json = (response: ServerResponse, value: unknown, status = 200) => {
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value));
  };
  const timer = setInterval(() => {
    if (!clients.size) return;
    try {
      const seq = sequence();
      for (const [response, cursor] of clients) if (seq !== cursor) { send(response, 'change', seq); clients.set(response, seq); }
    } catch { for (const response of clients.keys()) response.end(); clients.clear(); }
  }, Math.max(50, options.pollMs ?? 500));
  timer.unref();
  const heartbeat = setInterval(() => { for (const response of clients.keys()) response.write(': connection alive\n\n'); }, 15000);
  heartbeat.unref();
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const address = server.address() as AddressInfo | null;
    const allowedHosts = new Set([`localhost:${address?.port}`, `127.0.0.1:${address?.port}`, `[::1]:${address?.port}`]);
    // Keep raw evidence local, including against DNS rebinding and cross-origin requests.
    if (!request.headers.host || !allowedHosts.has(request.headers.host)) { json(response, { error: 'Invalid host' }, 403); return; }
    if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}` || request.headers['sec-fetch-site'] === 'cross-site') {
      json(response, { error: 'Cross-origin access is not allowed' }, 403); return;
    }
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
      const mutation=/^\/api\/tasks\/([^/]+)\/(hints|suspend|reopen)$/.exec(url.pathname);
      if(request.method==='POST'&&mutation){
        if(request.headers['x-cairn-csrf']!==csrfToken){json(response,{error:'Invalid local CSRF token'},403);return;}
        if(request.headers['content-type']?.split(';')[0]?.trim()!=='application/json'){json(response,{error:'Use application/json'},415);return;}
        let bytes=0;const chunks:Buffer[]=[];
        for await(const chunk of request){bytes+=chunk.length;if(bytes>32768){json(response,{error:'Request body too large'},413);return;}chunks.push(Buffer.from(chunk));}
        const input=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(!input||typeof input!=='object'||Array.isArray(input))throw new CairnError('invalid_input','Expected a JSON object');
        const taskId=decodeURIComponent(mutation[1]!),task=engine.store.get(taskId);
        if(!Number.isSafeInteger(input.revision)||input.revision!==task.revision){json(response,{error:'Task changed; refresh before applying this action'},409);return;}
        const required=(key:string)=>{if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>8000)throw new CairnError('invalid_input',`${key} must be nonempty and at most 8000 characters`);return input[key] as string;};
        if(mutation[2]==='hints')json(response,engine.addHint(taskId,required('text'),'human',input.revision));
        else if(mutation[2]==='suspend')json(response,engine.suspendByHuman(taskId,input.revision));
        else {
          if(input.invalidate!==undefined&&(!Array.isArray(input.invalidate)||input.invalidate.length>100||input.invalidate.some((ref:unknown)=>typeof ref!=='string'||!ref.trim())))throw new CairnError('invalid_input','invalidate must contain finding keys or IDs');
          engine.reopen(taskId,task.owner,required('reason'),{invalidate:input.invalidate,expectedRevision:input.revision,author:'human'});json(response,projectTask(engine,engine.store.get(taskId)));
        }
        return;
      }
      if(request.method!=='GET'){response.setHeader('Allow','GET');json(response,{error:'Method not allowed'},405);return;}
      if (url.pathname === '/') {
        const nonce = randomBytes(18).toString('base64');
        response.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end(renderPage(nonce,csrfToken)); return;
      }
      if (url.pathname === '/favicon.ico') { response.writeHead(204); response.end(); return; }
      if (url.pathname === '/api/tasks') { json(response, { tasks: summaries(engine), sequence: sequence() }); return; }
      if (url.pathname === '/api/stream') {
        response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        const seq = sequence(); clients.set(response, seq); send(response, 'ready', seq);
        response.on('close', () => clients.delete(response)); return;
      }
      const match = /^\/api\/tasks\/([^/]+)(?:\/(observations|events|export|replay)(?:\/([^/]+))?)?$/.exec(url.pathname);
      if (!match) { json(response, { error: 'Not found' }, 404); return; }
      const taskId = decodeURIComponent(match[1]!), task = engine.store.get(taskId);
      if (!match[2]) { json(response, projectTask(engine, task)); return; }
      if (match[2] === 'replay') {
        const cursor = (value: string | null, fallback = 0) => {
          const number = value === null ? fallback : Number(value);
          if (!Number.isSafeInteger(number) || number < 0) throw new CairnError('invalid_input', 'Invalid replay cursor');
          return number;
        };
        const curated = task.evidenceMode === 'curated';
        const visible = curated ? "AND e.kind NOT IN ('tool.started','observation.captured')" : '';
        if (match[3]) {
          const seq = cursor(match[3]), saved = engine.store.historical(taskId, seq);
          // A switch to curated mode must not reopen old captured records.
          if (curated) saved.task.evidenceMode = 'curated';
          const previous=engine.store.db.prepare(`SELECT e.seq,e.at,h.state FROM events e JOIN task_history h ON h.event_seq=e.seq WHERE e.task_id=? AND e.seq<? ${visible} ORDER BY e.seq DESC LIMIT 1`).get(taskId,seq);
          const taskView=projectTask(engine,saved.task,saved.at);
          const previousTask=previous?JSON.parse(previous.state as string):undefined;
          if(curated&&previousTask)previousTask.evidenceMode='curated';
          const missing=previous?Number(engine.store.db.prepare(`SELECT COUNT(*) AS count FROM events e WHERE e.task_id=? AND e.seq>? AND e.seq<? ${visible}`).get(taskId,Number(previous.seq),seq)!.count):0;
          const kind=engine.store.db.prepare('SELECT kind FROM events WHERE task_id=? AND seq=?').get(taskId,seq)!.kind;
          const checkpoint=compareCheckpoint(taskView,previousTask?projectTask(engine,previousTask,previous!.at as string):undefined,{baseline:previous?(missing?'gap':'previous'):kind==='task.created'?'initial':'unknown',previousSeq:previous?Number(previous.seq):undefined,missing});
          const rows = engine.store.db.prepare(`SELECT e.seq,e.kind,e.at,e.payload FROM events e WHERE e.task_id=? AND e.seq<=? ${visible} ORDER BY e.seq DESC LIMIT 100`).all(taskId, seq).reverse();
          json(response, { task: taskView, seq, checkpoint, events: rows.map(row => projectEvent({ seq: Number(row.seq), kind: row.kind as string, at: row.at as string, payload: JSON.parse(row.payload as string) })) }); return;
        }
        const after = cursor(url.searchParams.get('after'));
        const head = cursor(url.searchParams.get('head'), Number(engine.store.db.prepare('SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE task_id=?').get(taskId)!.seq));
        const counts = engine.store.db.prepare(`SELECT COUNT(*) AS events,COUNT(h.event_seq) AS frames FROM events e LEFT JOIN task_history h ON h.event_seq=e.seq WHERE e.task_id=? AND e.seq<=? ${visible}`).get(taskId, head)!;
        const rows = engine.store.db.prepare(`SELECT e.seq,e.kind,e.at,e.payload FROM events e JOIN task_history h ON h.event_seq=e.seq WHERE e.task_id=? AND e.seq>? AND e.seq<=? ${visible} ORDER BY e.seq LIMIT 101`).all(taskId, after, head);
        const frames = rows.slice(0,100).map(row => projectEvent({ seq: Number(row.seq), kind: row.kind as string, at: row.at as string, payload: JSON.parse(row.payload as string) }));
        json(response, { frames, total: Number(counts.frames), missing: Number(counts.events)-Number(counts.frames), head, next: rows.length > 100 ? frames.at(-1)!.seq : null }); return;
      }
      if (match[2] === 'observations') {
        if (task.evidenceMode === 'curated') throw new CairnError('not_found', 'This task does not expose raw tool records');
        const observation = task.observations.find(o => o.id === decodeURIComponent(match[3] ?? ''));
        if (!observation) throw new CairnError('not_found', 'Observation does not belong to this task');
        json(response, observation); return;
      }
      if (match[2] === 'events') {
        const after = Number(url.searchParams.get('after') ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) throw new CairnError('invalid_input', 'Invalid event cursor');
        const rows = after ? engine.store.db.prepare('SELECT seq,kind,at,payload FROM events WHERE task_id=? AND seq>? ORDER BY seq LIMIT 100').all(taskId, after)
          : engine.store.db.prepare('SELECT seq,kind,at,payload FROM events WHERE task_id=? ORDER BY seq DESC LIMIT 100').all(taskId).reverse();
        const events = rows.map(row => projectEvent({ seq: Number(row.seq), kind: row.kind as string, at: row.at as string, payload: JSON.parse(row.payload as string) }))
          .filter(event => (task.evidenceMode ?? 'captured') === 'captured' || !['tool.started', 'observation.captured'].includes(event.kind));
        json(response, { events }); return;
      }
      const format = url.searchParams.get('format') ?? 'markdown';
      if (!['json', 'markdown', 'html'].includes(format)) throw new CairnError('invalid_input', 'Invalid export format');
      const extension = { markdown: 'md', html: 'html', json: 'json' }[format]!;
      response.setHeader('Content-Disposition', `attachment; filename="cairn-${task.id.replace(/[^a-z0-9_-]/gi, '')}.${extension}"`);
      response.writeHead(200, { 'Content-Type': format === 'json' ? 'application/json; charset=utf-8' : format === 'html' ? 'text/html; charset=utf-8' : 'text/markdown; charset=utf-8' });
      response.end(format === 'json' ? JSON.stringify(publicTask(task), null, 2) : format === 'html' ? html(task) : markdown(task));
    } catch (error) { json(response, { error: (error as Error).message }, (error as CairnError).code === 'not_found' ? 404 : (error as CairnError).code==='revision_conflict'?409:400); }
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
  } catch (error) { clearInterval(timer); clearInterval(heartbeat); throw error; }
  const address = server.address() as AddressInfo;
  return {
    server, url: `http://${host === '::1' ? '[::1]' : host}:${address.port}`,
    close: async () => {
      clearInterval(timer); clearInterval(heartbeat);
      for (const response of clients.keys()) response.end(); clients.clear();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    },
  };
}
