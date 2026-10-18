import { createHash, randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CairnError } from '../core/types.js';

interface NativeRecord {
  version: 1; host: string; sessionRef: string; cwd: string; pid?: number; processGroup?: number;
  closed: boolean; token: string; updatedAt: string;
}
interface Lock { token: string; ownerPid: number }
export interface NativeSessionLease {
  started(pid?: number): void;
  settled(): void;
}
const read = <T>(path: string): T | undefined => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } };
/** EPERM and reused/live PIDs remain unknown; never signal or kill an unrelated process. */
const exited = (pid: number) => {
  try { process.kill(pid, 0); return false; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'ESRCH'; }
};

/** Local private process registry, separate from portable blackboard/session references. */
export class NativeSessionRegistry {
  private readonly directory: string;
  constructor(root: string, private readonly host: string) {
    this.directory = join(resolve(root), '.sessions');
  }
  private paths(reference: string) {
    const key = createHash('sha256').update(reference).digest('hex');
    return { record: join(this.directory, `${key}.json`), lock: join(this.directory, `${key}.lock`), reaping: join(this.directory, `${key}.reaping`) };
  }
  canResume(reference: string, cwd: string): boolean {
    const record = read<NativeRecord>(this.paths(reference).record);
    if (!record || record.version !== 1 || record.host !== this.host || record.sessionRef !== reference || record.cwd !== resolve(cwd) || !Number.isSafeInteger(record.pid) || record.pid! <= 0) return false;
    if (!exited(record.pid!)) return false;
    return record.processGroup === undefined ? process.platform === 'win32' : Number.isSafeInteger(record.processGroup) && record.processGroup > 0 && exited(-record.processGroup);
  }
  claim(reference: string, cwd: string, requireKnown: boolean): NativeSessionLease {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const paths = this.paths(reference), token = randomUUID(), lock: Lock = { token, ownerPid: process.pid };
    const previous = read<NativeRecord>(paths.record);
    if ((requireKnown || previous) && !this.canResume(reference, cwd)) throw new CairnError('native_session_busy', 'Original native process exit is unknown or it is still running; refusing concurrent resume');
    const createLock = () => { const fd = openSync(paths.lock, 'wx', 0o600); try { writeFileSync(fd, JSON.stringify(lock)); } finally { closeSync(fd); } };
    try { createLock(); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Serialize stale-lock reclamation. A failed or uncertain reaper remains
      // conservative; it never removes a live owner's lock or sends a signal.
      let reaper: number;
      try { reaper = openSync(paths.reaping, 'wx', 0o600); }
      catch { throw new CairnError('native_session_busy', 'Another process owns or is checking this native session'); }
      try {
        const current = read<Lock>(paths.lock);
        if (!current || !Number.isSafeInteger(current.ownerPid) || current.ownerPid <= 0 || !exited(current.ownerPid) || !this.canResume(reference, cwd)) throw new CairnError('native_session_busy', 'Native session lock is live or its owner cannot be verified');
        unlinkSync(paths.lock);
        try { createLock(); } catch { throw new CairnError('native_session_busy', 'Another process acquired this native session'); }
      } finally { closeSync(reaper); unlinkSync(paths.reaping); }
    }
    let record: NativeRecord = { version: 1, host: this.host, sessionRef: reference, cwd: resolve(cwd), closed: false, token, updatedAt: new Date().toISOString() }, released = false;
    const save = () => {
      if (read<Lock>(paths.lock)?.token !== token) throw new CairnError('native_session_busy', 'Native session lock was replaced');
      const temporary = `${paths.record}.${token}.tmp`;
      writeFileSync(temporary, JSON.stringify(record) + '\n', { mode: 0o600 });
      renameSync(temporary, paths.record);
    };
    try { save(); }
    catch (error) { if (read<Lock>(paths.lock)?.token === token) unlinkSync(paths.lock); throw error; }
    return {
      started(pid) { record = { ...record, pid, ...(process.platform === 'win32' || !pid ? {} : { processGroup: pid }), updatedAt: new Date().toISOString() }; save(); },
      settled() {
        if (released) return;
        try { record = { ...record, closed: true, updatedAt: new Date().toISOString() }; save(); }
        finally { released = true; if (read<Lock>(paths.lock)?.token === token) unlinkSync(paths.lock); }
      },
    };
  }
}
