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

// Letter steps above a chord root for each interval (in semitones), so chord
// tones are spelled as thirds/fifths/sevenths of the root: D major's third
// is F#, A7's is C#, B°'s fifth is F.
const INTERVAL_LETTER_STEPS: Record<number, number> = { 0: 0, 3: 2, 4: 2, 5: 3, 6: 4, 7: 4, 8: 4, 9: 6, 10: 6, 11: 6 };

// Spell a pitch heard against a chord: chord tones by their interval from
// the chord's root, anything else (passing/approach notes) by the key.
export function spellInChord(pc: number, chord: Pick<ChordEvent, 'root' | 'quality'>, key: Key): Spelled {
  const rel = mod12(pc - key.tonic);
  const intervals = QUALITY_INTERVALS[chord.quality];
  const k = intervals.findIndex(i => mod12(chord.root + i) === rel);
  if (k === -1) return spellPc(pc, key);
  const root = spellRoot(chord.root, key);
  const letterIndex = (LETTERS.indexOf(root.letter) + INTERVAL_LETTER_STEPS[intervals[k]]) % 7;
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

export type Quality = 'maj' | 'min' | 'dim' | 'aug' | 'sus4' | '7' | 'maj7' | 'm7' | 'm7b5' | 'dim7';

export const QUALITY_INTERVALS: Record<Quality, number[]> = {
  maj: [0, 4, 7], min: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus4: [0, 5, 7],
  '7': [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9],
};

const SYMBOL_SUFFIX: Record<Quality, string> = {
  maj: '', min: 'm', dim: '°', aug: '+', sus4: 'sus4', '7': '7', maj7: 'maj7', m7: 'm7', m7b5: 'm7b5', dim7: '°7',
};

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

export const chordBassPc = (c: Pick<ChordEvent, 'root' | 'quality' | 'inversion'>) =>
  mod12(c.root + chordIntervals(c)[Math.min(c.inversion, 2)]);

export const hasSeventh = (q: Quality) => QUALITY_INTERVALS[q].length === 4;

export function chordSymbol(c: ChordEvent, key: Key): string {
  const root = spelledName(spellRoot(c.root, key));
  const base = root + SYMBOL_SUFFIX[c.quality];
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
  const lower = quality === 'min' || quality === 'dim' || quality === 'm7' || quality === 'm7b5' || quality === 'dim7';
  const base = lower ? NUMERALS[degree].toLowerCase() : NUMERALS[degree];
  const suffix: Record<Quality, string> = {
    maj: '', min: '', dim: '°', aug: '+', sus4: 'sus4', '7': '7', maj7: 'maj7', m7: '7', m7b5: 'ø7', dim7: '°7',
  };
  return prefix + base + suffix[quality];
}

export function romanNumeral(c: ChordEvent, mode: Mode): string {
  const inv = c.inversion === 0 ? '' : hasSeventh(c.quality) ? (c.inversion === 1 ? '6/5' : '4/3') : (c.inversion === 1 ? '6' : '6/4');
  // An inverted seventh chord's figure (6/5, 4/3) replaces its 7.
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
