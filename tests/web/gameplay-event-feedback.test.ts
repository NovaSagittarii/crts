import { describe, expect, it } from 'vitest';

import type {
  BuildOutcomePayload,
  BuildQueueRejectedPayload,
  BuildQueuedPayload,
  DestroyOutcomePayload,
  DestroyQueueRejectedPayload,
  DestroyQueuedPayload,
  RoomErrorPayload,
} from '#rts-engine';

import {
  createBuildOutcomeFeedback,
  createBuildQueueRejectedFeedback,
  createBuildQueuedFeedback,
  createBuildRoomErrorFeedback,
  createDestroyOutcomeFeedback,
  createDestroyQueueRejectedFeedback,
  createDestroyQueuedFeedback,
  createDestroyRoomErrorFeedback,
  createPendingGameplayFeedback,
} from '../../apps/web/src/gameplay-event-feedback.js';

function createBuildQueuedPayload(
  overrides: Partial<BuildQueuedPayload> = {},
): BuildQueuedPayload {
  return {
    roomId: 'room-1',
    intentId: 'intent-1',
    playerId: 'player-1',
    teamId: 2,
    bufferedTurn: 10,
    scheduledByTurn: 11,
    templateId: 'factory',
    x: 5,
    y: 6,
    transform: {
      operations: [],
      matrix: { xx: 1, xy: 0, yx: 0, yy: 1 },
    },
    delayTicks: 2,
    eventId: 9,
    executeTick: 42,
    ...overrides,
  };
}

function createBuildQueueRejectedPayload(
  overrides: Partial<BuildQueueRejectedPayload> = {},
): BuildQueueRejectedPayload {
  return {
    roomId: 'room-1',
    intentId: 'intent-1',
    playerId: 'player-1',
    teamId: 2,
    reason: 'outside-territory',
    ...overrides,
  };
}

function createBuildOutcomePayload(
  overrides: Partial<BuildOutcomePayload> = {},
): BuildOutcomePayload {
  return {
    roomId: 'room-1',
    eventId: 9,
    teamId: 2,
    outcome: 'applied',
    executeTick: 42,
    resolvedTick: 42,
    ...overrides,
  };
}

function createDestroyQueuedPayload(
  overrides: Partial<DestroyQueuedPayload> = {},
): DestroyQueuedPayload {
  return {
    roomId: 'room-1',
    intentId: 'intent-1',
    playerId: 'player-1',
    teamId: 2,
    bufferedTurn: 10,
    scheduledByTurn: 11,
    delayTicks: 2,
    structureKey: 'structure-1',
    eventId: 9,
    executeTick: 42,
    idempotent: false,
    ...overrides,
  };
}

function createDestroyQueueRejectedPayload(
  overrides: Partial<DestroyQueueRejectedPayload> = {},
): DestroyQueueRejectedPayload {
  return {
    roomId: 'room-1',
    intentId: 'intent-1',
    playerId: 'player-1',
    teamId: 2,
    structureKey: 'structure-1',
    reason: 'invalid-target',
    ...overrides,
  };
}

function createDestroyOutcomePayload(
  overrides: Partial<DestroyOutcomePayload> = {},
): DestroyOutcomePayload {
  return {
    roomId: 'room-1',
    eventId: 9,
    teamId: 2,
    structureKey: 'structure-1',
    templateId: 'factory',
    outcome: 'destroyed',
    executeTick: 42,
    resolvedTick: 42,
    ...overrides,
  };
}

function createRoomErrorPayload(
  overrides: Partial<RoomErrorPayload> = {},
): RoomErrorPayload {
  return {
    roomId: 'room-1',
    message: 'Action rejected.',
    ...overrides,
  };
}

describe('gameplay-event-feedback', () => {
  it('creates pending feedback without notifications', () => {
    expect(
      createPendingGameplayFeedback('Submitting build queue request...'),
    ).toEqual({
      override: { text: 'Submitting build queue request...', isError: false },
      overlayCopy: 'Submitting build queue request...',
      overlayIsError: false,
      overlayPending: true,
      message: null,
      toast: null,
    });
  });

  it('creates build queued feedback with a success toast', () => {
    const feedback = createBuildQueuedFeedback(createBuildQueuedPayload());

    expect(feedback.message?.text).toBe('Build queued (#9) for tick 42.');
    expect(feedback.toast?.text).toBe('Build queued (#9) for tick 42.');
    expect(feedback.overlayPending).toBe(false);
    expect(feedback.overlayIsError).toBe(false);
  });

  it('formats build queue rejections using affordability metadata when present', () => {
    const feedback = createBuildQueueRejectedFeedback(
      createBuildQueueRejectedPayload({
        reason: 'insufficient-resources',
        needed: 140,
        current: 90,
        deficit: 50,
      }),
    );

    expect(feedback.override?.text).toBe('Need 140, current 90 (deficit 50).');
    expect(feedback.toast?.text).toBe('Need 140, current 90 (deficit 50).');
    expect(feedback.overlayIsError).toBe(true);
  });

  it('does not create a toast for successful build outcomes', () => {
    const feedback = createBuildOutcomeFeedback(createBuildOutcomePayload());

    expect(feedback.override?.text).toBe('Build #9 applied.');
    expect(feedback.message).toBeNull();
    expect(feedback.toast).toBeNull();
  });

  it('keeps room-error affordability copy split between overlay and status message', () => {
    const feedback = createBuildRoomErrorFeedback(
      createRoomErrorPayload({
        reason: 'insufficient-resources',
        needed: 140,
        current: 90,
        deficit: 50,
      }),
    );

    expect(feedback).toEqual({
      override: { text: 'Need 140, current 90 (deficit 50).', isError: true },
      overlayCopy: 'Need 140, current 90 (deficit 50).',
      overlayIsError: true,
      overlayPending: false,
      message: {
        text: 'Queue rejected. Need 140, current 90 (deficit 50).',
        isError: true,
      },
      toast: {
        text: 'Queue rejected. Need 140, current 90 (deficit 50).',
        isError: true,
      },
    });
  });

  it('suppresses destroy queued toasts for idempotent requests', () => {
    const feedback = createDestroyQueuedFeedback(
      createDestroyQueuedPayload({ idempotent: true }),
    );

    expect(feedback.override?.text).toBe(
      'Destroy already pending for structure-1.',
    );
    expect(feedback.message?.text).toBe(
      'Destroy already pending for structure-1.',
    );
    expect(feedback.toast).toBeNull();
  });

  it('creates destroy outcome success feedback with split toast copy', () => {
    const feedback = createDestroyOutcomeFeedback(
      createDestroyOutcomePayload(),
    );

    expect(feedback.override?.text).toBe('Destroy applied for structure-1.');
    expect(feedback.message?.text).toBe('Destroy applied for structure-1.');
    expect(feedback.toast?.text).toBe('Structure destroyed.');
  });

  it('creates destroy queue rejection feedback as an error', () => {
    const feedback = createDestroyQueueRejectedFeedback(
      createDestroyQueueRejectedPayload(),
    );

    expect(feedback.override?.text).toBe(
      'Destroy intent rejected: invalid target.',
    );
    expect(feedback.toast?.isError).toBe(true);
  });

  it('creates destroy room-error feedback only for validation reasons', () => {
    expect(
      createDestroyRoomErrorFeedback(
        createRoomErrorPayload({ reason: 'wrong-owner' }),
      ),
    ).toEqual({
      override: { text: 'Destroy rejected: wrong owner.', isError: true },
      overlayCopy: 'Destroy rejected: wrong owner.',
      overlayIsError: true,
      overlayPending: false,
      message: null,
      toast: null,
    });

    expect(
      createDestroyRoomErrorFeedback(
        createRoomErrorPayload({ reason: 'not-in-room' }),
      ),
    ).toBeNull();
  });
});
