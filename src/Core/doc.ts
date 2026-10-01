// The song document: the editable source of truth for "sculpted" songs.
//
// Content lives on section *definitions* (one Verse, one Chorus...), and the
// form is a list of *instances* that reference them. Editing a definition
// changes every instance; per-instance variations (energy, key lift, fills,
// crashes, individual drum overrides) layer on top. The legacy `Part[]` the
// existing editors and playback consume is derived from this (see realize.ts).

import { ChordEvent, Key } from './theory';
import { GenerationTuning } from '../types';

export type SectionLabel =
  | 'Intro' | 'Verse' | 'Pre-Chorus' | 'Chorus' | 'Bridge' | 'Breakdown' | 'Drop' | 'Solo' | 'Outro';

// Generation layers, coarse to fine. Each can be locked and re-rolled per
// section; re-rolling a layer rebuilds the unlocked layers that depend on it.
export type Layer = 'harmony' | 'rhythm' | 'bass' | 'drums' | 'voicing';
export const LAYERS: Layer[] = ['harmony', 'rhythm', 'bass', 'drums', 'voicing'];

export const LAYER_DEPENDENTS: Record<Layer, Layer[]> = {
  harmony: ['bass', 'voicing'],
  rhythm: ['bass', 'drums'],
  bass: [],
  drums: [],
  voicing: [],
};

export type Cadence = 'authentic' | 'half' | 'plagal' | 'deceptive' | 'loop';

export interface DrumCell {
  checked: boolean;
  accent: boolean;
}

// Drum voices, in the drum machine's row order.
export const DRUM_VOICES = ['kick', 'snare', 'lowTom', 'midTom', 'highTom', 'hiHatC', 'hiHatO', 'ride', 'crash'] as const;
export const [KICK, SNARE, LOW_TOM, MID_TOM, HIGH_TOM, HAT_C, HAT_O, RIDE, CRASH] = [0, 1, 2, 3, 4, 5, 6, 7, 8];

export interface SectionDef {
  id: string;
  label: SectionLabel;
  bars: number; // always even: the staff and grid work in 2-bar chunks
  energy: number; // 0..1 baseline the generators shape density/register by
  cadence: Cadence;
  harmony: ChordEvent[];
  // Bass rhythm (note durations in ticks) and the drum step grid
  // (step durations in ticks) that subdivides it.
  bassRhythm: number[];
  drumSteps: number[];
  bass: number[]; // MIDI per bass-rhythm note; 0 = rest
  // Hand-picked tab strings per bass note (0 = low E ... 3 = G), or null to
  // let the tab view choose. Cleared when the bass is regenerated.
  bassStrings?: Array<number | null>;
  drums: DrumCell[][]; // [voice][step]
  voicing: number[][]; // MIDI chord tones per harmony event
  guideTones: number[]; // one 3rd/7th line note per harmony event
  locks: Record<Layer, boolean>;
  rolls: Record<Layer, number>; // re-roll counters, part of each layer's seed
}

export interface DrumOverride {
  voice: number;
  step: number;
  checked: boolean;
}

export interface SectionInstance {
  sectionId: string;
  energy: number;
  transpose: number; // semitones, e.g. a final-chorus lift
  drumOverrides: DrumOverride[];
  // "This part only": the instance plays its own copy of its section, so
  // edits to it don't reach the section's other instances.
  detached?: boolean;
}

export interface FormEntry {
  label: SectionLabel;
  energy?: number;
  transpose?: number;
}

export interface GenerateOptions {
  seed?: number;
  formId?: string;
  tonic?: number;
  mode?: import('./theory').Mode;
  bpm?: number;
  targetSeconds?: number;
  triplet?: number; // 0..1 chance a section gets a triplet feel
  tuning?: Partial<GenerationTuning>;
  // Optional 2-bar bass rhythms (in beats) to build sections from, and which
  // motif each 2-bar chunk of the Verse/Chorus/Bridge uses (the Generate
  // menu's groove editor).
  motifs?: number[][];
  arrangement?: number[][];
  liftFinalChorus?: boolean;
}

export interface SongDoc {
  version: 1;
  seed: number;
  key: Key;
  bpm: number;
  meter: [number, number];
  formId: string;
  sections: Record<string, SectionDef>;
  form: SectionInstance[];
  tuning: GenerationTuning;
  triplet: number;
  motifs: number[][] | null;
  arrangement: number[][] | null;
  liftFinalChorus: boolean;
}
