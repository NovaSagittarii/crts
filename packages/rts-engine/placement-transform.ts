import { Grid } from '#conway-core';

import type { Vector2 } from './geometry.js';

export type PlacementTransformOperation =
  | 'rotate'
  | 'mirror-horizontal'
  | 'mirror-vertical';

export interface PlacementTransformInput {
  operations?: PlacementTransformOperation[];
}

export interface PlacementTransformMatrix {
  xx: number;
  xy: number;
  yx: number;
  yy: number;
}

export interface PlacementTransformState {
  operations: PlacementTransformOperation[];
  matrix: PlacementTransformMatrix;
}

export interface PlacementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TransformTemplateInput {
  width: number;
  height: number;
  grid: Grid;
  checks: readonly Vector2[];
}

export interface TransformedTemplate {
  width: number;
  height: number;
  grid: Grid;
  occupiedCells: Vector2[];
  checks: Vector2[];
}

export interface PlacementProjection {
  bounds: PlacementBounds;
  areaCells: Vector2[];
  occupiedCells: Vector2[];
  checks: Vector2[];
}

const IDENTITY_MATRIX: PlacementTransformMatrix = {
  xx: 1,
  xy: 0,
  yx: 0,
  yy: 1,
};

const OPERATION_MATRICES: Record<
  PlacementTransformOperation,
  PlacementTransformMatrix
> = {
  rotate: {
    xx: 0,
    xy: 1,
    yx: -1,
    yy: 0,
  },
  'mirror-horizontal': {
    xx: -1,
    xy: 0,
    yx: 0,
    yy: 1,
  },
  'mirror-vertical': {
    xx: 1,
    xy: 0,
    yx: 0,
    yy: -1,
  },
};

interface MatrixPoint {
  x: number;
  y: number;
}

interface MatrixExtents {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function isPlacementTransformOperation(
  value: string,
): value is PlacementTransformOperation {
  return (
    value === 'rotate' ||
    value === 'mirror-horizontal' ||
    value === 'mirror-vertical'
  );
}

function multiplyMatrices(
  left: PlacementTransformMatrix,
  right: PlacementTransformMatrix,
): PlacementTransformMatrix {
  return {
    xx: left.xx * right.xx + left.xy * right.yx,
    xy: left.xx * right.xy + left.xy * right.yy,
    yx: left.yx * right.xx + left.yy * right.yx,
    yy: left.yx * right.xy + left.yy * right.yy,
  };
}

function applyMatrix(
  matrix: PlacementTransformMatrix,
  x: number,
  y: number,
): MatrixPoint {
  return {
    x: matrix.xx * x + matrix.xy * y,
    y: matrix.yx * x + matrix.yy * y,
  };
}

function compareCells(left: Vector2, right: Vector2): number {
  return left.y - right.y || left.x - right.x;
}

function uniqueSortedCells(cells: Vector2[]): Vector2[] {
  const unique = new Map<string, Vector2>();
  for (const cell of cells) {
    unique.set(`${cell.x},${cell.y}`, cell);
  }
  return [...unique.values()].sort(compareCells);
}

function normalizeOperations(
  input: PlacementTransformInput | null | undefined,
): PlacementTransformOperation[] {
  if (!input || !Array.isArray(input.operations)) {
    return [];
  }

  const operations: PlacementTransformOperation[] = [];
  for (const operation of input.operations) {
    if (typeof operation !== 'string') {
      continue;
    }
    if (isPlacementTransformOperation(operation)) {
      operations.push(operation);
    }
  }

  return operations;
}

function deriveMatrixExtents(
  width: number,
  height: number,
  matrix: PlacementTransformMatrix,
): MatrixExtents {
  const corners = [
    applyMatrix(matrix, 0, 0),
    applyMatrix(matrix, width - 1, 0),
    applyMatrix(matrix, 0, height - 1),
    applyMatrix(matrix, width - 1, height - 1),
  ];

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const point of corners) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

export function normalizePlacementTransform(
  input: PlacementTransformInput | null | undefined,
): PlacementTransformState {
  const operations = normalizeOperations(input);
  let matrix = IDENTITY_MATRIX;
  for (const operation of operations) {
    matrix = multiplyMatrices(OPERATION_MATRICES[operation], matrix);
  }

  return {
    operations,
    matrix,
  };
}

export function createIdentityPlacementTransform(): PlacementTransformState {
  return {
    operations: [],
    matrix: IDENTITY_MATRIX,
  };
}

export function projectTemplateWithTransform(
  template: TransformTemplateInput,
  transform: PlacementTransformState,
): TransformedTemplate {
  if (template.width <= 0 || template.height <= 0) {
    throw new Error('Template dimensions must be positive');
  }
  if (
    template.grid.width !== template.width ||
    template.grid.height !== template.height
  ) {
    throw new Error('Template grid dimensions do not match width/height');
  }

  const extents = deriveMatrixExtents(
    template.width,
    template.height,
    transform.matrix,
  );
  const transformedWidth = extents.maxX - extents.minX + 1;
  const transformedHeight = extents.maxY - extents.minY + 1;

  const occupiedCells: Vector2[] = [];
  for (let y = 0; y < template.height; y += 1) {
    for (let x = 0; x < template.width; x += 1) {
      if (!template.grid.isCellAlive(x, y)) {
        continue;
      }

      const transformed = applyMatrix(transform.matrix, x, y);
      const normalizedX = transformed.x - extents.minX;
      const normalizedY = transformed.y - extents.minY;
      occupiedCells.push({
        x: normalizedX,
        y: normalizedY,
      });
    }
  }

  const normalizedOccupiedCells = uniqueSortedCells(occupiedCells);

  const transformedChecks = uniqueSortedCells(
    template.checks.map((check) => {
      const transformed = applyMatrix(transform.matrix, check.x, check.y);
      return {
        x: transformed.x - extents.minX,
        y: transformed.y - extents.minY,
      };
    }),
  );

  return {
    width: transformedWidth,
    height: transformedHeight,
    grid: new Grid(
      transformedWidth,
      transformedHeight,
      normalizedOccupiedCells,
      'flat',
    ),
    occupiedCells: normalizedOccupiedCells,
    checks: transformedChecks,
  };
}

export function wrapCoordinate(value: number, size: number): number {
  return ((value % size) + size) % size;
}

export function projectPlacementToWorld(
  transformedTemplate: Pick<
    TransformedTemplate,
    'width' | 'height' | 'occupiedCells' | 'checks'
  >,
  anchorX: number,
  anchorY: number,
  roomWidth: number,
  roomHeight: number,
): PlacementProjection {
  const areaCells: Vector2[] = [];
  for (let y = 0; y < transformedTemplate.height; y += 1) {
    for (let x = 0; x < transformedTemplate.width; x += 1) {
      areaCells.push({
        x: wrapCoordinate(anchorX + x, roomWidth),
        y: wrapCoordinate(anchorY + y, roomHeight),
      });
    }
  }

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
