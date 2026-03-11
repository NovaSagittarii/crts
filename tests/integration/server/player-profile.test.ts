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
  test('emits authoritative profiles and propagates sanitized renamed player state to peers', async ({
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

    const spectator = connectClient({ sessionId: 'player-profile-spectator' });
    await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
    spectator.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');

    owner.emit('room:claim-slot', { slotId: 'team-1' });
    await waitForMembership(
      owner,
      created.roomId,
      (payload) => payload.slots['team-1'] === created.playerId,
    );

    const longName = '  123456789012345678901234567890  ';
    const sanitizedName = '123456789012345678901234';

    const renamedProfilePromise = waitForEvent<PlayerProfilePayload>(
      owner,
      'player:profile',
    );
    const renamedMembershipPromise = waitForMembership(
      spectator,
      created.roomId,
      (payload) =>
        payload.participants.some(
          ({ sessionId, displayName }) =>
            sessionId === created.playerId && displayName === sanitizedName,
        ),
      { overallTimeoutMs: 8_000 },
    );
    const renamedStatePromise = waitForState(
      spectator,
      (payload) =>
        payload.roomId === created.roomId &&
        payload.teams.some(
          ({ playerIds, name }) =>
            playerIds.includes(created.playerId) &&
            name === `${sanitizedName}'s Team`,
        ),
      {
        roomId: created.roomId,
        overallTimeoutMs: 8_000,
      },
    );

    owner.emit('player:set-name', { name: longName });

    const renamedProfile = await renamedProfilePromise;
    const renamedMembership = await renamedMembershipPromise;
    const renamedTeam = (await renamedStatePromise).teams.find(
      ({ playerIds }) => playerIds.includes(created.playerId),
    );

    expect(renamedProfile).toEqual({
      playerId: created.playerId,
      name: sanitizedName,
    });
    expect(
      renamedMembership.participants.find(
        ({ sessionId }) => sessionId === created.playerId,
      )?.displayName,
    ).toBe(sanitizedName);
    expect(renamedTeam?.name).toBe(`${sanitizedName}'s Team`);
  });

  test('falls back to the current authoritative name for blank or invalid renames', async ({
    connectClient,
  }) => {
    const owner = connectClient({
      sessionId: 'player-profile-fallback-owner',
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

    await initialJoinedPromise;
    const initialProfile = await initialProfilePromise;

    const firstRenamePromise = waitForEvent<PlayerProfilePayload>(
      owner,
      'player:profile',
    );
    owner.emit('player:set-name', { name: 'Commander Nova' });
    await expect(firstRenamePromise).resolves.toEqual({
      playerId: initialProfile.playerId,
      name: 'Commander Nova',
    });

    const blankRenamePromise = waitForEvent<PlayerProfilePayload>(
      owner,
      'player:profile',
    );
    owner.emit('player:set-name', { name: '   ' });
    await expect(blankRenamePromise).resolves.toEqual({
      playerId: initialProfile.playerId,
      name: 'Commander Nova',
    });

    const invalidRenamePromise = waitForEvent<PlayerProfilePayload>(
      owner,
      'player:profile',
    );
    owner.emit('player:set-name', { name: 42 });
    await expect(invalidRenamePromise).resolves.toEqual({
      playerId: initialProfile.playerId,
      name: 'Commander Nova',
    });
  });
});
