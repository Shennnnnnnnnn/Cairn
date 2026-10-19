import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { CairnError, type Task, type Session, type Capabilities } from './types.js';

/** All projections and their audit event commit in the same SQLite transaction. */
export class Store {
  readonly db: DatabaseSync;
  constructor(readonly path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if(path!==':memory:')chmodSync(path,0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY, state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL REFERENCES tasks(id), kind TEXT NOT NULL, payload TEXT NOT NULL, at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_task_seq ON events(task_id,seq);
      CREATE TABLE IF NOT EXISTS task_history(event_seq INTEGER PRIMARY KEY REFERENCES events(seq), state TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(host TEXT NOT NULL, id TEXT NOT NULL, cwd TEXT NOT NULL, task_id TEXT, epoch INTEGER, capabilities TEXT NOT NULL DEFAULT '{}', seen TEXT NOT NULL DEFAULT '{}', PRIMARY KEY(host,id));
      CREATE TABLE IF NOT EXISTS config(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS usage_samples(key TEXT PRIMARY KEY, task_id TEXT, epoch INTEGER, value TEXT NOT NULL);`);
    // Older databases did not retain intermediate states. Preserve only states we
    // actually know: the creation payload and the current head. Never infer old
    // conclusions from today's values or replay side effects to fill the gaps.
    this.transaction(() => {
      const missing = this.db.prepare(`SELECT e.seq,e.payload,t.state,e.kind FROM events e JOIN tasks t ON t.id=e.task_id
        WHERE NOT EXISTS(SELECT 1 FROM task_history h WHERE h.event_seq=e.seq)
        AND (e.kind='task.created' OR e.seq=(SELECT MAX(seq) FROM events WHERE task_id=t.id))`).all();
      for (const row of missing) {
        const task: Task = JSON.parse(row.kind === 'task.created' ? row.payload as string : row.state as string);
        this.db.prepare('INSERT INTO task_history VALUES (?,?)').run(Number(row.seq), historyState(task));
      }
    });
  }
  close() { this.db.close(); }
  transaction<T>(fn: () => T): T {
    this.db.exec('BEGIN IMMEDIATE');
    try { const value = fn(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(id: string): Task {
    const row = this.db.prepare('SELECT state FROM tasks WHERE id=?').get(id);
    if (!row) throw new CairnError('not_found', `Task ${id} does not exist`);
    return JSON.parse(row.state as string);
  }
  taskForCall(callId:string):Task|undefined {
    const rows=this.db.prepare("SELECT state FROM tasks WHERE EXISTS (SELECT 1 FROM json_each(tasks.state, '$.calls') WHERE key=?) OR EXISTS (SELECT 1 FROM json_each(tasks.state, '$.observations') WHERE json_extract(value, '$.callId')=?)").all(callId,callId);
    if(rows.length>1)throw new CairnError('ambiguous_call','Tool call belongs to multiple tasks');
    return rows[0]?JSON.parse(rows[0].state as string):undefined;
  }
  taskForAgent(session: Session, agentId: string): Task | undefined {
    const rows=this.db.prepare(`SELECT state FROM tasks WHERE json_extract(state,'$.status')!='completed'
      AND json_extract(state,'$.owner.host')=? AND json_extract(state,'$.owner.sessionId')=? AND json_extract(state,'$.owner.cwd')=?
      AND (EXISTS(SELECT 1 FROM json_each(state,'$.branches') b WHERE json_extract(b.value,'$.agentId')=? AND json_extract(b.value,'$.epoch')=json_extract(state,'$.owner.epoch'))
        OR EXISTS(SELECT 1 FROM json_each(state,'$.agentRuns') r WHERE json_extract(r.value,'$.agentId')=? AND json_extract(r.value,'$.epoch')=json_extract(state,'$.owner.epoch')))`)
      .all(session.host,session.sessionId,session.cwd,agentId,agentId);
    if(rows.length>1)throw new CairnError('ambiguous_agent','This child ID is bound to multiple unfinished goals; lifecycle attribution is unavailable');
    return rows[0]?JSON.parse(rows[0].state as string):undefined;
  }
  save(task: Task, kind: string, payload: unknown, at: string) {
    // A savepoint is atomic both inside an Engine transaction and for direct
    // Store callers. State, event and its historical frame can never diverge.
    this.db.exec('SAVEPOINT cairn_save');
    try {
      const previous=this.db.prepare('SELECT state FROM tasks WHERE id=?').get(task.id);
      const old:Task|undefined=previous?JSON.parse(previous.state as string):undefined;
      if(task.timing||old?.timing||task.status==='active'||!old){
      const timing=task.timing??old?.timing??{activeMs:0,trackedSince:at,...(old?.status==='active'?{activeSince:at}:{})};
      if(task.status==='active'){
        timing.activeSince??=at;delete timing.stoppedAt;
      }else if(timing.activeSince){
        timing.activeMs+=Math.max(0,Date.parse(at)-Date.parse(timing.activeSince));delete timing.activeSince;timing.stoppedAt=at;
      }else timing.stoppedAt??=at;
      task.timing=timing;
      }
      this.db.prepare('INSERT INTO tasks VALUES (?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state').run(task.id, JSON.stringify(task));
      const event = this.db.prepare('INSERT INTO events(task_id,kind,payload,at) VALUES (?,?,?,?)').run(task.id, kind, JSON.stringify(payload), at);
      this.db.prepare('INSERT INTO task_history VALUES (?,?)').run(event.lastInsertRowid, historyState(task));
      this.db.exec('RELEASE cairn_save');
    } catch (error) { this.db.exec('ROLLBACK TO cairn_save; RELEASE cairn_save'); throw error; }
  }
  historical(taskId: string, seq: number): { task: Task; at: string } {
    const row = this.db.prepare('SELECT h.state,e.at FROM task_history h JOIN events e ON e.seq=h.event_seq WHERE e.task_id=? AND e.seq=?').get(taskId, seq);
    if (!row) throw new CairnError('not_found', 'No saved historical state for this task and event');
    return { task: JSON.parse(row.state as string), at: row.at as string };
  }
  graphState(taskId:string,seq?:number):{task:Task;seq:number;at:string} {
    const row=this.db.prepare(`SELECT h.state,e.seq,e.at,json_extract(t.state,'$.evidenceMode') AS current_mode
      FROM tasks t JOIN events e ON e.task_id=t.id JOIN task_history h ON h.event_seq=e.seq
      WHERE t.id=? ${seq===undefined?'':'AND e.seq=?'} ORDER BY e.seq DESC LIMIT 1`)
      .get(...(seq===undefined?[taskId]:[taskId,seq]));
    if(!row)throw new CairnError('not_found','Graph snapshot does not belong to this task or is unavailable');
    const task:Task=JSON.parse(row.state as string);
    if(row.current_mode==='curated'){task.evidenceMode='curated';task.observations=[];task.calls={};task.actions=[];}
    return {task,seq:Number(row.seq),at:row.at as string};
  }
  list(): Pick<Task, 'id' | 'goal' | 'status' | 'revision' | 'owner'>[] {
    return this.db.prepare('SELECT state FROM tasks ORDER BY rowid DESC').all().map(row => {
      const t: Task = JSON.parse(row.state as string); return { id: t.id, goal: t.goal, status: t.status, revision: t.revision, owner: t.owner };
    });
  }
  register(session: Session, capabilities?: Capabilities, event?: string, at = new Date().toISOString()) {
    const existing = this.session(session);
    const seen = { ...(existing?.seen ?? {}), ...(event ? { [event]: at } : {}) };
    this.db.prepare(`INSERT INTO sessions(host,id,cwd,capabilities,seen) VALUES (?,?,?,?,?)
      ON CONFLICT(host,id) DO UPDATE SET cwd=excluded.cwd,capabilities=excluded.capabilities,seen=excluded.seen`)
      .run(session.host, session.sessionId, session.cwd, JSON.stringify(capabilities ?? existing?.capabilities ?? {}), JSON.stringify(seen));
  }
  session(session: Session): { taskId?: string; epoch?: number; capabilities: Partial<Capabilities>; seen: Record<string,string> } | undefined {
    const row = this.db.prepare('SELECT * FROM sessions WHERE host=? AND id=?').get(session.host, session.sessionId);
    return row ? { taskId: row.task_id as string | undefined, epoch: row.epoch as number | undefined, capabilities: JSON.parse(row.capabilities as string), seen: JSON.parse(row.seen as string) } : undefined;
  }
  bind(session: Session, task: Task) {
    this.register(session);
    this.db.prepare('UPDATE sessions SET task_id=?,epoch=? WHERE host=? AND id=?').run(task.id, task.owner.epoch, session.host, session.sessionId);
  }
  config<T>(key: string): T | undefined { const r = this.db.prepare('SELECT value FROM config WHERE key=?').get(key); return r ? JSON.parse(r.value as string) : undefined; }
  setConfig(key: string, value: unknown) { this.db.prepare('INSERT INTO config VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  events(taskId: string, after = 0) {
    return this.db.prepare('SELECT * FROM events WHERE task_id=? AND seq>? ORDER BY seq').all(taskId, after).map(r => ({ seq:r.seq as number,taskId:r.task_id as string,kind:r.kind as string,at:r.at as string,payload: JSON.parse(r.payload as string) }));
  }
}

/** Replay keeps domain state, without duplicating large/private raw tool IO. */
function historyState(task: Task): string {
  return JSON.stringify({ ...task, observations: task.observations.map(({ input: _input, output: _output, ...observation }) => ({ ...observation, input: null, output: null })) });
}
