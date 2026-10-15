import { existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';
export function workspace(cwd = process.cwd()): string {
  let current = resolve(cwd);
  for (;;) { if (existsSync(join(current,'.git'))) return current; const parent=dirname(current); if(parent===current)return resolve(cwd);current=parent; }
}
export function database(cwd = process.cwd()): string { return resolve(process.env.CAIRN_DB ?? join(workspace(process.env.CAIRN_WORKSPACE ?? cwd),'.cairn','state.db')); }
export function userHome():string { return process.env.CAIRN_CONFIG_HOME ?? homedir(); }
