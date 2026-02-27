import type { Vector2 } from './geometry.js';

export interface TorusSpawnPoint {
  teamIndex: number;
  topLeft: Vector2;
  angle: number;
}

export interface CreateTorusSpawnLayoutOptions {
  width: number;
  height: number;
  teamCount: number;
  orientationSeed: number;
  radius?: number;
  baseWidth?: number;
  baseHeight?: number;
  minWrappedDistance?: number;
}

const UINT32_MAX = 0x1_0000_0000;

function wrap(value: number, modulo: number): number {
  return ((value % modulo) + modulo) % modulo;
}

function wrapTopLeft(
  value: number,
  axisLength: number,
  objectLength: number,
): number {
  const span = axisLength - objectLength + 1;
  if (span <= 0) {
    throw new Error('Spawn object does not fit in map axis');
  }
  return wrap(value, span);
}

function toUint32(seed: number): number {
  if (!Number.isFinite(seed)) {
    return 0;
  }
  return Math.trunc(seed) >>> 0;
}

function seededUnit(seed: number): number {
  const next = (Math.imul(toUint32(seed), 1664525) + 1013904223) >>> 0;
  return next / UINT32_MAX;
}

export function wrappedDelta(a: number, b: number, size: number): number {
  const delta = Math.abs(a - b);
  return Math.min(delta, size - delta);
}

export function nextSpawnOrientationSeed(currentSeed: number): number {
  return (Math.imul(toUint32(currentSeed), 1664525) + 1013904223) >>> 0;
}

export function createTorusSpawnLayout(
  options: CreateTorusSpawnLayoutOptions,
): TorusSpawnPoint[] {
  if (!Number.isInteger(options.teamCount) || options.teamCount < 1) {
    throw new Error('teamCount must be a positive integer');
  }
  if (!Number.isInteger(options.width) || options.width < 2) {
    throw new Error('width must be an integer >= 2');
  }
  if (!Number.isInteger(options.height) || options.height < 2) {
    throw new Error('height must be an integer >= 2');
  }

  const baseWidth = options.baseWidth ?? 2;
  const baseHeight = options.baseHeight ?? 2;

  if (baseWidth < 1 || baseHeight < 1) {
    throw new Error('base dimensions must be positive');
  }
  if (baseWidth > options.width || baseHeight > options.height) {
    throw new Error('base dimensions must fit inside map bounds');
  }

  const centerX = (options.width - baseWidth) / 2;
  const centerY = (options.height - baseHeight) / 2;
  // Keep default radius inside quarter-span so opposite points stay well
  // separated under torus wrapped-distance checks.
  const maxRadiusX = Math.max(1, Math.floor((options.width - baseWidth) / 4));
  const maxRadiusY = Math.max(1, Math.floor((options.height - baseHeight) / 4));
  const radius =
    options.radius ?? Math.max(1, Math.min(maxRadiusX, maxRadiusY));

  const orientation = seededUnit(options.orientationSeed) * 2 * Math.PI;
  const step = (2 * Math.PI) / options.teamCount;

  const points: TorusSpawnPoint[] = [];
  for (let teamIndex = 0; teamIndex < options.teamCount; teamIndex += 1) {
    const angle = orientation + step * teamIndex;
    const x = wrapTopLeft(
      Math.round(centerX + radius * Math.cos(angle)),
      options.width,
      baseWidth,
    );
    const y = wrapTopLeft(
      Math.round(centerY + radius * Math.sin(angle)),
      options.height,
      baseHeight,
    );
    points.push({
      teamIndex,
      topLeft: { x, y },
      angle,
    });
  }

  const minWrappedDistance =
    options.minWrappedDistance ?? Math.max(baseWidth, baseHeight) + 1;
  for (let index = 0; index < points.length; index += 1) {
    for (let other = index + 1; other < points.length; other += 1) {
      const current = points[index];
      const candidate = points[other];
      const dx = wrappedDelta(
        current.topLeft.x + baseWidth / 2,
        candidate.topLeft.x + baseWidth / 2,
        options.width,
      );
      const dy = wrappedDelta(
        current.topLeft.y + baseHeight / 2,
        candidate.topLeft.y + baseHeight / 2,
        options.height,
      );
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance < minWrappedDistance) {
        throw new Error(
          `Spawn overlap detected between team ${index} and team ${other}`,
        );
      }
    }
  }

  return points;
}
