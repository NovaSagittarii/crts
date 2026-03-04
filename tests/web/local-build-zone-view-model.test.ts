import { describe, expect, test } from 'vitest';

import {
  computeLocalBuildZoneOverlay,
  computeLocalBuildZoneSignature,
} from '../../apps/web/src/local-build-zone-view-model.js';

describe('computeLocalBuildZoneSignature', () => {
  test('is stable regardless of structure input order', () => {
    const left = computeLocalBuildZoneSignature([
      { key: 'b', x: 10, y: 5, width: 2, height: 2, hp: 3 },
      { key: 'a', x: 2, y: 2, width: 1, height: 1, hp: 4 },
    ]);
    const right = computeLocalBuildZoneSignature([
      { key: 'a', x: 2, y: 2, width: 1, height: 1, hp: 4 },
      { key: 'b', x: 10, y: 5, width: 2, height: 2, hp: 3 },
    ]);

    expect(left).toBe(right);
  });
});

describe('computeLocalBuildZoneOverlay', () => {
  test('skips recompute when signature is unchanged', () => {
    const coverageCache = new Map<string, readonly number[]>();
    const first = computeLocalBuildZoneOverlay({
      structures: [{ key: 'alpha', x: 8, y: 8, width: 1, height: 1, hp: 5 }],
      gridWidth: 30,
      gridHeight: 30,
      previousSignature: '',
      coverageCache,
      maxCoverageCacheEntries: 32,
    });

    expect(first.changed).toBe(true);
    expect(first.cellKeys.length).toBeGreaterThan(0);

    const second = computeLocalBuildZoneOverlay({
      structures: [{ key: 'alpha', x: 8, y: 8, width: 1, height: 1, hp: 5 }],
      gridWidth: 30,
      gridHeight: 30,
      previousSignature: first.signature,
      coverageCache,
      maxCoverageCacheEntries: 32,
    });

    expect(second.changed).toBe(false);
    expect(second.cellKeys).toEqual([]);
  });

  test('returns empty coverage for non-contributing structures', () => {
    const result = computeLocalBuildZoneOverlay({
      structures: [
        { key: 'dead', x: 5, y: 5, width: 2, height: 2, hp: 0 },
        { key: 'flat', x: 7, y: 7, width: 0, height: 3, hp: 4 },
      ],
      gridWidth: 30,
      gridHeight: 30,
      previousSignature: '',
      coverageCache: new Map<string, readonly number[]>(),
      maxCoverageCacheEntries: 32,
    });

    expect(result.changed).toBe(true);
    expect(result.cellKeys).toEqual([]);
  });

  test('keeps projected cells inside map bounds', () => {
    const result = computeLocalBuildZoneOverlay({
      structures: [{ key: 'edge', x: 0, y: 0, width: 1, height: 1, hp: 5 }],
      gridWidth: 5,
      gridHeight: 5,
      previousSignature: '',
      coverageCache: new Map<string, readonly number[]>(),
      maxCoverageCacheEntries: 32,
    });

    expect(result.cellKeys).toContain(0);
    for (const key of result.cellKeys) {
      expect(key).toBeGreaterThanOrEqual(0);
      expect(key).toBeLessThan(25);
    }
  });

  test('caps cache growth when cache limit is reached', () => {
    const coverageCache = new Map<string, readonly number[]>();
    computeLocalBuildZoneOverlay({
      structures: [{ key: 'a', x: 4, y: 4, width: 1, height: 1, hp: 5 }],
      gridWidth: 40,
      gridHeight: 40,
      previousSignature: '',
      coverageCache,
      maxCoverageCacheEntries: 1,
    });

    computeLocalBuildZoneOverlay({
      structures: [{ key: 'b', x: 12, y: 12, width: 1, height: 1, hp: 5 }],
      gridWidth: 40,
      gridHeight: 40,
      previousSignature: '',
      coverageCache,
      maxCoverageCacheEntries: 1,
    });

    expect(coverageCache.size).toBe(1);
    expect([...coverageCache.keys()][0]).toContain('12,12,1,1,5');
  });
});
