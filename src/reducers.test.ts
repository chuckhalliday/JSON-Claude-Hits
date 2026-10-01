import { configureStore } from '@reduxjs/toolkit';
import song, { newSong, setDrumState, setBassState, setChordState, rerollLayer, toggleLock, setPartEnergy, reorderParts, setSong, SongState } from './reducers';
import { createRandomSong } from './SongStructure/createSong';

const makeStore = () => configureStore({ reducer: { song: song.reducer } });
const state = (store: ReturnType<typeof makeStore>): SongState => store.getState().song;

describe('song reducer with a sculpted document', () => {
  const setup = () => {
    const store = makeStore();
    store.dispatch(newSong({ seed: 77, formId: 'verse-chorus', tonic: 7, mode: 'major' }) as any);
    const verses = state(store).songStructure.map((p, i) => (p.sectionId === 'verse' ? i : -1)).filter(i => i >= 0);
    return { store, verses };
  };

  it('loads a document and its realized parts', () => {
    const { store } = setup();
    expect(state(store).doc).not.toBeNull();
    expect(state(store).key).toBe('G Major');
    expect(state(store).songStructure.length).toBe(state(store).doc!.form.length);
  });

  it('propagates a drum edit to every instance of the section', () => {
    const { store, verses } = setup();
    const was = state(store).songStructure[verses[0]].drums[1][2].checked;
    store.dispatch(setDrumState({ index: verses[0], drumPart: 1, drumStep: 2, drums: { index: 2, checked: !was } }));
    verses.forEach(i => expect(state(store).songStructure[i].drums[1][2].checked).toBe(!was));
    expect(state(store).doc!.sections.verse.locks.drums).toBe(true);
  });

  it('propagates bass and chord edits', () => {
    const { store, verses } = setup();
    const locs = state(store).songStructure[verses[1]].bassNoteLocations.map(l => ({ ...l }));
    const k = locs.findIndex(l => l.midi > 0);
    locs[k] = { ...locs[k], y: 60, acc: 'sharp' }; // F#2
    store.dispatch(setBassState({ index: verses[1], bassNoteLocations: locs }));
    verses.forEach(i => expect(state(store).songStructure[i].bassNoteLocations[k].midi).toBe(42));

    store.dispatch(setChordState({ part: verses[0], beat: 0, midi: 86, osc: 0, checked: true }));
    verses.forEach(i => expect(state(store).songStructure[i].chordTones.midiTones[0]).toContain(86));
  });

  it('re-rolls a layer, respecting locks, without touching other sections', () => {
    const { store } = setup();
    const before = state(store).songStructure.map(p => JSON.stringify(p.drums));
    store.dispatch(toggleLock({ sectionId: 'chorus', layer: 'drums' }));
    store.dispatch(rerollLayer({ sectionId: 'chorus', layer: 'drums' }));
    expect(state(store).songStructure.map(p => JSON.stringify(p.drums))).toEqual(before);
    store.dispatch(toggleLock({ sectionId: 'chorus', layer: 'drums' }));
    store.dispatch(rerollLayer({ sectionId: 'chorus', layer: 'drums' }));
    const after = state(store).songStructure;
    after.forEach((p, i) => {
      if (p.sectionId !== 'chorus') expect(JSON.stringify(p.drums)).toBe(before[i]);
    });
    expect(after.some((p, i) => p.sectionId === 'chorus' && JSON.stringify(p.drums) !== before[i])).toBe(true);
  });

  it('keeps step ids contiguous after a rhythm re-roll', () => {
    const { store } = setup();
    store.dispatch(rerollLayer({ sectionId: 'verse', layer: 'rhythm' }));
    let next = 0;
    state(store).songStructure.forEach(p => p.stepIds.forEach(id => expect(id).toBe(next++)));
  });

  it('sets energy on one instance and reorders through the document', () => {
    const { store, verses } = setup();
    store.dispatch(setPartEnergy({ index: verses[0], energy: 0.1 }));
    expect(state(store).doc!.form[verses[0]].energy).toBe(0.1);
    expect(state(store).songStructure[verses[0]].energy).toBe(0.1);
    const order = state(store).songStructure.map(p => p.sectionId);
    store.dispatch(reorderParts({ from: 0, to: 1 }));
    const moved = state(store).songStructure.map(p => p.sectionId);
    expect(moved[1]).toBe(order[0]);
    expect(state(store).doc!.form.map(f => f.sectionId)).toEqual(moved);
  });

  it('still edits classic songs per part', () => {
    const store = makeStore();
    const { songStructure, key, bpm, seed, params } = createRandomSong(3);
    store.dispatch(setSong({ songStructure, key, bpm, seed, params }));
    expect(state(store).doc).toBeNull();
    const was = state(store).songStructure[0].drums[1][1].checked;
    store.dispatch(setDrumState({ index: 0, drumPart: 1, drumStep: 1, drums: { index: 1, checked: !was } }));
    expect(state(store).songStructure[0].drums[1][1].checked).toBe(!was);
  });
});
