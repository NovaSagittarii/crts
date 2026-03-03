import { describe, expect, test } from 'vitest';

import { GridView } from './grid-view.js';

describe('grid-view', () => {
  test('keeps traversal order and includes dead cells in cells()', () => {
    const gridView = GridView.fromCells([
      { x: 0, y: 0, alive: true },
      { x: 1, y: 0, alive: false },
      { x: 0, y: 1, alive: true },
      { x: 1, y: 1, alive: false },
    ]);

    expect(gridView.cells()).toEqual([
      { x: 0, y: 0, alive: true },
      { x: 1, y: 0, alive: false },
      { x: 0, y: 1, alive: true },
      { x: 1, y: 1, alive: false },
    ]);
  });

  test('preserves negative coordinates in bounds and lookup APIs', () => {
    const gridView = GridView.fromCells([
      { x: -1, y: -1, alive: true },
      { x: 0, y: -1, alive: false },
      { x: -1, y: 0, alive: false },
      { x: 0, y: 0, alive: true },
    ]);

    expect(gridView.bounds()).toEqual({
      minX: -1,
      minY: -1,
      maxX: 0,
      maxY: 0,
      width: 2,
      height: 2,
    });
    expect(gridView.cellAt(-1, -1)).toEqual({ x: -1, y: -1, alive: true });
    expect(gridView.cellAt(1, 1)).toBeNull();
    expect(gridView.occupiedCells()).toEqual([
      { x: -1, y: -1 },
      { x: 0, y: 0 },
    ]);
    expect(Array.from(gridView.toUint8Array())).toEqual([1, 0, 0, 1]);
  });

  test('throws when duplicate coordinates are provided', () => {
    expect(() => {
      GridView.fromCells([
        { x: 3, y: 2, alive: true },
        { x: 3, y: 2, alive: false },
      ]);
    }).toThrow(/duplicate coordinates/iu);
  });
});
