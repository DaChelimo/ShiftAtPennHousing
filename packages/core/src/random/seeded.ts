// Deterministic seeded PRNG — pure, no clock, no crypto. Shared by the dev-seeding
// generators (preference-generation, schedule-generation) so a run keyed off a stable
// tuple like (periodId, userId) is byte-for-byte reproducible and unit-testable.

// Hash an arbitrary string to a uint32 seed (cyrb53-style, folded to 32 bits). Stable
// across platforms — plain integer math, no locale or clock dependence.
export function hashSeed(input: string): number {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0) ^ (h1 >>> 0);
}

// A tiny, fast, deterministic float generator (mulberry32). Returns values in [0, 1).
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return function next(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Convenience: build an Rng straight from a string key.
export function rngFromKey(key: string): Rng {
  return mulberry32(hashSeed(key));
}

// Integer in [min, max] inclusive.
export function rngInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

// Uniform float in [min, max).
export function rngRange(rng: Rng, min: number, max: number): number {
  return min + rng() * (max - min);
}

// Weighted pick: `weights` parallels `items`; returns the chosen item. Weights need not
// sum to 1. An all-zero (or empty) weight vector falls back to the first item.
export function rngWeighted<T>(rng: Rng, items: readonly T[], weights: readonly number[]): T {
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);
  if (total <= 0 || items.length === 0) return items[0]!;
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i] ?? 0);
    if (r < 0) return items[i]!;
  }
  return items[items.length - 1]!;
}
