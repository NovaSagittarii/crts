import { describe, expect, test } from 'vitest';

import type { RoomMembershipPayload } from '#rts-engine';

import { deriveLobbyControlsViewModel } from '../../apps/web/src/lobby-controls-view-model.js';

function createMembershipPayload(
  overrides: Partial<RoomMembershipPayload> = {},
): RoomMembershipPayload {
  return {
    roomId: 'room-controls',
    roomCode: 'ROOM3',
    roomName: 'Control Room',
    revision: 6,
    status: 'lobby',
    hostSessionId: 'host-1',
    slotDefinitions: [
      { slotId: 'team-1', capacity: 2 },
      { slotId: 'team-2', capacity: 2 },
    ],
    slots: {
      'team-1': 'host-1',
      'team-2': 'rival-1',
    },
    slotMembers: {
      'team-1': ['host-1', 'ally-1'],
      'team-2': ['rival-1'],
    },
    participants: [
      {
        sessionId: 'host-1',
        displayName: 'Host',
        role: 'player',
        slotId: 'team-1',
        ready: true,
        connectionStatus: 'connected',
        holdExpiresAt: null,
        disconnectReason: null,
      },
      {
        sessionId: 'ally-1',
        displayName: 'Ally',
        role: 'player',
        slotId: 'team-1',
        ready: true,
        connectionStatus: 'connected',
        holdExpiresAt: null,
        disconnectReason: null,
      },
      {
        sessionId: 'rival-1',
        displayName: 'Rival',
        role: 'player',
        slotId: 'team-2',
        ready: false,
        connectionStatus: 'connected',
        holdExpiresAt: null,
        disconnectReason: null,
      },
    ],
    heldSlots: {
      'team-1': null,
      'team-2': null,
    },
    heldSlotMembers: {
      'team-1': [],
      'team-2': [],
    },
    countdownSecondsRemaining: null,
    hashAlgorithm: 'fnv1a-32',
    membershipHash: 'membership-6',
    ...overrides,
  };
}

describe('lobby controls view model', () => {
  test('keeps host start disabled until every claimed seat is ready', () => {
    const viewModel = deriveLobbyControlsViewModel(
      createMembershipPayload(),
      'host-1',
    );

    expect(viewModel.statusCopy).toBe('Host: host-1 | rev 6 | lobby');
    expect(viewModel.countdownCopy).toBe(
      'Waiting for teams to fill (3/4 seats claimed, 2 ready)',
    );
    expect(viewModel.readyButtonLabel).toBe('Set Not Ready');
    expect(viewModel.readyDisabled).toBe(false);
    expect(viewModel.startButtonLabel).toBe('Host Start');
    expect(viewModel.startDisabled).toBe(true);
  });

  test('enables restart copy for the host after a finished match', () => {
    const viewModel = deriveLobbyControlsViewModel(
      createMembershipPayload({ status: 'finished' }),
      'host-1',
    );

    expect(viewModel.countdownCopy).toBe('Match finished');
    expect(viewModel.startButtonLabel).toBe('Host Restart');
    expect(viewModel.startDisabled).toBe(false);
  });

  test('disables ready actions for spectators', () => {
    const viewModel = deriveLobbyControlsViewModel(
      createMembershipPayload({
        participants: [
          ...createMembershipPayload().participants,
          {
            sessionId: 'spectator-1',
            displayName: 'Spectator',
            role: 'spectator',
            slotId: null,
            ready: false,
            connectionStatus: 'connected',
            holdExpiresAt: null,
            disconnectReason: null,
          },
        ],
      }),
      'spectator-1',
    );

    expect(viewModel.readyButtonLabel).toBe('Set Ready');
    expect(viewModel.readyDisabled).toBe(true);
    expect(viewModel.startDisabled).toBe(true);
  });
});
