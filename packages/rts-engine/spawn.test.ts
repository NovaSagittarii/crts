import { describe, expect, test } from 'vitest';

import { createTorusSpawnLayout, nextSpawnOrientationSeed } from './spawn.js';

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

  test('supports edge geometry on compact torus maps', () => {
    const compact = createTorusSpawnLayout({
      width: 6,
      height: 6,
      teamCount: 2,
      orientationSeed: 7,
      baseWidth: 2,
      baseHeight: 2,
      radius: 1,
      minWrappedDistance: 2,
    });

    expect(compact).toHaveLength(2);
    expect(compact[0].topLeft).not.toEqual(compact[1].topLeft);
    for (const { topLeft } of compact) {
      expect(topLeft.x).toBeGreaterThanOrEqual(0);
      expect(topLeft.y).toBeGreaterThanOrEqual(0);
      expect(topLeft.x).toBeLessThan(6);
      expect(topLeft.y).toBeLessThan(6);
    }
  });

  test('keeps large-map torus spawn coordinates bounded and unique', () => {
    const large = createTorusSpawnLayout({
      width: 300,
      height: 260,
      teamCount: 8,
      orientationSeed: 2027,
      baseWidth: 2,
      baseHeight: 2,
      radius: 40,
      minWrappedDistance: 12,
    });

    expect(large).toHaveLength(8);
    const uniqueTopLefts = new Set(
      large.map(({ topLeft }) => `${topLeft.x},${topLeft.y}`),
    );
    expect(uniqueTopLefts.size).toBe(8);

    for (const { topLeft } of large) {
      expect(topLeft.x).toBeGreaterThanOrEqual(0);
      expect(topLeft.y).toBeGreaterThanOrEqual(0);
      expect(topLeft.x).toBeLessThan(300);
      expect(topLeft.y).toBeLessThan(260);
    }
  });

  test('keeps rematch orientation seeds inside uint32 bounds', () => {
    const seen = new Set<number>();
    let seed = 123456;

    for (let index = 0; index < 64; index += 1) {
      seed = nextSpawnOrientationSeed(seed);
      seen.add(seed);
      expect(Number.isInteger(seed)).toBe(true);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThanOrEqual(0xffff_ffff);
    }

    expect(seen.size).toBeGreaterThan(60);
  });
});
