import { describe, expect, test } from 'vitest';

import {
  armDestroyConfirm,
  canQueueDestroy,
  createDestroyViewModelState,
  registerDestroyOutcome,
  registerDestroyQueued,
  selectDestroyStructure,
} from '../../apps/web/src/destroy-view-model.js';

describe('destroy-view-model helpers', () => {
  test('shows queue eligibility only for owned selected structures', () => {
    const ownedSelection = {
      key: 'owned-1',
      teamId: 1,
      templateName: 'Block 2x2',
      requiresDestroyConfirm: false,
    };
    const enemySelection = {
      key: 'enemy-1',
      teamId: 2,
      templateName: 'Core',
      requiresDestroyConfirm: true,
    };

    const ownedState = selectDestroyStructure(
      createDestroyViewModelState(),
      ownedSelection,
      1,
    );
    expect(ownedState.selectedOwned).toBe(true);
    expect(canQueueDestroy(ownedState)).toBe(true);

    const enemyState = selectDestroyStructure(ownedState, enemySelection, 1);
    expect(enemyState.selectedOwned).toBe(false);
    expect(canQueueDestroy(enemyState)).toBe(false);
  });

  test('requires explicit confirmation for confirmation-gated structures', () => {
    const coreSelection = {
      key: 'core-1',
      teamId: 1,
      templateName: 'Core',
      requiresDestroyConfirm: true,
    };

    const selected = selectDestroyStructure(
      createDestroyViewModelState(),
      coreSelection,
      1,
    );
    expect(selected.requiresConfirm).toBe(true);
    expect(canQueueDestroy(selected)).toBe(false);

    const confirmed = armDestroyConfirm(selected);
    expect(confirmed.confirmArmed).toBe(true);
    expect(canQueueDestroy(confirmed)).toBe(true);
  });

  test('keeps pending destroy keys idempotent for duplicate queue acks', () => {
    const selected = selectDestroyStructure(
      createDestroyViewModelState(),
      {
        key: 'structure-1',
        teamId: 1,
        templateName: 'Block 2x2',
        requiresDestroyConfirm: false,
      },
      1,
    );

    const onceQueued = registerDestroyQueued(selected, 'structure-1');
    const duplicateQueued = registerDestroyQueued(onceQueued, 'structure-1');

    expect(duplicateQueued.pendingStructureKeys).toEqual(['structure-1']);
  });

  test('clears selected structure after successful destroy outcome', () => {
    const selected = selectDestroyStructure(
      createDestroyViewModelState(),
      {
        key: 'structure-7',
        teamId: 1,
        templateName: 'Generator',
        requiresDestroyConfirm: false,
      },
      1,
    );
    const pending = registerDestroyQueued(selected, 'structure-7');

    const resolved = registerDestroyOutcome(pending, {
      structureKey: 'structure-7',
      outcome: 'destroyed',
    });

    expect(resolved.selectedKey).toBeNull();
    expect(resolved.pendingStructureKeys).toEqual([]);
  });
});
