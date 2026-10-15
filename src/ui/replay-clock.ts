/** Recorded time, in ledger order. Clock regressions never rewind domain state. */
export interface ReplayTimeline {
  startMs: number;
  durationMs: number;
  offsets: number[];
  adjusted: number;
}

export function replayTimeline(records: readonly { at: string }[]): ReplayTimeline {
  const startMs = records.map(record => Date.parse(record.at)).find(Number.isFinite) ?? 0;
  let previous = 0, adjusted = 0;
  const offsets = records.map(record => {
    const timestamp = Date.parse(record.at), offset = timestamp - startMs;
    if (!Number.isFinite(timestamp) || offset < previous) adjusted++;
    previous = Number.isFinite(timestamp) ? Math.max(previous, offset) : previous;
    return previous;
  });
  return { startMs, durationMs: previous, offsets, adjusted };
}

/** The latest recorded state at or before the playhead; equal times share an instant. */
export function replayIndexAt(timeline: ReplayTimeline, positionMs: number): number {
  const position = Math.max(0, Number.isFinite(positionMs) ? positionMs : 0);
  let low = 0, high = timeline.offsets.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (timeline.offsets[middle]! <= position) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/** Uses a monotonic clock: timer throttling changes refresh frequency, not speed. */
export class ReplayClock {
  private anchor: number;
  private offset = 0;
  private running = false;
  private speed = 1;
  constructor(readonly durationMs: number, private readonly now = () => performance.now()) {
    this.anchor = now();
  }
  get position(): number {
    return Math.min(this.durationMs, this.offset + (this.running ? Math.max(0, this.now() - this.anchor) * this.speed : 0));
  }
  get rate(): number { return this.speed; }
  play(): void { if (!this.running) { this.anchor = this.now(); this.running = true; } }
  pause(): void { this.offset = this.position; this.anchor = this.now(); this.running = false; }
  seek(positionMs: number): void {
    this.offset = Math.max(0, Math.min(this.durationMs, Number.isFinite(positionMs) ? positionMs : 0));
    this.anchor = this.now();
  }
  setRate(rate: number): void {
    if (!Number.isFinite(rate) || rate <= 0) throw new Error('Invalid replay rate');
    this.offset = this.position; this.anchor = this.now(); this.speed = rate;
  }
}
