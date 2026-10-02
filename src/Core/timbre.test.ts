import { generateDoc } from './generate';
import { realizeSong } from './realize';
import { keyName } from './theory';
import { GM_DRUMS } from './exportMidi';
import { createRandomSong } from '../SongStructure/createSong';
import { genrePresets } from '../SongStructure/tuning';
import { Part } from '../types';
import { GenerateOptions } from './doc';
import { LIVE10_SUITE_DEVICES, STYLES, PaletteInput, StyleId, liveNoteName, paletteText, songFeatures, suggestPalette } from './timbre';

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
      for (const tb of [...style.drums, ...style.bass, ...style.chords]) {
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

  it('works for classic songs and empty songs', () => {
    const { songStructure, bpm, key } = createRandomSong(7);
    const palette = suggestPalette({ songStructure, bpm, key });
    expect(palette.drums.timbre.device).toBe('Drum Rack');
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
  });
});

describe('drum pads', () => {
  it('lists every drum voice the .mid plays, all on a Drum Rack\'s default 16 pads (C1-D#2)', () => {
    const { drumMap } = suggestPalette(inputFor({ seed: 1 }));
    expect(GM_DRUMS.every(n => n >= 36 && n <= 51)).toBe(true);
    expect(drumMap).toBe('kick C1, snare D1, closed hat F#1, low tom A1, open hat A#1, mid tom B1, crash C#2, high tom D2, ride D#2');
  });
});
