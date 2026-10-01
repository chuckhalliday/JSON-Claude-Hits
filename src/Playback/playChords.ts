import { triggerMidi } from "./playFunctions";
import { indexToLamp } from "../SongStructure/beatMapping";
import { getAudioContext } from "./audioContext";
import { runPreScheduledSequence, scheduleTimer, Register, SequenceTiming } from "./scheduler";
import { ChordTones } from "../types";

// "Synth" voice: the original single sawtooth with a flat attack/decay/sustain/release envelope.
function scheduleSynthChordNote(audioContext: AudioContext, gainNode: GainNode, tone: number, now: number, duration: number, register: Register) {
  const sustainLevel = 0.4;
  const minSegment = 0.001;
  const attackTime = Math.max(minSegment, Math.min(0.02, duration * 0.25));
  const decayTime = Math.max(minSegment, Math.min(0.02, duration * 0.25));
  const releaseTime = Math.max(minSegment, Math.min(0.05, duration * 0.25));
  const attackEnd = now + attackTime;
  const decayEnd = attackEnd + decayTime;
  const releaseStart = Math.max(decayEnd + minSegment, now + duration - releaseTime);
  const noteEnd = Math.max(releaseStart + minSegment, now + duration);

  const osc = audioContext.createOscillator();
  osc.frequency.value = tone;
  osc.type = 'sawtooth';
  const envelope = audioContext.createGain();
  osc.connect(envelope);
  envelope.connect(gainNode);

  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(0.6, attackEnd);
  envelope.gain.linearRampToValueAtTime(sustainLevel, decayEnd);
  envelope.gain.setValueAtTime(sustainLevel, releaseStart);
  envelope.gain.linearRampToValueAtTime(0, noteEnd);

  osc.start(now);
  osc.stop(noteEnd);
  osc.onended = () => {
    osc.disconnect();
    envelope.disconnect();
  };
  register(() => { try { osc.stop(); } catch { /* already stopped */ } });
}

// "Acoustic" voice: fundamental plus detuned upper partials approximate a piano's
// slightly-detuned unison strings and inharmonic overtone shimmer, with a filter
// envelope (bright hammer strike -> mellow decay) and a continuous exponential decay
// instead of a held sustain.
function scheduleAcousticChordNote(audioContext: AudioContext, gainNode: GainNode, tone: number, now: number, duration: number, register: Register) {
  const minSegment = 0.001;
  const attackTime = Math.max(minSegment, Math.min(0.012, duration * 0.1));
  const releaseTime = Math.max(minSegment, Math.min(0.15, duration * 0.4));
  const attackEnd = now + attackTime;
  const decayEnd = Math.max(attackEnd + minSegment, now + duration - releaseTime);
  const noteEnd = decayEnd + releaseTime;

  const osc1 = audioContext.createOscillator();
  osc1.type = 'triangle';
  osc1.frequency.value = tone;

  const osc2 = audioContext.createOscillator();
  osc2.type = 'sine';
  osc2.frequency.value = tone * 2.003;
  const osc2Gain = audioContext.createGain();
  osc2Gain.gain.value = 0.15;

  const osc3 = audioContext.createOscillator();
  osc3.type = 'sine';
  osc3.frequency.value = tone * 3.006;
  const osc3Gain = audioContext.createGain();
  osc3Gain.gain.value = 0.06;

  const noteFilter = audioContext.createBiquadFilter();
  noteFilter.type = 'lowpass';
  noteFilter.Q.value = 0.5;
  const brightCutoff = Math.min(tone * 6, 6000);
  const darkCutoff = Math.max(tone * 2, 800);
  noteFilter.frequency.setValueAtTime(brightCutoff, now);
  noteFilter.frequency.exponentialRampToValueAtTime(darkCutoff, now + Math.min(duration, 1.2));

  const envelope = audioContext.createGain();
  osc1.connect(envelope);
  osc2.connect(osc2Gain);
  osc2Gain.connect(envelope);
  osc3.connect(osc3Gain);
  osc3Gain.connect(envelope);
  envelope.connect(noteFilter);
  noteFilter.connect(gainNode);

  envelope.gain.setValueAtTime(0, now);
  envelope.gain.linearRampToValueAtTime(0.5, attackEnd);
  envelope.gain.exponentialRampToValueAtTime(0.001, decayEnd);
  envelope.gain.linearRampToValueAtTime(0, noteEnd);

  osc1.start(now);
  osc2.start(now);
  osc3.start(now);
  osc1.stop(noteEnd);
  osc2.stop(noteEnd);
  osc3.stop(noteEnd);
  osc1.onended = () => {
    osc1.disconnect();
    osc2.disconnect();
    osc3.disconnect();
    osc2Gain.disconnect();
    osc3Gain.disconnect();
    envelope.disconnect();
    noteFilter.disconnect();
  };
  register(() => {
    try { osc1.stop(); } catch { /* already stopped */ }
    try { osc2.stop(); } catch { /* already stopped */ }
    try { osc3.stop(); } catch { /* already stopped */ }
  });
}

export default async function playChords(midi: boolean, beat: number, pattern: string[], chords: ChordTones, groove: number[], bpm: number, shouldStop?: () => boolean, onStep?: (lampIndex: number) => void, drumGroove?: number[], mute?: boolean, acoustic = true, timing?: SequenceTiming, end?: number) {
    const beatDuration = 60 / bpm; // duration of one beat in seconds
    const audioContext = getAudioContext();

    const getDuration = (index: number) => groove[index] * beatDuration;

    const scheduleLamp = (index: number, time: number, register: Register) => {
      if (onStep && drumGroove) {
        const lampIndex = indexToLamp(groove, index, drumGroove);
        scheduleTimer(time, () => onStep(lampIndex), register);
      }
    };

    if (!midi) {
      const gainNode = audioContext.createGain();
      // The acoustic voice carries its own per-note filter envelope, so the master
      // bus stays unfiltered for it; the synth voice relies on a shared tone filter.
      const filterNode = acoustic ? null : audioContext.createBiquadFilter();
      if (filterNode) {
        filterNode.type = 'lowpass';
        filterNode.frequency.value = 1000;
        gainNode.connect(filterNode);
        filterNode.connect(audioContext.destination);
      } else {
        gainNode.connect(audioContext.destination);
      }

      const scheduleNote = acoustic ? scheduleAcousticChordNote : scheduleSynthChordNote;

      const onSchedule = (index: number, time: number, duration: number, register: Register) => {
        scheduleLamp(index, time, register);
        if (pattern[index] === '-' || mute) return;

        const chordTones = chords.oscTones[index];
        const now = time;

        for (const tone of chordTones) {
          scheduleNote(audioContext, gainNode, tone, now, duration, register);
        }
      };

      const finalIndex = await runPreScheduledSequence(beat, end ?? pattern.length, getDuration, onSchedule, shouldStop, timing);
      // With a lookahead the sequence resolves before its last chords finish,
      // so leave the bus connected until they (and their release) have rung out.
      const ringOut = Math.max(0, (timing?.endTime ?? 0) - audioContext.currentTime) + 1;
      setTimeout(() => {
        gainNode.disconnect();
        filterNode?.disconnect();
      }, ringOut * 1000);
      return finalIndex;
    } else {
      const velocity = Math.floor(Math.random() * (70 - 50 + 1) + 50);
      const release = Math.floor(Math.random() * (70 - 50 + 1) + 50);

      const onSchedule = (index: number, time: number, duration: number, register: Register) => {
        scheduleLamp(index, time, register);
        if (pattern[index] === '-' || mute) return;
        const chordTones = chords.midiTones[index];
        for (const note of chordTones) {
          scheduleTimer(time, () => triggerMidi('3', note, duration, velocity, release), register);
        }
      };

      return runPreScheduledSequence(beat, end ?? pattern.length, getDuration, onSchedule, shouldStop, timing);
    }
  }
