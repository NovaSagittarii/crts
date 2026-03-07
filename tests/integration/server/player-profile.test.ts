import { describe, expect } from 'vitest';

import type { PlayerProfilePayload, RoomJoinedPayload } from '#rts-engine';

import { createIntegrationTest } from './fixtures.js';
import {
  waitForEvent,
  waitForMembership,
  waitForState,
} from './test-support.js';

const test = createIntegrationTest({
  port: 0,
  width: 50,
  height: 50,
  tickMs: 40,
});

describe('player profile contract', () => {
  test('emits authoritative profiles and propagates renamed player state', async ({
    connectClient,
  }) => {
    const owner = connectClient({
      sessionId: 'player-profile-owner',
      connect: false,
    });
    const initialJoinedPromise = waitForEvent<RoomJoinedPayload>(
      owner,
      'room:joined',
    );
    const initialProfilePromise = waitForEvent<PlayerProfilePayload>(
      owner,
      'player:profile',
    );

    owner.connect();

    const initialJoined = await initialJoinedPromise;
    const initialProfile = await initialProfilePromise;
    expect(initialProfile.playerId).toBe(initialJoined.playerId);
    expect(initialProfile.name).toBe(initialJoined.playerName);

    owner.emit('room:create', {
      name: 'Profile Room',
      width: 48,
      height: 48,
    });
    const created = await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:claim-slot', { slotId: 'team-1' });
    await waitForMembership(
      owner,
      created.roomId,
      (payload) => payload.slots['team-1'] === created.playerId,
    );

    const renamedProfilePromise = waitForEvent<PlayerProfilePayload>(
      owner,
      'player:profile',
    );
    const renamedMembershipPromise = waitForMembership(
      owner,
      created.roomId,
      (payload) =>
        payload.participants.some(
          ({ sessionId, displayName }) =>
            sessionId === created.playerId && displayName === 'Commander Nova',
        ),
      { overallTimeoutMs: 8_000 },
    );
    const renamedStatePromise = waitForState(
      owner,
      (payload) =>
        payload.roomId === created.roomId &&
        payload.teams.some(
          ({ playerIds, name }) =>
            playerIds.includes(created.playerId) &&
            name === "Commander Nova's Team",
        ),
      {
        roomId: created.roomId,
        overallTimeoutMs: 8_000,
      },
    );

    owner.emit('player:set-name', { name: '   Commander Nova   ' });

    const renamedProfile = await renamedProfilePromise;
    const renamedMembership = await renamedMembershipPromise;
    const renamedTeam = (await renamedStatePromise).teams.find(
      ({ playerIds }) => playerIds.includes(created.playerId),
    );

    expect(renamedProfile).toEqual({
      playerId: created.playerId,
      name: 'Commander Nova',
    });
    expect(
      renamedMembership.participants.find(
        ({ sessionId }) => sessionId === created.playerId,
      )?.displayName,
    ).toBe('Commander Nova');
    expect(renamedTeam?.name).toBe("Commander Nova's Team");
  });
});
