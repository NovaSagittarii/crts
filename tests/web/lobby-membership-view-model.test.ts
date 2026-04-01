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

  test('member with isBot true produces isBot true in view model', () => {
    const payload = createMembershipPayload({
      roomId: 'room-bot',
      roomCode: 'BOT1',
      roomName: 'Bot Lobby',
      revision: 1,
      hostSessionId: 'host-1',
      slotDefinitions: [
        createSlotDefinition('team-1', 1),
        createSlotDefinition('team-2', 1),
      ],
      slots: {
        'team-1': 'host-1',
        'team-2': 'bot-abc123',
      },
      slotMembers: {
        'team-1': ['host-1'],
        'team-2': ['bot-abc123'],
      },
      participants: [
        createMembershipParticipant({
          sessionId: 'host-1',
          displayName: 'Host',
          role: 'player',
          slotId: 'team-1',
          ready: true,
        }),
        createMembershipParticipant({
          sessionId: 'bot-abc123',
          displayName: 'Bot',
          role: 'player',
          slotId: 'team-2',
          ready: true,
          isBot: true,
        }),
      ],
      heldSlots: { 'team-1': null, 'team-2': null },
      heldSlotMembers: { 'team-1': [], 'team-2': [] },
    });

    const viewModel = deriveLobbyMembershipViewModel(payload, 'host-1');
    const botMember = viewModel.slots[1]?.members[0];
    expect(botMember?.isBot).toBe(true);
    expect(botMember?.displayName).toBe('Bot');
    expect(viewModel.slots[0]?.members[0]?.isBot).toBe(false);
  });

  test('slot with open seats and host session produces canAddBot true', () => {
    const payload = createMembershipPayload({
      roomId: 'room-bot2',
      roomCode: 'BOT2',
      roomName: 'Bot Lobby 2',
      revision: 1,
      hostSessionId: 'host-1',
      slotDefinitions: [
        createSlotDefinition('team-1', 1),
        createSlotDefinition('team-2', 1),
      ],
      slots: {
        'team-1': 'host-1',
        'team-2': null,
      },
      slotMembers: {
        'team-1': ['host-1'],
        'team-2': [],
      },
      participants: [
        createMembershipParticipant({
          sessionId: 'host-1',
          displayName: 'Host',
          role: 'player',
          slotId: 'team-1',
          ready: true,
        }),
      ],
      heldSlots: { 'team-1': null, 'team-2': null },
      heldSlotMembers: { 'team-1': [], 'team-2': [] },
    });

    const viewModel = deriveLobbyMembershipViewModel(payload, 'host-1');
    expect(viewModel.slots[1]?.canAddBot).toBe(true);
    expect(viewModel.slots[0]?.canAddBot).toBe(false);
  });

  test('slot with bot already present produces canAddBot false', () => {
    const payload = createMembershipPayload({
      roomId: 'room-bot3',
      roomCode: 'BOT3',
      roomName: 'Bot Lobby 3',
      revision: 1,
      hostSessionId: 'host-1',
      slotDefinitions: [
        createSlotDefinition('team-1', 1),
        createSlotDefinition('team-2', 2),
      ],
      slots: {
        'team-1': 'host-1',
        'team-2': 'bot-abc123',
      },
      slotMembers: {
        'team-1': ['host-1'],
        'team-2': ['bot-abc123'],
      },
      participants: [
        createMembershipParticipant({
          sessionId: 'host-1',
          displayName: 'Host',
          role: 'player',
          slotId: 'team-1',
          ready: true,
        }),
        createMembershipParticipant({
          sessionId: 'bot-abc123',
          displayName: 'Bot',
          role: 'player',
          slotId: 'team-2',
          ready: true,
          isBot: true,
        }),
      ],
      heldSlots: { 'team-1': null, 'team-2': null },
      heldSlotMembers: { 'team-1': [], 'team-2': [] },
    });

    const viewModel = deriveLobbyMembershipViewModel(payload, 'host-1');
    // team-2 has open capacity (2 slots, 1 member) but already has a bot
    expect(viewModel.slots[1]?.canAddBot).toBe(false);
  });
});
