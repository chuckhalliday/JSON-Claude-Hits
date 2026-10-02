import { generateDoc } from './generate';
import { realizeSong } from './realize';
import { keyName } from './theory';
import { GM_DRUMS } from './exportMidi';
import { createRandomSong } from '../SongStructure/createSong';
import { genrePresets } from '../SongStructure/tuning';
import { Part } from '../types';
import { GenerateOptions } from './doc';
import { LIVE10_SUITE_DEVICES, STYLES, PaletteInput, StyleId, SoundPick, allTimbres, liveNoteName, paletteText, presetLibraryText, presetName, samePick, saveStep, songFeatures, suggestPalette } from './timbre';

const inputFor = (options: GenerateOptions): PaletteInput => {
  const doc = generateDoc(options);
  return { songStructure: realizeSong(doc), bpm: doc.bpm, key: keyName(doc.key), doc };
};

const styleCount = (style: StyleId, options: (seed: number) => GenerateOptions, seeds = 10) =>
  Array.from({ length: seeds }, (_, i) => suggestPalette(inputFor(options(i + 1))).style.id).filter(id => id === style).length;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value as object).forEach(deepFreeze);
  }
  return value;
}

const withParts = (input: PaletteInput, change: (p: Part) => Part): PaletteInput =>
  ({ ...input, songStructure: input.songStructure.map(change) });

describe('sound palette table', () => {
  it('recommends Live 10 Suite instruments with a reason and a starting patch, never loops or clips', () => {
    for (const style of STYLES) {
      expect(style.guide.length).toBeGreaterThan(0);
      for (const tb of [...style.drums, ...style.bass, ...style.chords, ...style.guide]) {
        expect(LIVE10_SUITE_DEVICES).toContain(tb.device);
        expect(tb.basis.length).toBeGreaterThan(0);
        expect(tb.setup.length).toBeGreaterThan(0);
        expect([tb.basis, ...tb.setup].join(' ')).not.toMatch(/\b(loops?|clips?)\b/i);
        expect(tb.brightness).toBeGreaterThanOrEqual(0);
        expect(tb.brightness).toBeLessThanOrEqual(1);
        expect(tb.weight).toBeGreaterThanOrEqual(0);
        expect(tb.weight).toBeLessThanOrEqual(1);
      }
      expect(style.drums.every(d => d.device === 'Drum Rack')).toBe(true);
    }
  });

  it('gives every sound its own name, so saved preset names never collide', () => {
    const all = Object.values(allTimbres()).flat();
    expect(new Set(all.map(tb => tb.name)).size).toBe(all.length);
    expect(new Set(all.map(presetName)).size).toBe(all.length);
  });

  it('names notes the way Live\'s piano roll does (middle C = C3)', () => {
    expect(liveNoteName(60)).toBe('C3');
    expect(liveNoteName(55)).toBe('G2');
    expect(liveNoteName(28)).toBe('E0');
  });
});

describe('suggestPalette', () => {
  it('is deterministic and never touches the song', () => {
    const input = inputFor({ seed: 3 });
    const before = JSON.stringify(input.songStructure);
    deepFreeze(input.songStructure);
    const a = suggestPalette(input);
    const b = suggestPalette(input);
    expect(a).toEqual(b);
    expect(JSON.stringify(input.songStructure)).toBe(before);
  });

  it('follows the song: form, dials and tempo steer the style', () => {
    expect(styleCount('blues', seed => ({ seed, formId: 'blues' }))).toBe(10);
    expect(styleCount('club', seed => ({ seed, formId: 'build-drop' }))).toBe(10);
    expect(styleCount('soul', seed => ({ seed, formId: 'aaba', tuning: genrePresets.Jazz }))).toBeGreaterThanOrEqual(8);
    expect(styleCount('band', seed => ({ seed, formId: 'pop', tuning: genrePresets.Rock }))).toBe(10);
    expect(styleCount('downtempo', seed => ({ seed, bpm: 70 }))).toBeGreaterThanOrEqual(6);
  });

  it('reads the Advanced panel genre only when the dials match a preset exactly', () => {
    expect(songFeatures(inputFor({ seed: 2, tuning: genrePresets.Jazz })).genre).toBe('Jazz');
    expect(songFeatures(inputFor({ seed: 2 })).genre).toBeNull();
    expect(songFeatures(inputFor({ seed: 2, tuning: { ...genrePresets.Jazz, kickOdds: 0.75 } })).genre).toBeNull();
  });

  it('suggests an EQ split when bass and chords crowd each other, and none when they are apart', () => {
    const input = inputFor({ seed: 4 });
    const shift = (n: number) => (p: Part): Part => ({ ...p, chordTones: { ...p.chordTones, midiTones: p.chordTones.midiTones.map(c => c.map(m => m + n)) } });
    const low = suggestPalette(withParts(input, shift(-12)));
    expect(low.interplay.some(n => /cross around .*EQ Eight/.test(n))).toBe(true);
    const high = suggestPalette(withParts(input, shift(12)));
    expect(high.interplay.some(n => /no low cut needed/.test(n))).toBe(true);
  });

  it('suggests sidechaining when kick and bass lock, and not when they alternate', () => {
    const input = inputFor({ seed: 6 });
    expect(songFeatures(input).kickBassLock).toBeGreaterThan(0.5);
    expect(suggestPalette(input).interplay.some(n => /sidechained from Drums/.test(n))).toBe(true);
    const silentBass = withParts(input, p => ({ ...p, bassNoteLocations: p.bassNoteLocations.map(l => ({ ...l, midi: 0 })) }));
    const apart = suggestPalette(silentBass);
    expect(apart.interplay.some(n => /mostly alternate/.test(n))).toBe(true);
    expect(apart.interplay.some(n => /sidechained/.test(n))).toBe(false);
  });

  it('steps through alternative combinations and wraps around', () => {
    const input = inputFor({ seed: 9 });
    const best = suggestPalette(input);
    const next = suggestPalette(input, 1);
    expect(best.variant).toBe(0);
    expect(next.variant).toBe(1);
    const names = (p: typeof best) => [p.drums, p.bass, p.chords].map(x => x.timbre.name).join('/');
    expect(names(next)).not.toBe(names(best));
    expect(suggestPalette(input, best.variants)).toEqual(best);
    expect(suggestPalette(input, -1).variant).toBe(best.variants - 1);
  });

  it('finds a saved combination by name after edits re-rank the list', () => {
    const input = inputFor({ seed: 1 });
    const lower = (p: Part): Part => ({ ...p, chordTones: { ...p.chordTones, midiTones: p.chordTones.midiTones.map(c => c.map(m => m - 12)) } });
    const edited = withParts(input, lower);
    let reranked = 0;
    for (let v = 0; v < suggestPalette(input).variants; v++) {
      const chosen = suggestPalette(input, v);
      expect(suggestPalette(input, chosen.pick)).toEqual(chosen);
      const after = suggestPalette(edited, chosen.pick);
      expect(after.pick).toEqual(chosen.pick);
      if (after.variant !== v) reranked++;
    }
    expect(reranked).toBeGreaterThan(0);
    expect(samePick(suggestPalette(input, 2).pick, suggestPalette(input, 2).pick)).toBe(true);
    expect(samePick(suggestPalette(input, 1).pick, suggestPalette(input, 2).pick)).toBe(false);
  });

  it('falls back to the best match when a saved combination no longer fits', () => {
    const input = inputFor({ seed: 1 });
    const best = suggestPalette(input);
    const offered = new Set(Array.from({ length: best.variants }, (_, v) => suggestPalette(input, v).style.id));
    const other = STYLES.find(st => !offered.has(st.id))!;
    const stale: SoundPick = { style: other.id, drums: other.drums[0].name, bass: other.bass[0].name, chords: other.chords[0].name };
    expect(suggestPalette(input, stale)).toEqual(best);
    expect(suggestPalette(input, null)).toEqual(best);
  });

  it('suggests a guide-tone sound that stands apart from the chords', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const palette = suggestPalette(inputFor({ seed }));
      const guide = palette.guide!;
      expect(guide.role).toBe('guide');
      const chords = palette.chords.timbre;
      expect(guide.timbre.attack !== chords.attack || Math.abs(guide.timbre.brightness - chords.brightness) >= 0.2).toBe(true);
      expect(STYLES.find(st => st.id === palette.style.id)!.guide).toContain(guide.timbre);
    }
    const { songStructure, bpm, key } = createRandomSong(7);
    expect(suggestPalette({ songStructure, bpm, key }).guide).toBeNull();
  });

  it('places the guide line against the chord voicings', () => {
    const input = inputFor({ seed: 2 });
    const raise = (n: number) => (p: Part): Part => ({ ...p, guideTones: p.guideTones?.map(m => m + n) });
    expect(suggestPalette(input).interplay.some(n => /guide line .* inside the chord voicings/.test(n))).toBe(true);
    expect(suggestPalette(withParts(input, raise(24))).interplay.some(n => /guide line .* clear of the chord voicings/.test(n))).toBe(true);
  });

  it('picks the chord sound section by section, with a filter position from the energy', () => {
    const input = inputFor({ seed: 2, formId: 'build-drop' });
    const palette = suggestPalette(input);
    const labels = [...new Set(input.songStructure.map(p => p.type))];
    expect(palette.sections.map(sec => sec.label)).toEqual(labels);
    const pool = STYLES.find(st => st.id === palette.style.id)!.chords;
    palette.sections.forEach(sec => expect(pool).toContain(sec.chords));
    // Every other chord sound a section uses is listed once, with where it plays.
    const used = [...new Set(palette.sections.map(sec => sec.chords).filter(c => c !== palette.chords.timbre))];
    expect(palette.extraChords.map(x => x.timbre)).toEqual(used);
    expect(used.length).toBeGreaterThan(0);
    expect(palette.interplay.some(n => /Chain Selector/.test(n) && n.includes(used[0].name))).toBe(true);
    palette.sections.filter(sec => sec.chords !== palette.chords.timbre)
      .forEach(sec => expect(sec.moves[0]).toContain(sec.chords.name));
    const byEnergy = [...palette.sections].sort((a, b) => a.energy! - b.energy!);
    expect(byEnergy[0].moves).toContain('Chord filter mostly closed, so the chords sit darker and further back');
    expect(byEnergy[byEnergy.length - 1].moves).toContain('Chord filter fully open');
  });

  it('keeps the main chord sound throughout when no section clearly wants another', () => {
    const palette = suggestPalette(inputFor({ seed: 6, formId: 'pop', tuning: genrePresets.Rock }));
    expect(palette.extraChords).toEqual([]);
    expect(palette.sections.every(sec => sec.chords === palette.chords.timbre)).toBe(true);
    expect(palette.interplay.some(n => /Chain Selector/.test(n))).toBe(false);
  });

  it('works for classic songs and empty songs', () => {
    const { songStructure, bpm, key } = createRandomSong(7);
    const palette = suggestPalette({ songStructure, bpm, key });
    expect(palette.drums.timbre.device).toBe('Drum Rack');
    palette.sections.forEach(sec => {
      expect(sec.energy).toBeNull();
      expect(sec.moves.some(m => /filter/.test(m))).toBe(false);
    });
    const f = songFeatures({ songStructure, bpm, key });
    Object.values(f).forEach(v => { if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true); });
    expect(() => suggestPalette({ songStructure: [], bpm: 120, key: '' })).not.toThrow();
  });

  it('writes a sound sheet naming all three sounds', () => {
    const palette = suggestPalette(inputFor({ seed: 5 }));
    const text = paletteText(palette, 'Song in E Minor');
    for (const pick of [palette.drums, palette.bass, palette.chords]) expect(text).toContain(pick.timbre.name);
    expect(text).toContain('HOW THEY FIT TOGETHER');
    expect(text).toContain(palette.drums.timbre.basis);
    palette.chords.timbre.setup.forEach(step => expect(text).toContain(step));
    expect(text).toContain(palette.drumMap);
    expect(text).toContain(`GUIDE TONES: ${palette.guide!.timbre.name}`);
    for (const pick of [palette.drums, palette.bass, palette.chords, palette.guide!]) expect(text).toContain(saveStep(pick.timbre));
  });

  it('lists the section-by-section sounds and extra chord sounds on the sheet', () => {
    const palette = suggestPalette(inputFor({ seed: 2, formId: 'build-drop' }));
    const text = paletteText(palette, 'Song');
    expect(text).toContain('SECTION BY SECTION');
    palette.extraChords.forEach(x => {
      expect(text).toContain(`CHORDS, SOME SECTIONS: ${x.timbre.name}`);
      expect(text).toContain(saveStep(x.timbre));
    });
    palette.sections.forEach(sec => sec.moves.forEach(m => expect(text).toContain(m)));
  });
});

describe('saved presets', () => {
  it('names each built sound for the User Library', () => {
    const all = allTimbres();
    expect(saveStep(all.drums[0])).toBe(`Save the Drum Rack to your User Library (the save button in its title bar) as "${presetName(all.drums[0])}"`);
    const bass = all.bass[0];
    expect(saveStep(bass)).toContain(`group them into an Instrument Rack`);
    expect(saveStep(bass)).toContain(`"JCH ${bass.name}"`);
  });

  it('writes a build list covering every sound in the table once', () => {
    const text = presetLibraryText();
    const all = allTimbres();
    for (const timbres of Object.values(all)) {
      expect(timbres.length).toBeGreaterThan(0);
      expect(text).toContain(`(${timbres.length})`);
      for (const tb of timbres) {
        expect(text.split(`[ ] ${presetName(tb)} (`).length - 1).toBe(1);
        tb.setup.forEach(step => expect(text).toContain(step));
        expect(text).toContain(saveStep(tb));
      }
    }
    const tableSize = new Set(STYLES.flatMap(st => [...st.drums, ...st.bass, ...st.chords, ...st.guide])).size;
    expect(Object.values(all).flat().length).toBe(tableSize);
  });
});

describe('drum pads', () => {
  it('lists every drum voice the .mid plays, all on a Drum Rack\'s default 16 pads (C1-D#2)', () => {
    const { drumMap } = suggestPalette(inputFor({ seed: 1 }));
    expect(GM_DRUMS.every(n => n >= 36 && n <= 51)).toBe(true);
    expect(drumMap).toBe('kick C1, snare D1, closed hat F#1, low tom A1, open hat A#1, mid tom B1, crash C#2, high tom D2, ride D#2');
  });
});
