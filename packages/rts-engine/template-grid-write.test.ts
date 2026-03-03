import { describe, expect, test } from 'vitest';

import {
  applyTemplateWriteProjection,
  countTemplateWriteDiffCells,
  projectTemplateGridWritePlacement,
} from './template-grid-write.js';

const RECT_TEMPLATE = {
  width: 3,
  height: 2,
  cells: new Uint8Array([1, 0, 1, 0, 1, 1]),
  checks: [
    { x: 0, y: 0 },
    { x: 2, y: 1 },
  ],
};

function countChangedCells(before: Uint8Array, after: Uint8Array): number {
  let changed = 0;
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] !== after[index]) {
      changed += 1;
    }
  }
  return changed;
}

describe('template-grid-write', () => {
  test('projects deterministic wrapped world cells including dead-cell writes', () => {
    const projection = projectTemplateGridWritePlacement(
      RECT_TEMPLATE,
      4,
      3,
      5,
      4,
      undefined,
    );

    expect(projection.bounds).toEqual({
      x: 4,
      y: 3,
      width: 3,
      height: 2,
    });
    expect(projection.areaCells).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 4, y: 0 },
      { x: 0, y: 3 },
      { x: 1, y: 3 },
      { x: 4, y: 3 },
    ]);
    expect(projection.footprint).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 3 },
      { x: 4, y: 3 },
    ]);
    expect(projection.worldCells).toHaveLength(
      projection.bounds.width * projection.bounds.height,
    );
    expect(
      projection.worldCells.some((cell) =>
        cell.x === 0 && cell.y === 3 ? !cell.alive : false,
      ),
    ).toBe(true);
    expect(
      new Set(projection.worldCells.map((cell) => `${cell.x},${cell.y}`)),
    ).toEqual(new Set(['4,3', '0,3', '1,3', '4,0', '0,0', '1,0']));
  });

  test('keeps equivalent transform orientations parity-stable for diff/apply', () => {
    const anchorX = 4;
    const anchorY = 3;
    const identity = projectTemplateGridWritePlacement(
      RECT_TEMPLATE,
      anchorX,
      anchorY,
      5,
      4,
      undefined,
    );
    const equivalent = projectTemplateGridWritePlacement(
      RECT_TEMPLATE,
      anchorX,
      anchorY,
      5,
      4,
      {
        operations: ['rotate', 'rotate', 'rotate', 'rotate'],
      },
    );

    expect(equivalent.bounds).toEqual(identity.bounds);
    expect(equivalent.areaCells).toEqual(identity.areaCells);
    expect(equivalent.footprint).toEqual(identity.footprint);

    const baselineGrid = new Uint8Array([
      0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 1, 0,
    ]);
    const diffIdentity = countTemplateWriteDiffCells(
      baselineGrid,
      5,
      4,
      identity,
    );
    const diffEquivalent = countTemplateWriteDiffCells(
      baselineGrid,
      5,
      4,
      equivalent,
    );
    expect(diffEquivalent).toBe(diffIdentity);

    const gridFromIdentity = Uint8Array.from(baselineGrid);
    const gridFromEquivalent = Uint8Array.from(baselineGrid);
    applyTemplateWriteProjection(gridFromIdentity, 5, 4, identity);
    applyTemplateWriteProjection(gridFromEquivalent, 5, 4, equivalent);
    expect(gridFromEquivalent).toEqual(gridFromIdentity);
  });

  test('keeps compare/apply traversal equivalent for transformed projections', () => {
    const projection = projectTemplateGridWritePlacement(
      RECT_TEMPLATE,
      2,
      4,
      6,
      6,
      {
        operations: ['rotate', 'mirror-horizontal'],
      },
    );

    const grid = new Uint8Array([
      0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 0,
      1, 1, 0, 0, 1, 1, 0, 0, 1, 0, 1,
    ]);
    const beforeApply = Uint8Array.from(grid);

    const diffBeforeApply = countTemplateWriteDiffCells(grid, 6, 6, projection);
    const didApply = applyTemplateWriteProjection(grid, 6, 6, projection);
    const diffAfterApply = countTemplateWriteDiffCells(grid, 6, 6, projection);

    expect(didApply).toBe(true);
    expect(countChangedCells(beforeApply, grid)).toBe(diffBeforeApply);
    expect(diffAfterApply).toBe(0);
  });
});
