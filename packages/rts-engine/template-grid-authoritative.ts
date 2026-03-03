import {
  collectIllegalBuildZoneCells,
  type BuildZoneContributor,
} from './build-zone.js';
import type { Vector2 } from './geometry.js';
import type {
  PlacementTransformInput,
  TransformedTemplate,
} from './placement-transform.js';
import {
  applyTemplateWriteProjection,
  countTemplateWriteDiffCells,
  projectTemplateGridWritePlacement,
  type TemplateGridWriteProjection,
  type TemplateGridWriteTemplate,
} from './template-grid-write.js';

export interface AuthoritativeBuildTemplate extends TemplateGridWriteTemplate {
  activationCost: number;
}

export interface AuthoritativeAffordabilityResult {
  affordable: boolean;
  needed: number;
  current: number;
  deficit: number;
}

export type AuthoritativeBuildRejectionReason =
  | 'outside-territory'
  | 'template-exceeds-map-size'
  | 'template-compare-failed'
  | 'insufficient-resources';

export interface AuthoritativeBuildProjection extends TemplateGridWriteProjection {
  illegalCells: Vector2[];
}

export interface AuthoritativeBuildPlacementProjectionResult {
  projection: AuthoritativeBuildProjection;
  reason?: 'outside-territory' | 'template-exceeds-map-size';
}

export interface AuthoritativeBuildPlacementEvaluation {
  projection: AuthoritativeBuildProjection;
  affordability?: AuthoritativeAffordabilityResult;
  diffCells?: number;
  reason?: AuthoritativeBuildRejectionReason;
}

export interface ProjectAuthoritativeBuildPlacementOptions {
  template: AuthoritativeBuildTemplate;
  x: number;
  y: number;
  roomWidth: number;
  roomHeight: number;
  transformInput: PlacementTransformInput | null | undefined;
  teamContributors: readonly BuildZoneContributor[];
}

export interface EvaluateAuthoritativeBuildPlacementOptions extends ProjectAuthoritativeBuildPlacementOptions {
  roomGrid: Uint8Array;
  teamResources: number;
}

function transformedTemplateFitsRoom(
  roomWidth: number,
  roomHeight: number,
  transformedTemplate: Pick<TransformedTemplate, 'width' | 'height'>,
): boolean {
  return (
    transformedTemplate.width <= roomWidth &&
    transformedTemplate.height <= roomHeight
  );
}

export function evaluateAuthoritativeAffordability(
  needed: number,
  current: number,
): AuthoritativeAffordabilityResult {
  const deficit = Math.max(0, needed - current);
  return {
    affordable: deficit === 0,
    needed,
    current,
    deficit,
  };
}

export function projectAuthoritativeBuildPlacement({
  template,
  x,
  y,
  roomWidth,
  roomHeight,
  transformInput,
  teamContributors,
}: ProjectAuthoritativeBuildPlacementOptions): AuthoritativeBuildPlacementProjectionResult {
  const projection = projectTemplateGridWritePlacement(
    template,
    x,
    y,
    roomWidth,
    roomHeight,
    transformInput,
  );

  if (
    !transformedTemplateFitsRoom(
      roomWidth,
      roomHeight,
      projection.transformedTemplate,
    )
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
    teamContributors,
  );

  return {
    projection: {
      ...projection,
      illegalCells,
    },
    reason: illegalCells.length > 0 ? 'outside-territory' : undefined,
  };
}

export function evaluateAuthoritativeBuildPlacement({
  template,
  x,
  y,
  roomWidth,
  roomHeight,
  roomGrid,
  teamResources,
  transformInput,
  teamContributors,
}: EvaluateAuthoritativeBuildPlacementOptions): AuthoritativeBuildPlacementEvaluation {
  const projectedPlacement = projectAuthoritativeBuildPlacement({
    template,
    x,
    y,
    roomWidth,
    roomHeight,
    transformInput,
    teamContributors,
  });

  if (projectedPlacement.reason) {
    return {
      projection: projectedPlacement.projection,
      reason: projectedPlacement.reason,
    };
  }

  let diffCells: number;
  try {
    diffCells = countTemplateWriteDiffCells(
      roomGrid,
      roomWidth,
      roomHeight,
      projectedPlacement.projection,
    );
  } catch {
    return {
      projection: projectedPlacement.projection,
      reason: 'template-compare-failed',
    };
  }

  const needed = diffCells + template.activationCost;
  const affordability = evaluateAuthoritativeAffordability(
    needed,
    teamResources,
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

export function applyAuthoritativeBuildProjection(
  roomGrid: Uint8Array,
  roomWidth: number,
  roomHeight: number,
  projection: Pick<AuthoritativeBuildProjection, 'worldCells'>,
): boolean {
  return applyTemplateWriteProjection(
    roomGrid,
    roomWidth,
    roomHeight,
    projection,
  );
}
