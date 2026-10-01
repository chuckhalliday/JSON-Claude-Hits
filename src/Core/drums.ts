// Drum layer: a section groove, plus per-instance transitions.
//
// The section pattern is a backbeat feel shaped by energy: half-time and
// quarter hats when quiet, eighths in the middle, sixteenths / ride and
// syncopated kicks that lock to the bass when it drives. Instances then add
// their own crash on the downbeat, a fill into whatever comes next, and
// density changes when an instance is pushed above or below the section's
// baseline energy. Each roll is scaled by the Advanced panel's drum dials.

import { DrumCell, KICK, SNARE, LOW_TOM, MID_TOM, HIGH_TOM, HAT_C, HAT_O, RIDE, CRASH, DRUM_VOICES, SectionLabel } from './doc';
import { Rng } from './seeds';
import { PPQ, EIGHTH, BAR } from './time';
import { kickOdds, snareOdds, crashOdds, hiHatOpenOdds } from '../SongStructure/tuning';

const empty = (steps: number) => DRUM_VOICES.map(() => Array.from({ length: steps }, () => ({ checked: false, accent: false })));

const onsetsOf = (durations: number[]) => {
  const out: number[] = [];
  durations.reduce((pos, d) => (out.push(pos), pos + d), 0);
  return out;
};

export function generateDrums(label: SectionLabel, steps: number[], bassRhythm: number[], bass: number[] | null, energy: number, rng: Rng): DrumCell[][] {
  const grid = empty(steps.length);
  const hit = (voice: number, i: number, accent = false) => { grid[voice][i] = { checked: true, accent }; };
  const stepOn = onsetsOf(steps);
  const bassOn = new Set(onsetsOf(bassRhythm).filter((_, i) => !bass || bass[i] > 0));
  const halfTime = energy < 0.3;
  const useRide = energy > 0.7 && (label === 'Chorus' || label === 'Drop' || label === 'Solo') && rng() < 0.45;
  const hatGrid = energy < 0.3 ? PPQ : energy > 0.8 ? 0 : EIGHTH; // 0 = every straight step
  const bars = Math.round(stepOn.length ? (stepOn[stepOn.length - 1] + steps[steps.length - 1]) / BAR : 0);

  stepOn.forEach((t, i) => {
    const inBar = t % BAR;
    const beat = inBar / PPQ;
    const triplet = steps[i] % (PPQ / 4) !== 0;

    // Kick: anchored on 1, usually 3, then following the bass on eighths.
    if (inBar === 0) hit(KICK, i, true);
    else if (beat === 2 && !halfTime) { if (rng() < kickOdds(0.8)) hit(KICK, i); }
    else if (bassOn.has(t) && t % EIGHTH === 0 && beat !== 1 && beat !== 3) { if (rng() < kickOdds(0.25 + 0.35 * energy)) hit(KICK, i); }

    // Snare: backbeat (half-time puts it on 3), occasional ghosts.
    const backbeat = halfTime ? beat === 2 : beat === 1 || beat === 3;
    if (backbeat) { if (rng() < snareOdds(0.97)) hit(SNARE, i); }
    else if (!triplet && t % EIGHTH !== 0 && rng() < snareOdds(0.12 * energy)) hit(SNARE, i);

    // Time-keeping: hats or ride; triplet steps always get a hat.
    const timeVoice = useRide ? RIDE : HAT_C;
    if (triplet) {
      rng() < hiHatOpenOdds(0.25) ? hit(HAT_O, i) : hit(HAT_C, i);
    } else if (hatGrid === 0 || t % hatGrid === 0) {
      const openSpot = !useRide && beat === 3.5 && rng() < hiHatOpenOdds(0.35);
      openSpot ? hit(HAT_O, i) : hit(timeVoice, i, useRide && t % PPQ === 0);
    }

    // A mid-section crash marks the second half of loud sections.
    if (inBar === 0 && bars >= 8 && t === (bars / 2) * BAR && energy > 0.6 && rng() < crashOdds(0.4)) {
      hit(CRASH, i, true);
    }
  });
  return grid;
}

export interface InstanceDrumContext {
  steps: number[];
  sectionEnergy: number;
  energy: number;
  crashIn: boolean;
  fillOut: boolean;
}

// The pattern this instance actually plays.
export function instanceDrums(pattern: DrumCell[][], ctx: InstanceDrumContext, rng: Rng): DrumCell[][] {
  const grid = pattern.map(row => row.map(cell => ({ ...cell })));
  const stepOn = onsetsOf(ctx.steps);
  const end = stepOn.length ? stepOn[stepOn.length - 1] + ctx.steps[ctx.steps.length - 1] : 0;
  const set = (voice: number, i: number, checked: boolean, accent = false) => { grid[voice][i] = { checked, accent }; };
  const lift = ctx.energy - ctx.sectionEnergy;

  stepOn.forEach((t, i) => {
    const beat = (t % BAR) / PPQ;
    if (lift > 0.12 && beat === 3.5 && grid[HAT_C][i].checked && rng() < hiHatOpenOdds(0.7)) {
      set(HAT_C, i, false);
      set(HAT_O, i, true);
    }
    if (lift > 0.12 && beat === 2) set(KICK, i, true);
    if (lift < -0.12 && t % PPQ !== 0) {
      set(HAT_C, i, false);
      set(HAT_O, i, false);
      set(RIDE, i, false);
    }
  });

  if (ctx.crashIn && stepOn.length > 0 && rng() < crashOdds(0.9)) set(CRASH, 0, true, true);

  if (ctx.fillOut && end > 0) {
    const length = ctx.energy < 0.4 ? PPQ : 2 * PPQ;
    const from = end - length;
    const dense = ctx.energy > 0.65;
    const snareRoll = rng() < 0.3;
    const order = snareRoll ? [SNARE, SNARE, SNARE, SNARE] : [SNARE, HIGH_TOM, MID_TOM, LOW_TOM];
    stepOn.forEach((t, i) => {
      if (t < from) return;
      [KICK, SNARE, LOW_TOM, MID_TOM, HIGH_TOM, HAT_C, HAT_O, RIDE].forEach(v => set(v, i, false));
      if (!dense && t % EIGHTH !== 0) return;
      const segment = Math.min(3, Math.floor(((t - from) / length) * 4));
      set(order[segment], i, true, t % PPQ === 0);
      if (t === from) set(KICK, i, true);
    });
  }
  return grid;
}

// Keep a locked drum pattern when the step grid under it changes: hits stay
// at the same tick where a step still starts there.
export function remapDrums(oldSteps: number[], oldPattern: DrumCell[][], newSteps: number[]): DrumCell[][] {
  const oldOn = onsetsOf(oldSteps);
  const newOn = onsetsOf(newSteps);
  return oldPattern.map(row => newOn.map(t => {
    const i = oldOn.indexOf(t);
    return i === -1 ? { checked: false, accent: false } : { ...row[i] };
  }));
}
