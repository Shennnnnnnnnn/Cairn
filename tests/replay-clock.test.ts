import test from 'node:test';
import assert from 'node:assert/strict';
import { ReplayClock, replayIndexAt, replayTimeline } from '../src/ui/replay-clock.js';

const origin = Date.parse('2026-10-15T12:59:50.153Z');
const at = (offset: number) => ({ at: new Date(origin + offset).toISOString() });

test('natural replay preserves unequal recorded intervals and holds the last known state', () => {
  const axis = replayTimeline([at(0), at(15_809), at(115_822), at(191_332), at(298_100)]);
  let now = 0;
  const clock = new ReplayClock(axis.durationMs, () => now); clock.play();
  assert.equal(axis.durationMs, 298_100);
  now = 10_000; assert.equal(replayIndexAt(axis, clock.position), 0);
  now = 15_809; assert.equal(replayIndexAt(axis, clock.position), 1);
  now = 100_000; assert.equal(replayIndexAt(axis, clock.position), 1);
  now = 115_822; assert.equal(replayIndexAt(axis, clock.position), 2);
  now = 190_000; assert.equal(replayIndexAt(axis, clock.position), 2);
  now = 191_332; assert.equal(replayIndexAt(axis, clock.position), 3);
  now = 298_100; assert.equal(replayIndexAt(axis, clock.position), 4);
});

test('speed is a real time multiplier, including delayed refreshes and rate changes', () => {
  let now = 0;
  const clock = new ReplayClock(300_000, () => now);
  clock.setRate(10); clock.play();
  now = 2_000; assert.equal(clock.position, 20_000);
  clock.setRate(30); assert.equal(clock.position, 20_000, 'changing speed does not jump');
  now = 5_000; assert.equal(clock.position, 110_000, 'no dependence on number of timer ticks');
  clock.play(); now = 6_000; assert.equal(clock.position, 140_000, 'play is idempotent');
  clock.setRate(1); now = 7_000; assert.equal(clock.position, 141_000);
});

test('pause, loading buffers and resume exclude wall time spent stopped', () => {
  let now = 0;
  const clock = new ReplayClock(300_000, () => now); clock.play();
  now = 16_000; clock.pause(); clock.seek(15_809);
  now = 100_000; assert.equal(clock.position, 15_809, 'buffering holds the actual transition');
  clock.setRate(5); clock.play(); now = 102_000; assert.equal(clock.position, 25_809);
  clock.pause(); now = 200_000; assert.equal(clock.position, 25_809);
  clock.play(); now = 201_000; assert.equal(clock.position, 30_809);
});

test('arbitrary seeks select the state at or before that time and stop at the real end', () => {
  let now = 0;
  const axis = replayTimeline([at(0), at(10_000), at(80_000)]);
  const clock = new ReplayClock(axis.durationMs, () => now);
  clock.seek(79_999); assert.equal(replayIndexAt(axis, clock.position), 1);
  clock.seek(5_000); assert.equal(replayIndexAt(axis, clock.position), 0);
  clock.seek(70_000); clock.play(); now = 60_000;
  assert.equal(clock.position, 80_000); assert.equal(replayIndexAt(axis, clock.position), 2);
  clock.seek(-100); assert.equal(clock.position, 0);
  clock.seek(Infinity); assert.equal(clock.position, 0);
  clock.seek(1_000_000); assert.equal(clock.position, 80_000);
  assert.throws(() => clock.setRate(0)); assert.throws(() => clock.setRate(NaN));
});

test('equal timestamps share an instant and regressing/invalid clocks never rewind ledger state', () => {
  const axis = replayTimeline([at(0), at(10_000), at(10_000), at(5_000), { at: 'invalid' }, at(30_000)]);
  assert.deepEqual(axis.offsets, [0, 10_000, 10_000, 10_000, 10_000, 30_000]);
  assert.equal(axis.adjusted, 2); assert.equal(axis.durationMs, 30_000);
  assert.equal(replayIndexAt(axis, 9_999), 0);
  assert.equal(replayIndexAt(axis, 10_000), 4, 'one instant uses the latest saved state');
  assert.equal(replayIndexAt(axis, 29_999), 4);
  assert.equal(replayIndexAt(axis, 30_000), 5);
});

test('empty and single-instant histories have no invented playback duration', () => {
  assert.equal(replayIndexAt(replayTimeline([]), 0), -1);
  for (const records of [[at(0)], [at(0), at(0)], [{ at: 'invalid' }]]) {
    const axis = replayTimeline(records);
    const clock = new ReplayClock(axis.durationMs, () => 100_000); clock.play();
    assert.equal(clock.position, 0); assert.equal(axis.durationMs, 0);
    assert.equal(replayIndexAt(axis, 0), records.length - 1);
  }
});
