import { describe, expect, test } from 'vitest';

import type { RoomMembershipPayload } from '#rts-engine';

import { deriveLobbyControlsViewModel } from '../../apps/web/src/lobby-controls-view-model.js';
import {
  createMembershipParticipant,
  createMembershipPayload,
  createSlotDefinition,
} from './membership-fixtures.js';

function createControlsMembershipPayload(
  overrides: Partial<RoomMembershipPayload> = {},
): RoomMembershipPayload {
  return createMembershipPayload({
    roomId: 'room-controls',
    roomCode: 'ROOM3',
    roomName: 'Control Room',
    revision: 6,
    hostSessionId: 'host-1',
    slotDefinitions: [
      createSlotDefinition('team-1', 2),
      createSlotDefinition('team-2', 2),
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
      createMembershipParticipant({
        sessionId: 'host-1',
        displayName: 'Host',
        role: 'player',
        slotId: 'team-1',
        ready: true,
      }),
      createMembershipParticipant({
        sessionId: 'ally-1',
        displayName: 'Ally',
        role: 'player',
        slotId: 'team-1',
        ready: true,
      }),
      createMembershipParticipant({
        sessionId: 'rival-1',
        displayName: 'Rival',
        role: 'player',
        slotId: 'team-2',
        ready: false,
      }),
    ],
    heldSlots: {
      'team-1': null,
      'team-2': null,
    },
    heldSlotMembers: {
      'team-1': [],
      'team-2': [],
    },
    membershipHash: 'membership-6',
    ...overrides,
  });
}

describe('lobby controls view model', () => {
  test('keeps host start disabled until every claimed seat is ready', () => {
    const viewModel = deriveLobbyControlsViewModel(
      createControlsMembershipPayload(),
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
      createControlsMembershipPayload({ status: 'finished' }),
      'host-1',
    );

    expect(viewModel.countdownCopy).toBe('Match finished');
    expect(viewModel.startButtonLabel).toBe('Host Restart');
    expect(viewModel.startDisabled).toBe(false);
  });

  test('disables ready actions for spectators', () => {
    const viewModel = deriveLobbyControlsViewModel(
      createControlsMembershipPayload({
        participants: [
          ...createControlsMembershipPayload().participants,
          {
            sessionId: 'spectator-1',
            displayName: 'Spectator',
            role: 'spectator',
            slotId: null,
            ready: false,
            connectionStatus: 'connected',
            holdExpiresAt: null,
            disconnectReason: null,
            isBot: false,
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
