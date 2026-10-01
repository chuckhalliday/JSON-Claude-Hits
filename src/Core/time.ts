// Integer musical time for the song document.
//
// The legacy generators measured time in floating-point beats and leaned on
// `toFixed(2)` rounding and tolerance windows (3.93-4.07) to compare
// positions, with triplets stored as 0.16/0.17 approximations. The core keeps
// every position and duration as whole ticks instead: 960 ticks per quarter
// note divides evenly by both 3 and 4, so straight and triplet subdivisions
// are exact, comparisons are plain `===`, and Standard MIDI Files use the
// same representation.

export const PPQ = 960;
export const SIXTEENTH = PPQ / 4;
export const EIGHTH = PPQ / 2;
export const HALF = PPQ * 2;

// Meter is 4/4 throughout the core for now; kept as a value (not literals
// sprinkled through the generators) so other meters have one place to land.
export const BEATS_PER_BAR = 4;
export const BAR = PPQ * BEATS_PER_BAR;

export const beatsToTicks = (beats: number) => Math.round(beats * PPQ);
export const ticksToBeats = (ticks: number) => ticks / PPQ;

// Legacy views (drum grid, staff, playback) still take beat durations, and
// expect triplet steps in the rounded form the old subdivider produced:
// a 1/6-beat triplet as [0.16, 0.17, 0.17], a 1/12-beat one as
// [0.09, 0.08, 0.08]. Each group still sums to the exact straight value.
export function stepsToLegacyBeats(steps: number[]): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < steps.length) {
    const s = steps[i];
    if ((s === PPQ / 6 || s === PPQ / 12) && steps[i + 1] === s && steps[i + 2] === s) {
      out.push(...(s === PPQ / 6 ? [0.16, 0.17, 0.17] : [0.09, 0.08, 0.08]));
      i += 3;
    } else {
      out.push(ticksToBeats(s));
      i += 1;
    }
  }
  return out;
}

// The inverse for exporting legacy beat arrays: accumulate positions and snap
// each boundary to the nearest 1/12 beat, the finest grid any generator uses,
// so rounded triplets land back on exact ticks without drift.
export function beatsToTickPositions(durations: number[], startTick = 0): number[] {
  const grid = PPQ / 12;
  const positions: number[] = [];
  let beats = 0;
  for (const d of durations) {
    positions.push(startTick + Math.round((beats * PPQ) / grid) * grid);
    beats += d;
  }
  positions.push(startTick + Math.round((beats * PPQ) / grid) * grid);
  return positions;
}
