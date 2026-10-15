import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import { Engine } from './core/engine.js';
import { CairnError, type Session, type Scope, type Observation } from './core/types.js';
import { markdown } from './export.js';
import { VERSION } from './version.js';

const unsafeKeys = new Set(['__proto__', 'constructor', 'prototype']);
const mappingPath = z.string().min(1).refine(path => path.split('.').every(key => !!key && !unsafeKeys.has(key)), 'Use a safe, nonempty dotted object path');
const publicName = z.string().regex(/^[A-Za-z0-9_-]{1,53}$/, 'Tool names must contain 1–53 letters, digits, underscores or hyphens').refine(name => !unsafeKeys.has(name), 'Reserved tool name');
export const gatewaySchema = z.object({
  servers: z.record(z.string(), z.object({ command: z.string().optional(), args: z.array(z.string()).default([]), env: z.record(z.string(), z.string()).optional(), url: z.url().optional(), headers: z.record(z.string(), z.string()).optional() }).refine(server => !!server.command !== !!server.url, 'Use exactly one command or url')),
  tools: z.array(z.object({ name: publicName, server: z.string(), upstream: z.string().min(1), role: z.enum(['read', 'submit', 'receipt']).default('read'), resultRefPath: mappingPath.optional(), scopePaths: z.record(z.string().refine(key => ['workspaceId', 'issueId', 'teamId', 'roundId', 'matchId'].includes(key), 'Unknown scope field'), mappingPath).optional(), receiptPath: mappingPath.optional(), reportPath: mappingPath.optional(), reportFormat: z.enum(['json', 'markdown']).default('json'), timeoutMs: z.number().int().min(100).max(300000).default(30000) }))
}).superRefine((config, ctx) => {
  const names = new Set<string>();
  for (const tool of config.tools) {
    if (!Object.hasOwn(config.servers, tool.server)) ctx.addIssue({ code: 'custom', message: `Unknown server ${tool.server}` });
    if (names.has(tool.name)) ctx.addIssue({ code: 'custom', message: `Duplicate tool ${tool.name}` });
    if (tool.role === 'submit' && (!tool.reportPath || !tool.receiptPath)) ctx.addIssue({ code: 'custom', message: `Submission tool ${tool.name} requires reportPath and receiptPath` });
    names.add(tool.name);
  }
});
export type GatewayConfig = z.infer<typeof gatewaySchema>;
export type GatewayTool = GatewayConfig['tools'][number];
type InputSchema = Awaited<ReturnType<Client['listTools']>>['tools'][number]['inputSchema'];
type Catalog = Awaited<ReturnType<Client['listTools']>>['tools'];
type Connection = { name: string; fingerprint: string; client: Client; ready: Promise<Client>; catalog?: Promise<Catalog>; closing?: Promise<void> };

/** Preserve the upstream schema, hiding only the report value supplied by Cairn. */
export function publicInputSchema<T extends InputSchema>(schema: T, tool: Pick<GatewayTool, 'role' | 'reportPath'>): T {
  const result = structuredClone(schema);
  if (tool.role !== 'submit' || !tool.reportPath) return result;
  const path = tool.reportPath.split('.');
  if (path.some(key => !key || unsafeKeys.has(key))) throw new CairnError('invalid_mapping', 'Unsafe report path');
  let current: any = result;
  for (const key of path.slice(0, -1)) {
    // Do not rewrite references, alternatives or array schemas as if they were objects.
    const next = current?.properties?.[key];
    if (!next || typeof next !== 'object' || Array.isArray(next)) return result;
    current = next;
  }
  const leaf = path.at(-1)!;
  if (current.properties && typeof current.properties === 'object') delete current.properties[leaf];
  if (Array.isArray(current.required)) current.required = current.required.filter((key: string) => key !== leaf);
  return result;
}

export function valueAt(value: unknown, path: string): unknown {
  let current: any = value;
  for (const part of path.split('.')) {
    if (unsafeKeys.has(part) || current === null || typeof current !== 'object' || !Object.hasOwn(current, part)) return;
    current = current[part];
  }
  return current;
}
export function structuredResult(result: any): unknown {
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.find((content: any) => content.type === 'text')?.text;
  if (text) try { return JSON.parse(text); } catch {}
  return result;
}

export class Gateway {
  private connections = new Map<string, Connection>();
  private allConnections = new Set<Connection>();
  private closed = false;
  private closing?: Promise<void>;
  constructor(readonly engine: Engine) {}
  config(): GatewayConfig {
    const config = this.engine.store.config<GatewayConfig>('gateway');
    if (!config) throw new CairnError('missing_whitelist', 'No upstream whitelist configured');
    return gatewaySchema.parse(config);
  }
  private dispose(connection: Connection): Promise<void> {
    if (this.connections.get(connection.name) === connection) this.connections.delete(connection.name);
    if (!connection.closing) connection.closing = connection.client.close().catch(() => {}).finally(() => { this.allConnections.delete(connection); });
    return connection.closing;
  }
  private async connection(name: string): Promise<Connection> {
    if (this.closed) throw new CairnError('gateway_closed', 'Gateway has been closed');
    const servers = this.config().servers, config = servers[name];
    if (!config || !Object.hasOwn(servers, name)) throw new CairnError('not_found', 'Unknown upstream server');
    const fingerprint = JSON.stringify(config), existing = this.connections.get(name);
    if (existing?.fingerprint === fingerprint) { await existing.ready; return existing; }
    if (existing) void this.dispose(existing);
    const client = new Client({ name: 'cairn-gateway', version: VERSION });
    const transport = config.url ? new StreamableHTTPClientTransport(new URL(config.url), { requestInit: { headers: config.headers } }) :
      new StdioClientTransport({ command: config.command!, args: config.args, env: config.env, stderr: 'inherit' });
    const connection: Connection = { name, fingerprint, client, ready: Promise.resolve(client) };
    this.connections.set(name, connection); this.allConnections.add(connection);
    client.onclose = () => { void this.dispose(connection); };
    client.onerror = error => {
      // SDK error notifications include nonfatal late responses after cancellation.
      if (!client.transport || error instanceof SyntaxError || error instanceof z.ZodError || error.message.startsWith('Unknown message type:')) void this.dispose(connection);
    };
    connection.ready = client.connect(transport, { timeout: 10000 }).then(() => client).catch(async error => { await this.dispose(connection); throw error; });
    await connection.ready;
    return connection;
  }
  async connect(name: string): Promise<Client> { return (await this.connection(name)).client; }
  private async catalog(name: string): Promise<Catalog> {
    const connection = await this.connection(name);
    if (!connection.catalog) connection.catalog = (async () => {
      const tools: Catalog = [], seen = new Set<string>(); let cursor: string | undefined;
      do {
        const page = await connection.client.listTools(cursor ? { cursor } : undefined);
        tools.push(...page.tools); cursor = page.nextCursor;
        if (cursor) {
          if (seen.has(cursor) || seen.size >= 100) throw new CairnError('invalid_catalog', 'Upstream tool pagination did not terminate');
          seen.add(cursor);
        }
      } while (cursor);
      return tools;
    })().catch(async error => {
      connection.catalog = undefined;
      if (!connection.client.transport) await this.dispose(connection);
      throw error;
    });
    return connection.catalog;
  }
  async list() {
    const config = this.config(), names = [...new Set(config.tools.map(tool => tool.server))];
    const catalog = new Map(await Promise.all(names.map(async name => [name, await this.catalog(name)] as const)));
    return config.tools.map(tool => {
      const upstream = catalog.get(tool.server)?.find(candidate => candidate.name === tool.upstream);
      if (!upstream) throw new CairnError('missing_tool', `Whitelisted upstream ${tool.name} is unavailable`);
      return { name: tool.name, role: tool.role, description: upstream.description, inputSchema: structuredClone(upstream.inputSchema) };
    });
  }
  async call(taskId: string, session: Session, name: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<Observation> {
    if (this.closed) throw new CairnError('gateway_closed', 'Gateway has been closed');
    const task = this.engine.store.get(taskId), config = this.config(), tool = config.tools.find(candidate => candidate.name === name);
    if (!tool) throw new CairnError('not_allowed', `Tool ${name} is not on the configured whitelist`);
    let args = input;
    if (tool.role === 'submit') {
      args = structuredClone(input);
      const path = tool.reportPath!.split('.'); let current: any = args;
      for (const key of path.slice(0, -1)) {
        if (current[key] === undefined) current[key] = {};
        if (!current[key] || typeof current[key] !== 'object' || Array.isArray(current[key])) throw new CairnError('invalid_mapping', `Report path ${tool.reportPath} traverses a non-object argument`);
        current = current[key];
      }
      current[path.at(-1)!] = tool.reportFormat === 'markdown' ? markdown(task) : task.report;
    }
    const callId = `gateway:${randomUUID()}`;
    this.engine.beforeTool(taskId, session, callId, name, tool.role === 'submit', tool.role === 'receipt');
    let connection: Connection | undefined, rawResult: unknown, observation: Observation | undefined, transportFailed = false;
    try {
      try {
        signal?.throwIfAborted();
        connection = await this.connection(tool.server);
        const remaining = task.budget.deadline ? Date.parse(task.budget.deadline) - this.engine.now().getTime() : Infinity;
        if (remaining <= 0) throw new CairnError('deadline', 'Task expired while connecting to the upstream server');
        signal?.throwIfAborted();
        rawResult = await connection.client.callTool({ name: tool.upstream, arguments: args }, undefined, { timeout: Math.max(1, Math.min(tool.timeoutMs, remaining)), resetTimeoutOnProgress: false, signal });
      } catch (error) { transportFailed = !!connection && !connection.client.transport; throw error; }
      const result = rawResult as Awaited<ReturnType<Client['callTool']>>, structured = structuredResult(result), scope: Scope = { ...task.scope };
      for (const [key, path] of Object.entries(tool.scopePaths ?? {})) {
        const value = valueAt(structured, path);
        if (typeof value !== 'string') throw new CairnError('invalid_scope', `Missing upstream scope ${key}`);
        scope[key as keyof Scope] = value;
      }
      const ref = tool.resultRefPath ? valueAt(structured, tool.resultRefPath) : undefined;
      const receipt = tool.receiptPath ? valueAt(structured, tool.receiptPath) : undefined;
      observation = this.engine.observe(taskId, session, { callId, tool: name, input: args, output: result, source: 'gateway', status: result.isError ? 'error' : 'success', scope, resultRef: typeof ref === 'string' ? ref : undefined, receipt });
      if (tool.role === 'submit' && !result.isError) {
        if (!receipt) throw new CairnError('ambiguous_submission', 'Submission returned no mapped receipt; reconcile through a configured receipt tool before retrying');
        this.engine.delivery(taskId, session, `submission:${taskId}`, observation.id);
      } else if (tool.role === 'receipt' && !result.isError && receipt) {
        const latest = this.engine.store.get(taskId), submitNames = new Set(config.tools.filter(candidate => candidate.role === 'submit').map(candidate => candidate.name));
        if (!latest.delivery && Object.values(latest.calls).some(call => submitNames.has(call.tool))) this.engine.delivery(taskId, session, `submission:${taskId}`, observation.id);
      }
      return observation;
    } catch (error) {
      // A successful platform submission remains immutable even when its receipt is missing.
      if (!observation) this.engine.observe(taskId, session, { callId, tool: name, input: args, output: rawResult ?? { error: (error as Error).message }, source: 'gateway', status: 'error' });
      if (transportFailed && connection) await this.dispose(connection);
      throw error;
    }
  }
  close(): Promise<void> {
    if (!this.closing) {
      this.closed = true;
      const connections = [...this.allConnections];
      this.closing = Promise.allSettled(connections.map(async connection => { await this.dispose(connection); await connection.ready.catch(() => {}); })).then(() => {});
    }
    return this.closing;
  }
}
