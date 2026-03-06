import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Socket } from 'socket.io-client';

import {
  createServer,
  type GameServer,
} from '../../../apps/server/src/server.js';

import type {
  MatchStartedPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomSlotClaimedPayload,
} from '#rts-engine';
import {
  createClient,
  type TestClientOptions,
  waitForBuildQueueResponse,
  waitForDestroyQueueResponse,
  waitForEvent,
  waitForMembership,
  waitForState,
} from './test-support.js';

const INVALID_READY_CASES = [
  { label: 'null payload', payload: null },
  { label: 'missing ready flag', payload: {} },
  { label: 'non-boolean ready', payload: { ready: 'yes' } },
] as const;

const INVALID_CHAT_CASES = [
  { label: 'null payload', payload: null },
  { label: 'missing message', payload: {} },
  { label: 'blank message', payload: { message: '   ' } },
] as const;

const INVALID_BUILD_CASES = [
  { label: 'null payload', payload: null },
  {
    label: 'invalid transform operations',
    payload: {
      templateId: 'block',
      x: 1,
      y: 1,
      transform: { operations: 'rotate' },
    },
  },
] as const;

const INVALID_DESTROY_CASES = [
  { label: 'null payload', payload: null },
  { label: 'missing structure key', payload: {} },
  { label: 'blank structure key', payload: { structureKey: '   ' } },
] as const;

describe('socket payload validation', () => {
  let server: GameServer;
  let port = 0;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    server = createServer({
      port: 0,
      width: 52,
      height: 52,
      tickMs: 40,
      countdownSeconds: 0,
    });
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

  async function claimSlot(
    socket: Socket,
    roomId: string,
    slotId: string,
  ): Promise<RoomSlotClaimedPayload> {
    const claimedPromise = waitForEvent<RoomSlotClaimedPayload>(
      socket,
      'room:slot-claimed',
    );
    socket.emit('room:claim-slot', { slotId });
    const claimed = await claimedPromise;
    await waitForMembership(
      socket,
      roomId,
      (payload) => payload.slots[slotId] !== null,
    );
    return claimed;
  }

  async function createLobbyRoom(
    sessionId: string,
  ): Promise<{ owner: Socket; created: RoomJoinedPayload }> {
    const owner = connectClient({ sessionId });
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', {
      name: `${sessionId} room`,
      width: 50,
      height: 50,
    });

    const created = await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');
    return { owner, created };
  }

  async function setupActiveMatch(): Promise<{
    host: Socket;
    guest: Socket;
    roomId: string;
    hostJoined: RoomJoinedPayload;
    guestJoined: RoomJoinedPayload;
  }> {
    const host = connectClient({ sessionId: 'validation-host' });
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    host.emit('room:create', {
      name: 'Validation Match Room',
      width: 52,
      height: 52,
    });
    const hostJoined = await waitForEvent<RoomJoinedPayload>(
      host,
      'room:joined',
    );

    const guest = connectClient({ sessionId: 'validation-guest' });
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');
    guest.emit('room:join', { roomId: hostJoined.roomId });
    const guestJoined = await waitForEvent<RoomJoinedPayload>(
      guest,
      'room:joined',
    );

    await claimSlot(host, hostJoined.roomId, 'team-1');
    await claimSlot(guest, hostJoined.roomId, 'team-2');

    host.emit('room:set-ready', { ready: true });
    guest.emit('room:set-ready', { ready: true });
    await waitForMembership(
      host,
      hostJoined.roomId,
      (payload) =>
        payload.participants.filter(
          ({ role, ready }) => role === 'player' && ready,
        ).length === 2,
      { overallTimeoutMs: 8_000 },
    );

    const matchStartedPromise = waitForEvent<MatchStartedPayload>(
      host,
      'room:match-started',
      8_000,
    );
    host.emit('room:start');
    await matchStartedPromise;

    await waitForState(
      host,
      (payload) =>
        payload.roomId === hostJoined.roomId &&
        payload.teams.some(({ playerIds }) =>
          playerIds.includes(hostJoined.playerId),
        ) &&
        payload.teams.some(({ playerIds }) =>
          playerIds.includes(guestJoined.playerId),
        ),
      {
        roomId: hostJoined.roomId,
        overallTimeoutMs: 8_000,
      },
    );

    return {
      host,
      guest,
      roomId: hostJoined.roomId,
      hostJoined,
      guestJoined,
    };
  }

  test.each(INVALID_READY_CASES)(
    'rejects malformed room:set-ready payloads: $label',
    async ({ payload }) => {
      const { owner } = await createLobbyRoom('ready-validation-owner');
      const errorPromise = waitForEvent<RoomErrorPayload>(owner, 'room:error');

      owner.emit('room:set-ready', payload);

      await expect(errorPromise).resolves.toMatchObject({
        reason: 'invalid-ready',
        message: 'Invalid ready payload',
      });
    },
  );

  test.each(INVALID_CHAT_CASES)(
    'rejects malformed chat:send payloads: $label',
    async ({ payload }) => {
      const { owner } = await createLobbyRoom('chat-validation-owner');
      const errorPromise = waitForEvent<RoomErrorPayload>(owner, 'room:error');

      owner.emit('chat:send', payload);

      await expect(errorPromise).resolves.toMatchObject({
        reason: 'invalid-chat',
        message: 'Chat message cannot be empty',
      });
    },
  );

  test.each(INVALID_BUILD_CASES)(
    'rejects malformed build:preview payloads: $label',
    async ({ payload }) => {
      const { host } = await setupActiveMatch();
      const errorPromise = waitForEvent<RoomErrorPayload>(host, 'room:error');

      host.emit('build:preview', payload);

      await expect(errorPromise).resolves.toMatchObject({
        reason: 'invalid-build',
        message: 'Invalid build payload',
      });
    },
  );

  test.each(INVALID_BUILD_CASES)(
    'rejects malformed build:queue payloads: $label',
    async ({ payload }) => {
      const { host } = await setupActiveMatch();
      const responsePromise = waitForBuildQueueResponse(host, 4_000);

      host.emit('build:queue', payload);

      const response = await responsePromise;
      expect('error' in response).toBe(true);
      if ('error' in response) {
        expect(response.error.reason).toBe('invalid-build');
        expect(response.error.message).toBe('Invalid build payload');
      }
    },
  );

  test.each(INVALID_DESTROY_CASES)(
    'rejects malformed destroy:queue payloads: $label',
    async ({ payload }) => {
      const { host } = await setupActiveMatch();
      const responsePromise = waitForDestroyQueueResponse(host, 4_000);

      host.emit('destroy:queue', payload);

      const response = await responsePromise;
      expect('error' in response).toBe(true);
      if ('error' in response) {
        expect(response.error.reason).toBe('invalid-build');
        expect(response.error.message).toBe('Invalid destroy payload');
      }
    },
  );
});
