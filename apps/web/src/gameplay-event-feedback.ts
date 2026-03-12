import {
  type BuildOutcomePayload,
  type BuildQueueRejectedPayload,
  type BuildQueuedPayload,
  type DestroyOutcomePayload,
  type DestroyQueueRejectedPayload,
  type DestroyQueuedPayload,
  type RoomErrorPayload,
} from '#rts-engine';

import {
  describeBuildFailureReason,
  formatDeficitCopy,
} from './build-queue-view-model.js';
import type { UiFeedbackMessage } from './ui-feedback-message.js';

export type GameplayFeedbackMessage = UiFeedbackMessage;

export interface GameplayFeedbackPresentation {
  override: GameplayFeedbackMessage | null;
  overlayCopy: string;
  overlayIsError: boolean;
  overlayPending: boolean;
  message: GameplayFeedbackMessage | null;
  toast: GameplayFeedbackMessage | null;
}

function createFeedbackPresentation(
  override: GameplayFeedbackMessage | null,
  overlayCopy: string,
  overlayIsError: boolean,
  overlayPending: boolean,
  message: GameplayFeedbackMessage | null = null,
  toast: GameplayFeedbackMessage | null = null,
): GameplayFeedbackPresentation {
  return {
    override,
    overlayCopy,
    overlayIsError,
    overlayPending,
    message,
    toast,
  };
}

export function createPendingGameplayFeedback(
  message: string,
): GameplayFeedbackPresentation {
  return createFeedbackPresentation(
    { text: message, isError: false },
    message,
    false,
    true,
  );
}

export function createBuildQueuedFeedback(
  payload: BuildQueuedPayload,
): GameplayFeedbackPresentation {
  const feedback = `Build queued (#${payload.eventId}) for tick ${payload.executeTick}.`;
  return createFeedbackPresentation(
    { text: feedback, isError: false },
    feedback,
    false,
    false,
    { text: feedback, isError: false },
    { text: feedback, isError: false },
  );
}

export function createBuildQueueRejectedFeedback(
  payload: BuildQueueRejectedPayload,
): GameplayFeedbackPresentation {
  const rejectionCopy =
    payload.reason === 'insufficient-resources' &&
    typeof payload.needed === 'number' &&
    typeof payload.current === 'number' &&
    typeof payload.deficit === 'number'
      ? formatDeficitCopy(payload.needed, payload.current, payload.deficit)
      : `Build intent rejected: ${describeBuildFailureReason(
          payload.reason as Parameters<typeof describeBuildFailureReason>[0],
        )}.`;

  return createFeedbackPresentation(
    { text: rejectionCopy, isError: true },
    rejectionCopy,
    true,
    false,
    { text: rejectionCopy, isError: true },
    { text: rejectionCopy, isError: true },
  );
}

export function createBuildOutcomeFeedback(
  payload: BuildOutcomePayload,
): GameplayFeedbackPresentation {
  if (payload.outcome === 'rejected') {
    const rejectionCopy =
      payload.reason === 'insufficient-resources' &&
      typeof payload.needed === 'number' &&
      typeof payload.current === 'number' &&
      typeof payload.deficit === 'number'
        ? formatDeficitCopy(payload.needed, payload.current, payload.deficit)
        : `Build #${payload.eventId} rejected: ${describeBuildFailureReason(payload.reason)}.`;

    return createFeedbackPresentation(
      { text: rejectionCopy, isError: true },
      rejectionCopy,
      true,
      false,
      { text: rejectionCopy, isError: true },
    );
  }

  const successCopy = `Build #${payload.eventId} applied.`;
  return createFeedbackPresentation(
    { text: successCopy, isError: false },
    successCopy,
    false,
    false,
  );
}

export function createBuildRoomErrorFeedback(
  payload: RoomErrorPayload,
): GameplayFeedbackPresentation | null {
  if (
    payload.reason === 'insufficient-resources' &&
    typeof payload.needed === 'number' &&
    typeof payload.current === 'number' &&
    typeof payload.deficit === 'number'
  ) {
    const deficitCopy = formatDeficitCopy(
      payload.needed,
      payload.current,
      payload.deficit,
    );
    const message = `Queue rejected. ${deficitCopy}`;
    return createFeedbackPresentation(
      { text: deficitCopy, isError: true },
      deficitCopy,
      true,
      false,
      { text: message, isError: true },
      { text: message, isError: true },
    );
  }

  if (
    payload.reason === 'outside-territory' ||
    payload.reason === 'template-exceeds-map-size' ||
    payload.reason === 'occupied-site' ||
    payload.reason === 'unknown-template' ||
    payload.reason === 'invalid-coordinates'
  ) {
    const rejectionCopy = `Cannot queue here: ${describeBuildFailureReason(payload.reason)}.`;
    return createFeedbackPresentation(
      { text: rejectionCopy, isError: true },
      rejectionCopy,
      true,
      false,
    );
  }

  return null;
}

export function describeDestroyFailureReason(
  reason: string | undefined,
): string {
  if (reason === 'wrong-owner') {
    return 'wrong owner';
  }
  if (reason === 'invalid-target') {
    return 'invalid target';
  }
  if (reason === 'invalid-lifecycle-state') {
    return 'invalid lifecycle state';
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
  return 'destroy rejected';
}

export function createDestroyQueuedFeedback(
  payload: DestroyQueuedPayload,
): GameplayFeedbackPresentation {
  const feedback = payload.idempotent
    ? `Destroy already pending for ${payload.structureKey}.`
    : `Destroy queued (#${payload.eventId}) for tick ${payload.executeTick}.`;

  return createFeedbackPresentation(
    { text: feedback, isError: false },
    feedback,
    false,
    false,
    { text: feedback, isError: false },
    payload.idempotent ? null : { text: feedback, isError: false },
  );
}

export function createDestroyQueueRejectedFeedback(
  payload: DestroyQueueRejectedPayload,
): GameplayFeedbackPresentation {
  const rejectionCopy = `Destroy intent rejected: ${describeDestroyFailureReason(payload.reason)}.`;
  return createFeedbackPresentation(
    { text: rejectionCopy, isError: true },
    rejectionCopy,
    true,
    false,
    { text: rejectionCopy, isError: true },
    { text: rejectionCopy, isError: true },
  );
}

export function createDestroyOutcomeFeedback(
  payload: DestroyOutcomePayload,
): GameplayFeedbackPresentation {
  if (payload.outcome === 'rejected') {
    const rejectionCopy = `Destroy #${payload.eventId} rejected: ${describeDestroyFailureReason(payload.reason)}.`;
    return createFeedbackPresentation(
      { text: rejectionCopy, isError: true },
      rejectionCopy,
      true,
      false,
      { text: rejectionCopy, isError: true },
      { text: rejectionCopy, isError: true },
    );
  }

  const successCopy = `Destroy applied for ${payload.structureKey}.`;
  return createFeedbackPresentation(
    { text: successCopy, isError: false },
    successCopy,
    false,
    false,
    { text: successCopy, isError: false },
    { text: 'Structure destroyed.', isError: false },
  );
}

export function createDestroyRoomErrorFeedback(
  payload: RoomErrorPayload,
): GameplayFeedbackPresentation | null {
  if (
    payload.reason === 'wrong-owner' ||
    payload.reason === 'invalid-target' ||
    payload.reason === 'invalid-lifecycle-state' ||
    payload.reason === 'invalid-delay'
  ) {
    const rejectionCopy = `Destroy rejected: ${describeDestroyFailureReason(payload.reason)}.`;
    return createFeedbackPresentation(
      { text: rejectionCopy, isError: true },
      rejectionCopy,
      true,
      false,
    );
  }

  return null;
}
