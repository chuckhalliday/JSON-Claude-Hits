import { configureStore } from '@reduxjs/toolkit';
import { trackWindow, partWindow, regionFromSpans, beatsInPart, barAtStep, barSpan, stepSpan, clampRegion, containsPoint, overlapsRegion, describePoint, partBars } from './loop';
import song, { setLoopPick, pickLoopSpan, setLoop, extendLoop, SongState } from '../reducers';
import { createRandomSong } from '../SongStructure/createSong';
import { generateDoc } from '../Core/generate';
import { realizeSong } from '../Core/realize';

const total = (g: number[]) => g.reduce((a, b) => a + b, 0);

describe('loop windows', () => {
  it('cuts a track to a window, trimming notes that cross its edges', () => {
    const groove = [2, 3, 1, 2];
    const w = trackWindow(groove, 4, 8);
    expect([w.start, w.end]).toEqual([1, 4]);
    expect(w.groove.slice(w.start, w.end)).toEqual([1, 1, 2]);
    const first = trackWindow(groove, 0, 4);
    expect([first.start, first.end]).toEqual([0, 2]);
    expect(first.groove.slice(0, 2)).toEqual([2, 2]);
    // A window starting mid-bar, on a step.
    const mid = trackWindow([0.5, 0.5, 0.5, 0.5, 2], 1, 3);
    expect([mid.start, mid.end]).toEqual([2, 5]);
    expect(mid.groove.slice(2, 5)).toEqual([0.5, 0.5, 1]);
  });

  it('keeps rounded triplet steps whole', () => {
    const steps = [0.5, 0.16, 0.17, 0.17, 1, 2, 0.5, 0.5, 1, 2];
    const w = trackWindow(steps, 4, 8);
    expect(w.start).toBe(6);
    expect(w.groove.slice(w.start, w.end)).toEqual([0.5, 0.5, 1, 2]);
  });

  it('builds regions from clicked bars and steps in either order', () => {
    const drum = [0.5, 0.5, 1, 2, 0.5, 0.16, 0.17, 0.17, 1, 2];
    expect(stepSpan(2, drum, 5)).toEqual({ part: 2, from: 4.5, to: 4.66 });
    expect(barSpan(1, 2)).toEqual({ part: 1, from: 8, to: 12 });
    const region = regionFromSpans(stepSpan(3, drum, 1), barSpan(1, 6));
    expect(region).toEqual({ start: { part: 1, beat: 24 }, end: { part: 3, beat: 1 } });
    expect(beatsInPart(region, 0, 32)).toBeNull();
    expect(beatsInPart(region, 1, 32)).toEqual([24, 32]);
    expect(beatsInPart(region, 2, 16)).toEqual([0, 16]);
    expect(beatsInPart(region, 3, 32)).toEqual([0, 1]);
    expect(containsPoint(region, { part: 3, beat: 0.5 })).toBe(true);
    expect(containsPoint(region, { part: 3, beat: 1 })).toBe(false); // end is exclusive
    expect(overlapsRegion(region, 3, 32, 0.5, 1)).toBe(true);
    expect(overlapsRegion(region, 3, 32, 1, 1.5)).toBe(false);
  });

  it('maps steps to bars', () => {
    const drum = [0.5, 0.5, 1, 2, 0.5, 0.16, 0.17, 0.17, 1, 2];
    expect(barAtStep(drum, 3)).toBe(0);
    expect(barAtStep(drum, 4)).toBe(1);
    expect(barAtStep(drum, 7)).toBe(1);
  });

  it('describes positions as bar.beat', () => {
    const parts = [{ type: 'Verse', repeat: 2 }];
    expect(describePoint({ part: 0, beat: 8 }, parts)).toBe('Verse 2 · 3.1');
    expect(describePoint({ part: 0, beat: 9.5 }, parts)).toBe('Verse 2 · 3.2½');
    expect(describePoint({ part: 0, beat: 8.66 }, parts)).toBe('Verse 2 · 3.1⅔');
    expect(describePoint({ part: 0, beat: 8.33 }, parts)).toBe('Verse 2 · 3.1⅓');
  });

  it('drops or trims a loop that no longer fits the song, or has an old shape', () => {
    const parts = [{ drumGroove: new Array(32).fill(0.5) }, { drumGroove: new Array(16).fill(0.5) }];
    expect(clampRegion({ start: { part: 0, beat: 8 }, end: { part: 1, beat: 40 } }, parts)).toEqual({ start: { part: 0, beat: 8 }, end: { part: 1, beat: 8 } });
    expect(clampRegion({ start: { part: 5, beat: 0 }, end: { part: 6, beat: 0 } }, parts)).toBeNull();
    expect(clampRegion({ start: { part: 0, bar: 1 }, end: { part: 0, bar: 2 } } as any, parts)).toBeNull();
    expect(clampRegion(null, parts)).toBeNull();
  });

  const songs = [
    ['sculpted', realizeSong(generateDoc({ seed: 12, formId: 'pop', triplet: 1 }))],
    ['classic', createRandomSong(5).songStructure],
  ] as const;
  it.each(songs)('%s: windows line up on every bar', (_, parts) => {
    parts.forEach((part, p) => {
      const bars = partBars(part);
      for (let bar = 0; bar < bars; bar++) {
        const span = barSpan(p, bar);
        const w = partWindow({ start: { part: p, beat: span.from }, end: { part: p, beat: span.to } }, p, part);
        expect(w.toBeat - w.fromBeat).toBeCloseTo(4, 1);
        for (const track of [w.drum, w.bass, w.chord]) {
          expect(Math.abs(total(track.groove.slice(track.start, track.end)) - 4)).toBeLessThan(0.05);
        }
      }
      const whole = partWindow(null, p, part);
      expect([whole.drum.start, whole.drum.end]).toEqual([0, part.drumGroove.length]);
    });
  });
});

describe('Set Start / Set End picking', () => {
  const makeStore = () => configureStore({ reducer: { song: song.reducer }, middleware: d => d({ serializableCheck: false, immutableCheck: false }) });
  const loopOf = (store: ReturnType<typeof makeStore>) => {
    const s: SongState = store.getState().song;
    return { loop: s.loop, pick: s.loopPick, on: s.loopEnabled };
  };

  it('Set Start, click, then the end is armed and the next click sets it', () => {
    const store = makeStore();
    store.dispatch(setLoopPick('start'));
    store.dispatch(pickLoopSpan({ part: 1, from: 4.5, to: 5 })); // a step
    expect(loopOf(store).pick).toBe('end');
    expect(loopOf(store).loop).toEqual({ start: { part: 1, beat: 4.5 }, end: { part: 1, beat: 5 } });
    store.dispatch(pickLoopSpan({ part: 2, from: 8, to: 12 })); // a bar, later
    expect(loopOf(store)).toEqual({ loop: { start: { part: 1, beat: 4.5 }, end: { part: 2, beat: 12 } }, pick: null, on: true });
  });

  it('an end clicked before the start still makes a forward loop', () => {
    const store = makeStore();
    store.dispatch(setLoopPick('start'));
    store.dispatch(pickLoopSpan({ part: 2, from: 4, to: 8 }));
    store.dispatch(pickLoopSpan({ part: 1, from: 30, to: 30.5 }));
    expect(loopOf(store).loop).toEqual({ start: { part: 1, beat: 30 }, end: { part: 2, beat: 8 } });
  });

  it('Set End alone moves only the end; Set Start keeps a later end', () => {
    const store = makeStore();
    store.dispatch(setLoop({ start: { part: 0, beat: 4 }, end: { part: 0, beat: 12 } }));
    store.dispatch(setLoopPick('end'));
    store.dispatch(pickLoopSpan({ part: 0, from: 20, to: 24 }));
    expect(loopOf(store).loop).toEqual({ start: { part: 0, beat: 4 }, end: { part: 0, beat: 24 } });
    store.dispatch(setLoopPick('start'));
    store.dispatch(pickLoopSpan({ part: 0, from: 8, to: 8.5 }));
    expect(loopOf(store).loop).toEqual({ start: { part: 0, beat: 8 }, end: { part: 0, beat: 24 } });
    expect(loopOf(store).pick).toBe('end');
    store.dispatch(setLoopPick(null));
    expect(loopOf(store).pick).toBeNull();
  });

  it('shift-click extends over bars or steps', () => {
    const store = makeStore();
    store.dispatch(setLoop({ start: { part: 1, beat: 4 }, end: { part: 1, beat: 8 } }));
    store.dispatch(extendLoop({ part: 0, from: 30, to: 30.5 }));
    expect(loopOf(store).loop).toEqual({ start: { part: 0, beat: 30 }, end: { part: 1, beat: 8 } });
  });
});
