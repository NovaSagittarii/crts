export type GridTopology = 'torus' | 'flat';

export interface Vector2 {
  x: number;
  y: number;
}

export interface GridCell extends Vector2 {
  alive: number;
}

type PackedGridInput = ArrayBuffer | Uint8Array;

function assertValidDimension(value: number, name: 'width' | 'height'): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Grid ${name} must be a positive integer.`);
  }
}

function wrapCoordinate(value: number, size: number): number {
  const wrapped = value % size;
  return wrapped >= 0 ? wrapped : wrapped + size;
}

export class Grid {
  public readonly width: number;

  public readonly height: number;

  public readonly topology: GridTopology;

  private grid: Uint8Array;

  private scratch: Uint8Array;

  public constructor(
    width: number,
    height: number,
    aliveCells: readonly Vector2[] = [],
    topology: GridTopology = 'torus',
  ) {
    assertValidDimension(width, 'width');
    assertValidDimension(height, 'height');

    if (topology !== 'torus' && topology !== 'flat') {
      throw new Error('Grid topology must be either "torus" or "flat".');
    }

    this.width = width;
    this.height = height;
    this.topology = topology;
    this.grid = new Uint8Array(width * height);
    this.scratch = new Uint8Array(this.grid.length);

    for (const cell of aliveCells) {
      if (!cell) {
        continue;
      }

      this.setCell(cell.x, cell.y, 1);
    }
  }

  public step(): void {
    const next = this.scratch;
    next.fill(0);

    if (this.topology === 'torus') {
      this.stepTorus(next);
    } else {
      this.stepFlat(next);
    }

    this.scratch = this.grid;
    this.grid = next;
  }

  public clone(): Grid {
    const cloned = new Grid(this.width, this.height, [], this.topology);
    cloned.grid.set(this.grid);
    return cloned;
  }

  public toPacked(): ArrayBuffer {
    const packed = new Uint8Array(Math.ceil(this.grid.length / 8));

    for (let index = 0; index < this.grid.length; index += 1) {
      if (this.grid[index] === 0) {
        continue;
      }

      const byteIndex = index >> 3;
      const bitIndex = index & 7;
      packed[byteIndex] |= 1 << (7 - bitIndex);
    }

    return packed.buffer;
  }

  public static fromPacked(
    packed: PackedGridInput,
    width: number,
    height: number,
    topology: GridTopology = 'torus',
  ): Grid {
    const instance = new Grid(width, height, [], topology);
    const view = packed instanceof Uint8Array ? packed : new Uint8Array(packed);

    for (let index = 0; index < instance.grid.length; index += 1) {
      const byteIndex = index >> 3;
      const bitIndex = index & 7;
      const mask = 1 << (7 - bitIndex);
      instance.grid[index] = view[byteIndex] & mask ? 1 : 0;
    }

    return instance;
  }

  public apply(source: Grid, offset: Vector2): void {
    const sourceCells = source === this ? source.grid.slice() : source.grid;

    for (let y = 0; y < source.height; y += 1) {
      const sourceRowOffset = y * source.width;

      for (let x = 0; x < source.width; x += 1) {
        const destinationIndex = this.resolveIndex(offset.x + x, offset.y + y);
        if (destinationIndex < 0) {
          continue;
        }

        this.grid[destinationIndex] = sourceCells[sourceRowOffset + x];
      }
    }
  }

  public compare(source: Grid, offset: Vector2): number {
    let mismatches = 0;

    for (let y = 0; y < source.height; y += 1) {
      const sourceRowOffset = y * source.width;

      for (let x = 0; x < source.width; x += 1) {
        const destinationIndex = this.resolveIndex(offset.x + x, offset.y + y);
        if (destinationIndex < 0) {
          continue;
        }

        if (this.grid[destinationIndex] !== source.grid[sourceRowOffset + x]) {
          mismatches += 1;
        }
      }
    }

    return mismatches;
  }

  public setCell(x: number, y: number, alive: number | boolean): void {
    const index = this.resolveIndex(x, y);
    if (index < 0) {
      return;
    }

    this.grid[index] = alive ? 1 : 0;
  }

  public isCellAlive(x: number, y: number): boolean {
    const index = this.resolveIndex(x, y);
    return index >= 0 && this.grid[index] === 1;
  }

  public *cells(): IterableIterator<GridCell> {
    for (let y = 0; y < this.height; y += 1) {
      const rowOffset = y * this.width;

      for (let x = 0; x < this.width; x += 1) {
        yield { x, y, alive: this.grid[rowOffset + x] };
      }
    }
  }

  private stepTorus(next: Uint8Array): void {
    for (let y = 0; y < this.height; y += 1) {
      const rowOffset = y * this.width;
      const prevRowOffset = (y === 0 ? this.height - 1 : y - 1) * this.width;
      const nextRowOffset = (y === this.height - 1 ? 0 : y + 1) * this.width;

      for (let x = 0; x < this.width; x += 1) {
        const prevX = x === 0 ? this.width - 1 : x - 1;
        const nextX = x === this.width - 1 ? 0 : x + 1;

        const neighbors =
          this.grid[prevRowOffset + prevX] +
          this.grid[prevRowOffset + x] +
          this.grid[prevRowOffset + nextX] +
          this.grid[rowOffset + prevX] +
          this.grid[rowOffset + nextX] +
          this.grid[nextRowOffset + prevX] +
          this.grid[nextRowOffset + x] +
          this.grid[nextRowOffset + nextX];

        const index = rowOffset + x;
        const alive = this.grid[index] === 1;
        next[index] = alive
          ? neighbors === 2 || neighbors === 3
            ? 1
            : 0
          : neighbors === 3
            ? 1
            : 0;
      }
    }
  }

  private stepFlat(next: Uint8Array): void {
    for (let y = 0; y < this.height; y += 1) {
      const minY = y === 0 ? 0 : y - 1;
      const maxY = y === this.height - 1 ? this.height - 1 : y + 1;
      const rowOffset = y * this.width;

      for (let x = 0; x < this.width; x += 1) {
        const minX = x === 0 ? 0 : x - 1;
        const maxX = x === this.width - 1 ? this.width - 1 : x + 1;
        let neighbors = 0;

        for (let ny = minY; ny <= maxY; ny += 1) {
          const neighborRowOffset = ny * this.width;

          for (let nx = minX; nx <= maxX; nx += 1) {
            if (nx === x && ny === y) {
              continue;
            }

            neighbors += this.grid[neighborRowOffset + nx];
          }
        }

        const index = rowOffset + x;
        const alive = this.grid[index] === 1;
        next[index] = alive
          ? neighbors === 2 || neighbors === 3
            ? 1
            : 0
          : neighbors === 3
            ? 1
            : 0;
      }
    }
  }

  private resolveIndex(x: number, y: number): number {
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return -1;
    }

    if (this.topology === 'torus') {
      const wrappedX = wrapCoordinate(x, this.width);
      const wrappedY = wrapCoordinate(y, this.height);
      return wrappedY * this.width + wrappedX;
    }

    if (x < 0 || y < 0 || x >= this.width || y >= this.height) {
      return -1;
    }

    return y * this.width + x;
  }
}
