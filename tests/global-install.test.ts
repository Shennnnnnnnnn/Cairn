import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, delimiter } from 'node:path';
import { isBuiltin } from 'node:module';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const source = resolve('.');
const script = join(source, 'scripts/install-global.mjs');
const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
const env = Object.fromEntries(Object.entries({ ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}`, NODE_PATH: '' }).filter(([, value]) => value !== undefined)) as Record<string, string>;

test('global installer accepts directory arguments literally and rejects invalid options', async () => {
  const { parseOptions } = await import(pathToFileURL(script).href);
  const directory = "prefix with space'$(false)";
  assert.deepEqual(parseOptions(['--prefix', directory, '--cache=cache dir', '--offline']), { prefix: resolve(directory), cache: resolve('cache dir'), offline: true });
  assert.throws(() => parseOptions(['--force']), /Unknown option/);
  assert.throws(() => parseOptions(['--prefix']), /requires a directory/);
  assert.throws(() => parseOptions(['--prefix', '--cache', 'cache']), /requires a directory/);
});

test('built runtimes expose only Node builtin external imports', async () => {
  assert.deepEqual(manifest.dependencies ?? {}, {});
  for (const entry of ['dist/cairn.mjs', 'dist/pi-extension.mjs']) {
    const result = await build({ entryPoints: [join(source, entry)], bundle: true, platform: 'node', format: 'esm', target: 'node24', write: false, metafile: true, packages: 'external', logLevel: 'silent' });
    const external = Object.values(result.metafile.outputs).flatMap(output => output.imports).filter(item => item.external);
    assert.ok(external.length > 0);
    assert.deepEqual(external.filter(item => !isBuiltin(item.path)), [], entry);
  }
});

test('packed global install works offline away from the checkout and supplies all three native packages', { timeout: 90000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "cairn global space'$(false)-"));
  const checkout = join(root, 'checkout'), prefix = join(root, 'global prefix'), workspace = join(root, 'workspace');
  mkdirSync(join(checkout, 'scripts'), { recursive: true });
  mkdirSync(workspace);
  cpSync(script, join(checkout, 'scripts/install-global.mjs'));
  for (const entry of manifest.files as string[]) if (existsSync(join(source, entry))) cpSync(join(source, entry), join(checkout, entry), { recursive: true });
  // pretest has already built the shared dist. This fixture checks it without rebuilding
  // the real checkout; prepack must never run in the helper's pack/install stages.
  writeFileSync(join(checkout, 'verify-assets.mjs'), 'import {accessSync} from "node:fs"; accessSync("dist/cairn.mjs"); accessSync("dist/ui-client.js");\n');
  writeFileSync(join(checkout, 'package.json'), JSON.stringify({ ...manifest, scripts: { build: 'node verify-assets.mjs', prepack: 'node -e "process.exit(73)"' } }));
  const cache = join(root, 'empty npm cache');
  try {
    const installed = spawnSync(process.execPath, [join(checkout, 'scripts/install-global.mjs'), '--prefix', prefix, '--cache', cache, '--offline'], { cwd: workspace, env, encoding: 'utf8', timeout: 60000 });
    assert.equal(installed.status, 0, installed.stdout + installed.stderr);
    assert.match(installed.stdout, /self-contained global package/);
    const packageDir = join(prefix, process.platform === 'win32' ? 'node_modules' : 'lib/node_modules', 'cairn');
    assert.equal(lstatSync(packageDir).isSymbolicLink(), false);
    assert.equal(existsSync(join(packageDir, 'node_modules')), false);
    const command = join(packageDir, 'bin/cairn.mjs');
    const executable = process.platform === 'win32' ? process.execPath : join(prefix, 'bin/cairn');
    if (process.platform !== 'win32') assert.equal(realpathSync(executable), realpathSync(command));
    rmSync(checkout, { recursive: true });
    const invoke = (args: string[]) => {
      const result = spawnSync(executable, [...(process.platform === 'win32' ? [command] : []), ...args], { cwd: workspace, env, encoding: 'utf8', timeout: 15000 });
      assert.equal(result.status, 0, result.stdout + result.stderr);
      return result.stdout;
    };
    assert.equal(invoke(['--version']).trim(), manifest.version);
    assert.match(invoke(['help']), new RegExp(`Cairn ${manifest.version.replaceAll('.', '\\.')}`));
    const probeMcp = async (runtime: string, host: string) => {
      const client = new Client({ name: 'global-install-test', version: '1' });
      try {
        await client.connect(new StdioClientTransport({ command: process.execPath, args: [runtime, 'mcp', '--host', host, '--root', workspace, '--session-id', `packed-${host}`, '--db', join(workspace, `.cairn/${host}.db`)], env, stderr: 'pipe' }), { timeout: 10000 });
        assert.equal((await client.listTools()).tools.length, 5);
      } finally { await client.close(); }
    };
    await probeMcp(command, 'mcp');
    for (const target of ['pi', 'claude', 'codex']) {
      const output = JSON.parse(invoke(['install', '--target', target, '--root', workspace]));
      const plugin = output.plugin as string;
      assert.ok(plugin.startsWith(workspace));
      assert.ok(existsSync(join(plugin, 'runtime/ui-client.js')));
      assert.ok(existsSync(join(plugin, 'skills/cairn/SKILL.md')));
      if (target === 'pi') {
        const extension = spawnSync(process.execPath, ['--input-type=module', '-e', `await import(${JSON.stringify(pathToFileURL(join(plugin, 'runtime/pi-extension.mjs')).href)})`], { cwd: workspace, env, encoding: 'utf8', timeout: 10000 });
        assert.equal(extension.status, 0, extension.stderr);
      }
      await probeMcp(join(plugin, 'runtime/cairn.mjs'), target);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('global installer reports npm failure and removes the temporary archive', () => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-global-failure-'));
  mkdirSync(join(root, 'scripts'));
  cpSync(script, join(root, 'scripts/install-global.mjs'));
  const npmPath = join(root, 'fake-npm.mjs'), log = join(root, 'packed-path.json');
  writeFileSync(npmPath, `import {writeFileSync} from 'node:fs'; import {join} from 'node:path';
const args=process.argv.slice(2);
if(args[0]==='pack'){const dir=args[args.indexOf('--pack-destination')+1];writeFileSync(join(dir,'cairn-fixture.tgz'),'fixture');writeFileSync(${JSON.stringify(log)},JSON.stringify(dir));console.log(JSON.stringify([{filename:'cairn-fixture.tgz'}]));}
if(args[0]==='install'){console.error('fixture permission failure');process.exitCode=23;}
`);
  try {
    const result = spawnSync(process.execPath, [join(root, 'scripts/install-global.mjs'), '--prefix', join(root, 'prefix')], { cwd: root, env: { ...env, npm_execpath: npmPath }, encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /fixture permission failure/);
    assert.match(result.stderr, /npm install failed: exit status 23/);
    assert.match(result.stderr, /--prefix DIR/);
    assert.equal(existsSync(JSON.parse(readFileSync(log, 'utf8'))), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
