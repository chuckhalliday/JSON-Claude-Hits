// Independent, derived random streams.
//
// The legacy engine pulled every choice from one global sequence, so changing
// any early decision shifted every later roll. The core instead derives a
// separate seed for each (song, section, layer, re-roll) so re-rolling the
// chorus drums cannot disturb the verse bass, and a locked layer stays put.

export type Rng = () => number;

// FNV-1a over the stringified parts, then a final avalanche.
export function deriveSeed(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  const text = parts.join('␟');
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

// mulberry32, as a closure so streams never share state.
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const streamFor = (...parts: Array<string | number>) => makeRng(deriveSeed(...parts));

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

// Weighted choice; weights need not sum to 1. Falls back to the last item.
export function weighted<T>(rng: Rng, entries: ReadonlyArray<readonly [T, number]>): T {
  const total = entries.reduce((sum, [, w]) => sum + Math.max(0, w), 0);
  let roll = rng() * total;
  for (const [item, w] of entries) {
    roll -= Math.max(0, w);
    if (roll < 0) return item;
  }
  return entries[entries.length - 1][0];
}

export function freshSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}
