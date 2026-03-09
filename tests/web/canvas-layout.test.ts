import { describe, expect, test } from 'vitest';

import { chooseGridCellSize } from '../../apps/web/src/canvas-layout.js';

describe('chooseGridCellSize', () => {
  test('returns minimum cell size when grid dimensions are invalid', () => {
    expect(chooseGridCellSize(0, 20, 1200, 900)).toBe(3);
    expect(chooseGridCellSize(20, 0, 1200, 900)).toBe(3);
  });

  test('uses full viewport budget for small grids', () => {
    expect(chooseGridCellSize(12, 10, 1800, 1200)).toBe(118);
    expect(chooseGridCellSize(16, 16, 1920, 1080)).toBe(66);
  });

  test('uses viewport width budget after horizontal padding', () => {
    expect(chooseGridCellSize(100, 40, 632, 900)).toBe(6);
    expect(chooseGridCellSize(100, 40, 332, 900)).toBe(3);
  });

  test('limits cell size by viewport height budget', () => {
    expect(chooseGridCellSize(40, 120, 1200, 500)).toBe(4);
  });

  test('clamps to minimum for very dense grids', () => {
    expect(chooseGridCellSize(260, 260, 800, 800)).toBe(3);
  });
});
