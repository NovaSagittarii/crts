import { describe, expect, test } from 'vitest';

import { Grid, type Vector2 } from './grid.js';

function hasCells(grid: Grid, aliveCells: readonly Vector2[]): boolean {
  const expected = new Set(aliveCells.map(({ x, y }) => `${x},${y}`));

  for (let y = 0; y < grid.height; y += 1) {
    for (let x = 0; x < grid.width; x += 1) {
      const key = `${x},${y}`;
      if (grid.isCellAlive(x, y) !== expected.has(key)) {
        return false;
      }
    }
  }

  return true;
}

describe('grid', () => {
  test('initializes a dead grid by default', () => {
    const grid = new Grid(5, 5);

    expect(grid.width).toBe(5);
    expect(grid.height).toBe(5);
    expect(grid.topology).toBe('torus');
    expect([...grid.cells()].every((cell) => cell.alive === 0)).toBe(true);
  });

  test('supports alive-cell initialization', () => {
    const grid = new Grid(
      4,
      3,
      [
        { x: 0, y: 0 },
        { x: 2, y: 1 },
      ],
      'flat',
    );

    expect(
      hasCells(grid, [
        { x: 0, y: 0 },
        { x: 2, y: 1 },
      ]),
    ).toBe(true);
  });

  test('setCell wraps on torus topology', () => {
    const grid = new Grid(4, 4);
    grid.setCell(-1, 0, 1);
    grid.setCell(4, 3, 1);

    expect(grid.isCellAlive(3, 0)).toBe(true);
    expect(grid.isCellAlive(0, 3)).toBe(true);
  });

  test('setCell ignores out-of-bounds and invalid coordinates on flat topology', () => {
    const grid = new Grid(4, 4, [], 'flat');
    grid.setCell(-1, 0, 1);
    grid.setCell(4, 1, 1);
    grid.setCell(0.5, 2, 1);
    grid.setCell(2, Number.NaN, 1);
    grid.setCell(1, 1, 1);

    expect(hasCells(grid, [{ x: 1, y: 1 }])).toBe(true);
  });

  test('keeps a 2x2 block stable across generations', () => {
    const block = [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ];
    const grid = new Grid(8, 8, block);

    for (let i = 0; i < 5; i += 1) {
      expect(hasCells(grid, block)).toBe(true);
      grid.step();
    }
  });

  test('moves a glider diagonally over four ticks', () => {
    const gliderStart = [
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ];
    const gliderAfterFourTicks = [
      { x: 3, y: 2 },
      { x: 4, y: 3 },
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
    ];
    const grid = new Grid(10, 10, gliderStart);

    for (let i = 0; i < 4; i += 1) {
      grid.step();
    }

    expect(hasCells(grid, gliderAfterFourTicks)).toBe(true);
  });

  test('wraps neighbor checks across torus edges', () => {
    const grid = new Grid(5, 5, [
      { x: 0, y: 0 },
      { x: 0, y: 4 },
      { x: 4, y: 0 },
    ]);

    grid.step();

    expect(
      hasCells(grid, [
        { x: 0, y: 0 },
        { x: 0, y: 4 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ]),
    ).toBe(true);
  });

  test('does not wrap neighbor checks on flat topology', () => {
    const grid = new Grid(
      5,
      5,
      [
        { x: 0, y: 0 },
        { x: 0, y: 4 },
        { x: 4, y: 0 },
      ],
      'flat',
    );

    grid.step();

    expect([...grid.cells()].every((cell) => cell.alive === 0)).toBe(true);
  });

  test('step mutates grid state and clone isolates snapshots', () => {
    const grid = new Grid(6, 6, [
      { x: 2, y: 1 },
      { x: 3, y: 2 },
      { x: 1, y: 3 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ]);
    const snapshot = grid.clone();

    grid.step();

    expect(
      hasCells(snapshot, [
        { x: 2, y: 1 },
        { x: 3, y: 2 },
        { x: 1, y: 3 },
        { x: 2, y: 3 },
        { x: 3, y: 3 },
      ]),
    ).toBe(true);
    expect([...grid.cells()]).not.toEqual([...snapshot.cells()]);
  });

  test('apply pastes source cells and compare counts mismatches', () => {
    const base = new Grid(4, 4, [], 'flat');
    const source = new Grid(
      2,
      2,
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      'flat',
    );

    expect(base.compare(source, { x: 1, y: 1 })).toBe(2);

    base.apply(source, { x: 1, y: 1 });

    expect(base.compare(source, { x: 1, y: 1 })).toBe(0);
    expect(
      hasCells(base, [
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBe(true);
  });

  test('apply respects destination topology behavior', () => {
    const source = new Grid(2, 2, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);

    const torus = new Grid(4, 4);
    torus.apply(source, { x: 3, y: 3 });
    expect(
      hasCells(torus, [
        { x: 3, y: 3 },
        { x: 0, y: 3 },
        { x: 3, y: 0 },
        { x: 0, y: 0 },
      ]),
    ).toBe(true);

    const flat = new Grid(4, 4, [], 'flat');
    flat.apply(source, { x: 3, y: 3 });
    expect(hasCells(flat, [{ x: 3, y: 3 }])).toBe(true);
  });

  test('packs byte-per-cell grids into a compact bit array', () => {
    const grid = new Grid(5, 2, [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
      { x: 1, y: 1 },
      { x: 3, y: 1 },
    ]);

    const packed = grid.toPacked();

    expect([...new Uint8Array(packed)]).toEqual([0b1011_0010, 0b1000_0000]);
  });

  test('fromPacked restores bit arrays into byte-per-cell grid values', () => {
    const packed = new Uint8Array([0b1011_0010, 0b1000_0000]);

    const grid = Grid.fromPacked(packed, 5, 2, 'flat');

    expect([...grid.cells()].map((cell) => cell.alive)).toEqual([
      1, 0, 1, 1, 0, 0, 1, 0, 1, 0,
    ]);
  });

  test('round-trips between unpacked and packed representations', () => {
    const grid = new Grid(11, 7, [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 4, y: 2 },
      { x: 6, y: 5 },
      { x: 10, y: 6 },
    ]);

    const repacked = grid.toPacked();
    const unpacked = Grid.fromPacked(repacked, 11, 7);

    expect([...unpacked.cells()]).toEqual([...grid.cells()]);
  });

  test('returns an unpacked copy of the grid bytes', () => {
    const grid = new Grid(3, 2, [
      { x: 1, y: 0 },
      { x: 0, y: 1 },
    ]);

    const bytes = grid.toUnpacked();
    expect([...bytes]).toEqual([0, 1, 0, 1, 0, 0]);

    bytes[0] = 1;
    expect(grid.isCellAlive(0, 0)).toBe(false);
  });

  test('iterates cells in row-major order', () => {
    const grid = new Grid(3, 2, [
      { x: 1, y: 0 },
      { x: 2, y: 1 },
    ]);

    expect([...grid.cells()]).toEqual([
      { x: 0, y: 0, alive: 0 },
      { x: 1, y: 0, alive: 1 },
      { x: 2, y: 0, alive: 0 },
      { x: 0, y: 1, alive: 0 },
      { x: 1, y: 1, alive: 0 },
      { x: 2, y: 1, alive: 1 },
    ]);
  });
});
