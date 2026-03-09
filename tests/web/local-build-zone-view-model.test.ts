import { describe, expect, test } from 'vitest';

import {
  isBuildZoneCoveredByContributor,
  projectBuildZoneContributor,
} from '#rts-engine';

import {
  computeLocalBuildZoneOverlay,
  computeLocalBuildZoneSignature,
} from '../../apps/web/src/local-build-zone-view-model.js';

describe('computeLocalBuildZoneSignature', () => {
  test('is stable regardless of structure input order', () => {
    const left = computeLocalBuildZoneSignature([
      { key: 'b', x: 10, y: 5, width: 2, height: 2, buildRadius: 3 },
      { key: 'a', x: 2, y: 2, width: 1, height: 1, buildRadius: 4 },
    ]);
    const right = computeLocalBuildZoneSignature([
      { key: 'a', x: 2, y: 2, width: 1, height: 1, buildRadius: 4 },
      { key: 'b', x: 10, y: 5, width: 2, height: 2, buildRadius: 3 },
    ]);

    expect(left).toBe(right);
  });
});

describe('computeLocalBuildZoneOverlay', () => {
  test('skips recompute when signature is unchanged', () => {
    const coverageCache = new Map<string, readonly number[]>();
    const first = computeLocalBuildZoneOverlay({
      structures: [
        { key: 'alpha', x: 8, y: 8, width: 1, height: 1, buildRadius: 5 },
      ],
      gridWidth: 30,
      gridHeight: 30,
      previousSignature: '',
      coverageCache,
      maxCoverageCacheEntries: 32,
    });

    expect(first.changed).toBe(true);
    expect(first.cellKeys.length).toBeGreaterThan(0);

    const second = computeLocalBuildZoneOverlay({
      structures: [
        { key: 'alpha', x: 8, y: 8, width: 1, height: 1, buildRadius: 5 },
      ],
      gridWidth: 30,
      gridHeight: 30,
      previousSignature: first.signature,
      coverageCache,
      maxCoverageCacheEntries: 32,
    });

    expect(second.changed).toBe(false);
    expect(second.cellKeys).toEqual([]);
  });

  test('returns empty coverage for zero-radius or invalid structures', () => {
    const result = computeLocalBuildZoneOverlay({
      structures: [
        { key: 'dead', x: 5, y: 5, width: 2, height: 2, buildRadius: 0 },
        { key: 'flat', x: 7, y: 7, width: 0, height: 3, buildRadius: 4 },
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
      structures: [
        { key: 'edge', x: 0, y: 0, width: 1, height: 1, buildRadius: 5 },
      ],
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

  test('returns integer-aligned cell keys while preserving float-radius coverage', () => {
    const gridWidth = 80;
    const gridHeight = 80;
    const structure = {
      key: 'alpha',
      x: 30,
      y: 30,
      width: 1,
      height: 1,
      buildRadius: 5,
    };
    const contributor = projectBuildZoneContributor(structure);
    const result = computeLocalBuildZoneOverlay({
      structures: [structure],
      gridWidth,
      gridHeight,
      previousSignature: '',
      coverageCache: new Map<string, readonly number[]>(),
      maxCoverageCacheEntries: 32,
    });

    const expectedCellKeys: number[] = [];
    for (let y = 0; y < gridHeight; y += 1) {
      for (let x = 0; x < gridWidth; x += 1) {
        if (isBuildZoneCoveredByContributor(contributor, x, y)) {
          expectedCellKeys.push(y * gridWidth + x);
        }
      }
    }

    expect(result.cellKeys).toEqual(expectedCellKeys);
    expect(result.cellKeys.every(Number.isInteger)).toBe(true);
  });

  test('recomputes when a structure build radius changes', () => {
    const coverageCache = new Map<string, readonly number[]>();
    const first = computeLocalBuildZoneOverlay({
      structures: [
        { key: 'alpha', x: 8, y: 8, width: 1, height: 1, buildRadius: 5 },
      ],
      gridWidth: 30,
      gridHeight: 30,
      previousSignature: '',
      coverageCache,
      maxCoverageCacheEntries: 32,
    });

    const second = computeLocalBuildZoneOverlay({
      structures: [
        { key: 'alpha', x: 8, y: 8, width: 1, height: 1, buildRadius: 0 },
      ],
      gridWidth: 30,
      gridHeight: 30,
      previousSignature: first.signature,
      coverageCache,
      maxCoverageCacheEntries: 32,
    });

    expect(second.changed).toBe(true);
    expect(second.cellKeys).toEqual([]);
  });

  test('caps cache growth when cache limit is reached', () => {
    const coverageCache = new Map<string, readonly number[]>();
    computeLocalBuildZoneOverlay({
      structures: [
        { key: 'a', x: 4, y: 4, width: 1, height: 1, buildRadius: 5 },
      ],
      gridWidth: 40,
      gridHeight: 40,
      previousSignature: '',
      coverageCache,
      maxCoverageCacheEntries: 1,
    });

    computeLocalBuildZoneOverlay({
      structures: [
        { key: 'b', x: 12, y: 12, width: 1, height: 1, buildRadius: 7 },
      ],
      gridWidth: 40,
      gridHeight: 40,
      previousSignature: '',
      coverageCache,
      maxCoverageCacheEntries: 1,
    });

    expect(coverageCache.size).toBe(1);
    expect([...coverageCache.keys()][0]).toContain('12,12,1,1,7');
  });
});
