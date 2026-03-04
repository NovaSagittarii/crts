import { describe, expect, test } from 'vitest';

import { getWrappedBoundsSegments } from '../../apps/web/src/wrapped-grid-view-model.js';

describe('getWrappedBoundsSegments', () => {
  test('returns single segment when bounds do not wrap', () => {
    const segments = getWrappedBoundsSegments(
      { x: 3, y: 4, width: 2, height: 3 },
      10,
      10,
    );

    expect(segments).toEqual([{ x: 3, y: 4, width: 2, height: 3 }]);
  });

  test('splits horizontal wrap into two segments', () => {
    const segments = getWrappedBoundsSegments(
      { x: -1, y: 2, width: 3, height: 2 },
      10,
      10,
    );

    expect(segments).toEqual([
      { x: 9, y: 2, width: 1, height: 2 },
      { x: 0, y: 2, width: 2, height: 2 },
    ]);
  });

  test('splits vertical wrap into two segments', () => {
    const segments = getWrappedBoundsSegments(
      { x: 1, y: 9, width: 2, height: 3 },
      10,
      10,
    );

    expect(segments).toEqual([
      { x: 1, y: 9, width: 2, height: 1 },
      { x: 1, y: 0, width: 2, height: 2 },
    ]);
  });

  test('splits both axes when wrapping horizontally and vertically', () => {
    const segments = getWrappedBoundsSegments(
      { x: 9, y: 9, width: 3, height: 3 },
      10,
      10,
    );

    expect(segments).toEqual([
      { x: 9, y: 9, width: 1, height: 1 },
      { x: 9, y: 0, width: 1, height: 2 },
      { x: 0, y: 9, width: 2, height: 1 },
      { x: 0, y: 0, width: 2, height: 2 },
    ]);
  });

  test('returns empty list when grid dimensions are invalid', () => {
    expect(
      getWrappedBoundsSegments({ x: 0, y: 0, width: 2, height: 2 }, 0, 10),
    ).toEqual([]);
    expect(
      getWrappedBoundsSegments({ x: 0, y: 0, width: 2, height: 2 }, 10, 0),
    ).toEqual([]);
  });
});
