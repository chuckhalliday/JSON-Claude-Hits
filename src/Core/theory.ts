// Pitch, key, and chord vocabulary for the core.
//
// Harmony is stored relative to the tonic (a chord root is "semitones above
// the tonic"), so transposition and modulation are arithmetic. Spelling (C#
// vs Db) is resolved only when a name is shown, from the key's parent major
// scale, replacing the three hand-copied sharp/flat tables of the legacy code.

export type Mode = 'major' | 'minor' | 'dorian' | 'phrygian' | 'lydian' | 'mixolydian';

export const MODES: Mode[] = ['major', 'minor', 'dorian', 'phrygian', 'lydian', 'mixolydian'];

export const MODE_NAMES: Record<Mode, string> = {
  major: 'Major', minor: 'Minor', dorian: 'Dorian', phrygian: 'Phrygian', lydian: 'Lydian', mixolydian: 'Mixolydian',
};

export const MODE_STEPS: Record<Mode, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

// Semitones from the parent major's tonic up to this mode's tonic.
const PARENT_OFFSET: Record<Mode, number> = {
  major: 0, dorian: 2, phrygian: 4, lydian: 5, mixolydian: 7, minor: 9,
};
const MODE_DEGREE: Record<Mode, number> = {
  major: 0, dorian: 1, phrygian: 2, lydian: 3, mixolydian: 4, minor: 5,
};

export interface Key {
  tonic: number; // pitch class, 0 = C
  mode: Mode;
}

export const mod12 = (n: number) => ((n % 12) + 12) % 12;

export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];

// Conventional spelling of each major key's tonic (fewest accidentals).
const MAJOR_TONIC_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

// Key signature (positive = sharps) of each major key, by tonic pitch class.
const MAJOR_SIGNATURE = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

export interface Spelled {
  letter: string; // 'A'..'G'
  acc: number; // -1 flat, 0 natural, 1 sharp (double accidentals are never produced)
}

export const spelledName = ({ letter, acc }: Spelled) => letter + (acc > 0 ? '#' : acc < 0 ? 'b' : '');

const accFor = (letterIndex: number, pc: number) => {
  let diff = mod12(pc - LETTER_PC[letterIndex]);
  if (diff > 6) diff -= 12;
  return diff;
};

// The seven spelled degrees of a key, e.g. D dorian -> D E F G A B C.
export function keyScale(key: Key): Spelled[] {
  const parentPc = mod12(key.tonic - PARENT_OFFSET[key.mode]);
  const parentLetter = LETTERS.indexOf(MAJOR_TONIC_NAMES[parentPc][0]);
  const steps = MODE_STEPS.major;
  const parentScale = steps.map((step, d) => {
    const letterIndex = (parentLetter + d) % 7;
    return { letter: LETTERS[letterIndex], acc: accFor(letterIndex, parentPc + step) };
  });
  const rot = MODE_DEGREE[key.mode];
  return [...parentScale.slice(rot), ...parentScale.slice(0, rot)];
}

export const keySignature = (key: Key) => MAJOR_SIGNATURE[mod12(key.tonic - PARENT_OFFSET[key.mode])];

export function keyName(key: Key): string {
  return `${spelledName(keyScale(key)[0])} ${MODE_NAMES[key.mode]}`;
}

// Spell any pitch class in a key: diatonic notes take the scale's letter;
// chromatic ones are raised lower letters in sharp keys and lowered upper
// letters in flat keys. Cb/Fb/E#/B# are respelled as plain naturals.
export function spellPc(pc: number, key: Key): Spelled {
  pc = mod12(pc);
  const scale = keyScale(key);
  for (const s of scale) {
    if (mod12(LETTER_PC[LETTERS.indexOf(s.letter)] + s.acc) === pc) return tidy(s);
  }
  const natural = LETTER_PC.indexOf(pc);
  if (natural !== -1) return { letter: LETTERS[natural], acc: 0 };
  // Minor keys raise their 6th and 7th (melodic/harmonic minor): F# in G
  // minor is the leading tone, not Gb.
  if (key.mode === 'minor') {
    const rel = mod12(pc - key.tonic);
    if (rel === 9 || rel === 11) {
      const degree = scale[rel === 9 ? 5 : 6];
      return tidy({ letter: degree.letter, acc: degree.acc + 1 });
    }
  }
  const preferFlats = keySignature(key) < 0;
  return preferFlats
    ? { letter: LETTERS[LETTER_PC.indexOf(mod12(pc + 1))], acc: -1 }
    : { letter: LETTERS[LETTER_PC.indexOf(mod12(pc - 1))], acc: 1 };
}

// A chord root, `rel` semitones above the tonic. Chromatic roots are read as
// lowered scale degrees - bII, bIII, bVI, bVII - as borrowed chords and
// tritone subs are named: Ab (bVI) in C major, not G#.
export function spellRoot(rel: number, key: Key): Spelled {
  const scale = keyScale(key);
  const steps = MODE_STEPS[key.mode];
  const r = mod12(rel);
  const degree = steps.indexOf(r);
  if (degree !== -1) return tidy(scale[degree]);
  const above = steps.indexOf(mod12(r + 1));
  if (above !== -1 && Math.abs(scale[above].acc - 1) <= 1) {
    return tidy({ letter: scale[above].letter, acc: scale[above].acc - 1 });
  }
  return spellPc(key.tonic + r, key);
}

// Spell a pitch heard against a chord: chord tones by their letter distance
// from the chord's root (each quality says which letter every tone takes:
// D's third is F#, A7's is C#, Bb6's sixth is G), anything else - passing
// and approach notes, or a tone that would need a double accidental, like
// a °7's double-flat seventh - by the key.
export function spellInChord(pc: number, chord: Pick<ChordEvent, 'root' | 'quality'>, key: Key): Spelled {
  const rel = mod12(pc - key.tonic);
  const spec = QUALITIES[chord.quality];
  const k = spec.intervals.findIndex(i => mod12(chord.root + i) === rel);
  if (k === -1) return spellPc(pc, key);
  const root = spellRoot(chord.root, key);
  const letterIndex = (LETTERS.indexOf(root.letter) + spec.letters[k]) % 7;
  const acc = accFor(letterIndex, pc);
  if (Math.abs(acc) > 1) return spellPc(pc, key);
  return tidy({ letter: LETTERS[letterIndex], acc });
}

function tidy(s: Spelled): Spelled {
  const name = spelledName(s);
  const respell: Record<string, Spelled> = {
    Cb: { letter: 'B', acc: 0 }, Fb: { letter: 'E', acc: 0 }, 'E#': { letter: 'F', acc: 0 }, 'B#': { letter: 'C', acc: 0 },
  };
  return respell[name] ?? s;
}

export const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

// ---- Chords -------------------------------------------------------------

export type Quality =
  | 'maj' | 'min' | 'dim' | 'aug' | 'sus2' | 'sus4' | '6' | 'm6'
  | '7' | 'maj7' | 'm7' | 'm7b5' | 'dim7' | '7sus4' | 'add9' | '9' | 'maj9' | 'm9';

interface QualitySpec {
  intervals: number[]; // semitones above the root, root first
  letters: number[]; // letter steps above the root for each tone (spelling)
  symbol: string; // chord-symbol suffix: Cm7, C°, Csus4
  roman: string; // Roman-numeral suffix: ii7, viiø7, Iadd6
  minor: boolean; // lowercase numeral
  name: string; // for menus
}

// Every chord quality the app knows, in menu order.
export const QUALITIES: Record<Quality, QualitySpec> = {
  maj: { intervals: [0, 4, 7], letters: [0, 2, 4], symbol: '', roman: '', minor: false, name: 'major' },
  min: { intervals: [0, 3, 7], letters: [0, 2, 4], symbol: 'm', roman: '', minor: true, name: 'minor' },
  dim: { intervals: [0, 3, 6], letters: [0, 2, 4], symbol: '°', roman: '°', minor: true, name: 'diminished' },
  aug: { intervals: [0, 4, 8], letters: [0, 2, 4], symbol: '+', roman: '+', minor: false, name: 'augmented' },
  sus2: { intervals: [0, 2, 7], letters: [0, 1, 4], symbol: 'sus2', roman: 'sus2', minor: false, name: 'sus2' },
  sus4: { intervals: [0, 5, 7], letters: [0, 3, 4], symbol: 'sus4', roman: 'sus4', minor: false, name: 'sus4' },
  '6': { intervals: [0, 4, 7, 9], letters: [0, 2, 4, 5], symbol: '6', roman: 'add6', minor: false, name: 'major 6' },
  m6: { intervals: [0, 3, 7, 9], letters: [0, 2, 4, 5], symbol: 'm6', roman: 'add6', minor: true, name: 'minor 6' },
  '7': { intervals: [0, 4, 7, 10], letters: [0, 2, 4, 6], symbol: '7', roman: '7', minor: false, name: 'dominant 7' },
  maj7: { intervals: [0, 4, 7, 11], letters: [0, 2, 4, 6], symbol: 'maj7', roman: 'maj7', minor: false, name: 'major 7' },
  m7: { intervals: [0, 3, 7, 10], letters: [0, 2, 4, 6], symbol: 'm7', roman: '7', minor: true, name: 'minor 7' },
  m7b5: { intervals: [0, 3, 6, 10], letters: [0, 2, 4, 6], symbol: 'm7b5', roman: 'ø7', minor: true, name: 'half-diminished' },
  dim7: { intervals: [0, 3, 6, 9], letters: [0, 2, 4, 6], symbol: '°7', roman: '°7', minor: true, name: 'diminished 7' },
  '7sus4': { intervals: [0, 5, 7, 10], letters: [0, 3, 4, 6], symbol: '7sus4', roman: '7sus4', minor: false, name: '7sus4' },
  add9: { intervals: [0, 4, 7, 14], letters: [0, 2, 4, 1], symbol: 'add9', roman: 'add9', minor: false, name: 'add 9' },
  '9': { intervals: [0, 4, 7, 10, 14], letters: [0, 2, 4, 6, 1], symbol: '9', roman: '9', minor: false, name: 'dominant 9' },
  maj9: { intervals: [0, 4, 7, 11, 14], letters: [0, 2, 4, 6, 1], symbol: 'maj9', roman: 'maj9', minor: false, name: 'major 9' },
  m9: { intervals: [0, 3, 7, 10, 14], letters: [0, 2, 4, 6, 1], symbol: 'm9', roman: '9', minor: true, name: 'minor 9' },
};

// Menu order. (Not Object.keys: integer-like keys such as '6' and '7' would
// be listed first.)
export const QUALITY_LIST: Quality[] = [
  'maj', 'min', 'dim', 'aug', 'sus2', 'sus4', '6', 'm6', '7', 'maj7', 'm7', 'm7b5', 'dim7', '7sus4', 'add9', '9', 'maj9', 'm9',
];

export const QUALITY_INTERVALS: Record<Quality, number[]> =
  Object.fromEntries(QUALITY_LIST.map(q => [q, QUALITIES[q].intervals])) as Record<Quality, number[]>;

export type HarmonicFunction = 'T' | 'PD' | 'D';

export interface ChordEvent {
  start: number; // ticks from section start
  dur: number; // ticks
  root: number; // semitones above the tonic, 0-11
  quality: Quality;
  inversion: number; // 0 root position, 1 third in bass, 2 fifth in bass
  fn: HarmonicFunction;
  // For applied chords (V7/x): the target's root, so the label reads V7/ii.
  appliedTo?: number;
}

export const chordIntervals = (c: Pick<ChordEvent, 'quality'>) => QUALITY_INTERVALS[c.quality];

// Pitch classes relative to the tonic, root first.
export const chordTones = (c: Pick<ChordEvent, 'root' | 'quality'>) => chordIntervals(c).map(i => mod12(c.root + i));

// Index of the chord's seventh (or the °7's diminished seventh), or -1.
export function seventhIndex(q: Quality): number {
  return QUALITIES[q].intervals.findIndex(i => i === 10 || i === 11 || (q === 'dim7' && i === 9));
}

export const hasSeventh = (q: Quality) => seventhIndex(q) !== -1;

// Index of the chord's third, or -1 for sus chords.
export const thirdIndex = (q: Quality) => QUALITIES[q].intervals.findIndex(i => i === 3 || i === 4);

// Positions a chord can stand in: root, then each chord tone below the
// ninth in the bass (3rd, 5th, and the 7th or 6th of four-note chords).
export const inversionCount = (q: Quality) => QUALITIES[q].intervals.filter(i => i < 12).length;

export const chordBassPc = (c: Pick<ChordEvent, 'root' | 'quality' | 'inversion'>) =>
  mod12(c.root + chordIntervals(c)[Math.min(c.inversion, inversionCount(c.quality) - 1)]);

export function chordSymbol(c: ChordEvent, key: Key): string {
  const root = spelledName(spellRoot(c.root, key));
  const base = root + QUALITIES[c.quality].symbol;
  if (c.inversion === 0) return base;
  return `${base}/${spelledName(spellInChord(key.tonic + chordBassPc(c), c, key))}`;
}

// Roman numerals, read against the major scale so chromatic roots get a
// b/# prefix; a mode's own diatonic roots (bIII in minor) read plainly.
const MAJOR_DEGREE_OF: Record<number, [number, string]> = {
  0: [0, ''], 1: [1, 'b'], 2: [1, ''], 3: [2, 'b'], 4: [2, ''], 5: [3, ''],
  6: [4, 'b'], 7: [4, ''], 8: [5, 'b'], 9: [5, ''], 10: [6, 'b'], 11: [6, ''],
};
const NUMERALS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

function numeral(root: number, quality: Quality, mode: Mode): string {
  const r = mod12(root);
  const modeDegree = MODE_STEPS[mode].indexOf(r);
  const [degree, prefix] = modeDegree !== -1 ? [modeDegree, ''] : MAJOR_DEGREE_OF[r];
  const spec = QUALITIES[quality];
  return prefix + (spec.minor ? NUMERALS[degree].toLowerCase() : NUMERALS[degree]) + spec.roman;
}

// Figured-bass inversion symbols.
function inversionFigure(c: Pick<ChordEvent, 'quality' | 'inversion'>): string {
  if (c.inversion === 0) return '';
  if (hasSeventh(c.quality)) return ['', '6/5', '4/3', '4/2'][c.inversion] ?? '';
  return ['', '6', '6/4', '4/2'][c.inversion] ?? '';
}

export function romanNumeral(c: ChordEvent, mode: Mode): string {
  const inv = inversionFigure(c);
  // An inverted seventh chord's figure (6/5, 4/3, 4/2) replaces its 7.
  const figured = (n: string) => (inv && hasSeventh(c.quality) ? n.replace(/7$/, '') : n) + inv;
  if (c.appliedTo !== undefined) {
    const targetQuality = diatonicTriad(c.appliedTo, mode) ?? 'maj';
    return `${figured(numeral(7, c.quality, 'major'))}/${numeral(c.appliedTo, targetQuality, mode)}`;
  }
  return figured(numeral(c.root, c.quality, mode));
}

// Triad built on a scale degree of the mode, or null if `root` isn't diatonic.
export function diatonicTriad(root: number, mode: Mode): Quality | null {
  const steps = MODE_STEPS[mode];
  const d = steps.indexOf(mod12(root));
  if (d === -1) return null;
  const third = mod12(steps[(d + 2) % 7] - steps[d]);
  const fifth = mod12(steps[(d + 4) % 7] - steps[d]);
  if (third === 4 && fifth === 7) return 'maj';
  if (third === 3 && fifth === 7) return 'min';
  if (third === 3 && fifth === 6) return 'dim';
  return 'aug';
}

// The diatonic seventh chord on a degree of the mode.
export function diatonicSeventh(root: number, mode: Mode): Quality | null {
  const steps = MODE_STEPS[mode];
  const d = steps.indexOf(mod12(root));
  const triad = diatonicTriad(root, mode);
  if (d === -1 || !triad) return null;
  const seventh = mod12(steps[(d + 6) % 7] - steps[d]);
  if (triad === 'maj') return seventh === 11 ? 'maj7' : '7';
  if (triad === 'min') return seventh === 10 ? 'm7' : null;
  if (triad === 'dim') return seventh === 10 ? 'm7b5' : 'dim7';
  return null;
}

export const withSeventh = (q: Quality): Quality =>
  q === 'maj' ? 'maj7' : q === 'min' ? 'm7' : q === 'dim' ? 'm7b5' : q;

// ---- Staff placement ----------------------------------------------------

// Bass-staff y coordinate (the legacy canvas unit: 7.5 per diatonic step,
// E1 on the bottom ledger at 120, G3 at 0) for a spelled MIDI note.
export function staffY(midi: number, s: Spelled): number {
  const naturalMidi = midi - s.acc;
  const octave = Math.floor(naturalMidi / 12) - 1;
  const diatonic = octave * 7 + LETTERS.indexOf(s.letter);
  const e1 = 1 * 7 + 2;
  return 120 - 7.5 * (diatonic - e1);
}

// Lowest/highest bass notes the staff (and a 4-string bass) can show.
export const BASS_MIN = 28; // E1
export const BASS_MAX = 55; // G3

// The range the piano roll displays chord voicings in (F3..E6).
export const VOICING_MIN = 53;
export const VOICING_MAX = 88;
