import { type Vector2, getBaseCenter } from '#rts-engine';

export const CAMERA_MIN_ZOOM = 0.45;
export const CAMERA_MAX_ZOOM = 1.6;
export const CAMERA_DEFAULT_ZOOM = 1;
export const CAMERA_KEYBOARD_PAN_STEP = 48;
export const CAMERA_KEYBOARD_ZOOM_FACTOR = 1.12;

export interface CameraViewState {
  zoom: number;
  offsetX: number;
  offsetY: number;
}

export interface CameraPoint {
  x: number;
  y: number;
}

export interface CameraGridSize {
  width: number;
  height: number;
}

export type CameraPanDirection = 'left' | 'right' | 'up' | 'down';

export interface ScreenPointToCellOptions {
  cellSize: number;
  grid: CameraGridSize;
}

export interface ResetCameraToBaseOptions {
  viewport: CameraPoint;
  grid: CameraGridSize;
  cellSize: number;
  baseTopLeft: Vector2 | null;
  zoom?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function createCameraViewState(): CameraViewState {
  return {
    zoom: CAMERA_DEFAULT_ZOOM,
    offsetX: 0,
    offsetY: 0,
  };
}

export function clampCameraZoom(zoom: number): number {
  return clamp(zoom, CAMERA_MIN_ZOOM, CAMERA_MAX_ZOOM);
}

export function screenPointToWorld(
  state: CameraViewState,
  point: CameraPoint,
): CameraPoint {
  return {
    x: (point.x - state.offsetX) / state.zoom,
    y: (point.y - state.offsetY) / state.zoom,
  };
}

export function worldPointToScreen(
  state: CameraViewState,
  point: CameraPoint,
): CameraPoint {
  return {
    x: point.x * state.zoom + state.offsetX,
    y: point.y * state.zoom + state.offsetY,
  };
}

export function screenPointToCell(
  state: CameraViewState,
  point: CameraPoint,
  options: ScreenPointToCellOptions,
): CameraPoint | null {
  if (options.cellSize <= 0) {
    return null;
  }

  const world = screenPointToWorld(state, point);
  const x = Math.floor(world.x / options.cellSize);
  const y = Math.floor(world.y / options.cellSize);
  if (x < 0 || y < 0 || x >= options.grid.width || y >= options.grid.height) {
    return null;
  }

  return { x, y };
}

export function applyPanDelta(
  state: CameraViewState,
  deltaX: number,
  deltaY: number,
): CameraViewState {
  return {
    ...state,
    offsetX: state.offsetX + deltaX,
    offsetY: state.offsetY + deltaY,
  };
}

export function applyKeyboardPan(
  state: CameraViewState,
  direction: CameraPanDirection,
  step = CAMERA_KEYBOARD_PAN_STEP,
): CameraViewState {
  if (direction === 'left') {
    return applyPanDelta(state, step, 0);
  }
  if (direction === 'right') {
    return applyPanDelta(state, -step, 0);
  }
  if (direction === 'up') {
    return applyPanDelta(state, 0, step);
  }
  return applyPanDelta(state, 0, -step);
}

export function normalizeWheelZoomFactor(
  deltaY: number,
  deltaMode: number,
): number {
  let normalizedDelta = deltaY;
  if (deltaMode === 1) {
    normalizedDelta *= 16;
  } else if (deltaMode === 2) {
    normalizedDelta *= 120;
  }

  const clampedDelta = clamp(normalizedDelta, -240, 240);
  const factor = Math.exp(-clampedDelta * 0.0015);
  return clamp(factor, 0.8, 1.25);
}

export function applyWheelZoomAtPoint(
  state: CameraViewState,
  point: CameraPoint,
  zoomFactor: number,
): CameraViewState {
  if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
    return state;
  }

  const worldAtPoint = screenPointToWorld(state, point);
  const nextZoom = clampCameraZoom(state.zoom * zoomFactor);

  return {
    zoom: nextZoom,
    offsetX: point.x - worldAtPoint.x * nextZoom,
    offsetY: point.y - worldAtPoint.y * nextZoom,
  };
}

function getResetTargetWorldPoint(
  options: ResetCameraToBaseOptions,
): CameraPoint {
  if (options.baseTopLeft) {
    const baseCenter = getBaseCenter(options.baseTopLeft);
    return {
      x: (baseCenter.x + 0.5) * options.cellSize,
      y: (baseCenter.y + 0.5) * options.cellSize,
    };
  }

  return {
    x: (options.grid.width * options.cellSize) / 2,
    y: (options.grid.height * options.cellSize) / 2,
  };
}

export function resetCameraToBase(
  options: ResetCameraToBaseOptions,
): CameraViewState {
  const zoom = clampCameraZoom(options.zoom ?? CAMERA_DEFAULT_ZOOM);
  const target = getResetTargetWorldPoint(options);

  return {
    zoom,
    offsetX: options.viewport.x / 2 - target.x * zoom,
    offsetY: options.viewport.y / 2 - target.y * zoom,
  };
}
