// Shared domain types for the song model.
//
// One definition per shape, imported everywhere the song tree is produced,
// stored, played, or rendered. Previously these shapes were written out inline
// (and duplicated verbatim) in reducers.ts, songStructure.ts, the playback
// modules, and the components.

// A single drum-grid cell: which step it is, whether it fires, and whether it's
// accented (accents drive louder velocities during playback).
export interface DrumHit {
  index: number;
  checked: boolean;
  accent?: boolean;
}

// A bass note's location on the staff. `x`/`y` are canvas pixels used for
// drawing; `acc` is the accidental ('none' | 'sharp' | 'flat'). `osc`/`midi`
// carry the note's concrete pitch (oscillator frequency and MIDI note number)
// so playback reads the pitch directly and never has to interpret pixels.
export interface NoteLocation {
  x: number;
  y: number;
  acc: string;
  osc: number;
  midi: number;
}

// Concurrent chord voicings per beat: oscillator frequencies and MIDI notes.
export interface ChordTones {
  oscTones: number[][];
  midiTones: number[][];
}

// A rhythmic pattern expressed as note durations in beats.
export type Groove = number[];

// Dials for the odds the generation algorithm rolls against — the "deep"
// settings the Advanced panel exposes. The rate fields are multipliers on the
// generators' base probabilities (1 = stock behavior; the base odds stay in
// the algorithm files as the single source of truth); maxPartRepeats caps how
// many times a Verse/Chorus/Bridge may repeat back-to-back.
export interface GenerationTuning {
  kickOdds: number;
  snareOdds: number;
  crashOdds: number;
  hiHatOpenRate: number;
  chordSubstitutionRate: number;
  chordChangeRate: number;
  chordVoicingRate: number;
  tripletSubdivisionRate: number;
  bassTonalityBias: number;
  maxPartRepeats: number;
}

// A tuning as it may arrive from a stored recipe: fields can be missing
// (saves that predate a dial) and it may carry the retired single-dial
// drumHitOdds shape. normalizeTuning() resolves this to a GenerationTuning;
// nothing else should read a StoredTuning's fields directly.
export type StoredTuning = Partial<GenerationTuning> & { drumHitOdds?: number };

// The generation recipe that produced a song — every choice the Generate New
// Song menu can edit, with random fallbacks resolved to the values actually
// used. Stored alongside the song so the menu can pre-load with them. (The
// key is not duplicated here; it lives on the song as the key string.)
// `tuning` is optional because songs saved before the Advanced dials existed
// have recipes without it; readers normalize it against the defaults.
export interface SongParams {
  grooves: number[][];
  arrangement: number[][];
  triplet: number;
  bpm: number;
  songLength: number;
  tuning?: StoredTuning;
}

// One rendered section of the song (a Verse/Chorus/Bridge instance).
export interface Part {
  type: string;
  repeat: number;
  bass: string[];
  bassGroove: Groove;
  bassGrid: number[];
  bassNoteLocations: NoteLocation[];
  measureLines: number[];
  drums: DrumHit[][];
  drumGroove: Groove;
  stepIds: number[];
  chords: string[];
  chordTones: ChordTones;
  chordsGroove: Groove;
  chordsLocation: number[];
  // Present on parts realized from a sculpted SongDoc (src/Core): which
  // section definition this instance plays, its chords as Roman numerals,
  // the guide-tone line (MIDI, one per chord), and the instance's energy and
  // key lift. Parts from the classic generator or older saves lack them.
  sectionId?: string;
  roman?: string[];
  guideTones?: number[];
  energy?: number;
  transpose?: number;
}

export type SongStructure = Part[];
