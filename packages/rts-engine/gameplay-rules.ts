import { BASE_FOOTPRINT_HEIGHT, BASE_FOOTPRINT_WIDTH } from './geometry.js';
import { CORE_TEMPLATE_PADDING } from './structure.js';

export const DEFAULT_STARTING_RESOURCES = 40;
export const DEFAULT_TEAM_TERRITORY_RADIUS = 12;
export const DEFAULT_SPAWN_CAPACITY = 2;
export const DEFAULT_QUEUE_DELAY_TICKS = 10;
export const MAX_DELAY_TICKS = 20;
export type BuildZoneDistanceShape = 'euclidean' | 'chebyshev';
export const BUILD_ZONE_DISTANCE_SHAPE: BuildZoneDistanceShape = 'euclidean';

export const INTEGRITY_CHECK_INTERVAL_TICKS = 4;
export const INTEGRITY_HP_COST_PER_CELL = 1;

export function calculateSpawnMinWrappedDistance(
  baseWidth: number,
  baseHeight: number,
  basePadding: number,
): number {
  return baseWidth + baseHeight + basePadding;
}

export const SPAWN_MIN_WRAPPED_DISTANCE = calculateSpawnMinWrappedDistance(
  BASE_FOOTPRINT_WIDTH,
  BASE_FOOTPRINT_HEIGHT,
  CORE_TEMPLATE_PADDING,
);
