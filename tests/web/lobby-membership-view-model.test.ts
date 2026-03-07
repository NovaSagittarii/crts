import { describe, expect, test } from 'vitest';

import type { RoomMembershipPayload } from '#rts-engine';

import { deriveLobbyMembershipViewModel } from '../../apps/web/src/lobby-membership-view-model.js';

function createMembershipPayload(): RoomMembershipPayload {
  return {
    roomId: 'room-shared',
    roomCode: 'ROOM2',
    roomName: 'Shared Lobby',
    revision: 4,
    status: 'lobby',
    hostSessionId: 'host-1',
    slotDefinitions: [
      { slotId: 'team-1', capacity: 2 },
      { slotId: 'team-2', capacity: 1 },
      { slotId: 'team-3', capacity: 2 },
    ],
    slots: {
      'team-1': 'host-1',
      'team-2': 'rival-1',
      'team-3': null,
    },
    slotMembers: {
      'team-1': ['host-1', 'ally-1'],
      'team-2': ['rival-1'],
      'team-3': ['held-1'],
    },
    participants: [
      {
        sessionId: 'host-1',
        displayName: 'Alicia',
        role: 'player',
        slotId: 'team-1',
        ready: true,
        connectionStatus: 'connected',
        holdExpiresAt: null,
        disconnectReason: null,
      },
      {
        sessionId: 'ally-1',
        displayName: 'Byron',
        role: 'player',
        slotId: 'team-1',
        ready: false,
        connectionStatus: 'connected',
        holdExpiresAt: null,
        disconnectReason: null,
      },
      {
        sessionId: 'rival-1',
        displayName: 'Cara',
        role: 'player',
        slotId: 'team-2',
        ready: true,
        connectionStatus: 'connected',
        holdExpiresAt: null,
        disconnectReason: null,
      },
      {
        sessionId: 'held-1',
        displayName: 'Drew',
        role: 'player',
        slotId: 'team-3',
        ready: false,
        connectionStatus: 'held',
        holdExpiresAt: 15_000,
        disconnectReason: 'transport close',
      },
      {
        sessionId: 'spectator-1',
        displayName: 'Evan',
        role: 'spectator',
        slotId: null,
        ready: false,
        connectionStatus: 'connected',
        holdExpiresAt: null,
        disconnectReason: null,
      },
    ],
    heldSlots: {
      'team-1': null,
      'team-2': null,
      'team-3': {
        sessionId: 'held-1',
        holdExpiresAt: 15_000,
        disconnectReason: 'transport close',
      },
    },
    heldSlotMembers: {
      'team-1': [],
      'team-2': [],
      'team-3': [
        {
          sessionId: 'held-1',
          holdExpiresAt: 15_000,
          disconnectReason: 'transport close',
        },
      ],
    },
    countdownSecondsRemaining: null,
    hashAlgorithm: 'fnv1a-32',
    membershipHash: 'membership-4',
  };
}

describe('lobby membership view model', () => {
  test('orders slots from slot definitions and renders members from slotMembers', () => {
    const viewModel = deriveLobbyMembershipViewModel(
      createMembershipPayload(),
      'spectator-1',
      10_000,
    );

    expect(viewModel.slots.map(({ slotId }) => slotId)).toEqual([
      'team-1',
      'team-2',
      'team-3',
    ]);
    expect(
      viewModel.slots[0]?.members.map(({ sessionId }) => sessionId),
    ).toEqual(['host-1', 'ally-1']);
    expect(
      viewModel.slots[2]?.members.map(({ sessionId }) => sessionId),
    ).toEqual(['held-1']);
    expect(viewModel.slots[2]?.openSeatCount).toBe(1);
    expect(viewModel.slots[2]?.canClaim).toBe(true);
  });

  test('annotates held members from heldSlotMembers and tracks spectators separately', () => {
    const viewModel = deriveLobbyMembershipViewModel(
      createMembershipPayload(),
      'spectator-1',
      12_100,
    );

    expect(viewModel.slots[2]?.members[0]).toMatchObject({
      sessionId: 'held-1',
      heldLabel: 'Disconnected (3s hold)',
      isHeld: true,
    });
    expect(viewModel.spectators).toEqual([
      {
        displayName: 'Evan',
        sessionId: 'spectator-1',
      },
    ]);
  });

  test('disables claim actions once the current user is already a player', () => {
    const viewModel = deriveLobbyMembershipViewModel(
      createMembershipPayload(),
      'ally-1',
      10_000,
    );

    expect(viewModel.slots.every(({ canClaim }) => canClaim === false)).toBe(
      true,
    );
  });
});
