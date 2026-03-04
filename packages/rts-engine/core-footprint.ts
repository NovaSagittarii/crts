const CORE_ROWS = ['##.##', '##.##', '.....', '##.##', '##.##'] as const;

function toCellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export const CORE_FOOTPRINT_ROWS = [...CORE_ROWS];

export const CORE_FOOTPRINT_PADDING = 3;

const CORE_FOOTPRINT_ALIVE_CELLS = new Set<string>();
for (let y = 0; y < CORE_ROWS.length; y += 1) {
  for (let x = 0; x < CORE_ROWS[y].length; x += 1) {
    if (CORE_ROWS[y][x] !== '#') {
      continue;
    }

    CORE_FOOTPRINT_ALIVE_CELLS.add(
      toCellKey(x + CORE_FOOTPRINT_PADDING, y + CORE_FOOTPRINT_PADDING),
    );
  }
}

export const CORE_FOOTPRINT_WIDTH =
  CORE_ROWS[0].length + CORE_FOOTPRINT_PADDING * 2;

export const CORE_FOOTPRINT_HEIGHT =
  CORE_ROWS.length + CORE_FOOTPRINT_PADDING * 2;

export function isCoreFootprintCellAlive(
  localX: number,
  localY: number,
): boolean {
  return CORE_FOOTPRINT_ALIVE_CELLS.has(toCellKey(localX, localY));
}
