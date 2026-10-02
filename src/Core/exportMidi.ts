// Export the current song as a Standard MIDI File for a DAW.
//
// Works from the Part[] the editors show, so every hand edit is included,
// for sculpted and classic songs alike. Tracks:
//   0 Conductor: tempo, 4/4, key signature, one marker per section
//   1 Drums (channel 10, General MIDI kit)
//   2 Bass
//   3 Chords, with chord symbols as text events
//   4 Guide tones (3rds/7ths), when the song has them
// Section markers show up on the arrangement timeline in Logic, Cubase,
// Reaper and others, so the block structure survives the trip.

import { Part } from '../types';
import { PPQ, beatsToTickPositions } from './time';
import { Key, Mode, keySignature, MODES, MODE_NAMES } from './theory';
import { MidiEvent, MidiTrack, keySignatureEvent, marker, note, programChange, tempo, textEvent, timeSignature, trackName, writeMidiFile } from './midiFile';

// General MIDI drum notes, in the drum machine's row order (doc.ts DRUM_VOICES).
export const GM_DRUMS = [36, 38, 45, 47, 50, 42, 46, 51, 49];
const DRUM_CHANNEL = 9;
const BASS_CHANNEL = 0;
const CHORD_CHANNEL = 1;
const GUIDE_CHANNEL = 2;

const NOTE_PCS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Parse the store's key string ("F# Minor", "Bb Dorian") into a Key.
export function parseKeyString(keyString: string): Key | null {
  const [note, modeName] = keyString.trim().split(/\s+/);
  if (!note || !(note[0] in NOTE_PCS)) return null;
  const mode = MODES.find(m => MODE_NAMES[m] === modeName) as Mode | undefined;
  if (!mode) return null;
  const acc = note[1] === '#' ? 1 : note[1] === 'b' ? -1 : 0;
  return { tonic: (NOTE_PCS[note[0]] + acc + 12) % 12, mode };
}

export interface ExportInput {
  songStructure: Part[];
  bpm: number;
  key: string;
  title?: string;
}

export function songToMidi({ songStructure, bpm, key, title }: ExportInput): Uint8Array {
  const conductor: MidiEvent[] = [trackName(title ?? `Song in ${key}`), tempo(0, bpm), timeSignature(0, 4, 4)];
  const parsedKey = parseKeyString(key);
  if (parsedKey) {
    const sf = keySignature(parsedKey);
    conductor.push(keySignatureEvent(0, sf, parsedKey.mode === 'minor'));
  }
  const drums: MidiEvent[] = [trackName('Drums')];
  const bass: MidiEvent[] = [trackName('Bass'), programChange(0, BASS_CHANNEL, 33)];
  const chords: MidiEvent[] = [trackName('Chords'), programChange(0, CHORD_CHANNEL, 0)];
  const guide: MidiEvent[] = [trackName('Guide Tones'), programChange(0, GUIDE_CHANNEL, 73)];

  let partStart = 0;
  let lastTranspose = 0;
  songStructure.forEach(part => {
    conductor.push(marker(partStart, `${part.type} ${part.repeat}`));
    // A key lift (e.g. the final chorus up a step) gets its own signature.
    const transpose = part.transpose ?? 0;
    if (transpose !== lastTranspose && parsedKey) {
      const lifted = { tonic: (parsedKey.tonic + transpose) % 12, mode: parsedKey.mode };
      conductor.push(keySignatureEvent(partStart, keySignature(lifted), lifted.mode === 'minor'));
      lastTranspose = transpose;
    }

    const stepPos = beatsToTickPositions(part.drumGroove, partStart);
    part.drums.forEach((row, voice) => {
      row.forEach((cell, step) => {
        if (!cell.checked || stepPos[step] === undefined) return;
        drums.push(...note(DRUM_CHANNEL, GM_DRUMS[voice], stepPos[step], Math.max(30, (stepPos[step + 1] - stepPos[step]) / 2), cell.accent ? 112 : 88));
      });
    });

    const bassPos = beatsToTickPositions(part.bassGroove, partStart);
    part.bassNoteLocations.forEach((loc, k) => {
      if (loc.midi <= 0 || bassPos[k + 1] === undefined) return;
      const length = bassPos[k + 1] - bassPos[k];
      bass.push(...note(BASS_CHANNEL, loc.midi, bassPos[k], Math.round(length * 0.92), (bassPos[k] - partStart) % PPQ === 0 ? 100 : 86));
    });

    const chordPos = beatsToTickPositions(part.chordsGroove, partStart);
    part.chordTones.midiTones.forEach((tones, c) => {
      if (chordPos[c + 1] === undefined) return;
      const symbol = part.chords[c];
      if (symbol && symbol !== '-') chords.push(textEvent(chordPos[c], part.roman?.[c] ? `${symbol} (${part.roman[c]})` : symbol));
      tones.forEach(t => chords.push(...note(CHORD_CHANNEL, t, chordPos[c], chordPos[c + 1] - chordPos[c], 76)));
      const g = part.guideTones?.[c];
      if (g) guide.push(...note(GUIDE_CHANNEL, g, chordPos[c], chordPos[c + 1] - chordPos[c], 70));
    });

    partStart = stepPos[stepPos.length - 1];
  });
  conductor.push(marker(partStart, 'End'));

  const tracks: MidiTrack[] = [{ events: conductor }, { events: drums }, { events: bass }, { events: chords }];
  if (guide.length > 2) tracks.push({ events: guide });
  return writeMidiFile(tracks, PPQ);
}

export function downloadMidi(input: ExportInput, filename: string): void {
  const bytes = songToMidi(input);
  const blob = new Blob([bytes], { type: 'audio/midi' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.mid') ? filename : `${filename}.mid`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
