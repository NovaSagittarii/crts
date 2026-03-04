const GRID_VIEWPORT_MIN_WIDTH_PX = 240;
const GRID_VIEWPORT_HORIZONTAL_PADDING_PX = 32;
const GRID_CELL_MIN_SIZE_PX = 3;
const GRID_CELL_MAX_SIZE_PX = 8;

export function chooseGridCellSize(
  gridWidth: number,
  viewportWidth: number,
): number {
  if (gridWidth <= 0) {
    return GRID_CELL_MIN_SIZE_PX;
  }

  const constrainedViewportWidth = Math.max(
    GRID_VIEWPORT_MIN_WIDTH_PX,
    viewportWidth - GRID_VIEWPORT_HORIZONTAL_PADDING_PX,
  );
  const proposedCellSize = Math.floor(constrainedViewportWidth / gridWidth);
  return Math.max(
    GRID_CELL_MIN_SIZE_PX,
    Math.min(GRID_CELL_MAX_SIZE_PX, proposedCellSize),
  );
}
