import { describe, expect, test } from 'vitest';

import { GridView } from './grid-view.js';
import {
  createIdentityPlacementTransform,
  normalizePlacementTransform,
  projectPlacementToWorld,
  projectTemplateWithTransform,
  wrapCoordinate,
} from './placement-transform.js';

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

  test('creates identity transforms for empty and invalid payloads', () => {
    expect(createIdentityPlacementTransform()).toEqual({
      operations: [],
      matrix: {
        xx: 1,
        xy: 0,
        yx: 0,
        yy: 1,
      },
    });

    expect(normalizePlacementTransform(undefined)).toEqual(
      createIdentityPlacementTransform(),
    );
    expect(
      normalizePlacementTransform({
        operations: ['rotate', 'bad-op' as 'rotate', 'mirror-vertical'],
      }),
    ).toEqual({
      operations: ['rotate', 'mirror-vertical'],
      matrix: {
        xx: 0,
        xy: 1,
        yx: 1,
        yy: 0,
      },
    });
  });

  test('keeps normalizePlacementTransform matrices equivalent to GridView chains', () => {
    const baseGrid = GridView.fromCells([
      { x: 0, y: 0, alive: true },
      { x: 1, y: 0, alive: false },
      { x: 2, y: 0, alive: true },
      { x: 0, y: 1, alive: true },
      { x: 1, y: 1, alive: true },
      { x: 2, y: 1, alive: false },
    ]);

    const normalized = normalizePlacementTransform({
      operations: ['rotate', 'mirror-horizontal', 'rotate'],
    });
    const fromMatrix = baseGrid.applyTransform(normalized.matrix);
    const fromChain = baseGrid.rotate().flipHorizontal().rotate();

    expect(fromMatrix.cells()).toEqual(fromChain.cells());
    expect(baseGrid.applyTransform(normalized.matrix).cells()).toEqual(
      fromMatrix.cells(),
    );
  });

  test('fails fast on retired legacy projection entrypoints', () => {
    expect(() => {
      projectTemplateWithTransform(
        {
          width: 2,
          height: 2,
          cells: new Uint8Array([1, 0, 0, 1]),
          checks: [],
        },
        createIdentityPlacementTransform(),
      );
    }).toThrow(/retired/iu);
    expect(() => {
      projectTemplateWithTransform(
        {
          width: 2,
          height: 2,
          cells: new Uint8Array([1, 0, 0, 1]),
          checks: [],
        },
        createIdentityPlacementTransform(),
      );
    }).toThrow(/template\.grid\(\)/iu);

    expect(() => {
      projectPlacementToWorld(
        {
          width: 1,
          height: 1,
          occupiedCells: [{ x: 0, y: 0 }],
          checks: [],
        },
        0,
        0,
        5,
        5,
      );
    }).toThrow(/retired/iu);
  });

  test('wraps positive and negative coordinates within room bounds', () => {
    expect(wrapCoordinate(7, 5)).toBe(2);
    expect(wrapCoordinate(-1, 5)).toBe(4);
    expect(wrapCoordinate(-6, 5)).toBe(4);
  });
});
