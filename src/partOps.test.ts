import { configureStore } from '@reduxjs/toolkit';
import song, { newSong, duplicatePart, deletePart, editHarmony, setSong, setCurrentBeat, setLoop, SongState } from './reducers';
import { createRandomSong } from './SongStructure/createSong';

const makeStore = () => configureStore({ reducer: { song: song.reducer }, middleware: d => d({ serializableCheck: false, immutableCheck: false }) });
const st = (store: ReturnType<typeof makeStore>): SongState => store.getState().song;
const labels = (store: ReturnType<typeof makeStore>) => st(store).songStructure.map(p => `${p.type[0]}${p.repeat}`).join(' ');
const contiguous = (store: ReturnType<typeof makeStore>) => {
  let next = 0;
  st(store).songStructure.forEach(p => p.stepIds.forEach(id => expect(id).toBe(next++)));
};

describe('duplicate and delete parts', () => {
  const setup = () => {
    const store = makeStore();
    store.dispatch(newSong({ seed: 77, formId: 'verse-chorus', tonic: 0, mode: 'major' }) as any);
    return store;
  };

  it('duplicates a part into the next slot, linked to the original', () => {
    const store = setup();
    const n = st(store).songStructure.length;
    const v = st(store).songStructure.findIndex(p => p.type === 'Verse');
    store.dispatch(duplicatePart(v));
    const parts = st(store).songStructure;
    expect(parts.length).toBe(n + 1);
    expect(parts[v + 1].sectionId).toBe(parts[v].sectionId);
    expect(JSON.stringify(parts[v + 1].chords)).toBe(JSON.stringify(parts[v].chords));
    expect(st(store).doc!.form.length).toBe(n + 1);
    contiguous(store);
    // Repeats renumber in order.
    expect(parts.filter(p => p.type === 'Verse').map(p => p.repeat)).toEqual(parts.filter(p => p.type === 'Verse').map((_, i) => i + 1));
    // Linked: editing the copy changes the original too.
    store.dispatch(editHarmony({ part: v + 1, chord: 0, change: { root: 5, quality: 'maj' } }));
    expect(st(store).songStructure[v].chords[0]).toBe('F');
  });

  it('deletes a part and drops a section nothing plays', () => {
    const store = setup();
    const before = labels(store);
    const bridge = st(store).songStructure.findIndex(p => p.type === 'Bridge');
    store.dispatch(deletePart(bridge));
    expect(st(store).songStructure.some(p => p.type === 'Bridge')).toBe(false);
    expect(st(store).doc!.sections.bridge).toBeUndefined();
    expect(st(store).songStructure.length).toBe(before.split(' ').length - 1);
    contiguous(store);
  });

  it('keeps the playhead on its part and clears the loop', () => {
    const store = setup();
    store.dispatch(setCurrentBeat([4, 3, 1, 1]));
    store.dispatch(setLoop({ start: { part: 1, beat: 0 }, end: { part: 2, beat: 4 } }));
    store.dispatch(duplicatePart(1));
    expect(st(store).selectedBeat).toEqual([5, 3, 1, 1]);
    expect(st(store).loop).toBeNull();
    store.dispatch(deletePart(5));
    expect(st(store).selectedBeat[0]).toBe(5);
    store.dispatch(deletePart(0));
    expect(st(store).selectedBeat[0]).toBe(4);
  });

  it('never deletes the last part', () => {
    const store = setup();
    while (st(store).songStructure.length > 1) store.dispatch(deletePart(0));
    store.dispatch(deletePart(0));
    expect(st(store).songStructure.length).toBe(1);
  });

  it('works for classic songs', () => {
    const store = makeStore();
    const { songStructure, key, bpm, seed, params } = createRandomSong(5);
    store.dispatch(setSong({ songStructure, key, bpm, seed, params }));
    const n = songStructure.length;
    store.dispatch(duplicatePart(0));
    expect(st(store).songStructure.length).toBe(n + 1);
    expect(st(store).songStructure[1].type).toBe(st(store).songStructure[0].type);
    contiguous(store);
    store.dispatch(deletePart(0));
    expect(st(store).songStructure.length).toBe(n);
    contiguous(store);
  });
});
