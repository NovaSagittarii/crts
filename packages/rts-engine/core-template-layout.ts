export interface PackedTemplateGrid {
  width: number;
  height: number;
  cells: Uint8Array;
}

export const CORE_TEMPLATE_ID = '__core__';
export const CORE_TEMPLATE_PADDING = 3;
export const CORE_TEMPLATE_ROWS = ['##.##', '##.##', '.....', '##.##', '##.##'];

export function parseTemplateRows(rows: readonly string[]): PackedTemplateGrid {
  if (rows.length === 0) {
    throw new Error('Template rows must not be empty');
  }

  const width = rows[0].length;
  if (width === 0) {
    throw new Error('Template rows must not be empty strings');
  }

  for (const row of rows) {
    if (row.length !== width) {
      throw new Error('Template rows must have a consistent width');
    }
  }

  const height = rows.length;
  const cells = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const symbol = rows[y][x];
      if (symbol === '#') {
        cells[y * width + x] = 1;
      } else if (symbol === '.') {
        cells[y * width + x] = 0;
      } else {
        throw new Error(`Unsupported template symbol: ${symbol}`);
      }
    }
  }

  return { width, height, cells };
}

export function padTemplateGrid(
  template: PackedTemplateGrid,
  padding: number,
): PackedTemplateGrid {
  if (!Number.isInteger(padding) || padding < 0) {
    throw new Error('Template padding must be a non-negative integer');
  }

  if (padding === 0) {
    return {
      width: template.width,
      height: template.height,
      cells: new Uint8Array(template.cells),
    };
  }

  const paddedWidth = template.width + padding * 2;
  const paddedHeight = template.height + padding * 2;
  const paddedCells = new Uint8Array(paddedWidth * paddedHeight);
  for (let i = 0; i < template.height; i += 1) {
    for (let j = 0; j < template.width; j += 1) {
      paddedCells[(i + padding) * paddedWidth + (j + padding)] =
        template.cells[i * template.width + j];
    }
  }

  return {
    width: paddedWidth,
    height: paddedHeight,
    cells: paddedCells,
  };
}

export const CORE_TEMPLATE_GRID = padTemplateGrid(
  parseTemplateRows(CORE_TEMPLATE_ROWS),
  CORE_TEMPLATE_PADDING,
);
