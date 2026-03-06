import { readFileSync } from 'node:fs';

import type {
  BuildPreviewPayload,
  PlacementBounds,
  PlacementTransformState,
} from '#rts-engine';
import { describe, expect, it } from 'vitest';

import {
  buildPreviewRequestFromSelection,
  deriveBuildQueueUi,
  previewMatchesSelection,
  type BuildPlacementSelection,
} from '../../apps/web/src/build-queue-view-model.js';

function createSelection(
  overrides: Partial<BuildPlacementSelection> = {},
): BuildPlacementSelection {
  return {
    templateId: 'turret',
    x: 4,
    y: 6,
    ...overrides,
  };
}

function createPreview(
  overrides: Partial<BuildPreviewPayload> = {},
): BuildPreviewPayload {
  return {
    affordable: true,
    needed: 6,
    current: 10,
    deficit: 0,
    roomId: 'room-1',
    teamId: 1,
    templateId: 'turret',
    x: 4,
    y: 6,
    transform: createTransform(),
    footprint: [],
    illegalCells: [],
    bounds: createBounds(),
    ...overrides,
  };
}

function createTransform(
  operations: PlacementTransformState['operations'] = [],
): PlacementTransformState {
  return {
    operations: [...operations],
    matrix: {
      xx: 1,
      xy: 0,
      yx: 0,
      yy: 1,
    },
  };
}

function createBounds(
  overrides: Partial<PlacementBounds> = {},
): PlacementBounds {
  return {
    x: 4,
    y: 6,
    width: 2,
    height: 2,
    ...overrides,
  };
}

describe('build queue view model helpers', () => {
  it('builds preview requests from the selected placement', () => {
    expect(
      buildPreviewRequestFromSelection(createSelection(), {
        operations: ['rotate', 'mirror-horizontal'],
      }),
    ).toEqual({
      templateId: 'turret',
      x: 4,
      y: 6,
      transform: {
        operations: ['rotate', 'mirror-horizontal'],
      },
    });
  });

  it('matches previews only when placement and transform revision align', () => {
    expect(
      previewMatchesSelection(createPreview(), createSelection(), ['rotate']),
    ).toBe(false);

    expect(
      previewMatchesSelection(
        createPreview({
          transform: createTransform(['rotate']),
        }),
        createSelection(),
        ['rotate'],
      ),
    ).toBe(true);
  });

  it('prompts for a placement when nothing is selected', () => {
    expect(
      deriveBuildQueueUi({
        selectedPlacement: null,
        latestBuildPreview: null,
        activeTransformOperations: [],
        previewPending: false,
        canMutateGameplay: true,
        queueFeedbackOverride: null,
      }),
    ).toEqual({
      placementCopy: 'Select a build placement to calculate affordability.',
      previewReasonCopy: 'Preview reason: awaiting local preview.',
      previewReasonIsError: false,
      queueCostCopy: 'Cost: --',
      queueCostTone: 'neutral',
      queueFeedbackCopy: 'Select a build placement to calculate affordability.',
      queueFeedbackIsError: false,
      queueDisabled: true,
    });
  });

  it('keeps queueing disabled while affordability preview is pending', () => {
    expect(
      deriveBuildQueueUi({
        selectedPlacement: createSelection(),
        latestBuildPreview: null,
        activeTransformOperations: [],
        previewPending: true,
        canMutateGameplay: true,
        queueFeedbackOverride: null,
      }),
    ).toMatchObject({
      queueFeedbackCopy: 'Recalculating affordability...',
      queueDisabled: true,
    });
  });

  it('surfaces deficit feedback for unaffordable placements', () => {
    expect(
      deriveBuildQueueUi({
        selectedPlacement: createSelection(),
        latestBuildPreview: createPreview({
          affordable: false,
          current: 3,
          deficit: 4,
          needed: 7,
          reason: 'insufficient-resources',
        }),
        activeTransformOperations: [],
        previewPending: false,
        canMutateGameplay: true,
        queueFeedbackOverride: null,
      }),
    ).toMatchObject({
      previewReasonCopy: 'Preview reason: insufficient resources',
      queueCostTone: 'blocked',
      queueFeedbackCopy: 'Need 7, current 3 (deficit 4).',
      queueFeedbackIsError: true,
      queueDisabled: true,
    });
  });

  it('surfaces read-only feedback when gameplay mutation is disabled', () => {
    expect(
      deriveBuildQueueUi({
        selectedPlacement: createSelection(),
        latestBuildPreview: createPreview(),
        activeTransformOperations: [],
        previewPending: false,
        canMutateGameplay: false,
        queueFeedbackOverride: null,
      }),
    ).toMatchObject({
      queueFeedbackCopy:
        'Queue action is read-only until you are an active, non-defeated player.',
      queueDisabled: true,
    });
  });

  it('describes non-deficit placement rejections', () => {
    expect(
      deriveBuildQueueUi({
        selectedPlacement: createSelection(),
        latestBuildPreview: createPreview({
          affordable: false,
          current: 10,
          deficit: 0,
          needed: 6,
          reason: 'outside-territory',
        }),
        activeTransformOperations: [],
        previewPending: false,
        canMutateGameplay: true,
        queueFeedbackOverride: null,
      }),
    ).toMatchObject({
      previewReasonCopy: 'Preview reason: outside build zone',
      queueFeedbackCopy: 'Cannot queue here: outside build zone.',
      queueFeedbackIsError: true,
      queueDisabled: true,
    });
  });

  it('treats stale previews as unavailable for the active placement', () => {
    expect(
      deriveBuildQueueUi({
        selectedPlacement: createSelection({ x: 12 }),
        latestBuildPreview: createPreview(),
        activeTransformOperations: [],
        previewPending: false,
        canMutateGameplay: true,
        queueFeedbackOverride: null,
      }),
    ).toMatchObject({
      previewReasonCopy: 'Preview reason: awaiting local preview.',
      queueCostCopy: 'Cost: --',
      queueFeedbackCopy: 'Preview unavailable. Select the placement again.',
      queueDisabled: true,
    });
  });

  it('enables queueing for affordable active placements', () => {
    expect(
      deriveBuildQueueUi({
        selectedPlacement: createSelection(),
        latestBuildPreview: createPreview(),
        activeTransformOperations: [],
        previewPending: false,
        canMutateGameplay: true,
        queueFeedbackOverride: null,
      }),
    ).toMatchObject({
      placementCopy: 'Placement: (4, 6) for turret.',
      previewReasonCopy: 'Preview reason: legal placement',
      previewReasonIsError: false,
      queueCostCopy: 'Cost: 6 | Current: 10',
      queueCostTone: 'affordable',
      queueFeedbackCopy: 'Affordable: need 6, current 10.',
      queueFeedbackIsError: false,
      queueDisabled: false,
    });
  });

  it('lets queue feedback overrides replace derived affordability feedback', () => {
    expect(
      deriveBuildQueueUi({
        selectedPlacement: createSelection(),
        latestBuildPreview: createPreview(),
        activeTransformOperations: [],
        previewPending: false,
        canMutateGameplay: true,
        queueFeedbackOverride: {
          text: 'Queued build #12 for execution.',
          isError: false,
        },
      }),
    ).toMatchObject({
      queueFeedbackCopy: 'Queued build #12 for execution.',
      queueFeedbackIsError: false,
      queueDisabled: false,
    });
  });
});

describe('match ui build controls', () => {
  it('uses placement-specific control ids', () => {
    const markup = readFileSync(
      new URL('../../apps/web/index.html', import.meta.url),
      'utf8',
    );

    expect(markup).toContain('id="clear-build-placement"');
    expect(markup).not.toContain('cancel-build-mode');
  });
});
