import React, { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { playDrums } from "../Playback/playSong";
import { setDrumState, SongState, setCurrentBeat } from "../reducers";
import { useDispatch, useSelector } from "react-redux";
import { PlayHandle } from "./Piano";
import styles from "../Styles/DrumMachine.module.scss";
import { DrumHit } from "../types";
import { useLampStep } from "../Playback/useLampStep";

interface DrumMachineProps {
  onRenderWidthChange: any;
  part: number;
  lampsRef: React.MutableRefObject<HTMLInputElement[]>;
  onPlayingChange?: (isPlaying: boolean) => void;
  manualSeekEpochRef?: React.MutableRefObject<number>;
}

const DrumMachine = forwardRef<PlayHandle, DrumMachineProps>(function DrumMachine({
  onRenderWidthChange,
  part,
  lampsRef,
  onPlayingChange,
  manualSeekEpochRef,
}, ref) {
  const [isPlaying, setIsPlaying] = React.useState(false);
  const stopRef = useRef(false);
  const dispatch = useDispatch()

  const song = useSelector((state: { song: SongState }) => state.song);
  const bpm = song.bpm
  const start = song.selectedBeat[1]
  const midi = song.midi
  const acoustic = song.acoustic
  const drums = song.songStructure[part].drums
  const steps = song.songStructure[part].stepIds
  const drumGroove = song.songStructure[part].drumGroove
  const bassGroove = song.songStructure[part].bassGroove
  const chordsGroove = song.songStructure[part].chordsGroove
  const numOfSteps = drumGroove.length

  const handleStep = useLampStep(lampsRef, part, drumGroove, bassGroove, chordsGroove);

    // Filled by the checkbox ref callbacks below. (Its initial value used to
    // be a grid of detached <input>s, built on every render and thrown away.)
    const stepsRef = React.useRef<HTMLInputElement[][]>([]);
  
    useEffect(() => {
      for (let trackId = 0; trackId < drums.length; trackId++) {
        for (let i = 0; i < numOfSteps; i++) {
          const inputElement = stepsRef.current[trackId]?.[i];
          // Mirror the store both ways: a re-roll or an edit propagated from
          // another instance of this section can also clear cells.
          if (inputElement && drums[trackId]?.[i]) {
            inputElement.checked = drums[trackId][i].checked === true;
          }
        }
      }
    }, [drums]);
  

  function updateDrumState(trackId: number, stepId: number) {
    const drumHits = {
      index: stepId,
      checked: stepsRef.current[trackId][stepId].checked
    }
    dispatch(setDrumState({ index: part, drumPart: trackId, drumStep: stepId, drums: drumHits }));
  }


  const machineRef = useRef<HTMLDivElement>(null);
  

  let drumFractions: string[] = []

  for (let i = 0; i < drumGroove.length; i++) {
    if (drumGroove[i] === 0.5) {
      drumFractions.push('1/8')
    } else if (drumGroove[i] === 0.25){
      drumFractions.push('1/16')
    } else if (drumGroove[i] === 0.17){
      drumFractions.push('--T')
    } else if (drumGroove[i] === 0.16){
      drumFractions.push('*8T')
    } else if (drumGroove[i] === 0.08){
      drumFractions.push('--T')
    } else if (drumGroove[i] === 0.09){
      drumFractions.push('*16T')
    }
  }

  const tracks: string[] = ["Kick", "Snare", "Low", "Mid", "High", "HiHatC", "HiHatO", "Ride", "Crash"]

  //Array of different sounds
  const trackIds = [...Array(tracks.length).keys()];
  //Array of beats
  const stepIds = [...steps.keys()]


  const handleStartClick = async () => {
    if (isPlaying) {
      stopRef.current = true;
      setIsPlaying(false);
      onPlayingChange?.(false);
      return;
    }

    // Play the store's pattern (the checkboxes mirror it). Reading the DOM
    // here could pick up stale cells after a re-roll shortened the grid.
    const drumHits: DrumHit[][] = drums;
    stopRef.current = false;
    setIsPlaying(true);
    onPlayingChange?.(true);
    const endBeat = await playDrums(bpm, midi, start, drumGroove, drumHits, handleStep, () => stopRef.current, acoustic, song.key);
    setIsPlaying(false);
    onPlayingChange?.(false);
    const nextBeat = endBeat >= drumGroove.length ? 0 : endBeat;
    dispatch(setCurrentBeat([part, nextBeat, song.selectedBeat[2], song.selectedBeat[3]]));
  };

  useImperativeHandle(ref, () => ({
    play: handleStartClick
  }));

  function addSpacingToRows(step: number) {
    let sum = 0;
    let measure
    let beat
  
    for (let i = 0; i < step; i++) {
      sum += drumGroove[i];
      if (sum >= 3.93 && sum <= 4.07) {
        measure = 'true'
        sum = 0
      } else if (Math.abs(sum - Math.round(sum)) <= 0.005) {
        beat = 'true'
      } else {
        measure = 'false'
        beat = 'false'
      }
    }
    return {
      measure: measure,
      beat: beat
    }
  }

  useEffect(() => {
    if (machineRef.current) {
      const width = machineRef.current.scrollWidth;
      onRenderWidthChange(width);
    }
  }, [onRenderWidthChange]);

  return (
    <div className={styles.machine} ref={machineRef}>
      {/* Renders titles */}
      <div className={styles.labelList}>
        <div>Crash</div>
        <div>Ride</div>
        <div>Open Hat</div>
        <div>Closed Hat</div>
        <div>High Tom</div>
        <div>Mid Tom</div>
        <div>Low Tom</div>
        <div>Snare</div>
        <div>Kick</div>
      </div>
  
      <div className={styles.grid}>
        {/* Renders ticks */}
        <div className={styles.row}>
          {stepIds.map((stepId) => {
            const measure = addSpacingToRows(stepId + 1).measure
            const beat = addSpacingToRows(stepId + 1).beat
            return(
            <label key={stepId} className={styles.lamp} measure-end={measure} beat-end={beat}>
              <label className={styles.grooveLabel}>
                {drumFractions[stepId]}
              </label>
              <input
                type="radio"
                name="lamp"
                id={stepId.toString()}
                ref={(elm) => {
                  if (!elm) return;
                  lampsRef.current[stepId] = elm;
                }}
                className={styles.lamp__input}
                onClick={() => {
                  // Not onChange: handleStep mutates lamp.checked directly (see
                  // useLampStep) to avoid a re-render on every playback step.
                  // That bypasses React's change-detection tracker for radios,
                  // so a manual click on a lamp the playhead already visited
                  // can look like a no-op change and silently drop onChange.
                  // onClick fires unconditionally and isn't affected.
                  if (manualSeekEpochRef) {
                    manualSeekEpochRef.current++;
                  }
                  handleStep(stepId);
                }}
              />
              <div className={styles.lamp__content} />
            </label>
            )
          })}
        </div>
  
        {/* Renders buttons */}
        <div className={styles.cellList}>
          {trackIds.reverse().map((trackId) => (
            <div key={trackId} className={styles.row}>
              {stepIds.map((stepId) => {
                const id = trackId + '-' + stepId;
                const measure = addSpacingToRows(stepId + 1).measure
                const beat = addSpacingToRows(stepId + 1).beat
                return (
                  <label className={styles.cell} key={id} measure-end={measure} beat-end={beat}>
                    <input
                      key={id}
                      id={id}
                      type="checkbox"
                      ref={(elm) => {
                        if (!elm) return;
                        if (!stepsRef.current[trackId]) {
                          stepsRef.current[trackId] = [];
                        }
                        stepsRef.current[trackId][stepId] = elm;
                      }}
                      className={styles.cell__input}
                      onChange={() => updateDrumState(trackId, stepId)}
                    />
                    <div className={styles.cell__content} />
                  </label>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export default DrumMachine;
