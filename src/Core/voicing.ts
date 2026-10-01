// Voicing layer: chord voicings chosen by voice leading, plus a guide-tone
// line (3rds and 7ths) as a scaffold for writing a melody.
//
// Every candidate voicing of each chord (close-position inversions, drop-2
// for four-note chords, shells for sevenths) is scored by how far its voices
// move from the previous chord's voices, with a pull back toward the
// section's register so progressions don't drift. Common tones hold; the
// rest move by the smallest steps.

import { ChordEvent, Key, chordTones, hasSeventh, mod12, VOICING_MIN, VOICING_MAX } from './theory';
import { Rng } from './seeds';

export type VoicingStyle = 'close' | 'drop2' | 'shell';

function closeVoicings(pcs: number[], tonicMidi: number): number[][] {
  const out: number[][] = [];
  for (let rot = 0; rot < pcs.length; rot++) {
    const order = [...pcs.slice(rot), ...pcs.slice(0, rot)];
    for (let base = VOICING_MIN; base <= VOICING_MIN + 18; base++) {
      if (mod12(base - tonicMidi) !== order[0]) continue;
      const notes = [base];
      for (let i = 1; i < order.length; i++) {
        let n = notes[i - 1] + 1;
        while (mod12(n - tonicMidi) !== order[i]) n++;
        notes.push(n);
      }
      if (notes[notes.length - 1] <= VOICING_MAX) out.push(notes);
    }
  }
  return out;
}

function candidates(chord: ChordEvent, tonicMidi: number, style: VoicingStyle, size: number): number[][] {
  const tones = chordTones(chord);
  let pcs = tones;
  if (style === 'shell' && hasSeventh(chord.quality)) {
    pcs = [tones[0], tones[1], tones[3]];
  } else if (tones.length === 3 && size === 4) {
    pcs = [...tones, tones[0]];
  }
  const unique = [...new Set(pcs)];
  let voicings = closeVoicings(unique, tonicMidi);
  if (pcs.length > unique.length) {
    // Doubled root on top of each close voicing.
    voicings = voicings.map(v => {
      let top = v[v.length - 1] + 1;
      while (mod12(top - tonicMidi) !== tones[0]) top++;
      return top <= VOICING_MAX ? [...v, top] : v;
    });
  }
  if (style === 'drop2') {
    const dropped = voicings
      .filter(v => v.length === 4)
      .map(v => [v[2] - 12, v[0], v[1], v[3]].sort((a, b) => a - b))
      .filter(v => v[0] >= VOICING_MIN);
    voicings = voicings.concat(dropped);
  }
  return voicings;
}

// Total movement between two voicings, pairing voices from the bottom up and
// charging any extra voice for its distance to the nearest note.
function motion(a: number[], b: number[]): number {
  let total = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) total += Math.abs(a[i] - b[i]);
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  for (let i = n; i < longer.length; i++) total += Math.min(...shorter.map(s => Math.abs(s - longer[i])));
  return total;
}

const centre = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;

export function pickStyle(energy: number, rng: Rng): VoicingStyle {
  const roll = rng();
  if (energy < 0.35) return roll < 0.6 ? 'close' : 'shell';
  if (energy < 0.7) return roll < 0.5 ? 'close' : roll < 0.8 ? 'drop2' : 'shell';
  return roll < 0.6 ? 'drop2' : 'close';
}

export function generateVoicings(harmony: ChordEvent[], key: Key, energy: number, rng: Rng): number[][] {
  const tonicMidi = 60 + key.tonic;
  const style = pickStyle(energy, rng);
  const size = energy > 0.55 ? 4 : 3;
  const target = 62 + Math.round(energy * 6);
  const out: number[][] = [];
  let prev: number[] | null = null;
  for (const chord of harmony) {
    const options = candidates(chord, tonicMidi, style, size);
    let best = options[0];
    let bestCost = Infinity;
    for (const v of options) {
      const cost = (prev ? motion(prev, v) : 0) + Math.abs(centre(v) - target) * (prev ? 0.35 : 1) + rng() * 0.01;
      if (cost < bestCost) {
        best = v;
        bestCost = cost;
      }
    }
    out.push(best);
    prev = best;
  }
  return out;
}

// One guide tone per chord: its 3rd or 7th (the root for chords with
// neither), choosing whichever moves least from the last one.
export function guideTones(harmony: ChordEvent[], key: Key): number[] {
  const tonicMidi = 60 + key.tonic;
  const out: number[] = [];
  let prev = 67;
  for (const chord of harmony) {
    const tones = chordTones(chord);
    const guides = chord.quality === 'sus4' ? [tones[1]] : hasSeventh(chord.quality) ? [tones[1], tones[3]] : [tones[1]];
    let best = prev;
    let bestDistance = Infinity;
    for (let m = 60; m <= 76; m++) {
      if (!guides.includes(mod12(m - tonicMidi))) continue;
      const d = Math.abs(m - prev) + Math.abs(m - 67) * 0.1;
      if (d < bestDistance) {
        best = m;
        bestDistance = d;
      }
    }
    out.push(best);
    prev = best;
  }
  return out;
}

// Keep locked voicings when the harmony's rhythm changes: each new chord
// takes the voicing that was sounding at its start.
export function remapVoicings(oldHarmony: ChordEvent[], oldVoicings: number[][], newHarmony: ChordEvent[]): number[][] {
  return newHarmony.map(c => {
    const index = oldHarmony.findIndex(o => c.start >= o.start && c.start < o.start + o.dur);
    return [...(oldVoicings[index === -1 ? oldVoicings.length - 1 : index] ?? [])];
  });
}
