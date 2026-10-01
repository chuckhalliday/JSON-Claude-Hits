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
import { incrementByAmount, setIsPlaying, setMidi, setAcoustic, SongState, setCurrentBeat, newSong, reorderParts, loadSong } from '../reducers';
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
      const result = await playVerse(
        song.bpm,
        song.midi,
        drumBeat,
        bassBeat,
        chordBeat,
        song.songStructure[verse].drumGroove,
        song.songStructure[verse].drums,
        song.songStructure[verse].bassGroove,
        song.songStructure[verse].bassNoteLocations,
        song.songStructure[verse].chordsGroove,
        song.songStructure[verse].chords,
        song.songStructure[verse].chordTones,
        handleStep,
        () => stopRef.current,
        includeDrums,
        includeBass,
        includeChords,
        acoustic,
        song.key
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

      const nextVerse = verse + 1
      if (nextVerse < song.songStructure.length) {
        dispatch(setCurrentBeat([nextVerse, 0, 0, 0]))
        setCurrentPart(nextVerse);
        handlePartOpen(`${nextVerse}`);
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

  // Stable identity so DrumMachine's width-measuring effect (which lists this in
  // its deps) doesn't re-run on every App render. The prev-guard also stops a
  // feedback loop where measuring width triggers a re-render that re-measures.
  const handleRenderWidthChange = useCallback((width: number) => {
    setRenderWidth(prev => (prev === width ? prev : width));
  }, []);

  useEffect(() => {
     if (isPlaying) {
      playSong(song, verse, drumBeat, bassBeat, chordBeat);
    }
  }, [isPlaying, verse]);


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

 const handleStartClick = () => {
    if (isPlaying) {
      stopRef.current = true;
      dispatch(setIsPlaying({isPlaying: false}));
    } else {
      stopRef.current = false;
      if (!openedParts[0] && !openedParts[song.selectedBeat[0]]) {
        handlePartOpen(`${song.selectedBeat[0]}`)
      }
      dispatch(setIsPlaying({isPlaying: true}));
    }
  };

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
                onClick={() => handlePartOpen(key)}
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
                  <h3>{songProps.type} ({songProps.repeat})</h3>
                  <SectionPanel part={index} />
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
        <div className={styles.info}>
          {showInfoScreen && !anyPartOpen && <Info />}
        </div>
        {/* Renders controls */}
        <div className={styles.footer}>
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
