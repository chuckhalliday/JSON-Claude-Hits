import { generateDoc } from './generate';
import { realizeSong } from './realize';
import { editChord } from './edits';
import { romanOptions, inversionOptions, rootChoices, qualityChoices } from './chordOptions';
import { QUALITY_LIST, chordBassPc, chordSymbol, romanNumeral, chordTones, mod12, spelledName, spellInChord, Key } from './theory';
import { bassPitch } from '../SongStructure/bassPitch';

const C: Key = { tonic: 0, mode: 'major' };
const chord = (root: number, quality: any, extra: any = {}) => ({ start: 0, dur: 3840, root, quality, inversion: 0, fn: 'T' as const, ...extra });

describe('chord vocabulary', () => {
  it('names and spells every quality', () => {
    expect(QUALITY_LIST.map(q => chordSymbol(chord(2, q), C))).toEqual([
      'D', 'Dm', 'D°', 'D+', 'Dsus2', 'Dsus4', 'D6', 'Dm6', 'D7', 'Dmaj7', 'Dm7', 'Dm7b5', 'D°7', 'D7sus4', 'Dadd9', 'D9', 'Dmaj9', 'Dm9',
    ]);
    // Bb6's sixth is G; D9's ninth is E; Dsus2's second is E.
    expect(spelledName(spellInChord(7, chord(10, '6'), C))).toBe('G');
    expect(spelledName(spellInChord(4, chord(2, '9'), C))).toBe('E');
    expect(chordSymbol(chord(10, 'm6', { inversion: 3 }), C)).toBe('Bbm6/G');
    expect(romanNumeral(chord(0, '6'), 'major')).toBe('Iadd6');
    expect(romanNumeral(chord(7, '7', { inversion: 3 }), 'major')).toBe('V4/2');
  });
});

describe('chord menus', () => {
  it('offers functional alternatives for a Roman numeral', () => {
    const groups = romanOptions(chord(5, 'maj', { fn: 'PD' }), C);
    const titles = groups.map(g => g.title);
    expect(titles[0]).toBe('Same function (predominant)');
    const romans = (title: string) => groups.find(g => g.title.startsWith(title))!.options.map(o => o.roman);
    expect(romans('Same function')).toEqual(expect.arrayContaining(['ii', 'IV', 'ii7', 'IVmaj7']));
    expect(romans('Diatonic triads')).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']);
    expect(romans('Applied')).toEqual(['V7/ii', 'V7/iii', 'V7/IV', 'V7/V', 'V7/vi']);
    expect(romans('Borrowed')).toEqual(expect.arrayContaining(['i', 'iv', 'bIII', 'bVI', 'bVII', 'bII', 'bII7']));
    expect(groups[1].options.find(o => o.roman === 'IV')!.current).toBe(true);
  });

  it('offers each inversion with its bass note', () => {
    expect(inversionOptions(chord(7, '7'), C).map(o => `${o.symbol}:${o.roman}`)).toEqual(['G7:V7', 'G7/B:V6/5', 'G7/D:V4/3', 'G7/F:V4/2']);
    expect(inversionOptions(chord(0, 'maj'), C).map(o => o.bass)).toEqual(['C', 'E', 'G']);
  });

  it('lists every root spelled for the key and every quality', () => {
    expect(rootChoices({ tonic: 5, mode: 'major' }).map(r => r.name)).toEqual(['F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B', 'C', 'Db', 'D', 'Eb', 'E']);
    expect(qualityChoices.length).toBe(QUALITY_LIST.length);
  });
});

describe('editChord', () => {
  const doc = generateDoc({ seed: 31, formId: 'verse-chorus', tonic: 0, mode: 'major' });
  const verses = doc.form.map((f, i) => (f.sectionId === 'verse' ? i : -1)).filter(i => i >= 0);
  const onsets = (rhythm: number[]) => { const o: number[] = []; rhythm.reduce((p, d) => (o.push(p), p + d), 0); return o; };

  it('swaps a chord out of the key, re-voices it, and puts its bass under it', () => {
    const edited = editChord(doc, verses[0], 1, { root: 3, quality: 'maj7' }); // Ebmaj7 in C
    const s = edited.sections.verse;
    const c = s.harmony[1];
    expect(c).toMatchObject({ root: 3, quality: 'maj7' });
    expect(c.appliedTo).toBeUndefined();
    expect(s.locks.harmony).toBe(true);
    const pcs = new Set(s.voicing[1].map(m => mod12(m)));
    chordTones(c).forEach(t => expect(pcs.has(t)).toBe(true));
    const k = onsets(s.bassRhythm).indexOf(c.start);
    expect(mod12(s.bass[k] - 24)).toBe(chordBassPc(c));
    // Every verse plays it, labelled and spelled.
    const parts = realizeSong(edited);
    verses.forEach(i => {
      expect(parts[i].chords[1]).toBe('Ebmaj7');
      expect(parts[i].roman![1]).toBe('bIIImaj7');
    });
    // Other chords untouched.
    s.harmony.forEach((h, i) => i !== 1 && expect(h).toEqual(doc.sections.verse.harmony[i]));
  });

  it('changes an inversion and moves the downbeat bass note', () => {
    const edited = editChord(doc, verses[0], 0, { inversion: 1 });
    const s = edited.sections.verse;
    expect(s.harmony[0].inversion).toBe(1);
    expect(mod12(s.bass[0] - 24)).toBe(chordBassPc(s.harmony[0]));
    const loc = realizeSong(edited)[verses[0]].bassNoteLocations[0];
    expect(bassPitch(loc.y, loc.acc).midi).toBe(s.bass[0]);
  });

  it('keeps a locked bass line except the chord downbeat', () => {
    const locked = { ...doc, sections: { ...doc.sections, verse: { ...doc.sections.verse, locks: { ...doc.sections.verse.locks, bass: true } } } };
    const edited = editChord(locked, verses[0], 2, { root: 8, quality: 'maj' });
    const s = edited.sections.verse;
    const on = onsets(s.bassRhythm);
    const down = on.indexOf(s.harmony[2].start);
    s.bass.forEach((m, k) => k !== down && expect(m).toBe(doc.sections.verse.bass[k]));
  });

  it('applies an applied dominant from the Roman menu', () => {
    const v7ofV = romanOptions(doc.sections.verse.harmony[1], C).find(g => g.title === 'Applied dominants')!.options.find(o => o.roman === 'V7/V')!;
    const edited = editChord(doc, verses[0], 1, v7ofV.choice);
    expect(realizeSong(edited)[verses[0]].roman![1]).toBe('V7/V');
    expect(edited.sections.verse.harmony[1]).toMatchObject({ root: 2, quality: '7', appliedTo: 7 });
  });
});
