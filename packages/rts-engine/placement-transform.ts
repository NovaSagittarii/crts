import type { Vector2 } from './geometry.js';
import type { GridView, GridViewTransformMatrix } from './grid-view.js';
import {
  GRID_VIEW_FLIP_HORIZONTAL_MATRIX,
  GRID_VIEW_FLIP_VERTICAL_MATRIX,
  GRID_VIEW_IDENTITY_MATRIX,
  GRID_VIEW_ROTATE_MATRIX,
} from './grid-view.js';

export type PlacementTransformOperation =
  | 'rotate'
  | 'mirror-horizontal'
  | 'mirror-vertical';

export interface PlacementTransformInput {
  operations?: PlacementTransformOperation[];
}

export type PlacementTransformMatrix = GridViewTransformMatrix;

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
  cells: Uint8Array;
  checks: readonly Vector2[];
}

export interface TransformedTemplate {
  width: number;
  height: number;
  cells: Uint8Array;
  occupiedCells: Vector2[];
  checks: Vector2[];
  gridView: GridView;
}

export interface PlacementProjection {
  bounds: PlacementBounds;
  areaCells: Vector2[];
  occupiedCells: Vector2[];
  checks: Vector2[];
}

const OPERATION_MATRICES: Record<
  PlacementTransformOperation,
  PlacementTransformMatrix
> = {
  rotate: GRID_VIEW_ROTATE_MATRIX,
  'mirror-horizontal': GRID_VIEW_FLIP_HORIZONTAL_MATRIX,
  'mirror-vertical': GRID_VIEW_FLIP_VERTICAL_MATRIX,
};

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

function createLegacyEntrypointError(
  entrypoint: 'projectTemplateWithTransform' | 'projectPlacementToWorld',
): Error {
  return new Error(
    `${entrypoint} has been retired. Migrate to template.grid().applyTransform(normalizePlacementTransform(payload.transform).matrix) and derive wrapped world coordinates with GridView.translate(...) plus wrapCoordinate().`,
  );
}

export function normalizePlacementTransform(
  input: PlacementTransformInput | null | undefined,
): PlacementTransformState {
  const operations = normalizeOperations(input);
  let matrix = GRID_VIEW_IDENTITY_MATRIX;
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
    matrix: GRID_VIEW_IDENTITY_MATRIX,
  };
}

export function projectTemplateWithTransform(
  _template: TransformTemplateInput,
  _transform: PlacementTransformState,
): TransformedTemplate {
  throw createLegacyEntrypointError('projectTemplateWithTransform');
}

export function wrapCoordinate(value: number, size: number): number {
  return ((value % size) + size) % size;
}

export function projectPlacementToWorld(
  _transformedTemplate: Pick<
    TransformedTemplate,
    'width' | 'height' | 'occupiedCells' | 'checks'
  >,
  _anchorX: number,
  _anchorY: number,
  _roomWidth: number,
  _roomHeight: number,
): PlacementProjection {
  throw createLegacyEntrypointError('projectPlacementToWorld');
}
