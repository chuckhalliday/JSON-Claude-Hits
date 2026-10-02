// Sound palette: suggested Ableton Live 10 Suite instruments for a song's
// drums, bass and chords, chosen as a set so the three parts sit together.
//
// Suggestions come only from the song itself - its tempo and mode, how
// coloured the chords are, how busy the bass is, the drum feel, and where the
// bass and chords meet in pitch - matched against the fixed table of Live's
// own instruments below. Nothing here looks at reference tracks or names an
// artist, and nothing writes to the song: the notes stay exactly as the
// generators (or your edits) left them. The table points at instruments and
// presets only, never Live's Clips or Samples, whose loops carry someone
// else's playing.
//
// Live ignores MIDI program changes for its own devices, so a palette travels
// as text: the Sounds panel, its sound sheet, and the exported .mid's track
// names. Each timbre also carries a General MIDI program as a fallback for
// other DAWs and GM synths.

import { Part, StoredTuning } from '../types';
import { SongDoc, KICK, SNARE, HAT_C, HAT_O, RIDE } from './doc';
import { Mode, MODE_NAMES } from './theory';
import { beatsToTickPositions } from './time';
import { genrePresets, normalizeTuning } from '../SongStructure/tuning';

export type Role = 'drums' | 'bass' | 'chords';

// Every instrument Live 10 Suite ships with that the table uses.
export const LIVE10_SUITE_DEVICES = [
  'Drum Rack', 'Simpler', 'Sampler', 'Operator', 'Analog', 'Wavetable', 'Electric', 'Tension', 'Collision',
] as const;
export type Device = typeof LIVE10_SUITE_DEVICES[number];

export interface Timbre {
  name: string;
  device: Device;
  browse: string; // where to look in Live's browser
  search: string[]; // words to type into the browser's search field
  gm: number; // General MIDI program; for drums, the GM2 kit number
  attack: 'percussive' | 'plucked' | 'sustained';
  brightness: number; // 0 dark .. 1 bright
  weight: number; // 0 thin .. 1 heavy low end
  tips: string[]; // device settings worth a look
}

export type StyleId = 'band' | 'soul' | 'blues' | 'synthpop' | 'club' | 'downtempo';

export interface SongFeatures {
  bpm: number;
  mode: Mode;
  brightness: number; // from the mode: phrygian darkest .. lydian brightest
  chordColor: number; // share of chords with a 7th, 6th, 9th or sus tone
  chordsPerBar: number;
  bassNotesPerBar: number;
  bassSixteenths: number; // share of bass notes a sixteenth long
  octaveLeaps: number; // share of bass moves that jump an octave or more
  bassTop: number; // MIDI note near the top of the bass line
  chordBottom: number; // MIDI note near the bottom of the chord voicings
  timePerBar: number; // hi-hat and ride hits per bar
  rideShare: number; // share of those on the ride
  snarePerBar: number;
  swing: number; // share of drum steps that are triplets
  kickBassLock: number; // share of kicks that land with a bass note
  quietest: { label: string; energy: number } | null;
  loudest: { label: string; energy: number } | null;
  formId: string | null;
  genre: string | null; // the Advanced panel's genre, when the dials match one exactly
}

export interface RolePick {
  role: Role;
  timbre: Timbre;
  why: string[];
}

export interface Palette {
  style: { id: StyleId; name: string };
  summary: string;
  drums: RolePick;
  bass: RolePick;
  chords: RolePick;
  interplay: string[];
  variant: number; // which combination this is, best first
  variants: number;
}

export interface PaletteInput {
  songStructure: Part[];
  bpm: number;
  key: string;
  doc?: SongDoc | null;
  // The generation dials (doc.tuning, or a classic song's params.tuning).
  tuning?: StoredTuning | null;
}

// ---- The instrument table (Live 10 Suite) --------------------------------

const t = (name: string, device: Device, browse: string, search: string[], gm: number, attack: Timbre['attack'], brightness: number, weight: number, tips: string[] = []): Timbre =>
  ({ name, device, browse, search, gm, attack, brightness, weight, tips });

// Drums
const STUDIO_KIT = t('Tight studio kit', 'Drum Rack', 'Drums', ['studio kit', 'acoustic kit'], 0, 'percussive', 0.5, 0.6,
  ['Drum Buss on the rack: a little Drive and Boom for body']);
const ROOM_KIT = t('Big room kit', 'Drum Rack', 'Drums', ['room kit', 'rock kit'], 8, 'percussive', 0.7, 0.8,
  ['Glue Compressor on the rack, slow attack, for room-sized punch']);
const BRUSH_KIT = t('Brushed jazz kit', 'Drum Rack', 'Drums', ['brush', 'jazz kit'], 40, 'percussive', 0.35, 0.4,
  ['Velocity MIDI effect with a little Random keeps brushes from sounding mechanical']);
const VINTAGE_KIT = t('Dry vintage kit', 'Drum Rack', 'Drums', ['vintage kit', 'jazz kit'], 32, 'percussive', 0.5, 0.5,
  ['Keep it dry: short Reverb send only on the snare']);
const MACHINE_808 = t('808-style machine kit', 'Drum Rack', 'Drums', ['808'], 25, 'percussive', 0.45, 0.9,
  ['Tune the kick pad to the song\'s tonic (Transpose in its Simpler)']);
const MACHINE_909 = t('909-style machine kit', 'Drum Rack', 'Drums', ['909'], 24, 'percussive', 0.8, 0.75,
  ['Shorten the open hat\'s Decay so it chokes against the closed hat']);
const DUSTY_KIT = t('Soft dusty kit', 'Drum Rack', 'Drums', ['vintage kit', 'lo-fi', 'kit'], 0, 'percussive', 0.3, 0.6,
  ['Vinyl Distortion or Redux on the rack for dust, then EQ Eight to roll off the top']);

// Bass
const FINGER_BASS = t('Finger electric bass', 'Sampler', 'Sounds › Bass', ['finger bass', 'electric bass'], 33, 'plucked', 0.4, 0.7,
  ['Compressor with a fast attack evens out the line']);
const PICK_BASS = t('Picked electric bass', 'Sampler', 'Sounds › Bass', ['pick bass', 'electric bass'], 34, 'plucked', 0.7, 0.6,
  ['Saturator (Soft Sine) adds growl that cuts through busy drums']);
const UPRIGHT_BASS = t('Upright bass', 'Sampler', 'Sounds › Bass', ['upright', 'acoustic bass'], 32, 'plucked', 0.3, 0.7,
  ['Shorten the Release a touch so walking notes don\'t blur']);
const ROUND_BASS = t('Round synth bass', 'Operator', 'Instruments › Operator', ['bass', 'round'], 38, 'plucked', 0.3, 0.8,
  ['Lower the filter Freq until it sounds round, then add a little Envelope amount']);
const ANALOG_BASS = t('Analog saw bass', 'Analog', 'Instruments › Analog', ['bass', 'saw'], 38, 'plucked', 0.6, 0.8,
  ['Short filter envelope decay gives each note a pluck']);
const OCTAVE_BASS = t('Bright pluck bass', 'Wavetable', 'Instruments › Wavetable', ['pluck bass', 'bass'], 39, 'plucked', 0.75, 0.6,
  ['Keep Unison off below C1 so the low notes stay solid']);
const SUB_BASS = t('Sine sub bass', 'Operator', 'Instruments › Operator', ['sub', 'sine'], 38, 'sustained', 0.1, 1,
  ['Play it mono and keep it clean: Utility with Bass Mono, no reverb']);
const REESE_BASS = t('Detuned (reese) bass', 'Wavetable', 'Instruments › Wavetable', ['reese', 'detuned bass'], 39, 'sustained', 0.6, 0.9,
  ['Automate the filter for movement; keep a sub layer underneath']);

// Chords
const GRAND_PIANO = t('Grand piano', 'Sampler', 'Sounds › Piano & Keys', ['grand piano'], 0, 'percussive', 0.6, 0.7,
  ['EQ Eight: gently dip the low mids so it doesn\'t crowd the bass']);
const ORGAN = t('Drawbar-style organ', 'Operator', 'Sounds › Piano & Keys', ['organ'], 16, 'sustained', 0.5, 0.5,
  ['Auto Pan at a slow rate stands in for a rotating speaker', 'No organ preset to hand? Operator with sine oscillators at coarse ratios 1, 2, 3 and 4 makes a drawbar organ']);
const PLUCKED_STRING = t('Plucked string', 'Tension', 'Instruments › Tension', ['guitar', 'pluck'], 27, 'plucked', 0.6, 0.4,
  ['Pull Damping up a little for a muted, rhythmic chop']);
const TINE_EP = t('Tine electric piano', 'Electric', 'Instruments › Electric', ['electric piano'], 4, 'percussive', 0.45, 0.5,
  ['Chorus at a low rate and a touch of Auto Pan for shimmer']);
const VIBES = t('Mallet vibes', 'Collision', 'Instruments › Collision', ['vibraphone', 'mallet'], 11, 'percussive', 0.55, 0.3,
  ['Lengthen the Decay for ringing chords; shorten it for comping']);
const BARRELHOUSE = t('Bright upright piano', 'Sampler', 'Sounds › Piano & Keys', ['upright piano', 'piano'], 3, 'percussive', 0.65, 0.6,
  ['A little Saturator gives it a barroom edge']);
const POLY_SYNTH = t('Analog poly synth', 'Analog', 'Instruments › Analog', ['poly', 'keys'], 90, 'plucked', 0.65, 0.5,
  ['Detune Osc 2 a few cents against Osc 1 to widen it']);
const SYNTH_PLUCK = t('Synth pluck', 'Wavetable', 'Instruments › Wavetable', ['pluck'], 90, 'plucked', 0.75, 0.35,
  ['Echo or Simple Delay at 1/8 dotted fills the space between chords']);
const SOFT_PAD = t('Soft analog pad', 'Analog', 'Instruments › Analog', ['pad', 'warm'], 89, 'sustained', 0.4, 0.6,
  ['Raise the Attack so the pad swells in under the drums']);
const STAB = t('Synth stab', 'Wavetable', 'Instruments › Wavetable', ['stab', 'chord'], 90, 'percussive', 0.75, 0.4,
  ['Short amp Release; let a Reverb send carry the tail']);
const WIDE_PAD = t('Wide wavetable pad', 'Wavetable', 'Instruments › Wavetable', ['pad'], 89, 'sustained', 0.5, 0.5,
  ['Utility Width up for size, but check it in mono']);
const FELT_KEYS = t('Soft felt piano', 'Sampler', 'Sounds › Piano & Keys', ['soft piano', 'felt'], 0, 'percussive', 0.3, 0.5,
  ['EQ Eight high shelf down a few dB for a muffled, close sound']);

interface Style {
  id: StyleId;
  name: string;
  fit: (f: SongFeatures) => number;
  drums: Timbre[];
  bass: Timbre[];
  chords: Timbre[];
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
// 1 inside [lo, hi], falling to 0 `soft` outside it.
const within = (x: number, lo: number, hi: number, soft: number) =>
  x >= lo && x <= hi ? 1 : clamp01(1 - (x < lo ? lo - x : x - hi) / soft);
const swingAmount = (f: SongFeatures) => clamp01(f.swing * 4);
// 0 = a sparse bass line with room between notes .. 1 = busy.
const busyness = (f: SongFeatures) => clamp01((f.bassNotesPerBar - 3) / 6 + 0.5 * f.bassSixteenths);
const halfTime = (f: SongFeatures) => clamp01(2 - f.snarePerBar);
const energyRange = (f: SongFeatures) => (f.loudest && f.quietest ? f.loudest.energy - f.quietest.energy : 0);

export const STYLES: Style[] = [
  {
    id: 'band', name: 'Live band',
    fit: f => 0.3 + 0.8 * within(f.bpm, 92, 140, 15) + 0.8 * (1 - f.chordColor) + 0.5 * (1 - swingAmount(f))
      + 0.4 * within(f.timePerBar, 6, 10, 4) + (f.genre === 'Rock' ? 1.5 : f.genre === 'Pop' ? 0.3 : 0)
      + (f.formId === 'pop' || f.formId === 'verse-chorus' ? 0.3 : 0),
    drums: [STUDIO_KIT, ROOM_KIT],
    bass: [FINGER_BASS, PICK_BASS],
    chords: [GRAND_PIANO, PLUCKED_STRING, ORGAN],
  },
  {
    id: 'soul', name: 'Soul / jazz combo',
    fit: f => 1.8 * f.chordColor + 1.2 * swingAmount(f) + 0.8 * clamp01(f.rideShare * 2) + 0.4 * within(f.bpm, 70, 130, 25)
      + (f.genre === 'Jazz' ? 1.5 : 0) + (f.formId === 'aaba' ? 0.6 : 0),
    drums: [BRUSH_KIT, VINTAGE_KIT],
    bass: [UPRIGHT_BASS, ROUND_BASS],
    chords: [TINE_EP, VIBES, ORGAN],
  },
  {
    id: 'blues', name: 'Blues & roots',
    fit: f => (f.formId === 'blues' ? 3 : 0) + (f.genre === 'Blues' ? 1.5 : 0) + 0.8 * swingAmount(f) + 0.3 * within(f.bpm, 70, 130, 25),
    drums: [VINTAGE_KIT, STUDIO_KIT],
    bass: [FINGER_BASS, UPRIGHT_BASS],
    chords: [ORGAN, BARRELHOUSE, TINE_EP],
  },
  {
    id: 'synthpop', name: 'Synth-pop',
    fit: f => 0.3 + 0.9 * within(f.bpm, 100, 130, 15) + 1.2 * f.brightness + 0.8 * clamp01(f.octaveLeaps * 4) + 0.5 * (1 - swingAmount(f))
      + 0.4 * clamp01((f.timePerBar - 6) / 8) + 0.4 * (1 - f.chordColor) + (f.genre === 'Pop' ? 1.2 : 0),
    drums: [MACHINE_808, MACHINE_909],
    bass: [ANALOG_BASS, OCTAVE_BASS],
    chords: [POLY_SYNTH, SYNTH_PLUCK, SOFT_PAD],
  },
  {
    id: 'club', name: 'Club / electronic',
    fit: f => (f.formId === 'build-drop' ? 2.2 : 0) + 0.8 * within(f.bpm, 118, 132, 10) + 0.8 * clamp01((f.timePerBar - 8) / 8)
      + 0.6 * f.kickBassLock + 0.4 * (1 - swingAmount(f)) + 0.3 * (1 - f.brightness) + 0.4 * clamp01(energyRange(f) * 2),
    drums: [MACHINE_909, MACHINE_808],
    bass: [SUB_BASS, REESE_BASS],
    chords: [STAB, WIDE_PAD, SYNTH_PLUCK],
  },
  {
    id: 'downtempo', name: 'Downtempo / lo-fi',
    fit: f => 2 * within(f.bpm, 60, 95, 12) + 0.8 * halfTime(f) + 0.8 * f.chordColor + 0.4 * (1 - f.brightness) + 0.4 * (1 - busyness(f)),
    drums: [DUSTY_KIT, MACHINE_808],
    bass: [SUB_BASS, FINGER_BASS],
    chords: [TINE_EP, FELT_KEYS, SOFT_PAD],
  },
];

// ---- Measuring the song --------------------------------------------------

const MODE_BRIGHTNESS: Record<Mode, number> = { lydian: 1, major: 0.8, mixolydian: 0.65, dorian: 0.45, minor: 0.3, phrygian: 0.15 };

const NOTE_PCS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const modeOf = (key: string): Mode => {
  const [note, modeName] = key.trim().split(/\s+/);
  const mode = (Object.keys(MODE_NAMES) as Mode[]).find(m => MODE_NAMES[m] === modeName);
  return note && note[0] in NOTE_PCS && mode ? mode : 'major';
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

function quantile(xs: number[], q: number, fallback: number): number {
  if (xs.length === 0) return fallback;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

// A chord is "coloured" when two of its pitch classes sit a step apart: a
// 7th, 6th, 9th or sus tone against the triad. Works on the voicings
// themselves, so classic songs (whose chord names are codes) measure too.
function coloured(tones: number[]): boolean {
  const pcs = [...new Set(tones.map(m => ((m % 12) + 12) % 12))];
  return pcs.some(a => pcs.some(b => { const d = (b - a + 12) % 12; return d === 1 || d === 2; }));
}

function genreOf(tuning: StoredTuning | null | undefined): string | null {
  if (!tuning) return null;
  const resolved = normalizeTuning(tuning);
  const keys = Object.keys(resolved) as Array<keyof typeof resolved>;
  return Object.keys(genrePresets).find(g => keys.every(k => Math.abs(genrePresets[g][k] - resolved[k]) < 1e-9)) ?? null;
}

export function songFeatures(input: PaletteInput): SongFeatures {
  const parts = input.songStructure;
  const bars = Math.max(1, sum(parts.map(p => sum(p.drumGroove))) / 4);

  const chords = parts.flatMap(p => p.chordTones.midiTones).filter(c => c.length > 0);
  const bassNotes = parts.flatMap(p => p.bassNoteLocations.slice(0, p.bassGroove.length).map((l, k) => ({ midi: l.midi, beats: p.bassGroove[k] })))
    .filter(n => n.midi > 0);
  let leaps = 0;
  let moves = 0;
  parts.forEach(p => {
    const line = p.bassNoteLocations.slice(0, p.bassGroove.length).map(l => l.midi).filter(m => m > 0);
    for (let i = 1; i < line.length; i++) {
      if (line[i] === line[i - 1]) continue;
      moves++;
      if (Math.abs(line[i] - line[i - 1]) >= 12) leaps++;
    }
  });

  let time = 0;
  let ride = 0;
  let snares = 0;
  let steps = 0;
  let triplets = 0;
  let kicks = 0;
  let locked = 0;
  parts.forEach(p => {
    const row = (voice: number) => p.drums[voice] ?? [];
    const hits = (voice: number) => row(voice).filter(c => c.checked).length;
    time += hits(HAT_C) + hits(HAT_O) + hits(RIDE);
    ride += hits(RIDE);
    snares += hits(SNARE);
    steps += p.drumGroove.length;
    triplets += p.drumGroove.filter(d => Math.abs(d * 4 - Math.round(d * 4)) > 0.01).length;
    const stepPos = beatsToTickPositions(p.drumGroove);
    const bassPos = beatsToTickPositions(p.bassGroove);
    const bassOn = new Set(bassPos.slice(0, -1).filter((_, k) => (p.bassNoteLocations[k]?.midi ?? 0) > 0));
    row(KICK).forEach((cell, step) => {
      if (!cell.checked || stepPos[step] === undefined) return;
      kicks++;
      if (bassOn.has(stepPos[step])) locked++;
    });
  });

  const withEnergy = parts.filter(p => typeof p.energy === 'number');
  const byEnergy = [...withEnergy].sort((a, b) => a.energy! - b.energy!);
  const ends = byEnergy.length > 0
    ? { quietest: { label: byEnergy[0].type, energy: byEnergy[0].energy! }, loudest: { label: byEnergy[byEnergy.length - 1].type, energy: byEnergy[byEnergy.length - 1].energy! } }
    : { quietest: null, loudest: null };

  const mode = input.doc?.key.mode ?? modeOf(input.key);
  return {
    bpm: input.bpm,
    mode,
    brightness: MODE_BRIGHTNESS[mode],
    chordColor: chords.length ? chords.filter(coloured).length / chords.length : 0,
    chordsPerBar: chords.length / bars,
    bassNotesPerBar: bassNotes.length / bars,
    bassSixteenths: bassNotes.length ? bassNotes.filter(n => n.beats <= 0.25).length / bassNotes.length : 0,
    octaveLeaps: moves ? leaps / moves : 0,
    bassTop: quantile(bassNotes.map(n => n.midi), 0.9, 48),
    chordBottom: quantile(chords.map(c => Math.min(...c)), 0.1, 60),
    timePerBar: time / bars,
    rideShare: time ? ride / time : 0,
    snarePerBar: snares / bars,
    swing: steps ? triplets / steps : 0,
    kickBassLock: kicks ? locked / kicks : 0,
    ...ends,
    formId: input.doc?.formId ?? null,
    genre: genreOf(input.tuning ?? input.doc?.tuning),
  };
}

// ---- Choosing the trio ---------------------------------------------------

// Note names as Live's piano roll shows them (middle C = C3).
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
export const liveNoteName = (midi: number) => `${NAMES[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 2}`;
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
const pct = (x: number) => `${Math.round(x * 100)}%`;

// How far the chords' floor sits above the bass's ceiling, 0 (clear) .. 1 (crossing).
const overlap = (f: SongFeatures) => clamp01((8 - (f.chordBottom - f.bassTop)) / 8);

const rankBonus = (i: number) => 0.15 * (1 - i);

function drumScore(d: Timbre, i: number, f: SongFeatures): number {
  const target = 0.35 + 0.5 * clamp01((f.timePerBar - 4) / 12) - 0.25 * swingAmount(f) + 0.15 * ((f.loudest?.energy ?? 0.5) - 0.5);
  return rankBonus(i) - Math.abs(d.brightness - target);
}

function bassScore(b: Timbre, i: number, f: SongFeatures): number {
  const targetBright = 0.2 + 0.55 * busyness(f);
  const targetWeight = 0.55 + 0.45 * f.kickBassLock;
  return rankBonus(i) - Math.abs(b.brightness - targetBright) - 0.6 * Math.abs(b.weight - targetWeight);
}

// The chord sound is judged against the bass and drums already chosen: it
// should fill what the bass leaves (sustain over a busy line, articulate
// over a sparse one), stay mellow on coloured voicings, stay out of the
// bass's register, and not be a second bright part next to a bright bass.
function chordScore(c: Timbre, i: number, f: SongFeatures, bass: Timbre, drums: Timbre): number {
  const busy = busyness(f);
  const fill = c.attack === 'sustained' ? busy - 0.5 : c.attack === 'percussive' ? 0.5 - busy : 0.6 * (0.5 - busy);
  const fastChanges = f.chordsPerBar >= 2 && c.attack === 'sustained' ? 0.3 : 0;
  const targetBright = 0.65 - 0.35 * f.chordColor + 0.2 * (f.brightness - 0.5) - 0.2 * (drums.brightness - 0.5);
  const crowding = overlap(f) * c.weight * 0.8;
  const glare = bass.brightness > 0.6 && c.brightness > 0.6 ? 0.2 : 0;
  return rankBonus(i) + 0.5 * fill - fastChanges - Math.abs(c.brightness - targetBright) - crowding - glare;
}

interface Combo {
  style: Style;
  drums: Timbre;
  bass: Timbre;
  chords: Timbre;
  score: number;
}

// Every drums x bass x chords combination of the two best-fitting styles,
// best first. Variant 0 is the suggestion; later ones are the alternatives
// the panel's "Another combination" steps through.
function rankedCombos(f: SongFeatures): Combo[] {
  const styles = [...STYLES].sort((a, b) => b.fit(f) - a.fit(f)).slice(0, 2);
  const combos: Combo[] = [];
  for (const style of styles) {
    const fit = style.fit(f);
    style.drums.forEach((d, di) => style.bass.forEach((b, bi) => style.chords.forEach((c, ci) => {
      combos.push({ style, drums: d, bass: b, chords: c, score: fit + drumScore(d, di, f) + bassScore(b, bi, f) + chordScore(c, ci, f, b, d) });
    })));
  }
  // Stable: ties keep table order, so the result never depends on sort internals.
  return combos.map((c, i) => ({ c, i })).sort((a, b) => b.c.score - a.c.score || a.i - b.i).map(x => x.c);
}

function hatsText(f: SongFeatures): string {
  if (f.timePerBar >= 12) return 'sixteenth-note hats';
  if (f.timePerBar >= 6) return 'eighth-note hats';
  return 'sparse, quarter-note time';
}

function drumsWhy(f: SongFeatures, style: Style, d: Timbre): string[] {
  const why = [`${style.name} feel with ${hatsText(f)} (${f.timePerBar.toFixed(1)} a bar)`];
  if (f.swing > 0.05) why.push(`${pct(f.swing)} of drum steps are triplets: vary the kit's velocities so the shuffle breathes`);
  if (f.rideShare > 0.3) why.push('The ride carries the time in the loud sections');
  why.push(d.brightness >= 0.6 ? 'Bright cymbals to drive the busier parts' : 'A darker kit leaves room for the chords on top');
  return why;
}

function bassWhy(f: SongFeatures, b: Timbre): string[] {
  const busy = busyness(f);
  const why = [`${f.bassNotesPerBar.toFixed(1)} bass notes a bar${f.bassSixteenths > 0.15 ? `, ${pct(f.bassSixteenths)} of them sixteenths` : ''}: `
    + (b.brightness >= 0.55 ? 'an articulate bass that speaks quickly'
      : busy > 0.5 ? 'a rounder tone keeps a busy line from turning harsh' : 'a rounder bass with room to ring')];
  if (f.kickBassLock > 0.5) {
    why.push(`The kick lands with a bass note ${pct(f.kickBassLock)} of the time: `
      + (b.weight >= 0.8 ? 'a heavy low end locks with it' : 'a tight, even bass keeps the two from blurring'));
  }
  if (f.octaveLeaps > 0.1) why.push(`${pct(f.octaveLeaps)} of bass moves jump an octave: a synth bass makes those pops`);
  return why;
}

function chordsWhy(f: SongFeatures, c: Timbre): string[] {
  const busy = busyness(f);
  const why: string[] = [];
  why.push(c.attack === 'sustained'
    ? (busy > 0.5 ? 'Sustains under a busy bass instead of competing with its rhythm' : 'Long tones glue the sections together')
    : busy > 0.5 ? 'Short, articulate chords that stay out of the bass\'s way' : 'Percussive chords fill the gaps the bass leaves');
  if (f.chordColor > 0.3) {
    why.push(`${pct(f.chordColor)} of chords carry a 7th, 6th, 9th or sus tone: `
      + (c.brightness <= 0.5 ? 'a mellow sound keeps four-note voicings clear' : 'if the voicings sound crowded, darken this sound a little'));
  }
  else why.push(`Mostly plain triads (${pct(1 - f.chordColor)}), which can take a fuller, brighter sound`);
  if (f.chordsPerBar >= 2) why.push(`Chords change ${f.chordsPerBar.toFixed(1)} times a bar, so a shorter release avoids smearing`);
  return why;
}

function interplayNotes(f: SongFeatures, drums: Timbre, bass: Timbre, chords: Timbre): string[] {
  const notes: string[] = [];
  const gap = f.chordBottom - f.bassTop;
  const cut = Math.round((hz(f.chordBottom) * 0.75) / 10) * 10;
  if (gap < 3) {
    notes.push(`Bass and chords cross around ${liveNoteName(f.bassTop)}–${liveNoteName(f.chordBottom)}: high-pass Chords with EQ Eight near ${cut} Hz, or move the chord clip up an octave, so the bass owns the low mids.`);
  } else if (gap < 8) {
    notes.push(`The bass tops out near ${liveNoteName(f.bassTop)} and the chords start near ${liveNoteName(f.chordBottom)}: a gentle EQ Eight low cut on Chords around ${cut} Hz keeps them apart.`);
  } else {
    notes.push(`Clear space between the bass (up to ${liveNoteName(f.bassTop)}) and chords (from ${liveNoteName(f.chordBottom)}): no low cut needed on Chords.`);
  }
  if (f.kickBassLock > 0.5) {
    notes.push(`Kick and bass hit together on ${pct(f.kickBassLock)} of kicks: put a Compressor on Bass, sidechained from Drums (fast attack, ~100 ms release), so they punch together instead of masking.`);
  } else if (f.kickBassLock < 0.25) {
    notes.push('Kick and bass mostly alternate: leave the bass un-ducked and let its attack carry the off-beats.');
  }
  if (bass.weight >= 0.9 && drums.weight >= 0.8) {
    notes.push('Heavy kick and heavy bass: keep the kick short (shorten its Decay) so its tail doesn\'t sit on the bass notes.');
  }
  if (chords.attack === 'sustained' && f.chordsPerBar >= 2) {
    notes.push('The chord sound sustains but the chords change often: shorten its Release so changes don\'t blur.');
  }
  if (f.bpm >= 135) notes.push(`At ${f.bpm} BPM, keep releases and reverb tails short so the parts stay distinct.`);
  else if (f.bpm < 90) notes.push(`At ${f.bpm} BPM there's room for longer releases and a bigger Reverb on the chords.`);
  if (f.swing > 0.05) notes.push('The groove has triplet steps: a Velocity MIDI effect with a little Random on Drums keeps the shuffle human.');
  if (f.loudest && f.quietest && f.loudest.energy - f.quietest.energy >= 0.3) {
    notes.push(`Energy runs from the ${f.quietest.label} (quietest) to the ${f.loudest.label} (loudest): map the Chords filter to a Macro and automate it open for the loud sections.`);
  }
  return notes;
}

// The palette for a song. `variant` steps through the alternatives (it
// wraps), best first. Deterministic: the same song always gets the same
// suggestions, and no random stream is touched.
export function suggestPalette(input: PaletteInput, variant = 0): Palette {
  const f = songFeatures(input);
  const combos = rankedCombos(f);
  const index = ((Math.floor(variant) % combos.length) + combos.length) % combos.length;
  const { style, drums, bass, chords } = combos[index];
  const summary = `${f.bpm} BPM ${MODE_NAMES[f.mode].toLowerCase()}, ${hatsText(f)}, ${f.bassNotesPerBar.toFixed(1)} bass notes a bar, `
    + `${pct(f.chordColor)} coloured chords${f.swing > 0.05 ? ', triplet feel' : ''}${f.genre ? `, ${f.genre} dials` : ''}`;
  return {
    style: { id: style.id, name: style.name },
    summary,
    drums: { role: 'drums', timbre: drums, why: drumsWhy(f, style, drums) },
    bass: { role: 'bass', timbre: bass, why: bassWhy(f, bass) },
    chords: { role: 'chords', timbre: chords, why: chordsWhy(f, chords) },
    interplay: interplayNotes(f, drums, bass, chords),
    variant: index,
    variants: combos.length,
  };
}

export const ROLE_TITLES: Record<Role, string> = { drums: 'Drums', bass: 'Bass', chords: 'Chords' };

// Short track name for the exported .mid: "Bass - Sine sub bass (Operator)".
// Plain ASCII: not every DAW reads non-ASCII text in a MIDI file.
export const trackLabel = (pick: RolePick) => `${ROLE_TITLES[pick.role]} - ${pick.timbre.name} (${pick.timbre.device})`;

// The palette as plain text, for the sound sheet download.
export function paletteText(palette: Palette, title: string): string {
  const lines = [
    `${title} — Ableton Live 10 Suite sound palette`,
    `Style: ${palette.style.name}`,
    `Measured: ${palette.summary}`,
    '',
  ];
  for (const pick of [palette.drums, palette.bass, palette.chords]) {
    const tb = pick.timbre;
    lines.push(`${ROLE_TITLES[pick.role].toUpperCase()}: ${tb.name}`);
    lines.push(`  Device: ${tb.device}`);
    lines.push(`  Browser: ${tb.browse} — search: ${tb.search.map(s => `"${s}"`).join(' or ')}`);
    pick.why.forEach(w => lines.push(`  · ${w}`));
    tb.tips.forEach(tip => lines.push(`  Tip: ${tip}`));
    lines.push('');
  }
  lines.push('HOW THEY FIT TOGETHER');
  palette.interplay.forEach(n => lines.push(`  · ${n}`));
  lines.push('');
  lines.push('Instruments and presets only: nothing here uses Live\'s Clips or Samples loops.');
  return lines.join('\n');
}
