// Sound palette: suggested Ableton Live 10 Suite instruments for a song's
// drums, bass and chords, chosen as a set so the three parts sit together,
// plus a sound for the guide-tone line, the chord sound section by section,
// and a User Library name to save each built sound under.
//
// Suggestions come only from the song itself - its tempo and mode, how
// coloured the chords are, how busy the bass is, the drum feel, and where the
// bass and chords meet in pitch - matched against the fixed table of Live's
// own instruments below. Nothing here looks at reference tracks or names an
// artist, and nothing writes to the song: the notes stay exactly as the
// generators (or your edits) left them. The table recommends instruments and
// how to patch them, never loops or clips, which carry someone else's playing.
//
// The palette is advice for after the fact: the exported .mid stays a plain
// MIDI file, and the instruments are set up in Live once it's loaded.

import { Part, StoredTuning } from '../types';
import { SongDoc, KICK, SNARE, HAT_C, HAT_O, RIDE, DRUM_VOICES } from './doc';
import { Mode, MODE_NAMES } from './theory';
import { beatsToTickPositions } from './time';
import { GM_DRUMS } from './exportMidi';
import { genrePresets, normalizeTuning } from '../SongStructure/tuning';

export type Role = 'drums' | 'bass' | 'chords' | 'guide';

// The Live 10 Suite instruments the table recommends.
export const LIVE10_SUITE_DEVICES = [
  'Drum Rack', 'Sampler', 'Operator', 'Analog', 'Wavetable', 'Electric', 'Tension', 'Collision',
] as const;
export type Device = typeof LIVE10_SUITE_DEVICES[number];

export interface Timbre {
  name: string;
  device: Device;
  basis: string; // what the device does that suits this sound
  setup: string[]; // a starting patch, from the device's default state
  attack: 'percussive' | 'plucked' | 'sustained';
  brightness: number; // 0 dark .. 1 bright
  weight: number; // 0 thin .. 1 heavy low end
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
  chordTop: number; // ... and near the top
  guideLow: number | null; // range of the guide-tone line, when the song has one
  guideHigh: number | null;
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

// A drums / bass / chords combination by name, so a chosen combination can
// be saved with the song and found again after edits re-rank the list.
export interface SoundPick {
  style: StyleId;
  drums: string;
  bass: string;
  chords: string;
}

// The chord sound for one section label (every Verse, every Chorus...) and
// what to change there.
export interface SectionSound {
  label: string;
  energy: number | null; // average energy of its parts, when known
  chords: Timbre;
  moves: string[];
}

export interface Palette {
  style: { id: StyleId; name: string };
  summary: string;
  drums: RolePick;
  bass: RolePick;
  chords: RolePick;
  guide: RolePick | null; // null when the song has no guide-tone line
  // Chord sounds some sections switch to, beyond the main one.
  extraChords: RolePick[];
  sections: SectionSound[];
  interplay: string[];
  drumMap: string; // which pad each drum voice in the .mid plays
  pick: SoundPick;
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
//
// Each entry names the Live 10 Suite device to play the part on, why that
// device's design suits the sound (its `basis`), and a starting patch built
// from the device's own sections and controls. Preset names vary with the
// installed Packs, so none are relied on: every patch can be set up from the
// device's default state. The scoring fields describe the patch as set up.

const t = (name: string, device: Device, basis: string, setup: string[], attack: Timbre['attack'], brightness: number, weight: number): Timbre =>
  ({ name, device, basis, setup, attack, brightness, weight });

const SAMPLED_KIT = 'Acoustic drums are recorded sounds that don\'t synthesise convincingly; a Drum Rack holds one sampled hit per pad, each on its own chain for EQ and compression.';
const SYNTH_KIT = 'Machine-style drums are themselves synthesised. Live 10 Suite\'s Drum Synth devices (DS Kick, DS Snare, DS HH, DS Cymbal, DS Tom) each build one voice from a few controls such as pitch, decay and tone, and sit on Drum Rack pads like samples do.';

// Drums
const STUDIO_KIT = t('Tight studio kit', 'Drum Rack', SAMPLED_KIT, [
  'Load close-miked acoustic kick, snare, hat, tom, ride and crash samples from Live\'s library onto the pads',
  'Put the open and closed hat in the same Choke group so the open hat cuts off',
  'Drum Buss on the rack: a little Drive and Boom for body',
], 'percussive', 0.5, 0.6);
const ROOM_KIT = t('Big room kit', 'Drum Rack', SAMPLED_KIT, [
  'Load acoustic samples with room sound in them (or add a short Reverb on a Rack return)',
  'Glue Compressor on the rack, slow attack, for room-sized punch',
  'Open and closed hat in one Choke group',
], 'percussive', 0.7, 0.8);
const BRUSH_KIT = t('Brushed jazz kit', 'Drum Rack', SAMPLED_KIT, [
  'Load brushed snare and soft kick samples; use a ride for the time',
  'Velocity MIDI effect in front of the rack with a little Random keeps brushes from sounding mechanical',
  'Keep the rack dry; a small Reverb send on the snare only',
], 'percussive', 0.35, 0.4);
const VINTAGE_KIT = t('Dry vintage kit', 'Drum Rack', SAMPLED_KIT, [
  'Load dry acoustic samples (no room); tune the snare pad down a little in its Simpler',
  'Open and closed hat in one Choke group',
  'A short Reverb send on the snare only',
], 'percussive', 0.5, 0.5);
const MACHINE_808 = t('808-style machine kit', 'Drum Rack', SYNTH_KIT, [
  'DS Kick with a long Decay for a booming kick; tune its Pitch to the song\'s tonic',
  'DS Snare and DS HH with short decays; DS Cymbal for the crash and ride pads',
  'Closed and open DS HH pads in one Choke group',
], 'percussive', 0.45, 0.9);
const MACHINE_909 = t('909-style machine kit', 'Drum Rack', SYNTH_KIT, [
  'DS Kick with a short Decay and more attack click for punch',
  'DS Snare with plenty of noise (Tone up); DS HH with a bright tone',
  'Shorten the open hat\'s decay and choke it against the closed hat',
], 'percussive', 0.8, 0.75);
const DUSTY_KIT = t('Soft dusty kit', 'Drum Rack', SAMPLED_KIT, [
  'Load soft acoustic samples; lower each pad\'s velocity sensitivity so hits stay gentle',
  'Vinyl Distortion or Redux on the rack for dust, then EQ Eight to roll off the top',
], 'percussive', 0.3, 0.6);

// Bass
const FINGER_BASS = t('Fingered electric bass', 'Tension',
  'Tension physically models a string: an excitator (bow, hammer or plectrum) sets it moving, and a damper, pickup and body shape the sound, so a bass guitar can be built without samples.', [
  'Excitator: Plectrum with a soft, low setting for a fingered attack',
  'Pickup: on, placed toward the middle of the string for a round tone; Body: off',
  'Shorten the string Decay so notes stop like a muted bass; Compressor with a fast attack evens the line',
], 'plucked', 0.4, 0.7);
const PICK_BASS = t('Picked electric bass', 'Tension',
  'Tension physically models a string excited by a plectrum and read by an electric pickup, which is how a picked bass gets its bite.', [
  'Excitator: Plectrum with a harder setting for a pick attack',
  'Pickup: on, close to the bridge end for a brighter, punchier tone; Body: off',
  'Saturator (Soft Sine) after it adds growl that cuts through busy drums',
], 'plucked', 0.7, 0.6);
const UPRIGHT_BASS = t('Upright bass', 'Tension',
  'Tension models a plucked string resonating in an acoustic body, the two things that make an upright bass sound woody.', [
  'Excitator: Plectrum, soft; Pickup: off',
  'Body: on, at a large size, so the string resonates through it',
  'Lengthen the string Decay a little for walking lines, but keep the Release short so notes don\'t blur',
], 'plucked', 0.3, 0.7);
const ROUND_BASS = t('Round FM bass', 'Operator',
  'Operator is a four-oscillator FM synth: one sine oscillator modulating another adds harmonics that can fade with an envelope, giving a plucked tone with a clean sine body.', [
  'An algorithm with Oscillator B modulating Oscillator A; both sine, Coarse 1',
  'Give B a fast-decaying envelope and modest Level so only the attack is bright',
  'Filter low-pass with the cutoff low; mono, short Release',
], 'plucked', 0.3, 0.8);
const ANALOG_BASS = t('Analog saw bass', 'Analog',
  'Analog models a subtractive synth: two oscillators into two multimode filters, which is the classic recipe for a saw bass with a filter pluck.', [
  'Osc 1 Saw; Osc 2 Rect (square) one octave down for weight',
  'Filter 1 low-pass at 24 dB with moderate Reso; a short filter envelope decay gives each note a pluck',
  'Mono with a little Glide if the line moves in steps',
], 'plucked', 0.6, 0.8);
const OCTAVE_BASS = t('Bright pluck bass', 'Wavetable',
  'Wavetable plays two wavetable oscillators plus a sub oscillator, so a bright plucked top and a clean low end come from one device.', [
  'Osc 1 on a bright, saw-like table; Sub oscillator on for the fundamental',
  'Filter 1 low-pass with Envelope 2 on its frequency: fast attack, short decay, low sustain',
  'Keep Unison off so octave jumps stay solid in the low register',
], 'plucked', 0.75, 0.6);
const SUB_BASS = t('Sine sub bass', 'Operator',
  'A single sine oscillator has no harmonics above its fundamental, which is exactly a sub bass: weight the kick can sit beside without the two blurring.', [
  'Oscillator A only (sine, Coarse 1); turn Oscillators B to D off',
  'Amp envelope: instant attack, full sustain, short release; one voice (mono)',
  'Utility with Bass Mono after it; no reverb on this track',
], 'sustained', 0.1, 1);
const REESE_BASS = t('Detuned (reese) bass', 'Wavetable',
  'Two saw-like wavetable oscillators detuned against each other beat slowly, the moving low end of a reese bass; Wavetable\'s sub oscillator keeps the fundamental steady underneath.', [
  'Osc 1 and Osc 2 on saw-like tables, Osc 2 detuned a few cents (or Unison: Classic at a low amount)',
  'Sub oscillator on; Filter 1 low-pass around 1 kHz',
  'An LFO on the filter frequency, slow, for movement',
], 'sustained', 0.6, 0.9);

// Chords
const GRAND_PIANO = t('Grand piano', 'Sampler',
  'A piano\'s tone changes too much across the keyboard and with how hard it\'s struck to synthesise well; Sampler maps a multisampled piano across key zones and velocity layers.', [
  'Load a multisampled grand piano, with velocity layers, into Sampler',
  'EQ Eight: dip the low mids a little so it doesn\'t crowd the bass',
], 'percussive', 0.6, 0.7);
const ORGAN = t('Drawbar-style organ', 'Operator',
  'A drawbar organ adds sine waves at fixed pitch ratios; Operator\'s algorithm with all four oscillators as carriers does the same additive mix.', [
  'The algorithm with all four oscillators side by side (all carriers), all sine',
  'Coarse ratios 0.5, 1, 1.5 and 2 (the 16\', 8\', 5 1/3\' and 4\' drawbars); set each Level like a drawbar',
  'Amp envelopes: instant attack, full sustain; Auto Pan at a slow rate for a rotating-speaker feel',
], 'sustained', 0.5, 0.5);
const PLUCKED_STRING = t('Plucked guitar-like string', 'Tension',
  'Tension models a plucked string in a resonant body, so chords come out as strummed or picked strings with a natural decay.', [
  'Excitator: Plectrum; Body: on at a medium size',
  'Raise Damping a little for a muted, rhythmic chop, or lower it for ringing chords',
], 'plucked', 0.6, 0.4);
const TINE_EP = t('Tine electric piano', 'Electric',
  'Electric physically models an electric piano: a mallet strikes a tine fork, and a damper and electromagnetic pickup shape the tone.', [
  'Pickup Type R (the tine-style electromagnetic pickup)',
  'Mallet Stiffness moderate; lower Force for a mellow tone, raise it for bark',
  'Chorus at a low rate and a touch of Auto Pan for shimmer',
], 'percussive', 0.45, 0.5);
const GRITTY_EP = t('Reed electric piano', 'Electric',
  'Electric\'s W pickup models a reed-style electrostatic pickup, which gives the gritty, bluesy electric piano tone that breaks up when played hard.', [
  'Pickup Type W',
  'Mallet Force up so harder notes bark; a little Saturator for edge',
], 'percussive', 0.65, 0.55);
const VIBES = t('Mallet vibes', 'Collision',
  'Collision models mallet percussion: a mallet excites resonators shaped like beams, marimba bars, plates or tubes, which is how a vibraphone makes its tone.', [
  'Mallet excitator; Resonator 1 type Beam or Marimba',
  'An LFO on volume at a few Hz for vibraphone-style tremolo',
  'Lengthen the resonator decay for ringing chords; shorten it for comping',
], 'percussive', 0.55, 0.3);
const POLY_SYNTH = t('Analog poly synth', 'Analog',
  'Analog\'s two oscillators, detuned against each other into a low-pass filter, give the warm, wide chord sound of a classic polysynth.', [
  'Osc 1 and Osc 2 Saw, Osc 2 detuned a few cents',
  'Filter 1 low-pass at 12 dB, cutoff mid-way, a little filter envelope',
  'Amp: quick attack, medium decay, high sustain',
], 'plucked', 0.65, 0.5);
const SYNTH_PLUCK = t('Synth pluck', 'Wavetable',
  'Wavetable\'s filter driven by a fast envelope turns any bright table into a short pluck, so chords become rhythmic hits.', [
  'Osc 1 on a bright table; Amp envelope: no sustain, short decay',
  'Filter 1 low-pass with Envelope 2 on its frequency, fast decay',
  'Echo or Delay at a dotted 1/8 fills the space between chords',
], 'plucked', 0.75, 0.35);
const SOFT_PAD = t('Soft analog pad', 'Analog',
  'Analog\'s slow amp attack and LFO-swept filter make a pad that swells in under the other parts without competing with their rhythm.', [
  'Osc 1 Saw and Osc 2 Rect, slightly detuned',
  'Filter 1 low-pass, cutoff low; LFO 1 slowly on the cutoff',
  'Amp: slow attack, long release',
], 'sustained', 0.4, 0.6);
const STAB = t('Synth stab', 'Wavetable',
  'Short envelopes on Wavetable\'s unison-thickened oscillators give a punchy chord stab that leaves the gaps to the bass and drums.', [
  'Osc 1 on a saw-like table; Unison: Classic, moderate amount',
  'Amp envelope: fast attack, short decay, no sustain, short release',
  'Let a Reverb send carry the tail instead of the release',
], 'percussive', 0.75, 0.4);
const WIDE_PAD = t('Wide wavetable pad', 'Wavetable',
  'Slowly sweeping Wavetable\'s table Position with an LFO, with the Shimmer unison mode, makes a pad that keeps moving while the chords hold.', [
  'Osc 1 and Osc 2 on soft tables; an LFO slowly on Osc 1 Position',
  'Unison: Shimmer; Amp: slow attack, long release',
  'Utility Width up for size, but check it in mono',
], 'sustained', 0.5, 0.5);
const SOFT_KEYS = t('Soft felt keys', 'Electric',
  'Lowering Electric\'s mallet stiffness and force models a soft, felt-like strike, giving a muted, close keys sound.', [
  'Mallet Stiffness and Force low; Pickup Type R',
  'EQ Eight: a high shelf down a few dB for a muffled tone',
], 'percussive', 0.3, 0.5);

// Guide tones: one 3rd or 7th held per chord, a scaffold for writing a
// melody, so each sound here is a clear single line.
const SINE_LINE = t('Soft sine line', 'Operator',
  'A lone sine oscillator is the plainest possible line: with no overtones to clash with the chords, the guide notes read clearly through them.', [
  'Oscillator A only (sine, Coarse 1); turn Oscillators B to D off',
  'Amp envelope: a slightly soft attack, full sustain, medium release; Voices 1',
  'Operator\'s LFO at a low Amount and about 5 Hz on the oscillator\'s pitch for a gentle vibrato, or leave it off for a plain guide',
], 'sustained', 0.25, 0.2);
const BOWED_LINE = t('Bowed string line', 'Tension',
  'Tension\'s Bow excitator keeps a modelled string sounding for as long as the note is held, so each guide tone sustains like a cello or violin line.', [
  'Excitator: Bow; set its Force and Friction until the tone is steady rather than scratchy',
  'Body: on at a medium size; Pickup: off',
  'Voices 1, so the line moves from note to note',
], 'sustained', 0.45, 0.35);
const PLUCK_LINE = t('Clean picked line', 'Tension',
  'Tension models a plucked string read by an electric pickup, like a clean guitar picking single notes over the chords.', [
  'Excitator: Plectrum; Pickup: on, toward the middle of the string; Body: off',
  'Damping low so each note rings; Voices 1',
  'A little Chorus and a short Reverb send',
], 'plucked', 0.55, 0.3);
const SQUARE_LINE = t('Mellow square lead', 'Analog',
  'Analog\'s pulse oscillator through a 12 dB low-pass filter gives a hollow, woody lead that sits apart from saw-based chords.', [
  'Osc 1 Rect with its pulse width near the middle; Osc 2 off',
  'Filter 1 low-pass at 12 dB, cutoff around the middle, little Reso',
  'Mono with a short Glide, so the line slides from chord to chord',
], 'sustained', 0.55, 0.3);
const BELL_LINE = t('Soft bell line', 'Collision',
  'Collision\'s Mallet striking a Plate or Beam resonator rings with bell-like overtones, a line that stays clear of held chords.', [
  'Mallet excitator, Stiffness moderate; Resonator 1 type Plate (or Beam for a purer tone); Resonator 2 off',
  'Shorten the resonator Decay so each guide tone rings and fades before the next chord',
  'Keep it dry, or send a little Reverb',
], 'percussive', 0.7, 0.15);
const GLASS_LINE = t('Glassy wavetable lead', 'Wavetable',
  'A bright, glassy Wavetable table played mono with glide carries a single clear line over pads or stabs.', [
  'Osc 1 on a glassy, bell-like table; Osc 2 and Sub off; Unison off',
  'Mono on with a short Glide',
  'Delay at 1/8 with low feedback under the line',
], 'sustained', 0.7, 0.25);

interface Style {
  id: StyleId;
  name: string;
  fit: (f: SongFeatures) => number;
  drums: Timbre[];
  bass: Timbre[];
  chords: Timbre[];
  guide: Timbre[];
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
    guide: [PLUCK_LINE, BOWED_LINE, SINE_LINE],
  },
  {
    id: 'soul', name: 'Soul / jazz combo',
    fit: f => 1.8 * f.chordColor + 1.2 * swingAmount(f) + 0.8 * clamp01(f.rideShare * 2) + 0.4 * within(f.bpm, 70, 130, 25)
      + (f.genre === 'Jazz' ? 1.5 : 0) + (f.formId === 'aaba' ? 0.6 : 0),
    drums: [BRUSH_KIT, VINTAGE_KIT],
    bass: [UPRIGHT_BASS, ROUND_BASS],
    chords: [TINE_EP, VIBES, ORGAN],
    guide: [SINE_LINE, BELL_LINE, BOWED_LINE],
  },
  {
    id: 'blues', name: 'Blues & roots',
    fit: f => (f.formId === 'blues' ? 3 : 0) + (f.genre === 'Blues' ? 1.5 : 0) + 0.8 * swingAmount(f) + 0.3 * within(f.bpm, 70, 130, 25),
    drums: [VINTAGE_KIT, STUDIO_KIT],
    bass: [FINGER_BASS, UPRIGHT_BASS],
    chords: [ORGAN, GRITTY_EP, TINE_EP],
    guide: [PLUCK_LINE, BOWED_LINE, SINE_LINE],
  },
  {
    id: 'synthpop', name: 'Synth-pop',
    fit: f => 0.3 + 0.9 * within(f.bpm, 100, 130, 15) + 1.2 * f.brightness + 0.8 * clamp01(f.octaveLeaps * 4) + 0.5 * (1 - swingAmount(f))
      + 0.4 * clamp01((f.timePerBar - 6) / 8) + 0.4 * (1 - f.chordColor) + (f.genre === 'Pop' ? 1.2 : 0),
    drums: [MACHINE_808, MACHINE_909],
    bass: [ANALOG_BASS, OCTAVE_BASS],
    chords: [POLY_SYNTH, SYNTH_PLUCK, SOFT_PAD],
    guide: [SQUARE_LINE, GLASS_LINE, BELL_LINE],
  },
  {
    id: 'club', name: 'Club / electronic',
    fit: f => (f.formId === 'build-drop' ? 2.2 : 0) + 0.8 * within(f.bpm, 118, 132, 10) + 0.8 * clamp01((f.timePerBar - 8) / 8)
      + 0.6 * f.kickBassLock + 0.4 * (1 - swingAmount(f)) + 0.3 * (1 - f.brightness) + 0.4 * clamp01(energyRange(f) * 2),
    drums: [MACHINE_909, MACHINE_808],
    bass: [SUB_BASS, REESE_BASS],
    chords: [STAB, WIDE_PAD, SYNTH_PLUCK],
    guide: [GLASS_LINE, BELL_LINE, SINE_LINE],
  },
  {
    id: 'downtempo', name: 'Downtempo / lo-fi',
    fit: f => 2 * within(f.bpm, 60, 95, 12) + 0.8 * halfTime(f) + 0.8 * f.chordColor + 0.4 * (1 - f.brightness) + 0.4 * (1 - busyness(f)),
    drums: [DUSTY_KIT, MACHINE_808],
    bass: [SUB_BASS, FINGER_BASS],
    chords: [TINE_EP, SOFT_KEYS, SOFT_PAD],
    guide: [SINE_LINE, BELL_LINE, BOWED_LINE],
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

  const guides = parts.flatMap(p => p.guideTones ?? []).filter(m => m > 0);

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
    chordTop: quantile(chords.map(c => Math.max(...c)), 0.9, 72),
    guideLow: guides.length ? quantile(guides, 0.1, 60) : null,
    guideHigh: guides.length ? quantile(guides, 0.9, 72) : null,
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

// Note names as Live's piano roll shows them: sharps, middle C = C3.
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
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

const pickOf = (c: Combo): SoundPick => ({ style: c.style.id, drums: c.drums.name, bass: c.bass.name, chords: c.chords.name });

export const samePick = (a: SoundPick | null | undefined, b: SoundPick | null | undefined) =>
  !!a && !!b && a.style === b.style && a.drums === b.drums && a.bass === b.bass && a.chords === b.chords;

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

// The guide line has to read through the chords: a different attack or
// brightness from the chord sound (two pads melt into one), sustained when
// chords are held for a bar or more, and preferably another instrument.
function guideScore(g: Timbre, i: number, f: SongFeatures, chords: Timbre): number {
  const contrast = Math.min(0.4, Math.abs(g.brightness - chords.brightness));
  const attack = g.attack !== chords.attack ? 0.2 : 0;
  const held = g.attack === 'sustained' ? 0.15 * clamp01(2 - f.chordsPerBar) : 0;
  const sameDevice = g.device === chords.device ? 0.15 : 0;
  return rankBonus(i) + contrast + attack + held - sameDevice;
}

function guideWhy(f: SongFeatures, g: Timbre, chords: Timbre): string[] {
  const why = ['One 3rd or 7th held per chord: a scaffold to write the melody against, so it should read clearly on its own'];
  if (g.attack !== chords.attack) why.push(`A ${g.attack} line against ${chords.attack} chords, so the two stay distinct`);
  else why.push(g.brightness > chords.brightness ? 'Brighter than the chord sound, so the line sits on top of it' : 'Plainer than the chord sound, so the line doesn\'t compete with its colour');
  if (g.attack === 'sustained' && f.chordsPerBar < 1.5) why.push('Chords mostly last a bar or more, and a sustained line holds each guide tone that long');
  return why;
}

const listText = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

// A section only leaves the main chord sound when another fits it clearly better.
const SWITCH_MARGIN = 0.1;

// The chord sound for each section label, scored like the main pick but on
// that section's own measurements (a quiet, sparse verse can want a
// different sound from a driving chorus), from the chosen style's chord
// sounds. Sections with an energy also get a filter position, closed for
// the quietest through open for the loudest.
function sectionSounds(input: PaletteInput, style: Style, drums: Timbre, bass: Timbre, chords: Timbre): SectionSound[] {
  const parts = input.songStructure;
  const energyOf = (ps: Part[]) => ps.map(p => p.energy).filter((e): e is number => typeof e === 'number');
  const all = energyOf(parts);
  const lo = all.length ? Math.min(...all) : 0;
  const range = all.length ? Math.max(...all) - lo : 0;
  const mainIndex = style.chords.indexOf(chords);
  return [...new Set(parts.map(p => p.type))].map(label => {
    const own = parts.filter(p => p.type === label);
    const f = songFeatures({ ...input, songStructure: own });
    const scored = style.chords.map((c, i) => ({ c, score: chordScore(c, i, f, bass, drums) }));
    const best = scored.reduce((a, b) => (b.score > a.score ? b : a));
    const pick = best.c !== chords && best.score > scored[mainIndex].score + SWITCH_MARGIN ? best.c : chords;
    const known = energyOf(own);
    const energy = known.length ? sum(known) / known.length : null;
    const moves: string[] = [];
    if (pick !== chords) moves.push(`Chords: ${pick.name}. ${chordsWhy(f, pick)[0]}`);
    if (energy !== null && range >= 0.2) {
      const r = (energy - lo) / range;
      moves.push(r >= 0.67 ? 'Chord filter fully open' : r <= 0.33 ? 'Chord filter mostly closed, so the chords sit darker and further back' : 'Chord filter about half open');
    }
    return { label, energy, chords: pick, moves };
  });
}

function interplayNotes(f: SongFeatures, drums: Timbre, bass: Timbre, chords: Timbre, guide: Timbre | null, extras: Timbre[]): string[] {
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
    notes.push(`Energy runs from the ${f.quietest.label} (quietest) to the ${f.loudest.label} (loudest): automate the chord instrument's filter cutoff to open up for the loud sections (positions under Section by section).`);
  }
  if (extras.length > 0) {
    notes.push(`Chords change sound between sections: put ${listText([chords, ...extras].map(c => c.name))} in one Instrument Rack on the Chords track, one chain each, give each chain its own Chain Select zone, and automate the Chain Selector at the section markers.`);
  }
  if (guide && f.guideLow !== null && f.guideHigh !== null) {
    const span = `${liveNoteName(f.guideLow)}–${liveNoteName(f.guideHigh)}`;
    notes.push((f.guideLow >= f.chordBottom && f.guideHigh <= f.chordTop
      ? `The guide line (${span}) sits inside the chord voicings: move its clip up an octave or pan it away from the chords so it reads on its own, and keep it a few dB under them.`
      : `The guide line (${span}) sits clear of the chord voicings; keep it a few dB under the chords.`)
      + ' It\'s a scaffold for writing your melody, so mute it once the melody is in.');
  }
  return notes;
}

// The exported .mid plays drums on General MIDI notes (exportMidi.ts), all
// within C1-D#2: the 16 pads a Drum Rack shows by default.
const DRUM_NAMES = ['kick', 'snare', 'low tom', 'mid tom', 'high tom', 'closed hat', 'open hat', 'ride', 'crash'];
const DRUM_MAP = DRUM_VOICES.map((_, v) => v)
  .sort((a, b) => GM_DRUMS[a] - GM_DRUMS[b])
  .map(v => `${DRUM_NAMES[v]} ${liveNoteName(GM_DRUMS[v])}`)
  .join(', ');

// The palette for a song. `choice` is a combination index (it wraps; 0 is
// the best match) or a saved SoundPick, which falls back to the best match
// once edits have moved the song away from that combination's styles.
// Deterministic: the same song always gets the same suggestions, and no
// random stream is touched.
export function suggestPalette(input: PaletteInput, choice: number | SoundPick | null = 0): Palette {
  const f = songFeatures(input);
  const combos = rankedCombos(f);
  const n = typeof choice === 'number' ? choice : Math.max(0, combos.findIndex(c => samePick(pickOf(c), choice)));
  const index = ((Math.floor(n) % combos.length) + combos.length) % combos.length;
  const combo = combos[index];
  const { style, drums, bass, chords } = combo;
  const guide = f.guideLow === null ? null : style.guide
    .map((g, i) => ({ g, score: guideScore(g, i, f, chords) }))
    .reduce((a, b) => (b.score > a.score ? b : a)).g;
  const sections = sectionSounds(input, style, drums, bass, chords);
  const extras = [...new Set(sections.map(sec => sec.chords).filter(c => c !== chords))];
  const summary = `${f.bpm} BPM ${MODE_NAMES[f.mode].toLowerCase()}, ${hatsText(f)}, ${f.bassNotesPerBar.toFixed(1)} bass notes a bar, `
    + `${pct(f.chordColor)} coloured chords${f.swing > 0.05 ? ', triplet feel' : ''}${f.genre ? `, ${f.genre} dials` : ''}`;
  return {
    style: { id: style.id, name: style.name },
    summary,
    drums: { role: 'drums', timbre: drums, why: drumsWhy(f, style, drums) },
    bass: { role: 'bass', timbre: bass, why: bassWhy(f, bass) },
    chords: { role: 'chords', timbre: chords, why: chordsWhy(f, chords) },
    guide: guide && { role: 'guide', timbre: guide, why: guideWhy(f, guide, chords) },
    extraChords: extras.map(c => ({
      role: 'chords',
      timbre: c,
      why: [`For the ${listText(sections.filter(sec => sec.chords === c).map(sec => sec.label))}, in place of ${chords.name}`],
    })),
    sections,
    interplay: interplayNotes(f, drums, bass, chords, guide, extras),
    drumMap: DRUM_MAP,
    pick: pickOf(combo),
    variant: index,
    variants: combos.length,
  };
}

export const ROLE_TITLES: Record<Role, string> = { drums: 'Drums', bass: 'Bass', chords: 'Chords', guide: 'Guide tones' };

// ---- Saving built sounds -------------------------------------------------
//
// A sound built from its starting patch can be saved to Live's User Library
// under a fixed name, so next time it's one Browser search away instead of
// another build. The prefix keeps that search to your own presets.

export const presetName = (tb: Timbre) => `JCH ${tb.name}`;

export const saveStep = (tb: Timbre) => (tb.device === 'Drum Rack'
  ? `Save the Drum Rack to your User Library (the save button in its title bar) as "${presetName(tb)}"`
  : `Select ${tb.device} and any effects after it, group them into an Instrument Rack (Ctrl+G, or Cmd+G on a Mac), and save the rack to your User Library as "${presetName(tb)}"`);

const ROLES: Role[] = ['drums', 'bass', 'chords', 'guide'];

// Every sound in the table, once each, by role.
export function allTimbres(): Record<Role, Timbre[]> {
  const out = { drums: [], bass: [], chords: [], guide: [] } as Record<Role, Timbre[]>;
  ROLES.forEach(role => STYLES.forEach(style => style[role].forEach(tb => {
    if (!out[role].includes(tb)) out[role].push(tb);
  })));
  return out;
}

// A checklist for building the whole table once, as plain text.
export function presetLibraryText(): string {
  const lines = [
    'Ableton Live 10 Suite preset build list',
    'Build each sound once from its instrument\'s default state and save it as shown. After that, search Live\'s Browser for the preset name the Sounds panel gives.',
    'Every sound uses Live 10 Suite\'s own instruments; the sampled kits and the piano use single hits or notes from Live\'s library.',
    '',
  ];
  const table = allTimbres();
  for (const role of ROLES) {
    lines.push(`${ROLE_TITLES[role].toUpperCase()} (${table[role].length})`);
    table[role].forEach(tb => {
      lines.push(`  [ ] ${presetName(tb)} (${tb.device})`);
      lines.push(`      ${tb.basis}`);
      tb.setup.forEach((step, i) => lines.push(`      ${i + 1}. ${step}`));
      lines.push(`      ${tb.setup.length + 1}. ${saveStep(tb)}`);
    });
    lines.push('');
  }
  return lines.join('\n');
}

// The palette as plain text, for the sound sheet download.
export function paletteText(palette: Palette, title: string): string {
  const lines = [
    `${title} — Ableton Live 10 Suite sound palette`,
    `Style: ${palette.style.name}`,
    `Measured: ${palette.summary}`,
    'Built a sound before? Search Live\'s Browser for its saved preset name. First time: follow its starting patch, then save it.',
    '',
  ];
  const block = (pick: RolePick, heading: string) => {
    const tb = pick.timbre;
    lines.push(`${heading}: ${tb.name}`);
    lines.push(`  Device: ${tb.device}`);
    lines.push(`  Saved preset: ${presetName(tb)}`);
    lines.push(`  Why this device: ${tb.basis}`);
    lines.push('  Why for this song:');
    pick.why.forEach(w => lines.push(`    · ${w}`));
    lines.push('  Starting patch:');
    tb.setup.forEach((step, i) => lines.push(`    ${i + 1}. ${step}`));
    lines.push(`    ${tb.setup.length + 1}. ${saveStep(tb)}`);
    if (pick.role === 'drums') lines.push(`  Pads: ${palette.drumMap}`);
    lines.push('');
  };
  [palette.drums, palette.bass, palette.chords, palette.guide].forEach(pick => pick && block(pick, ROLE_TITLES[pick.role].toUpperCase()));
  palette.extraChords.forEach(pick => block(pick, 'CHORDS, SOME SECTIONS'));
  if (palette.sections.some(sec => sec.moves.length > 0)) {
    lines.push('SECTION BY SECTION');
    palette.sections.forEach(sec => {
      lines.push(`  ${sec.label}${sec.energy !== null ? ` (energy ${pct(sec.energy)})` : ''}: ${sec.chords.name}`);
      sec.moves.forEach(m => lines.push(`    · ${m}`));
    });
    lines.push('');
  }
  lines.push('HOW THEY FIT TOGETHER');
  palette.interplay.forEach(n => lines.push(`  · ${n}`));
  return lines.join('\n');
}
