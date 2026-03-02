import { describe, expect, test } from 'vitest';

import {
  createIdentityPlacementTransform,
  normalizePlacementTransform,
  projectPlacementToWorld,
  projectTemplateWithTransform,
} from './placement-transform.js';

function asKeySet(cells: ReadonlyArray<{ x: number; y: number }>): Set<string> {
  return new Set(cells.map((cell) => `${cell.x},${cell.y}`));
}

describe('placement-transform', () => {
  test('keeps composition order-sensitive for transform operations', () => {
    const rotateThenMirror = normalizePlacementTransform({
      operations: ['rotate', 'mirror-horizontal'],
    });
    const mirrorThenRotate = normalizePlacementTransform({
      operations: ['mirror-horizontal', 'rotate'],
    });

    expect(rotateThenMirror.matrix).not.toEqual(mirrorThenRotate.matrix);
  });

  test('rotates rectangular templates and returns to identity after four rotates', () => {
    const template = {
      width: 3,
      height: 2,
      cells: new Uint8Array([1, 0, 1, 1, 1, 0]),
      checks: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 1, y: 1 },
      ],
    };

    const rotated = projectTemplateWithTransform(
      template,
      normalizePlacementTransform({ operations: ['rotate'] }),
    );

    expect(rotated.width).toBe(2);
    expect(rotated.height).toBe(3);
    expect(asKeySet(rotated.occupiedCells)).toEqual(
      new Set(['0,0', '1,1', '0,2', '1,2']),
    );

    const cycled = projectTemplateWithTransform(
      template,
      normalizePlacementTransform({
        operations: ['rotate', 'rotate', 'rotate', 'rotate'],
      }),
    );

    expect(cycled.width).toBe(template.width);
    expect(cycled.height).toBe(template.height);
    expect(Array.from(cycled.cells)).toEqual(Array.from(template.cells));
    expect(asKeySet(cycled.occupiedCells)).toEqual(
      asKeySet(
        projectTemplateWithTransform(
          template,
          createIdentityPlacementTransform(),
        ).occupiedCells,
      ),
    );
  });

  test('projects wrapped world placement for area, footprint, and checks', () => {
    const projection = projectPlacementToWorld(
      {
        width: 2,
        height: 2,
        occupiedCells: [
          { x: 0, y: 0 },
          { x: 1, y: 1 },
        ],
        checks: [{ x: 1, y: 0 }],
      },
      4,
      4,
      5,
      5,
    );

    expect(projection.bounds).toEqual({
      x: 4,
      y: 4,
      width: 2,
      height: 2,
    });
    expect(asKeySet(projection.areaCells)).toEqual(
      new Set(['4,4', '0,4', '4,0', '0,0']),
    );
    expect(asKeySet(projection.occupiedCells)).toEqual(new Set(['4,4', '0,0']));
    expect(asKeySet(projection.checks)).toEqual(new Set(['0,4']));
  });
});
