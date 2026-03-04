import {
  CORE_FOOTPRINT_HEIGHT,
  CORE_FOOTPRINT_WIDTH,
  isCoreFootprintCellAlive,
} from './core-footprint.js';

export interface Vector2 {
  x: number;
  y: number;
}

export const BASE_FOOTPRINT_WIDTH = CORE_FOOTPRINT_WIDTH;
export const BASE_FOOTPRINT_HEIGHT = CORE_FOOTPRINT_HEIGHT;

const BASE_CENTER_OFFSET_X = Math.floor(BASE_FOOTPRINT_WIDTH / 2);
const BASE_CENTER_OFFSET_Y = Math.floor(BASE_FOOTPRINT_HEIGHT / 2);

export function isCanonicalBaseCell(localX: number, localY: number): boolean {
  return isCoreFootprintCellAlive(localX, localY);
}

export function getBaseCenter(baseTopLeft: Vector2): Vector2 {
  return {
    x: baseTopLeft.x + BASE_CENTER_OFFSET_X,
    y: baseTopLeft.y + BASE_CENTER_OFFSET_Y,
  };
}

export function getCanonicalBaseCells(baseTopLeft: Vector2): Vector2[] {
  const cells: Vector2[] = [];

  for (let localY = 0; localY < BASE_FOOTPRINT_HEIGHT; localY += 1) {
    for (let localX = 0; localX < BASE_FOOTPRINT_WIDTH; localX += 1) {
      if (!isCanonicalBaseCell(localX, localY)) {
        continue;
      }

      cells.push({
        x: baseTopLeft.x + localX,
        y: baseTopLeft.y + localY,
      });
    }
  }

  return cells;
}
