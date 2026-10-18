import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Store } from '../src/core/store.js';

const entry = resolve('dist/cairn.mjs');
const execute = promisify(execFile);

function environment(configHome: string, overrides: Record<string, string> = {}): Record<string, string> {
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  for (const key of ['CAIRN_DB', 'CAIRN_WORKSPACE', 'CAIRN_HOST']) delete env[key];
  return { ...env, CAIRN_CONFIG_HOME: configHome, ...overrides };
}

function savePreference(config: string, kind: 'ui' | 'mcp', db: string): void {
  mkdirSync(join(config, '.cairn'), { recursive: true });
  writeFileSync(join(config, '.cairn', `${kind}.json`), JSON.stringify({ version: 1, database: db }));
}

function snapshot(db: string, taskId: string) {
  assert.ok(existsSync(db), `Expected database ${db}`);
  const store = new Store(db);
  try { return { task: store.get(taskId), events: store.events(taskId) }; }
  finally { store.close(); }
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  const result = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, JSON.stringify(result));
  return (result.structuredContent as { result: unknown }).result;
}

async function rejected(client: Client, name: string, args: Record<string, unknown>, code: string): Promise<void> {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, true, JSON.stringify(result));
  const content = result.content as { type: string; text?: string }[];
  const error = JSON.parse(content.find(item => item.type === 'text')!.text!);
  assert.equal(error.error, code, JSON.stringify(result));
}

interface Fixture {
  root: string; config: string; first: string; second: string;
  connect(args?: string[], cwd?: string, overrides?: Record<string, string>): Promise<Client>;
  command(args: string[], cwd?: string): Promise<{ stdout: string; stderr: string }>;
}

async function isolated(run: (fixture: Fixture) => Promise<void>): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'cairn-mcp-startup-')));
  const config = join(root, 'config'), first = join(root, 'first'), second = join(root, 'second');
  mkdirSync(first); mkdirSync(second);
  const clients: Client[] = [];
  try {
    await run({
      root, config, first, second,
      async connect(args = [], cwd = first, overrides = {}) {
        const client = new Client({ name: 'cairn-mcp-startup-test', version: '1' });
        clients.push(client);
        await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry, 'mcp', ...args], cwd, env: environment(config, overrides), stderr: 'pipe' }), { timeout: 5000 });
        return client;
      },
      async command(args, cwd = second) {
        return await execute(process.execPath, [entry, ...args], { cwd, env: environment(config), timeout: 5000, encoding: 'utf8' });
      },
    });
  } finally {
    await Promise.all(clients.map(client => client.close()));
    rmSync(root, { recursive: true, force: true });
  }
}

test('bare MCP connections restore a remembered goal across directories with distinct identities and owner fencing', { timeout: 20000 }, async () => isolated(async f => {
  const db = join(f.root, 'multica', 'state.db'), uiDb = join(f.root, 'ui-only.db');
  savePreference(f.config, 'ui', uiDb);
  const first = await f.connect(['--db', db, '--remember']);
  const started = await call(first, 'cairn_start', {
    goal: 'Verify the documented Node requirement',
    criteria: ['The supported Node version is established from package.json'],
  });
  assert.match(started.owner.sessionId, /^mcp-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(started.owner.host, 'mcp');
  assert.equal(started.owner.cwd, f.first);
  assert.equal(started.evidenceMode, 'curated');
  await call(first, 'cairn_checkpoint', {
    summary: 'package.json establishes Node >=24; review remains',
    findings: [{ key: 'node', text: 'Node 24 or newer is required', status:'supported', basis: 'package.json engines.node is >=24.0.0', references: ['/fixture/package.json'], covers: ['c1'] }],
  });
  await call(first, 'cairn_finish', { outcome: 'suspended', summary: 'Saved for a fresh connection to review' });
  assert.equal(snapshot(db, started.taskId).task.status, 'suspended');
  assert.deepEqual(JSON.parse(readFileSync(join(f.config, '.cairn', 'mcp.json'), 'utf8')), { version: 1, database: db });
  assert.deepEqual(JSON.parse(readFileSync(join(f.config, '.cairn', 'ui.json'), 'utf8')), { version: 1, database: uiDb });

  const second = await f.connect([], f.second);
  const tasks = await call(second, 'cairn_read', { view: 'tasks' });
  assert.deepEqual(tasks.tasks.map((task: { id: string }) => task.id), [started.taskId]);
  await rejected(second, 'cairn_resume', { task_id: started.taskId }, 'takeover_required');
  const resumed = await call(second, 'cairn_resume', { task_id: started.taskId, takeover: true });
  assert.notEqual(resumed.owner.sessionId, started.owner.sessionId);
  assert.match(resumed.owner.sessionId, /^mcp-/);
  assert.equal(resumed.owner.cwd, f.second);
  assert.equal(resumed.owner.epoch, 2);
  assert.equal(resumed.claims[0].basis, 'package.json engines.node is >=24.0.0');
  const revision = snapshot(db, started.taskId).task.revision;
  await rejected(first, 'cairn_checkpoint', { next: 'Late result from the previous connection' }, 'stale_owner');
  assert.equal(snapshot(db, started.taskId).task.revision, revision);

  const finished = await call(second, 'cairn_finish', { summary: 'Node requirement verified from package.json' });
  assert.equal(finished.status, 'completed');
  assert.equal(finished.validation.ok, true);
  const saved = snapshot(db, started.taskId);
  assert.equal(saved.task.status, 'completed');
  assert.deepEqual(saved.task.observations, []);
  assert.deepEqual(saved.task.calls, {});
  assert.ok(!saved.events.some(event => /^(tool\.|observation\.)/.test(event.kind)));
  assert.equal(saved.task.report!.curatedReferences![0]!.references[0], '/fixture/package.json');
  assert.equal(existsSync(join(f.first, '.cairn', 'state.db')), false);
  assert.equal(existsSync(join(f.second, '.cairn', 'state.db')), false);
  assert.equal(existsSync(uiDb), false);
}));

test('MCP forget exits without starting a server and restores workspace selection without reading UI preferences', { timeout: 15000 }, async () => isolated(async f => {
  const db = join(f.root, 'remembered.db'), uiDb = join(f.root, 'ui-only.db');
  savePreference(f.config, 'mcp', db); savePreference(f.config, 'ui', uiDb);
  const forgotten = await f.command(['mcp', '--forget']);
  assert.equal(existsSync(join(f.config, '.cairn', 'mcp.json')), false);
  assert.ok(forgotten.stdout.trim().length > 0);
  assert.equal(existsSync(join(f.config, '.cairn', 'ui.json')), true);
  const client = await f.connect([], f.second);
  const started = await call(client, 'cairn_start', { goal: 'Use the current workspace after forgetting the shared MCP database' });
  assert.equal(snapshot(join(f.second, '.cairn', 'state.db'), started.taskId).task.owner.cwd, f.second);
  assert.equal(existsSync(db), false);
  assert.equal(existsSync(uiDb), false);
}));

test('explicit generic MCP identity and database overrides take precedence over remembered settings', { timeout: 15000 }, async () => isolated(async f => {
  const remembered = join(f.root, 'remembered.db'), environmentDb = join(f.root, 'environment.db'), explicit = join(f.root, 'explicit.db');
  savePreference(f.config, 'mcp', remembered);
  const client = await f.connect(['--session-id', 'explicit-connection', '--db', explicit], f.second, { CAIRN_DB: environmentDb });
  const started = await call(client, 'cairn_start', { goal: 'Use an explicitly supplied identity and database' });
  assert.equal(started.owner.sessionId, 'explicit-connection');
  assert.equal(snapshot(explicit, started.taskId).task.owner.sessionId, 'explicit-connection');
  await rejected(client, 'cairn_start', { session_id: 'different-identity', goal: 'Must not replace a bound startup identity' }, 'session_mismatch');
  assert.equal(existsSync(remembered), false);
  assert.equal(existsSync(environmentDb), false);
  const fromEnvironment = await f.connect([], f.second, { CAIRN_DB: environmentDb });
  const environmentGoal = await call(fromEnvironment, 'cairn_start', { goal: 'Use CAIRN_DB before the saved generic MCP preference' });
  assert.equal(snapshot(environmentDb, environmentGoal.taskId).task.owner.sessionId, environmentGoal.owner.sessionId);
  assert.equal(existsSync(remembered), false);
}));

test('native MCP adapters require their real session identity and ignore generic MCP and UI database preferences', { timeout: 20000 }, async () => isolated(async f => {
  const genericDb = join(f.root, 'generic.db'), uiDb = join(f.root, 'ui-only.db');
  savePreference(f.config, 'mcp', genericDb); savePreference(f.config, 'ui', uiDb);
  for (const host of ['codex', 'claude', 'pi']) {
    const cwd = join(f.root, host); mkdirSync(cwd);
    const client = await f.connect(['--host', host], cwd);
    await rejected(client, 'cairn_start', { goal: 'A native adapter must not invent a host session identity' }, 'session_required');
    const started = await call(client, 'cairn_start', { session_id: `actual-${host}-session`, goal: `Preserve ${host} native identity and workspace` });
    assert.equal(started.owner.host, host);
    assert.equal(started.owner.sessionId, `actual-${host}-session`);
    assert.equal(snapshot(join(cwd, '.cairn', 'state.db'), started.taskId).task.owner.cwd, cwd);
    assert.equal(existsSync(genericDb), false);
    assert.equal(existsSync(uiDb), false);
  }
}));
