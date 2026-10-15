import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Engine } from '../src/core/engine.js';
import { Store } from '../src/core/store.js';

const entry = resolve('dist/cairn.mjs');

function environment(configHome: string, overrides: NodeJS.ProcessEnv = {}) {
  const env = { ...process.env };
  for (const key of ['CAIRN_DB', 'CAIRN_WORKSPACE', 'CAIRN_HOST']) delete env[key];
  return { ...env, CAIRN_CONFIG_HOME: configHome, ...overrides };
}

function launch(args: string[], cwd: string, env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [entry, ...args], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  let spawnError: Error | undefined;
  child.once('error', error => { spawnError = error; });
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolveExit => {
    child.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) { await exited; return; }
    child.kill('SIGTERM');
    const timer = setTimeout(() => child.kill('SIGKILL'), 2500);
    try { await exited; } finally { clearTimeout(timer); }
  };
  const done = async () => {
    const timer = setTimeout(() => child.kill('SIGKILL'), 8000);
    try {
      const result = await exited;
      if (spawnError) throw spawnError;
      return { ...result, stdout, stderr };
    } finally { clearTimeout(timer); }
  };
  const url = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise<string>((resolveUrl, reject) => {
        const findUrl = () => {
          const match = /http:\/\/(?:127\.0\.0\.1|localhost):\d+/.exec(stdout);
          if (match) resolveUrl(match[0]);
        };
        child.stdout.on('data', findUrl);
        void exited.then(result => reject(new Error(`UI exited ${result.code}: ${stderr || stdout}`)));
        timer = setTimeout(() => reject(new Error(`Timed out starting UI: ${stderr || stdout}`)), 8000);
        findUrl();
      });
    } catch (error) { await stop(); throw error; }
    finally { clearTimeout(timer); }
  };
  return { url, stop, done };
}

function seed(db: string, goal: string) {
  const store = new Store(db);
  try {
    return new Engine(store).create({ host: 'mcp', sessionId: goal, cwd: '/fixture' }, {
      origin: 'UI command integration fixture', goal, criteria: ['Review the selected database'], evidenceMode: 'curated',
    }).id;
  } finally { store.close(); }
}

async function tasksAt(url: string) {
  const response = await fetch(`${url}/api/tasks`, { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  return (await response.json()).tasks as { id: string; goal: string }[];
}

test('remembered UI database survives cwd changes without redirecting task commands; overrides and forget work', { timeout: 30000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-ui-command-'));
  const first = join(root, 'first'), second = join(root, 'second'), config = join(root, 'config');
  mkdirSync(first); mkdirSync(second);
  const sharedDb = join(root, 'shared.db'), envDb = join(root, 'environment.db'), explicitDb = join(root, 'explicit.db');
  const sharedId = seed(sharedDb, 'Shared Multica goal');
  const workspaceId = seed(join(second, '.cairn', 'state.db'), 'Workspace-only goal');
  const environmentId = seed(envDb, 'Environment override goal'), explicitId = seed(explicitDb, 'Explicit override goal');
  const env = environment(config);
  const processes: ReturnType<typeof launch>[] = [];
  const ui = async (args: string[], cwd = second, processEnv = env) => {
    const process = launch(['ui', ...args], cwd, processEnv); processes.push(process);
    const url = await process.url(); return { ...process, url };
  };
  try {
    const saved = await ui(['--db', sharedDb, '--remember', '--port', '0'], first);
    assert.deepEqual((await tasksAt(saved.url)).map(task => task.id), [sharedId]);
    assert.ok(existsSync(join(config, '.cairn', 'ui.json')));
    await saved.stop();

    const remembered = await ui(['--port', '0']);
    assert.deepEqual((await tasksAt(remembered.url)).map(task => task.id), [sharedId]);
    await remembered.stop();

    const listProcess = launch(['task', 'list'], second, env); processes.push(listProcess);
    const listed = await listProcess.done();
    assert.equal(listed.code, 0, listed.stderr);
    assert.deepEqual(JSON.parse(listed.stdout).map((task: { id: string }) => task.id), [workspaceId]);

    const fromEnvironment = await ui(['--port', '0'], second, environment(config, { CAIRN_DB: envDb }));
    assert.deepEqual((await tasksAt(fromEnvironment.url)).map(task => task.id), [environmentId]);
    await fromEnvironment.stop();
    const explicit = await ui(['--db', explicitDb, '--port', '0'], second, environment(config, { CAIRN_DB: envDb }));
    assert.deepEqual((await tasksAt(explicit.url)).map(task => task.id), [explicitId]);
    await explicit.stop();

    const forgetProcess = launch(['ui', '--forget'], second, env); processes.push(forgetProcess);
    const forgotten = await forgetProcess.done();
    assert.equal(forgotten.code, 0, forgotten.stderr);
    assert.equal(existsSync(join(config, '.cairn', 'ui.json')), false);
    const workspace = await ui(['--port', '0']);
    assert.deepEqual((await tasksAt(workspace.url)).map(task => task.id), [workspaceId]);
    await workspace.stop();
  } finally {
    await Promise.all(processes.map(process => process.stop()));
    rmSync(root, { recursive: true, force: true });
  }
});

test('plain UI falls back from busy port 8000 while explicit ports fail without remembering a database', { timeout: 20000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-ui-port-')), config = join(root, 'config');
  const database = join(root, '.cairn', 'state.db'), taskId = seed(database, 'Port fallback goal');
  const env = environment(config), blocker = createServer();
  let ownsBlocker = false;
  const processes: ReturnType<typeof launch>[] = [];
  try {
    try {
      await new Promise<void>((resolveListen, reject) => {
        blocker.once('error', reject);
        blocker.listen(8000, '127.0.0.1', () => resolveListen());
      });
      ownsBlocker = true;
    } catch (error) {
      // An existing listener is enough to test fallback; it belongs to someone else.
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw error;
    }
    const plain = launch(['ui'], root, env); processes.push(plain);
    const url = await plain.url();
    assert.notEqual(new URL(url).port, '8000');
    assert.deepEqual((await tasksAt(url)).map(task => task.id), [taskId]);
    await plain.stop();

    const explicit = launch(['ui', '--db', database, '--remember', '--port', '8000'], root, env); processes.push(explicit);
    const failure = await explicit.done();
    assert.notEqual(failure.code, 0);
    assert.match(failure.stderr, /EADDRINUSE|address already in use/);
    assert.equal(existsSync(join(config, '.cairn', 'ui.json')), false);
  } finally {
    await Promise.all(processes.map(process => process.stop()));
    if (ownsBlocker) await new Promise<void>((resolveClose, reject) => blocker.close(error => error ? reject(error) : resolveClose()));
    rmSync(root, { recursive: true, force: true });
  }
});
