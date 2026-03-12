import type { Vector2 } from '#rts-engine';

export type BoardPointerCell = Vector2;

export interface PrimaryBoardPointerActionInput {
  cell: BoardPointerCell | null;
  structureHit: boolean;
  buildModeActive: boolean;
  canUseCameraControls: boolean;
}

export type PrimaryBoardPointerAction =
  | 'ignore'
  | 'queue-build'
  | 'select-structure'
  | 'start-pan';

export function resolvePrimaryBoardPointerAction(
  input: PrimaryBoardPointerActionInput,
): PrimaryBoardPointerAction {
  if (input.buildModeActive && input.cell !== null) {
    return 'queue-build';
  }

  if (input.structureHit) {
    return 'select-structure';
  }

  if (input.canUseCameraControls) {
    return 'start-pan';
  }

  return 'ignore';
}
