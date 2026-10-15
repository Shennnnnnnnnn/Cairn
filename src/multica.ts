import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CairnError } from './core/types.js';
import { userHome } from './paths.js';
import { VERSION } from './version.js';

export type MulticaOptions = { agent?: string; workspaceId?: string; db?: string; adopt?: boolean; root?: string };
export type MulticaDependencies = { runner?: (args: string[]) => unknown; bundles?: string; node?: string };
type Entry = Record<string, any>;
type Receipt = {
  schema: 1; version: string; workspaceId: string; database: string; runtime: string;
  serverId?: string; serverHash?: string; serverPending?: boolean; adopted?: boolean;
  skillId?: string; skillFiles?: Record<string, string>; skillPending?: boolean;
  agents: Record<string, { name: string; mcpOwned: boolean; detached?: boolean }>;
  installedAt: string; complete?: boolean;
};
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const signature = (value: unknown) => digest(JSON.stringify(value));
const json = (path: string): any => JSON.parse(readFileSync(path, 'utf8'));
function bundleHash(directory: string): string {
  const hash = createHash('sha256');
  const visit = (path: string, prefix: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new CairnError('invalid_bundle', 'The Cairn bundle must contain regular files.');
      if (entry.isDirectory()) visit(join(path, entry.name), relative);
      else { const bytes = readFileSync(join(path, entry.name)); hash.update(JSON.stringify([relative, bytes.length])); hash.update(bytes); }
    }
  };
  visit(directory, '');
  return hash.digest('hex');
}
function stageVersion(source: string, versions: string, hash: string): string {
  const destination = join(versions, `${VERSION}-${hash}`);
  if (existsSync(destination)) {
    if (bundleHash(destination) !== hash) throw new CairnError('install_conflict', `The immutable Cairn runtime at ${destination} was edited. Preserve or resolve the edit before updating.`);
    return destination;
  }
  mkdirSync(versions, { recursive: true, mode: 0o700 });
  const staging = join(versions, `.staging-${randomUUID()}`);
  try {
    cpSync(source, staging, { recursive: true });
    if (bundleHash(staging) !== hash) throw new CairnError('install_conflict', 'The Cairn bundle changed during installation. Retry after the build finishes.');
    try { renameSync(staging, destination); }
    catch (error) {
      // A concurrent installer may have published the same content. Neither replaces an existing runtime.
      if (!existsSync(destination) || bundleHash(destination) !== hash) throw error;
    }
    return destination;
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
function save(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try { writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' }); renameSync(temporary, path); }
  finally { rmSync(temporary, { force: true }); }
}
function command(args: string[]): unknown {
  const result = spawnSync('multica', args, { encoding: 'utf8', timeout: 30_000, maxBuffer: 12 * 1024 * 1024 });
  // Never echo CLI output: errors can contain a credential-bearing MCP configuration.
  if (result.error || result.status !== 0) throw new CairnError('multica_command_failed', `Multica ${args.slice(0, 3).filter(arg => !arg.startsWith('--')).join(' ')} failed. Check login, workspace permissions and CLI availability; retry the same command after resolving it.`);
  if (!args.includes('--output')) return null;
  try { return result.stdout.trim() ? JSON.parse(result.stdout) : null; }
  catch { throw new CairnError('multica_invalid_response', 'Multica returned invalid JSON. Update Multica and retry; no response content was logged.'); }
}
function object(value: unknown, label: string): Entry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CairnError('multica_invalid_response', `Expected ${label} from Multica.`);
  return value as Entry;
}
function entries(value: unknown, label: string): Entry[] {
  if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || typeof item.id !== 'string')) throw new CairnError('multica_invalid_response', `Expected a ${label} list from Multica.`);
  return value;
}
function unique(list: Entry[], name: string, label: string): Entry | undefined {
  const matches = list.filter(entry => entry.name === name);
  if (matches.length > 1) throw new CairnError('multica_ambiguous', `Multiple ${label} entries named ${name}; resolve duplicate entries before installing.`);
  return matches[0];
}
function context(options: MulticaOptions, dependencies: MulticaDependencies) {
  const runner = dependencies.runner ?? command;
  const base = join(resolve(options.root ?? userHome()), '.cairn', 'installations', 'multica');
  const selectionPath = join(base, 'default.json');
  const selection: { workspaceId: string; agentId: string } | undefined = existsSync(selectionPath) ? json(selectionPath) : undefined;
  if (selection && (typeof selection.workspaceId !== 'string' || typeof selection.agentId !== 'string')) throw new CairnError('install_conflict', `Invalid Multica default at ${selectionPath}.`);
  const requested = options.workspaceId?.trim() || selection?.workspaceId;
  const ws = object(runner(['workspace', 'get', ...(requested ? [requested] : []), '--output', 'json']), 'workspace');
  if (typeof ws.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(ws.id)) throw new CairnError('multica_invalid_response', 'Multica did not return a valid workspace ID.');
  const call = (args: string[], jsonOutput = true) => runner([...args, '--workspace-id', ws.id, ...(jsonOutput ? ['--output', 'json'] : [])]);
  const dir = join(base, ws.id);
  const receiptPath = join(dir, 'receipt.json');
  const receipt: Receipt | undefined = existsSync(receiptPath) ? json(receiptPath) : undefined;
  if (receipt && (receipt.schema !== 1 || receipt.workspaceId !== ws.id)) throw new CairnError('install_conflict', `Invalid Multica installation receipt at ${receiptPath}.`);
  let agent: Entry | undefined;
  if (options.workspaceId && selection && ws.id !== selection.workspaceId && !options.agent) throw new CairnError('invalid_input', 'The requested workspace differs from the saved Multica installation. Specify --agent explicitly.');
  const selector = options.agent ?? (selection?.workspaceId === ws.id ? selection.agentId : undefined);
  if (selector !== undefined) {
    if (!selector.trim()) throw new CairnError('invalid_input', 'Provide an exact Multica agent name or ID.');
    const agents = entries(call(['agent', 'list']), 'agent');
    agent = agents.find(item => item.id === selector) ?? unique(agents, selector, 'agent');
    if (!agent || agent.archived_at || (agent.workspace_id && agent.workspace_id !== ws.id)) throw new CairnError('multica_agent_not_found', `Agent ${selector} was not found in workspace ${ws.id}. Use an exact name or ID and --workspace-id.`);
    if (agent.runtime_mode && agent.runtime_mode !== 'local') throw new CairnError('multica_runtime_mismatch', 'This installer configures a local stdio Cairn server. Choose an agent using a local runtime.');
  }
  return { ws, call, dir, receiptPath, receipt, agent, selectionPath };
}
function sourceFiles(directory: string): Record<string, string> {
  const files: Record<string, string> = {};
  const visit = (path: string, prefix: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new CairnError('invalid_skill', 'The Cairn skill bundle must contain regular files.');
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(path, entry.name), relative);
      else files[relative] = readFileSync(join(path, entry.name), 'utf8');
    }
  };
  visit(directory, '');
  if (!files['SKILL.md']) throw new CairnError('missing_build', 'The bundled Cairn skill is missing SKILL.md. Build Cairn before installing.');
  return files;
}
function remoteFiles(skill: Entry): Record<string, string> {
  if (typeof skill.content !== 'string' || !Array.isArray(skill.files)) throw new CairnError('multica_invalid_response', 'Multica did not return full skill content. Update its CLI and retry.');
  const files: Record<string, string> = { 'SKILL.md': skill.content };
  for (const file of skill.files) {
    if (typeof file.path !== 'string' || typeof file.content !== 'string' || file.path === 'SKILL.md' || Object.hasOwn(files, file.path)) throw new CairnError('multica_invalid_response', 'Multica returned an invalid or duplicate skill file.');
    files[file.path] = file.content;
  }
  return files;
}
function skillMatches(actual: Record<string, string>, expected: Record<string, string>) {
  return Object.keys(actual).length === Object.keys(expected).length && Object.entries(actual).every(([path, content]) => expected[path] === content);
}
const legacySkillHashes: Record<string, string> = {
  'SKILL.md': '934ece9d72bdad1e63365453b6b480c97bb1f8b6b3f8678bc7940929f7d7fb65',
  'references/emergency.md': '16915bd81e8f44eaf68e432e03ad4023a43e5777c3f84954a6a23beb09db062c',
};
function knownLegacySkill(actual: Record<string, string>): Record<string, string> | undefined {
  const versions = [legacySkillHashes, { ...legacySkillHashes, 'SKILL.md': '519ff66e0b6debddcae4b4c9626acc5c0d7cd3c39015b933cdc89aad0c7e5c77' }];
  return versions.find(hashes => Object.keys(actual).length === Object.keys(hashes).length && Object.entries(actual).every(([path, content]) => hashes[path] === digest(content)));
}
function assertSkillUnedited(actual: Record<string, string>, desired: Record<string, string>, previous?: Record<string, string>, pending = false) {
  for (const [path, content] of Object.entries(actual)) {
    if (content === desired[path] || previous?.[path] === digest(content)) continue;
    throw new CairnError('install_conflict', `The Multica cairn skill contains an unowned edit in ${path}. Preserve or resolve the edit before updating; --adopt does not overwrite skill edits.`);
  }
  for (const path of Object.keys(previous ?? {})) {
    if (path in desired && !(path in actual) && !pending) throw new CairnError('install_conflict', `The Multica cairn skill file ${path} was removed. Resolve the edit before updating.`);
  }
  if (!previous && !pending && !skillMatches(actual, desired)) throw new CairnError('install_conflict', 'The existing Multica cairn skill differs from the bundled skill. Resolve its content before installing; it will not be overwritten.');
  if (Object.entries(actual).some(([path, content]) => !(path in desired) && previous?.[path] !== digest(content))) throw new CairnError('install_conflict', 'The Multica cairn skill contains extra files; preserve or resolve them before updating.');
}

/** Install only Cairn's MCP/skill registration. Models, instructions and unrelated bindings are untouched. */
export function installMultica(options: MulticaOptions = {}, dependencies: MulticaDependencies = {}) {
  const c = context(options, dependencies);
  const bundles = dependencies.bundles ?? resolve(dirname(fileURLToPath(import.meta.url)), 'plugins');
  const source = join(bundles, 'codex');
  if (!existsSync(join(source, 'runtime/cairn.mjs')) || !existsSync(join(source, 'runtime/ui-client.js')) || !existsSync(join(source, 'skills/cairn/SKILL.md'))) throw new CairnError('missing_build', 'Build Cairn before installing: npm run build');
  const files = sourceFiles(join(source, 'skills/cairn'));
  const hash = bundleHash(source);
  const database = resolve(options.db ?? c.receipt?.database ?? join(userHome(), '.local/share/cairn/multica/state.db'));
  const pluginDir = join(c.dir, 'versions', `${VERSION}-${hash}`);
  const runtime = join(pluginDir, 'runtime/cairn.mjs');
  const configuration = { command: dependencies.node ?? process.execPath, args: [runtime, 'mcp'], env: { CAIRN_HOST: 'mcp', CAIRN_DB: database } };
  const configPath = join(c.dir, 'configurations', `${signature(configuration)}.json`);
  if (!c.agent) {
    stageVersion(source, join(c.dir, 'versions'), hash);
    save(configPath, configuration);
    return { target: 'multica', configured: false, installed: false, workspaceId: c.ws.id, workspaceName: c.ws.name, database, configuration: configPath, skill: join(pluginDir, 'skills/cairn'), next: 'Specify --agent with an exact name or ID to register and bind Cairn. No Multica settings were changed.' };
  }
  const servers = entries(c.call(['workspace', 'mcp', 'list']), 'MCP server');
  let server = unique(servers, 'cairn', 'MCP server');
  if (c.receipt?.serverId && servers.some(item => item.id === c.receipt!.serverId && item.name !== 'cairn')) throw new CairnError('install_conflict', 'The managed Multica MCP server was renamed. Resolve its registration before updating.');
  if (server && c.receipt?.serverId && server.id !== c.receipt.serverId) throw new CairnError('install_conflict', 'The Multica cairn MCP registration was replaced outside this installer.');
  if (server && !c.receipt?.serverId && !c.receipt?.serverPending && !options.adopt) throw new CairnError('install_conflict', 'An existing Multica cairn MCP registration has no local receipt. Re-run with --adopt to explicitly replace that Cairn registration.');
  const skills = entries(c.call(['skill', 'list']), 'skill');
  let skill = unique(skills, 'cairn', 'skill');
  if (c.receipt?.skillId && skills.some(item => item.id === c.receipt!.skillId && item.name !== 'cairn')) throw new CairnError('install_conflict', 'The managed Multica cairn skill was renamed. Resolve it before updating.');
  if (skill && c.receipt?.skillId && skill.id !== c.receipt.skillId) throw new CairnError('install_conflict', 'The Multica cairn skill was replaced outside this installer.');
  let actual: Record<string, string> = {};
  if (skill) {
    actual = remoteFiles(object(c.call(['skill', 'get', skill.id, '--with-content']), 'skill'));
    const priorHashes = c.receipt?.skillFiles ?? (options.adopt ? knownLegacySkill(actual) : undefined);
    assertSkillUnedited(actual, files, priorHashes, c.receipt?.skillPending);
  }
  const assigned = entries(c.call(['agent', 'mcp', 'list', c.agent.id]), 'assigned MCP server');
  const assignedSkills = entries(c.call(['agent', 'skills', 'list', c.agent.id]), 'assigned skill');
  // Publish complete immutable content before any remote setting can point at it. Existing runtimes remain usable.
  stageVersion(source, join(c.dir, 'versions'), hash);
  save(configPath, configuration);
  const previousReceipt = c.receipt ? join(c.dir, 'receipts', `${signature(c.receipt)}.json`) : undefined;
  if (previousReceipt && !existsSync(previousReceipt)) save(previousReceipt, c.receipt);
  const receipt: Receipt = c.receipt ?? { schema: 1, version: VERSION, workspaceId: c.ws.id, database, runtime, installedAt: new Date().toISOString(), agents: {} };
  receipt.complete = false;
  receipt.database = database; receipt.runtime = runtime; receipt.version = VERSION;
  // Preserve every verified old file before the first mutation. A partial legacy migration may contain both versions.
  receipt.skillFiles = Object.fromEntries(Object.entries(actual).map(([path, content]) => [path, digest(content)]));
  if (skill) receipt.skillId = skill.id;
  const persist = () => save(c.receiptPath, receipt);
  persist();
  if (!server || receipt.serverHash !== signature(configuration)) {
    const expectedServerId = server?.id;
    receipt.serverPending = true; persist();
    c.call(server
      ? ['workspace', 'mcp', 'update', server.id, '--server-config-file', configPath]
      : ['workspace', 'mcp', 'add', 'cairn', '--server-config-file', configPath]);
    const registered = unique(entries(c.call(['workspace', 'mcp', 'list']), 'MCP server'), 'cairn', 'MCP server');
    if (!registered) throw new CairnError('multica_invalid_response', 'The Cairn MCP registration is not visible after the write. Retry installation to reconcile it.');
    if (expectedServerId && registered.id !== expectedServerId) throw new CairnError('install_conflict', 'The Multica cairn MCP ID changed during its update. Resolve the registration before retrying.');
    receipt.adopted = receipt.adopted || (!!server && !receipt.serverId);
    server = registered; receipt.serverId = registered.id; receipt.serverHash = signature(configuration); receipt.serverPending = false; persist();
  }
  if (!skill) {
    receipt.skillPending = true; persist();
    const description = files['SKILL.md']!.match(/^description:\s*(.+)$/m)?.[1] ?? 'Cairn goals, evidence and recovery';
    c.call(['skill', 'create', '--name', 'cairn', '--description', description, '--content-file', join(pluginDir, 'skills/cairn/SKILL.md')]);
    skill = unique(entries(c.call(['skill', 'list']), 'skill'), 'cairn', 'skill');
    if (!skill) throw new CairnError('multica_invalid_response', 'The Cairn skill is not visible after creation. Retry installation to reconcile it.');
    actual = remoteFiles(object(c.call(['skill', 'get', skill.id, '--with-content']), 'skill'));
    assertSkillUnedited(actual, files, undefined, true);
    receipt.skillId = skill.id;
    receipt.skillFiles = Object.fromEntries(Object.entries(actual).map(([path, content]) => [path, digest(content)]));
    persist();
  }
  receipt.skillId = skill.id;
  receipt.skillPending = true; receipt.skillFiles ??= {}; persist();
  const skillUpdates = Object.entries(files).sort(([a], [b]) => a === 'SKILL.md' ? -1 : b === 'SKILL.md' ? 1 : a.localeCompare(b));
  for (const [path, content] of skillUpdates) {
    if (actual[path] !== content) {
      c.call(path === 'SKILL.md'
        ? ['skill', 'update', skill.id, '--content-file', join(pluginDir, 'skills/cairn/SKILL.md')]
        : ['skill', 'files', 'upsert', skill.id, '--path', path, '--content-file', join(pluginDir, 'skills/cairn', path)]);
    }
    receipt.skillFiles[path] = digest(content); persist();
  }
  for (const path of Object.keys(actual).filter(path => !(path in files))) {
    const current = object(c.call(['skill', 'get', skill.id, '--with-content']), 'skill');
    const obsolete = current.files.find((file: Entry) => file.path === path);
    if (obsolete) {
      if (typeof obsolete.id !== 'string' || digest(obsolete.content) !== receipt.skillFiles[path]) throw new CairnError('install_conflict', `The managed skill file ${path} changed during update; preserve the edit before retrying.`);
      c.call(['skill', 'files', 'delete', skill.id, obsolete.id], false);
    }
    delete receipt.skillFiles[path]; persist();
  }
  const updatedSkill = remoteFiles(object(c.call(['skill', 'get', skill.id, '--with-content']), 'skill'));
  if (!skillMatches(updatedSkill, files)) throw new CairnError('multica_skill_incomplete', 'The Cairn skill files do not match the installed version; retry to reconcile the update.');
  receipt.skillPending = false; persist();
  const binding = assigned.find(item => item.id === receipt.serverId);
  receipt.agents[c.agent.id] ??= { name: c.agent.name, mcpOwned: !binding || !!options.adopt };
  receipt.agents[c.agent.id]!.detached = false; persist();
  if (!binding) c.call(['agent', 'mcp', 'add', c.agent.id, receipt.serverId!]);
  else if (!binding.enabled) c.call(['agent', 'mcp', 'enable', c.agent.id, receipt.serverId!]);
  const skillBinding = assignedSkills.find(item => item.id === receipt.skillId);
  if (!skillBinding || !skillBinding.enabled) c.call(['agent', 'skills', 'add', c.agent.id, '--skill-ids', receipt.skillId!]);
  const finalMcp = entries(c.call(['agent', 'mcp', 'list', c.agent.id]), 'assigned MCP server');
  const finalSkills = entries(c.call(['agent', 'skills', 'list', c.agent.id]), 'assigned skill');
  if (!finalMcp.some(item => item.id === receipt.serverId && item.enabled === true) || !finalSkills.some(item => item.id === receipt.skillId && item.enabled === true)) throw new CairnError('multica_binding_incomplete', 'Cairn was registered but its MCP or skill binding is not enabled. Review this agent in Multica and retry; other bindings were preserved.');
  receipt.complete = true; persist();
  save(c.selectionPath, { workspaceId: c.ws.id, agentId: c.agent.id, database });
  return { target: 'multica', configured: true, installed: true, workspaceId: c.ws.id, workspaceName: c.ws.name, agent: { id: c.agent.id, name: c.agent.name }, database, runtime, configuration: configPath, serverId: receipt.serverId, skillId: receipt.skillId, receipt: c.receiptPath, previousReceipt, next: 'Start a new run of this Multica agent. Cairn uses its own connection identity; omit session_id. Run cairn ui to view the shared dashboard.' };
}

export function multicaStatus(options: MulticaOptions = {}, dependencies: MulticaDependencies = {}) {
  const c = context(options, dependencies);
  const servers = entries(c.call(['workspace', 'mcp', 'list']), 'MCP server');
  const server = unique(servers, 'cairn', 'MCP server');
  const bindings = c.agent ? entries(c.call(['agent', 'mcp', 'list', c.agent.id]), 'assigned MCP server') : [];
  const skills = c.agent ? entries(c.call(['agent', 'skills', 'list', c.agent.id]), 'assigned skill') : [];
  const binding = bindings.find(item => item.id === server?.id);
  const skill = skills.find(item => item.id === c.receipt?.skillId || item.name === 'cairn');
  const owned = c.agent ? c.receipt?.agents[c.agent.id] : undefined;
  const installed = !!c.receipt?.complete && (!c.agent || (!!owned && !owned.detached));
  return { target: 'multica', workspaceId: c.ws.id, workspaceName: c.ws.name, agent: c.agent ? { id: c.agent.id, name: c.agent.name } : undefined, installed, managed: !!c.receipt, registered: !!server, serverId: server?.id, mcpEnabled: binding?.enabled === true, skillEnabled: skill?.enabled === true, database: c.receipt?.database, runtime: c.receipt?.runtime, runtimeExists: !!c.receipt && existsSync(c.receipt.runtime), receipt: c.receipt ? c.receiptPath : undefined, hooks: 'not installed; MCP-only curated workflow', configurationVerification: 'Multica MCP configuration is write-only; local receipt records the last successful registration.' };
}

/** Detach this agent only; shared workspace entries and persistent data remain usable. */
export function uninstallMultica(options: MulticaOptions = {}, dependencies: MulticaDependencies = {}) {
  const c = context(options, dependencies);
  if (!c.agent) throw new CairnError('invalid_input', 'Specify --agent with an exact Multica name or ID to uninstall its Cairn binding.');
  if (!c.receipt) return { target: 'multica', removed: false, workspaceId: c.ws.id, reason: 'No local Cairn installation receipt; no Multica settings were changed.' };
  const own = c.receipt.agents[c.agent.id];
  if (!own) return { target: 'multica', removed: false, workspaceId: c.ws.id, reason: 'This agent is not owned by the local installation receipt.' };
  const list = entries(c.call(['agent', 'mcp', 'list', c.agent.id]), 'assigned MCP server');
  if (own.mcpOwned && list.some(item => item.id === c.receipt!.serverId)) c.call(['agent', 'mcp', 'remove', c.agent.id, c.receipt.serverId!]);
  own.detached = true;
  save(c.receiptPath, c.receipt);
  return { target: 'multica', removed: own.mcpOwned, workspaceId: c.ws.id, agent: { id: c.agent.id, name: c.agent.name }, database: c.receipt.database, retained: ['Workspace Cairn MCP library entry', 'Shared Cairn skill and skill bindings', 'Local runtime and installation receipt', 'Task database', ...(!own.mcpOwned ? ['Pre-existing MCP agent binding'] : [])], next: 'Shared entries remain for other agents. Multica has no single-skill detach command; review the agent skill binding manually if needed.' };
}
