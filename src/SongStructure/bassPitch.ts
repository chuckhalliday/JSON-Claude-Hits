import { tone } from "./tone";

export interface Pitch {
  osc: number;  // oscillator frequency in Hz (0 or negative = rest / no pitch)
  midi: number; // MIDI note number     (0 or negative = rest / no pitch)
}

// The staff IS the pitch UI: a bass note's vertical position (`y`) together with
// its accidental determines its pitch. This function is the single source of
// that mapping, so playback can read a note's stored osc/midi and never has to
// interpret pixel coordinates.
//
// Staff positions are 7.5 apart per diatonic step, with the open low E (E1)
// on the ledger line below the staff at y = 120. (Bass is written an octave
// above where it sounds; these are sounding pitches.) Positions run up to
// F4 at y = -45 - three ledger lines above the staff's existing top ledgers -
// so the whole 20-fret range of a 4-string bass (up to Eb4) can be shown.
export const STAFF_STEP = 7.5;
export const PITCH_MAX_Y = 120; // E1
export const PITCH_MIN_Y = -45; // F4

const LETTER_PC = [0, 2, 4, 5, 7, 9, 11]; // C D E F G A B
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const;
const E1_STEP = 1 * 7 + 2; // E in octave 1, counted in letters from C0

// Whether a y is a pitched staff position (rests sit at y = -20, off-grid).
export const isStaffPitch = (y: number) =>
  y >= PITCH_MIN_Y && y <= PITCH_MAX_Y && Number.isInteger(y / STAFF_STEP);

export function bassPitch(y: number, acc: string): Pitch {
  if (!isStaffPitch(y)) {
    // A rest (y = -20) or a position off the grid has no pitch; its raw y
    // passes through as before, and playback treats values <= 0 as rests.
    return { osc: y, midi: y };
  }
  const step = E1_STEP + Math.round((PITCH_MAX_Y - y) / STAFF_STEP);
  const letter = step % 7;
  const octave = Math.floor(step / 7);
  // Accidentals the staff can't spell on that letter (E#, B#, Cb, Fb) leave
  // the natural, as the original per-position table did.
  let shift = acc === 'sharp' ? 1 : acc === 'flat' ? -1 : 0;
  if ((shift === 1 && (letter === 2 || letter === 6)) || (shift === -1 && (letter === 0 || letter === 3))) shift = 0;
  const midi = (octave + 1) * 12 + LETTER_PC[letter] + shift;
  const name = NAMES[midi % 12];
  return { osc: tone[name][Math.floor(midi / 12) - 1], midi };
}
