import { createSlice, PayloadAction, Dispatch, current } from "@reduxjs/toolkit";
import { SongStructure, NoteLocation, DrumHit, SongParams } from "./types";
import { bassPitch } from "./SongStructure/bassPitch";
import { SongDoc, Layer, GenerateOptions } from "./Core/doc";
import { generateDoc, regenerateLayer, setLock, setInstanceEnergy, moveInstance } from "./Core/generate";
import { realizeSong, realizeSection, realizeInstance, assignStepIds } from "./Core/realize";
import { editBass, editDrum, editChordTone, editChord } from "./Core/edits";
import { ChordEvent } from "./Core/theory";
import { keyName } from "./Core/theory";
import { LoopRegion, LoopSpan, comparePoints } from "./Playback/loop";

export interface SongState {
    isPlaying: boolean,
    bpm: number,
    key: string,
    midi: boolean,
    acoustic: boolean,
    selectedBeat: number[],
    songStructure: SongStructure,
    seed: number | null,
    // Generation recipe behind the current song; null for songs saved before
    // recipes were recorded (the Generate menu then opens blank).
    params: SongParams | null,
    // The sculpted song document (src/Core) when the song came from the
    // form-first engine; songStructure is then a view realized from it, and
    // edits/re-rolls go through the document. Null for classic songs.
    doc?: SongDoc | null,
    // Loop region (bar-snapped locators) and whether playback cycles it.
    loop?: LoopRegion | null,
    loopEnabled?: boolean,
    // Set Start / Set End: which loop point the next clicked step or bar
    // number sets, and the item picked as the start (so the end pick can
    // complete the region from it).
    loopPick?: 'start' | 'end' | null,
    loopAnchor?: LoopSpan | null
}

// The song tree starts empty and deterministic. The first song is produced by
// the `newSong` thunk dispatched on mount, so importing this module has no side
// effects and startup is reproducible.
const initialState: SongState = {
    isPlaying: false,
    bpm: 120,
    key: '',
    midi: false,
    acoustic: true,
    selectedBeat: [0, 0, 0, 0],
    songStructure: [],
    seed: null,
    params: null,
    doc: null,
    loop: null,
    loopEnabled: false,
    loopPick: null,
    loopAnchor: null
};

// Everything setSong needs to load a sculpted document.
export function songFromDoc(doc: SongDoc) {
  return {
    songStructure: realizeSong(doc),
    key: keyName(doc.key),
    bpm: doc.bpm,
    seed: doc.seed,
    params: null,
    doc,
  };
}

// Apply a document change and re-render the parts it touches.
function applyDoc(state: SongState, doc: SongDoc, sectionId?: string) {
  const parts = current(state).songStructure;
  state.doc = doc;
  state.songStructure = sectionId ? realizeSection(doc, parts, sectionId) : realizeSong(doc);
}

const docFor = (state: SongState, part: number) => {
  const doc = state.doc ? current(state).doc! : null;
  const sectionId = state.songStructure[part]?.sectionId;
  return doc && sectionId && doc.form[part]?.sectionId === sectionId ? { doc, sectionId } : null;
};

const song = createSlice({
    name: "song",
    initialState,
    reducers: {
      setIsPlaying: (state, action: PayloadAction<{ isPlaying: boolean }>) => {
        state.isPlaying = action.payload.isPlaying;
      },
      setMidi: (state, action: PayloadAction<{ midi: boolean }>) => {
        state.midi = action.payload.midi;
      },
      setAcoustic: (state, action: PayloadAction<{ acoustic: boolean }>) => {
        state.acoustic = action.payload.acoustic;
      },
      setSong: (state, action: PayloadAction<{ songStructure: SongStructure, key: string, bpm: number, seed?: number | null, params?: SongParams | null, doc?: SongDoc | null }>) => {
        state.songStructure = action.payload.songStructure;
        state.key = action.payload.key;
        state.bpm = action.payload.bpm;
        state.seed = action.payload.seed ?? null;
        state.params = action.payload.params ?? null;
        state.doc = action.payload.doc ?? null;
        state.selectedBeat = [0, 0, 0, 0];
        // Bar positions belong to the old song.
        state.loop = null;
        state.loopEnabled = false;
        state.loopPick = null;
        state.loopAnchor = null;
      },
      setBassState: (state, action: PayloadAction<{ index: number, bassNoteLocations: NoteLocation[] }>) => {
        const sculpted = docFor(state, action.payload.index);
        if (sculpted) {
          // Lands on the section definition, so every instance follows.
          applyDoc(state, editBass(sculpted.doc, action.payload.index, action.payload.bassNoteLocations), sculpted.sectionId);
          return;
        }
        // Recompute each note's pitch from its (possibly edited) staff position
        // and accidental, so dragging a note or toggling its accidental keeps
        // the stored osc/midi that playback reads in sync with the staff.
        state.songStructure[action.payload.index].bassNoteLocations =
          action.payload.bassNoteLocations.map(note => ({ ...note, ...bassPitch(note.y, note.acc) }));
      },
      setDrumState: (state, action: PayloadAction<{ index: number, drumPart: number, drumStep: number, drums: DrumHit }>) => {
        const sculpted = docFor(state, action.payload.index);
        if (sculpted) {
          const { index, drumPart, drumStep, drums } = action.payload;
          applyDoc(state, editDrum(sculpted.doc, index, drumPart, drumStep, drums.checked), sculpted.sectionId);
          return;
        }
        state.songStructure[action.payload.index].drums[action.payload.drumPart][action.payload.drumStep] = action.payload.drums;
      },
      setChordState: (state, action: PayloadAction<{ part: number, beat: number, midi: number, osc: number, checked: boolean }>) => {
        const sculpted = docFor(state, action.payload.part);
        if (sculpted) {
          const { part, beat, midi, checked } = action.payload;
          applyDoc(state, editChordTone(sculpted.doc, part, beat, midi, checked), sculpted.sectionId);
          return;
        }
        if (action.payload.checked) {
          state.songStructure[action.payload.part].chordTones.midiTones[action.payload.beat].push(action.payload.midi) 
          state.songStructure[action.payload.part].chordTones.oscTones[action.payload.beat].push(action.payload.osc)
        } else {
          const midiIndex = state.songStructure[action.payload.part].chordTones.midiTones[action.payload.beat].indexOf(action.payload.midi);
          if (midiIndex !== -1) {
            state.songStructure[action.payload.part].chordTones.midiTones[action.payload.beat].splice(midiIndex, 1);
          }
          const oscIndex = state.songStructure[action.payload.part].chordTones.oscTones[action.payload.beat].indexOf(action.payload.osc);
          if (oscIndex !== -1) {
            state.songStructure[action.payload.part].chordTones.oscTones[action.payload.beat].splice(oscIndex, 1);
          }
        }
      },
      setCurrentBeat: (state, action: PayloadAction<number[]>) => {
        state.selectedBeat = action.payload;
      },
      reorderParts: (state, action: PayloadAction<{ from: number, to: number }>) => {
        const { from, to } = action.payload;
        if (from === to || from < 0 || to < 0 || from >= state.songStructure.length || to >= state.songStructure.length) {
          return;
        }
        // The loop is defined by part positions, which a reorder scrambles.
        state.loop = null;
        state.loopEnabled = false;
        state.loopPick = null;
        state.loopAnchor = null;
        if (state.doc && state.doc.form.length === state.songStructure.length) {
          // Transitions (crashes, fills) depend on neighbours, so re-render all.
          applyDoc(state, moveInstance(current(state).doc!, from, to));
          return;
        }
        const [moved] = state.songStructure.splice(from, 1);
        state.songStructure.splice(to, 0, moved);
      },
      // Set the loop to a region (or clear it) and turn cycling on/off.
      setLoop: (state, action: PayloadAction<LoopRegion | null>) => {
        state.loop = action.payload;
        state.loopEnabled = action.payload !== null;
        state.loopPick = null;
        state.loopAnchor = null;
      },
      // Arm Set Start / Set End: the next clicked step or bar sets it.
      setLoopPick: (state, action: PayloadAction<'start' | 'end' | null>) => {
        state.loopPick = action.payload;
        if (action.payload !== 'end') state.loopAnchor = null;
      },
      // A step or bar clicked while a pick is armed. Picking the start moves
      // straight on to picking the end; picking the end completes the loop.
      pickLoopSpan: (state, action: PayloadAction<LoopSpan>) => {
        const span = action.payload;
        const loop = state.loop;
        if (state.loopPick === 'start' || !loop) {
          const start = { part: span.part, beat: span.from };
          // Keep the old end if it still lies past the new start; otherwise
          // loop just the clicked item until the end is picked.
          const end = loop && comparePoints(loop.end, { part: span.part, beat: span.to }) >= 0 ? loop.end : { part: span.part, beat: span.to };
          state.loop = { start, end };
          state.loopAnchor = span;
          state.loopPick = 'end';
        } else if (state.loopPick === 'end') {
          // From the start item (or, with no start picked this time, the
          // loop as it stands) to the clicked item, in either order.
          const anchor = state.loopAnchor ?? { part: loop.start.part, from: loop.start.beat, to: loop.start.beat };
          if (comparePoints({ part: span.part, beat: span.from }, { part: anchor.part, beat: anchor.from }) >= 0) {
            state.loop = { start: { part: anchor.part, beat: anchor.from }, end: { part: span.part, beat: span.to } };
          } else {
            const anchorEnd = state.loopAnchor ? { part: anchor.part, beat: anchor.to } : loop.end;
            state.loop = { start: { part: span.part, beat: span.from }, end: anchorEnd };
          }
          state.loopPick = null;
          state.loopAnchor = null;
        }
        state.loopEnabled = true;
      },
      // Grow the loop to cover a bar or step (shift-click).
      extendLoop: (state, action: PayloadAction<LoopSpan>) => {
        const span = action.payload;
        const loop = state.loop;
        const from = { part: span.part, beat: span.from };
        const to = { part: span.part, beat: span.to };
        state.loop = loop
          ? { start: comparePoints(from, loop.start) < 0 ? from : loop.start, end: comparePoints(to, loop.end) > 0 ? to : loop.end }
          : { start: from, end: to };
        state.loopEnabled = true;
      },
      toggleLoop: (state) => {
        if (state.loop) state.loopEnabled = !state.loopEnabled;
      },
      // Change one chord of a section's progression (root/quality, applied or
      // borrowed chords, inversion) - every instance follows.
      editHarmony: (state, action: PayloadAction<{ part: number, chord: number, change: Partial<Pick<ChordEvent, 'root' | 'quality' | 'inversion' | 'appliedTo' | 'fn'>> }>) => {
        const sculpted = docFor(state, action.payload.part);
        if (!sculpted) return;
        const { part, chord, change } = action.payload;
        applyDoc(state, editChord(sculpted.doc, part, chord, change), sculpted.sectionId);
      },
      // Re-roll one layer of one section (unlocked dependents follow).
      rerollLayer: (state, action: PayloadAction<{ sectionId: string, layer: Layer }>) => {
        if (!state.doc) return;
        applyDoc(state, regenerateLayer(current(state).doc!, action.payload.sectionId, action.payload.layer), action.payload.sectionId);
      },
      toggleLock: (state, action: PayloadAction<{ sectionId: string, layer: Layer }>) => {
        if (!state.doc) return;
        const { sectionId, layer } = action.payload;
        state.doc = setLock(current(state).doc!, sectionId, layer, !state.doc.sections[sectionId]?.locks[layer]);
      },
      // Energy of one instance: reshapes its drums and transitions only.
      setPartEnergy: (state, action: PayloadAction<{ index: number, energy: number }>) => {
        if (!state.doc) return;
        const doc = setInstanceEnergy(current(state).doc!, action.payload.index, action.payload.energy);
        state.doc = doc;
        const parts = current(state).songStructure.map((p, i) =>
          Math.abs(i - action.payload.index) <= 1 && doc.form[i] ? realizeInstance(doc, i, p.repeat) : p);
        state.songStructure = assignStepIds(parts);
      },
      incrementByAmount: (state, action: PayloadAction<string>) => {
        state.bpm = parseFloat(action.payload);
        if (state.doc) state.doc.bpm = state.bpm;
      },
      // Wholesale-replaces the active song state. Used to swap in a
      // previously-generated song tab (see App.tsx's T1-T10 slots), where the
      // whole SongState - not just the generation recipe - needs restoring.
      loadSong: (_state, action: PayloadAction<SongState>) => action.payload,
    },
  });

export const { setIsPlaying, setMidi, setAcoustic, setSong, setBassState, setDrumState, setChordState, setCurrentBeat, reorderParts, incrementByAmount, loadSong, rerollLayer, toggleLock, setPartEnergy, setLoop, setLoopPick, pickLoopSpan, extendLoop, toggleLoop, editHarmony } = song.actions;

// Thunk: generate a fresh form-first song and load it into the store.
// Dispatched on mount and by the song tabs. Pass a seed (or full options)
// to reproduce a specific song.
export const newSong = (options?: number | GenerateOptions) => (dispatch: Dispatch) => {
  const opts = typeof options === 'number' ? { seed: options } : options ?? {};
  dispatch(setSong(songFromDoc(generateDoc(opts))));
};

export default song;