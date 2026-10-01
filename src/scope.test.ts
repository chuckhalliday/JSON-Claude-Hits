import { configureStore } from '@reduxjs/toolkit';
import song, { newSong, setDrumState, setBassState, editHarmony, rerollLayer, toggleLock, setEditScope, SongState } from './reducers';

const makeStore = () => configureStore({ reducer: { song: song.reducer }, middleware: d => d({ serializableCheck: false, immutableCheck: false }) });
const st = (store: ReturnType<typeof makeStore>): SongState => store.getState().song;

describe('edit scope', () => {
  const setup = () => {
    const store = makeStore();
    store.dispatch(newSong({ seed: 77, formId: 'verse-chorus', tonic: 0, mode: 'major' }) as any);
    const verses = st(store).songStructure.map((p, i) => (p.sectionId === 'verse' ? i : -1)).filter(i => i >= 0);
    return { store, verses };
  };
  const snapshot = (store: ReturnType<typeof makeStore>) => st(store).songStructure.map(p => JSON.stringify([p.drums, p.bassNoteLocations, p.chords, p.chordTones]));

  it('defaults to editing every linked part', () => {
    const { store, verses } = setup();
    expect(st(store).editScope).toBe('all');
    const was = st(store).songStructure[verses[0]].drums[1][2].checked;
    store.dispatch(setDrumState({ index: verses[0], drumPart: 1, drumStep: 2, drums: { index: 2, checked: !was } }));
    verses.forEach(i => expect(st(store).songStructure[i].drums[1][2].checked).toBe(!was));
  });

  it('"this part only" changes just the open part, through every kind of edit', () => {
    const { store, verses } = setup();
    store.dispatch(setEditScope('part'));
    const before = snapshot(store);
    const target = verses[1];

    const was = st(store).songStructure[target].drums[1][2].checked;
    store.dispatch(setDrumState({ index: target, drumPart: 1, drumStep: 2, drums: { index: 2, checked: !was } }));
    const locs = st(store).songStructure[target].bassNoteLocations.map(l => ({ ...l }));
    const k = locs.findIndex(l => l.midi > 0);
    locs[k] = { ...locs[k], y: 60, acc: 'sharp' };
    store.dispatch(setBassState({ index: target, bassNoteLocations: locs }));
    store.dispatch(editHarmony({ part: target, chord: 0, change: { root: 8, quality: 'maj' } }));
    store.dispatch(rerollLayer({ sectionId: st(store).songStructure[target].sectionId!, layer: 'drums', part: target }));

    const after = snapshot(store);
    after.forEach((p, i) => (i === target ? expect(p).not.toBe(before[i]) : expect(p).toBe(before[i])));
    expect(st(store).songStructure[target].chords[0]).toBe('Ab');
    // The part now plays its own copy of the verse, still labelled Verse.
    const own = st(store).songStructure[target].sectionId!;
    expect(own).not.toBe('verse');
    expect(st(store).doc!.sections[own].label).toBe('Verse');
    expect(st(store).doc!.form.filter(f => f.sectionId === 'verse').length).toBe(verses.length - 1);
  });

  it('a detached part stays separate when switching back to linked edits', () => {
    const { store, verses } = setup();
    store.dispatch(setEditScope('part'));
    store.dispatch(editHarmony({ part: verses[0], chord: 0, change: { root: 9, quality: 'min' } }));
    store.dispatch(setEditScope('all'));
    store.dispatch(editHarmony({ part: verses[1], chord: 0, change: { root: 5, quality: 'maj' } }));
    expect(st(store).songStructure[verses[0]].chords[0]).toBe('Am');
    verses.slice(1).forEach(i => expect(st(store).songStructure[i].chords[0]).toBe('F'));
  });

  it('locks only the open part in part scope, and keeps fills and crashes', () => {
    const { store, verses } = setup();
    const transitionsBefore = st(store).songStructure.map(p => JSON.stringify([p.drums[8][0], p.drums.map(r => r[r.length - 1])]));
    store.dispatch(setEditScope('part'));
    store.dispatch(toggleLock({ sectionId: 'verse', layer: 'bass', part: verses[0] }));
    const own = st(store).songStructure[verses[0]].sectionId!;
    expect(st(store).doc!.sections[own].locks.bass).toBe(true);
    expect(st(store).doc!.sections.verse.locks.bass).toBe(false);
    expect(st(store).songStructure.map(p => JSON.stringify([p.drums[8][0], p.drums.map(r => r[r.length - 1])]))).toEqual(transitionsBefore);
  });
});
