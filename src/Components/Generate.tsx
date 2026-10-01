import { useState, useEffect, useRef, ChangeEvent } from "react";
import { useDispatch, useSelector } from "react-redux";
import { setSong, SongState, newSong } from "../reducers";
import type { AppDispatch } from "../store";
import generateSong from "../SongStructure/generateSong";
import { FORM_TEMPLATES, DEFAULT_FORM_ID } from "../Core/form";
import { MODES, MODE_NAMES, Mode } from "../Core/theory";
import { defaultTuning, normalizeTuning, tuningBounds, genrePresets } from "../SongStructure/tuning";
import { GenerationTuning } from "../types";
import Dial from "./Dial";
import styles from "../Styles/App.module.scss";

interface GenerateProps {
  onClose: () => void;
  // Gates the "Advanced" button below - only the dev-login and test Google
  // accounts get access to the additional generation settings it opens.
  showAdvanced?: boolean;
}

const noteMapping: { [key: number]: string } = {
  2: "../notes/halfnote.webp",
  1.5: "../notes/dottedquarternote.webp",
  1: "../notes/quarternote.webp",
  0.75: "../notes/dottedeighthnote.webp",
  0.5: "../notes/eighthnote.webp",
  0.25: "../notes/sixteenthnote.webp",
};

// Accepted bounds for the optional BPM / song-length fields: one source of
// truth for the input attributes, the placeholders, and the clamp.
const minBpm = 40;
const maxBpm = 240;
const minLength = 60;
const maxLength = 600;

// Semitone offset each key letter maps to (same values handleKeyChange uses).
const keyOffsets: { [letter: string]: number } = { A: -3, B: -1, C: 0, D: 2, E: 4, F: -7, G: -5 };

const MODE_LABELS = MODES.map(m => MODE_NAMES[m]);

// Parse a stored key string like "D# Minor" or "Bb Dorian" back into the
// menu's key controls. Anything unparseable (no song yet) returns null and
// the controls open blank.
function parseKey(keyString: string) {
  const [note, mode] = keyString.split(' ');
  if (!note || !(note[0] in keyOffsets) || !MODE_LABELS.includes(mode)) {
    return null;
  }
  const accidental = note[1] === '#' ? '#' : note[1] === 'b' ? '♭' : '♮';
  return {
    letter: note[0],
    accidental,
    tonality: mode,
    key: keyOffsets[note[0]],
    modify: accidental === '#' ? 1 : accidental === '♭' ? -1 : 0,
    toneModify: mode === 'Minor' ? 3 : 0,
  };
}

// The blank "surprise me" state the menu opened with before recipes were
// pre-loaded; fresh arrays each call because the menu mutates them in place.
const defaultGrooves = () => [[2, 2, 2, 2]];
const defaultArrangement = () => [
  [0, 0, 0, 0],
  [0, 0, 0, 0],
  [0, 0, 0, 0],
];

export default function Generate({ onClose, showAdvanced = false }: GenerateProps) {
  const dispatch = useDispatch<AppDispatch>()
  // Sculpted songs carry their document; its options pre-load the menu.
  const doc = useSelector((state: { song: SongState }) => state.song.doc);
  // Pre-load the controls with the recipe that produced the current song
  // (grooves copied: the store freezes its arrays, the menu splices in place).
  // Songs without a stored recipe (e.g. older saves) open the blank state.
  const params = useSelector((state: { song: SongState }) => state.song.params);
  const songKey = useSelector((state: { song: SongState }) => state.song.key);
  const parsedKey = parseKey(songKey);

  // "sculpt" is the form-first engine (src/Core); "classic" is the original
  // groove-driven generator, kept for its recipes and older saves.
  const [engine, setEngine] = useState<'sculpt' | 'classic'>(doc || !params ? 'sculpt' : 'classic');
  const [formId, setFormId] = useState(doc?.formId ?? DEFAULT_FORM_ID);
  const [liftFinalChorus, setLiftFinalChorus] = useState(doc?.liftFinalChorus ?? false);
  const [useGrooves, setUseGrooves] = useState(!!doc?.motifs);
  const [grooves, setGrooves] = useState(doc?.motifs ? doc.motifs.map(groove => [...groove]) : params ? params.grooves.map(groove => [...groove]) : defaultGrooves());
  const [arrangement, setArrangement] = useState(doc?.arrangement ? doc.arrangement.map(section => [...section]) : params ? params.arrangement.map(section => [...section]) : defaultArrangement());
  const [triplet, setTriplet] = useState(doc ? doc.triplet : params ? params.triplet : 0.0)
  const [selectedKey, setSelectedKey] = useState(parsedKey?.letter ?? '');
  const [sharpFlat, setSharpFlat] = useState<string>(parsedKey?.accidental ?? '♮')
  const [tonality, setTonality] = useState<string | undefined>(parsedKey?.tonality)
  const [key, setKey] = useState<number | undefined>(parsedKey?.key)
  const [modify, setModify] = useState<number>(parsedKey?.modify ?? 0)
  const [toneModify, setToneModify] = useState<number>(parsedKey?.toneModify ?? 0)
  const [keyAdjust, setKeyAdjust] = useState<number | undefined>()
  const [bpm, setBpm] = useState<number | undefined>(doc?.bpm ?? params?.bpm)
  const [songLength, setSongLength] = useState<number | undefined>(params?.songLength)
  // Advanced-panel dials, resolved from the recipe. normalizeTuning maps
  // recipes from the retired single drum dial, fills fields older saves
  // don't have with the stock defaults, and clamps anything out of bounds,
  // so the dials always open on safe values.
  const recipeTuning = normalizeTuning(doc?.tuning ?? params?.tuning);
  const [tuning, setTuning] = useState<GenerationTuning>(recipeTuning)
  // The Genre picker's current selection, shown alongside the dials. Hand-
  // moving any dial (including a double-click reset) falls back to "Custom" —
  // a genre and a manually-assembled set of dials are otherwise the same
  // thing, so the label just tracks which one the user asked for last.
  const [selectedGenre, setSelectedGenre] = useState('');
  const setTuningField = (key: keyof GenerationTuning) => (value: number) => {
    setSelectedGenre('');
    setTuning(current => ({ ...current, [key]: value }));
  };
  const applyGenre = (genre: string) => {
    setSelectedGenre(genre);
    if (genrePresets[genre]) {
      setTuning({ ...genrePresets[genre] });
    }
  };

  // Revert every control to the blank state (random key/BPM/length, single
  // half-note groove) — the refresh button next to the title.
  const resetDefaults = () => {
    setGrooves(defaultGrooves());
    setArrangement(defaultArrangement());
    setTriplet(0.0);
    setSelectedKey('');
    setSharpFlat('♮');
    setTonality(undefined);
    setKey(undefined);
    setModify(0);
    setToneModify(0);
    setBpm(undefined);
    setSongLength(undefined);
    setTuning({ ...defaultTuning });
    setSelectedGenre('');
  };

  const handleKeyChange = (e: ChangeEvent<HTMLSelectElement>) => {
    setSharpFlat('♮')
    setTonality('Major')
    setToneModify(0)
    setSelectedKey(e.target.value);
    if (e.target.value === '') {
      setSharpFlat('♮')
      setModify(0)
      setToneModify(0)
      setTonality(undefined)
      setKey(undefined)
    } else if (e.target.value === 'A') {
      setKey(-3)
    } else if (e.target.value === 'B') {
      setKey(-1)
    } else if (e.target.value === 'C') {
      setKey(0)
    } else if (e.target.value === 'D') {
      setKey(2)
    } else if (e.target.value === 'E') {
      setKey(4)
    } else if (e.target.value === 'F') {
      setKey(-7)
    } else if (e.target.value === 'G') {
      setKey(-5)
    }
  };

  const handleModifyChange = (e: ChangeEvent<HTMLSelectElement>) => {
    if (e.target.value === '♮') {
      setSharpFlat('♮')
      setModify(0)
    } else if (e.target.value === '#') {
      setSharpFlat('#')
      setModify(1)
    } else if (e.target.value === '♭') {
      setSharpFlat('♭')
      setModify(-1)
    } else {
      setSharpFlat('♮')
      setModify(0)
    }
  }

  const handleTonalityChange = (e: ChangeEvent<HTMLSelectElement>) => {
    if (MODE_LABELS.includes(e.target.value)) {
      setTonality(e.target.value);
      setToneModify(e.target.value === 'Minor' ? 3 : 0)
    } else {
      setTonality(undefined)
    }
  };

  useEffect(()=> {
    if (key != undefined) {
      setKeyAdjust(key + modify + toneModify)
    } else {
      setKeyAdjust(undefined)
    }
  })

  // Number inputs only enforce min/max on the spinner arrows, not typed
  // values, so clamp here — a too-short length would yield a zero-part song.
  const clamp = (value: number | undefined, min: number, max: number) =>
    value === undefined ? undefined : Math.min(max, Math.max(min, value));

  const updateSong = () => {
    if (engine === 'sculpt') {
      const mode = MODES.find(m => MODE_NAMES[m] === tonality) as Mode | undefined;
      dispatch(newSong({
        formId,
        tonic: key !== undefined ? (key + modify + 12) % 12 : undefined,
        mode: key !== undefined ? mode : undefined,
        bpm: clamp(bpm, minBpm, maxBpm),
        targetSeconds: clamp(songLength, minLength, maxLength),
        triplet,
        tuning,
        motifs: useGrooves ? grooves : undefined,
        arrangement: useGrooves ? arrangement : undefined,
        liftFinalChorus,
      }))
      onClose()
      return
    }
    // The classic engine only knows major/minor; a modal key falls back to
    // a random one.
    const classicKey = tonality === 'Major' || tonality === 'Minor';
    dispatch(setSong(generateSong(grooves, arrangement, triplet, classicKey ? keyAdjust : undefined, classicKey ? tonality : undefined, clamp(bpm, minBpm, maxBpm), clamp(songLength, minLength, maxLength), tuning)))
    onClose()
  }

  const sameArrays = (a: number[][], b: number[][]) =>
    a.length === b.length && a.every((row, i) => row.length === b[i].length && row.every((value, j) => value === b[i][j]));

  // True while every control still matches the pre-loaded recipe — the user
  // is effectively asking for "the same song again", which the un-pinned
  // randomness won't deliver. Compared by value so editing a control and
  // putting it back counts as unchanged.
  const recipeUnchanged = engine === 'classic' && params != null &&
    sameArrays(grooves, params.grooves) &&
    sameArrays(arrangement, params.arrangement) &&
    triplet === params.triplet &&
    bpm === params.bpm &&
    songLength === params.songLength &&
    selectedKey === (parsedKey?.letter ?? '') &&
    sharpFlat === (parsedKey?.accidental ?? '♮') &&
    tonality === parsedKey?.tonality &&
    (Object.keys(defaultTuning) as (keyof GenerationTuning)[]).every(key => tuning[key] === recipeTuning[key]);

  const [showShuffleWarning, setShowShuffleWarning] = useState(false);
  const [showAdvancedPanel, setShowAdvancedPanel] = useState(false);
  const shuffleWarningRef = useRef<HTMLDivElement | null>(null);

  // The warning renders at the bottom of a fixed-height, scrollable panel —
  // with the Advanced dials pushing the panel taller, it can appear entirely
  // below the fold. Without this, clicking Regenerate on an unchanged recipe
  // looks like a no-op: the warning fires but nobody scrolls down to see it.
  useEffect(() => {
    if (showShuffleWarning) {
      shuffleWarningRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [showShuffleWarning]);

  // Range, step, and reset value for a dial come from the same tables the
  // sanitizer enforces, so the UI can never offer an out-of-bounds value.
  const dialProps = (key: keyof GenerationTuning) => ({
    ...tuningBounds[key],
    value: tuning[key],
    defaultValue: defaultTuning[key],
    onChange: setTuningField(key),
  });

  const handleRegenerate = () => {
    if (recipeUnchanged) {
      setShowShuffleWarning(true);
    } else {
      updateSong();
    }
  };
  const generateRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (generateRef.current && !generateRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
  
    document.addEventListener("mousedown", handler);
  
    return () => {
      document.removeEventListener("mousedown", handler);
    };
  }, []);

  const combineNumbers = (grooveIndex: number, index: number) => {
    const newGrooves = [...grooves];
    const numberSum = newGrooves[grooveIndex][index] + newGrooves[grooveIndex][index + 1];
    if (
      numberSum === 0.5 ||
      numberSum === 0.75 ||
      numberSum === 1 ||
      numberSum === 1.5 ||
      numberSum === 2
    ) {
      newGrooves[grooveIndex].splice(index, 2, numberSum);
      setGrooves(newGrooves);
    }
  };

  const divideNumbers = (grooveIndex: number, index: number) => {
    const newGrooves = [...grooves];
    if (newGrooves[grooveIndex][index] === 4) {
      newGrooves[grooveIndex].splice(index, 1, 2);
      newGrooves[grooveIndex].splice(index, 0, 2);
    } else if (newGrooves[grooveIndex][index] === 2) {
      newGrooves[grooveIndex].splice(index, 1, 1);
      newGrooves[grooveIndex].splice(index, 0, 1);
    } else if (newGrooves[grooveIndex][index] === 1) {
      newGrooves[grooveIndex].splice(index, 1, 0.5);
      newGrooves[grooveIndex].splice(index, 0, 0.5);
    } else if (newGrooves[grooveIndex][index] === 0.5) {
      newGrooves[grooveIndex].splice(index, 1, 0.25);
      newGrooves[grooveIndex].splice(index, 0, 0.25);
    }
    setGrooves(newGrooves);
  };

  const addGroove = () => {
    const newGrooves = [...grooves, [2, 2, 2, 2]]; // Add a new groove with initial values
    setGrooves(newGrooves);
  };

  const removeGroove = (grooveIndex: number) => {
    const newGrooves = [...grooves];
    newGrooves.splice(grooveIndex, 1); // Remove the groove at the specified index
    setGrooves(newGrooves);
    setArrangement([   
      [0, 0, 0, 0],
      [0, 0, 0, 0],
      [0, 0, 0, 0],])
  };

  const incrementPart = (value: number, partType: number, partNum: number) => {
    const newArr = [...arrangement]
    if (value < grooves.length - 1){
      newArr[partType].splice(partNum, 1, value+1)
      setArrangement(newArr)
    } else {
      newArr[partType].splice(partNum, 1, 0)
      setArrangement(newArr)
    }
  }

  return (
    <div className={styles.generateContainer} ref={generateRef}>
      <button onClick={onClose}>x</button>
      <div>
        <h2>Generate New Song <button onClick={resetDefaults} title="Reset to blank defaults">↺</button></h2>
        <p>
          Engine:{' '}
          <select value={engine} onChange={(e) => setEngine(e.target.value as 'sculpt' | 'classic')}>
            <option value="sculpt">Form-first (sculpt)</option>
            <option value="classic">Classic (groove-driven)</option>
          </select>
        </p>
        {engine === 'sculpt' && (
          <>
            <p>
              Form:{' '}
              <select value={formId} onChange={(e) => setFormId(e.target.value)}>
                {FORM_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </p>
            <p>
              <label>
                <input type="checkbox" checked={liftFinalChorus} onChange={(e) => setLiftFinalChorus(e.target.checked)} />
                {' '}Lift the final chorus up a key
              </label>
            </p>
            <p>
              <label>
                <input type="checkbox" checked={useGrooves} onChange={(e) => setUseGrooves(e.target.checked)} />
                {' '}Build bass rhythms from my grooves below (otherwise each section writes its own motif)
              </label>
            </p>
          </>
        )}
        {(engine === 'classic' || useGrooves) && grooves.map((groove, grooveIndex) => (
          <div key={grooveIndex}>
            <p>Bass Groove {grooveIndex + 1}:</p>
            <span>
              {groove.map((item: number, index: number) => (
                index === groove.length - 1 ? (
                <span key={index}  onClick={() => divideNumbers(grooveIndex, index)}>
                  <span> </span>
                  <img className={styles.resize} src={noteMapping[item]} alt={`Note ${item}`} />
                  <span> </span>
                  </span>
                  ) : (
                <span key={index}>
                  <span onClick={() => divideNumbers(grooveIndex, index)}>
                    <img className={styles.resize} src={noteMapping[item]} alt={`Note ${item}`} />
                  </span>
                  <span> </span>
                  <button
                    className={styles.grooveButton}
                    onClick={() => combineNumbers(grooveIndex, index)}
                  >
                    +
                  </button>
                </span>
                )
              ))}
            </span>
            {grooveIndex > 0 && (
                <button onClick={() => removeGroove(grooveIndex)}>-</button>
            )}
            {grooveIndex < 3 && (
                <button onClick={addGroove}>+</button>
            )}
          </div>
        ))}
        {(engine === 'classic' || useGrooves) && <div>
            <p>Verse Structure:</p>
            <button onClick={() => incrementPart(arrangement[0][0], 0, 0)}>BG: {arrangement[0][0]+1}</button>
            <button onClick={() => incrementPart(arrangement[0][1], 0, 1)}>BG: {arrangement[0][1]+1}</button>
            <button onClick={() => incrementPart(arrangement[0][2], 0, 2)}>BG: {arrangement[0][2]+1}</button>
            <button onClick={() => incrementPart(arrangement[0][3], 0, 3)}>BG: {arrangement[0][3]+1}</button>

            <p>Chorus Structure:</p>
            <button onClick={() => incrementPart(arrangement[1][0], 1, 0)}>BG: {arrangement[1][0]+1}</button>
            <button onClick={() => incrementPart(arrangement[1][1], 1, 1)}>BG: {arrangement[1][1]+1}</button>
            <button onClick={() => incrementPart(arrangement[1][2], 1, 2)}>BG: {arrangement[1][2]+1}</button>
            <button onClick={() => incrementPart(arrangement[1][3], 1, 3)}>BG: {arrangement[1][3]+1}</button>

            <p>Bridge Structure:</p>
            <button onClick={() => incrementPart(arrangement[2][0], 2, 0)}>BG: {arrangement[2][0]+1}</button>
            <button onClick={() => incrementPart(arrangement[2][1], 2, 1)}>BG: {arrangement[2][1]+1}</button>
            <button onClick={() => incrementPart(arrangement[2][2], 2, 2)}>BG: {arrangement[2][2]+1}</button>
            <button onClick={() => incrementPart(arrangement[2][3], 2, 3)}>BG: {arrangement[2][3]+1}</button>
        </div>}
        <p>Triplet Frequency:     
          <input
          type="range"
          min="0"
          max="1"
          step="0.1"
          value={triplet} // Controlled so pre-load and reset move the thumb
          className={styles.circularDial} // Apply your custom dial styles
          onChange={(e) => {
          const newValue = parseFloat(e.target.value);
          setTriplet(newValue)
          }}
        /></p>
        <p>Key (optional): 
          <select id="note" value={selectedKey} onChange = {handleKeyChange}>
            <option></option>
            <option>A</option>
            <option>B</option>
            <option>C</option>
            <option>D</option>
            <option>E</option>
            <option>F</option>
            <option>G</option>
          </select>
          {selectedKey && (
          <select id="modify" value={sharpFlat} onChange={handleModifyChange}>
            <option>♮</option>
            {(selectedKey === "A" || selectedKey === "C" || selectedKey === "D" || selectedKey === "F" || selectedKey === "G") ? (
              <option>#</option>
            ) : (
              null
            )}
            {(selectedKey === "A" || selectedKey === "B" || selectedKey === "D" || selectedKey === "E" || selectedKey === "G") ? (
              <option>♭</option>
            ) : (
              null
            )}
          </select>
          )}
        </p>
        {selectedKey && (
        <p>Tonality:
          <select id="tonality" value={tonality} onChange = {handleTonalityChange}>
            <option>Major</option>
            <option>Minor</option>
            {engine === 'sculpt' && MODE_LABELS.filter(m => m !== 'Major' && m !== 'Minor').map(m => <option key={m}>{m}</option>)}
          </select>
          </p>
        )}
        <p>BPM (optional):
          <input
            className={styles.numberInput}
            type="number"
            min={minBpm}
            max={maxBpm}
            placeholder={`${minBpm}-${maxBpm}`}
            value={bpm ?? ''}
            onChange={(e) => setBpm(e.target.value === '' ? undefined : Number(e.target.value))}
          />
        </p>
        <p title={engine === 'sculpt' ? 'Target length: the form adds or drops whole verse/chorus cycles to get close.' : undefined}>Song Length (optional):
          <input
            className={styles.numberInput}
            type="number"
            min={minLength}
            max={maxLength}
            placeholder={`${minLength}-${maxLength}`}
            value={songLength ?? ''}
            onChange={(e) => setSongLength(e.target.value === '' ? undefined : Number(e.target.value))}
          /> seconds
        </p>
        <br/>
        {showAdvanced && (
          <button onClick={() => setShowAdvancedPanel(prev => !prev)}>Advanced</button>
        )}
        {showAdvancedPanel && (
          <div className={styles.advancedSettings}>
            <p>
              Deep algorithm odds. The × dials scale the generator's dice rolls
              (×1.00 is stock behavior) and every value is clamped to a safe
              range. Drag a dial up or down; double-click resets it.
            </p>
            <p>
              <label>
                Genre:{' '}
                <select value={selectedGenre} onChange={(e) => applyGenre(e.target.value)}>
                  <option value="">Custom</option>
                  {Object.keys(genrePresets).map(genre => (
                    <option key={genre} value={genre}>{genre}</option>
                  ))}
                </select>
              </label>
              {' '}sets every dial below to that genre's starting point; adjusting any dial afterward switches back to Custom.
            </p>
            <p className={styles.dialGroupLabel}>Drum-hit odds</p>
            <div className={styles.dialRow}>
              <Dial
                label="Kick"
                hint="Scales every optional kick: strong-beat, syncopated, and bass-rest kicks. The downbeat accent always lands."
                format={(v) => `×${v.toFixed(2)}`}
                {...dialProps('kickOdds')}
              />
              <Dial
                label="Snare"
                hint="Scales backbeat snares and off-beat ghost hits."
                format={(v) => `×${v.toFixed(2)}`}
                {...dialProps('snareOdds')}
              />
              <Dial
                label="Crash"
                hint="Scales mid-section crashes and section-ending crash accents."
                format={(v) => `×${v.toFixed(2)}`}
                {...dialProps('crashOdds')}
              />
            </div>
            <div className={styles.dialRow}>
              <Dial
                label="Hi-Hat Open"
                hint="How often an eligible hi-hat opens instead of staying closed: 0 keeps every hi-hat closed, ×2 opens almost every one."
                format={(v) => `×${v.toFixed(2)}`}
                {...dialProps('hiHatOpenRate')}
              />
            </div>
            <p className={styles.dialGroupLabel}>Harmony &amp; structure</p>
            <div className={styles.dialRow}>
              <Dial
                label="Chord Substitutions"
                hint="How often plain triads get swapped for substitutions (maj7/m7/9th and borrowed chords): 0 keeps everything diatonic."
                format={(v) => `×${v.toFixed(2)}`}
                {...dialProps('chordSubstitutionRate')}
              />
              <Dial
                label="Chord Changes"
                hint="How eagerly chords change: 0 holds each chord a full two beats, ×2 changes on every beat the bass allows."
                format={(v) => `×${v.toFixed(2)}`}
                {...dialProps('chordChangeRate')}
              />
              <Dial
                label="Part Repeats"
                hint="Longest run of the same Verse/Chorus/Bridge back-to-back: 1 forces strict alternation."
                format={(v) => `max ${v}`}
                {...dialProps('maxPartRepeats')}
              />
            </div>
            <div className={styles.dialRow}>
              <Dial
                label="Chord Voicings"
                hint="Once a chord substitutes, how often it lands on the richer flavor (Dm7, Em7, F7, G7) over the plainer alternate (C9, E major, Fm, B°)."
                format={(v) => `×${v.toFixed(2)}`}
                {...dialProps('chordVoicingRate')}
              />
            </div>
            <p className={styles.dialGroupLabel}>Feel</p>
            <div className={styles.dialRow}>
              <Dial
                label="Triplet Subdivision"
                hint="How often an eligible eighth/sixteenth note swings into a triplet: 0 stays perfectly straight, ×2 swings almost every eligible note."
                format={(v) => `×${v.toFixed(2)}`}
                {...dialProps('tripletSubdivisionRate')}
              />
              <Dial
                label="Bass Tonality"
                hint="When no key is picked, how often the bass leans minor instead of major: 0 always resolves major, ×2 always resolves minor."
                format={(v) => `×${v.toFixed(2)}`}
                {...dialProps('bassTonalityBias')}
              />
            </div>
          </div>
        )}
        <button onClick={handleRegenerate}>Regenerate</button>
        {showShuffleWarning && recipeUnchanged && (
          <div className={styles.shuffleWarning} ref={shuffleWarningRef}>
            <p>
              Every visible setting matches the current song, but the parts of the
              algorithm the menu doesn't expose still get rerolled:
            </p>
            <ul>
              <li>Bass note choices (the grooves only pin the rhythm, not the pitches)</li>
              <li>Drum hit patterns (kick, snare, hi-hat, crash placement)</li>
              <li>Chord change timing, chord substitutions, and voicings</li>
              <li>Bass note accidentals (sharp/flat spelling)</li>
              <li>The Verse/Chorus/Bridge part order and repeat counts</li>
            </ul>
            <button onClick={updateSong}>Regenerate Anyway</button>
            <button onClick={() => setShowShuffleWarning(false)}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
