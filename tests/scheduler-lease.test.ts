import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { Engine } from '../src/core/engine.js';
import { Store } from '../src/core/store.js';
import type { Session } from '../src/core/types.js';
import { Scheduler, type HostExecutor, type HostRequest, type HostResult } from '../src/scheduler.js';

const leaseSeconds = 10;
const nativePhaseMs = 11_100;
const reply = (value: unknown): HostResult => ({ output: JSON.stringify(value) });
const board = (request: HostRequest): any => JSON.parse(request.prompt.split('Saved blackboard:\n').at(-1)!);

function fixture() {
  const store = new Store(':memory:'), engine = new Engine(store);
  const owner: Session = { host: 'mcp', sessionId: 'lease-owner', cwd: process.cwd() };
  const task = engine.create(owner, { origin: 'Generic local source', goal: 'Review an observed result', criteria: ['An observed result is reviewed'], evidenceMode: 'curated' });
  return { store, engine, owner, task };
}

async function crossOriginalLease(f: ReturnType<typeof fixture>, branchKey: string, signal?: AbortSignal) {
  const before = f.store.get(f.task.id), branch = before.progress?.find(item => item.key === branchKey);
  assert.ok(before.scheduler?.lease); assert.ok(branch?.lease);
  const initialSchedulerExpiry = Date.parse(before.scheduler.lease.expiresAt);
  const initialBranchExpiry = Date.parse(branch.lease.expiresAt);
  const schedulerToken = before.scheduler.lease.token, branchToken = branch.lease.token, worker = branch.lease.actor.sessionId;
  await delay(nativePhaseMs, undefined, { signal });
  const now = Date.now(), after = f.store.get(f.task.id), renewed = after.progress?.find(item => item.key === branchKey);
  assert.ok(now > initialSchedulerExpiry, 'The native phase must actually outlive the original scheduler lease');
  assert.ok(now > initialBranchExpiry, 'The native phase must actually outlive the original branch lease');
  assert.equal(after.scheduler?.lease?.token, schedulerToken, 'The same dispatcher must retain its lease');
  assert.equal(renewed?.lease?.token, branchToken, 'The same worker must retain its branch token');
  assert.ok(Date.parse(after.scheduler!.lease!.expiresAt) > now, 'Scheduler heartbeats must keep the dispatcher lease live');
  assert.ok(Date.parse(renewed!.lease!.expiresAt) > now, 'Branch heartbeats must keep the actual worker lease live');
  const events = f.store.events(f.task.id);
  assert.ok(events.filter(event => event.kind === 'scheduler.heartbeat').length >= 2);
  assert.ok(events.filter(event => event.kind === 'branch.heartbeat' && event.payload.actor.sessionId === worker).length >= 2);
  return { branchToken, epoch: renewed!.lease!.epoch };
}

function reviewed(request: HostRequest) {
  const saved = board(request), proposal = saved.findings.find((claim: any) => claim.key.startsWith('branch:'));
  assert.ok(proposal, 'The native result must persist as a worker proposal before review');
  assert.equal(proposal.status, 'proposed'); assert.deepEqual(proposal.covers, []);
  assert.equal(saved.work.find((item: any) => item.key === 'inspect')?.branchStatus, 'merged');
  return reply({ decision: 'complete', checkpoint: { findings: [{ key: proposal.key, text: proposal.text, status: 'supported', basis: 'Owner reviewed the original source after the long native phase', covers: ['c1'] }] } });
}

test('Real scheduler and worker leases renew across long native phases', { concurrency: 2, timeout: 30_000 }, async t => {
  await Promise.all([
    t.test('Explore outlives its original ten-second lease and can submit for owner review', { timeout: 25_000 }, async () => {
      const f = fixture(); const phases: string[] = []; let reasons = 0;
      try {
        const executor: HostExecutor = { execute: async (request, signal) => {
          phases.push(request.phase);
          if (phases.length > 4) throw new Error('The original native phase must not be restarted');
          if (request.phase === 'bootstrap') return reply({ decision: 'continue', checkpoint: { findings: [{ key: 'seed', text: 'Source is available', status: 'supported', basis: 'Read the local source index', covers: [] }] }, intents: [{ key: 'inspect', title: 'Inspect the remaining source' }] });
          if (request.phase === 'explore') {
            await crossOriginalLease(f, 'inspect', signal);
            return reply({ decision: 'continue', checkpoint: { findings: [{ key: 'observed', text: 'Observed result from the long exploration', status: 'proposed', basis: 'Source read completed in the original native phase', covers: [] }] } });
          }
          assert.equal(request.phase, 'reason'); reasons++;
          return reasons === 1 ? reply({ decision: 'continue' }) : reviewed(request);
        } };
        const result = await new Scheduler(f.engine, f.owner, executor, { sessionMode: 'multi', leaseSeconds }).run(f.task.id);
        assert.equal(result.status, 'completed', result.reason); assert.deepEqual(phases, ['bootstrap', 'reason', 'explore', 'reason']);
        const saved = f.store.get(f.task.id);
        assert.equal(saved.status, 'completed'); assert.equal(saved.progress?.[0]?.branchStatus, 'merged');
        assert.ok(saved.claims.some(claim => claim.status === 'supported' && claim.history?.some(old => old.status === 'proposed')));
      } finally { f.store.close(); }
    }),
    t.test('Cross-epoch recovery conclude renews its replacement branch lease until the saved proposal is reviewed', { timeout: 25_000 }, async () => {
      const f = fixture(); const phases: string[] = []; let resumed = 0;
      try {
        f.engine.recordProgress(f.task.id, f.owner, [{ key: 'inspect', title: 'Inspect the remaining source', status: 'pending', delegated: true }]);
        const previousWorker: Session = { host: 'mcp', sessionId: 'previous-worker', cwd: f.owner.cwd };
        const previousClaim = f.engine.branch(f.task.id, previousWorker, 'inspect', 'claim', undefined, undefined, leaseSeconds);
        const old = f.store.get(f.task.id), oldEpoch = old.owner.epoch;
        old.scheduler = { version: 1, epoch: oldEpoch, bootstrapDone: true, sequence: 1, status: 'running', failedBranches: [], inflight: [{ id: 'previous-explore', phase: 'explore', branch: { key: 'inspect', title: 'Inspect the remaining source' }, startedAt: old.createdAt, fingerprint: 'previous-input', sessionRef: 'original-native-session' }] };
        f.store.save(old, 'test.crashed_dispatcher', {}, f.engine.at());
        const nextOwner: Session = { ...f.owner, sessionId: 'next-owner' };
        f.engine.resume(f.task.id, nextOwner, true);
        const executor: HostExecutor = {
          canResume(sessionRef, cwd) { resumed++; assert.equal(sessionRef, 'original-native-session'); assert.equal(cwd, nextOwner.cwd); return true; },
          async execute(request, signal) {
            phases.push(request.phase);
            if (phases.length > 2) throw new Error('Recovery must not repeat exploration or conclude');
            if (request.phase === 'conclude') {
              assert.equal(request.resume, 'original-native-session');
              const renewed = await crossOriginalLease(f, 'inspect', signal);
              assert.equal(renewed.epoch, oldEpoch + 1); assert.notEqual(renewed.branchToken, previousClaim.leaseToken);
              return reply({ decision: 'continue', checkpoint: { findings: [{ key: 'recovered', text: 'Result recovered from the original native session', status: 'proposed', basis: 'Existing source result saved during conclude', covers: [] }] } });
            }
            assert.equal(request.phase, 'reason'); return reviewed(request);
          },
        };
        const result = await new Scheduler(f.engine, nextOwner, executor, { leaseSeconds }).run(f.task.id);
        assert.equal(result.status, 'completed', result.reason); assert.deepEqual(phases, ['conclude', 'reason']); assert.equal(resumed, 1);
        const saved = f.store.get(f.task.id);
        assert.equal(saved.status, 'completed'); assert.equal(saved.owner.epoch, oldEpoch + 1);
        assert.ok(saved.claims.some(claim => claim.status === 'supported' && claim.history?.some(previous => previous.status === 'proposed')));
      } finally { f.store.close(); }
    }),
  ]);
});
