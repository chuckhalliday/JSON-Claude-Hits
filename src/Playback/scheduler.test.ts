import { runPreScheduledSequence, resolveStart, SequenceTiming } from './scheduler';

const fakeContext = { currentTime: 0 };
jest.mock('./audioContext', () => ({
  getAudioContext: () => fakeContext,
  ensureAudioRunning: async () => fakeContext,
}));

describe('runPreScheduledSequence timing', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fakeContext.currentTime = 10;
  });
  afterEach(() => jest.useRealTimers());

  // Advance both the audio clock and timers until the promise settles.
  async function run<T>(promise: Promise<T>, step = 0.05): Promise<{ value: T; resolvedAt: number }> {
    let value: T | undefined;
    let settled = false;
    promise.then(v => { value = v; settled = true; });
    while (!settled) {
      fakeContext.currentTime += step;
      jest.advanceTimersByTime(50);
      await Promise.resolve();
      await Promise.resolve();
    }
    return { value: value as T, resolvedAt: fakeContext.currentTime };
  }

  it('starts at a requested future time and reports its end', async () => {
    const times: number[] = [];
    const timing: SequenceTiming = { startAt: 12 };
    const { value } = await run(runPreScheduledSequence(0, 4, () => 0.5, (_i, t) => times.push(t), undefined, timing));
    expect(times).toEqual([12, 12.5, 13, 13.5]);
    expect(timing.endTime).toBe(14);
    expect(value).toBe(4);
  });

  it('falls back to a short lead when the requested start has passed', async () => {
    const leads: number[] = [];
    await run(runPreScheduledSequence(0, 1, () => 1, (_i, t) => leads.push(t - fakeContext.currentTime), undefined, { startAt: 5 }));
    expect(leads[0]).toBeCloseTo(0.1);
  });

  it('resolves `lookahead` seconds before the last note ends', async () => {
    const timing: SequenceTiming = { startAt: 11, lookahead: 0.5 };
    const { resolvedAt } = await run(runPreScheduledSequence(0, 2, () => 1, () => {}, undefined, timing));
    expect(timing.endTime).toBe(13);
    expect(resolvedAt).toBeGreaterThanOrEqual(12.5);
    expect(resolvedAt).toBeLessThan(13);
  });

  it('chains back to back with no gap', async () => {
    const first: SequenceTiming = { startAt: 11, lookahead: 0.5 };
    const starts: number[] = [];
    await run(runPreScheduledSequence(0, 4, () => 0.25, (_i, t) => starts.push(t), undefined, first));
    const second: SequenceTiming = { startAt: first.endTime, lookahead: 0.5 };
    await run(runPreScheduledSequence(0, 2, () => 0.25, (_i, t) => starts.push(t), undefined, second));
    expect(starts).toEqual([11, 11.25, 11.5, 11.75, 12, 12.25]);
  });

  it('resolveStart keeps a future start and replaces a stale one', () => {
    expect(resolveStart({ currentTime: 1 } as BaseAudioContext, 3)).toBe(3);
    expect(resolveStart({ currentTime: 1 } as BaseAudioContext, 0.5)).toBeCloseTo(1.1);
    expect(resolveStart({ currentTime: 1 } as BaseAudioContext)).toBeCloseTo(1.1);
  });
});
