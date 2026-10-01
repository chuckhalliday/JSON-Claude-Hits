// The generation pipeline: form -> harmony -> rhythm -> notes.
//
// Every layer of every section is a pure function of the layers it depends
// on and its own derived seed (song seed + section + layer + re-roll count).
// That gives the sculpting operations:
//   - generateDoc: rough out a whole song from a form template.
//   - regenerateLayer: re-roll one layer of one section; unlocked dependents
//     are rebuilt to fit it, locked ones are kept (remapped onto a new grid
//     when they have to be). Nothing in any other section changes.
//   - hand edits (edits.ts) write into the same document and lock the layer.

import { GenerateOptions, Layer, LAYERS, LAYER_DEPENDENTS, SectionDef, SectionInstance, SectionLabel, SongDoc } from './doc';
import { DEFAULT_FORM_ID, formTemplate, resolveOrder } from './form';
import { generateHarmony } from './harmony';
import { generateBassRhythm, generateDrumSteps } from './rhythm';
import { generateBass, remapBass } from './bassline';
import { generateDrums, remapDrums } from './drums';
import { generateVoicings, guideTones, remapVoicings } from './voicing';
import { Mode, mod12 } from './theory';
import { freshSeed, streamFor } from './seeds';
import { normalizeTuning, setTuning, bassTonalityOdds } from '../SongStructure/tuning';

const sectionId = (label: SectionLabel) => label.toLowerCase().replace(/[^a-z]+/g, '-');

const noLocks = (): Record<Layer, boolean> => ({ harmony: false, rhythm: false, bass: false, drums: false, voicing: false });
const zeroRolls = (): Record<Layer, number> => ({ harmony: 0, rhythm: 0, bass: 0, drums: 0, voicing: 0 });

const layerRng = (doc: SongDoc, section: SectionDef, layer: Layer) =>
  streamFor(doc.seed, section.id, layer, section.rolls[layer]);

// Rebuild one layer of a section in place from the section's other layers.
function buildLayer(doc: SongDoc, s: SectionDef, layer: Layer): void {
  const rng = layerRng(doc, s, layer);
  const style = formTemplate(doc.formId).harmonyStyle ?? 'functional';
  switch (layer) {
    case 'harmony':
      s.harmony = generateHarmony({ label: s.label, bars: s.bars, energy: s.energy, cadence: s.cadence, key: doc.key, style }, rng);
      s.guideTones = guideTones(s.harmony, doc.key);
      break;
    case 'rhythm': {
      s.bassRhythm = generateBassRhythm(s.label, s.bars, s.energy, rng, doc.motifs, doc.arrangement);
      const tripletFeel = streamFor(doc.seed, s.id, 'feel', s.rolls.rhythm)() < doc.triplet;
      s.drumSteps = generateDrumSteps(s.bassRhythm, s.energy, tripletFeel, rng);
      break;
    }
    case 'bass':
      s.bass = generateBass(s.bassRhythm, s.harmony, doc.key, s.energy, rng);
      delete s.bassStrings;
      break;
    case 'drums':
      s.drums = generateDrums(s.label, s.drumSteps, s.bassRhythm, s.bass, s.energy, rng);
      break;
    case 'voicing':
      s.voicing = generateVoicings(s.harmony, doc.key, s.energy, rng);
      break;
  }
}

export function generateDoc(options: GenerateOptions = {}): SongDoc {
  const seed = options.seed ?? freshSeed();
  const tuning = normalizeTuning(options.tuning);
  setTuning(tuning);
  const songRng = streamFor(seed, 'song');
  const template = formTemplate(options.formId ?? DEFAULT_FORM_ID);

  const mode: Mode = options.mode ?? (songRng() < bassTonalityOdds(0.5) ? 'minor' : 'major');
  const tonic = mod12(options.tonic ?? Math.floor(songRng() * 12));
  const bpm = options.bpm ?? Math.round(songRng() * 40 + 100);
  const target = options.targetSeconds ?? Math.round(songRng() * 60 + 170);
  const order = resolveOrder(template, bpm, target, tuning.maxPartRepeats);

  const doc: SongDoc = {
    version: 1,
    seed,
    key: { tonic, mode },
    bpm,
    meter: [4, 4],
    formId: template.id,
    sections: {},
    form: [],
    tuning,
    triplet: options.triplet ?? songRng() / 4,
    motifs: options.motifs && options.motifs.length > 0 ? options.motifs.map(m => [...m]) : null,
    arrangement: options.arrangement ? options.arrangement.map(r => [...r]) : null,
    liftFinalChorus: options.liftFinalChorus ?? false,
  };

  for (const entry of order) {
    const id = sectionId(entry.label);
    const spec = template.sections[entry.label];
    if (!spec || doc.sections[id]) continue;
    const section: SectionDef = {
      id, label: entry.label, bars: spec.bars, energy: spec.energy, cadence: spec.cadence,
      harmony: [], bassRhythm: [], drumSteps: [], bass: [], drums: [], voicing: [], guideTones: [],
      locks: noLocks(), rolls: zeroRolls(),
    };
    LAYERS.forEach(layer => buildLayer(doc, section, layer));
    doc.sections[id] = section;
  }

  // Optional key lift for the final chorus run (and anything after it).
  let liftFrom = -1;
  if (doc.liftFinalChorus) {
    for (let i = order.length - 1; i >= 0; i--) {
      if (order[i].label === 'Chorus' || order[i].label === 'Drop') {
        liftFrom = i;
        while (liftFrom > 0 && order[liftFrom - 1].label === order[i].label) liftFrom--;
        break;
      }
    }
  }
  const lift = streamFor(seed, 'lift')() < 0.5 ? 1 : 2;
  doc.form = order.map((entry, i): SectionInstance => ({
    sectionId: sectionId(entry.label),
    energy: entry.energy ?? template.sections[entry.label]!.energy,
    transpose: entry.transpose ?? (liftFrom !== -1 && i >= liftFrom ? lift : 0),
    drumOverrides: [],
  }));
  return doc;
}

const cloneSection = (s: SectionDef): SectionDef => JSON.parse(JSON.stringify(s));

function affectedLayers(layer: Layer): Layer[] {
  const out = new Set<Layer>([layer]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const l of [...out]) {
      for (const d of LAYER_DEPENDENTS[l]) {
        if (!out.has(d)) {
          out.add(d);
          grew = true;
        }
      }
    }
  }
  return LAYERS.filter(l => out.has(l));
}

// Re-roll `layer` of one section. Returns a new document; the input is not
// modified. A locked layer is left alone (the UI disables its button).
export function regenerateLayer(doc: SongDoc, id: string, layer: Layer): SongDoc {
  const old = doc.sections[id];
  if (!old || old.locks[layer]) return doc;
  setTuning(doc.tuning);
  const s = cloneSection(old);
  s.rolls[layer] += 1;
  for (const l of affectedLayers(layer)) {
    if (l === layer || !s.locks[l]) {
      buildLayer(doc, s, l);
    } else if (l === 'bass' && layer === 'rhythm') {
      s.bass = remapBass(old.bassRhythm, old.bass, s.bassRhythm);
      delete s.bassStrings;
    } else if (l === 'drums' && layer === 'rhythm') {
      s.drums = remapDrums(old.drumSteps, old.drums, s.drumSteps);
    } else if (l === 'voicing' && layer === 'harmony') {
      s.voicing = remapVoicings(old.harmony, old.voicing, s.harmony);
    }
  }
  const form = layer === 'rhythm'
    ? doc.form.map(inst => (inst.sectionId === id ? { ...inst, drumOverrides: [] } : inst))
    : doc.form;
  return { ...doc, sections: { ...doc.sections, [id]: s }, form };
}

// Sections a detached part copies are named after the original: verse~2.
export const baseSectionId = (id: string) => id.replace(/~\d+$/, '');

export const isDetached = (doc: SongDoc, index: number) => {
  const inst = doc.form[index];
  return !!inst && (inst.detached ?? inst.sectionId !== baseSectionId(inst.sectionId));
};

// How many parts play the section this part is (or would be) linked to.
export const linkedCount = (doc: SongDoc, index: number) => {
  const inst = doc.form[index];
  if (!inst) return 0;
  const base = baseSectionId(inst.sectionId);
  return doc.form.filter((f, i) => f.sectionId === base || i === index).length;
};

// "This part only": give one part its own copy of its section, so edits and
// re-rolls made to it leave the section's other instances alone. Only this
// part is affected; the others stay linked to each other.
export function detachInstance(doc: SongDoc, index: number): SongDoc {
  const inst = doc.form[index];
  const section = inst && doc.sections[inst.sectionId];
  if (!section) return doc;
  const markDetached = (sectionId: string) => doc.form.map((f, i) => (i === index ? { ...f, sectionId, detached: true } : f));
  // The section's only part needs no copy - just remember the choice.
  if (doc.form.filter(f => f.sectionId === section.id).length <= 1) return { ...doc, form: markDetached(section.id) };
  const base = baseSectionId(section.id);
  let n = 2;
  while (doc.sections[`${base}~${n}`]) n++;
  const id = `${base}~${n}`;
  return { ...doc, sections: { ...doc.sections, [id]: { ...cloneSection(section), id } }, form: markDetached(id) };
}

// "All linked": put this part back on its original section, carrying its
// current state there - so every part linked to that section now matches
// it - and drop the copy it was playing.
export function relinkInstance(doc: SongDoc, index: number): SongDoc {
  const inst = doc.form[index];
  const section = inst && doc.sections[inst.sectionId];
  if (!section) return doc;
  const base = baseSectionId(section.id);
  const sections = { ...doc.sections, [base]: { ...cloneSection(section), id: base } };
  if (section.id !== base) delete sections[section.id];
  const form = doc.form.map((f, i) => (i === index ? { ...f, sectionId: base, detached: false } : f));
  return { ...doc, sections, form };
}

export function setLock(doc: SongDoc, id: string, layer: Layer, locked: boolean): SongDoc {
  const s = doc.sections[id];
  if (!s) return doc;
  return { ...doc, sections: { ...doc.sections, [id]: { ...s, locks: { ...s.locks, [layer]: locked } } } };
}

export function setInstanceEnergy(doc: SongDoc, index: number, energy: number): SongDoc {
  const form = doc.form.map((inst, i) => (i === index ? { ...inst, energy: Math.min(1, Math.max(0, energy)) } : inst));
  return { ...doc, form };
}

export function moveInstance(doc: SongDoc, from: number, to: number): SongDoc {
  const form = [...doc.form];
  const [moved] = form.splice(from, 1);
  form.splice(to, 0, moved);
  return { ...doc, form };
}
