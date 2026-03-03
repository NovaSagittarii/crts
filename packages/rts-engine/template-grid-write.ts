import type { Vector2 } from './geometry.js';
import {
  normalizePlacementTransform,
  wrapCoordinate,
  type PlacementBounds,
  type PlacementTransformInput,
  type PlacementTransformState,
  type TransformedTemplate,
} from './placement-transform.js';
import {
  projectTransformedTemplateToWorld,
  transformTemplateWithGridView,
  type TemplateGridReadTemplate,
} from './template-grid-read.js';

export interface TemplateGridWriteTemplate extends TemplateGridReadTemplate {}

export interface TemplateGridWriteWorldCell {
  localX: number;
  localY: number;
  x: number;
  y: number;
  alive: boolean;
}

export interface TemplateGridWriteProjection {
  transform: PlacementTransformState;
  transformedTemplate: TransformedTemplate;
  bounds: PlacementBounds;
  areaCells: Vector2[];
  footprint: Vector2[];
  checks: Vector2[];
  worldCells: TemplateGridWriteWorldCell[];
}

function gridCellAt(
  grid: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return 0;
  }
  return grid[y * width + x];
}

function setGridCell(
  grid: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  value: number,
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }
  grid[y * width + x] = value;
}

function projectTransformedTemplateWorldCells(
  transformedTemplate: Pick<TransformedTemplate, 'gridView'>,
  bounds: PlacementBounds,
  roomWidth: number,
  roomHeight: number,
): TemplateGridWriteWorldCell[] {
  return transformedTemplate.gridView.cells().map((cell) => ({
    localX: cell.x,
    localY: cell.y,
    x: wrapCoordinate(bounds.x + cell.x, roomWidth),
    y: wrapCoordinate(bounds.y + cell.y, roomHeight),
    alive: cell.alive,
  }));
}

export function projectTemplateGridWritePlacement(
  template: TemplateGridWriteTemplate,
  anchorX: number,
  anchorY: number,
  roomWidth: number,
  roomHeight: number,
  transformInput: PlacementTransformInput | null | undefined,
): TemplateGridWriteProjection {
  const transform = normalizePlacementTransform(transformInput);
  const transformedTemplate = transformTemplateWithGridView(
    template,
    transform,
  );
  const bounds: PlacementBounds = {
    x: anchorX,
    y: anchorY,
    width: transformedTemplate.width,
    height: transformedTemplate.height,
  };

  const projection = projectTransformedTemplateToWorld(
    transformedTemplate,
    anchorX,
    anchorY,
    roomWidth,
    roomHeight,
  );

  return {
    transform,
    transformedTemplate,
    bounds,
    areaCells: projection.areaCells,
    footprint: projection.occupiedCells,
    checks: projection.checks,
    worldCells: projectTransformedTemplateWorldCells(
      transformedTemplate,
      bounds,
      roomWidth,
      roomHeight,
    ),
  };
}

export function countTemplateWriteDiffCells(
  grid: Uint8Array,
  width: number,
  height: number,
  projection: Pick<TemplateGridWriteProjection, 'worldCells'>,
): number {
  let diffCount = 0;

  for (const cell of projection.worldCells) {
    const templateCell = cell.alive ? 1 : 0;
    const roomCell = gridCellAt(grid, width, height, cell.x, cell.y);
    if (templateCell !== roomCell) {
      diffCount += 1;
    }
  }

  return diffCount;
}

export function applyTemplateWriteProjection(
  grid: Uint8Array,
  width: number,
  height: number,
  projection: Pick<TemplateGridWriteProjection, 'worldCells'>,
): boolean {
  for (const cell of projection.worldCells) {
    setGridCell(grid, width, height, cell.x, cell.y, cell.alive ? 1 : 0);
  }

  return true;
}
