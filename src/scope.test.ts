import { configureStore } from '@reduxjs/toolkit';
import song, { newSong, setDrumState, setBassState, editHarmony, rerollLayer, toggleLock, setPartLinked, SongState } from './reducers';
import { isDetached, linkedCount } from './Core/generate';

const makeStore = () => configureStore({ reducer: { song: song.reducer }, middleware: d => d({ serializableCheck: false, immutableCheck: false }) });
const st = (store: ReturnType<typeof makeStore>): SongState => store.getState().song;

describe('per-part linking', () => {
  const setup = () => {
    const store = makeStore();
    store.dispatch(newSong({ seed: 77, formId: 'verse-chorus', tonic: 0, mode: 'major' }) as any);
    const verses = st(store).songStructure.map((p, i) => (p.sectionId === 'verse' ? i : -1)).filter(i => i >= 0);
    return { store, verses };
  };
  const snapshot = (store: ReturnType<typeof makeStore>) => st(store).songStructure.map(p => JSON.stringify([p.drums, p.bassNoteLocations, p.chords, p.chordTones]));
  const chord0 = (store: ReturnType<typeof makeStore>, i: number) => st(store).songStructure[i].chords[0];

  it('parts start linked: an edit changes every part of the section', () => {
    const { store, verses } = setup();
    expect(verses.length).toBeGreaterThan(2);
    verses.forEach(i => expect(isDetached(st(store).doc!, i)).toBe(false));
    expect(linkedCount(st(store).doc!, verses[0])).toBe(verses.length);
    store.dispatch(editHarmony({ part: verses[0], chord: 0, change: { root: 5, quality: 'maj' } }));
    verses.forEach(i => expect(chord0(store, i)).toBe('F'));
  });

  it('"This part only" detaches just that part; the rest stay linked to each other', () => {
    const { store, verses } = setup();
    const [a, b, c] = verses;
    const before = snapshot(store);
    store.dispatch(setPartLinked({ part: b, linked: false }));
    // Detaching alone changes nothing audible.
    expect(snapshot(store)).toEqual(before);
    expect(isDetached(st(store).doc!, b)).toBe(true);
    verses.filter(i => i !== b).forEach(i => expect(isDetached(st(store).doc!, i)).toBe(false));

    // Every kind of edit on the detached part stays on it.
    const was = st(store).songStructure[b].drums[1][2].checked;
    store.dispatch(setDrumState({ index: b, drumPart: 1, drumStep: 2, drums: { index: 2, checked: !was } }));
    const locs = st(store).songStructure[b].bassNoteLocations.map(l => ({ ...l }));
    const k = locs.findIndex(l => l.midi > 0);
    locs[k] = { ...locs[k], y: 60, acc: 'sharp' };
    store.dispatch(setBassState({ index: b, bassNoteLocations: locs }));
    store.dispatch(editHarmony({ part: b, chord: 0, change: { root: 9, quality: 'min' } }));
    store.dispatch(rerollLayer({ sectionId: st(store).songStructure[b].sectionId!, layer: 'drums', part: b }));
    store.dispatch(toggleLock({ sectionId: st(store).songStructure[b].sectionId!, layer: 'voicing', part: b }));
    const after = snapshot(store);
    after.forEach((p, i) => (i === b ? expect(p).not.toBe(before[i]) : expect(p).toBe(before[i])));
    expect(st(store).doc!.sections.verse.locks.voicing).toBe(false);

    // The other verses are still linked: editing one changes the others,
    // but not the detached part.
    store.dispatch(editHarmony({ part: c, chord: 0, change: { root: 5, quality: 'maj' } }));
    expect(chord0(store, a)).toBe('F');
    expect(chord0(store, c)).toBe('F');
    expect(chord0(store, b)).toBe('Am');
  });

  it('"All linked" re-links the part and brings every linked part to its state', () => {
    const { store, verses } = setup();
    const [a, b] = verses;
    store.dispatch(setPartLinked({ part: b, linked: false }));
    store.dispatch(editHarmony({ part: b, chord: 0, change: { root: 9, quality: 'min' } }));
    const was = st(store).songStructure[b].drums[1][3].checked;
    store.dispatch(setDrumState({ index: b, drumPart: 1, drumStep: 3, drums: { index: 3, checked: !was } }));
    const state = (i: number) => JSON.stringify([st(store).songStructure[i].chords, st(store).songStructure[i].bassNoteLocations, st(store).songStructure[i].chordTones]);
    const detachedState = state(b);

    store.dispatch(setPartLinked({ part: b, linked: true }));
    expect(isDetached(st(store).doc!, b)).toBe(false);
    expect(st(store).songStructure[b].sectionId).toBe('verse');
    expect(Object.keys(st(store).doc!.sections).filter(id => id.startsWith('verse~'))).toEqual([]);
    verses.forEach(i => {
      expect(state(i)).toBe(detachedState);
      expect(st(store).songStructure[i].drums[1][3].checked).toBe(!was);
    });
    // And they move together again.
    store.dispatch(editHarmony({ part: a, chord: 0, change: { root: 2, quality: 'min' } }));
    verses.forEach(i => expect(chord0(store, i)).toBe('Dm'));
  });

  it('keeps fills and crashes when a part is detached', () => {
    const { store, verses } = setup();
    const edges = () => st(store).songStructure.map(p => JSON.stringify([p.drums[8][0], p.drums.map(r => r[r.length - 1])]));
    const before = edges();
    store.dispatch(setPartLinked({ part: verses[0], linked: false }));
    store.dispatch(toggleLock({ sectionId: st(store).songStructure[verses[0]].sectionId!, layer: 'bass', part: verses[0] }));
    expect(edges()).toEqual(before);
  });

  it('a section played once only remembers the choice', () => {
    const { store } = setup();
    const bridge = st(store).songStructure.findIndex(p => p.sectionId === 'bridge');
    store.dispatch(setPartLinked({ part: bridge, linked: false }));
    expect(isDetached(st(store).doc!, bridge)).toBe(true);
    expect(st(store).songStructure[bridge].sectionId).toBe('bridge');
    store.dispatch(setPartLinked({ part: bridge, linked: true }));
    expect(isDetached(st(store).doc!, bridge)).toBe(false);
  });
});
