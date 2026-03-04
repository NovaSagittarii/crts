import { describe, expect, test } from 'vitest';

import { computeVisibleGridBounds } from '../../apps/web/src/render-viewport.js';

describe('computeVisibleGridBounds', () => {
  test('returns full-grid bounds when camera shows the entire map', () => {
    const bounds = computeVisibleGridBounds({
      camera: { zoom: 1, offsetX: 0, offsetY: 0 },
      canvasWidth: 100,
      canvasHeight: 100,
      cellSize: 10,
      gridWidth: 10,
      gridHeight: 10,
    });

    expect(bounds).toEqual({
      minX: 0,
      maxX: 9,
      minY: 0,
      maxY: 9,
    });
  });

  test('derives viewport-limited bounds from pan and zoom', () => {
    const bounds = computeVisibleGridBounds({
      camera: { zoom: 2, offsetX: -50, offsetY: -40 },
      canvasWidth: 100,
      canvasHeight: 100,
      cellSize: 10,
      gridWidth: 20,
      gridHeight: 20,
    });

    expect(bounds).toEqual({
      minX: 2,
      maxX: 7,
      minY: 2,
      maxY: 6,
    });
  });

  test('clamps partially visible viewport to map bounds', () => {
    const bounds = computeVisibleGridBounds({
      camera: { zoom: 1, offsetX: -20, offsetY: -20 },
      canvasWidth: 60,
      canvasHeight: 60,
      cellSize: 10,
      gridWidth: 5,
      gridHeight: 5,
    });

    expect(bounds).toEqual({
      minX: 2,
      maxX: 4,
      minY: 2,
      maxY: 4,
    });
  });

  test('returns null when viewport does not intersect map', () => {
    const bounds = computeVisibleGridBounds({
      camera: { zoom: 1, offsetX: 1000, offsetY: 1000 },
      canvasWidth: 100,
      canvasHeight: 100,
      cellSize: 10,
      gridWidth: 10,
      gridHeight: 10,
    });

    expect(bounds).toBeNull();
  });
});
