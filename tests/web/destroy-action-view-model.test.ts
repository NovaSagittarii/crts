import { describe, expect, test } from 'vitest';

import { deriveDestroyActionUi } from '../../apps/web/src/destroy-action-view-model.js';
import { createDestroyViewModelState } from '../../apps/web/src/destroy-view-model.js';

const OWNED_GENERATOR = {
  key: 'generator-1',
  teamId: 1,
  templateName: 'Generator',
  requiresDestroyConfirm: false,
};

const OWNED_CORE = {
  key: 'core-1',
  teamId: 1,
  templateName: 'Core',
  requiresDestroyConfirm: true,
};

const ENEMY_CORE = {
  key: 'enemy-core',
  teamId: 2,
  templateName: 'Core',
  requiresDestroyConfirm: true,
};

describe('destroy-action-view-model', () => {
  test('keeps hover-only inspection in read-only mode', () => {
    expect(
      deriveDestroyActionUi({
        canUsePinnedActions: false,
        canMutateGameplay: true,
        activeStructure: OWNED_GENERATOR,
        selectedStructure: null,
        destroyState: createDestroyViewModelState(),
        feedbackOverride: null,
      }),
    ).toMatchObject({
      selectionCopy: 'Inspecting: Generator (generator-1)',
      feedbackCopy:
        'Hover preview is read-only. Click or tap to pin for actions.',
      feedbackIsError: false,
      actionHintCopy:
        'Hover preview active. Pin this structure to unlock queue controls.',
      actionHintPending: false,
      queueButtonHidden: true,
      queueButtonDisabled: true,
      confirmPanelHidden: true,
      confirmButtonDisabled: true,
      confirmButtonText: 'Arm Confirm Destroy',
      cancelButtonDisabled: true,
    });
  });

  test('enables queue actions for pinned owned non-core structures', () => {
    const destroyState = {
      ...createDestroyViewModelState(),
      selectedKey: OWNED_GENERATOR.key,
      selectedOwned: true,
    };

    expect(
      deriveDestroyActionUi({
        canUsePinnedActions: true,
        canMutateGameplay: true,
        activeStructure: OWNED_GENERATOR,
        selectedStructure: OWNED_GENERATOR,
        destroyState,
        feedbackOverride: null,
      }),
    ).toMatchObject({
      selectionCopy: 'Pinned: Generator (generator-1)',
      feedbackCopy: 'Ready to queue destroy request for selected structure.',
      feedbackIsError: false,
      actionHintCopy: 'Pinned and owned. Destroy action is ready.',
      actionHintPending: false,
      queueButtonHidden: false,
      queueButtonDisabled: false,
      confirmPanelHidden: true,
    });
  });

  test('switches core destroy controls into explicit confirm flow', () => {
    const destroyState = {
      ...createDestroyViewModelState(),
      selectedKey: OWNED_CORE.key,
      selectedOwned: true,
      requiresConfirm: true,
      confirmArmed: true,
    };

    expect(
      deriveDestroyActionUi({
        canUsePinnedActions: true,
        canMutateGameplay: true,
        activeStructure: OWNED_CORE,
        selectedStructure: OWNED_CORE,
        destroyState,
        feedbackOverride: null,
      }),
    ).toMatchObject({
      queueButtonHidden: true,
      confirmPanelHidden: false,
      confirmButtonDisabled: false,
      confirmButtonText: 'Confirm Destroy Now',
      cancelButtonDisabled: false,
      feedbackCopy: 'Confirm destroy to submit the coordinated request.',
      actionHintCopy: 'Confirm armed. Submit destroy to queue the request.',
    });
  });

  test('reports pinned non-owned structures as an error state', () => {
    const destroyState = {
      ...createDestroyViewModelState(),
      selectedKey: ENEMY_CORE.key,
      selectedOwned: false,
      requiresConfirm: false,
    };

    expect(
      deriveDestroyActionUi({
        canUsePinnedActions: true,
        canMutateGameplay: true,
        activeStructure: ENEMY_CORE,
        selectedStructure: ENEMY_CORE,
        destroyState,
        feedbackOverride: null,
      }),
    ).toMatchObject({
      feedbackCopy: 'Destroy controls are hidden for non-owned structures.',
      feedbackIsError: true,
      actionHintCopy: 'Pinned structure is not owned by your team.',
      queueButtonDisabled: true,
      confirmPanelHidden: true,
    });
  });

  test('marks pending destroy actions with pending feedback', () => {
    const destroyState = {
      ...createDestroyViewModelState(),
      selectedKey: OWNED_GENERATOR.key,
      selectedOwned: true,
      pendingStructureKeys: [OWNED_GENERATOR.key],
    };

    expect(
      deriveDestroyActionUi({
        canUsePinnedActions: true,
        canMutateGameplay: true,
        activeStructure: OWNED_GENERATOR,
        selectedStructure: OWNED_GENERATOR,
        destroyState,
        feedbackOverride: null,
      }),
    ).toMatchObject({
      feedbackCopy:
        'Destroy pending for selected structure. You may retarget another structure.',
      actionHintCopy: 'Destroy request pending for this structure.',
      actionHintPending: true,
      queueButtonDisabled: true,
    });
  });

  test('lets feedback overrides replace derived copy and tone', () => {
    const destroyState = {
      ...createDestroyViewModelState(),
      selectedKey: OWNED_GENERATOR.key,
      selectedOwned: true,
    };

    expect(
      deriveDestroyActionUi({
        canUsePinnedActions: true,
        canMutateGameplay: true,
        activeStructure: OWNED_GENERATOR,
        selectedStructure: OWNED_GENERATOR,
        destroyState,
        feedbackOverride: {
          text: 'Destroy queue rejected by server.',
          isError: true,
        },
      }),
    ).toMatchObject({
      feedbackCopy: 'Destroy queue rejected by server.',
      feedbackIsError: true,
      actionHintCopy: 'Destroy queue rejected by server.',
      actionHintPending: false,
    });
  });
});
