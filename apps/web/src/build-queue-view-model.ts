import type {
  BuildRejectionReason,
  PlacementTransformInput,
  PlacementTransformOperation,
  PlacementTransformState,
} from '#rts-engine';

import type { UiFeedbackMessage } from './ui-feedback-message.js';

export interface BuildQueuePreview {
  templateId: string;
  x: number;
  y: number;
  transform: PlacementTransformState;
  reason?: BuildRejectionReason;
  affordable: boolean;
  needed: number;
  current: number;
  deficit: number;
}

type BuildPreviewReason = BuildQueuePreview['reason'];

export interface BuildPlacementSelection {
  templateId: string;
  x: number;
  y: number;
}

export type BuildQueueFeedbackOverride = UiFeedbackMessage;

export interface BuildQueueUiInput {
  selectedTemplateId: string | null;
  buildModeActive: boolean;
  selectedPlacement: BuildPlacementSelection | null;
  latestBuildPreview: BuildQueuePreview | null;
  activeTransformOperations: readonly PlacementTransformOperation[];
  previewPending: boolean;
  canMutateGameplay: boolean;
  queueFeedbackOverride: BuildQueueFeedbackOverride | null;
}

export type BuildQueueCostTone = 'neutral' | 'affordable' | 'blocked';

export interface BuildQueueUiState {
  placementCopy: string;
  previewReasonCopy: string;
  previewReasonIsError: boolean;
  queueCostCopy: string;
  queueCostTone: BuildQueueCostTone;
  queueFeedbackCopy: string;
  queueFeedbackIsError: boolean;
  queueDisabled: boolean;
}

export function describeBuildFailureReason(reason: BuildPreviewReason): string {
  if (reason === 'outside-territory') {
    return 'outside build zone';
  }
  if (reason === 'occupied-site') {
    return 'occupied site';
  }
  if (reason === 'template-exceeds-map-size') {
    return 'template exceeds map size';
  }
  if (reason === 'unknown-template') {
    return 'unknown template';
  }
  if (reason === 'invalid-coordinates') {
    return 'invalid coordinates';
  }
  if (reason === 'invalid-delay') {
    return 'invalid delay';
  }
  if (reason === 'team-defeated') {
    return 'team defeated';
  }
  if (reason === 'match-finished') {
    return 'match finished';
  }
  if (reason === 'template-compare-failed') {
    return 'template compare failed';
  }
  if (reason === 'apply-failed') {
    return 'apply failed';
  }
  if (reason === 'insufficient-resources') {
    return 'insufficient resources';
  }
  return 'validation failed';
}

function describePreviewReason(reason: BuildPreviewReason): string {
  if (!reason) {
    return 'Preview reason: legal placement';
  }

  return `Preview reason: ${describeBuildFailureReason(reason)}`;
}

export function formatDeficitCopy(
  needed: number,
  current: number,
  deficit: number,
): string {
  return `Need ${needed}, current ${current} (deficit ${deficit}).`;
}

export function buildPreviewRequestFromSelection(
  selectedPlacement: BuildPlacementSelection | null,
  transform: PlacementTransformInput,
): {
  templateId: string;
  x: number;
  y: number;
  transform: PlacementTransformInput;
} | null {
  if (!selectedPlacement) {
    return null;
  }

  return {
    templateId: selectedPlacement.templateId,
    x: selectedPlacement.x,
    y: selectedPlacement.y,
    transform,
  };
}

export function previewMatchesSelection(
  preview: BuildQueuePreview | null,
  selectedPlacement: BuildPlacementSelection | null,
  activeTransformOperations: readonly PlacementTransformOperation[],
): boolean {
  if (!preview || !selectedPlacement) {
    return false;
  }

  if (
    preview.templateId !== selectedPlacement.templateId ||
    preview.x !== selectedPlacement.x ||
    preview.y !== selectedPlacement.y
  ) {
    return false;
  }

  const previewOperations = preview.transform.operations ?? [];
  if (previewOperations.length !== activeTransformOperations.length) {
    return false;
  }

  return previewOperations.every(
    (operation, index) => operation === activeTransformOperations[index],
  );
}

export function deriveBuildQueueUi(
  input: BuildQueueUiInput,
): BuildQueueUiState {
  const activePreview = previewMatchesSelection(
    input.latestBuildPreview,
    input.selectedPlacement,
    input.activeTransformOperations,
  )
    ? input.latestBuildPreview
    : null;

  let queueCostCopy = 'Cost: --';
  let queueCostTone: BuildQueueCostTone = 'neutral';
  if (activePreview) {
    queueCostCopy = `Cost: ${activePreview.needed} | Current: ${activePreview.current}`;
    queueCostTone = activePreview.affordable ? 'affordable' : 'blocked';
  }

  let queueFeedbackCopy =
    'Queue action is disabled until local placement preview is available.';
  let queueFeedbackIsError = false;
  let queueDisabled = true;

  const placementCopy = !input.selectedTemplateId
    ? 'Template: no selection. Click a template button to enter build mode.'
    : !input.buildModeActive
      ? `Template: ${input.selectedTemplateId}. Build mode inactive.`
      : input.selectedPlacement
        ? `Placement: (${input.selectedPlacement.x}, ${input.selectedPlacement.y}) for ${input.selectedPlacement.templateId}. Click grid to queue build.`
        : `Template: ${input.selectedTemplateId}. Move cursor to preview placement.`;

  const previewReasonCopy = activePreview
    ? describePreviewReason(activePreview.reason)
    : !input.buildModeActive
      ? 'Preview reason: build mode inactive.'
      : input.selectedPlacement
        ? 'Preview reason: awaiting local preview.'
        : 'Preview reason: move cursor to project template.';

  const previewReasonIsError = Boolean(activePreview?.reason);

  if (!input.canMutateGameplay) {
    queueFeedbackCopy =
      'Queue action is read-only until you are an active, non-defeated player.';
  } else if (!input.selectedTemplateId) {
    queueFeedbackCopy = 'Click a template button to enter build mode.';
  } else if (!input.buildModeActive) {
    queueFeedbackCopy =
      'Build mode inactive. Click the selected template button to enter build mode.';
  } else if (!input.selectedPlacement) {
    queueFeedbackCopy =
      'Move cursor over the grid to choose a build candidate.';
  } else if (input.previewPending) {
    queueFeedbackCopy = 'Recalculating affordability...';
  } else if (!activePreview) {
    queueFeedbackCopy = 'Preview unavailable. Move cursor to refresh.';
  } else if (!activePreview.affordable) {
    queueFeedbackCopy =
      activePreview.deficit > 0
        ? formatDeficitCopy(
            activePreview.needed,
            activePreview.current,
            activePreview.deficit,
          )
        : `Cannot queue here: ${describeBuildFailureReason(activePreview.reason)}.`;
    queueFeedbackIsError = true;
  } else {
    queueFeedbackCopy = `Ready: click grid to queue build (need ${activePreview.needed}, current ${activePreview.current}).`;
    queueDisabled = false;
  }

  if (input.queueFeedbackOverride) {
    queueFeedbackCopy = input.queueFeedbackOverride.text;
    queueFeedbackIsError = input.queueFeedbackOverride.isError;
  }

  return {
    placementCopy,
    previewReasonCopy,
    previewReasonIsError,
    queueCostCopy,
    queueCostTone,
    queueFeedbackCopy,
    queueFeedbackIsError,
    queueDisabled,
  };
}
