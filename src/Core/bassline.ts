// Bass layer: a line realized from the harmony, not the other way round.
//
// Chord onsets take the chord's bass note (its root, or the third/fifth for
// an inversion). Other strong beats favour root and fifth; off-beats move
// through chord tones or repeat the root; the last note before a chord change
// often approaches the next bass note by step or half step. Pitches stay in
// a 4-string bass range (E1-G3) and move to the nearest octave.

import { ChordEvent, Key, chordBassPc, chordTones, mod12, BASS_MIN, BASS_MAX, MODE_STEPS } from './theory';
import { Rng, weighted } from './seeds';
import { PPQ, EIGHTH, SIXTEENTH } from './time';

const HOME = 40; // E2: the centre the line drifts back toward

function nearest(pc: number, tonicMidi: number, around: number, lo = BASS_MIN, hi = BASS_MAX - 3): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let m = lo; m <= hi; m++) {
    if (mod12(m - tonicMidi) !== mod12(pc)) continue;
    const distance = Math.abs(m - around) + Math.abs(m - HOME) * 0.15;
    if (distance < bestDistance) {
      best = m;
      bestDistance = distance;
    }
  }
  return best;
}

export const chordAt = (harmony: ChordEvent[], tick: number) =>
  harmony.find(c => tick >= c.start && tick < c.start + c.dur) ?? harmony[harmony.length - 1];

export function generateBass(rhythm: number[], harmony: ChordEvent[], key: Key, energy: number, rng: Rng): number[] {
  const tonicMidi = 24 + key.tonic; // any C-octave reference works for pitch-class math
  const scale = MODE_STEPS[key.mode];
  const notes: number[] = [];
  const onsets: number[] = [];
  rhythm.reduce((pos, d) => (onsets.push(pos), pos + d), 0);

  let prev = HOME;
  for (let i = 0; i < rhythm.length; i++) {
    const t = onsets[i];
    const d = rhythm[i];
    const chord = chordAt(harmony, t);
    const tones = chordTones(chord);
    const nextOnset = onsets[i + 1];
    const nextChord = nextOnset !== undefined ? chordAt(harmony, nextOnset) : null;
    const changeNext = nextChord !== null && nextChord !== chord;

    // Short off-beat notes are often left as rests (space in the groove).
    if (d === SIXTEENTH && t !== chord.start && rng() < 0.55 - 0.35 * energy) {
      notes.push(0);
      continue;
    }

    let pc: number;
    if (t === chord.start) {
      pc = chordBassPc(chord);
    } else if (changeNext && d <= PPQ && rng() < 0.55) {
      // Approach the next chord's bass note.
      const target = nearest(chordBassPc(nextChord!), tonicMidi, prev);
      const chromatic = rng() < 0.25 + 0.3 * energy;
      if (chromatic) {
        const below = target - 1;
        const note = Math.abs(below - prev) <= Math.abs(target + 1 - prev) ? below : target + 1;
        notes.push(clamp(note));
        prev = notes[notes.length - 1];
        continue;
      }
      const targetPc = mod12(target - tonicMidi);
      const degree = scale.findIndex(s => s === targetPc);
      const stepPc = degree === -1 ? targetPc + 2 : scale[(degree + (prev > target ? 1 : 6)) % 7];
      pc = stepPc;
    } else {
      const onBeat = t % PPQ === 0;
      const options: Array<readonly [number, number]> = onBeat
        ? [[tones[0], 4], [tones[2], 2.5], [tones[1], 1], ...(tones[3] !== undefined ? [[tones[3], 0.5] as const] : [])]
        : [[tones[0], 2 + 3 * energy], [tones[2], 1.5], [tones[1], 1]];
      pc = weighted(rng, options);
    }

    let note = nearest(pc, tonicMidi, prev);
    // Driving off-beat roots jump the octave now and then.
    if (t % EIGHTH === 0 && t % PPQ !== 0 && pc === tones[0] && energy > 0.6 && rng() < 0.25) {
      const up = note + 12;
      if (up <= BASS_MAX) note = up;
    }
    notes.push(clamp(note));
    prev = notes[notes.length - 1];
  }
  return notes;
}

function clamp(note: number): number {
  let n = note;
  while (n > BASS_MAX) n -= 12;
  while (n < BASS_MIN) n += 12;
  return n;
}

// Keep a locked bass line when the rhythm under it changes: each new note
// takes the pitch that was sounding at its onset.
export function remapBass(oldRhythm: number[], oldBass: number[], newRhythm: number[]): number[] {
  const oldOnsets: number[] = [];
  oldRhythm.reduce((pos, d) => (oldOnsets.push(pos), pos + d), 0);
  let pos = 0;
  return newRhythm.map(d => {
    let index = 0;
    for (let i = 0; i < oldOnsets.length; i++) if (oldOnsets[i] <= pos) index = i;
    pos += d;
    return oldBass[index] ?? 0;
  });
}
