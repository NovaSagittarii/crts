function createGrid(width, height, fill = 0) {
  const size = width * height;
  const grid = new Uint8Array(size);
  if (fill) {
    grid.fill(1);
  }
  return grid;
}

function applyUpdates(grid, updates, width, height) {
  if (!updates || updates.length === 0) {
    return;
  }

  for (const update of updates) {
    if (!update) {
      continue;
    }

    const x = Number(update.x);
    const y = Number(update.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      continue;
    }

    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }

    const idx = y * width + x;
    grid[idx] = update.alive ? 1 : 0;
  }
}

function stepGrid(grid, width, height) {
  const next = new Uint8Array(grid.length);

  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * width;
    const yMin = Math.max(0, y - 1);
    const yMax = Math.min(height - 1, y + 1);

    for (let x = 0; x < width; x += 1) {
      const xMin = Math.max(0, x - 1);
      const xMax = Math.min(width - 1, x + 1);
      let neighbors = 0;

      for (let ny = yMin; ny <= yMax; ny += 1) {
        const neighborRow = ny * width;
        for (let nx = xMin; nx <= xMax; nx += 1) {
          if (nx === x && ny === y) {
            continue;
          }
          neighbors += grid[neighborRow + nx];
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

function encodeGridBase64(grid) {
  const byteLength = Math.ceil(grid.length / 8);
  const bytes = new Uint8Array(byteLength);

  // Pack 8 cells per byte, highest bit first.
  for (let i = 0; i < grid.length; i += 1) {
    if (!grid[i]) {
      continue;
    }

    const byteIndex = i >> 3;
    const bitIndex = i & 7;
    bytes[byteIndex] |= 1 << (7 - bitIndex);
  }

  return Buffer.from(bytes).toString('base64');
}

function decodeGridBase64(encoded, expectedLength) {
  const bytes = Buffer.from(encoded, 'base64');
  const grid = new Uint8Array(expectedLength);

  for (let i = 0; i < expectedLength; i += 1) {
    const byteIndex = i >> 3;
    if (byteIndex >= bytes.length) {
      break;
    }

    const bitIndex = i & 7;
    const mask = 1 << (7 - bitIndex);
    grid[i] = bytes[byteIndex] & mask ? 1 : 0;
  }

  return grid;
}

module.exports = {
  applyUpdates,
  createGrid,
  decodeGridBase64,
  encodeGridBase64,
  stepGrid,
};
