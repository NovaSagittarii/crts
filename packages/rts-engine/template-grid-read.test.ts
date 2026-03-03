import { describe, expect, test } from 'vitest';

import { normalizePlacementTransform } from './placement-transform.js';
import {
  deriveIntegrityMaskCells,
  estimateTransformedTemplateBounds,
  projectTransformedTemplateToWorld,
  transformTemplateWithGridView,
} from './template-grid-read.js';

const RECT_TEMPLATE = {
  width: 3,
  height: 2,
  cells: new Uint8Array([1, 0, 1, 0, 1, 1]),
  checks: [
    { x: 0, y: 0 },
    { x: 2, y: 1 },
  ],
};

describe('template-grid-read', () => {
  test('estimates transformed bounds using canonical matrix semantics', () => {
    expect(estimateTransformedTemplateBounds(RECT_TEMPLATE, undefined)).toEqual(
      {
        width: 3,
        height: 2,
      },
    );
    expect(
      estimateTransformedTemplateBounds(RECT_TEMPLATE, {
        operations: ['rotate'],
      }),
    ).toEqual({
      width: 2,
      height: 3,
    });
    expect(
      estimateTransformedTemplateBounds(RECT_TEMPLATE, {
        operations: ['rotate', 'rotate'],
      }),
    ).toEqual({
      width: 3,
      height: 2,
    });
    expect(
      estimateTransformedTemplateBounds(RECT_TEMPLATE, {
        operations: ['mirror-horizontal'],
      }),
    ).toEqual({
      width: 3,
      height: 2,
    });
    expect(
      estimateTransformedTemplateBounds(RECT_TEMPLATE, {
        operations: ['rotate', 'mirror-horizontal'],
      }),
    ).toEqual({
      width: 2,
      height: 3,
    });
  });

  test('projects transformed template output deterministically', () => {
    const transform = normalizePlacementTransform({
      operations: ['rotate', 'mirror-horizontal'],
    });

    const first = transformTemplateWithGridView(RECT_TEMPLATE, transform);
    const second = transformTemplateWithGridView(RECT_TEMPLATE, transform);

    expect(second).toEqual(first);

    const sortedOccupied = [...first.occupiedCells].sort(
      (left, right) => left.y - right.y || left.x - right.x,
    );
    expect(first.occupiedCells).toEqual(sortedOccupied);

    const sortedChecks = [...first.checks].sort(
      (left, right) => left.y - right.y || left.x - right.x,
    );
    expect(first.checks).toEqual(sortedChecks);
  });

  test('projects transformed templates to wrapped world coordinates', () => {
    const transformed = transformTemplateWithGridView(
      RECT_TEMPLATE,
      normalizePlacementTransform(undefined),
    );
    const projection = projectTransformedTemplateToWorld(
      transformed,
      4,
      3,
      5,
      4,
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
    expect(projection.occupiedCells).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 3 },
      { x: 4, y: 3 },
    ]);
    expect(projection.checks).toEqual([
      { x: 1, y: 0 },
      { x: 4, y: 3 },
    ]);
  });

  test('derives integrity mask checks from explicit and fallback sources', () => {
    const transformedWithChecks = transformTemplateWithGridView(
      RECT_TEMPLATE,
      normalizePlacementTransform(undefined),
    );
    expect(
      deriveIntegrityMaskCells(RECT_TEMPLATE.checks, transformedWithChecks),
    ).toEqual([
      { x: 0, y: 0, expected: 1 },
      { x: 2, y: 1, expected: 1 },
    ]);

    const templateWithoutChecks = {
      ...RECT_TEMPLATE,
      checks: [] as const,
    };
    const transformedWithoutChecks = transformTemplateWithGridView(
      templateWithoutChecks,
      normalizePlacementTransform(undefined),
    );

    expect(
      deriveIntegrityMaskCells([], transformedWithoutChecks).map((cell) => ({
        ...cell,
        expected: Number(cell.expected),
      })),
    ).toEqual([
      { x: 0, y: 0, expected: 1 },
      { x: 2, y: 0, expected: 1 },
      { x: 1, y: 1, expected: 1 },
      { x: 2, y: 1, expected: 1 },
    ]);
  });
});
