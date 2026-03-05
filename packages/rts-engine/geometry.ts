import { CORE_TEMPLATE_GRID } from './structure.js';

export interface Vector2 {
  x: number;
  y: number;
}

export const BASE_FOOTPRINT_WIDTH = CORE_TEMPLATE_GRID.width;
export const BASE_FOOTPRINT_HEIGHT = CORE_TEMPLATE_GRID.height;
export const BASE_CENTER_OFFSET = Math.floor(BASE_FOOTPRINT_WIDTH / 2);

const BASE_CENTER_OFFSET_X = Math.floor(BASE_FOOTPRINT_WIDTH / 2);
const BASE_CENTER_OFFSET_Y = Math.floor(BASE_FOOTPRINT_HEIGHT / 2);

export function isCanonicalBaseCell(localX: number, localY: number): boolean {
  return !!CORE_TEMPLATE_GRID.cells[localY * BASE_FOOTPRINT_WIDTH + localX];
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
