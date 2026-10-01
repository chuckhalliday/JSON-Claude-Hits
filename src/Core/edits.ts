// Hand edits from the editors, written back into the song document.
//
// An edit lands on the section definition, so it shows up in every instance
// of that section, and it locks that layer so a later re-roll elsewhere in
// the section can't wipe it. A drum edit on a cell an instance's own
// transition changed (a fill, a crash) stays local to that instance.

import { Layer, SongDoc } from './doc';
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
