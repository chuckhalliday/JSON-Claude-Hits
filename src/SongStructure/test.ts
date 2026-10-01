import { randomGroove, randomArrangement } from './groove'
import { createDrums, drumArray } from './drums'
import { createChords, chordArray } from './chords';
import { createRandomSong } from './createSong';
import generateSong from './generateSong';
import { bassPitch } from './bassPitch';
import { drawBass } from './bass';
import { tone, midiTone } from './tone';
import { seedRng } from './rng';
import { setTuning, defaultTuning, normalizeTuning, tuningBounds } from './tuning';
import { GenerationTuning, DrumHit } from '../types';

describe('primaryGroove', () => {
  it('should return an array with total duration equal to or less than 8', () => {
    const groove = randomGroove();
    const totalDuration = groove.reduce((sum, value) => sum + value, 0);

    expect(totalDuration).toBeLessThanOrEqual(8);
  });

  it('should only contain values from the randomValues array', () => {
    const groove = randomGroove();
    const randomValues = [0.25, 0.5, 0.75, 1, 1.5, 2];

    const containsInvalidValues = groove.some(value => !randomValues.includes(value));
    expect(containsInvalidValues).toBe(false);
  });

  it('should have measure sums that are multiples of 2', () => {
    const groove = randomGroove();
    let measureSum = 0;

    for (const value of groove) {
      measureSum += value;
      if (measureSum === 2) {
        measureSum = 0;
      } else if (measureSum > 2) {
        fail('Measure sum is not a multiple of 2');
      }
    }
  });
});

describe('createDrums', () => {
  it('handles edge case of empty input', () => {
    const bassGroove: number[][] = [[]];
    const result = createDrums(bassGroove, 0);
    expect(result).toEqual([[]]);
  });
  it('produces an array that sums to equal the input array', () => {
    const bassGroove: number[][] = [[0.5, 0.25, 0.25, 1, 0.5], [0.5, 0.25, 0.25, 1, 0.5]];
    const result = createDrums(bassGroove, 0.3);
  
    const inputSum = bassGroove.reduce((sum, innerArray) => {
      return sum + innerArray.reduce((innerSum, value) => innerSum + value, 0);
    }, 0);
  
    const outputSum = result.reduce((sum, innerArray) => {
      return sum + innerArray.reduce((innerSum, value) => innerSum + value, 0);
    }, 0);
  
    expect(outputSum).toEqual(inputSum);
  });
});

describe('createChords', () => {
  it('handles edge case of empty input', () => {
    const bassGroove: number[] = [];
    const result = createChords(bassGroove);
    expect(result).toEqual([]);
  });
  it('produces an array that sums to equal the input array', () => {
    const bassGroove: number[] = [0.5, 0.25, 0.25, 1.5, 0.5];
    const result = createChords(bassGroove);

    const inputSum = bassGroove.reduce((sum, value) => sum + value, 0);
    const outputSum = result.reduce((sum, value) => sum + value, 0);

    expect(outputSum).toEqual(inputSum);
  });
});

describe('createRandomSong (seeded generation)', () => {
  it('reproduces an identical song for the same seed', () => {
    const a = createRandomSong(12345);
    const b = createRandomSong(12345);
    expect(a.seed).toBe(12345);
    expect(JSON.stringify(b.songStructure)).toEqual(JSON.stringify(a.songStructure));
    expect(b.bpm).toEqual(a.bpm);
    expect(b.key).toEqual(a.key);
  });

  it('produces different songs for different seeds', () => {
    const a = createRandomSong(1);
    const b = createRandomSong(2);
    expect(JSON.stringify(a.songStructure)).not.toEqual(JSON.stringify(b.songStructure));
  });

  it('returns the chosen seed when none is supplied, and that seed reproduces it', () => {
    const a = createRandomSong();
    expect(typeof a.seed).toBe('number');
    const b = createRandomSong(a.seed);
    expect(JSON.stringify(b.songStructure)).toEqual(JSON.stringify(a.songStructure));
  });
});

describe('generation tuning (Advanced panel dials)', () => {
  // Direct drumArray/chordArray tests set the module-level tuning; restore
  // the defaults so state never leaks into other suites.
  afterEach(() => setTuning());

  // Same seed, same recipe — only the tuning differs.
  const makeSong = (tuning?: GenerationTuning) => {
    seedRng(4242);
    const grooves = [randomGroove(), randomGroove(), randomGroove(), randomGroove()];
    return generateSong(grooves, randomArrangement(), 0, undefined, undefined, 120, 240, tuning);
  };

  it('produces the identical song when the dials sit at their defaults', () => {
    const implicit = makeSong();
    const explicit = makeSong({ ...defaultTuning });
    expect(JSON.stringify(explicit.songStructure)).toEqual(JSON.stringify(implicit.songStructure));
  });

  it('changes the song when a dial moves, for the same seed', () => {
    const stock = makeSong();
    const cranked = makeSong({ ...defaultTuning, kickOdds: 2, snareOdds: 2, crashOdds: 2, chordSubstitutionRate: 2, chordChangeRate: 2, maxPartRepeats: 6 });
    expect(JSON.stringify(cranked.songStructure)).not.toEqual(JSON.stringify(stock.songStructure));
  });

  it('records the tuning actually used in the song recipe', () => {
    expect(makeSong().params.tuning).toEqual(defaultTuning);
    const tuning = { ...defaultTuning, kickOdds: 0.5, snareOdds: 1.2, crashOdds: 0.8, chordSubstitutionRate: 1.5, chordChangeRate: 0.7, maxPartRepeats: 2 };
    expect(makeSong(tuning).params.tuning).toEqual(tuning);
  });

  it('forces strict part alternation when maxPartRepeats is 1', () => {
    const { songStructure } = makeSong({ ...defaultTuning, maxPartRepeats: 1 });
    for (let i = 1; i < songStructure.length; i++) {
      expect(songStructure[i].type).not.toEqual(songStructure[i - 1].type);
    }
  });

  it('silences every optional drum hit at per-drum odds 0', () => {
    setTuning({ ...defaultTuning, kickOdds: 0, snareOdds: 0, crashOdds: 0 });
    const hits = drumArray(Array.from({ length: 9 }, () => [] as DrumHit[]),
      [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], [2, 2], ['c', 'e']);
    const checkedSteps = (drum: DrumHit[]) => drum.filter(hit => hit.checked).length;
    // Only the unconditional downbeat kick accent survives.
    expect(checkedSteps(hits[0])).toBe(1);
    expect(hits[0][0]).toEqual({ index: 0, checked: true, accent: true });
    expect(checkedSteps(hits[1])).toBe(0); // snare
    expect(checkedSteps(hits[8])).toBe(0); // crash
  });

  it('lands every strong-beat kick and backbeat snare at per-drum odds 2', () => {
    setTuning({ ...defaultTuning, kickOdds: 2, snareOdds: 2 });
    const hits = drumArray(Array.from({ length: 9 }, () => [] as DrumHit[]),
      [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5], [2, 2], ['c', 'e']);
    // Kicks fall on the integer beats (even steps), snares on the backbeats
    // (odd steps): those rolls saturate to certainty at x2.
    [0, 2, 4, 6].forEach(step => expect(hits[0][step].checked).toBe(true));
    [1, 3, 5, 7].forEach(step => expect(hits[1][step].checked).toBe(true));
  });

  it('keeps every chord a plain diatonic triad at substitution rate 0', () => {
    setTuning({ ...defaultTuning, chordSubstitutionRate: 0 });
    const chords = chordArray([2, 2, 2, 2], [2, 2, 2, 2], ['c', 'd', 'f', 'a']);
    expect(chords).toBe('1246');
  });

  it('pins chord-change timing at the chord-change rate extremes', () => {
    const groove = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    // Rate 0: never commit early, every chord holds the full two beats.
    setTuning({ ...defaultTuning, chordChangeRate: 0 });
    expect(createChords(groove)).toEqual([2, 2]);
    // Saturated: commit on every beat the bass allows.
    setTuning({ ...defaultTuning, chordChangeRate: 2 });
    expect(createChords(groove)).toEqual([1, 1, 1, 1]);
  });
});

describe('normalizeTuning (recipe safety)', () => {
  // The corrupt-recipe test below drives generateSong, which installs its
  // tuning into module state; restore the defaults for later suites.
  afterEach(() => setTuning());

  it('returns the stock defaults for missing or empty tunings', () => {
    expect(normalizeTuning()).toEqual(defaultTuning);
    expect(normalizeTuning({})).toEqual(defaultTuning);
  });

  it('fans a retired single drum dial out to the per-drum dials', () => {
    const legacy = normalizeTuning({ drumHitOdds: 0.5, chordSubstitutionRate: 1.5, maxPartRepeats: 2 });
    expect(legacy).toEqual({ ...defaultTuning, kickOdds: 0.5, snareOdds: 0.5, crashOdds: 0.5, chordSubstitutionRate: 1.5, maxPartRepeats: 2 });
    // Explicit per-drum values win over the legacy field.
    expect(normalizeTuning({ drumHitOdds: 0.5, snareOdds: 1.8 }).snareOdds).toBe(1.8);
  });

  it('clamps out-of-range values and replaces non-finite ones with defaults', () => {
    expect(normalizeTuning({ kickOdds: -3 }).kickOdds).toBe(tuningBounds.kickOdds.min);
    expect(normalizeTuning({ snareOdds: Infinity }).snareOdds).toBe(defaultTuning.snareOdds);
    expect(normalizeTuning({ crashOdds: NaN }).crashOdds).toBe(defaultTuning.crashOdds);
    expect(normalizeTuning({ maxPartRepeats: -5 }).maxPartRepeats).toBe(tuningBounds.maxPartRepeats.min);
    expect(normalizeTuning({ maxPartRepeats: 99 }).maxPartRepeats).toBe(tuningBounds.maxPartRepeats.max);
    expect(normalizeTuning({ maxPartRepeats: 2.6 }).maxPartRepeats).toBe(3);
    expect(normalizeTuning({ maxPartRepeats: NaN }).maxPartRepeats).toBe(defaultTuning.maxPartRepeats);
  });

  it('generates a complete, valid song even from a corrupt recipe tuning', () => {
    // maxPartRepeats < 1 would stall generateSongStructure's countdown if it
    // reached the generator unsanitized; NaN rates would poison every roll.
    seedRng(99);
    const grooves = [randomGroove(), randomGroove(), randomGroove(), randomGroove()];
    const corrupt = { kickOdds: NaN, snareOdds: -1, crashOdds: Infinity, chordSubstitutionRate: 5, chordChangeRate: NaN, maxPartRepeats: -2 } as GenerationTuning;
    const { songStructure, params } = generateSong(grooves, randomArrangement(), 0, undefined, undefined, 120, 240, corrupt);
    expect(songStructure.length).toBeGreaterThan(0);
    // The recipe self-heals: what gets recorded is the sanitized tuning.
    expect(params.tuning).toEqual({ ...defaultTuning, kickOdds: defaultTuning.kickOdds, snareOdds: 0, crashOdds: defaultTuning.crashOdds, chordSubstitutionRate: 2, chordChangeRate: defaultTuning.chordChangeRate, maxPartRepeats: 1 });
    // maxPartRepeats clamped to 1 -> strict alternation, and the structure
    // countdown terminated.
    for (let i = 1; i < songStructure.length; i++) {
      expect(songStructure[i].type).not.toEqual(songStructure[i - 1].type);
    }
  });
});

describe('bassPitch (staff position -> pitch)', () => {
  // Every staff Y + accidental the old mapBassValue() switch handled, with the
  // note it must resolve to. Guards the extracted mapping against regressions.
  const cases: [number, string, keyof typeof tone, number][] = [
    [120, 'none', 'E', 1], [120, 'flat', 'Eb', 1],
    [67.5, 'none', 'E', 2], [67.5, 'flat', 'Eb', 2],
    [112.5, 'none', 'F', 1], [112.5, 'sharp', 'Gb', 1],
    [60, 'none', 'F', 2], [60, 'sharp', 'Gb', 2],
    [105, 'none', 'G', 1], [105, 'sharp', 'Ab', 1], [105, 'flat', 'Gb', 1],
    [52.5, 'none', 'G', 2], [52.5, 'sharp', 'Ab', 2], [52.5, 'flat', 'Gb', 2],
    [97.5, 'none', 'A', 1], [97.5, 'sharp', 'Bb', 1], [97.5, 'flat', 'Ab', 1],
    [45, 'none', 'A', 2], [45, 'sharp', 'Bb', 2], [45, 'flat', 'Ab', 2],
    [90, 'none', 'B', 1], [90, 'flat', 'Bb', 1],
    [37.5, 'none', 'B', 2], [37.5, 'flat', 'Bb', 2],
    [82.5, 'none', 'C', 2], [82.5, 'sharp', 'Db', 2],
    [30, 'none', 'C', 3], [30, 'sharp', 'Db', 3],
    [75, 'none', 'D', 2], [75, 'sharp', 'Eb', 2], [75, 'flat', 'Db', 2],
    // 3 ledger lines above the staff
    [22.5, 'none', 'D', 3], [22.5, 'sharp', 'Eb', 3], [22.5, 'flat', 'Db', 3],
    [15, 'none', 'E', 3], [15, 'flat', 'Eb', 3],
    [7.5, 'none', 'F', 3], [7.5, 'sharp', 'Gb', 3],
    [0, 'none', 'G', 3], [0, 'sharp', 'Ab', 3], [0, 'flat', 'Gb', 3],
  ];

  it.each(cases)('y=%p acc=%p resolves to %p[%p]', (y, acc, name, octave) => {
    expect(bassPitch(y as number, acc as string)).toEqual({
      osc: tone[name as keyof typeof tone][octave as number],
      midi: midiTone[name as keyof typeof midiTone][(octave as number) - 1],
    });
  });

  it('treats an off-grid / rest position as a rest (pitch <= 0)', () => {
    expect(bassPitch(-20, 'none').osc).toBeLessThanOrEqual(0);
    expect(bassPitch(-20, 'none').midi).toBeLessThanOrEqual(0);
  });
});
describe('drawBass (note names -> staff + pitch)', () => {
  const PC: { [name: string]: number } = {
    C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6,
    G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
  };

  it('reads each note and its accidental from the same entry', () => {
    // Accidentals next to naturals used to be read from the *next* entry,
    // turning sharps/flats into rests and shifting neighbouring naturals.
    const bass = ['F#', 'A', 'Bb', 'C#', 'D', 'Eb', 'G#', 'Ab', 'Gb', 'Db', 'E', '-'];
    const grid = [-10, ...bass.map((_, i) => 115 + i * 40)];
    const locs = drawBass(bass, grid);
    bass.forEach((name, i) => {
      if (name === '-') {
        expect(locs[i].midi).toBeLessThanOrEqual(0);
      } else {
        expect(locs[i].midi).toBeGreaterThan(0);
        expect(locs[i].midi % 12).toBe(PC[name]);
      }
    });
  });

  it('gives every pitched bass note of seeded songs its intended pitch class', () => {
    for (let seed = 1; seed <= 100; seed++) {
      const { songStructure } = createRandomSong(seed);
      for (const part of songStructure) {
        part.bass.forEach((name, i) => {
          const loc = part.bassNoteLocations[i];
          if (!loc || !(name in PC)) return;
          expect(loc.midi % 12).toBe(PC[name]);
        });
      }
    }
  });
});
