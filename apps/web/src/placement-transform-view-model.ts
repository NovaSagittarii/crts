import {
  type PlacementTransformInput,
  type PlacementTransformOperation,
  type PlacementTransformState,
  normalizePlacementTransform,
} from '#rts-engine';

export interface PlacementTransformViewState {
  operations: PlacementTransformOperation[];
  normalized: PlacementTransformState;
  revision: number;
}

function toViewState(
  operations: PlacementTransformOperation[],
  revision: number,
): PlacementTransformViewState {
  return {
    operations,
    normalized: normalizePlacementTransform({ operations }),
    revision,
  };
}

export function createPlacementTransformViewState(): PlacementTransformViewState {
  return toViewState([], 0);
}

export function applyPlacementTransformOperation(
  state: PlacementTransformViewState,
  operation: PlacementTransformOperation,
): PlacementTransformViewState {
  return toViewState([...state.operations, operation], state.revision + 1);
}

export function resetPlacementTransformViewState(
  state: PlacementTransformViewState,
): PlacementTransformViewState {
  return toViewState([], state.revision + 1);
}

export function toPlacementTransformInput(
  state: PlacementTransformViewState,
): PlacementTransformInput {
  return {
    operations: [...state.operations],
  };
}

function isIdentityTransform(state: PlacementTransformState): boolean {
  return (
    state.matrix.xx === 1 &&
    state.matrix.xy === 0 &&
    state.matrix.yx === 0 &&
    state.matrix.yy === 1
  );
}

function getOperationLabel(operation: PlacementTransformOperation): string {
  if (operation === 'rotate') {
    return 'R';
  }
  if (operation === 'mirror-horizontal') {
    return 'MH';
  }
  return 'MV';
}

export function formatPlacementTransformIndicator(
  state: PlacementTransformViewState,
): string {
  if (state.operations.length === 0) {
    return 'Transform: default orientation (0deg).';
  }

  const history = state.operations.map(getOperationLabel).join(' > ');
  const matrix = state.normalized.matrix;
  const netLabel = isIdentityTransform(state.normalized)
    ? 'net no-op'
    : 'net transformed';

  return `Transform #${state.revision}: ${history} | ${netLabel} [${matrix.xx},${matrix.xy}; ${matrix.yx},${matrix.yy}]`;
}
