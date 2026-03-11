import { describe, expect, test } from 'vitest';

import {
  SPAWN_MIN_WRAPPED_DISTANCE,
  calculateSpawnMinWrappedDistance,
} from './gameplay-rules.js';
import { BASE_FOOTPRINT_HEIGHT, BASE_FOOTPRINT_WIDTH } from './geometry.js';
import { CORE_TEMPLATE_PADDING } from './structure.js';

describe('gameplay rules', () => {
  test('derives spawn separation from canonical base geometry', () => {
    expect(
      calculateSpawnMinWrappedDistance(
        BASE_FOOTPRINT_WIDTH,
        BASE_FOOTPRINT_HEIGHT,
        CORE_TEMPLATE_PADDING,
      ),
    ).toBe(SPAWN_MIN_WRAPPED_DISTANCE);
    expect(SPAWN_MIN_WRAPPED_DISTANCE).toBe(25);
  });

  test('scales spawn separation when footprint geometry changes', () => {
    expect(calculateSpawnMinWrappedDistance(14, 10, 4)).toBe(28);
  });
});
