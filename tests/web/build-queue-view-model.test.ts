import { readFileSync } from 'node:fs';

import type { PlacementTransformState } from '#rts-engine';
import { describe, expect, it } from 'vitest';

import {
  buildPreviewRequestFromSelection,
  deriveBuildQueueUi,
  previewMatchesSelection,
  type BuildPlacementSelection,
  type BuildQueuePreview,
  type BuildQueueUiInput,
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
  overrides: Partial<BuildQueuePreview> = {},
): BuildQueuePreview {
  return {
    affordable: true,
    needed: 6,
    current: 10,
    deficit: 0,
    templateId: 'turret',
    x: 4,
    y: 6,
    transform: createTransform(),
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

function createUiInput(
  overrides: Partial<BuildQueueUiInput> = {},
): BuildQueueUiInput {
  return {
    selectedTemplateId: 'turret',
    buildModeActive: true,
    selectedPlacement: createSelection(),
    latestBuildPreview: createPreview(),
    activeTransformOperations: [],
    previewPending: false,
    canMutateGameplay: true,
    queueFeedbackOverride: null,
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
      deriveBuildQueueUi(
        createUiInput({
          selectedPlacement: null,
          latestBuildPreview: null,
        }),
      ),
    ).toEqual({
      placementCopy: 'Template: turret. Move cursor to preview placement.',
      previewReasonCopy: 'Preview reason: move cursor to project template.',
      previewReasonIsError: false,
      queueCostCopy: 'Cost: --',
      queueCostTone: 'neutral',
      queueFeedbackCopy:
        'Move cursor over the grid to choose a build candidate.',
      queueFeedbackIsError: false,
      queueDisabled: true,
    });
  });

  it('requests template-button selection when no template is active', () => {
    expect(
      deriveBuildQueueUi(
        createUiInput({
          selectedTemplateId: null,
          buildModeActive: false,
          selectedPlacement: null,
          latestBuildPreview: null,
        }),
      ),
    ).toMatchObject({
      placementCopy:
        'Template: no selection. Click a template button to enter build mode.',
      previewReasonCopy: 'Preview reason: build mode inactive.',
      queueFeedbackCopy: 'Click a template button to enter build mode.',
      queueDisabled: true,
    });
  });

  it('shows inactive build mode copy when a template is selected but mode is off', () => {
    expect(
      deriveBuildQueueUi(
        createUiInput({
          buildModeActive: false,
          selectedPlacement: null,
          latestBuildPreview: null,
        }),
      ),
    ).toMatchObject({
      placementCopy: 'Template: turret. Build mode inactive.',
      previewReasonCopy: 'Preview reason: build mode inactive.',
      queueFeedbackCopy:
        'Build mode inactive. Click the selected template button to enter build mode.',
      queueDisabled: true,
    });
  });

  it('keeps queueing disabled while affordability preview is pending', () => {
    expect(
      deriveBuildQueueUi(
        createUiInput({
          latestBuildPreview: null,
          previewPending: true,
        }),
      ),
    ).toMatchObject({
      queueFeedbackCopy: 'Recalculating affordability...',
      queueDisabled: true,
    });
  });

  it('surfaces deficit feedback for unaffordable placements', () => {
    expect(
      deriveBuildQueueUi(
        createUiInput({
          latestBuildPreview: createPreview({
            affordable: false,
            current: 3,
            deficit: 4,
            needed: 7,
            reason: 'insufficient-resources',
          }),
        }),
      ),
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
      deriveBuildQueueUi(
        createUiInput({
          canMutateGameplay: false,
        }),
      ),
    ).toMatchObject({
      queueFeedbackCopy:
        'Queue action is read-only until you are an active, non-defeated player.',
      queueDisabled: true,
    });
  });

  it('describes non-deficit placement rejections', () => {
    expect(
      deriveBuildQueueUi(
        createUiInput({
          latestBuildPreview: createPreview({
            affordable: false,
            current: 10,
            deficit: 0,
            needed: 6,
            reason: 'outside-territory',
          }),
        }),
      ),
    ).toMatchObject({
      previewReasonCopy: 'Preview reason: outside build zone',
      queueFeedbackCopy: 'Cannot queue here: outside build zone.',
      queueFeedbackIsError: true,
      queueDisabled: true,
    });
  });

  it('treats stale previews as unavailable for the active placement', () => {
    expect(
      deriveBuildQueueUi(
        createUiInput({
          selectedPlacement: createSelection({ x: 12 }),
        }),
      ),
    ).toMatchObject({
      previewReasonCopy: 'Preview reason: awaiting local preview.',
      queueCostCopy: 'Cost: --',
      queueFeedbackCopy: 'Preview unavailable. Move cursor to refresh.',
      queueDisabled: true,
    });
  });

  it('enables queueing for affordable active placements', () => {
    expect(deriveBuildQueueUi(createUiInput())).toMatchObject({
      placementCopy: 'Placement: (4, 6) for turret. Click grid to queue build.',
      previewReasonCopy: 'Preview reason: legal placement',
      previewReasonIsError: false,
      queueCostCopy: 'Cost: 6 | Current: 10',
      queueCostTone: 'affordable',
      queueFeedbackCopy:
        'Ready: click grid to queue build (need 6, current 10).',
      queueFeedbackIsError: false,
      queueDisabled: false,
    });
  });

  it('lets queue feedback overrides replace derived affordability feedback', () => {
    expect(
      deriveBuildQueueUi(
        createUiInput({
          queueFeedbackOverride: {
            text: 'Queued build #12 for execution.',
            isError: false,
          },
        }),
      ),
    ).toMatchObject({
      queueFeedbackCopy: 'Queued build #12 for execution.',
      queueFeedbackIsError: false,
      queueDisabled: false,
    });
  });
});

describe('match ui build controls', () => {
  it('uses template button menu and build mode ids', () => {
    const markup = readFileSync(
      new URL('../../apps/web/index.html', import.meta.url),
      'utf8',
    );

    expect(markup).toContain('id="template-button-menu"');
    expect(markup).toContain('id="exit-build-mode"');
    expect(markup).not.toContain('id="template-select"');
  });
});
