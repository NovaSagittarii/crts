import { describe, expect, test } from 'vitest';

import { getBaseCenter } from '#rts-engine';

import {
  applyKeyboardPan,
  applyPanDelta,
  applyWheelZoomAtPoint,
  CAMERA_DEFAULT_ZOOM,
  CAMERA_MAX_ZOOM,
  CAMERA_MIN_ZOOM,
  createCameraViewState,
  resetCameraToBase,
  screenPointToCell,
  screenPointToWorld,
  worldPointToScreen,
} from '../../apps/web/src/camera-view-model.js';

describe('camera-view-model helpers', () => {
  test('clamps wheel zoom updates to supported min and max values', () => {
    const anchor = { x: 180, y: 120 };
    const zoomedIn = applyWheelZoomAtPoint(createCameraViewState(), anchor, 99);
    const zoomedOut = applyWheelZoomAtPoint(zoomedIn, anchor, 0.0001);

    expect(zoomedIn.zoom).toBe(CAMERA_MAX_ZOOM);
    expect(zoomedOut.zoom).toBe(CAMERA_MIN_ZOOM);
  });

  test('keeps cursor anchor world point stable after zoom updates', () => {
    const state = {
      zoom: 1,
      offsetX: 48,
      offsetY: -30,
    };
    const anchor = { x: 260, y: 140 };

    const before = screenPointToWorld(state, anchor);
    const next = applyWheelZoomAtPoint(state, anchor, 1.18);
    const after = screenPointToWorld(next, anchor);

    expect(after.x).toBeCloseTo(before.x, 8);
    expect(after.y).toBeCloseTo(before.y, 8);
  });

  test('applies pan reducers and preserves inverse point-to-cell conversion', () => {
    const panned = applyPanDelta(createCameraViewState(), 16, -10);
    const keyboardPanned = applyKeyboardPan(panned, 'right', 24);

    expect(keyboardPanned.offsetX).toBe(-8);
    expect(keyboardPanned.offsetY).toBe(-10);

    const camera = {
      zoom: 1.35,
      offsetX: -42,
      offsetY: 28,
    };
    const worldPoint = {
      x: 73,
      y: 46,
    };
    const screenPoint = worldPointToScreen(camera, worldPoint);

    expect(
      screenPointToCell(camera, screenPoint, {
        cellSize: 10,
        grid: {
          width: 100,
          height: 100,
        },
      }),
    ).toEqual({ x: 7, y: 4 });
  });

  test('resets to local base center and falls back to map center for spectators', () => {
    const baseTopLeft = { x: 10, y: 14 };
    const viewport = { x: 800, y: 500 };
    const grid = { width: 90, height: 70 };
    const cellSize = 8;

    const teamCamera = resetCameraToBase({
      viewport,
      grid,
      cellSize,
      baseTopLeft,
    });
    const baseCenter = getBaseCenter(baseTopLeft);
    const centeredBaseWorld = screenPointToWorld(teamCamera, {
      x: viewport.x / 2,
      y: viewport.y / 2,
    });

    expect(teamCamera.zoom).toBe(CAMERA_DEFAULT_ZOOM);
    expect(centeredBaseWorld.x).toBeCloseTo((baseCenter.x + 0.5) * cellSize, 8);
    expect(centeredBaseWorld.y).toBeCloseTo((baseCenter.y + 0.5) * cellSize, 8);

    const spectatorCamera = resetCameraToBase({
      viewport,
      grid,
      cellSize,
      baseTopLeft: null,
    });
    const centeredSpectatorWorld = screenPointToWorld(spectatorCamera, {
      x: viewport.x / 2,
      y: viewport.y / 2,
    });

    expect(centeredSpectatorWorld.x).toBeCloseTo(
      (grid.width * cellSize) / 2,
      8,
    );
    expect(centeredSpectatorWorld.y).toBeCloseTo(
      (grid.height * cellSize) / 2,
      8,
    );
  });
});
