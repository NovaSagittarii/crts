const GRID_VIEWPORT_MIN_WIDTH_PX = 240;
const GRID_VIEWPORT_HORIZONTAL_PADDING_PX = 32;
const GRID_VIEWPORT_MIN_HEIGHT_PX = 180;
const GRID_VIEWPORT_VERTICAL_PADDING_PX = 20;
const GRID_CELL_MIN_SIZE_PX = 3;
const GRID_CELL_MAX_SIZE_PX = 24;

export function chooseGridCellSize(
  gridWidth: number,
  gridHeight: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  if (gridWidth <= 0 || gridHeight <= 0) {
    return GRID_CELL_MIN_SIZE_PX;
  }

  const widthBudgetPx = Math.max(
    GRID_VIEWPORT_MIN_WIDTH_PX,
    viewportWidth - GRID_VIEWPORT_HORIZONTAL_PADDING_PX,
  );
  const heightBudgetPx = Math.max(
    GRID_VIEWPORT_MIN_HEIGHT_PX,
    viewportHeight - GRID_VIEWPORT_VERTICAL_PADDING_PX,
  );
  const maxCellSizeByWidth = Math.floor(widthBudgetPx / gridWidth);
  const maxCellSizeByHeight = Math.floor(heightBudgetPx / gridHeight);
  const proposedCellSize = Math.min(maxCellSizeByWidth, maxCellSizeByHeight);

  return Math.max(
    GRID_CELL_MIN_SIZE_PX,
    Math.min(GRID_CELL_MAX_SIZE_PX, proposedCellSize),
  );
}
