import { generateDoc, regenerateLayer, setLock, setInstanceEnergy } from './generate';
import { realizeSong, realizeSection } from './realize';
import { editBass, editChordTone, editDrum } from './edits';
import { FORM_TEMPLATES, formTemplate, resolveOrder } from './form';
import { keyName, keyScale, spelledName, spellPc, spellInChord, chordSymbol, chordTones, chordBassPc, MODES, Mode, romanNumeral, BASS_MIN, BASS_MAX, VOICING_MIN, VOICING_MAX, ChordEvent } from './theory';
import { normalizeMotif } from './rhythm';
import { songToMidi, parseKeyString, metricLevel, velocity, BASS_VELOCITY, DRUM_VELOCITY, GM_DRUMS } from './exportMidi';
import { readMidiFile } from './midiFile';
import { stepsToLegacyBeats, beatsToTickPositions, PPQ, BAR } from './time';
import { bassPitch } from '../SongStructure/bassPitch';
import { createRandomSong } from '../SongStructure/createSong';
import { SongDoc, CRASH, SNARE } from './doc';

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

describe('theory', () => {
  it('spells key scales with one letter per degree', () => {
    expect(keyScale({ tonic: 1, mode: 'minor' }).map(spelledName)).toEqual(['C#', 'D#', 'E', 'F#', 'G#', 'A', 'B']);
    expect(keyScale({ tonic: 3, mode: 'major' }).map(spelledName)).toEqual(['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D']);
    expect(keyScale({ tonic: 2, mode: 'dorian' }).map(spelledName)).toEqual(['D', 'E', 'F', 'G', 'A', 'B', 'C']);
    expect(keyName({ tonic: 10, mode: 'mixolydian' })).toBe('Bb Mixolydian');
  });

  it('spells chromatic notes by the key signature and never uses Cb/Fb/E#/B#', () => {
    expect(spelledName(spellPc(1, { tonic: 0, mode: 'major' }))).toBe('C#');
    expect(spelledName(spellPc(1, { tonic: 5, mode: 'major' }))).toBe('Db');
    for (let tonic = 0; tonic < 12; tonic++) {
      for (const mode of MODES) {
        for (let pc = 0; pc < 12; pc++) {
          expect(['Cb', 'Fb', 'E#', 'B#']).not.toContain(spelledName(spellPc(pc, { tonic, mode })));
        }
      }
    }
  });

  it('spells chord tones from the chord root and raises 6/7 in minor', () => {
    const gMinor = { tonic: 7, mode: 'minor' as Mode };
    const d = { root: 7, quality: 'maj' as const };
    expect(spelledName(spellInChord(6, d, gMinor))).toBe('F#');
    expect(spelledName(spellPc(6, gMinor))).toBe('F#');
    // D7 (V7/V) in C: its third is F#.
    expect(spelledName(spellInChord(6, { root: 2, quality: '7' }, { tonic: 0, mode: 'major' }))).toBe('F#');
    // A7 (V7/ii) in C: C# not Db. Borrowed bVI in C is Ab (with Eb), not G#.
    expect(spelledName(spellInChord(1, { root: 9, quality: '7' }, { tonic: 0, mode: 'major' }))).toBe('C#');
    expect(spelledName(spellInChord(3, { root: 8, quality: 'maj' }, { tonic: 0, mode: 'major' }))).toBe('Eb');
    expect(chordSymbol({ start: 0, dur: 1, root: 7, quality: 'maj', inversion: 1, fn: 'D' }, gMinor)).toBe('D/F#');
    expect(chordSymbol({ start: 0, dur: 1, root: 8, quality: 'maj', inversion: 0, fn: 'PD' }, { tonic: 0, mode: 'major' })).toBe('Ab');
    expect(chordSymbol({ start: 0, dur: 1, root: 1, quality: '7', inversion: 0, fn: 'D' }, { tonic: 0, mode: 'major' })).toBe('Db7');
  });

  it('labels Roman numerals against the mode', () => {
    const c = (root: number, quality: ChordEvent['quality'], extra: Partial<ChordEvent> = {}): ChordEvent =>
      ({ start: 0, dur: BAR, root, quality, inversion: 0, fn: 'T', ...extra });
    expect(romanNumeral(c(7, '7'), 'major')).toBe('V7');
    expect(romanNumeral(c(2, 'min'), 'major')).toBe('ii');
    expect(romanNumeral(c(3, 'maj'), 'minor')).toBe('III');
    expect(romanNumeral(c(3, 'maj'), 'major')).toBe('bIII');
    expect(romanNumeral(c(9, '7', { appliedTo: 2 }), 'major')).toBe('V7/ii');
    expect(romanNumeral(c(0, 'maj', { inversion: 1 }), 'major')).toBe('I6');
    expect(romanNumeral(c(7, '7', { inversion: 1 }), 'major')).toBe('V6/5');
    expect(romanNumeral(c(2, '7', { inversion: 2, appliedTo: 7 }), 'major')).toBe('V4/3/V');
  });
});

describe('time', () => {
  it('round-trips triplet steps through the legacy beat form exactly', () => {
    const steps = [480, 160, 160, 160, 240, 80, 80, 80, 960];
    const beats = stepsToLegacyBeats(steps);
    expect(beats).toEqual([0.5, 0.16, 0.17, 0.17, 0.25, 0.09, 0.08, 0.08, 1]);
    const positions = beatsToTickPositions(beats);
    expect(positions.slice(1).map((p, i) => p - positions[i])).toEqual(steps);
  });

  it('normalizes edited grooves to exactly two bars on the half-bar grid', () => {
    for (const groove of [[2, 2, 2, 2], [0.5, 2, 1.5, 2, 2], [1, 1, 1], [2, 2, 2, 2, 2, 2]]) {
      const ticks = normalizeMotif(groove);
      expect(sum(ticks)).toBe(2 * BAR);
      let pos = 0;
      for (const d of ticks) {
        expect(Math.floor(pos / (2 * PPQ))).toBe(Math.floor((pos + d - 1) / (2 * PPQ)));
        pos += d;
      }
    }
  });
});

describe('form', () => {
  it('fits a target length by whole loop segments', () => {
    const t = formTemplate('pop');
    const short = resolveOrder(t, 120, 120, 3);
    const long = resolveOrder(t, 120, 300, 3);
    expect(long.length).toBeGreaterThan(short.length);
    expect(long[0].label).toBe('Intro');
    expect(long[long.length - 1].label).toBe('Outro');
  });

  it('caps back-to-back repeats with the Part Repeats dial', () => {
    const order = resolveOrder(formTemplate('pop'), 120, undefined, 1);
    order.forEach((e, i) => i > 0 && expect(e.label).not.toBe(order[i - 1].label));
  });
});

const docs: Array<[string, SongDoc]> = [];
for (const template of FORM_TEMPLATES) {
  for (const mode of ['major', 'minor', 'dorian', 'mixolydian'] as Mode[]) {
    for (const seed of [1, 2, 3]) {
      docs.push([`${template.id}/${mode}/${seed}`, generateDoc({ seed, formId: template.id, mode, tonic: (seed * 5) % 12, triplet: seed === 3 ? 1 : 0 })]);
    }
  }
}

describe('generateDoc', () => {
  it('is reproducible from its seed', () => {
    const a = generateDoc({ seed: 42 });
    const b = generateDoc({ seed: 42 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(generateDoc({ seed: 43 }))).not.toBe(JSON.stringify(a));
  });

  it.each(docs)('%s: every layer of every section lines up in time', (_, doc) => {
    for (const s of Object.values(doc.sections)) {
      const length = s.bars * BAR;
      expect(sum(s.harmony.map(c => c.dur))).toBe(length);
      expect(sum(s.bassRhythm)).toBe(length);
      expect(sum(s.drumSteps)).toBe(length);
      expect(s.bass.length).toBe(s.bassRhythm.length);
      expect(s.voicing.length).toBe(s.harmony.length);
      expect(s.guideTones.length).toBe(s.harmony.length);
      s.drums.forEach(row => expect(row.length).toBe(s.drumSteps.length));
      // Every chord change lands on a bass onset.
      const onsets = new Set<number>();
      s.bassRhythm.reduce((pos, d) => (onsets.add(pos), pos + d), 0);
      s.harmony.forEach(c => expect(onsets.has(c.start)).toBe(true));
    }
  });

  it.each(docs)('%s: bass is realized from the harmony, in range', (_, doc) => {
    for (const s of Object.values(doc.sections)) {
      let pos = 0;
      s.bassRhythm.forEach((d, i) => {
        const midi = s.bass[i];
        const chord = s.harmony.find(c => c.start === pos);
        if (midi > 0) {
          expect(midi).toBeGreaterThanOrEqual(BASS_MIN);
          expect(midi).toBeLessThanOrEqual(BASS_MAX);
        }
        if (chord) expect(((midi - doc.key.tonic) % 12 + 12) % 12).toBe(chordBassPc(chord));
        pos += d;
      });
    }
  });

  it.each(docs)('%s: voicings hold the chord tones in the piano range', (_, doc) => {
    for (const s of Object.values(doc.sections)) {
      s.harmony.forEach((c, i) => {
        const v = s.voicing[i];
        expect(v.length).toBeGreaterThanOrEqual(3);
        v.forEach(m => {
          expect(m).toBeGreaterThanOrEqual(VOICING_MIN);
          expect(m).toBeLessThanOrEqual(VOICING_MAX);
        });
        const pcs = new Set(v.map(m => ((m - doc.key.tonic) % 12 + 12) % 12));
        const tones = chordTones(c);
        tones.forEach(t => (t === tones[2] && tones.length === 4 ? null : expect(pcs.has(t)).toBe(true)));
      });
    }
  });

  it('keeps voice leading smooth', () => {
    let moves = 0;
    let voices = 0;
    for (const [, doc] of docs) {
      for (const s of Object.values(doc.sections)) {
        for (let i = 1; i < s.voicing.length; i++) {
          const a = s.voicing[i - 1];
          const b = s.voicing[i];
          for (let k = 0; k < Math.min(a.length, b.length); k++) {
            moves += Math.abs(a[k] - b[k]);
            voices++;
          }
        }
      }
    }
    expect(moves / voices).toBeLessThan(3);
  });

  it('lands sections on their cadences in major and minor', () => {
    for (const [name, doc] of docs) {
      if (doc.key.mode !== 'major' && doc.key.mode !== 'minor') continue;
      if (doc.formId === 'blues') continue;
      for (const s of Object.values(doc.sections)) {
        const last = s.harmony[s.harmony.length - 1];
        const prev = s.harmony[s.harmony.length - 2];
        if (s.cadence === 'authentic') {
          expect([name, last.root]).toEqual([name, 0]);
          expect([name, [7, 1, 10]]).toEqual([name, expect.arrayContaining([prev.root])]);
        }
        if (s.cadence === 'half') expect([name, last.fn]).toEqual([name, 'D']);
        if (s.cadence === 'plagal') expect([name, last.root]).toEqual([name, 0]);
      }
    }
  });

  it('uses the 12-bar changes for the blues form', () => {
    const doc = generateDoc({ seed: 9, formId: 'blues', tonic: 7, mode: 'major' });
    const verse = doc.sections['verse'];
    expect(verse.harmony.map(c => c.root)).toEqual(expect.arrayContaining([0, 5, 7]));
    expect(verse.harmony[4].root).toBe(5);
    expect(verse.harmony[8].root).toBe(7);
  });

  it('lifts the final chorus run when asked', () => {
    const doc = generateDoc({ seed: 5, formId: 'pop', liftFinalChorus: true });
    const lifted = doc.form.filter(f => f.transpose !== 0);
    expect(lifted.length).toBeGreaterThan(0);
    expect(lifted[0].sectionId).toBe('chorus');
    expect(doc.form[0].transpose).toBe(0);
  });
});

describe('regenerateLayer and locks', () => {
  const base = generateDoc({ seed: 11, formId: 'pop', tonic: 2, mode: 'major' });

  it('re-rolling chorus drums changes nothing else', () => {
    const next = regenerateLayer(base, 'chorus', 'drums');
    expect(next.sections.chorus.drums).not.toEqual(base.sections.chorus.drums);
    expect(next.sections.chorus.harmony).toEqual(base.sections.chorus.harmony);
    expect(next.sections.chorus.bass).toEqual(base.sections.chorus.bass);
    for (const id of Object.keys(base.sections).filter(id => id !== 'chorus')) {
      expect(next.sections[id]).toEqual(base.sections[id]);
    }
  });

  it('re-rolling harmony rebuilds unlocked bass and voicing, keeps locked ones', () => {
    let doc = base;
    for (let i = 0; i < 5 && JSON.stringify(doc.sections.verse.harmony) === JSON.stringify(base.sections.verse.harmony); i++) {
      doc = regenerateLayer(doc, 'verse', 'harmony');
    }
    expect(doc.sections.verse.harmony).not.toEqual(base.sections.verse.harmony);
    expect(doc.sections.verse.bassRhythm).toEqual(base.sections.verse.bassRhythm);

    const locked = setLock(base, 'verse', 'bass', true);
    let rerolled = locked;
    for (let i = 0; i < 5; i++) rerolled = regenerateLayer(rerolled, 'verse', 'harmony');
    expect(rerolled.sections.verse.bass).toEqual(base.sections.verse.bass);
  });

  it('a locked layer refuses to re-roll', () => {
    const locked = setLock(base, 'chorus', 'drums', true);
    expect(regenerateLayer(locked, 'chorus', 'drums')).toBe(locked);
  });

  it('keeps a locked bass line when the rhythm under it changes', () => {
    const locked = setLock(base, 'verse', 'bass', true);
    const next = regenerateLayer(locked, 'verse', 'rhythm');
    expect(next.sections.verse.bass.length).toBe(next.sections.verse.bassRhythm.length);
    const pitches = new Set(base.sections.verse.bass);
    next.sections.verse.bass.forEach(m => expect(pitches.has(m)).toBe(true));
  });
});

describe('realizeSong', () => {
  it.each(docs)('%s: parts are consistent views of the document', (_, doc) => {
    const parts = realizeSong(doc);
    expect(parts.length).toBe(doc.form.length);
    let step = 0;
    parts.forEach(p => {
      const beats = doc.sections[p.sectionId!].bars * 4;
      expect(near(sum(p.bassGroove), beats)).toBe(true);
      expect(near(sum(p.drumGroove), beats)).toBe(true);
      expect(near(sum(p.chordsGroove), beats)).toBe(true);
      expect(p.bassNoteLocations.length).toBe(p.bassGroove.length);
      expect(p.bassNoteLocations.every(l => Number.isFinite(l.x))).toBe(true);
      expect(p.chordsLocation.length).toBe(p.chords.length);
      expect(p.chordTones.midiTones.length).toBe(p.chordsGroove.length);
      expect(p.stepIds[0]).toBe(step);
      step += p.drumGroove.length;
      // The staff position and accidental decode back to the same pitch.
      p.bassNoteLocations.forEach((l, k) => {
        const expected = doc.sections[p.sectionId!].bass[k];
        if (expected > 0) {
          expect(bassPitch(l.y, l.acc).midi).toBe(l.midi);
          expect(p.bass[k]).not.toBe('-');
        } else {
          expect(l.midi).toBeLessThanOrEqual(0);
        }
      });
    });
  });

  it('adds crashes and fills at section transitions', () => {
    const doc = generateDoc({ seed: 3, formId: 'pop', tuning: { crashOdds: 2 } });
    const parts = realizeSong(doc);
    const intoChorus = parts.findIndex((p, i) => i > 0 && p.type === 'Chorus' && parts[i - 1].type !== 'Chorus');
    expect(parts[intoChorus].drums[CRASH][0].checked).toBe(true);
    const before = parts[intoChorus - 1];
    const last = before.drums.map(row => row[row.length - 1].checked);
    expect(last.slice(1, 5).some(Boolean)).toBe(true); // snare or a tom ends the fill
  });

  it('instance energy changes only that instance', () => {
    const doc = generateDoc({ seed: 4, formId: 'verse-chorus' });
    const i = doc.form.findIndex(f => f.sectionId === 'verse');
    const parts = realizeSong(doc);
    const quieter = realizeSong(setInstanceEnergy(doc, i, 0));
    expect(quieter[i].drums).not.toEqual(parts[i].drums);
    parts.forEach((p, k) => k !== i && expect(quieter[k].drums).toEqual(p.drums));
  });
});

describe('edits', () => {
  const doc = generateDoc({ seed: 21, formId: 'verse-chorus', tonic: 9, mode: 'minor' });
  const verses = doc.form.map((f, i) => (f.sectionId === 'verse' ? i : -1)).filter(i => i >= 0);

  it('a drum edit in one verse shows up in every verse and locks drums', () => {
    const step = 2;
    const was = doc.sections.verse.drums[1][step].checked;
    const edited = editDrum(doc, verses[0], 1, step, !was);
    expect(edited.sections.verse.locks.drums).toBe(true);
    const parts = realizeSection(edited, realizeSong(doc), 'verse');
    verses.forEach(i => expect(parts[i].drums[1][step].checked).toBe(!was));
  });

  it('a bass edit lands in every instance', () => {
    const parts = realizeSong(doc);
    const locs = parts[verses[0]].bassNoteLocations.map(l => ({ ...l }));
    const k = locs.findIndex(l => l.midi > 0);
    locs[k] = { ...locs[k], y: 52.5, acc: 'none' }; // G2
    const edited = editBass(doc, verses[0], locs);
    expect(edited.sections.verse.bass[k]).toBe(43);
    const again = realizeSection(edited, parts, 'verse');
    verses.forEach(i => expect(again[i].bassNoteLocations[k].midi).toBe(43));
  });

  it('a chord-tone edit lands in every instance', () => {
    const edited = editChordTone(doc, verses[0], 0, 84, true);
    expect(edited.sections.verse.voicing[0]).toContain(84);
    const parts = realizeSong(edited);
    verses.forEach(i => expect(parts[i].chordTones.midiTones[0]).toContain(84));
  });
});

describe('MIDI export', () => {
  it('writes a format-1 file with conductor, markers, and every pitched note', () => {
    const doc = generateDoc({ seed: 8, formId: 'pop', tonic: 4, mode: 'minor', bpm: 96 });
    const parts = realizeSong(doc);
    const file = readMidiFile(songToMidi({ songStructure: parts, bpm: 96, key: keyName(doc.key) }));
    expect(file.format).toBe(1);
    expect(file.ppq).toBe(PPQ);
    expect(file.tracks.length).toBe(5);

    const conductor = file.tracks[0];
    const markers = conductor.filter(e => e.metaType === 0x06).map(e => e.text);
    expect(markers).toContain('Chorus 1');
    expect(markers[markers.length - 1]).toBe('End');
    const tempo = conductor.find(e => e.metaType === 0x51)!;
    expect(Math.round(60_000_000 / ((tempo.data[0] << 16) | (tempo.data[1] << 8) | tempo.data[2]))).toBe(96);
    const keySig = conductor.find(e => e.metaType === 0x59)!;
    expect(keySig.data).toEqual([1, 1]); // E minor: one sharp, minor

    const noteOns = (t: number) => file.tracks[t].filter(e => (e.status & 0xf0) === 0x90);
    const bassNotes = sum(parts.map(p => p.bassNoteLocations.filter(l => l.midi > 0).length));
    expect(noteOns(2).length).toBe(bassNotes);
    const drumHits = sum(parts.map(p => sum(p.drums.map(row => row.filter(c => c.checked).length))));
    expect(noteOns(1).length).toBe(drumHits);
    expect(noteOns(1).every(e => (e.status & 0x0f) === 9)).toBe(true);
    const chordNotes = sum(parts.map(p => sum(p.chordTones.midiTones.map(t => t.length))));
    expect(noteOns(3).length).toBe(chordNotes);

    const totalBeats = sum(parts.map(p => sum(p.drumGroove)));
    expect(markers.length).toBe(parts.length + 1);
    expect(conductor[conductor.length - 1].tick).toBe(Math.round(totalBeats * PPQ));
  });

  it('shapes velocities by the beat and by each part\'s energy', () => {
    expect([0, PPQ, PPQ / 2, PPQ / 4, PPQ / 3, 2 * BAR, BAR + 3 * PPQ].map(metricLevel)).toEqual([0, 1, 2, 3, 3, 0, 1]);
    expect(velocity(BASS_VELOCITY, 0)).toBe(BASS_VELOCITY[0]);
    expect(velocity(BASS_VELOCITY, 0, 1)).toBeGreaterThan(velocity(BASS_VELOCITY, 0, 0));
    expect(velocity(DRUM_VELOCITY[CRASH], 0, 1, true)).toBeLessThanOrEqual(127);

    const doc = generateDoc({ seed: 8, formId: 'build-drop' });
    const parts = realizeSong(doc);
    const file = readMidiFile(songToMidi({ songStructure: parts, bpm: 124, key: keyName(doc.key) }));
    const ons = (t: number) => file.tracks[t].filter(e => (e.status & 0xf0) === 0x90);
    const starts = parts.map((_, i) => Math.round(sum(parts.slice(0, i).map(p => sum(p.drumGroove))) * PPQ));
    const partAt = (tick: number) => starts.filter(s => s <= tick).length - 1;
    const levelOf = (tick: number) => metricLevel(tick - starts[partAt(tick)]);

    for (const t of [1, 2, 3, 4]) {
      ons(t).forEach(e => { expect(e.data[1]).toBeGreaterThanOrEqual(1); expect(e.data[1]).toBeLessThanOrEqual(127); });
      expect(new Set(ons(t).map(e => e.data[1])).size).toBeGreaterThan(1);
    }

    // Within a part, bass notes on the downbeat play louder than sixteenths.
    const bass = ons(2);
    const part = parts.findIndex((_, i) => bass.some(e => partAt(e.tick) === i && levelOf(e.tick) === 0) && bass.some(e => partAt(e.tick) === i && levelOf(e.tick) === 3));
    expect(part).toBeGreaterThanOrEqual(0);
    const inPart = bass.filter(e => partAt(e.tick) === part);
    expect(Math.min(...inPart.filter(e => levelOf(e.tick) === 0).map(e => e.data[1])))
      .toBeGreaterThan(Math.max(...inPart.filter(e => levelOf(e.tick) === 3).map(e => e.data[1])));

    // The loudest part's opening chord is louder than the quietest part's.
    const energies = parts.map(p => p.energy!);
    const firstChord = (i: number) => ons(3).find(e => e.tick === starts[i])!.data[1];
    const loud = energies.indexOf(Math.max(...energies));
    const quiet = energies.indexOf(Math.min(...energies));
    expect(energies[loud] - energies[quiet]).toBeGreaterThan(0.3);
    expect(firstChord(loud)).toBeGreaterThan(firstChord(quiet));

    // Snare backbeats sound over the ghost notes between them.
    const snares = ons(1).filter(e => e.data[0] === GM_DRUMS[SNARE]);
    const backbeats = snares.filter(e => levelOf(e.tick) <= 1).map(e => e.data[1]);
    const ghosts = snares.filter(e => levelOf(e.tick) === 3).map(e => e.data[1]);
    expect(backbeats.length).toBeGreaterThan(0);
    if (ghosts.length) expect(Math.min(...backbeats)).toBeGreaterThan(Math.max(...ghosts));
  });

  it('exports classic (legacy-engine) songs too', () => {
    const { songStructure, bpm, key } = createRandomSong(7);
    const file = readMidiFile(songToMidi({ songStructure, bpm, key }));
    expect(file.tracks.length).toBe(4);
    expect(file.tracks[2].some(e => (e.status & 0xf0) === 0x90)).toBe(true);
  });

  it('parses key strings', () => {
    expect(parseKeyString('F# Minor')).toEqual({ tonic: 6, mode: 'minor' });
    expect(parseKeyString('Bb Dorian')).toEqual({ tonic: 10, mode: 'dorian' });
    expect(parseKeyString('')).toBeNull();
  });
});
