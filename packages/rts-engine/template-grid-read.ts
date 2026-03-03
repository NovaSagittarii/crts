import type { Vector2 } from './geometry.js';
import { GridView, type GridViewCell } from './grid-view.js';
import {
  normalizePlacementTransform,
  wrapCoordinate,
  type PlacementBounds,
  type PlacementTransformInput,
  type PlacementTransformState,
  type TransformedTemplate,
} from './placement-transform.js';

export interface TemplateGridReadTemplateShape {
  width: number;
  height: number;
}

export interface TemplateGridReadTemplate extends TemplateGridReadTemplateShape {
  cells: Uint8Array;
  checks: readonly Vector2[];
  grid?: () => GridView;
}

interface TemplateGridReadTemplateWithGrid extends TemplateGridReadTemplate {
  grid(): GridView;
}

export interface TemplateGridReadBounds {
  width: number;
  height: number;
}

export interface TemplateGridReadProjection {
  bounds: PlacementBounds;
  areaCells: Vector2[];
  occupiedCells: Vector2[];
  checks: Vector2[];
}

export interface TemplateGridReadIntegrityMaskCell {
  x: number;
  y: number;
  expected: number;
}

function compareCells(left: Vector2, right: Vector2): number {
  return left.y - right.y || left.x - right.x;
}

function uniqueSortedCells(cells: readonly Vector2[]): Vector2[] {
  const unique = new Map<string, Vector2>();
  for (const cell of cells) {
    unique.set(`${cell.x},${cell.y}`, { x: cell.x, y: cell.y });
  }
  return [...unique.values()].sort(compareCells);
}

function validateTemplateDimensions(
  template: Pick<TemplateGridReadTemplate, 'width' | 'height' | 'cells'>,
): void {
  if (template.width <= 0 || template.height <= 0) {
    throw new Error('Template dimensions must be positive');
  }
  if (template.cells.length !== template.width * template.height) {
    throw new Error('Template cell dimensions do not match width/height');
  }
}

function createTemplateGridCells(
  width: number,
  height: number,
  cells: Uint8Array,
): GridViewCell[] {
  const gridCells: GridViewCell[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      gridCells.push({
        x,
        y,
        alive: cells[y * width + x] === 1,
      });
    }
  }
  return gridCells;
}

function ensureTemplateGrid(
  template: TemplateGridReadTemplate,
): TemplateGridReadTemplateWithGrid {
  validateTemplateDimensions(template);

  if (typeof template.grid === 'function') {
    return {
      ...template,
      grid: template.grid,
    };
  }

  const cells = new Uint8Array(template.cells);
  const checks = template.checks.map((check) => ({ x: check.x, y: check.y }));
  const gridCells = createTemplateGridCells(
    template.width,
    template.height,
    cells,
  );

  return {
    ...template,
    cells,
    checks,
    grid(): GridView {
      return GridView.fromCells(gridCells);
    },
  };
}

export function transformTemplateWithGridView(
  template: TemplateGridReadTemplate,
  transform: PlacementTransformState,
): TransformedTemplate {
  const canonicalTemplate = ensureTemplateGrid(template);
  const gridView = canonicalTemplate.grid().applyTransform(transform.matrix);
  const transformedCellsOrdered = gridView.cells();
  const originCell = transformedCellsOrdered[0];
  if (!originCell) {
    throw new Error('Template dimensions must be positive');
  }

  const bounds = gridView.bounds();
  const transformedCells = new Uint8Array(bounds.width * bounds.height);
  for (let index = 0; index < transformedCellsOrdered.length; index += 1) {
    const target = transformedCellsOrdered[index];
    transformedCells[target.y * bounds.width + target.x] =
      canonicalTemplate.cells[index];
  }

  const transformedChecks = uniqueSortedCells(
    canonicalTemplate.checks.map((check) => ({
      x:
        transform.matrix.xx * check.x +
        transform.matrix.xy * check.y +
        originCell.x,
      y:
        transform.matrix.yx * check.x +
        transform.matrix.yy * check.y +
        originCell.y,
    })),
  );

  return {
    width: bounds.width,
    height: bounds.height,
    cells: transformedCells,
    occupiedCells: uniqueSortedCells(
      gridView.occupiedCells().map((cell) => ({ x: cell.x, y: cell.y })),
    ),
    checks: transformedChecks,
    gridView,
  };
}

export function projectTransformedTemplateToWorld(
  transformedTemplate: Pick<
    TransformedTemplate,
    'gridView' | 'width' | 'height' | 'occupiedCells' | 'checks'
  >,
  anchorX: number,
  anchorY: number,
  roomWidth: number,
  roomHeight: number,
): TemplateGridReadProjection {
  const areaCells = transformedTemplate.gridView.cells().map((cell) => ({
    x: wrapCoordinate(anchorX + cell.x, roomWidth),
    y: wrapCoordinate(anchorY + cell.y, roomHeight),
  }));

  const occupiedCells = transformedTemplate.occupiedCells.map((cell) => ({
    x: wrapCoordinate(anchorX + cell.x, roomWidth),
    y: wrapCoordinate(anchorY + cell.y, roomHeight),
  }));

  const checks = transformedTemplate.checks.map((check) => ({
    x: wrapCoordinate(anchorX + check.x, roomWidth),
    y: wrapCoordinate(anchorY + check.y, roomHeight),
  }));

  return {
    bounds: {
      x: anchorX,
      y: anchorY,
      width: transformedTemplate.width,
      height: transformedTemplate.height,
    },
    areaCells: uniqueSortedCells(areaCells),
    occupiedCells: uniqueSortedCells(occupiedCells),
    checks: uniqueSortedCells(checks),
  };
}

export function estimateTransformedTemplateBounds(
  template: TemplateGridReadTemplateShape,
  transformInput: PlacementTransformInput | null | undefined,
): TemplateGridReadBounds {
  const transform = normalizePlacementTransform(transformInput);
  const transformedTemplate = transformTemplateWithGridView(
    {
      width: template.width,
      height: template.height,
      cells: new Uint8Array(template.width * template.height),
      checks: [],
    },
    transform,
  );

  return {
    width: transformedTemplate.width,
    height: transformedTemplate.height,
  };
}

export function deriveIntegrityMaskCells(
  templateChecks: readonly Vector2[],
  transformedTemplate: Pick<
    TransformedTemplate,
    'width' | 'cells' | 'checks' | 'occupiedCells'
  >,
): TemplateGridReadIntegrityMaskCell[] {
  const sourceChecks =
    templateChecks.length > 0
      ? transformedTemplate.checks
      : transformedTemplate.occupiedCells;
  const orderedChecks = uniqueSortedCells(
    sourceChecks.map((check) => ({ x: check.x, y: check.y })),
  );

  const mask: TemplateGridReadIntegrityMaskCell[] = [];
  for (const check of orderedChecks) {
    mask.push({
      x: check.x,
      y: check.y,
      expected:
        transformedTemplate.cells[
          check.y * transformedTemplate.width + check.x
        ],
    });
  }

  return mask;
}
