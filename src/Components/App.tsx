import React, { useState, useEffect, useCallback } from 'react'
import Info from './Info';
import Generate from './Generate';
import Save from './Save';
import SectionPanel from './SectionPanel';
import { SHORT_LABELS } from '../Core/form';
import { downloadMidi } from '../Core/exportMidi';
import { SectionLabel } from '../Core/doc';
import DrumMachine from "./DrumMachine";
import BassStaff from "./BassStaff";
import Piano, { PlayHandle } from './Piano';
import { useSelector, useDispatch } from "react-redux"
import { playVerse } from '../Playback/playSong';
import { getAudioContext } from '../Playback/audioContext';
import { useLampStep } from '../Playback/useLampStep';
import { incrementByAmount, setIsPlaying, setMidi, setAcoustic, SongState, setCurrentBeat, newSong, reorderParts, loadSong, setLoopPick, toggleLoop, setPartLinked, duplicatePart, deletePart } from '../reducers';
import { isDetached, linkedCount } from '../Core/generate';
import { beatsInPart, clampRegion, containsPoint, describePoint, partWindow, stepBeat, sum, trackWindow } from '../Playback/loop';
import type { AppDispatch } from '../store'
import styles from "../Styles/App.module.scss"
import { supabase } from '../supabaseClient'

// User ids allowed to see internal-only features (the T1-T10 song-generation
// tabs and the Advanced generation settings): the dev-login account and the
// one Google account used for testing.
const DEV_USER_ID = '073e2300-29ac-429d-af14-f1b34b44802a';
const TEST_GOOGLE_USER_ID = '92fcd2d4-cc80-4d8e-8246-7f645800492c';
const SONG_TAB_COUNT = 10;

function listInputsAndOutputs(midiAccess: WebMidi.MIDIAccess) {
  console.log("MIDI ready!");
  for (const entry of midiAccess.inputs) {
    const input = entry[1];
    console.log(
      `Input port: name:'${input.name}'`
    );
  }

  for (const entry of midiAccess.outputs) {
    const output = entry[1];
    console.log(
      `Output port: name:'${output.name}'`,
    );
  }
}

function onMIDIFailure(msg: string) {
  console.error(`Failed to get MIDI access - ${msg}`);
}


function App() {
  const [openedParts, setOpenedParts] = useState<{ [key: string]: boolean }>({});
  const [currentPart, setCurrentPart] = useState<number>(0); // Track current open part
  const [draggedPartIndex, setDraggedPartIndex] = useState<number | null>(null);
  const [dragOverPartIndex, setDragOverPartIndex] = useState<number | null>(null);
  const [showInfoScreen, setShowInfoScreen] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [saveScreen, setSaveScreen] = useState(false);
  const anyPartOpen = Object.values(openedParts).some(Boolean);

  // T1-T10 song-generation slots. Only the active tab's song lives in Redux;
  // the other nine are parked here and swapped back in via loadSong() so each
  // tab keeps its own independent structure, edits, and playback position.
  const [currentTabIndex, setCurrentTabIndex] = useState(0);
  const [tabSongs, setTabSongs] = useState<Array<SongState | null>>(() => new Array(SONG_TAB_COUNT).fill(null));
  const isPrivilegedUser = userId === DEV_USER_ID || userId === TEST_GOOGLE_USER_ID;
  const canUseSongTabs = isPrivilegedUser;

  const login = async () => {
    if (!authenticated) {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          queryParams: {
            access_type: 'offline',
            prompt: 'consent',
          },
        },
      });
      if (error) {
        alert(`Login failed: ${error.message}`);
      }
    }
  };

  const devLogin = async () => {
    const email = import.meta.env.VITE_DEV_EMAIL;
    const password = import.meta.env.VITE_DEV_PASSWORD;
    if (!email || !password) {
      alert('Set VITE_DEV_EMAIL and VITE_DEV_PASSWORD in .env.local to use dev login.');
      return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      alert(`Dev login failed: ${error.message}`);
      return;
    }
    setAuthenticated(true);
    setUserId(data.user?.id ?? null);
  };

  // Create the shared AudioContext at mount, not lazily inside the first
  // Play. Autoplay policy keeps it suspended (clock frozen at 0) until the
  // first user-gesture resume, which protects the opening notes: a context
  // created mid-gesture instead reports "running" while its output stream is
  // still opening, and the clock burst-advances past anything just scheduled
  // (heard as several silent measures before sound starts on Linux).
  useEffect(() => {
    getAudioContext();
  }, []);

  useEffect(() => {
    const checkAuthentication = async () => {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) {
        alert(`Failed to check login status: ${error.message}`);
        return;
      }
      if (session) {
        setAuthenticated(true);
        setUserId(session.user.id);
      }
    };

    checkAuthentication();
  }, []);


  const logout = async () => {
    const { error } = await supabase.auth.signOut()
    if (error) {
      alert(`Logout failed: ${error.message}`);
      return;
    }
    setAuthenticated(false)
    setUserId(null)
    setCurrentTabIndex(0)
    setTabSongs(new Array(SONG_TAB_COUNT).fill(null))
  }

  const handleGenerateClick = () => {
    setShowGenerate(true);
  };

  const handleCloseGenerate = () => {
    setShowGenerate(false);
  };

  const handleSaveClick = () => {
    setSaveScreen(true);
  };

  const handleCloseSave = () => {
    setSaveScreen(false);
  };

  const song = useSelector((state: { song: SongState }) => state.song)
  const bpm = song.bpm
  const isPlaying = song.isPlaying
  const midi = song.midi
  const acoustic = song.acoustic
  let verse = song.selectedBeat[0]
  let drumBeat = song.selectedBeat[1];
  let bassBeat = song.selectedBeat[2]
  let chordBeat = song.selectedBeat[3]

  const lampsRef = React.useRef<HTMLInputElement[]>([]);
  const stopRef = React.useRef(false);
  // Bumped whenever the user manually picks a lamp position. Lets an in-flight
  // pause (see stop-branch below) detect that its paused position is stale and
  // avoid clobbering the newer manual selection.
  const manualSeekEpochRef = React.useRef(0);
  // Song playback chains parts gaplessly: each part hands off slightly before
  // it ends, leaving the audio-clock time the next part must start at here.
  const nextStartRef = React.useRef<number | undefined>(undefined);
  // The part whose lamps playback may light. A part's last few step timers
  // fire after the next part is already on screen; they must not light lamps
  // in the new part's grid.
  const activeVerseRef = React.useRef(-1);
  // Where the next segment enters ([part, drum, bass, chord] indices) when
  // playback moves on by itself - the next part, or back to the loop start.
  // Passed by ref (not read back from the store) because the previous
  // segment's last step timers may still be updating the store position.
  const nextEntryRef = React.useRef<number[] | undefined>(undefined);
  // The newest song state, for decisions made after an await.
  const songRef = React.useRef(song);
  songRef.current = song;
  // Bumped to re-run the playback effect when a loop wraps within one part
  // (the part index doesn't change, so it alone wouldn't trigger it).
  const [playTick, setPlayTick] = useState(0);

  const partGrooves = song.songStructure[verse] ?? { drumGroove: [], bassGroove: [], chordsGroove: [] };
  const handleStep = useLampStep(lampsRef, verse, partGrooves.drumGroove, partGrooves.bassGroove, partGrooves.chordsGroove);

  const pianoRef = React.useRef<PlayHandle>(null);
  const bassStaffRef = React.useRef<PlayHandle>(null);
  const drumMachineRef = React.useRef<PlayHandle>(null);
  const [includeChords, setIncludeChords] = useState(true);
  const [includeBass, setIncludeBass] = useState(true);
  const [includeDrums, setIncludeDrums] = useState(true);
  // Lifted above BassStaff (rather than local state there) because each part's
  // BassStaff only mounts while its part is open - a local toggle would reset
  // to "staff" every time the user switched parts.
  const [bassViewMode, setBassViewMode] = useState<'staff' | 'tab'>('staff');

  const dispatch = useDispatch<AppDispatch>()

  // Generate the initial song on mount. Replaces the old import-time generation
  // so startup is an explicit, dispatchable (and seedable) action.
  useEffect(() => {
    dispatch(newSong());
  }, []);


  async function playSong(song: SongState, verse: number, drumBeat: number, bassBeat: number, chordBeat: number) {
    const seekEpochAtStart = manualSeekEpochRef.current;
    const startAt = nextStartRef.current;
    nextStartRef.current = undefined;
    activeVerseRef.current = verse;
    const step = (lampIndex: number) => {
      if (activeVerseRef.current === verse) handleStep(lampIndex);
    };
    let tempo = song.bpm - 60;
    //const output = new midi.Output()
    //output.openPort(3)

    //Start recording

    //output.sendMessage([144, 16, 1])
    //await countIn(song.bpm, song.songStructure[0].drumGroove, song.songStructure[0].drums)
    //output.sendMessage([176, 50, tempo]);
      //Drop locators
      //output.sendMessage([144, 17, 1])
      //output.sendMessage([176, sum, 1])
      // Play the part from the playhead to the end of its loop window (the
      // whole part when no loop bounds it). Every track is cut at the drum
      // playhead's beat, so they stay aligned even when resuming mid-note.
      const part = song.songStructure[verse];
      const loop = song.loopEnabled ? clampRegion(song.loop, song.songStructure) : null;
      const partBeats = sum(part.drumGroove);
      const fromBeat = sum(part.drumGroove.slice(0, drumBeat));
      // Stop at the loop's end bar if this pass reaches it.
      const loopEndBeat = (region: typeof loop) => region && region.end.part === verse ? partWindow(region, verse, part).toBeat : null;
      const cycleAt = loopEndBeat(loop);
      const toBeat = cycleAt !== null && fromBeat < cycleAt - 0.01 ? cycleAt : partBeats;
      const windowed = {
        drum: trackWindow(part.drumGroove, fromBeat, toBeat),
        bass: trackWindow(part.bassGroove, fromBeat, toBeat),
        chord: trackWindow(part.chordsGroove, fromBeat, toBeat),
      };
      const result = await playVerse(
        song.bpm,
        song.midi,
        windowed.drum.start,
        windowed.bass.start,
        windowed.chord.start,
        windowed.drum.groove,
        part.drums,
        windowed.bass.groove,
        part.bassNoteLocations,
        windowed.chord.groove,
        part.chords,
        part.chordTones,
        step,
        () => stopRef.current,
        includeDrums,
        includeBass,
        includeChords,
        acoustic,
        song.key,
        startAt,
        { drum: windowed.drum.end, bass: windowed.bass.end, chord: windowed.chord.end }
      );

      if (stopRef.current) {
        // If the user picked a new lamp position, or switched song tabs,
        // while this stop was still in flight, their action is newer than
        // where we stopped - don't overwrite the (possibly now-different
        // tab's) state with this stale paused position.
        if (manualSeekEpochRef.current === seekEpochAtStart) {
          const wrap = (idx: number, len: number) => (idx >= len ? 0 : idx);
          const drumLen = song.songStructure[verse].drumGroove.length;
          const bassLen = song.songStructure[verse].bassGroove.length;
          const chordLen = song.songStructure[verse].chordsGroove.length;
          dispatch(setCurrentBeat([
            verse,
            wrap(result.drumBeat, drumLen),
            wrap(result.bassBeat, bassLen),
            wrap(result.chordBeat, chordLen),
          ]))
          dispatch(setIsPlaying({ isPlaying: false }))
        }
        return;
      }

      // What comes next is decided from the loop as it is now (it may have
      // been moved or switched off during this pass): back to the loop start
      // if this pass ended on its end bar, on through the rest of this part
      // if the loop was switched off, or on to the next part.
      const latest = songRef.current;
      const loopNow = latest.loopEnabled ? clampRegion(latest.loop, latest.songStructure) : null;
      const wrapAt = loopEndBeat(loopNow);
      let entry: number[] | null = null;
      if (loopNow && wrapAt !== null && Math.abs(toBeat - wrapAt) < 0.01) {
        const start = partWindow(loopNow, loopNow.start.part, latest.songStructure[loopNow.start.part]);
        entry = [loopNow.start.part, start.drum.start, start.bass.start, start.chord.start];
      } else if (toBeat < partBeats - 0.01) {
        const rest = (groove: number[]) => trackWindow(groove, toBeat, partBeats).start;
        entry = [verse, rest(part.drumGroove), rest(part.bassGroove), rest(part.chordsGroove)];
      } else if (verse + 1 < latest.songStructure.length) {
        entry = [verse + 1, 0, 0, 0];
      }
      const nextVerse = entry ? entry[0] : -1;
      if (entry) {
        // Resolved just before this segment ends: the next one starts
        // exactly where it finishes.
        nextStartRef.current = result.endTime;
        nextEntryRef.current = entry;
        dispatch(setCurrentBeat(entry))
        if (nextVerse !== verse) {
          activeVerseRef.current = nextVerse;
          showPart(nextVerse);
        }
        setPlayTick(t => t + 1);
      } else {
      dispatch(setIsPlaying({ isPlaying: false }))
      console.log("End")
      }
    // Stop recording
    //output.sendMessage([144, 16, 1])
  }

  const handlePartOpen = (key: string) => {
    const updatedOpenedParts: { [key: string]: boolean } = {};

    updatedOpenedParts[key] = !openedParts[key];

    for (const partKey in openedParts) {
      if (partKey !== key) {
        updatedOpenedParts[partKey] = false;
      }
    }

    setOpenedParts(updatedOpenedParts);
    
    if (updatedOpenedParts[key]) {
      setCurrentPart(parseInt(key));
    } else {
      setCurrentPart(-1);
    }
  };

  // Open a part (without the toggle-closed behaviour of handlePartOpen).
  const showPart = (index: number) => {
    setOpenedParts({ [`${index}`]: true });
    setCurrentPart(index);
  };

  const handlePartDragStart = (index: number) => {
    setDraggedPartIndex(index);
  };

  const handlePartDragOver = (e: React.DragEvent<HTMLButtonElement>, index: number) => {
    e.preventDefault();
    if (draggedPartIndex !== null && draggedPartIndex !== index) {
      setDragOverPartIndex(index);
    }
  };

  const handlePartDrop = (e: React.DragEvent<HTMLButtonElement>, index: number) => {
    e.preventDefault();
    if (draggedPartIndex !== null && draggedPartIndex !== index) {
      dispatch(reorderParts({ from: draggedPartIndex, to: index }));
      // Index-to-part associations are now stale, so close whatever was open.
      setOpenedParts({});
      setCurrentPart(-1);
    }
    setDraggedPartIndex(null);
    setDragOverPartIndex(null);
  };

  const handlePartDragEnd = () => {
    setDraggedPartIndex(null);
    setDragOverPartIndex(null);
  };

  const [renderWidth, setRenderWidth] = useState(0);

  // Publish the footer's live height (it wraps on narrow windows and grows
  // with the song tabs) so the opened part can fill the space above it.
  const footerRef = React.useRef<HTMLDivElement>(null);
  useEffect(() => {
    const footer = footerRef.current;
    if (!footer) return;
    const publish = () => document.documentElement.style.setProperty('--footer-height', `${footer.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(footer);
    return () => observer.disconnect();
  }, [authenticated]);

  // Stable identity so DrumMachine's width-measuring effect (which lists this in
  // its deps) doesn't re-run on every App render. The prev-guard also stops a
  // feedback loop where measuring width triggers a re-render that re-measures.
  const handleRenderWidthChange = useCallback((width: number) => {
    setRenderWidth(prev => (prev === width ? prev : width));
  }, []);

  useEffect(() => {
     if (isPlaying) {
      const entry = nextEntryRef.current;
      nextEntryRef.current = undefined;
      if (entry) {
        playSong(song, entry[0], entry[1], entry[2], entry[3]);
      } else {
        playSong(song, verse, drumBeat, bassBeat, chordBeat);
      }
    }
    // Not keyed on the part index: moving on to the next part (or back to a
    // loop start) bumps playTick, and the store update that moves the part
    // can render separately from it - keying on both started a second,
    // overlapping playback each time the song crossed into another part.
  }, [isPlaying, playTick]);


 // Switches to song tab `index`, saving the outgoing tab's full state (so its
 // edits and playback position survive) and either restoring the incoming
 // tab's previously-saved state or generating a fresh song for it.
 const handleTabSwitch = (index: number) => {
    if (index === currentTabIndex) return;

    // Signal any in-flight playback to stop scheduling, and invalidate its
    // stale-write guard so it can't clobber the tab we're switching to.
    stopRef.current = true;
    manualSeekEpochRef.current++;
    dispatch(setIsPlaying({ isPlaying: false }));

    setTabSongs(prev => {
      const next = [...prev];
      next[currentTabIndex] = { ...song, isPlaying: false };
      return next;
    });

    const incoming = tabSongs[index];
    if (incoming) {
      dispatch(loadSong(incoming));
    } else {
      dispatch(newSong());
      dispatch(setCurrentBeat([0, 0, 0, 0]));
    }

    setCurrentTabIndex(index);
    setOpenedParts({});
    setCurrentPart(-1);
  };

 // Menu of the open part's block: duplicate it into the next slot, delete
 // it, or close it. Positioned against the window, since the parts row
 // clips anything that overflows it.
 const [partMenu, setPartMenu] = useState<{ index: number, left: number, top: number } | null>(null);
 const partMenuRef = React.useRef<HTMLDivElement>(null);
 useEffect(() => {
   if (!partMenu) return;
   const onDown = (e: MouseEvent) => {
     const target = e.target as HTMLElement;
     if (partMenuRef.current?.contains(target) || target.closest('[aria-haspopup="menu"]')) return;
     setPartMenu(null);
   };
   const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPartMenu(null); };
   document.addEventListener('mousedown', onDown);
   window.addEventListener('keydown', onKey);
   return () => {
     document.removeEventListener('mousedown', onDown);
     window.removeEventListener('keydown', onKey);
   };
 }, [partMenu]);

 // Structure edits stop playback first - the running chain is indexed by part.
 const stopForEdit = () => {
   if (isPlaying) {
     stopRef.current = true;
     manualSeekEpochRef.current++;
     dispatch(setIsPlaying({ isPlaying: false }));
   }
 };

 const handleDuplicatePart = (index: number) => {
   stopForEdit();
   setPartMenu(null);
   dispatch(duplicatePart(index));
   showPart(index + 1);
 };

 const handleDeletePart = (index: number) => {
   stopForEdit();
   setPartMenu(null);
   dispatch(deletePart(index));
   showPart(Math.max(0, Math.min(index, song.songStructure.length - 2)));
 };

 const handleStartClick = () => {
    if (isPlaying) {
      stopRef.current = true;
      dispatch(setIsPlaying({isPlaying: false}));
    } else {
      stopRef.current = false;
      nextStartRef.current = undefined;
      nextEntryRef.current = undefined;
      // With the loop on and the playhead outside it, start at the loop.
      // Judged from the stored playhead - where playback actually resumes -
      // not from whichever part happens to be open.
      const loop = song.loopEnabled ? clampRegion(song.loop, song.songStructure) : null;
      const [resumePart, resumeStep] = song.selectedBeat;
      const resumeGroove = song.songStructure[resumePart]?.drumGroove;
      const here = resumeGroove ? { part: resumePart, beat: stepBeat(resumeGroove, resumeStep) } : null;
      if (loop && (!here || !containsPoint(loop, here))) {
        const bounds = partWindow(loop, loop.start.part, song.songStructure[loop.start.part]);
        const entry = [loop.start.part, bounds.drum.start, bounds.bass.start, bounds.chord.start];
        nextEntryRef.current = entry;
        dispatch(setCurrentBeat(entry));
        showPart(loop.start.part);
      } else if (!openedParts[0] && !openedParts[song.selectedBeat[0]]) {
        handlePartOpen(`${song.selectedBeat[0]}`)
      }
      dispatch(setIsPlaying({isPlaying: true}));
    }
  };

  // Set Start / Set End arm a pick: the next step lamp or bar number
  // clicked becomes that loop point, and picking the start moves straight
  // on to picking the end. Pressing the armed button again (or Esc) cancels.
  const loopPick = song.loopPick ?? null;
  const armLoopPick = (which: 'start' | 'end') => dispatch(setLoopPick(loopPick === which ? null : which));
  useEffect(() => {
    if (!loopPick) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') dispatch(setLoopPick(null)); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loopPick, dispatch]);
  const loopRegion = clampRegion(song.loop, song.songStructure);
  const loopOn = !!song.loopEnabled && loopRegion !== null;

  const handleAcoustic = () => {
    dispatch(setAcoustic({ acoustic: !acoustic }));
  };

  // Download the song (with every edit) as a Standard MIDI File for a DAW.
  const handleExport = () => {
    const filename = `${song.key.replace(/\s+/g, '-')}-${song.bpm}bpm${song.seed != null ? `-${song.seed}` : ''}`;
    downloadMidi({ songStructure: song.songStructure, bpm: song.bpm, key: song.key, title: `Song in ${song.key}` }, filename);
  };

  const handleMidi = async () => {
    if (midi) {
      dispatch(setMidi({midi: false}));
      console.log("Midi off")
    } else {
      dispatch(setMidi({midi: true}));
      navigator.requestMIDIAccess().then(listInputsAndOutputs, onMIDIFailure)
    }
  };

  return (
    <div >
      {authenticated ? (
        // Render your app components when authenticated
        <div className={styles.rowContainer}>
        {showGenerate && (
          <div className={styles.generateOverlay}>
            <Generate onClose={handleCloseGenerate} showAdvanced={isPrivilegedUser}/>
          </div>
        )}
        {saveScreen && (
          <div className={styles.generateOverlay}>
            <Save onClose={handleCloseSave}/>
          </div>
        )}
        {song.songStructure.length > 0 && <Piano ref={pianoRef} lampsRef={lampsRef} />}
        <div className={styles.partsRow}>
        {song.songStructure.map((songProps, index) => {
          const songParts = [];
          const key = `${index}`;
          const isOpen = openedParts[key];
          // Blocks are sized by bars so the row reads as the arrangement.
          const bars = Math.round(songProps.drumGroove.reduce((a, b) => a + b, 0) / 4);
          const shortLabel = SHORT_LABELS[songProps.type as SectionLabel] ?? songProps.type.charAt(0);
          const blockTitle = `${songProps.type} ${songProps.repeat} · ${bars} bars`
            + (songProps.transpose ? ` · +${songProps.transpose} lift` : '')
            + `\n${songProps.chords.filter(c => c !== '-').join('  ')}`;

          return (
            <div key={key} className={styles.parts}>
              <button
                onClick={(e) => {
                  // Clicking the open part's block opens its menu instead.
                  if (isOpen && currentPart === index) {
                    const r = e.currentTarget.getBoundingClientRect();
                    setPartMenu(partMenu?.index === index ? null : { index, left: r.left, top: r.bottom + 4 });
                  } else {
                    setPartMenu(null);
                    handlePartOpen(key);
                  }
                }}
                aria-haspopup={isOpen && currentPart === index ? 'menu' : undefined}
                draggable
                onDragStart={() => handlePartDragStart(index)}
                onDragOver={(e) => handlePartDragOver(e, index)}
                onDrop={(e) => handlePartDrop(e, index)}
                onDragEnd={handlePartDragEnd}
                className={[
                  styles.partButton,
                  isOpen ? styles.openButton : '',
                  draggedPartIndex === index ? styles.draggingPart : '',
                  dragOverPartIndex === index ? styles.dragOverPart : '',
                  loopRegion && beatsInPart(loopRegion, index, sum(songProps.drumGroove)) ? (loopOn ? styles.inLoop : styles.inLoopOff) : '',
                ].filter(Boolean).join(' ')}
                style={{ width: `${Math.max(30, bars * 5)}px` }}
                title={blockTitle}
              >
                {shortLabel}
                {songProps.transpose ? <sup>↑</sup> : null}
                {songProps.energy !== undefined && (
                  <span className={styles.energyBar} style={{ width: `${Math.round(songProps.energy * 100)}%` }} />
                )}
              </button>
              {isOpen && currentPart === index && (
                <div className={styles.openedPart}>
                  {/* The title and section controls stay in view while the
                      staff and grid scroll sideways (by hand or following
                      playback). Sticky only travels within its parent, so
                      the parent spans the full scrollable width - the same
                      arrangement as the staff's Staff/Tab toggle. */}
                  <div style={{ width: renderWidth ? `max(${renderWidth}px, 100%)` : '100%' }}>
                    <div className={styles.stickyHeader}>
                      <div className={styles.partTitleRow}>
                        <h3>{songProps.type} ({songProps.repeat})</h3>
                        {song.doc && songProps.sectionId && (() => {
                          const sharing = linkedCount(song.doc, index);
                          const partOnly = isDetached(song.doc, index);
                          return (
                            <div className={styles.scopeToggle} role="group" aria-label="Which parts edits change">
                              <button
                                className={!partOnly ? styles.scopeOn : ''}
                                aria-pressed={!partOnly}
                                onClick={() => partOnly && dispatch(setPartLinked({ part: index, linked: true }))}
                                title={partOnly
                                  ? `Re-link: every linked ${songProps.type.toLowerCase()} takes on this part's current state`
                                  : `Edits change this ${songProps.type.toLowerCase()} everywhere it plays`}
                              >
                                All linked{sharing > 1 ? ` (${sharing})` : ''}
                              </button>
                              <button
                                className={partOnly ? styles.scopeOn : ''}
                                aria-pressed={partOnly}
                                onClick={() => !partOnly && dispatch(setPartLinked({ part: index, linked: false }))}
                                title="Edits change only this part (it gets its own copy of the section); other parts stay linked"
                              >
                                This part only
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                      <SectionPanel part={index} />
                    </div>
                  </div>
                  <BassStaff
                    ref={bassStaffRef}
                    renderWidth={renderWidth}
                    part={index}
                    lampsRef={lampsRef}
                    viewMode={bassViewMode}
                    onViewModeChange={setBassViewMode}
                  />
                  <DrumMachine
                    ref={drumMachineRef}
                    onRenderWidthChange={handleRenderWidthChange}
                    part={index}
                    lampsRef={lampsRef}
                    manualSeekEpochRef={manualSeekEpochRef}
                  />
                </div>
              )}
            </div>
          );
        })}
        </div>
        {partMenu && song.songStructure[partMenu.index] && (
          <div ref={partMenuRef} className={styles.partMenu} style={{ left: partMenu.left, top: partMenu.top }} role="menu">
            <div className={styles.partMenuTitle}>{song.songStructure[partMenu.index].type} ({song.songStructure[partMenu.index].repeat})</div>
            <button role="menuitem" onClick={() => handleDuplicatePart(partMenu.index)} title="Insert a copy right after this part (linked to it, like any repeat)">
              Duplicate →
            </button>
            <button
              role="menuitem"
              onClick={() => handleDeletePart(partMenu.index)}
              disabled={song.songStructure.length <= 1}
              className={styles.partMenuDanger}
              title="Remove this part from the song"
            >
              Delete
            </button>
            <button role="menuitem" onClick={() => { setPartMenu(null); handlePartOpen(`${partMenu.index}`); }}>
              Close part
            </button>
          </div>
        )}
        <div className={styles.info}>
          {showInfoScreen && !anyPartOpen && <Info />}
        </div>
        {/* Renders controls */}
        <div className={styles.footer} ref={footerRef}>
        <div className={styles.controls}>
          <button className={styles.key} onClick={handleGenerateClick}>Key of :<br />{song.key}</button>
          {!midi && (
            <button className={`${styles.button} ${styles.oscToggle}`} onClick={handleAcoustic}>
              {acoustic ? "Acoustic" : "Synth"}
            </button>
          )}
          <div className={styles.songControls}>
            <button
              onClick={() => setIncludeChords(prev => !prev)}
              className={includeChords ? styles.button : `${styles.button} ${styles.openButton}`}
            >
              Chords
            </button>
            <button
              onClick={() => setIncludeBass(prev => !prev)}
              className={includeBass ? styles.button : `${styles.button} ${styles.openButton}`}
            >
              Bass
            </button>
            <button
              onClick={() => setIncludeDrums(prev => !prev)}
              className={includeDrums ? styles.button : `${styles.button} ${styles.openButton}`}
            >
              Drums
            </button>
          </div>
          <div className={styles.bpmControls}>
            <label className={styles.fader}>
              <span className={styles.bpmRow}>BPM:{bpm}</span>
              <div className={styles.bpmRow}>
                <input
                  className={styles.bpm}
                  type="range"
                  min={90}
                  max={150}
                  step={1}
                  onChange={(e) => dispatch(incrementByAmount(e.target.value))}
                  defaultValue={bpm}
                />
              </div>
            </label>
            {/*<label className={styles.fader}>
              <span>Volume</span>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                onChange={handleVolumeChange}
                defaultValue={1}
              />
            </label> */}
            <button
              onClick={handleStartClick}
              className={isPlaying ? `${styles.button} ${styles.openButton}` : styles.button}
            >
              {isPlaying ? "Pause" : "Play Song"}
            </button>
          </div>
          <div className={styles.loopControls}>
            <div className={styles.loopButtons}>
              <button
                onClick={() => dispatch(toggleLoop())}
                disabled={!loopRegion}
                className={loopOn ? `${styles.button} ${styles.openButton}` : styles.button}
                title={loopRegion ? 'Cycle playback between the loop points' : 'Set loop points first: Set Start, then click where it starts and where it ends - or click a bar number above the drum grid'}
              >
                ⟳ Loop
              </button>
              <button
                onClick={() => armLoopPick('start')}
                className={loopPick === 'start' ? `${styles.button} ${styles.pickArmed}` : styles.button}
                aria-pressed={loopPick === 'start'}
                title="Then click a step lamp or bar number to start the loop there"
              >Set Start</button>
              <button
                onClick={() => armLoopPick('end')}
                className={loopPick === 'end' ? `${styles.button} ${styles.pickArmed}` : styles.button}
                aria-pressed={loopPick === 'end'}
                title="Then click a step lamp or bar number to end the loop there (that step or bar is included)"
              >Set End</button>
            </div>
            <span className={styles.loopReadout}>
              {loopPick
                ? `Click a step or bar number for the loop ${loopPick} (Esc to cancel)`
                : loopRegion
                  ? `${describePoint(loopRegion.start, song.songStructure)} → ${describePoint(loopRegion.end, song.songStructure)}`
                  : 'No loop set'}
            </span>
          </div>
          <div className={styles.midiControls}>
            <button onClick={handleMidi} className={styles.button}>
              {midi ? "Use Osc" : "Use Midi"}
            </button>
            <button onClick={handleExport} className={styles.button} title="Download a multitrack .mid (drums, bass, chords, guide tones, section markers) for your DAW">Export MIDI</button>
            <button onClick={handleSaveClick} className={styles.button}>Save/Load</button>
            <button onClick={logout} className={styles.button}>Log Out</button>
          </div>
        </div>
        {canUseSongTabs && (
          <div className={styles.songTabs}>
            {Array.from({ length: SONG_TAB_COUNT }, (_, index) => (
              <button
                key={index}
                onClick={() => handleTabSwitch(index)}
                className={currentTabIndex === index ? `${styles.tabButton} ${styles.openButton}` : styles.tabButton}
              >
                T{index + 1}
              </button>
            ))}
          </div>
        )}
        </div>
        </div>
      ) : (
        <div>
          {import.meta.env.DEV && (
            <button className="login" onClick={devLogin}>Dev Login</button>
          )}
          <button className="login" onClick={login}>Log In with Google</button>
        </div>
      )}
    </div>
  );
}

export default App;
