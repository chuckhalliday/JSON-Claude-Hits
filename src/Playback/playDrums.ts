import { triggerMidi } from "./playFunctions";
import { getAudioContext } from "./audioContext";
import { runPreScheduledSequence, scheduleTimer, Register, SequenceTiming } from "./scheduler";
import { playDrumVoice, keyRootHz } from "./drumSynth";
import { DrumHit } from "../types";

// General MIDI drum notes for every drum-machine row (kick, snare, toms,
// hats, ride, crash).
const MIDI_NOTES: Record<number, number> = {
  0: 36, 1: 38, 2: 45, 3: 47, 4: 50, 5: 42, 6: 46, 7: 51, 8: 49,
};

export default function playBeat(midi: boolean, beat: number, pattern: DrumHit[], groove: number[], bpm: number, stepsRef: DrumHit[][], onStep?: (index: number) => void, shouldStop?: () => boolean, mute?: boolean, acoustic = true, key?: string, timing?: SequenceTiming) {
    const beatDuration = 60 / bpm // duration of one beat in seconds
    const swingRatio = 3/3; // adjust as needed

    let voice = -1;
    for (let v = 0; v < stepsRef.length; v++) {
      if (stepsRef[v] === pattern) { voice = v; break; }
    }
    const midiNote = MIDI_NOTES[voice];
    const rootHz = keyRootHz(key);

    const getDuration = (index: number) => {
      const isEvenSixteenth = index % 4 === 0 || index % 4 === 2;
      return isEvenSixteenth
        ? groove[index] * beatDuration * swingRatio
        : groove[index] * beatDuration;
    };

    const onSchedule = (index: number, time: number, duration: number, register: Register) => {
      let velocity = Math.floor(Math.random() * (70 - 50 + 1) + 50);
      if (pattern[index].accent) {
        velocity = 90;
        if (Math.random() < 0.17) {  // 1 in 6 chance
          velocity = Math.floor(Math.random() * (120 - 100 + 1) + 100);
        }
      }
      const release = Math.floor(Math.random() * (70 - 50 + 1) + 50);

      if (onStep) {
        scheduleTimer(time, () => onStep(index), register);
      }

      if (midiNote === undefined || !pattern[index].checked || mute) return;

      if (!midi) {
        const audioContext = getAudioContext();
        const stop = playDrumVoice(audioContext, audioContext.destination, voice, time, velocity / 100, acoustic, rootHz);
        if (stop) register(stop);
      } else {
        scheduleTimer(time, () => triggerMidi('1', midiNote, duration, velocity, release), register);
      }
    };

    return runPreScheduledSequence(beat, groove.length, getDuration, onSchedule, shouldStop, timing);
  }
