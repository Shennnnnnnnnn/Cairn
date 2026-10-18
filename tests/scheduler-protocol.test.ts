import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phaseResponseSchema, parsePhaseOutput, phaseContract, phaseIssues } from '../src/scheduler/protocol.js';

const finding = (extra: Record<string, unknown> = {}) => ({ key: 'fact', text: 'An observed result', status: 'proposed', covers: [], ...extra });
const output = (extra: Record<string, unknown> = {}) => JSON.stringify({ decision: 'continue', ...extra });
const checkpoint = (extra: Record<string, unknown> = {}) => output({ checkpoint: { findings: [finding(extra)] } });
function failure(run: () => unknown): unknown { try { run(); } catch (error) { return error; } throw new Error('Expected a rejected phase response'); }

test('Phase protocol preserves the current fields and exact numeric bounds', () => {
  const valid = { decision: 'complete', summary: 'x'.repeat(1000), reason: 'x'.repeat(2000), checkpoint: {
    summary: 'x'.repeat(1000), findings: Array.from({ length: 12 }, (_, index) => finding({ key: `${index}`.padEnd(160, 'x'), text: 'x'.repeat(1600), basis: 'x'.repeat(2000), references: Array(8).fill('x'.repeat(1000)), covers: Array(100).fill('c1'), from: Array(100).fill('source') })),
    questions: Array(50).fill('x'.repeat(2000)), next: 'x'.repeat(4000), artifacts: Array(16).fill({ path: 'x'.repeat(4000), description: 'x'.repeat(2000) }), report: { summary: 'x'.repeat(16000) },
  }, intents: Array(16).fill({ key: 'x'.repeat(160), title: 'x'.repeat(2000), from: Array(100).fill('source') }) };
  assert.ok(phaseResponseSchema.safeParse(valid).success);
  for (const [name, change] of [
    ['summary', (v: any) => { v.summary += 'x'; }], ['reason', (v: any) => { v.reason += 'x'; }],
    ['finding key', (v: any) => { v.checkpoint.findings[0].key += 'x'; }], ['finding text', (v: any) => { v.checkpoint.findings[0].text += 'x'; }], ['basis', (v: any) => { v.checkpoint.findings[0].basis += 'x'; }],
    ['references', (v: any) => { v.checkpoint.findings[0].references.push('extra'); }], ['reference length', (v: any) => { v.checkpoint.findings[0].references[0] += 'x'; }], ['covers', (v: any) => { v.checkpoint.findings[0].covers.push('c1'); }], ['from', (v: any) => { v.checkpoint.findings[0].from.push('source'); }],
    ['findings', (v: any) => { v.checkpoint.findings.push(finding()); }], ['checkpoint summary', (v: any) => { v.checkpoint.summary += 'x'; }], ['question count', (v: any) => { v.checkpoint.questions.push('extra'); }], ['question length', (v: any) => { v.checkpoint.questions[0] += 'x'; }], ['next', (v: any) => { v.checkpoint.next += 'x'; }],
    ['artifacts', (v: any) => { v.checkpoint.artifacts.push({ path: 'extra' }); }], ['artifact path', (v: any) => { v.checkpoint.artifacts[0].path += 'x'; }], ['artifact description', (v: any) => { v.checkpoint.artifacts[0].description += 'x'; }], ['report summary', (v: any) => { v.checkpoint.report.summary += 'x'; }],
    ['intents', (v: any) => { v.intents.push({ key: 'extra', title: 'extra' }); }], ['intent key', (v: any) => { v.intents[0].key += 'x'; }], ['intent title', (v: any) => { v.intents[0].title += 'x'; }], ['intent from', (v: any) => { v.intents[0].from.push('source'); }],
  ] as const) { const copy = structuredClone(valid); change(copy); assert.equal(phaseResponseSchema.safeParse(copy).success, false, name); }
});

test('Only raw JSON or one entire JSON fence is accepted; prose is never mined for an object', () => {
  const raw = output({ checkpoint: { findings: [finding()] } });
  for (const text of [raw, `  \n${raw}\n `, `\n\t\`\`\`json\n${raw}\n\`\`\`\n `, `\`\`\`\n${raw}\n\`\`\``]) assert.deepEqual(parsePhaseOutput(text, false), JSON.parse(raw));
  for (const text of [`Result: ${raw}`, `${raw}\nFinished`, `Here is JSON:\n\`\`\`json\n${raw}\n\`\`\``, `\`\`\`json\n${raw}\n\`\`\`\nextra`, `\`\`\`json\n${raw}\n\`\`\`\n\`\`\`json\n${raw}\n\`\`\``, `\`\`\`json\n\`\`\`json\n${raw}\n\`\`\`\n\`\`\``, '{} trailing', '[]', 'null', '"text"']) assert.throws(() => parsePhaseOutput(text, false));
});

test('Unknown fields remain forbidden at every phase object level', () => {
  for (const value of [
    { decision: 'continue', unexpected: 'secret' },
    { decision: 'continue', checkpoint: { unexpected: 'secret' } },
    { decision: 'continue', checkpoint: { findings: [finding({ unexpected: 'secret' })] } },
    { decision: 'continue', checkpoint: { artifacts: [{ path: 'file', unexpected: 'secret' }] } },
    { decision: 'continue', checkpoint: { report: { summary: 'report', unexpected: 'secret' } } },
    { decision: 'continue', intents: [{ key: 'inspect', title: 'Inspect', unexpected: 'secret' }] },
  ]) assert.throws(() => parsePhaseOutput(JSON.stringify(value), false));
});

test('Single-layer encoded finding and artifact objects retain the existing transport compatibility', () => {
  const encoded = output({ checkpoint: { findings: [JSON.stringify(finding())], artifacts: [JSON.stringify({ path: 'REPORT.md', description: 'Deliverable' })], next: ' ' } });
  const result = parsePhaseOutput(encoded, false);
  assert.deepEqual(result.checkpoint?.findings, [finding()]); assert.equal(result.checkpoint?.artifacts?.[0]?.path, 'REPORT.md'); assert.equal(result.checkpoint?.next, undefined);
  assert.throws(() => parsePhaseOutput(output({ checkpoint: { findings: [JSON.stringify(JSON.stringify(finding()))] } }), false));
  assert.throws(() => parsePhaseOutput(output({ checkpoint: { findings: [JSON.stringify([finding()])] } }), false));
  assert.throws(() => parsePhaseOutput(output({ checkpoint: { progress: [JSON.stringify({ key: 'work', title: 'Work', status: 'pending' })] } }), false), 'Compatibility never adds forbidden phase fields');
});

test('Workers can propose or suspend but cannot complete, grant coverage or write owner fields', () => {
  assert.equal(parsePhaseOutput(checkpoint(), true).checkpoint?.findings?.[0]?.status, 'proposed');
  assert.equal(parsePhaseOutput(output({ decision: 'suspend' }), true).decision, 'suspend');
  for (const value of [
    { decision: 'complete' }, { intents: [{ key: 'next', title: 'Next' }] },
    { checkpoint: { artifacts: [] } }, { checkpoint: { report: {} } },
    { checkpoint: { findings: [finding({ status: 'supported', basis: 'Read source' })] } },
    { checkpoint: { findings: [finding({ status: 'refuted', basis: 'Excluded by source' })] } },
    { checkpoint: { findings: [finding({ status: 'inconclusive' })] } },
    { checkpoint: { findings: [finding({ covers: ['c1'] })] } },
  ]) assert.throws(() => parsePhaseOutput(output(value), true));
});

test('New supported and refuted findings require grounds; proposals and uncertainty do not', () => {
  for (const status of ['supported', 'refuted']) {
    assert.throws(() => parsePhaseOutput(checkpoint({ status }), false));
    assert.throws(() => parsePhaseOutput(checkpoint({ status, references: [] }), false));
    assert.throws(() => parsePhaseOutput(checkpoint({ status, basis: ' ' }), false));
    assert.equal(parsePhaseOutput(checkpoint({ status, basis: 'Read source' }), false).checkpoint?.findings?.[0]?.status, status);
    assert.equal(parsePhaseOutput(checkpoint({ status, references: ['source.txt'] }), false).checkpoint?.findings?.[0]?.status, status);
  }
  assert.doesNotThrow(() => parsePhaseOutput(checkpoint({ status: 'inconclusive' }), false));
});

test('Existing same-key findings inherit omitted grounds but explicit empty references clear them', () => {
  const references = [{ key: 'fact', id: 'claim-id', references: ['source.txt'] }];
  const inherited = parsePhaseOutput(checkpoint({ status: 'supported' }), false, references);
  assert.equal(inherited.checkpoint?.findings?.[0]?.references, undefined, 'Engine retains ownership of actual inheritance');
  assert.throws(() => parsePhaseOutput(checkpoint({ status: 'supported', references: [] }), false, references));
  assert.doesNotThrow(() => parsePhaseOutput(checkpoint({ status: 'refuted', references: [], basis: 'New exclusion' }), false, references));
  assert.doesNotThrow(() => parsePhaseOutput(checkpoint({ status: 'supported', references: [] }), false, [{ key: 'fact', basis: 'Saved basis' }]));
  assert.throws(() => parsePhaseOutput(checkpoint({ key: 'different', status: 'supported' }), false, references));
  assert.throws(() => parsePhaseOutput(checkpoint({ key: 'claim-id', status: 'supported' }), false, references), 'An ID alias cannot inherit grounds the Engine only resolves by authored key');
});

test('The generated compact contract exposes actual bounds, grounding and branch restrictions', () => {
  const owner = phaseContract(false), worker = phaseContract(true);
  for (const bound of ['160', '1600', '2000', '1000', '4000', '16000', '12', '16', '100', '50', '8']) assert.ok(owner.includes(bound), `Missing live schema bound ${bound}`);
  for (const field of ['decision', 'summary', 'reason', 'checkpoint', 'findings', 'key', 'text', 'status', 'basis', 'references', 'covers', 'from', 'questions', 'next', 'artifacts', 'path', 'description', 'report', 'intents', 'title']) assert.ok(owner.includes(field), field);
  assert.match(owner, /supported.*refuted|refuted.*supported/); assert.match(owner, /inherit|omitted|undefined/); assert.match(owner, /unknown/i);
  assert.match(worker, /proposed/); assert.match(worker, /covers/); assert.match(worker, /complete/);
  assert.ok(owner.length < 2500, `Compact owner contract grew to ${owner.length} characters`);
});

test('Issue feedback has safe short paths and stable signatures without model payloads', () => {
  const first = phaseIssues(failure(() => parsePhaseOutput(output({ PRIVATE_FIELD_A: 'PRIVATE_VALUE' }), false)));
  const renamed = phaseIssues(failure(() => parsePhaseOutput(output({ PRIVATE_FIELD_B: 'OTHER_PRIVATE_VALUE' }), false)));
  const otherParent = phaseIssues(failure(() => parsePhaseOutput(output({ checkpoint: { PRIVATE_FIELD_A: 'PRIVATE_VALUE' } }), false)));
  assert.equal(first.signature, renamed.signature); assert.notEqual(first.signature, otherParent.signature);
  assert.ok(first.issues.length > 0); assert.ok(first.issues.every(issue => issue.path.length < 120 && issue.message.length < 240));
  assert.ok(!JSON.stringify(first).includes('PRIVATE_'));
  const longText = phaseIssues(failure(() => parsePhaseOutput(checkpoint({ text: 'x'.repeat(1601) }), false)));
  const missingGrounds = phaseIssues(failure(() => parsePhaseOutput(checkpoint({ status: 'supported' }), false)));
  assert.notEqual(longText.signature, missingGrounds.signature); assert.match(longText.issues[0]!.path, /checkpoint.*findings.*text/);
  const anotherFinding = phaseIssues(failure(() => parsePhaseOutput(output({ checkpoint: { findings: [finding(), finding({ key: 'second', status: 'supported' })] } }), false)));
  assert.notEqual(missingGrounds.signature, anotherFinding.signature, 'Fixing one finding and reaching another must not count as the unchanged error');
  const fallback = phaseIssues(new Error('PRIVATE_PAYLOAD ' + output({ checkpoint: { findings: [finding()] } })));
  assert.ok(!JSON.stringify(fallback).includes('PRIVATE_PAYLOAD')); assert.ok(!JSON.stringify(fallback).includes('An observed result'));
});
