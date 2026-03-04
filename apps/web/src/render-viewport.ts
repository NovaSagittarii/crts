import type { CameraViewState } from './camera-view-model.js';

export interface VisibleGridBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface ComputeVisibleGridBoundsInput {
  camera: CameraViewState;
  canvasWidth: number;
  canvasHeight: number;
  cellSize: number;
  gridWidth: number;
  gridHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function computeVisibleGridBounds(
  input: ComputeVisibleGridBoundsInput,
): VisibleGridBounds | null {
  if (
    input.gridWidth <= 0 ||
    input.gridHeight <= 0 ||
    input.cellSize <= 0 ||
    input.canvasWidth <= 0 ||
    input.canvasHeight <= 0 ||
    input.camera.zoom <= 0
  ) {
    return null;
  }

  const leftWorld = (0 - input.camera.offsetX) / input.camera.zoom;
  const rightWorld =
    (input.canvasWidth - input.camera.offsetX) / input.camera.zoom;
  const topWorld = (0 - input.camera.offsetY) / input.camera.zoom;
  const bottomWorld =
    (input.canvasHeight - input.camera.offsetY) / input.camera.zoom;

  const minWorldX = Math.min(leftWorld, rightWorld);
  const maxWorldX = Math.max(leftWorld, rightWorld);
  const minWorldY = Math.min(topWorld, bottomWorld);
  const maxWorldY = Math.max(topWorld, bottomWorld);

  let minX = Math.floor(minWorldX / input.cellSize);
  let maxX = Math.ceil(maxWorldX / input.cellSize) - 1;
  let minY = Math.floor(minWorldY / input.cellSize);
  let maxY = Math.ceil(maxWorldY / input.cellSize) - 1;

  if (
    maxX < 0 ||
    maxY < 0 ||
    minX >= input.gridWidth ||
    minY >= input.gridHeight
  ) {
    return null;
  }

  minX = clamp(minX, 0, input.gridWidth - 1);
  maxX = clamp(maxX, 0, input.gridWidth - 1);
  minY = clamp(minY, 0, input.gridHeight - 1);
  maxY = clamp(maxY, 0, input.gridHeight - 1);

  if (minX > maxX || minY > maxY) {
    return null;
  }

  return {
    minX,
    maxX,
    minY,
    maxY,
  };
}
