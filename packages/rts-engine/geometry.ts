import { RtsEngine } from './rts.js';

export interface Vector2 {
  x: number;
  y: number;
}

export const BASE_FOOTPRINT_WIDTH = RtsEngine.CORE_STRUCTURE_TEMPLATE.width;
export const BASE_FOOTPRINT_HEIGHT = RtsEngine.CORE_STRUCTURE_TEMPLATE.height;
export const BASE_CENTER_OFFSET = Math.floor(BASE_FOOTPRINT_WIDTH / 2);

export function isCanonicalBaseCell(localX: number, localY: number): boolean {
  return RtsEngine.CORE_STRUCTURE_TEMPLATE.isCellAlive(localX, localY);
}

export function getBaseCenter(baseTopLeft: Vector2): Vector2 {
  return {
    x: baseTopLeft.x + BASE_CENTER_OFFSET,
    y: baseTopLeft.y + BASE_CENTER_OFFSET,
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
