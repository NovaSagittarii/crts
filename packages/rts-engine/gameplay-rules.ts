// import { BASE_FOOTPRINT_WIDTH } from './geometry.js';

export const DEFAULT_STARTING_RESOURCES = 40;
export const DEFAULT_TEAM_TERRITORY_RADIUS = 12;
export const DEFAULT_SPAWN_CAPACITY = 2;
export const MAX_DELAY_TICKS = 20;
export const BUILD_ZONE_RADIUS = 14.9;
export type BuildZoneDistanceShape = 'euclidean' | 'chebyshev';
export const BUILD_ZONE_DISTANCE_SHAPE: BuildZoneDistanceShape = 'euclidean';

export const INTEGRITY_CHECK_INTERVAL_TICKS = 4;
export const INTEGRITY_HP_COST_PER_CELL = 1;

// export const SPAWN_MIN_WRAPPED_DISTANCE = BASE_FOOTPRINT_WIDTH * 3;
export const SPAWN_MIN_WRAPPED_DISTANCE = 25;
