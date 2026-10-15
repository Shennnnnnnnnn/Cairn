import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { CairnError } from '../core/types.js';
import { database, userHome } from '../paths.js';

function settingsPath(): string { return join(userHome(), '.cairn', 'ui.json'); }

/** UI-only preference: task, MCP and hook database selection remains workspace based. */
export function uiDatabase(cwd = process.cwd(), explicit?: string): string {
  if (explicit !== undefined) return resolve(explicit);
  if (process.env.CAIRN_DB !== undefined) return database(cwd);
  const file = settingsPath();
  let text: string;
  try { text = readFileSync(file, 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return database(cwd);
    throw new CairnError('invalid_ui_config', `Cannot read Cairn UI settings at ${file}: ${(error as Error).message}. Run cairn ui --forget to clear this setting.`);
  }
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object');
    const settings = value as Record<string, unknown>;
    if (settings.version !== 1 || typeof settings.database !== 'string' || !settings.database.trim() || !isAbsolute(settings.database)) throw new Error('Expected version 1 and an absolute database path');
    return settings.database;
  } catch (error) {
    throw new CairnError('invalid_ui_config', `Invalid Cairn UI settings at ${file}: ${(error as Error).message}. Run cairn ui --forget to clear this setting.`);
  }
}

export function rememberUiDatabase(db: string): void {
  if (!db.trim()) throw new CairnError('invalid_input', 'A database path is required to remember a Cairn UI dashboard.');
  const file = settingsPath(), dir = dirname(file);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const temporary = join(dir, `.ui-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify({ version: 1, database: resolve(db) }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    renameSync(temporary, file);
  } finally { rmSync(temporary, { force: true }); }
}

export function forgetUiDatabase(): void { rmSync(settingsPath(), { force: true }); }
