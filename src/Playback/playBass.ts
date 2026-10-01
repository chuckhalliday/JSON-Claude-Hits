import { triggerMidi } from "./playFunctions";
import { indexToLamp } from "../SongStructure/beatMapping";
import { getAudioContext } from "./audioContext";
import { runPreScheduledSequence, scheduleTimer, Register, SequenceTiming } from "./scheduler";
import { NoteLocation } from "../types";

const distortionAmount = 30; // Adjust distortion amount as needed
const distortionCurve = new Float32Array(65536);
for (let i = 0; i < 65536; i++) {
  const x = (i - 32768) / 32768;
  distortionCurve[i] = Math.tanh(x * distortionAmount);
}

// "Synth" voice: the original growly, distorted saw + harmonics patch.
function playSynthBassOsc(audioContext: AudioContext, startTime: number, bass: number, duration: number, _velocity: number, _release: number): OscillatorNode[] {
    const osc = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const filterNode = audioContext.createBiquadFilter();

    const fundamentalFreq = bass;

    const harmonics = [1.5, 2, 3]; // Additional harmonics
    const harmonicGains = [0.2, 0.1, 0.05]; // Gain values for harmonics

    osc.type = "sawtooth";
    osc.frequency.value = fundamentalFreq;

    osc.connect(gainNode);
    gainNode.connect(filterNode);
    filterNode.connect(audioContext.destination);

    const oscillators: OscillatorNode[] = [osc];

    for (let i = 0; i < harmonics.length; i++) {
      const harmonicOsc = audioContext.createOscillator();
      harmonicOsc.type = "sine";
      harmonicOsc.frequency.value = fundamentalFreq * harmonics[i];
      const harmonicGainNode = audioContext.createGain();
      harmonicGainNode.gain.value = harmonicGains[i];
      harmonicOsc.connect(harmonicGainNode);
      harmonicGainNode.connect(filterNode);
      harmonicOsc.start(startTime);
      harmonicOsc.stop(startTime + duration);
      harmonicOsc.onended = () => {
        harmonicOsc.disconnect();
        harmonicGainNode.disconnect();
      };
      oscillators.push(harmonicOsc);
    }

    const attackTime = 0.01;
    const releaseTime = 0.05;

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.2, startTime + attackTime);
    gainNode.gain.linearRampToValueAtTime(0, startTime + duration - releaseTime);

    filterNode.type = "lowpass";
    filterNode.frequency.value = 800;

    const distortion = audioContext.createWaveShaper();
    distortion.curve = distortionCurve;
    gainNode.connect(distortion);
    distortion.connect(filterNode);

    osc.start(startTime);
    osc.stop(startTime + duration + releaseTime);
    osc.onended = () => {
      osc.disconnect();
      gainNode.disconnect();
      filterNode.disconnect();
      distortion.disconnect();
    };

    return oscillators;
  }

  // "Acoustic" voice: smooth plucked bass - saw + detuned saw for thickness, a unison
  // sine and a true sub-octave sine for a full, round low end, and a filter envelope
  // that opens bright on the pluck and settles into a warm sustain.
  function playAcousticBassOsc(audioContext: AudioContext, startTime: number, bass: number, duration: number, _velocity: number, _release: number): OscillatorNode[] {
    const fundamentalFreq = bass;

    const osc = audioContext.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = fundamentalFreq;

    const detuneOsc = audioContext.createOscillator();
    detuneOsc.type = "sawtooth";
    detuneOsc.frequency.value = fundamentalFreq;
    detuneOsc.detune.value = 8;
    const detuneGain = audioContext.createGain();
    detuneGain.gain.value = 0.6;

    const subOsc = audioContext.createOscillator();
    subOsc.type = "sine";
    subOsc.frequency.value = fundamentalFreq;
    const subGain = audioContext.createGain();
    subGain.gain.value = 0.6;

    const subOctaveOsc = audioContext.createOscillator();
    subOctaveOsc.type = "sine";
    subOctaveOsc.frequency.value = fundamentalFreq / 2;
    const subOctaveGain = audioContext.createGain();
    subOctaveGain.gain.value = 0.5;

    const gainNode = audioContext.createGain();
    const filterNode = audioContext.createBiquadFilter();
    filterNode.type = "lowpass";
    filterNode.Q.value = 0.8;

    // Compressor lets the note sit louder without the combined layers clipping.
    const compressor = audioContext.createDynamicsCompressor();
    compressor.threshold.value = -22;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.18;

    osc.connect(filterNode);
    detuneOsc.connect(detuneGain);
    detuneGain.connect(filterNode);
    subOsc.connect(subGain);
    subGain.connect(filterNode);
    subOctaveOsc.connect(subOctaveGain);
    subOctaveGain.connect(filterNode);
    filterNode.connect(gainNode);
    gainNode.connect(compressor);
    compressor.connect(audioContext.destination);

    // Filter opens bright on the pluck, then decays quickly into a warm, smooth sustain.
    const sweepTime = Math.min(0.22, duration * 0.6);
    const brightCutoff = Math.min(fundamentalFreq * 10, 3200);
    const darkCutoff = Math.max(fundamentalFreq * 2.2, 220);
    filterNode.frequency.setValueAtTime(brightCutoff, startTime);
    filterNode.frequency.exponentialRampToValueAtTime(darkCutoff, startTime + sweepTime);

    // Amplitude follows a natural plucked-string decay rather than a held sustain.
    const attackTime = 0.004;
    const peakLevel = 0.75;
    const decayFloor = 0.001;
    const releaseTime = Math.min(0.06, duration * 0.3);
    const decayEnd = Math.max(startTime + attackTime + 0.01, startTime + duration - releaseTime);
    const noteEnd = decayEnd + releaseTime;

    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(peakLevel, startTime + attackTime);
    gainNode.gain.exponentialRampToValueAtTime(decayFloor, decayEnd);
    gainNode.gain.linearRampToValueAtTime(0, noteEnd);

    const oscillators: OscillatorNode[] = [osc, detuneOsc, subOsc, subOctaveOsc];

    for (const o of oscillators) o.start(startTime);
    for (const o of oscillators) o.stop(noteEnd);
    osc.onended = () => {
      for (const o of oscillators) o.disconnect();
      detuneGain.disconnect();
      subGain.disconnect();
      subOctaveGain.disconnect();
      gainNode.disconnect();
      filterNode.disconnect();
      compressor.disconnect();
    };

    return oscillators;
  }

  function playBass(midi: boolean, beat: number, pattern: NoteLocation[], groove: number[], bpm: number, shouldStop?: () => boolean, onStep?: (lampIndex: number) => void, drumGroove?: number[], mute?: boolean, acoustic = true, timing?: SequenceTiming) {
    const beatDuration = 60 / bpm; // duration of one beat in seconds
    const audioContext = getAudioContext();

    const getDuration = (index: number) => groove[index] * beatDuration;

    const onSchedule = (index: number, time: number, duration: number, register: Register) => {
      if (onStep && drumGroove) {
        const lampIndex = indexToLamp(groove, index, drumGroove);
        scheduleTimer(time, () => onStep(lampIndex), register);
      }

      const velocity = Math.floor(Math.random() * (70 - 50 + 1) + 50);
      const release = Math.floor(Math.random() * (70 - 50 + 1) + 50);
      // Read the note's pre-computed pitch. The staff→pitch mapping now lives in
      // bassPitch() at generation/edit time, so the scheduler no longer inspects
      // pixel coordinates.
      const bass = midi ? pattern[index].midi : pattern[index].osc;

      if (bass <= 0 || mute) return;

      if (!midi) {
        const playOsc = acoustic ? playAcousticBassOsc : playSynthBassOsc;
        const oscillators = playOsc(audioContext, time, bass, duration, velocity, release);
        register(() => {
          for (const o of oscillators) {
            try { o.stop(); } catch { /* already stopped */ }
          }
        });
      } else {
        scheduleTimer(time, () => triggerMidi('2', bass, duration, velocity, release), register);
      }
    };

    return runPreScheduledSequence(beat, pattern.length, getDuration, onSchedule, shouldStop, timing);
  }

  export default playBass;
