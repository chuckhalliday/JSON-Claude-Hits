// Rhythm layer: the bass rhythm and the drum step grid that subdivides it.
//
// Bass rhythms are built in 2-bar motifs whose half-bar groups each sum to
// exactly two beats, so every chord change (always on a bar or half-bar)
// lands on a bass onset. A section states a motif, repeats it, and answers it
// (A A B A), the way real parts are built, instead of 4 unrelated grooves.

import { Rng, pick, weighted } from './seeds';
import { PPQ, SIXTEENTH, EIGHTH, HALF, BAR, beatsToTicks } from './time';
import { tripletSubdivisionOdds } from '../SongStructure/tuning';
import { SectionLabel } from './doc';

// Durations the staff and grid can draw, in ticks.
const ALLOWED = [SIXTEENTH, EIGHTH, EIGHTH + SIXTEENTH, PPQ, PPQ + EIGHTH, HALF];

function durationWeights(energy: number): Array<readonly [number, number]> {
  if (energy < 0.35) return [[HALF, 4], [PPQ + EIGHTH, 2], [PPQ, 3], [EIGHTH, 1]];
  if (energy < 0.7) return [[PPQ, 3], [EIGHTH, 3], [PPQ + EIGHTH, 2], [HALF, 1], [EIGHTH + SIXTEENTH, 1], [SIXTEENTH, 1]];
  return [[EIGHTH, 5], [SIXTEENTH, 2], [PPQ, 2], [EIGHTH + SIXTEENTH, 1]];
}

// One half-bar (two beats) of bass rhythm.
function halfBarGroup(energy: number, rng: Rng): number[] {
  const group: number[] = [];
  let left = HALF;
  const weights = durationWeights(energy);
  while (left > 0) {
    const fitting = weights.filter(([d]) => d <= left);
    const d = fitting.length > 0 ? weighted(rng, fitting) : SIXTEENTH;
    group.push(d);
    left -= d;
  }
  return group;
}

export function motif(energy: number, rng: Rng): number[] {
  return Array.from({ length: 4 }, () => halfBarGroup(energy, rng)).flat();
}

// Bring a user-edited groove (in beats) into the grid's rules: exactly two
// bars, no note crossing a half-bar line, only durations the staff draws.
export function normalizeMotif(beats: number[]): number[] {
  const out: number[] = [];
  let pos = 0;
  const place = (ticks: number) => {
    let left = ticks;
    while (left > 0 && pos < 2 * BAR) {
      let d = Math.min(left, HALF - (pos % HALF), 2 * BAR - pos);
      while (d > SIXTEENTH && !ALLOWED.includes(d)) d -= SIXTEENTH;
      d = Math.max(d, SIXTEENTH);
      out.push(d);
      pos += d;
      left -= d;
    }
  };
  beats.forEach(b => place(Math.round(beatsToTicks(b) / SIXTEENTH) * SIXTEENTH));
  if (pos < 2 * BAR) place(2 * BAR - pos);
  return out;
}

const MOTIF_ROW: Partial<Record<SectionLabel, number>> = { Verse: 0, Chorus: 1, Bridge: 2 };

export function generateBassRhythm(label: SectionLabel, bars: number, energy: number, rng: Rng, motifs: number[][] | null, arrangement: number[][] | null): number[] {
  const chunks = bars / 2;
  const row = MOTIF_ROW[label];
  if (motifs && motifs.length > 0) {
    const normalized = motifs.map(normalizeMotif);
    return Array.from({ length: chunks }, (_, c) => {
      const index = row !== undefined && arrangement?.[row] ? arrangement[row][c % arrangement[row].length] : Math.floor(rng() * normalized.length);
      return normalized[Math.min(index, normalized.length - 1)];
    }).flat();
  }
  const a = motif(energy, rng);
  const b = motif(Math.min(1, energy + 0.1), rng);
  const plan = pick(rng, [[a, a, b, a], [a, b, a, b], [a, a, a, b]]);
  return Array.from({ length: chunks }, (_, c) => (c === chunks - 1 && chunks > 1 ? (plan[3] === a ? b : a) : plan[c % 4])).flat();
}

// Drum steps: each bass note splits into eighths on the eighth grid
// (sixteenths off it, or everywhere at high energy). Sections with a triplet
// feel swing some steps into exact triplets (Triplet Subdivision dial).
export function generateDrumSteps(bassRhythm: number[], energy: number, tripletFeel: boolean, rng: Rng): number[] {
  const steps: number[] = [];
  let pos = 0;
  for (const note of bassRhythm) {
    let left = note;
    while (left > 0) {
      let step = pos % EIGHTH === 0 && left >= EIGHTH ? EIGHTH : SIXTEENTH;
      if (step === EIGHTH && energy > 0.75 && rng() < (energy - 0.75) * 2) step = SIXTEENTH;
      if (tripletFeel && rng() < tripletSubdivisionOdds(step === EIGHTH ? 0.2 : 0.1)) {
        steps.push(step / 3, step / 3, step / 3);
      } else {
        steps.push(step);
      }
      pos += step;
      left -= step;
    }
  }
  return steps;
}
