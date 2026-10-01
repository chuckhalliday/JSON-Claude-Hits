//import midi from 'midi'
import playBeat from './playDrums.js';
import playChords from './playChords.js';
import playBass from './playBass.js';
import { SongState } from '../reducers.js';
import { DrumHit, NoteLocation, ChordTones } from '../types';
import { ensureAudioRunning } from './audioContext';
import { resolveStart, SequenceTiming } from './scheduler';

// How early a part hands off to the next one during song playback: enough
// time to render the next part and schedule all of its notes before the
// current one runs out, so parts join with no gap.
const PART_LOOKAHEAD = 0.5;

export async function countIn(bpm: number, midi: boolean, beat: number, initDrums: number[],
  stepsRef: DrumHit[][]) {
  for (let i = 0; i < 1; i++) {
    await Promise.all([
    playBeat(midi, beat, stepsRef[2], initDrums, bpm, stepsRef),
  ])
  }
}

// Where each track stops, exclusive (a loop's end bar); omitted = part end.
export interface TrackEnds {
  drum?: number;
  bass?: number;
  chord?: number;
}

export interface VersePlaybackResult {
  drumBeat: number;
  bassBeat: number;
  chordBeat: number;
  // Audio-clock time this part ends; pass it as the next part's startAt.
  endTime: number;
}

export async function playVerse(bpm: number, midi: boolean, drumBeat: number, bassBeat: number, chordBeat: number, verseDrumGroove: number[], verseDrums: DrumHit[][],
  verseBassGroove: number[], verseBass: NoteLocation[], verseChordGroove: number[], verseChords: string[], verseChordTones: ChordTones, onStep: (lampIndex: number) => void, shouldStop?: () => boolean,
  includeDrums = true, includeBass = true, includeChords = true, acoustic = true, key?: string, startAt?: number, ends: TrackEnds = {}): Promise<VersePlaybackResult> {
  // One start time for every track of the part (the previous part's end
  // when chaining), and each track resolves PART_LOOKAHEAD early.
  const audioContext = await ensureAudioRunning();
  const start = resolveStart(audioContext, startAt);
  const timings: SequenceTiming[] = [];
  const timing = () => {
    const t: SequenceTiming = { startAt: start, lookahead: PART_LOOKAHEAD };
    timings.push(t);
    return t;
  };
  // Every drum row is scheduled (the synthesized voices cover toms and ride
  // too); only the first carries the lamp-stepping callback.
  const results = await Promise.all([
    ...verseDrums.map((pattern, voice) =>
      playBeat(midi, drumBeat, pattern, verseDrumGroove, bpm, verseDrums, voice === 0 ? onStep : undefined, shouldStop, !includeDrums, acoustic, key, timing(), ends.drum)),
    // Bass and chord onsets always fall on drum steps, so the drums' step
    // callback already lights every lamp; passing it to these too only
    // tripled the per-step dispatches and re-renders.
    playBass(midi, bassBeat, verseBass, verseBassGroove, bpm, shouldStop, undefined, verseDrumGroove, !includeBass, acoustic, timing(), ends.bass),
    playChords(midi, chordBeat, verseChords, verseChordTones, verseChordGroove, bpm, shouldStop, undefined, verseDrumGroove, !includeChords, acoustic, timing(), ends.chord)
  ])
  const endTime = Math.max(start, ...timings.map(t => t.endTime ?? start));
  return { drumBeat: results[0], bassBeat: results[verseDrums.length], chordBeat: results[verseDrums.length + 1], endTime }
}

export async function playDrums(bpm: number, midi: boolean, beat: number, partDrumGroove: number[], partDrums: DrumHit[][], onStep: (lampIndex: number) => void, shouldStop?: () => boolean, acoustic = true, key?: string): Promise<number> {
  const ends = await Promise.all(
    partDrums.map((pattern, voice) =>
      playBeat(midi, beat, pattern, partDrumGroove, bpm, partDrums, voice === 0 ? onStep : undefined, shouldStop, undefined, acoustic, key)),
  )
  return ends[0]
}
