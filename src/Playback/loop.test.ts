import { trackWindow, partWindow, regionBetween, barsInPart, barAtStep, barStartSteps, clampRegion, containsPoint, partBars } from './loop';
import { createRandomSong } from '../SongStructure/createSong';
import { generateDoc } from '../Core/generate';
import { realizeSong } from '../Core/realize';

const total = (g: number[]) => g.reduce((a, b) => a + b, 0);

describe('loop windows', () => {
  it('cuts a track to a bar window, trimming notes that cross its edges', () => {
    // A 2-bar track whose second note (3 beats) crosses the bar line.
    const groove = [2, 3, 1, 2];
    const w = trackWindow(groove, 4, 8);
    expect(w.start).toBe(1);
    expect(w.end).toBe(4);
    expect(w.groove.slice(w.start, w.end)).toEqual([1, 1, 2]); // 3-beat note enters with 1 beat left
    const first = trackWindow(groove, 0, 4);
    expect([first.start, first.end]).toEqual([0, 2]);
    expect(first.groove.slice(0, 2)).toEqual([2, 2]); // cut at the bar line
  });

  it('keeps rounded triplet steps whole', () => {
    const steps = [0.5, 0.16, 0.17, 0.17, 1, 2, 0.5, 0.5, 1, 2];
    const w = trackWindow(steps, 4, 8);
    expect(w.start).toBe(6);
    expect(w.groove.slice(w.start, w.end)).toEqual([0.5, 0.5, 1, 2]);
  });

  it('orders points and finds the bars a region covers in each part', () => {
    const region = regionBetween({ part: 3, bar: 1 }, { part: 1, bar: 6 });
    expect(region).toEqual({ start: { part: 1, bar: 6 }, end: { part: 3, bar: 1 } });
    expect(barsInPart(region, 0, 8)).toBeNull();
    expect(barsInPart(region, 1, 8)).toEqual([6, 7]);
    expect(barsInPart(region, 2, 4)).toEqual([0, 3]);
    expect(barsInPart(region, 3, 8)).toEqual([0, 1]);
    expect(containsPoint(region, { part: 2, bar: 0 })).toBe(true);
    expect(containsPoint(region, { part: 3, bar: 2 })).toBe(false);
  });

  it('maps steps to bars and back', () => {
    const drum = [0.5, 0.5, 1, 2, 0.5, 0.16, 0.17, 0.17, 1, 2];
    expect(barStartSteps(drum)).toEqual([0, 4]);
    expect(barAtStep(drum, 3)).toBe(0);
    expect(barAtStep(drum, 4)).toBe(1);
    expect(barAtStep(drum, 7)).toBe(1);
  });

  it('drops or trims a loop that no longer fits the song', () => {
    const parts = [{ drumGroove: new Array(32).fill(0.5) }, { drumGroove: new Array(16).fill(0.5) }];
    expect(clampRegion({ start: { part: 0, bar: 2 }, end: { part: 1, bar: 9 } }, parts)).toEqual({ start: { part: 0, bar: 2 }, end: { part: 1, bar: 1 } });
    expect(clampRegion({ start: { part: 5, bar: 0 }, end: { part: 6, bar: 0 } }, parts)).toBeNull();
    expect(clampRegion(null, parts)).toBeNull();
  });

  // Every bar of every part, for both engines: all three tracks cut to the
  // same span, which is exactly the bars looped.
  const songs = [
    ['sculpted', realizeSong(generateDoc({ seed: 12, formId: 'pop', triplet: 1 }))],
    ['classic', createRandomSong(5).songStructure],
  ] as const;
  it.each(songs)('%s: windows line up on every bar', (_, parts) => {
    parts.forEach((part, p) => {
      const bars = partBars(part);
      expect(Math.abs(total(part.drumGroove) - bars * 4)).toBeLessThan(0.05);
      for (let bar = 0; bar < bars; bar++) {
        const w = partWindow({ start: { part: p, bar }, end: { part: p, bar } }, p, part);
        expect(w.toBeat - w.fromBeat).toBe(4);
        for (const track of [w.drum, w.bass, w.chord]) {
          expect(Math.abs(total(track.groove.slice(track.start, track.end)) - 4)).toBeLessThan(0.05);
        }
      }
      const whole = partWindow(null, p, part);
      expect([whole.drum.start, whole.drum.end]).toEqual([0, part.drumGroove.length]);
      expect(whole.drum.groove).toEqual(part.drumGroove);
    });
  });
});
