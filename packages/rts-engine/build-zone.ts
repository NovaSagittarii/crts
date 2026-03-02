import { type Vector2 } from './geometry.js';
import {
  BUILD_ZONE_DISTANCE_SHAPE,
  BUILD_ZONE_RADIUS,
} from './gameplay-rules.js';

export interface BuildZoneContributor {
  centerX: number;
  centerY: number;
}

export interface BuildZoneContributorProjectionInput {
  x: number;
  y: number;
  width: number;
  height: number;
  hp?: number;
}

export function projectBuildZoneContributor(
  input: BuildZoneContributorProjectionInput,
): BuildZoneContributor {
  return {
    centerX: input.x + Math.floor(input.width / 2),
    centerY: input.y + Math.floor(input.height / 2),
  };
}

export function collectBuildZoneContributors(
  inputs: readonly BuildZoneContributorProjectionInput[],
): BuildZoneContributor[] {
  const contributors: BuildZoneContributor[] = [];

  for (const input of inputs) {
    if (typeof input.hp === 'number' && input.hp <= 0) {
      continue;
    }
    if (input.width <= 0 || input.height <= 0) {
      continue;
    }

    contributors.push(projectBuildZoneContributor(input));
  }

  return contributors;
}

export function isBuildZoneCoveredByContributor(
  contributor: BuildZoneContributor,
  x: number,
  y: number,
): boolean {
  const dx = x - contributor.centerX;
  const dy = y - contributor.centerY;

  if (BUILD_ZONE_DISTANCE_SHAPE === 'euclidean') {
    return dx * dx + dy * dy <= BUILD_ZONE_RADIUS * BUILD_ZONE_RADIUS;
  }

  return Math.max(Math.abs(dx), Math.abs(dy)) <= BUILD_ZONE_RADIUS;
}

export function collectIllegalBuildZoneCells(
  areaCells: readonly Vector2[],
  contributors: readonly BuildZoneContributor[],
): Vector2[] {
  if (contributors.length === 0) {
    return [...areaCells];
  }

  const illegalCells: Vector2[] = [];
  for (const cell of areaCells) {
    let covered = false;
    for (const contributor of contributors) {
      if (isBuildZoneCoveredByContributor(contributor, cell.x, cell.y)) {
        covered = true;
        break;
      }
    }

    if (!covered) {
      illegalCells.push(cell);
    }
  }

  return illegalCells;
}

export function collectCoveredBuildZoneCells(
  areaCells: readonly Vector2[],
  contributors: readonly BuildZoneContributor[],
): Vector2[] {
  if (contributors.length === 0) {
    return [];
  }

  const coveredCells: Vector2[] = [];
  for (const cell of areaCells) {
    for (const contributor of contributors) {
      if (isBuildZoneCoveredByContributor(contributor, cell.x, cell.y)) {
        coveredCells.push(cell);
        break;
      }
    }
  }

  return coveredCells;
}
