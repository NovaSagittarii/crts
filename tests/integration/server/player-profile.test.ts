import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Socket } from 'socket.io-client';

import {
  createServer,
  type GameServer,
} from '../../../apps/server/src/server.js';

import type { PlayerProfilePayload, RoomJoinedPayload } from '#rts-engine';
import {
  createClient,
  type TestClientOptions,
  waitForEvent,
  waitForMembership,
  waitForState,
} from './test-support.js';

describe('player profile contract', () => {
  let server: GameServer;
  let port = 0;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    server = createServer({ port: 0, width: 50, height: 50, tickMs: 40 });
    port = await server.start();
  });

  afterEach(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    await server.stop();
  });

  function connectClient(options: TestClientOptions = {}): Socket {
    const socket = createClient(port, options);
    sockets.push(socket);
    return socket;
  }

  test('emits authoritative profiles and propagates renamed player state', async () => {
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
