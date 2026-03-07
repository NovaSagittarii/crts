import type { Socket } from 'socket.io-client';
import { describe, expect } from 'vitest';

import type {
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomLeftPayload,
} from '#rts-engine';

import { type ConnectClient, createIntegrationTest } from './fixtures.js';
import { createMatchTest } from './match-fixtures.js';
import {
  waitForBuildQueueResponse,
  waitForDestroyQueueResponse,
  waitForEvent,
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

const serverOptions = {
  port: 0,
  width: 52,
  height: 52,
  tickMs: 40,
  countdownSeconds: 0,
};

const integrationTest = createIntegrationTest(serverOptions);
const matchTest = createMatchTest(serverOptions, {
  roomName: 'Validation Match Room',
  hostSessionId: 'validation-host',
  guestSessionId: 'validation-guest',
});

describe('socket payload validation', () => {
  async function createLobbyRoom(
    connectClient: ConnectClient,
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

  for (const { label, payload } of INVALID_READY_CASES) {
    integrationTest(
      `rejects malformed room:set-ready payloads: ${label}`,
      async ({ connectClient }) => {
        const { owner } = await createLobbyRoom(
          connectClient,
          'ready-validation-owner',
        );
        const errorPromise = waitForEvent<RoomErrorPayload>(
          owner,
          'room:error',
        );

        owner.emit('room:set-ready', payload);

        await expect(errorPromise).resolves.toMatchObject({
          reason: 'invalid-ready',
          message: 'Invalid ready payload',
        });
      },
    );
  }

  for (const { label, payload } of INVALID_CHAT_CASES) {
    integrationTest(
      `rejects malformed chat:send payloads: ${label}`,
      async ({ connectClient }) => {
        const { owner } = await createLobbyRoom(
          connectClient,
          'chat-validation-owner',
        );
        const errorPromise = waitForEvent<RoomErrorPayload>(
          owner,
          'room:error',
        );

        owner.emit('chat:send', payload);

        await expect(errorPromise).resolves.toMatchObject({
          reason: 'invalid-chat',
          message: 'Chat message cannot be empty',
        });
      },
    );
  }

  integrationTest(
    'scopes room:error payloads for room and lobby rejections',
    async ({ connectClient }) => {
      const { owner, created } = await createLobbyRoom(
        connectClient,
        'room-error-owner',
      );

      const roomScopedErrorPromise = waitForEvent<RoomErrorPayload>(
        owner,
        'room:error',
      );
      owner.emit('chat:send', { message: '   ' });

      await expect(roomScopedErrorPromise).resolves.toMatchObject({
        reason: 'invalid-chat',
        roomId: created.roomId,
      });

      const outsider = connectClient({ sessionId: 'room-error-outsider' });
      await waitForEvent<RoomJoinedPayload>(outsider, 'room:joined');
      outsider.emit('room:leave');
      await waitForEvent<RoomLeftPayload>(outsider, 'room:left');

      const lobbyErrorPromise = waitForEvent<RoomErrorPayload>(
        outsider,
        'room:error',
      );
      outsider.emit('room:set-ready', null);

      await expect(lobbyErrorPromise).resolves.toMatchObject({
        reason: 'not-in-room',
        roomId: null,
      });
    },
  );

  for (const { label, payload } of INVALID_BUILD_CASES) {
    matchTest(
      `rejects malformed build:queue payloads: ${label}`,
      async ({ activeMatch }) => {
        const responsePromise = waitForBuildQueueResponse(
          activeMatch.host,
          4_000,
        );

        activeMatch.host.emit('build:queue', payload);

        const response = await responsePromise;
        expect('error' in response).toBe(true);
        if ('error' in response) {
          expect(response.error.reason).toBe('invalid-build');
          expect(response.error.message).toBe('Invalid build payload');
        }
      },
      10_000,
    );
  }

  for (const { label, payload } of INVALID_DESTROY_CASES) {
    matchTest(
      `rejects malformed destroy:queue payloads: ${label}`,
      async ({ activeMatch }) => {
        const responsePromise = waitForDestroyQueueResponse(
          activeMatch.host,
          4_000,
        );

        activeMatch.host.emit('destroy:queue', payload);

        const response = await responsePromise;
        expect('error' in response).toBe(true);
        if ('error' in response) {
          expect(response.error.reason).toBe('invalid-build');
          expect(response.error.message).toBe('Invalid destroy payload');
        }
      },
    );
  }
});
