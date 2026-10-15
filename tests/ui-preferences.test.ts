import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CairnError } from '../src/core/types.js';
import { database } from '../src/paths.js';
import { forgetUiDatabase, rememberUiDatabase, uiDatabase } from '../src/ui/preferences.js';

function isolated(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'cairn-ui-preferences-'));
  const keys = ['CAIRN_CONFIG_HOME', 'CAIRN_DB', 'CAIRN_WORKSPACE'] as const;
  const original = keys.map(key => process.env[key]);
  process.env.CAIRN_CONFIG_HOME = root;
  delete process.env.CAIRN_DB; delete process.env.CAIRN_WORKSPACE;
  try { run(root); }
  finally {
    keys.forEach((key, i) => { const value = original[i]; if (value === undefined) delete process.env[key]; else process.env[key] = value; });
    rmSync(root, { recursive: true, force: true });
  }
}

test('UI database uses explicit path, environment, saved path and workspace in that order', () => isolated(root => {
  const cwd = join(root, 'project');
  assert.equal(uiDatabase(cwd), database(cwd));
  const saved = join(root, 'multica', 'state.db');
  rememberUiDatabase(saved);
  assert.equal(uiDatabase(cwd), saved);
  process.env.CAIRN_DB = join(root, 'environment.db');
  assert.equal(uiDatabase(cwd), process.env.CAIRN_DB);
  assert.equal(uiDatabase(cwd, 'explicit.db'), resolve('explicit.db'));
}));

test('remembered dashboard works across directories without changing task and MCP paths', () => isolated(root => {
  const saved = join(root, 'multica', 'state.db');
  rememberUiDatabase(saved);
  for (const name of ['one', 'two']) {
    const cwd = join(root, name);
    assert.equal(uiDatabase(cwd), saved);
    assert.equal(database(cwd), join(cwd, '.cairn', 'state.db'));
  }
}));

test('remember atomically replaces the database setting and saves private absolute paths', () => isolated(root => {
  rememberUiDatabase('first.db');
  rememberUiDatabase('second.db');
  const dir = join(root, '.cairn'), file = join(dir, 'ui.json');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, database: resolve('second.db') });
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(file).mode & 0o777, 0o600);
}));

test('forget clears only the saved dashboard and is harmless when settings are absent', () => isolated(root => {
  forgetUiDatabase();
  assert.equal(existsSync(join(root, '.cairn')), false);
  rememberUiDatabase(join(root, 'multica.db'));
  const sentinel = join(root, '.cairn', 'keep.txt'); writeFileSync(sentinel, 'keep');
  forgetUiDatabase(); forgetUiDatabase();
  assert.equal(existsSync(sentinel), true);
  assert.equal(uiDatabase(root), database(root));
}));

test('malformed settings fail with recovery instructions and can still be overridden or cleared', () => isolated(root => {
  const file = join(root, '.cairn', 'ui.json'); mkdirSync(join(root, '.cairn'));
  for (const content of ['{', 'null', '[]', '{}', '{"version":2,"database":"/state.db"}', '{"version":1,"database":"relative.db"}', '{"version":1,"database":""}']) {
    writeFileSync(file, content);
    assert.throws(() => uiDatabase(root), (error: unknown) => error instanceof CairnError && error.code === 'invalid_ui_config' && /cairn ui --forget/.test(error.message));
    assert.equal(uiDatabase(root, '/explicit.db'), '/explicit.db');
    process.env.CAIRN_DB = '/environment.db';
    assert.equal(uiDatabase(root), '/environment.db');
    delete process.env.CAIRN_DB;
  }
  forgetUiDatabase();
  assert.equal(uiDatabase(root), database(root));
}));
