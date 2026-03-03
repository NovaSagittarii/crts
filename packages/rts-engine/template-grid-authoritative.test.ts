import { describe, expect, test } from 'vitest';

import {
  applyAuthoritativeBuildProjection,
  evaluateAuthoritativeBuildPlacement,
  projectAuthoritativeBuildPlacement,
  type AuthoritativeBuildPlacementEvaluation,
  type AuthoritativeBuildTemplate,
  type EvaluateAuthoritativeBuildPlacementOptions,
} from './template-grid-authoritative.js';
import {
  collectIllegalBuildZoneCells,
  type BuildZoneContributor,
} from './build-zone.js';
import {
  applyTemplateWriteProjection,
  countTemplateWriteDiffCells,
  projectTemplateGridWritePlacement,
} from './template-grid-write.js';

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

function evaluateLegacyAffordability(
  needed: number,
  current: number,
): {
  affordable: boolean;
  needed: number;
  current: number;
  deficit: number;
} {
  const deficit = Math.max(0, needed - current);
  return {
    affordable: deficit === 0,
    needed,
    current,
    deficit,
  };
}

function evaluateLegacyPlacement(
  options: EvaluateAuthoritativeBuildPlacementOptions,
): AuthoritativeBuildPlacementEvaluation {
  const projection = projectTemplateGridWritePlacement(
    options.template,
    options.x,
    options.y,
    options.roomWidth,
    options.roomHeight,
    options.transformInput,
  );

  if (
    projection.transformedTemplate.width > options.roomWidth ||
    projection.transformedTemplate.height > options.roomHeight
  ) {
    return {
      projection: {
        ...projection,
        areaCells: [],
        footprint: [],
        checks: [],
        worldCells: [],
        illegalCells: [],
      },
      reason: 'template-exceeds-map-size',
    };
  }

  const illegalCells = collectIllegalBuildZoneCells(
    projection.areaCells,
    options.teamContributors,
  );

  const projectedPlacement = {
    projection: {
      ...projection,
      illegalCells,
    },
    reason:
      illegalCells.length > 0 ? ('outside-territory' as const) : undefined,
  };

  if (projectedPlacement.reason) {
    return {
      projection: projectedPlacement.projection,
      reason: projectedPlacement.reason,
    };
  }

  let diffCells: number;
  try {
    diffCells = countTemplateWriteDiffCells(
      options.roomGrid,
      options.roomWidth,
      options.roomHeight,
      projectedPlacement.projection,
    );
  } catch {
    return {
      projection: projectedPlacement.projection,
      reason: 'template-compare-failed',
    };
  }

  const needed = diffCells + options.template.activationCost;
  const affordability = evaluateLegacyAffordability(
    needed,
    options.teamResources,
  );

  if (!affordability.affordable) {
    return {
      projection: projectedPlacement.projection,
      diffCells,
      affordability,
      reason: 'insufficient-resources',
    };
  }

  return {
    projection: projectedPlacement.projection,
    diffCells,
    affordability,
  };
}

describe('template-grid-authoritative', () => {
  test('keeps legacy parity for representative transformed evaluation outcomes', () => {
    // Temporary migration guard: remove legacy parity harness in Phase 18.
    const roomGrid = new Uint8Array([
      0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0,
      1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0,
    ]);
    const coveredContributors: BuildZoneContributor[] = [
      { centerX: 4, centerY: 4 },
    ];

    const scenarios: Array<{
      name: string;
      options: EvaluateAuthoritativeBuildPlacementOptions;
      expectedReason?: AuthoritativeBuildPlacementEvaluation['reason'];
    }> = [
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
        expectedReason: 'insufficient-resources',
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
        expectedReason: 'outside-territory',
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
        expectedReason: 'template-exceeds-map-size',
      },
    ];

    for (const scenario of scenarios) {
      const authoritative = evaluateAuthoritativeBuildPlacement(
        scenario.options,
      );
      const legacy = evaluateLegacyPlacement(scenario.options);

      expect(authoritative).toEqual(legacy);
      if (scenario.expectedReason) {
        expect(authoritative.reason).toBe(scenario.expectedReason);
      } else {
        expect(authoritative.reason).toBeUndefined();
      }
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

  test('keeps transformed apply mutation parity with legacy world-cell writes', () => {
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
