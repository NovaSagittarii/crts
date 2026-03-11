import { describe, expect, test } from 'vitest';

import type { RoomMembershipPayload, RoomStatePayload } from '#rts-engine';

import {
  applyAuthoritativeIdentity,
  createPlayerIdentityState,
  resolveTeamIdForSession,
  selectIsHost,
  selectSelfParticipant,
} from '../../apps/web/src/player-identity-view-model.js';
import {
  createMembershipParticipant,
  createMembershipPayload,
  createSlotDefinition,
} from './membership-fixtures.js';

function createIdentityMembershipPayload(): RoomMembershipPayload {
  return createMembershipPayload({
    roomId: 'room-1',
    roomCode: 'ROOM1',
    roomName: 'Identity Room',
    revision: 2,
    hostSessionId: 'server-session',
    slotDefinitions: [
      createSlotDefinition('team-1', 2),
      createSlotDefinition('team-2', 2),
    ],
    slots: {
      'team-1': 'server-session',
      'team-2': null,
    },
    slotMembers: {
      'team-1': ['server-session'],
      'team-2': [],
    },
    participants: [
      createMembershipParticipant({
        sessionId: 'server-session',
        displayName: 'Alicia',
        role: 'player',
        slotId: 'team-1',
        ready: true,
      }),
      createMembershipParticipant({
        sessionId: 'spectator-session',
        displayName: 'Byron',
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
  });
}

function createRoomStatePayload(): RoomStatePayload {
  return {
    roomId: 'room-1',
    roomName: 'Identity Room',
    width: 48,
    height: 48,
    generation: 0,
    tick: 12,
    grid: new ArrayBuffer(0),
    teams: [
      {
        id: 1,
        name: "Alicia's Team",
        playerIds: ['server-session'],
        resources: 25,
        income: 5,
        incomeBreakdown: {
          base: 5,
          structures: 0,
          total: 5,
          activeStructureCount: 1,
        },
        pendingBuilds: [],
        pendingDestroys: [],
        structures: [],
        defeated: false,
        baseTopLeft: { x: 0, y: 0 },
        baseIntact: true,
      },
      {
        id: 2,
        name: 'Open Team',
        playerIds: [],
        resources: 25,
        income: 5,
        incomeBreakdown: {
          base: 5,
          structures: 0,
          total: 5,
          activeStructureCount: 1,
        },
        pendingBuilds: [],
        pendingDestroys: [],
        structures: [],
        defeated: false,
        baseTopLeft: { x: 24, y: 24 },
        baseIntact: true,
      },
    ],
  };
}

describe('player identity view model', () => {
  test('applies authoritative identity and uses the updated session for lookups', () => {
    const membership = createIdentityMembershipPayload();
    const state = createRoomStatePayload();

    const identity = applyAuthoritativeIdentity(
      createPlayerIdentityState('bootstrap-session', 'Guest'),
      {
        sessionId: 'server-session',
        name: 'Alicia',
      },
    );

    expect(identity).toEqual({
      sessionId: 'server-session',
      name: 'Alicia',
    });
    expect(
      selectSelfParticipant(membership, identity.sessionId)?.displayName,
    ).toBe('Alicia');
    expect(selectSelfParticipant(membership, 'bootstrap-session')).toBeNull();
    expect(selectIsHost(membership, identity.sessionId)).toBe(true);
    expect(resolveTeamIdForSession(state.teams, identity.sessionId)).toBe(1);
  });

  test('returns null and false when the session is missing from membership or teams', () => {
    const membership = createIdentityMembershipPayload();
    const state = createRoomStatePayload();

    expect(selectSelfParticipant(membership, null)).toBeNull();
    expect(selectSelfParticipant(membership, 'missing-session')).toBeNull();
    expect(selectIsHost(membership, null)).toBe(false);
    expect(selectIsHost(membership, 'missing-session')).toBe(false);
    expect(resolveTeamIdForSession(state.teams, null)).toBeNull();
    expect(resolveTeamIdForSession(state.teams, 'missing-session')).toBeNull();
  });
});
