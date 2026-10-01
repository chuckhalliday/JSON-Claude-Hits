// Hand edits from the editors, written back into the song document.
//
// An edit lands on the section definition, so it shows up in every instance
// of that section, and it locks that layer so a later re-roll elsewhere in
// the section can't wipe it. A drum edit on a cell an instance's own
// transition changed (a fill, a crash) stays local to that instance.

import { Layer, SongDoc } from './doc';
import { ChordEvent, BASS_MAX, BASS_MIN, chordBassPc, inversionCount, mod12 } from './theory';
import { guideTones, revoiceChord } from './voicing';
import { generateBass } from './bassline';
import { functionOf } from './chordOptions';
import { streamFor } from './seeds';
import { instancePattern } from './realize';
import { bassPitch } from '../SongStructure/bassPitch';
import { NoteLocation } from '../types';

function withSection(doc: SongDoc, id: string, update: (s: SongDoc['sections'][string]) => void, lock: Layer): SongDoc {
  const s = JSON.parse(JSON.stringify(doc.sections[id]));
  update(s);
  s.locks[lock] = true;
  return { ...doc, sections: { ...doc.sections, [id]: s } };
}

export function editDrum(doc: SongDoc, index: number, voice: number, step: number, checked: boolean): SongDoc {
  const inst = doc.form[index];
  if (!inst) return doc;
  const s = doc.sections[inst.sectionId];
  const sectionCell = s.drums[voice]?.[step];
  if (!sectionCell) return doc;
  const playedWithoutOverride = instancePattern({ ...doc, form: doc.form.map((f, i) => (i === index ? { ...f, drumOverrides: f.drumOverrides.filter(o => o.voice !== voice || o.step !== step) } : f)) }, index)[voice][step];
  if (playedWithoutOverride.checked !== sectionCell.checked) {
    const drumOverrides = [...inst.drumOverrides.filter(o => o.voice !== voice || o.step !== step), { voice, step, checked }];
    return { ...doc, form: doc.form.map((f, i) => (i === index ? { ...f, drumOverrides } : f)) };
  }
  return withSection(doc, inst.sectionId, sec => {
    sec.drums[voice][step] = { checked, accent: sectionCell.accent };
  }, 'drums');
}

export function editBass(doc: SongDoc, index: number, locations: NoteLocation[]): SongDoc {
  const inst = doc.form[index];
  if (!inst) return doc;
  return withSection(doc, inst.sectionId, sec => {
    sec.bass = sec.bass.map((old: number, k: number) => {
      const loc = locations[k];
      if (!loc) return old;
      const midi = bassPitch(loc.y, loc.acc).midi;
      return midi > 0 ? midi - inst.transpose : 0;
    });
    // Tab strings picked by hand travel with the notes.
    const strings = sec.bass.map((_: number, k: number) => locations[k]?.string ?? sec.bassStrings?.[k] ?? null);
    if (strings.some((st: number | null) => st !== null)) sec.bassStrings = strings;
  }, 'bass');
}

export function editChordTone(doc: SongDoc, index: number, chord: number, midi: number, checked: boolean): SongDoc {
  const inst = doc.form[index];
  if (!inst) return doc;
  return withSection(doc, inst.sectionId, sec => {
    const notes: number[] = sec.voicing[chord] ?? [];
    const note = midi - inst.transpose;
    sec.voicing[chord] = checked
      ? [...new Set([...notes, note])].sort((a, b) => a - b)
      : notes.filter(n => n !== note && n !== midi);
  }, 'voicing');
}

// Change one chord of the progression (any root and quality, an applied or
// borrowed chord, or just its inversion). That chord is re-voiced, smoothly
// against its neighbours; the bass note on its downbeat moves to the new
// chord's bass; the rest of the bass under it is rewritten to fit unless
// the bass is locked. Like other edits it applies to every instance of the
// section and locks the harmony.
export function editChord(doc: SongDoc, index: number, chordIndex: number, change: Partial<Pick<ChordEvent, 'root' | 'quality' | 'inversion' | 'appliedTo' | 'fn'>>): SongDoc {
  const inst = doc.form[index];
  if (!inst) return doc;
  return withSection(doc, inst.sectionId, sec => {
    const old: ChordEvent = sec.harmony[chordIndex];
    if (!old) return;
    const respelled = change.root !== undefined || change.quality !== undefined;
    const next: ChordEvent = { ...old, ...change };
    if (respelled && !('appliedTo' in change)) delete next.appliedTo;
    if (respelled && change.fn === undefined) next.fn = functionOf(next, doc.key.mode);
    next.root = mod12(next.root);
    // A new chord starts in root position (as the menus show it) unless an
    // inversion is chosen with it.
    if (respelled && change.inversion === undefined) next.inversion = 0;
    next.inversion = Math.min(next.inversion, inversionCount(next.quality) - 1);
    sec.harmony[chordIndex] = next;
    sec.guideTones = guideTones(sec.harmony, doc.key);
    sec.voicing[chordIndex] = revoiceChord(sec.harmony, sec.voicing, chordIndex, doc.key, sec.energy);

    // Bass notes sounding under this chord.
    const onsets: number[] = [];
    sec.bassRhythm.reduce((pos: number, d: number) => (onsets.push(pos), pos + d), 0);
    const under = onsets.map((t, k) => (t >= next.start && t < next.start + next.dur ? k : -1)).filter((k: number) => k >= 0);
    if (!sec.locks.bass) {
      const fresh = generateBass(sec.bassRhythm, sec.harmony, doc.key, sec.energy, streamFor(doc.seed, sec.id, 'bass', sec.rolls.bass));
      under.forEach((k: number) => {
        sec.bass[k] = fresh[k];
        if (sec.bassStrings) sec.bassStrings[k] = null;
      });
    }
    // The downbeat always takes the chord's bass note (its inversion), in
    // the octave nearest the note it replaces.
    const downbeat = onsets.indexOf(next.start);
    if (downbeat !== -1) {
      const pc = chordBassPc(next);
      const around = sec.bass[downbeat] > 0 ? sec.bass[downbeat] : 40;
      let best = 0;
      for (let m = BASS_MIN; m <= BASS_MAX; m++) {
        if (mod12(m - 24 - doc.key.tonic) === pc && (best === 0 || Math.abs(m - around) < Math.abs(best - around))) best = m;
      }
      if (best) {
        sec.bass[downbeat] = best;
        if (sec.bassStrings) sec.bassStrings[downbeat] = null;
      }
    }
  }, 'harmony');
}
