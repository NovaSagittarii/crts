import { describe, expect, test } from 'vitest';

import { chooseGridCellSize } from '../../apps/web/src/canvas-layout.js';

describe('chooseGridCellSize', () => {
  test('returns minimum cell size when grid width is invalid', () => {
    expect(chooseGridCellSize(0, 1200)).toBe(3);
    expect(chooseGridCellSize(-4, 1200)).toBe(3);
  });

  test('caps cell size at maximum when viewport can fit large cells', () => {
    expect(chooseGridCellSize(20, 900)).toBe(8);
  });

  test('uses viewport width budget after horizontal padding', () => {
    expect(chooseGridCellSize(100, 632)).toBe(6);
    expect(chooseGridCellSize(100, 332)).toBe(3);
  });

  test('clamps to minimum for very dense grids', () => {
    expect(chooseGridCellSize(180, 800)).toBe(4);
    expect(chooseGridCellSize(260, 800)).toBe(3);
  });
});
