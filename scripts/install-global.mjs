#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--offline') { options.offline = true; continue; }
    if (arg === '--help' || arg === '-h') { options.help = true; continue; }
    const match = /^(--prefix|--cache)(?:=(.*))?$/.exec(arg);
    if (!match) throw new Error(`Unknown option: ${arg}. Use --prefix DIR, --cache DIR or --offline.`);
    const value = match[2] ?? args[++index];
    if (!value || value.startsWith('--')) throw new Error(`${match[1]} requires a directory.`);
    options[match[1].slice(2)] = resolve(value);
  }
  return options;
}

function npmCommand(env) {
  if (env.npm_execpath && existsSync(env.npm_execpath)) return [process.execPath, [env.npm_execpath]];
  // npm run supplies npm_execpath. Also support invoking this script directly.
  for (const path of [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]) {
    if (existsSync(path)) return [process.execPath, [path]];
  }
  if (process.platform === 'win32') throw new Error('Cannot locate npm-cli.js. Run this installer with npm run install:global.');
  return ['npm', []];
}

export function installGlobal(options) {
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error(`Cairn requires Node.js >=24; current runtime is ${process.version}.`);
  const env = { ...process.env, PATH: `${dirname(process.execPath)}${delimiter}${process.env.PATH ?? ''}` };
  const [command, initialArgs] = npmCommand(env);
  const npm = (args, capture = false) => {
    const result = spawnSync(command, [...initialArgs, ...args], {
      cwd: root, env, shell: false, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : ['inherit', 'inherit', 'inherit'],
    });
    if (result.error || result.status !== 0) {
      const detail = result.error?.message ?? (capture ? result.stderr.trim() : `exit status ${result.status ?? result.signal}`);
      throw new Error(`npm ${args[0]} failed: ${detail}`);
    }
    if (capture && result.stderr) process.stderr.write(result.stderr);
    return result.stdout;
  };
  const flags = [...(options.cache ? ['--cache', options.cache] : []), ...(options.offline ? ['--offline'] : [])];
  // Install a packed archive so the global command never points back at this checkout.
  npm(['run', 'build', ...flags]);
  const temporary = mkdtempSync(join(tmpdir(), 'cairn-global-'));
  try {
    const packed = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', temporary, ...flags], true));
    const filename = packed[0]?.filename;
    if (typeof filename !== 'string' || basename(filename) !== filename || !filename.endsWith('.tgz')) throw new Error('npm pack did not return a valid package archive.');
    const archive = join(temporary, filename);
    if (!existsSync(archive)) throw new Error('npm pack did not create its package archive.');
    npm(['install', '--global', '--ignore-scripts', '--no-audit', '--no-fund', ...(options.prefix ? ['--prefix', options.prefix] : []), ...flags, archive]);
    const prefix = options.prefix ?? npm(['prefix', '--global', ...flags], true).trim();
    const bin = process.platform === 'win32' ? prefix : join(prefix, 'bin');
    process.stdout.write(`\nCairn installed as a self-contained global package.\nCommand directory: ${bin}\nRun: cairn --version\nIf cairn is not found, add this directory to PATH.\n`);
    return { prefix, bin };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const options = parseOptions(process.argv.slice(2));
    if (options.help) process.stdout.write('Usage: npm run install:global -- [--prefix DIR] [--cache DIR] [--offline]\nBuild Cairn, then install a packed copy with npm. No sudo or shell-profile changes.\n');
    else installGlobal(options);
  } catch (error) {
    process.stderr.write(`Cairn global installation failed: ${error.message}\nFor an unwritable npm prefix, retry with --prefix DIR and add its bin directory to PATH.\n`);
    process.exitCode = 1;
  }
}
