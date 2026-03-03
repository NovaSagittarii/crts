import { describe, expect, test } from 'vitest';

import { GridView } from './grid-view.js';
import { normalizePlacementTransform } from './placement-transform.js';

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

  test('returns new views for translate/rotate/flip operations', () => {
    const gridView = GridView.fromCells([
      { x: 0, y: 0, alive: true },
      { x: 1, y: 0, alive: false },
      { x: 0, y: 1, alive: true },
      { x: 1, y: 1, alive: true },
    ]);

    const translated = gridView.translate(2, -3);
    const rotated = gridView.rotate();
    const flipped = gridView.flipHorizontal();

    expect(translated).not.toBe(gridView);
    expect(rotated).not.toBe(gridView);
    expect(flipped).not.toBe(gridView);
    expect(gridView.cells()).toEqual([
      { x: 0, y: 0, alive: true },
      { x: 1, y: 0, alive: false },
      { x: 0, y: 1, alive: true },
      { x: 1, y: 1, alive: true },
    ]);
    expect(translated.cells()).toEqual([
      { x: 2, y: -3, alive: true },
      { x: 3, y: -3, alive: false },
      { x: 2, y: -2, alive: true },
      { x: 3, y: -2, alive: true },
    ]);
  });

  test('keeps transform chaining order-sensitive and deterministic', () => {
    const gridView = GridView.fromCells([
      { x: 0, y: 0, alive: true },
      { x: 1, y: 0, alive: false },
      { x: 2, y: 0, alive: true },
      { x: 0, y: 1, alive: true },
      { x: 1, y: 1, alive: true },
      { x: 2, y: 1, alive: false },
    ]);

    const rotateThenFlip = gridView.rotate().flipHorizontal();
    const flipThenRotate = gridView.flipHorizontal().rotate();
    expect(rotateThenFlip.cells()).not.toEqual(flipThenRotate.cells());

    const firstRun = gridView.rotate().flipVertical().translate(-2, 5);
    const secondRun = gridView.rotate().flipVertical().translate(-2, 5);
    expect(firstRun.cells()).toEqual(secondRun.cells());
  });

  test('matches placement matrix parity for rotate cycle and applyMatrix alias', () => {
    const gridView = GridView.fromCells([
      { x: 0, y: 0, alive: true },
      { x: 1, y: 0, alive: false },
      { x: 2, y: 0, alive: true },
      { x: 0, y: 1, alive: true },
      { x: 1, y: 1, alive: true },
      { x: 2, y: 1, alive: false },
    ]);

    const rotateMatrix = normalizePlacementTransform({
      operations: ['rotate'],
    }).matrix;
    const rotated = gridView.rotate();
    expect(rotated.cells()).toEqual(
      gridView.applyTransform(rotateMatrix).cells(),
    );
    expect(rotated.cells()).toEqual(gridView.applyMatrix(rotateMatrix).cells());

    expect(gridView.rotate(4).cells()).toEqual(gridView.cells());
    expect(gridView.rotate(-1).cells()).toEqual(gridView.rotate(3).cells());
  });

  test('rejects out-of-contract matrices with actionable errors', () => {
    const gridView = GridView.fromCells([{ x: 0, y: 0, alive: true }]);

    expect(() => {
      gridView.applyTransform({ xx: 2, xy: 0, yx: 0, yy: 1 });
    }).toThrow(/placement-safe/iu);
    expect(() => {
      gridView.applyTransform({ xx: 2, xy: 0, yx: 0, yy: 1 });
    }).toThrow(/normalizePlacementTransform/iu);
  });
});
