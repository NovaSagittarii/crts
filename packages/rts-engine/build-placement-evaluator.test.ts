import { describe, expect, test } from 'vitest';

import { Grid } from '#conway-core';

import {
  createBuildPreviewResult,
  evaluateBuildPlacementFromSnapshot,
  projectBuildPlacementFromSnapshot,
} from './build-placement-evaluator.js';
import type { Vector2 } from './geometry.js';

function createTemplateInput(
  width: number,
  height: number,
  occupiedCells: readonly Vector2[],
): {
  width: number;
  height: number;
  grid: Grid;
  checks: Vector2[];
} {
  return {
    width,
    height,
    grid: new Grid(width, height, occupiedCells, 'flat'),
    checks: [],
  };
}

function toCellSet(cells: readonly Vector2[]): Set<string> {
  return new Set(cells.map((cell) => `${cell.x},${cell.y}`));
}

const OPEN_BUILD_ZONE = [
  {
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    buildRadius: 24,
  },
];

describe('build placement evaluator', () => {
  test('wraps projected footprints and rejects oversized transformed templates', () => {
    const block = createTemplateInput(2, 2, [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 0, y: 1 },
      { x: 1, y: 1 },
    ]);

    const wrapped = projectBuildPlacementFromSnapshot({
      width: 12,
      height: 12,
      teamBuildZoneProjectionInputs: OPEN_BUILD_ZONE,
      template: block,
      x: 11,
      y: 11,
      transformInput: undefined,
    });

    expect(wrapped.reason).toBeUndefined();
    expect(wrapped.projection.bounds).toEqual({
      x: 11,
      y: 11,
      width: 2,
      height: 2,
    });
    expect(toCellSet(wrapped.projection.footprint)).toEqual(
      new Set(['11,11', '0,11', '11,0', '0,0']),
    );

    const wide = createTemplateInput(
      13,
      1,
      Array.from({ length: 13 }, (_, x) => ({ x, y: 0 })),
    );
    const oversized = projectBuildPlacementFromSnapshot({
      width: 12,
      height: 12,
      teamBuildZoneProjectionInputs: OPEN_BUILD_ZONE,
      template: wide,
      x: 0,
      y: 0,
      transformInput: { operations: ['rotate'] },
    });

    expect(oversized.reason).toBe('template-exceeds-map-size');
    expect(oversized.projection.bounds).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 13,
    });
    expect(oversized.projection.footprint).toEqual([]);
    expect(oversized.projection.illegalCells).toEqual([]);
  });

  test('reports affordability metadata for legal snapshot placements', () => {
    const evaluation = evaluateBuildPlacementFromSnapshot({
      width: 12,
      height: 12,
      grid: new Grid(12, 12, [], 'torus'),
      teamResources: 2,
      teamBuildZoneProjectionInputs: OPEN_BUILD_ZONE,
      template: createTemplateInput(2, 2, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]),
      templateActivationCost: 3,
      x: 1,
      y: 1,
      transformInput: undefined,
    });

    expect(evaluation.reason).toBe('insufficient-resources');
    expect(evaluation.diffCells).toBe(4);
    expect(evaluation.affordability).toEqual({
      affordable: false,
      needed: 7,
      current: 2,
      deficit: 5,
    });
  });

  test('shapes preview results from evaluator output', () => {
    const evaluation = evaluateBuildPlacementFromSnapshot({
      width: 12,
      height: 12,
      grid: new Grid(12, 12, [], 'torus'),
      teamResources: 2,
      teamBuildZoneProjectionInputs: OPEN_BUILD_ZONE,
      template: createTemplateInput(2, 2, [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ]),
      templateActivationCost: 3,
      x: 1,
      y: 1,
      transformInput: undefined,
    });

    expect(createBuildPreviewResult(evaluation, 2)).toMatchObject({
      accepted: false,
      reason: 'insufficient-resources',
      error: 'Insufficient resources',
      affordable: false,
      needed: 7,
      current: 2,
      deficit: 5,
      bounds: { x: 1, y: 1, width: 2, height: 2 },
    });
  });
});
