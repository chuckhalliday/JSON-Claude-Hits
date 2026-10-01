// Realize a SongDoc into the legacy Part[] view.
//
// The drum grid, bass staff/tab, piano, and Web Audio playback all read
// Part objects in beats, pixels, and oscillator frequencies. Those are
// derived here, per form instance, from the document's ticks and MIDI notes:
// the document stays the source of truth and the Part tree is a view.

import { SongDoc, SectionDef, SectionInstance } from './doc';
import { Key, chordSymbol, romanNumeral, spellPc, spelledName, staffY, midiToFreq, mod12, BASS_MIN, BASS_MAX, VOICING_MAX, VOICING_MIN } from './theory';
import { stepsToLegacyBeats, ticksToBeats } from './time';
import { instanceDrums } from './drums';
import { streamFor } from './seeds';
import { bassMeasures } from '../SongStructure/bass';
import { chordLocation } from '../SongStructure/chords';
import { bassPitch } from '../SongStructure/bassPitch';
import { Part, NoteLocation, DrumHit } from '../types';

export const transposedKey = (key: Key, semitones: number): Key => ({ tonic: mod12(key.tonic + semitones), mode: key.mode });

function shiftBass(midi: number, t: number): number {
  if (midi <= 0) return 0;
  let n = midi + t;
  while (n > BASS_MAX) n -= 12;
  while (n < BASS_MIN) n += 12;
  return n;
}

function shiftVoicing(notes: number[], t: number): number[] {
  let shifted = notes.map(n => n + t);
  while (shifted.length && Math.max(...shifted) > VOICING_MAX) shifted = shifted.map(n => n - 12);
  while (shifted.length && Math.min(...shifted) < VOICING_MIN) shifted = shifted.map(n => n + 12);
  return shifted;
}

// Whether an instance opens with a crash / closes with a fill, from its
// neighbours in the form.
export function transitions(form: SectionInstance[], i: number) {
  const inst = form[i];
  const prev = form[i - 1];
  const next = form[i + 1];
  return {
    crashIn: i > 0 && inst.energy >= 0.4 && (prev.sectionId !== inst.sectionId || inst.energy > prev.energy),
    fillOut: next !== undefined && (next.sectionId !== inst.sectionId || next.energy > inst.energy + 0.05),
  };
}

// The drum pattern an instance plays: section pattern, transitions, overrides.
export function instancePattern(doc: SongDoc, i: number) {
  const inst = doc.form[i];
  const s = doc.sections[inst.sectionId];
  const rng = streamFor(doc.seed, 'instance', i, s.id, s.rolls.drums, s.rolls.rhythm);
  const grid = instanceDrums(s.drums, { steps: s.drumSteps, sectionEnergy: s.energy, energy: inst.energy, ...transitions(doc.form, i) }, rng);
  for (const o of inst.drumOverrides) {
    if (grid[o.voice]?.[o.step]) grid[o.voice][o.step] = { checked: o.checked, accent: grid[o.voice][o.step].accent };
  }
  return grid;
}

export function realizeInstance(doc: SongDoc, i: number, repeat: number): Part {
  const inst = doc.form[i];
  const s: SectionDef = doc.sections[inst.sectionId];
  const key = transposedKey(doc.key, inst.transpose);

  const bassGroove = s.bassRhythm.map(ticksToBeats);
  const drumGroove = stepsToLegacyBeats(s.drumSteps);
  const chordsGroove = s.harmony.map(c => ticksToBeats(c.dur));
  const [bassGrid, measureLines] = bassMeasures(bassGroove, drumGroove);

  const bassMidi = s.bass.map(m => shiftBass(m, inst.transpose));
  const bass: string[] = [];
  const bassNoteLocations: NoteLocation[] = bassMidi.map((midi, k) => {
    const x = bassGrid[k + 1];
    if (midi <= 0) {
      bass.push('-');
      return { x, y: -20, acc: 'none', ...bassPitch(-20, 'none') };
    }
    const spelled = spellPc(midi, key);
    bass.push(spelledName(spelled));
    const acc = spelled.acc > 0 ? 'sharp' : spelled.acc < 0 ? 'flat' : 'none';
    const y = staffY(midi, spelled);
    return { x, y, acc, ...bassPitch(y, acc) };
  });

  const drums: DrumHit[][] = instancePattern(doc, i).map(row => row.map((cell, step) => ({ index: step, checked: cell.checked, accent: cell.accent })));

  const voicings = s.voicing.map(v => shiftVoicing(v, inst.transpose));
  const chords = s.harmony.map(c => chordSymbol(c, key));

  return {
    type: s.label,
    repeat,
    bass,
    bassGroove,
    bassGrid,
    bassNoteLocations,
    measureLines,
    drums,
    drumGroove,
    stepIds: [],
    chords,
    // Chord oscillators sound an octave below their MIDI notes, the register
    // convention of the legacy chord tables and the piano keyboard.
    chordTones: { midiTones: voicings, oscTones: voicings.map(v => v.map(m => midiToFreq(m - 12))) },
    chordsGroove,
    chordsLocation: chordLocation(bassNoteLocations, bassGroove, chordsGroove),
    sectionId: s.id,
    roman: s.harmony.map(c => romanNumeral(c, doc.key.mode)),
    guideTones: s.guideTones.map(m => m + inst.transpose),
    energy: inst.energy,
    transpose: inst.transpose,
  };
}

export function assignStepIds(parts: Part[]): Part[] {
  let next = 0;
  return parts.map(p => {
    const stepIds = p.drumGroove.map(() => next++);
    return { ...p, stepIds };
  });
}

export function realizeSong(doc: SongDoc): Part[] {
  const counts: Record<string, number> = {};
  const parts = doc.form.map((inst, i) => {
    const label = doc.sections[inst.sectionId].label;
    counts[label] = (counts[label] ?? 0) + 1;
    return realizeInstance(doc, i, counts[label]);
  });
  return assignStepIds(parts);
}

// Re-realize just the instances of one section (after an edit or re-roll),
// keeping every other part object untouched.
export function realizeSection(doc: SongDoc, parts: Part[], id: string): Part[] {
  const updated = parts.map((p, i) => (doc.form[i]?.sectionId === id ? realizeInstance(doc, i, p.repeat) : p));
  return assignStepIds(updated);
}
