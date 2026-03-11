import { describe, expect, test } from 'vitest';

import { deriveLobbyMembershipViewModel } from '../../apps/web/src/lobby-membership-view-model.js';
import {
  createHeldSlot,
  createHeldSlotMember,
  createMembershipParticipant,
  createMembershipPayload,
  createSlotDefinition,
} from './membership-fixtures.js';

function createSharedLobbyPayload() {
  return createMembershipPayload({
    roomId: 'room-shared',
    roomCode: 'ROOM2',
    roomName: 'Shared Lobby',
    revision: 4,
    hostSessionId: 'host-1',
    slotDefinitions: [
      createSlotDefinition('team-1', 2),
      createSlotDefinition('team-2', 1),
      createSlotDefinition('team-3', 2),
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
      createMembershipParticipant({
        sessionId: 'host-1',
        displayName: 'Alicia',
        role: 'player',
        slotId: 'team-1',
        ready: true,
      }),
      createMembershipParticipant({
        sessionId: 'ally-1',
        displayName: 'Byron',
        role: 'player',
        slotId: 'team-1',
      }),
      createMembershipParticipant({
        sessionId: 'rival-1',
        displayName: 'Cara',
        role: 'player',
        slotId: 'team-2',
        ready: true,
      }),
      createMembershipParticipant({
        sessionId: 'held-1',
        displayName: 'Drew',
        role: 'player',
        slotId: 'team-3',
        connectionStatus: 'held',
        holdExpiresAt: 15_000,
        disconnectReason: 'transport close',
      }),
      createMembershipParticipant({
        sessionId: 'spectator-1',
        displayName: 'Evan',
      }),
    ],
    heldSlots: {
      'team-1': null,
      'team-2': null,
      'team-3': createHeldSlot({
        sessionId: 'held-1',
        holdExpiresAt: 15_000,
        disconnectReason: 'transport close',
      }),
    },
    heldSlotMembers: {
      'team-1': [],
      'team-2': [],
      'team-3': [
        createHeldSlotMember({
          sessionId: 'held-1',
          holdExpiresAt: 15_000,
          disconnectReason: 'transport close',
        }),
      ],
    },
    membershipHash: 'membership-4',
  });
}

describe('lobby membership view model', () => {
  test('orders slots from slot definitions and renders members from slotMembers', () => {
    const viewModel = deriveLobbyMembershipViewModel(
      createSharedLobbyPayload(),
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
      createSharedLobbyPayload(),
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
      createSharedLobbyPayload(),
      'ally-1',
      10_000,
    );

    expect(viewModel.slots.every(({ canClaim }) => canClaim === false)).toBe(
      true,
    );
  });
});
