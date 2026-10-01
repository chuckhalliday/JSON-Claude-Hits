import { configureStore } from '@reduxjs/toolkit';
import { songReducer, newSong, undo, editHarmony, deletePart, duplicatePart, setDrumState, setCurrentBeat, rerollLayer, SongState } from './reducers';

const makeStore = () => configureStore({ reducer: { song: songReducer }, middleware: d => d({ serializableCheck: false, immutableCheck: false }) });
const st = (store: ReturnType<typeof makeStore>): SongState => store.getState().song;

describe('undo', () => {
  const setup = () => {
    const store = makeStore();
    store.dispatch(newSong({ seed: 77, formId: 'verse-chorus', tonic: 0, mode: 'major' }) as any);
    return store;
  };

  it('has nothing to undo after the first song loads', () => {
    const store = setup();
    expect(st(store).past ?? []).toEqual([]);
  });

  it('undoes edits and structure changes in reverse order', () => {
    const store = setup();
    const original = st(store).songStructure;
    const v = original.findIndex(p => p.type === 'Verse');
    store.dispatch(editHarmony({ part: v, chord: 0, change: { root: 5, quality: 'maj' } }));
    const afterChord = st(store).songStructure;
    store.dispatch(deletePart(0));
    store.dispatch(duplicatePart(0));
    expect(st(store).past!.map(p => p.label)).toEqual(['chord change', 'delete', 'duplicate']);

    store.dispatch(undo());
    store.dispatch(undo());
    expect(st(store).songStructure).toBe(afterChord);
    store.dispatch(undo());
    expect(st(store).songStructure).toBe(original);
    expect(st(store).songStructure[v].chords[0]).not.toBe('F');
    expect(st(store).past).toEqual([]);
    // Nothing more to undo: a no-op.
    store.dispatch(undo());
    expect(st(store).songStructure).toBe(original);
  });

  it('restores the song document, so later edits build on the undone state', () => {
    const store = setup();
    const v = st(store).songStructure.findIndex(p => p.type === 'Verse');
    const doc = st(store).doc;
    store.dispatch(rerollLayer({ sectionId: 'verse', layer: 'harmony', part: v }));
    store.dispatch(undo());
    expect(st(store).doc).toBe(doc);
    const was = st(store).songStructure[v].drums[1][2].checked;
    store.dispatch(setDrumState({ index: v, drumPart: 1, drumStep: 2, drums: { index: 2, checked: !was } }));
    expect(st(store).songStructure[v].chords).toEqual(st(store).past![0].songStructure[v].chords);
  });

  it('ignores playback and no-op actions', () => {
    const store = setup();
    store.dispatch(setCurrentBeat([1, 2, 0, 0]));
    store.dispatch(editHarmony({ part: 999, chord: 0, change: { root: 2 } }));
    expect(st(store).past ?? []).toEqual([]);
  });

  it('undoes generating a new song', () => {
    const store = setup();
    const first = st(store).songStructure;
    store.dispatch(newSong({ seed: 78 }) as any);
    expect(st(store).past!.map(p => p.label)).toEqual(['new song']);
    store.dispatch(undo());
    expect(st(store).songStructure).toBe(first);
    expect(st(store).key).toBe('C Major');
  });

  it('keeps at most 50 steps', () => {
    const store = setup();
    for (let i = 0; i < 52; i++) store.dispatch(duplicatePart(0));
    expect(st(store).past!.length).toBe(50);
  });
});
