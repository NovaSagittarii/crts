import { mean, stddev } from './stats.js';
import type { ClusterResult, StrategyFeatureVector } from './types.js';

/** Feature vector field order for array conversion */
const FEATURE_KEYS: ReadonlyArray<keyof StrategyFeatureVector> = [
  'firstBuildTick',
  'buildDensity',
  'buildBurstiness',
  'avgResourcesAtBuild',
  'resourceEfficiency',
  'territoryGrowthRate',
  'finalTerritoryRatio',
  'uniqueTemplatesUsed',
  'templateEntropy',
  'avgDistanceToEnemy',
  'structureSpread',
] as const;

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

/** Squared Euclidean distance (avoids sqrt for performance) */
function squaredEuclideanDistance(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return sum;
}

/** Find nearest centroid index for a data point */
function nearestCentroid(point: number[], centroids: number[][]): number {
  let minDist = Infinity;
  let minIdx = 0;
  for (let i = 0; i < centroids.length; i++) {
    const dist = squaredEuclideanDistance(point, centroids[i]);
    if (dist < minDist) {
      minDist = dist;
      minIdx = i;
    }
  }
  return minIdx;
}

/**
 * k-means++ initialization: select initial centroids with probability
 * proportional to squared distance from nearest existing centroid.
 */
function kMeansPlusPlusInit(
  data: number[][],
  k: number,
  random: () => number,
): number[][] {
  const centroids: number[][] = [];
  const n = data.length;

  // First centroid: random point
  const firstIdx = Math.floor(random() * n);
  centroids.push([...data[firstIdx]]);

  // Remaining centroids: weighted by D(x)^2
  for (let c = 1; c < k; c++) {
    const distances: number[] = new Array<number>(n);
    let totalDist = 0;

    for (let i = 0; i < n; i++) {
      let minDist = Infinity;
      for (const centroid of centroids) {
        const dist = squaredEuclideanDistance(data[i], centroid);
        if (dist < minDist) minDist = dist;
      }
      distances[i] = minDist;
      totalDist += minDist;
    }

    // Weighted random selection
    if (totalDist === 0) {
      // All points are identical or already chosen; pick randomly
      centroids.push([...data[Math.floor(random() * n)]]);
      continue;
    }

    let threshold = random() * totalDist;
    let selectedIdx = 0;
    for (let i = 0; i < n; i++) {
      threshold -= distances[i];
      if (threshold <= 0) {
        selectedIdx = i;
        break;
      }
    }
    centroids.push([...data[selectedIdx]]);
  }

  return centroids;
}

/** Compute within-cluster sum of squares */
function computeWCSS(
  data: number[][],
  assignments: number[],
  centroids: number[][],
): number {
  let wcss = 0;
  for (let i = 0; i < data.length; i++) {
    wcss += squaredEuclideanDistance(data[i], centroids[assignments[i]]);
  }
  return wcss;
}

/** Run a single k-means iteration (Lloyd's algorithm) */
function runKMeans(
  data: number[][],
  k: number,
  initialCentroids: number[][],
  maxIterations: number,
): {
  centroids: number[][];
  assignments: number[];
  iterations: number;
  wcss: number;
} {
  const n = data.length;
  const dim = data[0].length;
  let centroids = initialCentroids.map((c) => [...c]);
  let assignments = new Array<number>(n).fill(0);
  let iterations = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;

    // Assign each point to nearest centroid
    const newAssignments = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      newAssignments[i] = nearestCentroid(data[i], centroids);
    }

    // Check convergence
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (newAssignments[i] !== assignments[i]) {
        changed = true;
        break;
      }
    }
    assignments = newAssignments;

    if (!changed && iter > 0) break;

    // Recompute centroids
    const newCentroids: number[][] = [];
    const counts: number[] = new Array<number>(k).fill(0);
    const sums: number[][] = Array.from({ length: k }, () =>
      new Array<number>(dim).fill(0),
    );

    for (let i = 0; i < n; i++) {
      const cluster = assignments[i];
      counts[cluster]++;
      for (let d = 0; d < dim; d++) {
        sums[cluster][d] += data[i][d];
      }
    }

    for (let c = 0; c < k; c++) {
      if (counts[c] === 0) {
        // Empty cluster: keep old centroid
        newCentroids.push([...centroids[c]]);
      } else {
        newCentroids.push(sums[c].map((s) => s / counts[c]));
      }
    }

    centroids = newCentroids;
  }

  const wcss = computeWCSS(data, assignments, centroids);
  return { centroids, assignments, iterations, wcss };
}

export interface KMeansOptions {
  maxIterations?: number;
  seed?: number;
  runs?: number;
}

/**
 * K-means clustering with k-means++ initialization and multi-run support.
 *
 * Uses seeded LCG PRNG for deterministic results.
 * Multi-run selects the result with lowest WCSS.
 */
export function kMeans(
  data: number[][],
  k: number,
  options: KMeansOptions = {},
): ClusterResult {
  const { maxIterations = 100, seed = 42, runs = 10 } = options;

  // Edge cases
  if (data.length === 0 || k === 0) {
    return { centroids: [], assignments: [], k: 0, wcss: 0, iterations: 0 };
  }

  // Cap k at data length
  const effectiveK = Math.min(k, data.length);

  let bestResult: {
    centroids: number[][];
    assignments: number[];
    iterations: number;
    wcss: number;
  } | null = null;

  for (let run = 0; run < runs; run++) {
    const random = createLcg(seed + run * 7919);
    const initialCentroids = kMeansPlusPlusInit(data, effectiveK, random);
    const result = runKMeans(data, effectiveK, initialCentroids, maxIterations);

    if (bestResult === null || result.wcss < bestResult.wcss) {
      bestResult = result;
    }
  }

  return {
    centroids: bestResult!.centroids,
    assignments: bestResult!.assignments,
    k: effectiveK,
    wcss: bestResult!.wcss,
    iterations: bestResult!.iterations,
  };
}

/**
 * Convert a single StrategyFeatureVector to a number array.
 * Uses consistent field ordering defined in FEATURE_KEYS.
 */
export function featureVectorToArray(fv: StrategyFeatureVector): number[] {
  return FEATURE_KEYS.map((key) => fv[key]);
}

/**
 * Normalize an array of StrategyFeatureVectors using z-score normalization
 * per feature dimension.
 *
 * Returns a 2D number array where each row is a normalized feature vector.
 * Features with zero stddev (constant) are set to 0 after normalization.
 */
export function normalizeFeatures(
  vectors: StrategyFeatureVector[],
): number[][] {
  if (vectors.length === 0) return [];

  const raw = vectors.map(featureVectorToArray);
  const dim = raw[0].length;
  const n = raw.length;

  // Compute mean and stddev per dimension
  const means: number[] = new Array<number>(dim);
  const stddevs: number[] = new Array<number>(dim);

  for (let d = 0; d < dim; d++) {
    const col = raw.map((row) => row[d]);
    means[d] = mean(col);
    stddevs[d] = stddev(col);
  }

  // Z-score normalize
  const result: number[][] = Array.from(
    { length: n },
    () => new Array<number>(dim),
  );

  for (let i = 0; i < n; i++) {
    for (let d = 0; d < dim; d++) {
      result[i][d] = stddevs[d] > 0 ? (raw[i][d] - means[d]) / stddevs[d] : 0;
    }
  }

  return result;
}
