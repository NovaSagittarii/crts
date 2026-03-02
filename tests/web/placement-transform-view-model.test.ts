import { describe, expect, test } from 'vitest';

import {
  applyPlacementTransformOperation,
  createPlacementTransformViewState,
  formatPlacementTransformIndicator,
  resetPlacementTransformViewState,
  toPlacementTransformInput,
} from '../../apps/web/src/placement-transform-view-model.js';

describe('placement-transform-view-model helpers', () => {
  test('applies rotate operations and cycles net orientation every four steps', () => {
    let state = createPlacementTransformViewState();
    for (let step = 0; step < 4; step += 1) {
      state = applyPlacementTransformOperation(state, 'rotate');
    }

    expect(state.revision).toBe(4);
    expect(state.operations).toEqual(['rotate', 'rotate', 'rotate', 'rotate']);
    expect(state.normalized.matrix.xx).toBe(1);
    expect(state.normalized.matrix.yy).toBe(1);
    expect(Math.abs(state.normalized.matrix.xy)).toBe(0);
    expect(Math.abs(state.normalized.matrix.yx)).toBe(0);
    expect(formatPlacementTransformIndicator(state)).toContain('net no-op');
  });

  test('keeps composition order-sensitive across rotate and mirror operations', () => {
    const rotateThenMirror = applyPlacementTransformOperation(
      applyPlacementTransformOperation(
        createPlacementTransformViewState(),
        'rotate',
      ),
      'mirror-horizontal',
    );
    const mirrorThenRotate = applyPlacementTransformOperation(
      applyPlacementTransformOperation(
        createPlacementTransformViewState(),
        'mirror-horizontal',
      ),
      'rotate',
    );

    expect(rotateThenMirror.normalized.matrix).not.toEqual(
      mirrorThenRotate.normalized.matrix,
    );
  });

  test('resets transform operations without losing revision monotonicity', () => {
    const transformed = applyPlacementTransformOperation(
      createPlacementTransformViewState(),
      'mirror-vertical',
    );
    const reset = resetPlacementTransformViewState(transformed);

    expect(reset.operations).toEqual([]);
    expect(reset.revision).toBe(transformed.revision + 1);
    expect(toPlacementTransformInput(reset)).toEqual({ operations: [] });
  });
});
