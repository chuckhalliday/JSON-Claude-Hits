// Minimal Standard MIDI File (format 1) writer.
//
// Enough of the spec for handing a song framework to a DAW: notes, program
// changes, tempo, time and key signature, track names, text, and markers.
// No dependency needed; the format is small.

export interface MidiEvent {
  tick: number;
  // Raw event bytes after the delta-time (status byte included).
  data: number[];
}

export interface MidiTrack {
  events: MidiEvent[];
}

const vlq = (n: number): number[] => {
  const bytes = [n & 0x7f];
  n >>>= 7;
  while (n > 0) {
    bytes.unshift((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  return bytes;
};

const text = (s: string) => Array.from(new TextEncoder().encode(s));

export const meta = (tick: number, type: number, payload: number[]): MidiEvent => ({
  tick, data: [0xff, type, ...vlq(payload.length), ...payload],
});

export const trackName = (name: string) => meta(0, 0x03, text(name));
export const textEvent = (tick: number, s: string) => meta(tick, 0x01, text(s));
export const marker = (tick: number, s: string) => meta(tick, 0x06, text(s));

export const tempo = (tick: number, bpm: number) => {
  const us = Math.round(60_000_000 / bpm);
  return meta(tick, 0x51, [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]);
};

export const timeSignature = (tick: number, num: number, den: number) =>
  meta(tick, 0x58, [num, Math.round(Math.log2(den)), 24, 8]);

// sf: -7..7 (negative = flats); minor: true for a minor key signature.
export const keySignatureEvent = (tick: number, sf: number, minor: boolean) =>
  meta(tick, 0x59, [sf & 0xff, minor ? 1 : 0]);

export const programChange = (tick: number, channel: number, program: number): MidiEvent => ({
  tick, data: [0xc0 | channel, program & 0x7f],
});

export function note(channel: number, pitch: number, start: number, duration: number, velocity: number): MidiEvent[] {
  return [
    { tick: start, data: [0x90 | channel, pitch & 0x7f, Math.max(1, Math.min(127, velocity))] },
    { tick: start + Math.max(1, duration), data: [0x80 | channel, pitch & 0x7f, 0] },
  ];
}

// Order within a tick: meta first, then note-offs, then everything else, so
// repeated notes re-trigger instead of being cut by their own note-off.
const rank = (e: MidiEvent) => (e.data[0] === 0xff ? 0 : (e.data[0] & 0xf0) === 0x80 ? 1 : 2);

function encodeTrack(track: MidiTrack): number[] {
  const events = [...track.events].sort((a, b) => a.tick - b.tick || rank(a) - rank(b));
  const bytes: number[] = [];
  let last = 0;
  for (const e of events) {
    bytes.push(...vlq(e.tick - last), ...e.data);
    last = e.tick;
  }
  bytes.push(0x00, 0xff, 0x2f, 0x00);
  return [0x4d, 0x54, 0x72, 0x6b, ...u32(bytes.length), ...bytes];
}

const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];

export function writeMidiFile(tracks: MidiTrack[], ppq: number): Uint8Array {
  const header = [0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(1), ...u16(tracks.length), ...u16(ppq)];
  const body = tracks.flatMap(encodeTrack);
  return new Uint8Array([...header, ...body]);
}

// ---- Reader (used by tests to check what was written) -------------------

export interface ParsedEvent {
  tick: number;
  status: number;
  data: number[];
  metaType?: number;
  text?: string;
}

export function readMidiFile(bytes: Uint8Array): { format: number; ppq: number; tracks: ParsedEvent[][] } {
  let p = 0;
  const readU32 = () => ((bytes[p++] << 24) | (bytes[p++] << 16) | (bytes[p++] << 8) | bytes[p++]) >>> 0;
  const readU16 = () => (bytes[p++] << 8) | bytes[p++];
  const readVlq = () => {
    let n = 0;
    let b;
    do {
      b = bytes[p++];
      n = (n << 7) | (b & 0x7f);
    } while (b & 0x80);
    return n;
  };
  const tag = () => String.fromCharCode(bytes[p++], bytes[p++], bytes[p++], bytes[p++]);

  if (tag() !== 'MThd') throw new Error('not a MIDI file');
  readU32();
  const format = readU16();
  const count = readU16();
  const ppq = readU16();
  const tracks: ParsedEvent[][] = [];
  for (let t = 0; t < count; t++) {
    if (tag() !== 'MTrk') throw new Error('bad track');
    const end = readU32() + p;
    const events: ParsedEvent[] = [];
    let tick = 0;
    while (p < end) {
      tick += readVlq();
      const status = bytes[p++];
      if (status === 0xff) {
        const metaType = bytes[p++];
        const len = readVlq();
        const data = Array.from(bytes.slice(p, p + len));
        p += len;
        events.push({ tick, status, metaType, data, text: new TextDecoder().decode(new Uint8Array(data)) });
      } else {
        const size = (status & 0xf0) === 0xc0 || (status & 0xf0) === 0xd0 ? 1 : 2;
        events.push({ tick, status, data: Array.from(bytes.slice(p, p + size)) });
        p += size;
      }
    }
    tracks.push(events);
  }
  return { format, ppq, tracks };
}
