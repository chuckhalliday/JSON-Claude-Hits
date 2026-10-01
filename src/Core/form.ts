// Form templates: the first, coarsest block a song is sculpted from.
//
// A template names the sections (with length in bars, baseline energy, and
// the cadence each one aims for) and the order they play in. Duration falls
// out of bars and tempo; a target length only adds or removes the
// template's repeatable `loop` segment.

import { Cadence, FormEntry, SectionLabel } from './doc';
import { BEATS_PER_BAR } from './time';

export interface SectionSpec {
  bars: number;
  energy: number;
  cadence: Cadence;
}

export interface FormTemplate {
  id: string;
  name: string;
  sections: Partial<Record<SectionLabel, SectionSpec>>;
  order: FormEntry[];
  // Contiguous slice of `order` that can repeat (or be dropped) to fit a
  // target length; inserted before `loopAt`.
  loop: SectionLabel[];
  loopAt: number;
  // 'blues' sections use the fixed 12-bar changes instead of free harmony.
  harmonyStyle?: 'functional' | 'blues';
}

export const FORM_TEMPLATES: FormTemplate[] = [
  {
    id: 'pop',
    name: 'Verse / Pre-Chorus / Chorus',
    sections: {
      Intro: { bars: 4, energy: 0.3, cadence: 'half' },
      Verse: { bars: 8, energy: 0.4, cadence: 'half' },
      'Pre-Chorus': { bars: 4, energy: 0.55, cadence: 'half' },
      Chorus: { bars: 8, energy: 0.8, cadence: 'authentic' },
      Bridge: { bars: 8, energy: 0.5, cadence: 'half' },
      Outro: { bars: 4, energy: 0.35, cadence: 'authentic' },
    },
    order: [
      { label: 'Intro' }, { label: 'Verse' }, { label: 'Pre-Chorus' }, { label: 'Chorus' },
      { label: 'Verse', energy: 0.45 }, { label: 'Pre-Chorus' }, { label: 'Chorus' },
      { label: 'Bridge' }, { label: 'Chorus', energy: 0.85 }, { label: 'Chorus', energy: 0.95 }, { label: 'Outro' },
    ],
    loop: ['Verse', 'Pre-Chorus', 'Chorus'],
    loopAt: 7,
  },
  {
    id: 'verse-chorus',
    name: 'Verse / Chorus',
    sections: {
      Intro: { bars: 4, energy: 0.3, cadence: 'half' },
      Verse: { bars: 8, energy: 0.45, cadence: 'half' },
      Chorus: { bars: 8, energy: 0.8, cadence: 'authentic' },
      Bridge: { bars: 8, energy: 0.55, cadence: 'deceptive' },
      Outro: { bars: 4, energy: 0.35, cadence: 'plagal' },
    },
    order: [
      { label: 'Intro' }, { label: 'Verse' }, { label: 'Chorus' }, { label: 'Verse', energy: 0.5 },
      { label: 'Chorus' }, { label: 'Bridge' }, { label: 'Chorus', energy: 0.9 }, { label: 'Outro' },
    ],
    loop: ['Verse', 'Chorus'],
    loopAt: 5,
  },
  {
    id: 'aaba',
    name: 'AABA (32-bar song form)',
    sections: {
      Intro: { bars: 4, energy: 0.3, cadence: 'half' },
      Verse: { bars: 8, energy: 0.5, cadence: 'authentic' },
      Bridge: { bars: 8, energy: 0.6, cadence: 'half' },
      Solo: { bars: 8, energy: 0.7, cadence: 'authentic' },
      Outro: { bars: 4, energy: 0.35, cadence: 'authentic' },
    },
    order: [
      { label: 'Intro' }, { label: 'Verse' }, { label: 'Verse' }, { label: 'Bridge' }, { label: 'Verse' },
      { label: 'Solo' }, { label: 'Solo' }, { label: 'Bridge' }, { label: 'Verse', energy: 0.6 }, { label: 'Outro' },
    ],
    loop: ['Solo'],
    loopAt: 6,
  },
  {
    id: 'blues',
    name: '12-Bar Blues',
    harmonyStyle: 'blues',
    sections: {
      Intro: { bars: 4, energy: 0.35, cadence: 'half' },
      Verse: { bars: 12, energy: 0.5, cadence: 'half' },
      Solo: { bars: 12, energy: 0.75, cadence: 'half' },
      Outro: { bars: 4, energy: 0.4, cadence: 'authentic' },
    },
    order: [
      { label: 'Intro' }, { label: 'Verse' }, { label: 'Verse', energy: 0.55 }, { label: 'Solo' },
      { label: 'Solo', energy: 0.85 }, { label: 'Verse', energy: 0.6 }, { label: 'Outro' },
    ],
    loop: ['Solo'],
    loopAt: 4,
  },
  {
    id: 'build-drop',
    name: 'Build / Drop',
    sections: {
      Intro: { bars: 8, energy: 0.25, cadence: 'loop' },
      Breakdown: { bars: 8, energy: 0.3, cadence: 'loop' },
      'Pre-Chorus': { bars: 8, energy: 0.6, cadence: 'half' },
      Drop: { bars: 16, energy: 0.95, cadence: 'loop' },
      Outro: { bars: 8, energy: 0.3, cadence: 'loop' },
    },
    order: [
      { label: 'Intro' }, { label: 'Breakdown' }, { label: 'Pre-Chorus' }, { label: 'Drop' },
      { label: 'Breakdown', energy: 0.35 }, { label: 'Pre-Chorus', energy: 0.7 }, { label: 'Drop' }, { label: 'Outro' },
    ],
    loop: ['Breakdown', 'Pre-Chorus', 'Drop'],
    loopAt: 4,
  },
];

export const DEFAULT_FORM_ID = 'pop';

export function formTemplate(id: string | undefined): FormTemplate {
  return FORM_TEMPLATES.find(t => t.id === id) ?? FORM_TEMPLATES[0];
}

export function formSeconds(order: FormEntry[], template: FormTemplate, bpm: number): number {
  const bars = order.reduce((sum, entry) => sum + (template.sections[entry.label]?.bars ?? 0), 0);
  return (bars * BEATS_PER_BAR * 60) / bpm;
}

// Template order, grown or shrunk by whole loop segments toward a target
// duration, then with back-to-back runs of one label capped at `maxRepeats`.
export function resolveOrder(template: FormTemplate, bpm: number, targetSeconds: number | undefined, maxRepeats: number): FormEntry[] {
  let order = template.order.map(entry => ({ ...entry }));
  if (targetSeconds !== undefined) {
    const loopEntries = template.loop.map(label => ({ label }));
    const loopSeconds = formSeconds(loopEntries, template, bpm);
    let extra = 0;
    while (formSeconds(order, template, bpm) + loopSeconds / 2 < targetSeconds && extra < 8) {
      order.splice(template.loopAt, 0, ...loopEntries.map(e => ({ ...e })));
      extra++;
    }
    // Shrink by dropping the loop segment where it first appears, never
    // below the opening and closing sections.
    while (formSeconds(order, template, bpm) - loopSeconds / 2 > targetSeconds && order.length > template.loop.length + 2) {
      const at = findSegment(order, template.loop);
      if (at <= 0) break;
      order.splice(at, template.loop.length);
    }
  }
  const capped: FormEntry[] = [];
  let run = 0;
  for (const entry of order) {
    run = capped.length > 0 && capped[capped.length - 1].label === entry.label ? run + 1 : 1;
    if (run <= maxRepeats) capped.push(entry);
  }
  return capped;
}

function findSegment(order: FormEntry[], labels: SectionLabel[]): number {
  for (let i = 1; i + labels.length < order.length; i++) {
    if (labels.every((label, j) => order[i + j].label === label)) return i;
  }
  return -1;
}

export const SHORT_LABELS: Record<SectionLabel, string> = {
  Intro: 'In', Verse: 'V', 'Pre-Chorus': 'PC', Chorus: 'C', Bridge: 'B', Breakdown: 'Bd', Drop: 'Dr', Solo: 'S', Outro: 'Out',
};
