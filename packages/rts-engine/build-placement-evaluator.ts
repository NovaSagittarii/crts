import { Grid } from '#conway-core';

import {
  type BuildZoneContributor,
  type BuildZoneContributorProjectionInput,
  collectBuildZoneContributors,
  collectIllegalBuildZoneCells,
} from './build-zone.js';
import type { Vector2 } from './geometry.js';
import {
  type PlacementBounds,
  type PlacementTransformInput,
  type PlacementTransformState,
  type TransformTemplateInput,
  type TransformedTemplate,
  normalizePlacementTransform,
  projectPlacementToWorld,
  projectTemplateWithTransform,
} from './placement-transform.js';
import type {
  AffordabilityResult,
  BuildPreviewProjection,
  BuildPreviewResult,
  BuildRejectionReason,
} from './rts.js';

export interface BuildPlacementProjectionResult {
  transform: PlacementTransformState;
  transformedTemplate: TransformedTemplate;
  templateGrid: Grid;
  bounds: PlacementBounds;
  areaCells: Vector2[];
  footprint: Vector2[];
  checks: Vector2[];
  illegalCells: Vector2[];
}

export interface BuildPlacementValidationResult {
  projection: BuildPlacementProjectionResult;
  reason?: BuildRejectionReason;
}

export interface EvaluatedBuildPlacement {
  projection: BuildPlacementProjectionResult;
  affordability?: AffordabilityResult;
  diffCells?: number;
  reason?: BuildRejectionReason;
}

export interface BuildPlacementSnapshotProjectionInput {
  width: number;
  height: number;
  teamBuildZoneProjectionInputs: readonly BuildZoneContributorProjectionInput[];
  template: TransformTemplateInput;
  x: number;
  y: number;
  transformInput: PlacementTransformInput | null | undefined;
}

export interface BuildPlacementSnapshotEvaluationInput extends BuildPlacementSnapshotProjectionInput {
  grid: Grid;
  teamResources: number;
  templateActivationCost: number;
}

export function evaluateAffordability(
  needed: number,
  current: number,
): AffordabilityResult {
  const deficit = Math.max(0, needed - current);
  return {
    affordable: deficit === 0,
    needed,
    current,
    deficit,
  };
}

export function transformedTemplateFitsDimensions(
  width: number,
  height: number,
  transformedTemplate: Pick<TransformedTemplate, 'width' | 'height'>,
): boolean {
  return (
    transformedTemplate.width <= width && transformedTemplate.height <= height
  );
}

export function wrapAnchorCoordinate(value: number, size: number): number {
  const remainder = value % size;
  return remainder >= 0 ? remainder : remainder + size;
}

export function canonicalizePlacementAnchorForDimensions(
  width: number,
  height: number,
  x: number,
  y: number,
): Vector2 {
  return {
    x: wrapAnchorCoordinate(x, width),
    y: wrapAnchorCoordinate(y, height),
  };
}

export function collectBuildZoneContributorsFromProjectionInputs(
  projectionInputs: readonly BuildZoneContributorProjectionInput[],
): BuildZoneContributor[] {
  return collectBuildZoneContributors(projectionInputs);
}

export function compareTemplateAgainstGrid(
  grid: Grid,
  templateGrid: Grid,
  bounds: PlacementBounds,
): number {
  return grid.compare(templateGrid, { x: bounds.x, y: bounds.y });
}

export function projectBuildPlacementFromSnapshot(
  input: BuildPlacementSnapshotProjectionInput,
): BuildPlacementValidationResult {
  const transform = normalizePlacementTransform(input.transformInput);
  const anchor = canonicalizePlacementAnchorForDimensions(
    input.width,
    input.height,
    input.x,
    input.y,
  );
  const transformedTemplate = projectTemplateWithTransform(
    input.template,
    transform,
  );
  const templateGrid = transformedTemplate.grid;
  const bounds: PlacementBounds = {
    x: anchor.x,
    y: anchor.y,
    width: transformedTemplate.width,
    height: transformedTemplate.height,
  };

  if (
    !transformedTemplateFitsDimensions(
      input.width,
      input.height,
      transformedTemplate,
    )
  ) {
    return {
      projection: {
        transform,
        transformedTemplate,
        templateGrid,
        bounds,
        areaCells: [],
        footprint: [],
        checks: [],
        illegalCells: [],
      },
      reason: 'template-exceeds-map-size',
    };
  }

  const projection = projectPlacementToWorld(
    transformedTemplate,
    anchor.x,
    anchor.y,
    input.width,
    input.height,
  );
  const illegalCells = collectIllegalBuildZoneCells(
    projection.areaCells,
    collectBuildZoneContributorsFromProjectionInputs(
      input.teamBuildZoneProjectionInputs,
    ),
  );

  return {
    projection: {
      transform,
      transformedTemplate,
      templateGrid,
      bounds,
      areaCells: projection.areaCells,
      footprint: projection.occupiedCells,
      checks: projection.checks,
      illegalCells,
    },
    reason: illegalCells.length > 0 ? 'outside-territory' : undefined,
  };
}

export function createEmptyBuildProjection(
  x: number,
  y: number,
  transformInput: PlacementTransformInput | null | undefined,
): BuildPreviewProjection {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  return {
    transform: normalizePlacementTransform(transformInput),
    footprint: [],
    illegalCells: [],
    bounds: {
      x: safeX,
      y: safeY,
      width: 0,
      height: 0,
    },
  };
}

export function evaluateBuildPlacementFromSnapshot(
  input: BuildPlacementSnapshotEvaluationInput,
): EvaluatedBuildPlacement {
  const projectedPlacement = projectBuildPlacementFromSnapshot({
    width: input.width,
    height: input.height,
    teamBuildZoneProjectionInputs: input.teamBuildZoneProjectionInputs,
    template: input.template,
    x: input.x,
    y: input.y,
    transformInput: input.transformInput,
  });

  if (projectedPlacement.reason) {
    return {
      projection: projectedPlacement.projection,
      reason: projectedPlacement.reason,
    };
  }

  let diffCells: number;
  try {
    diffCells = compareTemplateAgainstGrid(
      input.grid,
      projectedPlacement.projection.templateGrid,
      projectedPlacement.projection.bounds,
    );
  } catch {
    return {
      projection: projectedPlacement.projection,
      reason: 'template-compare-failed',
    };
  }

  const needed = diffCells + input.templateActivationCost;
  const affordability = evaluateAffordability(needed, input.teamResources);

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

export function getBuildPreviewErrorMessage(
  reason: BuildRejectionReason | undefined,
): string | undefined {
  if (reason === 'outside-territory') {
    return 'Outside build zone - build closer to your structures.';
  }
  if (reason === 'template-exceeds-map-size') {
    return 'Template exceeds map size';
  }
  if (reason === 'insufficient-resources') {
    return 'Insufficient resources';
  }
  if (reason === 'template-compare-failed') {
    return 'Unable to compare template with current state';
  }

  return undefined;
}

export function createRejectedBuildPreviewResult(options: {
  reason: BuildRejectionReason;
  error: string;
  currentResources: number;
  x: number;
  y: number;
  transformInput: PlacementTransformInput | null | undefined;
}): BuildPreviewResult {
  return {
    accepted: false,
    error: options.error,
    reason: options.reason,
    ...createEmptyBuildProjection(options.x, options.y, options.transformInput),
    affordable: false,
    needed: 0,
    current: options.currentResources,
    deficit: 0,
  };
}

export function createBuildPreviewResult(
  evaluation: EvaluatedBuildPlacement,
  currentResources: number,
): BuildPreviewResult {
  return {
    accepted: evaluation.reason === undefined,
    reason: evaluation.reason,
    error: getBuildPreviewErrorMessage(evaluation.reason),
    transform: evaluation.projection.transform,
    footprint: evaluation.projection.footprint,
    illegalCells: evaluation.projection.illegalCells,
    bounds: evaluation.projection.bounds,
    affordable: evaluation.affordability?.affordable ?? false,
    needed: evaluation.affordability?.needed ?? 0,
    current: evaluation.affordability?.current ?? currentResources,
    deficit: evaluation.affordability?.deficit ?? 0,
  };
}
