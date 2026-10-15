import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CairnError } from './core/types.js';
import { VERSION } from './version.js';

const service = z.enum(['quote-display']);
const requests = {
  service_health: z.object({ service }).strict(),
  price_sample: z.object({ symbol: z.enum(['DEMO.600001']), version: z.enum(['1.4', '1.5']) }).strict(),
  client_mapping: z.object({ version: z.enum(['1.4', '1.5']) }).strict(),
  version_impact: z.object({ service }).strict(),
};
const descriptions = {
  service_health: 'Local fictional demo: inspect quote-display process health. No network access.',
  price_sample: 'Local fictional demo: compare the source quote and client display for a version.',
  client_mapping: 'Local fictional demo: inspect the unit conversion implemented by a client version.',
  version_impact: 'Local fictional demo: count affected users by client version in the fixture window.',
};

export function readDemoScenario(root: string): any {
  const scenario = JSON.parse(readFileSync(join(root, 'scenario.json'), 'utf8'));
  if (scenario.demo !== true || scenario.kind !== 'cairn-price-unit-demo' || scenario.schemaVersion !== 1) {
    throw new CairnError('invalid_demo', 'This directory does not contain a Cairn local demo scenario');
  }
  return scenario;
}

/** Deterministic, read-only fixture tools. These are actual MCP responses, never production evidence. */
export async function startDemoTools(root: string) {
  const scenario = readDemoScenario(root);
  const server = new Server({ name: 'cairn-local-demo-tools', version: VERSION }, { capabilities: { tools: {} } });
  const audit = (event: string, extra: Record<string, unknown> = {}) => appendFileSync(join(root, 'demo-processes.jsonl'), JSON.stringify({ demo: true, event, pid: process.pid, at: new Date().toISOString(), ...extra }) + '\n', { mode: 0o600 });
  audit('started');
  process.once('exit', () => audit('exited'));
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: Object.entries(requests).map(([name, schema]) => {
    const inputSchema = z.toJSONSchema(schema, { io: 'input' }) as { type: 'object'; $schema?: string };
    delete inputSchema.$schema;
    return { name, description: descriptions[name as keyof typeof descriptions], inputSchema, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } };
  }) }));
  server.setRequestHandler(CallToolRequestSchema, async request => {
    const name = request.params.name as keyof typeof requests;
    if (!Object.hasOwn(requests, name)) throw new CairnError('unknown_tool', 'Unknown local demo tool');
    const input = requests[name].parse(request.params.arguments ?? {}) as Record<string, string>;
    const value = name === 'price_sample' || name === 'client_mapping' ? scenario.fixtures[name][input.version!] : scenario.fixtures[name];
    if (!value || value.demo !== true || !value.result_ref?.startsWith('demo:')) throw new CairnError('invalid_demo', 'Demo fixtures must have explicit demo provenance');
    audit('tool', { name, arguments: input });
    return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
  });
  server.onclose = () => audit('transport_closed');
  await server.connect(new StdioServerTransport());
  return server;
}
