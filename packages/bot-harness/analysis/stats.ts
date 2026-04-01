import type { ConfidenceInterval } from './types.js';

/** Z-score lookup for common confidence levels */
const Z_SCORES: Record<number, number> = {
  0.90: 1.645,
  0.95: 1.96,
  0.99: 2.576,
};

function getZScore(confidence: number): number {
  const z = Z_SCORES[confidence];
  if (z !== undefined) return z;
  // Fallback: use 0.95 for unknown confidence levels
  return Z_SCORES[0.95];
}

/**
 * Wilson score interval for binomial proportion.
 * Returns a confidence interval for the true win rate given observed wins/total.
 * Guards against total=0 by returning { lower: 0, upper: 1, center: 0, n: 0 }.
 */
export function wilsonScoreInterval(
  wins: number,
  total: number,
  confidence: number = 0.95,
): ConfidenceInterval {
  if (total === 0) {
    return { lower: 0, upper: 1, center: 0, n: 0 };
  }

  const z = getZScore(confidence);
  const n = total;
  const phat = wins / n;
  const z2 = z * z;

  const denominator = 1 + z2 / n;
  const center = (phat + z2 / (2 * n)) / denominator;
  const margin =
    (z / denominator) * Math.sqrt((phat * (1 - phat)) / n + z2 / (4 * n * n));

  const lower = Math.max(0, center - margin);
  const upper = Math.min(1, center + margin);

  return { lower, upper, center, n };
}

/**
 * Simple LCG (Linear Congruential Generator) for deterministic pseudo-random numbers.
 * Returns a function that yields values in [0, 1).
 */
function createLcg(seed: number): () => number {
  let state = seed & 0x7fffffff;
  return (): number => {
    state = (state * 1664525 + 1013904223) & 0x7fffffff;
    return state / 0x80000000;
  };
}

/**
 * Bootstrap percentile confidence interval.
 * Resamples the binomial proportion and returns percentile-based bounds.
 * Uses seeded PRNG for deterministic results in tests.
 */
export function bootstrapPercentileCI(
  wins: number,
  total: number,
  confidence: number = 0.95,
  iterations: number = 10000,
  seed: number = 42,
): ConfidenceInterval {
  if (total === 0) {
    return { lower: 0, upper: 1, center: 0, n: 0 };
  }

  const random = createLcg(seed);
  const proportions: number[] = new Array<number>(iterations);

  for (let i = 0; i < iterations; i++) {
    let resampledWins = 0;
    for (let j = 0; j < total; j++) {
      if (random() < wins / total) {
        resampledWins++;
      }
    }
    proportions[i] = resampledWins / total;
  }

  proportions.sort((a, b) => a - b);

  const alpha = 1 - confidence;
  const lowerIdx = Math.floor((alpha / 2) * iterations);
  const upperIdx = Math.floor((1 - alpha / 2) * iterations) - 1;

  const lower = proportions[Math.max(0, lowerIdx)];
  const upper = proportions[Math.min(iterations - 1, upperIdx)];
  const centerValue = wins / total;

  return { lower, upper, center: centerValue, n: total };
}

/**
 * Shannon entropy of a distribution given as counts.
 * Returns entropy in bits (log base 2).
 * Returns 0 for empty or all-zero arrays.
 */
export function shannonEntropy(counts: number[]): number {
  const totalCount = counts.reduce((sum, c) => sum + c, 0);
  if (totalCount === 0) return 0;

  let entropy = 0;
  for (const count of counts) {
    if (count > 0) {
      const p = count / totalCount;
      entropy -= p * Math.log2(p);
    }
  }

  return entropy;
}

/** Arithmetic mean. Returns 0 for empty array. */
export function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Population standard deviation. Returns 0 for empty or single-element arrays. */
export function stddev(values: number[]): number {
  if (values.length <= 1) return 0;
  const m = mean(values);
  const squaredDiffs = values.reduce((sum, v) => sum + (v - m) * (v - m), 0);
  return Math.sqrt(squaredDiffs / values.length);
}
