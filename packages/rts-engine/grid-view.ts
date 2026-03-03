export interface GridViewCell {
  x: number;
  y: number;
  alive: boolean;
}

export interface GridViewCoordinate {
  x: number;
  y: number;
}

export interface GridViewBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface GridViewTransformMatrix {
  xx: number;
  xy: number;
  yx: number;
  yy: number;
}

export const GRID_VIEW_IDENTITY_MATRIX: GridViewTransformMatrix = {
  xx: 1,
  xy: 0,
  yx: 0,
  yy: 1,
};

export const GRID_VIEW_ROTATE_MATRIX: GridViewTransformMatrix = {
  xx: 0,
  xy: 1,
  yx: -1,
  yy: 0,
};

export const GRID_VIEW_FLIP_HORIZONTAL_MATRIX: GridViewTransformMatrix = {
  xx: -1,
  xy: 0,
  yx: 0,
  yy: 1,
};

export const GRID_VIEW_FLIP_VERTICAL_MATRIX: GridViewTransformMatrix = {
  xx: 1,
  xy: 0,
  yx: 0,
  yy: -1,
};

interface MatrixExtents {
  minX: number;
  minY: number;
}

function coordinateKey(x: number, y: number): string {
  return `${x},${y}`;
}

function assertIntegerCoordinate(value: number, axis: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`GridView ${axis} coordinate must be an integer`);
  }
}

function assertIntegerValue(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new Error(`GridView ${label} must be an integer`);
  }
}

function isUnitAxisValue(value: number): boolean {
  return value === -1 || value === 0 || value === 1;
}

export function isPlacementSafeTransformMatrix(
  matrix: GridViewTransformMatrix,
): boolean {
  const { xx, xy, yx, yy } = matrix;
  if (
    !Number.isInteger(xx) ||
    !Number.isInteger(xy) ||
    !Number.isInteger(yx) ||
    !Number.isInteger(yy)
  ) {
    return false;
  }
  if (
    !isUnitAxisValue(xx) ||
    !isUnitAxisValue(xy) ||
    !isUnitAxisValue(yx) ||
    !isUnitAxisValue(yy)
  ) {
    return false;
  }

  const rowOneLength = xx * xx + xy * xy;
  const rowTwoLength = yx * yx + yy * yy;
  const colOneLength = xx * xx + yx * yx;
  const colTwoLength = xy * xy + yy * yy;
  const dotRows = xx * yx + xy * yy;
  const determinant = xx * yy - xy * yx;

  return (
    rowOneLength === 1 &&
    rowTwoLength === 1 &&
    colOneLength === 1 &&
    colTwoLength === 1 &&
    dotRows === 0 &&
    Math.abs(determinant) === 1
  );
}

export function assertPlacementSafeTransformMatrix(
  matrix: GridViewTransformMatrix,
  methodName = 'GridView.applyTransform',
): void {
  if (isPlacementSafeTransformMatrix(matrix)) {
    return;
  }

  throw new Error(
    `${methodName} requires a placement-safe orthogonal integer matrix (xx, xy, yx, yy in -1|0|1 with determinant +/-1). Use rotate(), flipHorizontal(), flipVertical(), or normalizePlacementTransform(...).matrix.`,
  );
}

export function applyTransformMatrixToCoordinate(
  matrix: GridViewTransformMatrix,
  x: number,
  y: number,
): GridViewCoordinate {
  return {
    x: matrix.xx * x + matrix.xy * y,
    y: matrix.yx * x + matrix.yy * y,
  };
}

function deriveMatrixExtents(
  cells: ReadonlyArray<GridViewCell>,
  matrix: GridViewTransformMatrix,
): MatrixExtents {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;

  for (const cell of cells) {
    const transformed = applyTransformMatrixToCoordinate(
      matrix,
      cell.x,
      cell.y,
    );
    minX = Math.min(minX, transformed.x);
    minY = Math.min(minY, transformed.y);
  }

  return { minX, minY };
}

function createEmptyBounds(): GridViewBounds {
  return {
    minX: 0,
    minY: 0,
    maxX: -1,
    maxY: -1,
    width: 0,
    height: 0,
  };
}

export class GridView {
  private readonly orderedCells: ReadonlyArray<GridViewCell>;
  private readonly occupied: ReadonlyArray<GridViewCoordinate>;
  private readonly gridBounds: GridViewBounds;
  private readonly cellLookup: ReadonlyMap<string, GridViewCell>;

  private constructor(
    orderedCells: ReadonlyArray<GridViewCell>,
    occupied: ReadonlyArray<GridViewCoordinate>,
    gridBounds: GridViewBounds,
    cellLookup: ReadonlyMap<string, GridViewCell>,
  ) {
    this.orderedCells = orderedCells;
    this.occupied = occupied;
    this.gridBounds = gridBounds;
    this.cellLookup = cellLookup;
  }

  public static fromCells(cells: ReadonlyArray<GridViewCell>): GridView {
    const orderedCells: GridViewCell[] = [];
    const occupied: GridViewCoordinate[] = [];
    const lookup = new Map<string, GridViewCell>();

    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;

    for (const cell of cells) {
      assertIntegerCoordinate(cell.x, 'x');
      assertIntegerCoordinate(cell.y, 'y');

      const key = coordinateKey(cell.x, cell.y);
      if (lookup.has(key)) {
        throw new Error(
          `GridView cannot contain duplicate coordinates (${cell.x}, ${cell.y})`,
        );
      }

      const entry: GridViewCell = Object.freeze({
        x: cell.x,
        y: cell.y,
        alive: cell.alive === true,
      });
      orderedCells.push(entry);
      lookup.set(key, entry);

      minX = Math.min(minX, entry.x);
      minY = Math.min(minY, entry.y);
      maxX = Math.max(maxX, entry.x);
      maxY = Math.max(maxY, entry.y);

      if (entry.alive) {
        occupied.push(
          Object.freeze({
            x: entry.x,
            y: entry.y,
          }),
        );
      }
    }

    const bounds =
      orderedCells.length === 0
        ? createEmptyBounds()
        : {
            minX,
            minY,
            maxX,
            maxY,
            width: maxX - minX + 1,
            height: maxY - minY + 1,
          };

    return new GridView(
      Object.freeze(orderedCells),
      Object.freeze(occupied),
      Object.freeze(bounds),
      new Map(lookup),
    );
  }

  public cells(): ReadonlyArray<GridViewCell> {
    return this.orderedCells;
  }

  public occupiedCells(): ReadonlyArray<GridViewCoordinate> {
    return this.occupied;
  }

  public bounds(): GridViewBounds {
    return this.gridBounds;
  }

  public cellAt(x: number, y: number): GridViewCell | null {
    return this.cellLookup.get(coordinateKey(x, y)) ?? null;
  }

  public toUint8Array(): Uint8Array {
    const bounds = this.gridBounds;
    if (bounds.width === 0 || bounds.height === 0) {
      return new Uint8Array(0);
    }

    const cells = new Uint8Array(bounds.width * bounds.height);
    for (const cell of this.orderedCells) {
      if (!cell.alive) {
        continue;
      }

      const normalizedX = cell.x - bounds.minX;
      const normalizedY = cell.y - bounds.minY;
      cells[normalizedY * bounds.width + normalizedX] = 1;
    }

    return cells;
  }

  public translate(dx: number, dy: number): GridView {
    assertIntegerValue(dx, 'translate dx');
    assertIntegerValue(dy, 'translate dy');

    return GridView.fromCells(
      this.orderedCells.map((cell) => ({
        x: cell.x + dx,
        y: cell.y + dy,
        alive: cell.alive,
      })),
    );
  }

  public rotate(times = 1): GridView {
    assertIntegerValue(times, 'rotate times');
    const normalizedTimes = ((times % 4) + 4) % 4;

    let view = GridView.fromCells(this.orderedCells);
    for (let index = 0; index < normalizedTimes; index += 1) {
      view = view.applyTransform(GRID_VIEW_ROTATE_MATRIX);
    }

    return view;
  }

  public flipHorizontal(): GridView {
    return this.applyTransform(GRID_VIEW_FLIP_HORIZONTAL_MATRIX);
  }

  public flipVertical(): GridView {
    return this.applyTransform(GRID_VIEW_FLIP_VERTICAL_MATRIX);
  }

  public applyTransform(matrix: GridViewTransformMatrix): GridView {
    assertPlacementSafeTransformMatrix(matrix);
    if (this.orderedCells.length === 0) {
      return GridView.fromCells([]);
    }

    const extents = deriveMatrixExtents(this.orderedCells, matrix);
    return GridView.fromCells(
      this.orderedCells.map((cell) => {
        const transformed = applyTransformMatrixToCoordinate(
          matrix,
          cell.x,
          cell.y,
        );

        return {
          x: transformed.x - extents.minX,
          y: transformed.y - extents.minY,
          alive: cell.alive,
        };
      }),
    );
  }

  public applyMatrix(matrix: GridViewTransformMatrix): GridView {
    return this.applyTransform(matrix);
  }
}
