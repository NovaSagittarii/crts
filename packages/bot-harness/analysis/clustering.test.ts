import { describe, expect, it } from 'vitest';

import {
  featureVectorToArray,
  kMeans,
  normalizeFeatures,
} from './clustering.js';
import type { StrategyFeatureVector } from './types.js';

// ── helpers ────────────────────────────────────────────────────────────

/** Generate points clustered around a center with small noise */
function clusterPoints(
  cx: number,
  cy: number,
  count: number,
  noise: number = 0.5,
): number[][] {
  const points: number[][] = [];
  for (let i = 0; i < count; i++) {
    // Deterministic spread using index
    const angle = (i / count) * 2 * Math.PI;
    const r = noise * ((i % 3) / 3 + 0.1);
    points.push([cx + r * Math.cos(angle), cy + r * Math.sin(angle)]);
  }
  return points;
}

function makeFeatureVector(
  overrides: Partial<StrategyFeatureVector> = {},
): StrategyFeatureVector {
  return {
    firstBuildTick: 50,
    buildDensity: 1.0,
    buildBurstiness: 5,
    avgResourcesAtBuild: 100,
    resourceEfficiency: 0.7,
    territoryGrowthRate: 0.5,
    finalTerritoryRatio: 0.5,
    uniqueTemplatesUsed: 2,
    templateEntropy: 1.0,
    avgDistanceToEnemy: 0,
    structureSpread: 0,
    ...overrides,
  };
}

// ── K-means tests ──────────────────────────────────────────────────────

describe('kMeans', () => {
  it('correctly assigns 4 clearly separated 2D clusters', () => {
    const data = [
      ...clusterPoints(0, 0, 5),
      ...clusterPoints(0, 10, 5),
      ...clusterPoints(10, 0, 5),
      ...clusterPoints(10, 10, 5),
    ];

    const result = kMeans(data, 4, { seed: 42 });
    expect(result.k).toBe(4);
    expect(result.assignments).toHaveLength(20);
    expect(result.centroids).toHaveLength(4);

    // All points in same cluster group should share same assignment
    const cluster0 = new Set(result.assignments.slice(0, 5));
    const cluster1 = new Set(result.assignments.slice(5, 10));
    const cluster2 = new Set(result.assignments.slice(10, 15));
    const cluster3 = new Set(result.assignments.slice(15, 20));

    expect(cluster0.size).toBe(1);
    expect(cluster1.size).toBe(1);
    expect(cluster2.size).toBe(1);
    expect(cluster3.size).toBe(1);

    // All clusters should be different
    const allClusters = new Set([
      [...cluster0][0],
      [...cluster1][0],
      [...cluster2][0],
      [...cluster3][0],
    ]);
    expect(allClusters.size).toBe(4);
  });

  it('converges with k=1 with centroid at data mean', () => {
    const data = [
      [1, 2],
      [3, 4],
      [5, 6],
    ];
    const result = kMeans(data, 1, { seed: 42 });
    expect(result.k).toBe(1);
    expect(result.centroids).toHaveLength(1);
    expect(result.centroids[0][0]).toBeCloseTo(3, 5);
    expect(result.centroids[0][1]).toBeCloseTo(4, 5);
    expect(result.assignments).toEqual([0, 0, 0]);
  });

  it('returns empty assignments for empty data', () => {
    const result = kMeans([], 3, { seed: 42 });
    expect(result.assignments).toEqual([]);
    expect(result.centroids).toEqual([]);
    expect(result.k).toBe(0);
    expect(result.wcss).toBe(0);
  });

  it('produces deterministic results with same seed', () => {
    const data = [...clusterPoints(0, 0, 5), ...clusterPoints(10, 10, 5)];

    const a = kMeans(data, 2, { seed: 123 });
    const b = kMeans(data, 2, { seed: 123 });
    expect(a.assignments).toEqual(b.assignments);
    expect(a.wcss).toBe(b.wcss);
    expect(a.centroids).toEqual(b.centroids);
  });

  it('WCSS decreases as k increases from 1 to true cluster count', () => {
    const data = [
      ...clusterPoints(0, 0, 10),
      ...clusterPoints(20, 20, 10),
      ...clusterPoints(40, 0, 10),
    ];

    const wcss1 = kMeans(data, 1, { seed: 42 }).wcss;
    const wcss2 = kMeans(data, 2, { seed: 42 }).wcss;
    const wcss3 = kMeans(data, 3, { seed: 42 }).wcss;

    expect(wcss1).toBeGreaterThan(wcss2);
    expect(wcss2).toBeGreaterThan(wcss3);
  });
});

// ── normalizeFeatures tests ────────────────────────────────────────────

describe('normalizeFeatures', () => {
  it('z-score normalizes feature vectors', () => {
    const vectors = [
      makeFeatureVector({ buildDensity: 1.0, templateEntropy: 0.5 }),
      makeFeatureVector({ buildDensity: 3.0, templateEntropy: 1.5 }),
      makeFeatureVector({ buildDensity: 5.0, templateEntropy: 2.5 }),
    ];

    const normalized = normalizeFeatures(vectors);
    expect(normalized).toHaveLength(3);
    // Each row should have same number of features (11 features in StrategyFeatureVector)
    expect(normalized[0]).toHaveLength(11);
  });

  it('returns empty array for empty input', () => {
    expect(normalizeFeatures([])).toEqual([]);
  });
});

// ── featureVectorToArray tests ─────────────────────────────────────────

describe('featureVectorToArray', () => {
  it('converts StrategyFeatureVector to a number array', () => {
    const fv = makeFeatureVector();
    const arr = featureVectorToArray(fv);
    expect(arr).toHaveLength(11);
    expect(arr[0]).toBe(fv.firstBuildTick);
    expect(arr[1]).toBe(fv.buildDensity);
  });
});
