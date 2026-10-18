import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine, type EngineOptions } from '../src/core/engine.js';
import { Store } from '../src/core/store.js';
import { publicTask, type SchedulerState, type Session } from '../src/core/types.js';
import { Scheduler, schedulerFingerprint, type HostExecutor, type HostRequest, type HostResult } from '../src/scheduler.js';

function fixture(options: EngineOptions = {}, criteria = ['A supported result is saved']) {
  const store = new Store(':memory:'), engine = new Engine(store, undefined, options);
  const owner: Session = { host: 'mcp', sessionId: 'scheduler-owner', cwd: process.cwd() };
  const task = engine.create(owner, { origin: 'Local generic test input', goal: 'Deliver a supported result', criteria, evidenceMode: 'curated' });
  return { store, engine, owner, task, close: () => store.close() };
}
const reply = (value: unknown, extra: Partial<HostResult> = {}): HostResult => ({ output: JSON.stringify(value), ...extra });
const grounded = (key = 'result', covers = ['c1']) => ({ key, text: `Observed ${key}`, status: 'supported' as const, basis: 'Checked the actual local source', covers });
const complete = (key = 'result') => ({ decision: 'complete', checkpoint: { findings: [grounded(key)], report: { summary: 'A supported result' } } });
const board = (request: HostRequest): any => JSON.parse(request.prompt.split('Saved blackboard:\n').at(-1)!);
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(accept => { resolve = accept; }); return { promise, resolve }; }

test('Bootstrap directly saves facts and completes through the configured finish verifier', async () => {
  let checks = 0;
  const f = fixture({ completionVerifier: { id: 'test:independent', verify: task => {
    checks++; assert.equal(task.report?.summary, 'A supported result'); assert.equal(task.claims[0]?.status, 'supported');
    return { ok: true, method: 'inspection', scope: 'Test fixture source check' };
  } } });
  const calls: string[] = [];
  try {
    const executor: HostExecutor = { execute: async request => { calls.push(request.phase); return reply(complete()); } };
    const result = await new Scheduler(f.engine, f.owner, executor).run(f.task.id);
    assert.equal(result.status, 'completed'); assert.equal(checks, 1); assert.deepEqual(calls, ['bootstrap']);
    const task = f.store.get(f.task.id);
    assert.equal(task.status, 'completed'); assert.equal(task.verification?.status, 'passed');
    assert.equal(task.claims[0]?.key, 'result'); assert.equal(task.scheduler?.lease, undefined);
  } finally { f.close(); }
});

test('Reason dispatches parallel Explore branches and must explicitly review full proposal keys before finish', async () => {
  const f = fixture({}, ['First result is reviewed', 'Second result is reviewed']);
  const calls: string[] = []; let reasons = 0, active = 0, maximum = 0;
  const intents = [{ key: 'a', title: 'Inspect the first independent source' }, { key: 'b', title: 'Inspect the second independent source' }];
  try {
    const executor: HostExecutor = { execute: async request => {
      calls.push(request.phase);
      if (calls.length > 8) throw new Error('Unexpected repeated scheduler loop');
      if (request.phase === 'bootstrap') return reply({ decision: 'continue', checkpoint: { findings: [grounded('seed', [])] }, intents });
      if (request.phase === 'explore') {
        active++; maximum = Math.max(maximum, active);
        await delay(20); active--;
        return reply({ decision: 'continue', checkpoint: { findings: [{ key: 'local-observation', text: `Checked branch ${request.branch!.key}`, status: 'proposed', basis: 'Read the assigned independent source', covers: [] }] } });
      }
      assert.equal(request.phase, 'reason'); reasons++;
      if (reasons === 1) return reply({ decision: 'continue' });
      const saved = board(request), proposals = saved.findings.filter((claim: any) => claim.key.startsWith('branch:'));
      assert.equal(proposals.length, 2);
      assert.ok(proposals.every((claim: any) => claim.status === 'proposed' && claim.covers.length === 0));
      assert.ok(saved.work.every((work: any) => work.branchStatus === 'merged'));
      assert.deepEqual(f.store.get(f.task.id).criteria.map(c => c.claimIds), [[], []], 'Merging worker results must not grant coverage');
      return reply({ decision: 'complete', checkpoint: { findings: proposals.map((claim: any, index: number) => ({ key: claim.key, text: claim.text, status: 'supported', basis: 'Owner independently reviewed the referenced source', covers: [`c${index + 1}`] })) } });
    } };
    const result = await new Scheduler(f.engine, f.owner, executor, { maxParallel: 2 }).run(f.task.id);
    assert.equal(result.status, 'completed'); assert.equal(maximum, 2); assert.equal(reasons, 2);
    assert.deepEqual(calls, ['bootstrap', 'reason', 'explore', 'explore', 'reason']);
    const task = f.store.get(f.task.id), reviewed = task.claims.filter(c => c.key?.startsWith('branch:'));
    assert.equal(reviewed.length, 2); assert.ok(reviewed.every(c => c.status === 'supported' && c.history?.some(h => h.status === 'proposed')));
  } finally { f.close(); }
});

for (const questionsOnly of [false, true]) {
  test(`No executable intent suspends ${questionsOnly ? 'even when Reason rewrites questions' : 'without spinning on an unchanged Bootstrap'}`, async () => {
    const f = fixture(); let calls = 0;
    try {
      const executor: HostExecutor = { execute: async request => {
        calls++; if (calls > 3) throw new Error('No-progress review must not repeat');
        return reply(questionsOnly ? { decision: 'continue', checkpoint: { questions: [request.phase === 'bootstrap' ? 'Source unavailable' : 'Still need that source'] } } : { decision: 'continue' });
      } };
      const result = await new Scheduler(f.engine, f.owner, executor).run(f.task.id);
      assert.equal(result.status, 'suspended'); assert.equal(calls, questionsOnly ? 2 : 1);
      assert.equal(f.store.get(f.task.id).status, 'suspended'); assert.equal(f.store.get(f.task.id).claims.length, 0);
    } finally { f.close(); }
  });
}

test('Two scheduler instances cannot share a live task lease; public projections omit its token', async () => {
  const f = fixture(), started = deferred<void>(), release = deferred<HostResult>();
  let calls = 0;
  try {
    const executor: HostExecutor = { execute: async () => { calls++; started.resolve(); return release.promise; } };
    const running = new Scheduler(f.engine, f.owner, executor).run(f.task.id);
    await started.promise;
    const task = f.store.get(f.task.id), projection = publicTask(task);
    assert.ok(task.scheduler?.lease?.token);
    assert.equal(Reflect.has(projection.scheduler!.lease!, 'token'), false);
    assert.equal(projection.scheduler!.lease!.expiresAt, task.scheduler!.lease!.expiresAt);
    assert.ok(f.store.get(f.task.id).scheduler?.lease?.token, 'Redaction must not mutate stored lease credentials');
    await assert.rejects(new Scheduler(f.engine, f.owner, executor).run(f.task.id), /live task lease/);
    assert.equal(calls, 1);
    release.resolve(reply(complete()));
    assert.equal((await running).status, 'completed');
  } finally { release.resolve(reply({ decision: 'suspend' })); f.close(); }
});

test('A new human hint arriving during Reason invalidates its old candidate and triggers a fresh review', async () => {
  const f = fixture(), started = deferred<void>(), release = deferred<HostResult>(); let reasons = 0;
  try {
    f.engine.checkpoint(f.task.id, f.owner, { summary: 'Saved initial source', findings: [grounded('seed', [])] });
    const executor: HostExecutor = { execute: async request => {
      assert.equal(request.phase, 'reason'); reasons++;
      if (reasons === 1) { started.resolve(); return release.promise; }
      assert.ok(board(request).hints.some((hint: any) => hint.text === 'Check the newly supplied source'));
      return reply({...complete('fresh-review'),review:{snapshot:board(request).globalReview.snapshot,summary:'Reconciled the new source, saved findings and goal coverage'}});
    } };
    const running = new Scheduler(f.engine, f.owner, executor).run(f.task.id);
    await started.promise;
    f.engine.addHint(f.task.id, 'Check the newly supplied source');
    release.resolve(reply(complete('stale-review')));
    assert.equal((await running).status, 'completed'); assert.equal(reasons, 3);
    const task = f.store.get(f.task.id);
    assert.ok(task.claims.some(c => c.key === 'fresh-review')); assert.ok(!task.claims.some(c => c.key === 'stale-review'));
    assert.equal(task.hints.length, 1);
    assert.ok(f.store.events(task.id).some(event => event.kind === 'scheduler.stale_reason'));
  } finally { release.resolve(reply({ decision: 'suspend' })); f.close(); }
});

for (const takeover of [false, true]) {
  test(`Late native results cannot write after ${takeover ? 'owner takeover' : 'human suspension'}`, async () => {
    const f = fixture(), started = deferred<void>(), release = deferred<HostResult>();
    try {
      const executor: HostExecutor = { execute: async request => { request.onSession?.('native-old-session'); started.resolve(); return release.promise; } };
      const running = new Scheduler(f.engine, f.owner, executor).run(f.task.id);
      await started.promise;
      const nextOwner = { ...f.owner, sessionId: 'replacement-owner' };
      if (takeover) f.engine.resume(f.task.id, nextOwner, true); else f.engine.suspendByHuman(f.task.id);
      release.resolve(reply(complete('late-result'), { sessionRef: 'native-old-session' }));
      assert.equal((await running).status, 'failed');
      const task = f.store.get(f.task.id);
      assert.equal(task.claims.length, 0); assert.equal(task.status, takeover ? 'active' : 'suspended');
      assert.equal(task.owner.sessionId, takeover ? nextOwner.sessionId : f.owner.sessionId);
    } finally { release.resolve(reply({ decision: 'suspend' })); f.close(); }
  });
}

for(const hostFailure of [false,true])test(`${hostFailure?'Failed native Explore concludes':'Malformed Explore repairs its output'} in the same session, then owner review`, async () => {
  const f = fixture(); const calls: { phase: string; resume?: string }[] = []; let reasons = 0;
  try {
    const executor: HostExecutor = { execute: async request => {
      calls.push({ phase: request.phase, resume: request.resume });
      if (calls.length > 7) throw new Error('Conclude must not repeat');
      if (request.phase === 'bootstrap') return reply({ decision: 'continue', checkpoint: { findings: [grounded('seed', [])] }, intents: [{ key: 'inspect', title: 'Inspect a missing source' }] });
      if (request.phase === 'explore'&&!request.repair) { request.onSession?.('same-native-session'); return { output: 'malformed JSON', sessionRef: 'same-native-session',...(hostFailure?{error:'Native execution failed after collecting results'}:{}) }; }
      if (request.phase === 'conclude'||request.repair) {
        assert.equal(request.resume, 'same-native-session');
        return reply({ decision: 'continue', checkpoint: { findings: [{ key: 'recovered', text: 'Source was checked before the error', status: 'proposed', basis: 'Saved native tool result', covers: [] }] } }, { sessionRef: 'same-native-session',metrics:{toolCalls:0} });
      }
      reasons++; if (reasons === 1) return reply({ decision: 'continue' });
      const proposal = board(request).findings.find((claim: any) => claim.key.startsWith('branch:'));
      assert.equal(proposal.status, 'proposed');
      return reply({ decision: 'complete', checkpoint: { findings: [{ ...grounded(proposal.key), text: proposal.text }] } });
    } };
    assert.equal((await new Scheduler(f.engine, f.owner, executor).run(f.task.id)).status, 'completed');
    assert.deepEqual(calls.map(c => c.phase), ['bootstrap', 'reason', 'explore', hostFailure?'conclude':'explore', 'reason']);
  } finally { f.close(); }
});

test('Abort stops the active native phase without conclude or a replacement launch', async () => {
  const f = fixture(), started = deferred<void>(), controller = new AbortController(); const calls: string[] = [];
  try {
    const executor: HostExecutor = { execute: async (request, signal) => {
      calls.push(request.phase); request.onSession?.('interrupted-native-session'); started.resolve();
      await new Promise<void>(resolve => signal!.addEventListener('abort', () => resolve(), { once: true }));
      return { output: '', sessionRef: 'interrupted-native-session', interrupted: true };
    } };
    const running = new Scheduler(f.engine, f.owner, executor).run(f.task.id, controller.signal);
    await started.promise; controller.abort();
    assert.equal((await running).status, 'interrupted'); assert.deepEqual(calls, ['bootstrap']);
    const task = f.store.get(f.task.id);
    assert.notEqual(task.status, 'completed'); assert.equal(task.claims.length, 0);
    assert.equal(task.scheduler?.inflight[0]?.sessionRef, 'interrupted-native-session');
  } finally { controller.abort(); f.close(); }
});

for (const savedCandidate of [false, true]) {
  test(`Cross-epoch recovery ${savedCandidate ? 'applies the saved candidate' : 'concludes the original native session'} without repeating an action`, async () => {
    const f = fixture(); const calls: string[] = [];
    try {
      const previous = f.store.get(f.task.id);
      previous.scheduler = { version: 1, epoch: previous.owner.epoch, bootstrapDone: true, sequence: 1, status: 'running', lease: { token: 'old-token', expiresAt: '2999-01-01T00:00:00Z' }, failedBranches: [], inflight: [{ id: 'old-bootstrap', phase: 'bootstrap', startedAt: previous.createdAt, fingerprint: 'old-proof', sessionRef: 'original-native-session', ...(savedCandidate ? { candidate: complete('recovered') } : {}) }] };
      f.store.save(previous, 'test.crash', {}, f.engine.at());
      const nextOwner = { ...f.owner, sessionId: 'recovered-owner' };
      f.engine.resume(f.task.id, nextOwner, true);
      const executor: HostExecutor = { canResume: () => true, execute: async request => {
        calls.push(request.phase);
        assert.ok(calls.length <= 2, 'Recovery may conclude once then review once');
        if (request.phase === 'conclude') { assert.equal(request.resume, 'original-native-session'); return reply(complete('recovered')); }
        assert.equal(request.phase, 'reason'); assert.ok(board(request).findings.some((claim: any) => claim.key === 'recovered'));
        return reply({ decision: 'complete' });
      } };
      const result = await new Scheduler(f.engine, nextOwner, executor).run(f.task.id);
      assert.equal(result.status, 'completed'); assert.deepEqual(calls, savedCandidate ? ['reason'] : ['conclude', 'reason']);
      assert.equal(f.store.get(f.task.id).claims.filter(c => c.key === 'recovered').length, 1);
      assert.equal(f.store.get(f.task.id).owner.epoch, previous.owner.epoch + 1);
    } finally { f.close(); }
  });
}

test('A saved Explore candidate recovers as a proposal across epochs without repeating native exploration', async () => {
  const f = fixture(); const calls: string[] = [];
  try {
    f.engine.recordProgress(f.task.id, f.owner, [{ key: 'inspect', title: 'Inspect the source', status: 'pending', delegated: true }]);
    const old = f.store.get(f.task.id), candidate = { decision: 'continue', checkpoint: { findings: [{ key: 'saved', text: 'Saved observed result', status: 'proposed', basis: 'Original source read', covers: [] }] } };
    old.scheduler = { version: 1, epoch: old.owner.epoch, bootstrapDone: true, sequence: 1, status: 'running', failedBranches: [], inflight: [{ id: 'old-explore', phase: 'explore', branch: { key: 'inspect', title: 'Inspect the source' }, startedAt: old.createdAt, fingerprint: 'old-proof', candidate }] };
    f.store.save(old, 'test.crash', {}, f.engine.at());
    const nextOwner = { ...f.owner, sessionId: 'recovered-owner' }; f.engine.resume(f.task.id, nextOwner, true);
    const executor: HostExecutor = { execute: async request => {
      calls.push(request.phase); assert.equal(request.phase, 'reason');
      const proposal = board(request).findings.find((claim: any) => claim.key.startsWith('branch:'));
      assert.equal(proposal.status, 'proposed'); assert.deepEqual(proposal.covers, []);
      return reply({ decision: 'complete', checkpoint: { findings: [{ ...grounded(proposal.key), text: proposal.text }] } });
    } };
    assert.equal((await new Scheduler(f.engine, nextOwner, executor).run(f.task.id)).status, 'completed');
    assert.deepEqual(calls, ['reason']);
  } finally { f.close(); }
});

test('The same rejected candidate cannot endlessly repeat host acceptance checks', async () => {
  let checks = 0, phases = 0;
  const f = fixture({ completionVerifier: { id: 'test:reject', verify: () => { checks++; return { ok: false, issues: [{ message: 'Independent source mismatch' }] }; } } });
  try {
    const executor: HostExecutor = { execute: async request => {
      phases++; if (phases > 3) throw new Error('Unchanged completion loop');
      return reply(request.phase === 'bootstrap' ? complete() : { decision: 'complete', checkpoint: { questions: ['Same unsupported completion, rephrased'] } });
    } };
    const result = await new Scheduler(f.engine, f.owner, executor).run(f.task.id);
    assert.equal(result.status, 'suspended'); assert.equal(phases, 2); assert.equal(checks, 1);
    assert.match(result.reason!, /unchanged candidate already failed completion/);
    const task = f.store.get(f.task.id);
    assert.equal(task.status, 'suspended'); assert.equal(task.verification?.status, 'failed'); assert.equal(task.claims.length, 1);
  } finally { f.close(); }
});

test('A pre-aborted scheduler request cannot acquire a lease or mutate task state', async () => {
  const f = fixture(), controller = new AbortController(); controller.abort(); let calls = 0;
  try {
    const before = f.store.get(f.task.id), events = f.store.events(f.task.id).length;
    const executor: HostExecutor = { execute: async () => { calls++; return reply(complete()); } };
    await assert.rejects(new Scheduler(f.engine, f.owner, executor).run(f.task.id, controller.signal), /aborted/i);
    assert.deepEqual(f.store.get(f.task.id), before); assert.equal(f.store.events(f.task.id).length, events); assert.equal(calls, 0);
  } finally { f.close(); }
});

test('An interrupted Reason candidate cannot reuse its reviewed fingerprint without a fresh review', async () => {
  const f = fixture(); let calls = 0;
  try {
    f.engine.checkpoint(f.task.id, f.owner, { summary: 'Saved source', findings: [grounded('seed', [])] });
    const old = f.store.get(f.task.id);
    old.scheduler = { version: 1, epoch: old.owner.epoch, bootstrapDone: true, sequence: 1, status: 'running', failedBranches: [], inflight: [{ id: 'old-reason', phase: 'reason', startedAt: old.createdAt, fingerprint: 'previous', sessionRef:'closed-reason-session',candidate: complete('discarded-review') }] };
    old.scheduler.reasonFingerprint = schedulerFingerprint(f.engine, old);
    f.store.save(old, 'test.crash', {}, f.engine.at());
    const executor: HostExecutor = { canResume:sessionRef=>sessionRef==='closed-reason-session',execute: async request => { calls++; assert.equal(request.phase, 'reason'); return reply(complete('fresh-review')); } };
    assert.equal((await new Scheduler(f.engine, f.owner, executor).run(f.task.id)).status, 'completed');
    assert.equal(calls, 1);
    const task = f.store.get(f.task.id); assert.ok(task.claims.some(c => c.key === 'fresh-review')); assert.ok(!task.claims.some(c => c.key === 'discarded-review'));
  } finally { f.close(); }
});

for (const canResume of [undefined, () => false]) {
  test(`Crash recovery refuses ${canResume ? 'a known live process' : 'unknown prior process state'} before launching any native phase`, async () => {
    const f = fixture(); let calls = 0;
    try {
      const old = f.store.get(f.task.id);
      old.scheduler = { version: 1, epoch: old.owner.epoch, bootstrapDone: true, sequence: 1, status: 'running', failedBranches: [], inflight: [{ id: 'old-bootstrap', phase: 'bootstrap', startedAt: old.createdAt, fingerprint: 'old', sessionRef: 'possibly-live-native-session' }] };
      f.store.save(old, 'test.crash', {}, f.engine.at());
      const executor: HostExecutor = { canResume, execute: async () => { calls++; return reply(complete()); } };
      const result = await new Scheduler(f.engine, f.owner, executor).run(f.task.id);
      assert.equal(result.status, 'failed'); assert.match(result.reason!, /process exit is unknown|still running/); assert.equal(calls, 0);
      const task = f.store.get(f.task.id); assert.notEqual(task.status, 'completed'); assert.equal(task.claims.length, 0); assert.equal(task.scheduler?.inflight[0]?.sessionRef, 'possibly-live-native-session');
    } finally { f.close(); }
  });
}

for (const sourceAlias of [false, true]) {
  test(`An existing Intent can be repeated with ${sourceAlias ? 'a readable source alias after canonicalization' : 'empty from instead of omitted from'}`, async () => {
    const f = fixture(); let reasons = 0; const calls: string[] = [];
    try {
      f.engine.checkpoint(f.task.id, f.owner, { summary: 'Initial source', findings: [grounded('seed', [])] });
      const intent = { key: 'inspect', title: 'Inspect the remaining source', ...(sourceAlias ? { from: ['seed'] } : {}) };
      f.engine.recordProgress(f.task.id, f.owner, [{ ...intent, status: 'pending', delegated: true }]);
      if (sourceAlias) assert.deepEqual(f.store.get(f.task.id).progress?.[0]?.from, [`claim:${f.store.get(f.task.id).claims[0]!.id}`]);
      const executor: HostExecutor = { execute: async request => {
        calls.push(request.phase); if (calls.length > 3) throw new Error('Intent must execute exactly once');
        if (request.phase === 'explore') return reply({ decision: 'continue', checkpoint: { findings: [{ key: 'source', text: 'Observed remaining source', status: 'proposed', basis: 'Read native source', covers: [] }] } });
        assert.equal(request.phase, 'reason'); reasons++;
        if (reasons === 1) return reply({ decision: 'continue', intents: [{ ...intent, from: sourceAlias ? ['seed'] : [] }] });
        const proposal = board(request).findings.find((claim: any) => claim.key.startsWith('branch:'));
        return reply({ decision: 'complete', checkpoint: { findings: [{ ...grounded(proposal.key), text: proposal.text }] } });
      } };
      assert.equal((await new Scheduler(f.engine, f.owner, executor).run(f.task.id)).status, 'completed');
      assert.deepEqual(calls, ['reason', 'explore', 'reason']);
    } finally { f.close(); }
  });
}
