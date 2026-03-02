export interface CellUpdate {
  x: number;
  y: number;
  alive: number;
}

export interface GridOptions {
  width: number;
  height: number;
  fill?: number;
}

export function createGrid({
  width,
  height,
  fill = 0,
}: GridOptions): Uint8Array {
  const size = width * height;
  const grid = new Uint8Array(size);
  if (fill) {
    grid.fill(1);
  }
  return grid;
}

export function applyUpdates(
  grid: Uint8Array,
  updates: CellUpdate[],
  width: number,
  height: number,
): void {
  if (!updates || updates.length === 0) {
    return;
  }

  for (const update of updates) {
    if (!update) continue;

    const x = Number(update.x);
    const y = Number(update.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) continue;

    if (x < 0 || y < 0 || x >= width || y >= height) continue;

    const idx = y * width + x;
    grid[idx] = update.alive ? 1 : 0;
  }
}

export function stepGrid(
  grid: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const next = new Uint8Array(grid.length);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;

    for (let x = 0; x < width; x += 1) {
      let neighbors = 0;

      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;

          const nx = (x + dx + width) % width;
          const ny = (y + dy + height) % height;
          neighbors += grid[ny * width + nx];
        }
      }

      const idx = rowOffset + x;
      const alive = grid[idx] === 1;
      if (alive) {
        if (neighbors === 2 || neighbors === 3) {
          next[idx] = 1;
        }
      } else if (neighbors === 3) {
        next[idx] = 1;
      }
    }
  }

  return next;
}

export function packGridBits(
  grid: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const cellCount = width * height;
  const packed = new Uint8Array(Math.ceil(cellCount / 8));

  for (let index = 0; index < cellCount; index += 1) {
    if (grid[index] === 0) {
      continue;
    }

    const byteIndex = index >> 3;
    const bitIndex = index & 7;
    packed[byteIndex] |= 1 << (7 - bitIndex);
  }

  return packed;
}

export function unpackGridBits(
  packed: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const cellCount = width * height;
  const unpacked = new Uint8Array(cellCount);

  for (let index = 0; index < cellCount; index += 1) {
    const byteIndex = index >> 3;
    const bitIndex = index & 7;
    const mask = 1 << (7 - bitIndex);
    unpacked[index] = packed[byteIndex] & mask ? 1 : 0;
  }

  return unpacked;
}
