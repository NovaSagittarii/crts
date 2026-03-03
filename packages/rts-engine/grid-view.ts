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

function coordinateKey(x: number, y: number): string {
  return `${x},${y}`;
}

function assertIntegerCoordinate(value: number, axis: 'x' | 'y'): void {
  if (!Number.isInteger(value)) {
    throw new Error(`GridView ${axis} coordinate must be an integer`);
  }
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
}
