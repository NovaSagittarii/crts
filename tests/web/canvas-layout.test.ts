import { describe, expect, test } from 'vitest';

import { chooseGridCellSize } from '../../apps/web/src/canvas-layout.js';

describe('chooseGridCellSize', () => {
  test('returns minimum cell size when grid dimensions are invalid', () => {
    expect(chooseGridCellSize(0, 20, 1200, 900)).toBe(3);
    expect(chooseGridCellSize(20, 0, 1200, 900)).toBe(3);
  });

  test('caps cell size at maximum when viewport can fit large cells', () => {
    expect(chooseGridCellSize(12, 10, 1800, 1200)).toBe(24);
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
