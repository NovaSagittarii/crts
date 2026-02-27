import { describe, expect, test } from 'vitest';

import {
  createTorusSpawnLayout,
  nextSpawnOrientationSeed,
} from '../src/spawn.js';

function wrappedDelta(a: number, b: number, size: number): number {
  const delta = Math.abs(a - b);
  return Math.min(delta, size - delta);
}

describe('spawn', () => {
  test('creates deterministic equal-angle torus spawns', () => {
    const options = {
      width: 80,
      height: 80,
      teamCount: 4,
      orientationSeed: 1337,
      baseWidth: 2,
      baseHeight: 2,
      minWrappedDistance: 8,
    };

    const first = createTorusSpawnLayout(options);
    const second = createTorusSpawnLayout(options);
    expect(first).toEqual(second);

    const sortedAngles = first
      .map(({ angle }) => angle)
      .sort((left, right) => left - right);
    const expectedStep = (2 * Math.PI) / options.teamCount;

    for (let index = 0; index < sortedAngles.length; index += 1) {
      const current = sortedAngles[index];
      const next =
        index === sortedAngles.length - 1
          ? sortedAngles[0] + 2 * Math.PI
          : sortedAngles[index + 1];
      expect(Math.abs(next - current - expectedStep)).toBeLessThan(1e-9);
    }
  });

  test('keeps team bases separated using wrapped torus distance checks', () => {
    const spawns = createTorusSpawnLayout({
      width: 48,
      height: 48,
      teamCount: 4,
      orientationSeed: 2026,
      baseWidth: 2,
      baseHeight: 2,
      minWrappedDistance: 7,
    });

    for (let index = 0; index < spawns.length; index += 1) {
      for (let other = index + 1; other < spawns.length; other += 1) {
        const current = spawns[index];
        const candidate = spawns[other];
        const dx = wrappedDelta(
          current.topLeft.x + 1,
          candidate.topLeft.x + 1,
          48,
        );
        const dy = wrappedDelta(
          current.topLeft.y + 1,
          candidate.topLeft.y + 1,
          48,
        );
        const distance = Math.sqrt(dx * dx + dy * dy);
        expect(distance).toBeGreaterThanOrEqual(7);
      }
    }
  });

  test('re-randomizes orientation seed for rematch spawn recalculation', () => {
    const initialSeed = 99;
    const rematchSeed = nextSpawnOrientationSeed(initialSeed);

    expect(rematchSeed).not.toBe(initialSeed);

    const firstLayout = createTorusSpawnLayout({
      width: 64,
      height: 64,
      teamCount: 4,
      orientationSeed: initialSeed,
      baseWidth: 2,
      baseHeight: 2,
      minWrappedDistance: 8,
    }).map(({ topLeft }) => `${topLeft.x},${topLeft.y}`);

    const rematchLayout = createTorusSpawnLayout({
      width: 64,
      height: 64,
      teamCount: 4,
      orientationSeed: rematchSeed,
      baseWidth: 2,
      baseHeight: 2,
      minWrappedDistance: 8,
    }).map(({ topLeft }) => `${topLeft.x},${topLeft.y}`);

    expect(rematchLayout).not.toEqual(firstLayout);
  });
});
