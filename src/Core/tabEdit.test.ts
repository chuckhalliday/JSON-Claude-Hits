import { generateDoc, regenerateLayer } from './generate';
import { realizeSong, BASS_OPEN_MIDI } from './realize';
import { editBass } from './edits';
import { Key, spellPc, staffY } from './theory';
import { bassPitch } from '../SongStructure/bassPitch';

// What the tab editor sends: a note moved to string/fret, spelled for the key.
const atFret = (loc: any, stringIndex: number, fret: number, key: Key = { tonic: 0, mode: 'major' }) => {
  const midi = BASS_OPEN_MIDI[stringIndex] + fret;
  const sp = spellPc(midi, key);
  return { ...loc, y: staffY(midi, sp), acc: sp.acc > 0 ? 'sharp' : sp.acc < 0 ? 'flat' : 'none', string: stringIndex };
};

describe('tab edits', () => {
  const doc = generateDoc({ seed: 44, formId: 'verse-chorus', tonic: 0, mode: 'major' });
  const verses = doc.form.map((f, i) => (f.sectionId === 'verse' ? i : -1)).filter(i => i >= 0);
  const parts = realizeSong(doc);
  const k = parts[verses[0]].bassNoteLocations.findIndex(l => l.midi > 0);

  it('maps every fret of every string to a staff position and back', () => {
    for (let s = 0; s < 4; s++) {
      for (let fret = 0; fret <= 20; fret++) {
        for (const key of [{ tonic: 0, mode: 'major' as const }, { tonic: 3, mode: 'minor' as const }, { tonic: 6, mode: 'major' as const }]) {
          const loc = atFret({ x: 0, y: 0, acc: 'none', osc: 0, midi: 0 }, s, fret, key);
          expect(bassPitch(loc.y, loc.acc).midi).toBe(BASS_OPEN_MIDI[s] + fret);
        }
      }
    }
  });

  it('keeps the chosen string and fret in every instance', () => {
    // A2 played at fret 5 on the E string rather than open A.
    const locs = parts[verses[0]].bassNoteLocations.map((l, i) => (i === k ? atFret(l, 0, 5) : l));
    const edited = editBass(doc, verses[0], locs);
    expect(edited.sections.verse.bass[k]).toBe(33);
    expect(edited.sections.verse.bassStrings?.[k]).toBe(0);
    const again = realizeSong(edited);
    verses.forEach(i => {
      expect(again[i].bassNoteLocations[k]).toMatchObject({ midi: 33, string: 0 });
    });
  });

  it('keeps notes above the generators range as entered', () => {
    // Fret 20 on the G string: Eb4.
    const locs = parts[verses[0]].bassNoteLocations.map((l, i) => (i === k ? atFret(l, 3, 20) : l));
    const edited = editBass(doc, verses[0], locs);
    const loc = realizeSong(edited)[verses[0]].bassNoteLocations[k];
    expect(loc.midi).toBe(63);
    expect(loc.y).toBeLessThan(0); // above the staff's former top
    expect(loc.string).toBe(3);
  });

  it('drops hand-picked strings when the bass is regenerated', () => {
    const locs = parts[verses[0]].bassNoteLocations.map((l, i) => (i === k ? atFret(l, 0, 5) : l));
    const edited = editBass(doc, verses[0], locs);
    const unlocked = { ...edited, sections: { ...edited.sections, verse: { ...edited.sections.verse, locks: { ...edited.sections.verse.locks, bass: false } } } };
    const rerolled = regenerateLayer(unlocked, 'verse', 'bass');
    expect(rerolled.sections.verse.bassStrings).toBeUndefined();
  });
});
