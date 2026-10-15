import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { CairnError } from '../src/core/types.js';
import { database } from '../src/paths.js';
import { forgetMcpDatabase, mcpDatabase, rememberMcpDatabase } from '../src/mcp-preferences.js';
import { rememberUiDatabase, uiDatabase } from '../src/ui/preferences.js';

function isolated(run: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), 'cairn-mcp-preferences-'));
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

test('generic MCP database uses explicit path, environment, saved path and workspace in that order', () => isolated(root => {
  const cwd = join(root, 'project');
  assert.equal(mcpDatabase(cwd), database(cwd));
  const saved = join(root, 'multica', 'state.db');
  rememberMcpDatabase(saved);
  assert.equal(mcpDatabase(cwd), saved);
  process.env.CAIRN_DB = join(root, 'environment.db');
  assert.equal(mcpDatabase(cwd), process.env.CAIRN_DB);
  assert.equal(mcpDatabase(cwd, 'explicit.db'), resolve('explicit.db'));
}));

test('remembered MCP connection works across directories without changing native adapter database paths', () => isolated(root => {
  const saved = join(root, 'multica', 'state.db');
  rememberMcpDatabase(saved);
  for (const name of ['one', 'two']) {
    const cwd = join(root, name);
    assert.equal(mcpDatabase(cwd), saved);
    assert.equal(database(cwd), join(cwd, '.cairn', 'state.db'));
  }
  process.env.CAIRN_WORKSPACE = join(root, 'native-workspace');
  assert.equal(database(root), join(root, 'native-workspace', '.cairn', 'state.db'));
  assert.equal(mcpDatabase(root), saved);
}));

test('MCP preferences and UI preferences remain independently selected and removable', () => isolated(root => {
  const mcp = join(root, 'mcp.db'), ui = join(root, 'ui.db');
  rememberUiDatabase(ui);
  assert.equal(mcpDatabase(root), database(root));
  rememberMcpDatabase(mcp);
  assert.equal(mcpDatabase(root), mcp);
  assert.equal(uiDatabase(root), ui);
  forgetMcpDatabase();
  assert.equal(mcpDatabase(root), database(root));
  assert.equal(uiDatabase(root), ui);
}));

test('remember atomically replaces the MCP setting and saves private absolute paths', () => isolated(root => {
  rememberMcpDatabase('first.db');
  rememberMcpDatabase('second.db');
  const dir = join(root, '.cairn'), file = join(dir, 'mcp.json');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, database: resolve('second.db') });
  assert.equal(statSync(dir).mode & 0o777, 0o700);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(dir), ['mcp.json']);
}));

test('forget clears only the saved MCP connection and is harmless when absent', () => isolated(root => {
  forgetMcpDatabase();
  assert.equal(existsSync(join(root, '.cairn')), false);
  rememberMcpDatabase(join(root, 'multica.db'));
  const sentinel = join(root, '.cairn', 'keep.txt'); writeFileSync(sentinel, 'keep');
  forgetMcpDatabase(); forgetMcpDatabase();
  assert.equal(existsSync(sentinel), true);
  assert.equal(mcpDatabase(root), database(root));
}));

test('malformed MCP settings give recovery instructions and allow explicit or environment overrides', () => isolated(root => {
  const file = join(root, '.cairn', 'mcp.json'); mkdirSync(join(root, '.cairn'));
  for (const content of ['{', 'null', '[]', '{}', '{"version":2,"database":"/state.db"}', '{"version":1,"database":"relative.db"}', '{"version":1,"database":""}', '{"version":1,"database":"   "}']) {
    writeFileSync(file, content);
    assert.throws(() => mcpDatabase(root), (error: unknown) => error instanceof CairnError && error.code === 'invalid_mcp_config' && /cairn mcp --forget/.test(error.message));
    assert.equal(mcpDatabase(root, '/explicit.db'), '/explicit.db');
    process.env.CAIRN_DB = '/environment.db';
    assert.equal(mcpDatabase(root), '/environment.db');
    delete process.env.CAIRN_DB;
  }
  rememberMcpDatabase(join(root, 'repaired.db'));
  assert.equal(mcpDatabase(root), join(root, 'repaired.db'));
  forgetMcpDatabase();
  assert.equal(mcpDatabase(root), database(root));
}));

test('unreadable MCP settings provide clear diagnostics without overriding native or UI selection', () => isolated(root => {
  mkdirSync(join(root, '.cairn', 'mcp.json'), { recursive: true });
  assert.throws(() => mcpDatabase(root), (error: unknown) => error instanceof CairnError && error.code === 'invalid_mcp_config' && /Cannot read.*cairn mcp --forget/.test(error.message));
  assert.equal(mcpDatabase(root, '/explicit.db'), '/explicit.db');
  assert.equal(database(root), join(root, '.cairn', 'state.db'));
  assert.equal(uiDatabase(root), database(root));
}));

test('remember rejects an empty MCP path before creating settings', () => isolated(root => {
  assert.throws(() => rememberMcpDatabase('  '), (error: unknown) => error instanceof CairnError && error.code === 'invalid_input');
  assert.equal(existsSync(join(root, '.cairn')), false);
}));
