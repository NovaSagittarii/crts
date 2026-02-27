import { describe, expect, test } from 'vitest';

import {
  applyUpdates,
  createGrid,
  decodeGridBase64,
  encodeGridBase64,
  stepGrid,
  type CellUpdate,
} from './grid.js';

interface Cell {
  x: number;
  y: number;
}

function setCells(
  grid: Uint8Array,
  width: number,
  cells: Cell[],
  alive: number,
): void {
  const updates: CellUpdate[] = cells.map(({ x, y }) => ({ x, y, alive }));
  applyUpdates(grid, updates, width, grid.length / width);
}

function hasCells(
  grid: Uint8Array,
  width: number,
  aliveCells: Cell[],
): boolean {
  const expected = new Set(aliveCells.map(({ x, y }) => `${x},${y}`));

  for (let y = 0; y < grid.length / width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const key = `${x},${y}`;
      const isAlive = grid[y * width + x] === 1;
      if (isAlive !== expected.has(key)) {
        return false;
      }
    }
  }

  return true;
}

describe('grid', () => {
  test('initializes a dead grid by default', () => {
    const grid = createGrid({ width: 5, height: 5 });
    expect(grid).toHaveLength(25);
    expect([...grid].every((cell) => cell === 0)).toBe(true);
  });

  test('supports filled initialization', () => {
    const grid = createGrid({ width: 3, height: 2, fill: 1 });
    expect([...grid]).toEqual([1, 1, 1, 1, 1, 1]);
  });

  test('applies valid updates and ignores invalid updates', () => {
    const width = 4;
    const height = 4;
    const grid = createGrid({ width, height });

    applyUpdates(
      grid,
      [
        { x: 1, y: 1, alive: 1 },
        { x: 2, y: 2, alive: 1 },
        { x: -1, y: 0, alive: 1 },
        { x: 4, y: 1, alive: 1 },
        { x: 0.5, y: 3, alive: 1 },
        { x: 1, y: Number.NaN, alive: 1 },
      ],
      width,
      height,
    );

    expect(grid[1 * width + 1]).toBe(1);
    expect(grid[2 * width + 2]).toBe(1);
    expect(grid[0]).toBe(0);
    expect(grid[3]).toBe(0);
  });

  test('keeps a 2x2 block stable across generations', () => {
    const width = 8;
    const height = 8;
    const block = [
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
    ];

    let grid = createGrid({ width, height });
    setCells(grid, width, block, 1);

    for (let i = 0; i < 5; i += 1) {
      expect(hasCells(grid, width, block)).toBe(true);
      grid = stepGrid(grid, width, height);
    }
  });

  test('moves a glider diagonally over four ticks', () => {
    const width = 10;
    const height = 10;
    let grid = createGrid({ width, height });

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

    setCells(grid, width, gliderStart, 1);

    for (let i = 0; i < 4; i += 1) {
      grid = stepGrid(grid, width, height);
    }

    expect(hasCells(grid, width, gliderAfterFourTicks)).toBe(true);
  });

  test('wraps neighbor checks across torus edges', () => {
    const width = 5;
    const height = 5;
    const grid = createGrid({ width, height });
    setCells(
      grid,
      width,
      [
        { x: 0, y: 0 },
        { x: 0, y: 4 },
        { x: 4, y: 0 },
      ],
      1,
    );

    const next = stepGrid(grid, width, height);

    expect(
      hasCells(next, width, [
        { x: 0, y: 0 },
        { x: 0, y: 4 },
        { x: 4, y: 0 },
        { x: 4, y: 4 },
      ]),
    ).toBe(true);
  });

  test('does not mutate the input grid when stepping generations', () => {
    const width = 6;
    const height = 6;
    const grid = createGrid({ width, height });
    setCells(
      grid,
      width,
      [
        { x: 2, y: 1 },
        { x: 3, y: 2 },
        { x: 1, y: 3 },
        { x: 2, y: 3 },
        { x: 3, y: 3 },
      ],
      1,
    );

    const before = [...grid];
    const next = stepGrid(grid, width, height);

    expect([...grid]).toEqual(before);
    expect(next).not.toBe(grid);
  });

  test('encodes and decodes base64 grid payloads', () => {
    const width = 6;
    const height = 4;
    const grid = createGrid({ width, height });
    setCells(
      grid,
      width,
      [
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 1, y: 2 },
        { x: 4, y: 3 },
      ],
      1,
    );

    const encoded = encodeGridBase64(grid);
    const decoded = decodeGridBase64(encoded, width * height);

    expect([...decoded]).toEqual([...grid]);
  });

  test('preserves non-byte-aligned grids through base64 roundtrip', () => {
    const width = 3;
    const height = 3;
    const grid = createGrid({ width, height });
    setCells(
      grid,
      width,
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 2 },
      ],
      1,
    );

    const encoded = encodeGridBase64(grid);
    const decoded = decodeGridBase64(encoded, width * height);

    expect([...decoded]).toEqual([...grid]);
  });
});
