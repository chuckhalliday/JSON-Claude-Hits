// Loop region arithmetic: which bars a loop covers and how each track of a
// part is cut to play just that window.
//
// Loop points are bars - a part index plus a bar within it - so a loop always
// starts and ends on a bar line, like DAW locators snapped to bars. The end
// bar is inclusive.

import { Groove, Part } from '../types';

export interface LoopPoint {
  part: number;
  bar: number;
}

export interface LoopRegion {
  start: LoopPoint;
  end: LoopPoint;
}

const BEATS_PER_BAR = 4;
// Legacy beat values carry rounded triplets (0.16/0.17), so positions are
// compared with a little slack.
const EPS = 0.02;

export const comparePoints = (a: LoopPoint, b: LoopPoint) => a.part - b.part || a.bar - b.bar;

// The region spanning two points, in playing order.
export const regionBetween = (a: LoopPoint, b: LoopPoint): LoopRegion =>
  comparePoints(a, b) <= 0 ? { start: a, end: b } : { start: b, end: a };

export const sum = (groove: Groove) => groove.reduce((total, d) => total + d, 0);

export const partBars = (part: Pick<Part, 'drumGroove'>) => Math.max(1, Math.round(sum(part.drumGroove) / BEATS_PER_BAR));

// Bar a drum step falls in.
export function barAtStep(drumGroove: Groove, step: number): number {
  let beats = 0;
  for (let i = 0; i < step && i < drumGroove.length; i++) beats += drumGroove[i];
  return Math.floor((beats + EPS) / BEATS_PER_BAR);
}

// Bar index of the first step of each bar: barStarts[bar] = step.
export function barStartSteps(drumGroove: Groove): number[] {
  const starts: number[] = [];
  let beats = 0;
  drumGroove.forEach((d, i) => {
    if (Math.abs(beats / BEATS_PER_BAR - Math.round(beats / BEATS_PER_BAR)) * BEATS_PER_BAR < EPS) {
      const bar = Math.round(beats / BEATS_PER_BAR);
      if (starts[bar] === undefined) starts[bar] = i;
    }
    beats += d;
  });
  return starts;
}

export const containsPoint = (region: LoopRegion, point: LoopPoint) =>
  comparePoints(region.start, point) <= 0 && comparePoints(point, region.end) <= 0;

// Bars of `part` the region covers (inclusive), or null if none.
export function barsInPart(region: LoopRegion, partIndex: number, bars: number): [number, number] | null {
  if (partIndex < region.start.part || partIndex > region.end.part) return null;
  const from = partIndex === region.start.part ? region.start.bar : 0;
  const to = partIndex === region.end.part ? region.end.bar : bars - 1;
  return from <= to ? [from, Math.min(to, bars - 1)] : null;
}

// Clamp a loop to the song as it is now (parts can shrink after a re-roll or
// a new song): null if it no longer fits.
export function clampRegion(region: LoopRegion | null | undefined, parts: Array<Pick<Part, 'drumGroove'>>): LoopRegion | null {
  if (!region || region.start.part >= parts.length) return null;
  const endPart = Math.min(region.end.part, parts.length - 1);
  const end = { part: endPart, bar: endPart === region.end.part ? Math.min(region.end.bar, partBars(parts[endPart]) - 1) : partBars(parts[endPart]) - 1 };
  const start = { part: region.start.part, bar: Math.min(region.start.bar, partBars(parts[region.start.part]) - 1) };
  return comparePoints(start, end) <= 0 ? { start, end } : null;
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
  const bars = region ? barsInPart(region, partIndex, partBars(part)) : null;
  const fromBeat = bars ? bars[0] * BEATS_PER_BAR : 0;
  // Snap to the bar line unless the part really ends short of it.
  const barEnd = bars ? (bars[1] + 1) * BEATS_PER_BAR : total;
  const toBeat = barEnd > total + EPS ? total : barEnd;
  return {
    fromBeat,
    toBeat,
    drum: trackWindow(part.drumGroove, fromBeat, toBeat),
    bass: trackWindow(part.bassGroove, fromBeat, toBeat),
    chord: trackWindow(part.chordsGroove, fromBeat, toBeat),
  };
}

export function describePoint(point: LoopPoint, parts: Array<Pick<Part, 'type' | 'repeat'>>): string {
  const part = parts[point.part];
  return part ? `${part.type} ${part.repeat}, bar ${point.bar + 1}` : '';
}
