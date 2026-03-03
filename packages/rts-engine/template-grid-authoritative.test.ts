import { describe, expect, test } from 'vitest';

import {
  applyAuthoritativeBuildProjection,
  evaluateAuthoritativeBuildPlacement,
  projectAuthoritativeBuildPlacement,
  type AuthoritativeBuildTemplate,
  type EvaluateAuthoritativeBuildPlacementOptions,
} from './template-grid-authoritative.js';
import { type BuildZoneContributor } from './build-zone.js';
import { applyTemplateWriteProjection } from './template-grid-write.js';

const RECT_TEMPLATE: AuthoritativeBuildTemplate = {
  width: 3,
  height: 2,
  cells: new Uint8Array([1, 0, 1, 0, 1, 1]),
  checks: [
    { x: 0, y: 0 },
    { x: 2, y: 1 },
  ],
  activationCost: 4,
};

const OVERSIZED_TEMPLATE: AuthoritativeBuildTemplate = {
  width: 9,
  height: 2,
  cells: new Uint8Array(18).fill(1),
  checks: [],
  activationCost: 1,
};

const EXPECTED_TRANSFORMED_AREA_CELLS = [
  { x: 3, y: 3 },
  { x: 4, y: 3 },
  { x: 3, y: 4 },
  { x: 4, y: 4 },
  { x: 3, y: 5 },
  { x: 4, y: 5 },
];

const EXPECTED_TRANSFORMED_FOOTPRINT = [
  { x: 3, y: 3 },
  { x: 4, y: 3 },
  { x: 3, y: 4 },
  { x: 4, y: 5 },
];

const EXPECTED_TRANSFORMED_WORLD_CELLS = [
  { localX: 1, localY: 2, x: 4, y: 5, alive: true },
  { localX: 1, localY: 1, x: 4, y: 4, alive: false },
  { localX: 1, localY: 0, x: 4, y: 3, alive: true },
  { localX: 0, localY: 2, x: 3, y: 5, alive: false },
  { localX: 0, localY: 1, x: 3, y: 4, alive: true },
  { localX: 0, localY: 0, x: 3, y: 3, alive: true },
];

describe('template-grid-authoritative', () => {
  test('returns canonical transformed outcomes for representative evaluation scenarios', () => {
    const roomGrid = new Uint8Array([
      0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0,
      1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0,
    ]);
    const coveredContributors: BuildZoneContributor[] = [
      { centerX: 4, centerY: 4 },
    ];

    interface Scenario {
      name: string;
      options: EvaluateAuthoritativeBuildPlacementOptions;
      expected: {
        reason?: ReturnType<
          typeof evaluateAuthoritativeBuildPlacement
        >['reason'];
        diffCells?: number;
        affordability?: {
          affordable: boolean;
          needed: number;
          current: number;
          deficit: number;
        };
        bounds: {
          x: number;
          y: number;
          width: number;
          height: number;
        };
        transformedSize: {
          width: number;
          height: number;
        };
        areaCells: Array<{ x: number; y: number }>;
        footprint: Array<{ x: number; y: number }>;
        checks: Array<{ x: number; y: number }>;
        worldCells: Array<{
          localX: number;
          localY: number;
          x: number;
          y: number;
          alive: boolean;
        }>;
        illegalCells: Array<{ x: number; y: number }>;
      };
    }

    const scenarios: Scenario[] = [
      {
        name: 'transformed-success',
        options: {
          template: RECT_TEMPLATE,
          x: 3,
          y: 3,
          roomWidth: 8,
          roomHeight: 8,
          roomGrid,
          teamResources: 30,
          transformInput: {
            operations: ['rotate', 'mirror-horizontal'],
          },
          teamContributors: coveredContributors,
        },
        expected: {
          reason: undefined,
          diffCells: 2,
          affordability: {
            affordable: true,
            needed: 6,
            current: 30,
            deficit: 0,
          },
          bounds: {
            x: 3,
            y: 3,
            width: 2,
            height: 3,
          },
          transformedSize: {
            width: 2,
            height: 3,
          },
          areaCells: EXPECTED_TRANSFORMED_AREA_CELLS,
          footprint: EXPECTED_TRANSFORMED_FOOTPRINT,
          checks: [
            { x: 3, y: 3 },
            { x: 4, y: 5 },
          ],
          worldCells: EXPECTED_TRANSFORMED_WORLD_CELLS,
          illegalCells: [],
        },
      },
      {
        name: 'transformed-insufficient',
        options: {
          template: RECT_TEMPLATE,
          x: 3,
          y: 3,
          roomWidth: 8,
          roomHeight: 8,
          roomGrid,
          teamResources: 0,
          transformInput: {
            operations: ['rotate', 'mirror-horizontal'],
          },
          teamContributors: coveredContributors,
        },
        expected: {
          reason: 'insufficient-resources',
          diffCells: 2,
          affordability: {
            affordable: false,
            needed: 6,
            current: 0,
            deficit: 6,
          },
          bounds: {
            x: 3,
            y: 3,
            width: 2,
            height: 3,
          },
          transformedSize: {
            width: 2,
            height: 3,
          },
          areaCells: EXPECTED_TRANSFORMED_AREA_CELLS,
          footprint: EXPECTED_TRANSFORMED_FOOTPRINT,
          checks: [
            { x: 3, y: 3 },
            { x: 4, y: 5 },
          ],
          worldCells: EXPECTED_TRANSFORMED_WORLD_CELLS,
          illegalCells: [],
        },
      },
      {
        name: 'outside-territory',
        options: {
          template: RECT_TEMPLATE,
          x: 3,
          y: 3,
          roomWidth: 8,
          roomHeight: 8,
          roomGrid,
          teamResources: 30,
          transformInput: {
            operations: ['rotate', 'mirror-horizontal'],
          },
          teamContributors: [],
        },
        expected: {
          reason: 'outside-territory',
          diffCells: undefined,
          affordability: undefined,
          bounds: {
            x: 3,
            y: 3,
            width: 2,
            height: 3,
          },
          transformedSize: {
            width: 2,
            height: 3,
          },
          areaCells: EXPECTED_TRANSFORMED_AREA_CELLS,
          footprint: EXPECTED_TRANSFORMED_FOOTPRINT,
          checks: [
            { x: 3, y: 3 },
            { x: 4, y: 5 },
          ],
          worldCells: EXPECTED_TRANSFORMED_WORLD_CELLS,
          illegalCells: EXPECTED_TRANSFORMED_AREA_CELLS,
        },
      },
      {
        name: 'template-exceeds-map-size',
        options: {
          template: OVERSIZED_TEMPLATE,
          x: 0,
          y: 0,
          roomWidth: 8,
          roomHeight: 8,
          roomGrid,
          teamResources: 30,
          transformInput: undefined,
          teamContributors: coveredContributors,
        },
        expected: {
          reason: 'template-exceeds-map-size',
          diffCells: undefined,
          affordability: undefined,
          bounds: {
            x: 0,
            y: 0,
            width: 9,
            height: 2,
          },
          transformedSize: {
            width: 9,
            height: 2,
          },
          areaCells: [],
          footprint: [],
          checks: [],
          worldCells: [],
          illegalCells: [],
        },
      },
    ];

    for (const scenario of scenarios) {
      const evaluation = evaluateAuthoritativeBuildPlacement(scenario.options);

      expect(evaluation.reason).toBe(scenario.expected.reason);
      expect(evaluation.diffCells).toBe(scenario.expected.diffCells);
      expect(evaluation.affordability).toEqual(scenario.expected.affordability);
      expect(evaluation.projection.transform.operations).toEqual(
        scenario.options.transformInput?.operations ?? [],
      );
      expect(evaluation.projection.bounds).toEqual(scenario.expected.bounds);
      expect(evaluation.projection.transformedTemplate.width).toBe(
        scenario.expected.transformedSize.width,
      );
      expect(evaluation.projection.transformedTemplate.height).toBe(
        scenario.expected.transformedSize.height,
      );
      expect(evaluation.projection.areaCells).toEqual(
        scenario.expected.areaCells,
      );
      expect(evaluation.projection.footprint).toEqual(
        scenario.expected.footprint,
      );
      expect(evaluation.projection.checks).toEqual(scenario.expected.checks);
      expect(evaluation.projection.worldCells).toEqual(
        scenario.expected.worldCells,
      );
      expect(evaluation.projection.illegalCells).toEqual(
        scenario.expected.illegalCells,
      );
    }
  });

  test('returns empty traversal outputs when transformed template exceeds room size', () => {
    const projection = projectAuthoritativeBuildPlacement({
      template: OVERSIZED_TEMPLATE,
      x: 0,
      y: 0,
      roomWidth: 8,
      roomHeight: 8,
      transformInput: undefined,
      teamContributors: [{ centerX: 4, centerY: 4 }],
    });

    expect(projection.reason).toBe('template-exceeds-map-size');
    expect(projection.projection.areaCells).toEqual([]);
    expect(projection.projection.footprint).toEqual([]);
    expect(projection.projection.checks).toEqual([]);
    expect(projection.projection.worldCells).toEqual([]);
    expect(projection.projection.illegalCells).toEqual([]);
  });

  test('keeps transformed apply mutation parity with canonical world-cell writes', () => {
    const projection = projectAuthoritativeBuildPlacement({
      template: RECT_TEMPLATE,
      x: 3,
      y: 3,
      roomWidth: 8,
      roomHeight: 8,
      transformInput: {
        operations: ['rotate', 'mirror-horizontal'],
      },
      teamContributors: [{ centerX: 4, centerY: 4 }],
    });
    expect(projection.reason).toBeUndefined();

    const baselineGrid = new Uint8Array([
      0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0,
      1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0,
    ]);
    const authoritativeGrid = Uint8Array.from(baselineGrid);
    const legacyGrid = Uint8Array.from(baselineGrid);

    const appliedByAuthoritative = applyAuthoritativeBuildProjection(
      authoritativeGrid,
      8,
      8,
      projection.projection,
    );
    const appliedByLegacy = applyTemplateWriteProjection(
      legacyGrid,
      8,
      8,
      projection.projection,
    );

    expect(appliedByAuthoritative).toBe(true);
    expect(appliedByLegacy).toBe(true);
    expect(authoritativeGrid).toEqual(legacyGrid);
  });
});
