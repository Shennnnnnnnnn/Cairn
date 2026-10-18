import { createHash } from 'node:crypto';
import { z } from 'zod';
import { prepareModelInput } from '../tools.js';

const text = z.string().trim().min(1);
const finding = z.object({
  key: text.max(160), text: text.max(1600), status: z.enum(['proposed', 'supported', 'refuted', 'inconclusive']),
  basis: text.max(2000).optional(), references: z.array(text.max(1000)).max(8).optional(),
  covers: z.array(text).max(100), from: z.array(text).max(100).optional(),
}).strict();
const checkpoint = z.object({
  summary: text.max(1000).optional(), findings: z.array(finding).max(12).optional(),
  questions: z.array(text.max(2000)).max(50).optional(), next: text.max(4000).optional(),
  artifacts: z.array(z.object({ path: text.max(4000), description: text.max(2000).optional() }).strict()).max(16).optional(),
  report: z.object({ summary: text.max(16000).optional() }).strict().optional(),
}).strict();

/** The single structural schema shared by phase parsing and the compact contract. */
export const phaseResponseSchema = z.object({
  decision: z.enum(['continue', 'complete', 'suspend']), summary: text.max(1000).optional(), reason: text.max(2000).optional(),
  checkpoint: checkpoint.optional(),
  review:z.object({snapshot:z.number().int().positive(),summary:text.max(2000)}).strict().optional(),
  intents: z.array(z.object({ key: text.max(160), title: text.max(2000), from: z.array(text).max(100).optional() }).strict()).max(16).optional(),
}).strict();
export type PhaseResponse = z.infer<typeof phaseResponseSchema>;
type ExistingFinding = { key?: string; id?: string; basis?: string; references?: string[] };

const rules = {
  grounding: 'Supported/refuted findings require nonempty basis or references; otherwise use proposed or inconclusive.',
  workerDecision: 'Workers cannot complete the main goal; use continue or suspend.',
  workerIntents: 'Workers cannot create exploration intents.',
  workerArtifacts: 'Workers cannot write main-goal artifacts.',
  workerReport: 'Workers cannot write the main-goal report.',
  workerReview: 'Workers cannot acknowledge owner global review.',
  workerStatus: 'Worker findings must have status proposed for owner review.',
  workerCoverage: 'Worker findings require covers:[]; only the owner may grant criterion coverage.',
  completeIntents: 'Choose completion or new exploration, not both. Use continue with intents for an unresolved required gap.',
} as const;
type Rule = keyof typeof rules;

class PhaseOutputError extends Error {
  readonly code = 'invalid_phase_json';
  constructor() { super('Return one JSON object, optionally inside one entire JSON fence, without surrounding prose.'); this.name = 'PhaseOutputError'; }
}

/** Parse a public response without searching prose, inferring fields or copying private content. */
export function parsePhaseOutput(output: string, worker: boolean, existingFindings: readonly ExistingFinding[] = []): PhaseResponse {
  let source = output.trim();
  if (source.startsWith('```')) {
    const fenced = /^```(?:json)?[\t ]*\r?\n([\s\S]*?)\r?\n```$/i.exec(source);
    if (!fenced) throw new PhaseOutputError();
    source = fenced[1]!;
  }
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new PhaseOutputError(); }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'checkpoint' in value) {
    const input=prepareModelInput('cairn_checkpoint', value.checkpoint);
    if(input&&typeof input==='object'&&!Array.isArray(input)){
      const saved={...input} as Record<string,unknown>;
      // Lossless transport compatibility; never coerce values or truncate steps.
      if(Array.isArray(saved.next)&&saved.next.length>0&&saved.next.length<=50&&saved.next.every(v=>typeof v==='string'&&v.trim().length>0))saved.next=saved.next.join('\n');
      if(worker&&Array.isArray(saved.findings))saved.findings=saved.findings.map(f=>f&&typeof f==='object'&&!Array.isArray(f)?{status:'proposed',covers:[],...f}:f);
      value={...value,checkpoint:saved};
    }
  }
  const parsed = phaseResponseSchema.parse(value), issues: z.core.$ZodIssue[] = [];
  const issue = (path: (string | number)[], rule: Rule) => issues.push({ code: 'custom', path, message: rules[rule], params: { phaseRule: rule } });
  if(parsed.decision==='complete'&&parsed.intents?.length)issue(['intents'],'completeIntents');
  if (worker) {
    if (parsed.decision === 'complete') issue(['decision'], 'workerDecision');
    if (parsed.intents?.length) issue(['intents'], 'workerIntents');
    if (parsed.checkpoint?.artifacts !== undefined) issue(['checkpoint', 'artifacts'], 'workerArtifacts');
    if (parsed.checkpoint?.report !== undefined) issue(['checkpoint', 'report'], 'workerReport');
    if (parsed.review !== undefined) issue(['review'], 'workerReview');
  }
  parsed.checkpoint?.findings?.forEach((item, index) => {
    const path = ['checkpoint', 'findings', index];
    if (worker) {
      if (item.status !== 'proposed') issue([...path, 'status'], 'workerStatus');
      if (item.covers.length) issue([...path, 'covers'], 'workerCoverage');
    } else if (item.status === 'supported' || item.status === 'refuted') {
      // Match Engine.checkpointOn: only an authored key inherits, omitted fields
      // retain prior grounds, and an explicit [] clears the old references.
      const previous = existingFindings.find(existing => existing.key === item.key);
      const basis = item.basis === undefined ? previous?.basis : item.basis;
      const references = item.references === undefined ? previous?.references : item.references;
      if (!basis?.trim() && !references?.some(reference => reference.trim())) issue([...path, 'basis'], 'grounding');
    }
  });
  if (issues.length) throw new z.ZodError(issues);
  return parsed;
}

type JsonShape = { type?: string; enum?: string[]; properties?: Record<string, JsonShape>; required?: string[]; items?: JsonShape; minLength?: number; maxLength?: number; maxItems?: number };
const jsonShape = z.toJSONSchema(phaseResponseSchema, { io: 'input' }) as JsonShape;
function compact(shape: JsonShape): string {
  if (shape.enum) return shape.enum.join('|');
  if (shape.type === 'object') return `{${Object.entries(shape.properties ?? {}).map(([key, child]) => `${key}${shape.required?.includes(key) ? '' : '?'}:${compact(child)}`).join(',')}}`;
  if (shape.type === 'array') return `[${compact(shape.items ?? {})}]${shape.maxItems === undefined ? '' : `<=${shape.maxItems}`}`;
  if (shape.type === 'string') return `text${shape.maxLength === undefined ? '' : `<=${shape.maxLength}`}`;
  return shape.type ?? 'value';
}

/** Compact shape is generated from the exact schema, not a second handwritten field list. */
export function phaseContract(worker: boolean): string {
  const shape = structuredClone(jsonShape);
  if (worker) {
    shape.properties!.decision!.enum = shape.properties!.decision!.enum!.filter(value => value !== 'complete');
    delete shape.properties!.intents; delete shape.properties!.review;
    const properties = shape.properties!.checkpoint!.properties!;
    delete properties.artifacts; delete properties.report;
    const fields = properties.findings!.items!.properties!;
    delete fields.status; delete fields.covers;
  }
  return [
    'Return one JSON object, raw or in one entire JSON fence; no surrounding prose. Only listed keys; unknown fields are forbidden. Text is trimmed and nonempty; <= is the maximum characters/items. ? means optional.',
    compact(shape),
    worker ? 'The host assigns proposed status and covers:[]; omit these fields. Never complete the main goal or write intents, artifacts or report.' : [rules.grounding, 'If globalReview has pending changes, inspect that snapshot and return review:{snapshot:globalReview.snapshot,summary:your evidence-based review}. New findings may require a subsequent review snapshot. Omitted same-key grounds inherit; references:[] clears references. covers uses criterion IDs; from names saved keys. Choose completion or new intents. Omit unused fields; complete needs only decision when saved proof is sufficient.'].join(' '),
  ].join('\n');
}

const fieldPath = (path: readonly PropertyKey[]) => path.reduce<string>((result, key) => typeof key === 'number' ? `${result}[${key}]` : `${result === '$' ? '' : `${result}.`}${String(key)}`, '$');
function safeIssue(issue: z.core.$ZodIssue): { code: string; message: string } {
  switch (issue.code) {
    case 'unrecognized_keys': return { code: issue.code, message: 'Unknown fields are forbidden; remove keys absent from the phase contract.' };
    case 'invalid_type': return { code: `${issue.code}:${issue.expected}`, message: `Expected ${issue.expected}.` };
    case 'invalid_value': return { code: issue.code, message: 'Choose one of the allowed values in the phase contract.' };
    case 'too_big': return { code: `${issue.code}:${issue.origin}:${issue.maximum}`, message: `Maximum ${issue.maximum} ${issue.origin === 'array' ? 'items' : 'characters'}.` };
    case 'too_small': return { code: `${issue.code}:${issue.origin}:${issue.minimum}`, message: `Minimum ${issue.minimum} ${issue.origin === 'array' ? 'items' : 'non-whitespace characters'}.` };
    case 'custom': {
      const rule = issue.params?.phaseRule;
      if (typeof rule === 'string' && Object.hasOwn(rules, rule)) return { code: `rule:${rule}`, message: rules[rule as Rule] };
      return { code: issue.code, message: 'This field does not satisfy the phase contract.' };
    }
    default: return { code: issue.code, message: 'This field does not satisfy the phase contract.' };
  }
}

/** Bounded diagnostics contain no rejected JSON values or unknown-key payloads. */
export function phaseIssues(error: unknown): { signature: string; issues: { path: string; message: string }[] } {
  if (error instanceof z.ZodError) {
    const values = error.issues.map(issue => ({ path: fieldPath(issue.path), ...safeIssue(issue) }));
    const identity = [...new Set(values.map(({ path, code }) => `${path}:${code}`))].sort();
    const signature = createHash('sha256').update(JSON.stringify(identity)).digest('hex').slice(0, 24);
    return { signature, issues: values.slice(0, 8).map(({ path, message }) => ({ path: path.slice(0, 119), message: message.slice(0, 239) })) };
  }
  const code = error instanceof PhaseOutputError ? error.code : error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'phase_validation_error';
  return {
    signature: createHash('sha256').update(code).digest('hex').slice(0, 24),
    issues: [{ path: '$', message: error instanceof PhaseOutputError ? error.message : 'Phase output could not be validated; follow the phase contract.' }],
  };
}
