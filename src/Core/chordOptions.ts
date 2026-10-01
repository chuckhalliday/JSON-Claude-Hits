// What a chord in the progression could be instead: the menus behind
// clicking a Roman numeral (functional alternatives), the bass note
// (inversions), and the chord symbol (any root, any quality).

import { ChordEvent, HarmonicFunction, Key, Mode, MODE_STEPS, QUALITIES, QUALITY_LIST, Quality, chordSymbol, diatonicSeventh, diatonicTriad, inversionCount, mod12, romanNumeral, spellRoot, spelledName } from './theory';

export type ChordChoice = Pick<ChordEvent, 'root' | 'quality' | 'appliedTo' | 'fn'>;

export interface ChordOption {
  roman: string;
  symbol: string;
  choice: ChordChoice;
  current: boolean;
}

export interface OptionGroup {
  title: string;
  options: ChordOption[];
}

const FUNCTION_OF_DEGREE: HarmonicFunction[] = ['T', 'PD', 'T', 'PD', 'D', 'T', 'D'];
const FUNCTION_NAMES: Record<HarmonicFunction, string> = { T: 'tonic', PD: 'predominant', D: 'dominant' };

// Harmonic function of a chord in a mode: by scale degree for diatonic
// roots; applied dominants and tritone subs are dominants; other chromatic
// chords (borrowed bVI, Neapolitan...) lean predominant.
export function functionOf(chord: Pick<ChordEvent, 'root' | 'quality' | 'appliedTo'>, mode: Mode): HarmonicFunction {
  if (chord.appliedTo !== undefined) return 'D';
  const degree = MODE_STEPS[mode].indexOf(mod12(chord.root));
  if (degree !== -1) return FUNCTION_OF_DEGREE[degree];
  if (mod12(chord.root) === 1 && chord.quality === '7') return 'D';
  return 'PD';
}

const same = (a: ChordChoice, b: ChordChoice) =>
  mod12(a.root) === mod12(b.root) && a.quality === b.quality && a.appliedTo === b.appliedTo;

// The parallel major or minor (modes take the one sharing their third).
const parallelOf = (mode: Mode): Mode =>
  mode === 'major' || mode === 'lydian' || mode === 'mixolydian' ? 'minor' : 'major';

export function romanOptions(current: ChordEvent, key: Key): OptionGroup[] {
  const mode = key.mode;
  const steps = MODE_STEPS[mode];
  const option = (choice: Omit<ChordChoice, 'fn'>): ChordOption => {
    const chord = { ...current, ...choice, inversion: 0, fn: functionOf(choice, mode) } as ChordEvent;
    return { roman: romanNumeral(chord, mode), symbol: chordSymbol(chord, key), choice: { ...choice, fn: chord.fn }, current: same(chord, current) };
  };
  const triads = steps.map(root => option({ root, quality: diatonicTriad(root, mode) ?? 'maj', appliedTo: undefined }));
  const sevenths = steps.flatMap(root => {
    const q = diatonicSeventh(root, mode);
    return q ? [option({ root, quality: q, appliedTo: undefined })] : [];
  });
  const fn = functionOf(current, mode);
  const sameFunction = [...triads, ...sevenths].filter(o => o.choice.fn === fn);

  // V7 of every diatonic chord except the tonic and diminished ones.
  const applied = steps.slice(1).flatMap(target =>
    diatonicTriad(target, mode) === 'dim' ? [] : [option({ root: mod12(target + 7), quality: '7', appliedTo: target })]);

  // Mixture from the parallel mode, plus the Neapolitan and tritone sub.
  const parallel = parallelOf(mode);
  const borrowed = MODE_STEPS[parallel]
    .map(root => ({ root, quality: diatonicTriad(root, parallel) ?? 'maj' }))
    .filter(c => diatonicTriad(c.root, mode) !== c.quality)
    .map(c => option({ ...c, appliedTo: undefined }));
  const chromatic = [option({ root: 1, quality: 'maj', appliedTo: undefined }), option({ root: 1, quality: '7', appliedTo: undefined })];

  const dedupe = (options: ChordOption[]) => options.filter((o, i) => options.findIndex(p => same(p.choice, o.choice)) === i);
  return [
    { title: `Same function (${FUNCTION_NAMES[fn]})`, options: dedupe(sameFunction) },
    { title: 'Diatonic triads', options: triads },
    { title: 'Diatonic sevenths', options: sevenths },
    { title: 'Applied dominants', options: applied },
    { title: `Borrowed (${parallel}) & chromatic`, options: dedupe([...borrowed, ...chromatic]) },
  ].filter(g => g.options.length > 0);
}

export interface InversionOption {
  inversion: number;
  symbol: string;
  roman: string;
  bass: string;
  current: boolean;
}

export function inversionOptions(current: ChordEvent, key: Key): InversionOption[] {
  return Array.from({ length: inversionCount(current.quality) }, (_, inversion) => {
    const chord = { ...current, inversion };
    const symbol = chordSymbol(chord, key);
    return {
      inversion,
      symbol,
      roman: romanNumeral(chord, key.mode),
      bass: symbol.includes('/') ? symbol.split('/')[1] : spelledName(spellRoot(current.root, key)),
      current: inversion === current.inversion,
    };
  });
}

export const INVERSION_NAMES = ['root position', '1st inversion', '2nd inversion', '3rd inversion'];

// Every root, spelled for the key, for the any-chord picker.
export const rootChoices = (key: Key) =>
  Array.from({ length: 12 }, (_, rel) => ({ rel, name: spelledName(spellRoot(rel, key)) }));

export const qualityChoices = QUALITY_LIST.map(q => ({ quality: q as Quality, symbol: QUALITIES[q].symbol || 'maj', name: QUALITIES[q].name }));
