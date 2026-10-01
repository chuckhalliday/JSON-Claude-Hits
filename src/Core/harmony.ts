// Harmony layer: the progression every other layer is realized against.
//
// Sections are built from 4-bar phrases. Each phrase opens on a function the
// section label suggests (verses on the tonic, bridges away from it), wanders
// through tonic -> predominant -> dominant tendencies, and closes on a
// cadence: earlier phrases on a half cadence, the last on the section's own
// target (authentic for a chorus, half into a chorus, deceptive bridges...).
// Substitutions are explicit, labelled chords - applied dominants, borrowed
// iv / bVI / bVII, tritone subs - scaled by the Advanced panel's dials.

import { ChordEvent, HarmonicFunction, Key, Mode, Quality, diatonicSeventh, diatonicTriad, MODE_STEPS, mod12, chordTones } from './theory';
import { Cadence, SectionLabel } from './doc';
import { Rng, weighted } from './seeds';
import { BAR } from './time';
import { chordChangeOdds, chordVoicingOdds, subOdds } from '../SongStructure/tuning';

export interface HarmonyRequest {
  label: SectionLabel;
  bars: number;
  energy: number;
  cadence: Cadence;
  key: Key;
  style: 'functional' | 'blues';
}

// Scale-degree indexes (0-based) grouped by function.
const FUNCTION_DEGREES: Record<HarmonicFunction, Array<readonly [number, number]>> = {
  T: [[0, 0.55], [5, 0.35], [2, 0.1]],
  PD: [[3, 0.6], [1, 0.4]],
  D: [[4, 0.85], [6, 0.15]],
};

const NEXT_FUNCTION: Record<HarmonicFunction, Array<readonly [HarmonicFunction, number]>> = {
  T: [['T', 0.2], ['PD', 0.55], ['D', 0.25]],
  PD: [['PD', 0.2], ['D', 0.6], ['T', 0.2]],
  D: [['T', 0.75], ['PD', 0.1], ['D', 0.15]],
};

interface Slot {
  root: number;
  fn: HarmonicFunction;
  quality?: Quality;
}

const degreeRoot = (mode: Mode, degree: number) => MODE_STEPS[mode][degree];

// Dominant function as heard in this mode: minor borrows the leading-tone V
// (harmonic minor); dorian/mixolydian/phrygian keep their modal v or bVII.
function dominantSlot(mode: Mode, rng: Rng): Slot {
  if (mode === 'major' || mode === 'lydian') return { root: 7, fn: 'D', quality: 'maj' };
  if (mode === 'minor') return rng() < 0.85 ? { root: 7, fn: 'D', quality: 'maj' } : { root: 10, fn: 'D', quality: 'maj' };
  if (mode === 'phrygian') return { root: 1, fn: 'D', quality: 'maj' };
  return rng() < 0.5 ? { root: 10, fn: 'D', quality: 'maj' } : { root: 7, fn: 'D', quality: diatonicTriad(7, mode) ?? 'min' };
}

function slotFor(fn: HarmonicFunction, mode: Mode, rng: Rng): Slot {
  let degree = weighted(rng, FUNCTION_DEGREES[fn]);
  // A diminished supertonic (minor, phrygian) is a weak predominant to sit
  // on; prefer iv most of the time.
  if (fn === 'PD' && degree === 1 && diatonicTriad(degreeRoot(mode, 1), mode) === 'dim' && rng() < 0.7) degree = 3;
  if (fn === 'D' && degree === 4) return dominantSlot(mode, rng);
  return { root: degreeRoot(mode, degree), fn };
}

function openingSlot(label: SectionLabel, mode: Mode, rng: Rng): Slot {
  switch (label) {
    case 'Pre-Chorus':
      return rng() < 0.7 ? slotFor('PD', mode, rng) : { root: degreeRoot(mode, 5), fn: 'T' };
    case 'Bridge':
      if (mode === 'major' && rng() < subOdds(0.2)) return { root: 8, fn: 'PD', quality: 'maj' }; // borrowed bVI
      return rng() < 0.5 ? { root: degreeRoot(mode, 3), fn: 'PD' } : { root: degreeRoot(mode, 5), fn: 'T' };
    case 'Chorus':
    case 'Drop':
      return rng() < 0.3 ? { root: degreeRoot(mode, 3), fn: 'PD' } : { root: 0, fn: 'T' };
    case 'Breakdown':
      return rng() < 0.5 ? { root: degreeRoot(mode, 5), fn: 'T' } : { root: 0, fn: 'T' };
    default:
      return { root: 0, fn: 'T' };
  }
}

function cadenceTail(cadence: Cadence, mode: Mode, rng: Rng): Slot[] {
  switch (cadence) {
    case 'authentic':
      return [dominantSlot(mode, rng), { root: 0, fn: 'T' }];
    case 'half':
      return [slotFor('PD', mode, rng), dominantSlot(mode, rng)];
    case 'plagal':
      return [{ root: degreeRoot(mode, 3), fn: 'PD' }, { root: 0, fn: 'T' }];
    case 'deceptive':
      return [dominantSlot(mode, rng), { root: degreeRoot(mode, 5), fn: 'T' }];
    case 'loop':
      return [slotFor(rng() < 0.5 ? 'PD' : 'D', mode, rng)];
  }
}

// Chord onsets for one phrase: one chord per bar, or two (on beats 1 and 3)
// with the Chord Changes dial's odds. The cadence bar always splits when the
// cadence needs two chords in a one-bar phrase tail.
function phraseRhythm(bars: number, energy: number, rng: Rng, tailLength: number): number[][] {
  const perBar: number[][] = [];
  for (let b = 0; b < bars; b++) {
    const two = rng() < chordChangeOdds(0.15 + 0.3 * energy);
    perBar.push(two ? [0, BAR / 2] : [0]);
  }
  const total = perBar.reduce((n, bar) => n + bar.length, 0);
  if (total < tailLength + 1) perBar[bars - 1] = [0, BAR / 2];
  return perBar;
}

function buildPhrase(req: HarmonyRequest, bars: number, cadence: Cadence, opening: Slot | null, rng: Rng): Array<Slot & { start: number; dur: number }> {
  const mode = req.key.mode;
  const tail = cadenceTail(cadence, mode, rng);
  const rhythm = phraseRhythm(bars, req.energy, rng, tail.length);
  const onsets: number[] = [];
  rhythm.forEach((bar, b) => bar.forEach(offset => onsets.push(b * BAR + offset)));
  const n = onsets.length;

  const slots: Slot[] = new Array(n);
  for (let i = 0; i < tail.length; i++) slots[n - tail.length + i] = tail[i];
  slots[0] = slots[0] ?? opening ?? { root: 0, fn: 'T' };
  for (let i = 1; i < n - tail.length; i++) {
    let next: Slot = slots[i - 1];
    for (let attempt = 0; attempt < 6 && next.root === slots[i - 1].root; attempt++) {
      next = slotFor(weighted(rng, NEXT_FUNCTION[slots[i - 1].fn]), mode, rng);
    }
    // Don't arrive at the cadence on the chord the cadence starts with.
    if (i === n - tail.length - 1 && next.root === tail[0].root) {
      next = slotFor(tail[0].fn === 'D' ? 'PD' : 'T', mode, rng);
      if (next.root === tail[0].root) next = { root: 0, fn: 'T' };
    }
    slots[i] = next;
  }

  return slots.map((slot, i) => ({ ...slot, start: onsets[i], dur: (onsets[i + 1] ?? bars * BAR) - onsets[i] }));
}

function bluesChanges(bars: number, mode: Mode, rng: Rng): Array<Slot & { start: number; dur: number }> {
  const I: Slot = { root: 0, fn: 'T', quality: mode === 'minor' || mode === 'dorian' ? 'm7' : '7' };
  const IV: Slot = { root: 5, fn: 'PD', quality: mode === 'minor' || mode === 'dorian' ? 'm7' : '7' };
  const V: Slot = { root: 7, fn: 'D', quality: '7' };
  let pattern: Slot[];
  if (bars === 12) {
    const quickChange = rng() < 0.4;
    pattern = [I, quickChange ? IV : I, I, I, IV, IV, I, I, V, IV, I, V];
  } else {
    pattern = Array.from({ length: bars }, (_, i) => (i === bars - 1 ? V : i === bars - 2 ? IV : I));
  }
  return pattern.map((slot, i) => ({ ...slot, start: i * BAR, dur: BAR }));
}

export function generateHarmony(req: HarmonyRequest, rng: Rng): ChordEvent[] {
  const mode = req.key.mode;
  if (req.style === 'blues') {
    return bluesChanges(req.bars, mode, rng).map(s => finalize(s, mode));
  }

  const phraseBars = req.bars >= 8 ? 4 : req.bars;
  const phrases = Math.max(1, Math.round(req.bars / phraseBars));
  const opening = openingSlot(req.label, mode, rng);
  const events: Array<Slot & { start: number; dur: number }> = [];
  let first: Array<Slot & { start: number; dur: number }> | null = null;
  for (let p = 0; p < phrases; p++) {
    const last = p === phrases - 1;
    const cadence: Cadence = last ? req.cadence : req.cadence === 'loop' ? 'loop' : 'half';
    let phrase = buildPhrase(req, phraseBars, cadence, p === 0 ? opening : null, rng);
    // Phrase repetition makes sections cohere: a later phrase often restates
    // the first one and only rewrites its cadence.
    if (first && rng() < (req.cadence === 'loop' ? 0.9 : 0.5)) {
      const tailLength = cadenceTail(cadence, mode, () => 0).length;
      const tailStart = phrase[phrase.length - tailLength].start;
      const kept = first.filter(s => s.start < tailStart).map(s => ({ ...s, dur: Math.min(s.dur, tailStart - s.start) }));
      if (kept.length > 0) phrase = [...kept, ...phrase.slice(phrase.length - tailLength)];
    }
    if (p === 0) first = phrase;
    events.push(...phrase.map(s => ({ ...s, start: s.start + p * phraseBars * BAR })));
  }

  const cadenceCount = cadenceTail(req.cadence, mode, () => 0).length;
  const chords = events.map(s => finalize(s, mode));
  return applySubstitutions(chords, mode, rng, cadenceCount);
}

function finalize(slot: Slot & { start: number; dur: number }, mode: Mode): ChordEvent {
  const quality = slot.quality ?? diatonicTriad(slot.root, mode) ?? 'maj';
  return { start: slot.start, dur: slot.dur, root: mod12(slot.root), quality, inversion: 0, fn: slot.fn };
}

// Colour the plain progression: sevenths, applied dominants, borrowed chords,
// tritone subs, and passing inversions. Cadence chords keep their roots so
// the section still lands where its cadence says.
function applySubstitutions(chords: ChordEvent[], mode: Mode, rng: Rng, cadenceCount: number): ChordEvent[] {
  const out = chords.map(c => ({ ...c }));
  const cadenceStart = out.length - cadenceCount;
  const major = mode === 'major' || mode === 'lydian' || mode === 'mixolydian';

  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    const next = out[i + 1];
    const inCadence = i >= cadenceStart;

    // Applied dominant (V7/x) leading into ii, iii, IV, V or vi.
    if (!inCadence && i > 0 && next && next.root !== 0 && diatonicTriad(next.root, mode) && diatonicTriad(next.root, mode) !== 'dim'
      && rng() < subOdds(0.12)) {
      out[i] = { ...c, root: mod12(next.root + 7), quality: '7', fn: 'D', appliedTo: next.root };
      continue;
    }
    // Borrowed iv in a major key.
    if (major && c.root === 5 && c.quality === 'maj' && !inCadence && rng() < subOdds(0.1)) {
      out[i] = { ...c, quality: 'min' };
    }
    // Borrowed bVII standing in for a mid-phrase V.
    if (major && c.root === 7 && !inCadence && rng() < subOdds(0.06)) {
      out[i] = { ...c, root: 10, quality: 'maj' };
    }
  }

  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    const next = out[i + 1];
    // Sevenths: dominants into a resolution take them often, the rest at
    // the Chord Voicings dial's rate.
    if (c.appliedTo === undefined && c.quality !== '7') {
      const resolvingDominant = c.fn === 'D' && c.root === 7 && c.quality === 'maj' && next && next.fn === 'T';
      if (resolvingDominant && rng() < chordVoicingOdds(0.6)) {
        out[i] = { ...c, quality: '7' };
      } else if (rng() < chordVoicingOdds(0.22)) {
        const seventh = diatonicSeventh(c.root, mode);
        if (seventh && diatonicTriad(c.root, mode) === c.quality) out[i] = { ...c, quality: seventh };
      }
    }
    // Tritone substitution of a V7 resolving to I.
    if (out[i].quality === '7' && out[i].root === 7 && next && next.root === 0 && rng() < subOdds(0.04)) {
      out[i] = { ...out[i], root: 1, appliedTo: undefined };
    }
  }

  // Passing inversions: a middle chord whose third sits a step from both
  // neighbouring bass notes takes first inversion (I6 between IV and V...).
  for (let i = 1; i < out.length - 1; i++) {
    const prev = out[i - 1].root;
    const next = out[i + 1].root;
    const third = chordTones(out[i])[1];
    const step = (a: number, b: number) => {
      const d = Math.abs(mod12(a - b));
      return Math.min(d, 12 - d) <= 2 && Math.min(d, 12 - d) > 0;
    };
    if (i < cadenceStart && step(third, prev) && step(third, next) && rng() < 0.5) {
      out[i] = { ...out[i], inversion: 1 };
    }
  }
  return out;
}

