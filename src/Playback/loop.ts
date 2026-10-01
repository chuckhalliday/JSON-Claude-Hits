// Loop region arithmetic: where a loop starts and ends, and how each track of
// a part is cut to play just that window.
//
// A loop point is a part plus a beat within it. Points come from what the
// user clicks - a bar number (its whole bar) or a step lamp (that step) - so
// the region runs from the start of the first item clicked to the end of
// the last: the start is inclusive, the end exclusive.

import { Groove, Part } from '../types';

export interface LoopPoint {
  part: number;
  beat: number;
}

export interface LoopRegion {
  start: LoopPoint;
  end: LoopPoint; // exclusive
}

// A clickable stretch of a part (one bar, or one step), in beats.
export interface LoopSpan {
  part: number;
  from: number;
  to: number;
}

const BEATS_PER_BAR = 4;
// Legacy beat values carry rounded triplets (0.16/0.17), so positions are
// compared with a little slack.
const EPS = 0.02;

export const comparePoints = (a: LoopPoint, b: LoopPoint) =>
  a.part - b.part || (Math.abs(a.beat - b.beat) < EPS ? 0 : a.beat - b.beat);

export const sum = (groove: Groove) => groove.reduce((total, d) => total + d, 0);

export const partBars = (part: Pick<Part, 'drumGroove'>) => Math.max(1, Math.round(sum(part.drumGroove) / BEATS_PER_BAR));

// Beat a drum step starts on.
export const stepBeat = (drumGroove: Groove, step: number) => sum(drumGroove.slice(0, step));

// Bar a drum step falls in.
export const barAtStep = (drumGroove: Groove, step: number) =>
  Math.floor((stepBeat(drumGroove, step) + EPS) / BEATS_PER_BAR);

export const barSpan = (part: number, bar: number): LoopSpan =>
  ({ part, from: bar * BEATS_PER_BAR, to: (bar + 1) * BEATS_PER_BAR });

export function stepSpan(part: number, drumGroove: Groove, step: number): LoopSpan {
  const from = stepBeat(drumGroove, step);
  return { part, from, to: from + (drumGroove[step] ?? 0) };
}

// The region covering two clicked spans, whichever order they came in.
export function regionFromSpans(a: LoopSpan, b: LoopSpan): LoopRegion {
  const first = comparePoints({ part: a.part, beat: a.from }, { part: b.part, beat: b.from }) <= 0 ? a : b;
  const last = first === a ? b : a;
  const lastEnd = comparePoints({ part: last.part, beat: last.to }, { part: first.part, beat: first.to }) >= 0 ? last : first;
  return { start: { part: first.part, beat: first.from }, end: { part: lastEnd.part, beat: lastEnd.to } };
}

export const containsPoint = (region: LoopRegion, point: LoopPoint) =>
  comparePoints(region.start, point) <= 0 && comparePoints(point, region.end) < 0;

// Beats [from, to) of `part` the region covers, or null if none.
export function beatsInPart(region: LoopRegion, partIndex: number, partBeats: number): [number, number] | null {
  if (partIndex < region.start.part || partIndex > region.end.part) return null;
  const from = partIndex === region.start.part ? region.start.beat : 0;
  const to = partIndex === region.end.part ? Math.min(region.end.beat, partBeats) : partBeats;
  return to - from > EPS ? [from, to] : null;
}

// Whether a stretch of a part [from, to) overlaps the region.
export function overlapsRegion(region: LoopRegion, partIndex: number, partBeats: number, from: number, to: number): boolean {
  const covered = beatsInPart(region, partIndex, partBeats);
  return !!covered && from < covered[1] - EPS && to > covered[0] + EPS;
}

const isPoint = (p: unknown): p is LoopPoint =>
  !!p && typeof (p as LoopPoint).part === 'number' && typeof (p as LoopPoint).beat === 'number';

// Clamp a loop to the song as it is now (parts can change after a re-roll
// or a new song, and old saves may hold another shape): null if it no
// longer fits.
export function clampRegion(region: LoopRegion | null | undefined, parts: Array<Pick<Part, 'drumGroove'>>): LoopRegion | null {
  if (!region || !isPoint(region.start) || !isPoint(region.end) || region.start.part >= parts.length) return null;
  const endPart = Math.min(region.end.part, parts.length - 1);
  const endBeats = sum(parts[endPart].drumGroove);
  const end = { part: endPart, beat: endPart === region.end.part ? Math.min(region.end.beat, endBeats) : endBeats };
  const start = { part: region.start.part, beat: Math.max(0, Math.min(region.start.beat, sum(parts[region.start.part].drumGroove))) };
  return comparePoints(start, end) < 0 ? { start, end } : null;
}

export interface TrackWindow {
  start: number; // first note index to play
  end: number; // one past the last note index to play
  groove: Groove; // durations, with notes that cross the window edges cut to fit
}

// Cut one track (its note durations, in beats) to [fromBeat, toBeat). A note
// sounding across the window's start plays from the start for its remaining
// length; one running past the end is cut at the end.
export function trackWindow(groove: Groove, fromBeat: number, toBeat: number): TrackWindow {
  const cut = [...groove];
  let start = groove.length;
  let end = 0;
  let onset = 0;
  for (let i = 0; i < groove.length; i++) {
    const offset = onset + groove[i];
    if (offset > fromBeat + EPS && onset < toBeat - EPS) {
      if (start === groove.length) start = i;
      end = i + 1;
      const from = onset < fromBeat - EPS ? fromBeat : onset;
      const to = offset > toBeat + EPS ? toBeat : offset;
      if (from !== onset || to !== offset) cut[i] = to - from;
    }
    onset = offset;
  }
  if (start === groove.length) return { start: 0, end: 0, groove: cut };
  return { start, end, groove: cut };
}

export interface PartWindow {
  fromBeat: number;
  toBeat: number;
  drum: TrackWindow;
  bass: TrackWindow;
  chord: TrackWindow;
}

// The window of `part` a loop plays (all of it if the loop doesn't bound it).
export function partWindow(region: LoopRegion | null, partIndex: number, part: Pick<Part, 'drumGroove' | 'bassGroove' | 'chordsGroove'>): PartWindow {
  const total = sum(part.drumGroove);
  const covered = region ? beatsInPart(region, partIndex, total) : null;
  const fromBeat = covered ? covered[0] : 0;
  // Snap to the part's end when within rounding of it.
  const toBeat = covered && covered[1] < total - EPS ? covered[1] : total;
  return {
    fromBeat,
    toBeat,
    drum: trackWindow(part.drumGroove, fromBeat, toBeat),
    bass: trackWindow(part.bassGroove, fromBeat, toBeat),
    chord: trackWindow(part.chordsGroove, fromBeat, toBeat),
  };
}

// DAW-style position: "Verse 1 · 3.1" is bar 3, beat 1; "3.2½" an offbeat.
export function describePoint(point: LoopPoint, parts: Array<Pick<Part, 'type' | 'repeat'>>): string {
  const part = parts[point.part];
  if (!part) return '';
  const bar = Math.floor((point.beat + EPS) / BEATS_PER_BAR);
  const beatInBar = point.beat - bar * BEATS_PER_BAR + 1;
  const whole = Math.floor(beatInBar + EPS);
  const frac = beatInBar - whole;
  // Straight and triplet subdivisions as fractions of the beat.
  const fractions: Array<[number, string]> = [[1 / 6, '⅙'], [1 / 4, '¼'], [1 / 3, '⅓'], [1 / 2, '½'], [2 / 3, '⅔'], [3 / 4, '¾'], [5 / 6, '⅚']];
  const named = fractions.find(([f]) => Math.abs(frac - f) < EPS);
  const fracText = frac < EPS ? '' : named ? named[1] : `+${frac.toFixed(2).slice(1)}`;
  return `${part.type} ${part.repeat} · ${bar + 1}.${whole}${fracText}`;
}
