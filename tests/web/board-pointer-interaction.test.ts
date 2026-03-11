import { describe, expect, it } from 'vitest';

import {
  type PrimaryBoardPointerActionInput,
  resolvePrimaryBoardPointerAction,
} from '../../apps/web/src/board-pointer-interaction.js';

function createInput(
  overrides: Partial<PrimaryBoardPointerActionInput> = {},
): PrimaryBoardPointerActionInput {
  return {
    cell: { x: 12, y: 8 },
    structureHit: false,
    buildModeActive: false,
    canUseCameraControls: true,
    ...overrides,
  };
}

describe('board pointer interaction', () => {
  it('queues builds before other primary actions when build mode is active', () => {
    expect(
      resolvePrimaryBoardPointerAction(
        createInput({
          buildModeActive: true,
          structureHit: true,
        }),
      ),
    ).toBe('queue-build');
  });

  it('pins structures when primary-down lands on a structure outside build mode', () => {
    expect(
      resolvePrimaryBoardPointerAction(
        createInput({
          structureHit: true,
        }),
      ),
    ).toBe('select-structure');
  });

  it('starts panning from an empty in-bounds cell when camera controls are available', () => {
    expect(
      resolvePrimaryBoardPointerAction(
        createInput({
          structureHit: false,
        }),
      ),
    ).toBe('start-pan');
  });

  it('starts panning from empty off-grid space when camera controls are available', () => {
    expect(
      resolvePrimaryBoardPointerAction(
        createInput({
          cell: null,
        }),
      ),
    ).toBe('start-pan');
  });

  it('still starts panning from off-grid space while build mode is active', () => {
    expect(
      resolvePrimaryBoardPointerAction(
        createInput({
          cell: null,
          buildModeActive: true,
        }),
      ),
    ).toBe('start-pan');
  });

  it('ignores empty primary-down input when camera controls are unavailable', () => {
    expect(
      resolvePrimaryBoardPointerAction(
        createInput({
          cell: null,
          canUseCameraControls: false,
        }),
      ),
    ).toBe('ignore');
  });
});
