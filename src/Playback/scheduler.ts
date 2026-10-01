import { getAudioContext, ensureAudioRunning } from "./audioContext";

// How far in the future the first note is placed, giving all parallel parts
// time to finish synchronous scheduling before any note fires. All parts sample
// currentTime at nearly the same instant, so this leaves them phase-aligned.
const SCHEDULE_LEAD = 0.1;

// How far ahead of the audio clock notes are created, and how often the
// scheduler wakes to create the next ones and poll for a stop. The horizon
// covers main-thread stalls (a section change renders a new part) of up to
// half a second without notes arriving late.
const SCHEDULE_AHEAD = 0.5;
const POLL_INTERVAL_MS = 25;

export type Cleanup = () => void;
export type Register = (cleanup: Cleanup) => void;

// Optional timing for chaining sequences back to back (song playback):
// - startAt: audio-clock time to place the first note at, so every track of
//   a part shares one start and a part can begin exactly where the previous
//   one ended. Ignored if it has already passed.
// - lookahead: resolve this many seconds before the last note ends, giving
//   the caller time to schedule what comes next before the music runs out.
// - endTime: written by the sequence - when its last note ends.
export interface SequenceTiming {
  startAt?: number;
  lookahead?: number;
  endTime?: number;
}

// Picks the start time for a sequence: the requested one if it is still
// ahead of the clock, otherwise a short lead from now.
export function resolveStart(audioContext: BaseAudioContext, startAt?: number): number {
  return startAt !== undefined && startAt >= audioContext.currentTime + 0.01
    ? startAt
    : audioContext.currentTime + SCHEDULE_LEAD;
}

// Schedules a callback to fire at absolute AudioContext time via setTimeout.
// The clearTimeout is registered so it will be cancelled on stop.
export function scheduleTimer(time: number, callback: () => void, register: Register) {
  const audioContext = getAudioContext();
  const delay = Math.max(0, (time - audioContext.currentTime) * 1000);
  const id = window.setTimeout(callback, delay);
  register(() => clearTimeout(id));
}

// Plays a sequence of notes on the audio clock with a rolling lookahead: a
// timer creates each note's audio nodes only SCHEDULE_AHEAD seconds before it
// sounds. (It used to create every note of a whole part up front. A part is
// thousands of nodes, all of which the audio thread then processes on every
// 128-frame render - measured at ~2,100 nodes and 4.6 ms per 2.7 ms render
// budget right after a section change, which overruns the device and makes
// real hardware crackle, drop out and stall.) Notes still start at exact
// audio-clock times; only their creation is spread out. Callbacks registered
// via `register` run when playback is cancelled (stopping created notes and
// clearing pending timers). `isCancelled` lets async callbacks short-circuit
// if a stop arrived while they were in flight.
// Resolves with the final note index (either `length`, or the index reached at
// the moment of stop).
export async function runPreScheduledSequence(
  startIndex: number,
  length: number,
  getDuration: (index: number) => number,
  onSchedule: (index: number, time: number, duration: number, register: Register, isCancelled: () => boolean) => void,
  shouldStop?: () => boolean,
  timing?: SequenceTiming,
): Promise<number> {
  // Sample currentTime only once the context is truly rendering (see
  // ensureAudioRunning) so scheduled times can't start in the past. When the
  // context is already running this awaits nothing, and parallel parts still
  // sample the clock in the same synchronous batch, staying phase-aligned.
  const audioContext = await ensureAudioRunning();

  if (startIndex >= length) {
    if (timing) timing.endTime = resolveStart(audioContext, timing.startAt);
    return startIndex;
  }

  const startTime = resolveStart(audioContext, timing?.startAt);
  const cleanups: Cleanup[] = [];
  let cancelled = false;

  const register: Register = fn => cleanups.push(fn);
  const isCancelled = () => cancelled;

  // Note times are computed up front (cheap - no audio nodes yet).
  const noteStartTimes: number[] = [];
  const durations: number[] = [];
  let cursor = startTime;
  for (let i = startIndex; i < length; i++) {
    // A pattern can carry one more slot than its groove has durations (e.g. bass
    // note locations), yielding an undefined/NaN duration for the trailing slot.
    // Clamp to 0 so it becomes a harmless zero-length note rather than poisoning
    // the cumulative cursor and hanging the completion poll on `now >= NaN`.
    let duration = getDuration(i);
    if (!Number.isFinite(duration) || duration < 0) {
      duration = 0;
    }
    noteStartTimes.push(cursor);
    durations.push(duration);
    cursor += duration;
  }
  const endTime = cursor;
  if (timing) timing.endTime = endTime;
  const resolveAt = endTime - (timing?.lookahead ?? 0);

  // Create every note that starts before the scheduling horizon.
  let next = 0;
  const scheduleDue = () => {
    const horizon = audioContext.currentTime + SCHEDULE_AHEAD;
    while (next < noteStartTimes.length && noteStartTimes[next] < horizon) {
      onSchedule(startIndex + next, noteStartTimes[next], durations[next], register, isCancelled);
      next++;
    }
  };
  scheduleDue();

  return new Promise(resolve => {
    let done = false;

    const runCleanup = () => {
      cancelled = true;
      for (const fn of cleanups) {
        try { fn(); } catch { /* already torn down */ }
      }
      cleanups.length = 0;
    };

    const poll = () => {
      if (done) return;
      const now = audioContext.currentTime;
      // Natural completion wins over stop when both fire in the same tick, so a
      // stop caught after the last note started still resolves as a full-length
      // finish (avoids returning an out-of-range resume index). Every note has
      // been created by then, since the horizon is never shorter than the
      // lookahead.
      if (now >= resolveAt && next >= noteStartTimes.length) {
        done = true;
        resolve(length);
        return;
      }
      if (shouldStop && shouldStop()) {
        done = true;
        runCleanup();
        let progressed = 0;
        while (progressed < noteStartTimes.length && noteStartTimes[progressed] <= now) {
          progressed++;
        }
        resolve(Math.min(startIndex + progressed, length - 1));
        return;
      }
      scheduleDue();
      setTimeout(poll, POLL_INTERVAL_MS);
    };
    poll();
  });
}
