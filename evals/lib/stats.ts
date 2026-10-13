// Small, exact statistics for comparing two runs over the same files. Nothing
// here is clever: a mean, a paired difference, and a bootstrap interval so that
// "by how much" comes with how sure that number is.

export const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;

// A deterministic generator, so the same inputs give the same interval.
function random(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Paired = {
  n: number;
  meanA: number;
  meanB: number;
  /** meanA - meanB */
  difference: number;
  /** 95 % bootstrap interval of the difference. */
  low: number;
  high: number;
  wins: number;
  losses: number;
  ties: number;
};

/** A against B on the same items: a[i] and b[i] are the same file. */
export function pair(a: readonly number[], b: readonly number[]): Paired {
  if (a.length !== b.length) throw new Error("Les deux séries doivent avoir la même taille.");
  const diffs = a.map((x, i) => x - b[i]);
  const rand = random(20261013);
  const draws: number[] = [];
  for (let r = 0; r < 4000; r++) {
    let sum = 0;
    for (let i = 0; i < diffs.length; i++) sum += diffs[Math.floor(rand() * diffs.length)];
    draws.push(sum / diffs.length);
  }
  draws.sort((x, y) => x - y);
  return {
    n: a.length,
    meanA: mean(a),
    meanB: mean(b),
    difference: mean(diffs),
    low: draws[Math.floor(draws.length * 0.025)] ?? 0,
    high: draws[Math.floor(draws.length * 0.975)] ?? 0,
    wins: diffs.filter((d) => d > 0).length,
    losses: diffs.filter((d) => d < 0).length,
    ties: diffs.filter((d) => d === 0).length,
  };
}
