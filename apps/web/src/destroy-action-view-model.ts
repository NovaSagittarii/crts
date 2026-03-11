import type {
  DestroySelectableStructure,
  DestroyViewModelState,
} from './destroy-view-model.js';

export interface DestroyActionFeedbackOverride {
  text: string;
  isError: boolean;
}

export interface DestroyActionUiInput {
  canUsePinnedActions: boolean;
  canMutateGameplay: boolean;
  activeStructure: DestroySelectableStructure | null;
  selectedStructure: DestroySelectableStructure | null;
  destroyState: DestroyViewModelState;
  feedbackOverride: DestroyActionFeedbackOverride | null;
}

export interface DestroyActionUi {
  selectionCopy: string;
  feedbackCopy: string;
  feedbackIsError: boolean;
  actionHintCopy: string;
  actionHintPending: boolean;
  queueButtonHidden: boolean;
  queueButtonDisabled: boolean;
  confirmPanelHidden: boolean;
  confirmButtonDisabled: boolean;
  confirmButtonText: string;
  cancelButtonDisabled: boolean;
}

export function deriveDestroyActionUi(
  input: DestroyActionUiInput,
): DestroyActionUi {
  const {
    activeStructure,
    canMutateGameplay,
    canUsePinnedActions,
    destroyState,
    feedbackOverride,
    selectedStructure,
  } = input;

  let selectionCopy = activeStructure
    ? `Inspecting: ${activeStructure.templateName} (${activeStructure.key})`
    : 'Select a structure on the board to enable destroy actions.';
  if (selectedStructure && canUsePinnedActions) {
    selectionCopy = `Pinned: ${selectedStructure.templateName} (${selectedStructure.key})`;
  }

  let feedbackCopy = 'Pin an owned structure to enable destroy actions.';
  let feedbackIsError = false;
  let actionHintCopy = 'Pin an owned structure to queue destroy actions.';
  let actionHintPending = false;
  let queueButtonHidden = false;
  let queueButtonDisabled = true;
  let confirmPanelHidden = true;
  let confirmButtonDisabled = true;
  let confirmButtonText = 'Arm Confirm Destroy';
  let cancelButtonDisabled = true;

  if (!canUsePinnedActions) {
    queueButtonHidden = true;

    if (activeStructure) {
      feedbackCopy =
        'Hover preview is read-only. Click or tap to pin for actions.';
      actionHintCopy =
        'Hover preview active. Pin this structure to unlock queue controls.';
    } else {
      feedbackCopy = 'Hover or pin a structure to inspect destroy options.';
    }

    if (feedbackOverride) {
      feedbackCopy = feedbackOverride.text;
      feedbackIsError = feedbackOverride.isError;
    }

    return {
      selectionCopy,
      feedbackCopy,
      feedbackIsError,
      actionHintCopy,
      actionHintPending,
      queueButtonHidden,
      queueButtonDisabled,
      confirmPanelHidden,
      confirmButtonDisabled,
      confirmButtonText,
      cancelButtonDisabled,
    };
  }

  if (!canMutateGameplay) {
    feedbackCopy =
      'Destroy action is read-only until you are an active, non-defeated player.';
    actionHintCopy =
      'Pinned in read-only mode. Actions unlock when you are active and alive.';
  } else if (!selectedStructure) {
    feedbackCopy =
      'Select any structure cell on the board to inspect destroy actions.';
    actionHintCopy =
      'Pinned structure not found in latest state. Re-pin a target.';
  } else if (!destroyState.selectedOwned) {
    feedbackCopy = 'Destroy controls are hidden for non-owned structures.';
    feedbackIsError = true;
    actionHintCopy = 'Pinned structure is not owned by your team.';
  } else if (
    destroyState.pendingStructureKeys.includes(selectedStructure.key)
  ) {
    feedbackCopy =
      'Destroy pending for selected structure. You may retarget another structure.';
    actionHintCopy = 'Destroy request pending for this structure.';
    actionHintPending = true;
  } else if (selectedStructure.requiresDestroyConfirm) {
    queueButtonHidden = true;
    confirmPanelHidden = false;
    confirmButtonDisabled = false;
    cancelButtonDisabled = !destroyState.confirmArmed;
    confirmButtonText = destroyState.confirmArmed
      ? 'Confirm Destroy Now'
      : 'Arm Confirm Destroy';
    feedbackCopy = destroyState.confirmArmed
      ? 'Confirm destroy to submit the coordinated request.'
      : 'Core destroy requires confirmation before queue submission.';
    actionHintCopy = destroyState.confirmArmed
      ? 'Confirm armed. Submit destroy to queue the request.'
      : 'Core structures require one extra confirmation step.';
  } else {
    queueButtonDisabled = false;
    feedbackCopy = 'Ready to queue destroy request for selected structure.';
    actionHintCopy = 'Pinned and owned. Destroy action is ready.';
  }

  if (feedbackOverride) {
    feedbackCopy = feedbackOverride.text;
    feedbackIsError = feedbackOverride.isError;
    actionHintCopy = feedbackOverride.text;
    actionHintPending = !feedbackOverride.isError;
  }

  return {
    selectionCopy,
    feedbackCopy,
    feedbackIsError,
    actionHintCopy,
    actionHintPending,
    queueButtonHidden,
    queueButtonDisabled,
    confirmPanelHidden,
    confirmButtonDisabled,
    confirmButtonText,
    cancelButtonDisabled,
  };
}
