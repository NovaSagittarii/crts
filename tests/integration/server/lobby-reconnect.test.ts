import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Socket } from 'socket.io-client';

import {
  createServer,
  type GameServer,
  type ServerOptions,
} from '../../../apps/server/src/server.js';

import type { RoomErrorPayload, RoomJoinedPayload } from '#rts-engine';
import {
  createClient,
  type TestClientOptions,
  waitForEvent,
  waitForMembership,
} from './test-support.js';

const HOLD_EXPIRY_ADVANCE_MS = 31_000;
const DEFAULT_RECONNECT_HOLD_MS = 30_000;

const DEFAULT_SERVER_OPTIONS: ServerOptions = {
  port: 0,
  width: 52,
  height: 52,
  tickMs: 40,
};

const INVALID_RECONNECT_HOLD_MS_CASES = [
  {
    label: 'negative value',
    reconnectHoldMs: -1,
  },
  {
    label: 'NaN',
    reconnectHoldMs: Number.NaN,
  },
  {
    label: 'Infinity',
    reconnectHoldMs: Number.POSITIVE_INFINITY,
  },
] as const;

describe('lobby reconnect reliability', () => {
  let server: GameServer;
  let port = 0;
  const sockets: Socket[] = [];

  async function restartServer(options: ServerOptions): Promise<void> {
    await server.stop();
    server = createServer(options);
    port = await server.start();
  }

  beforeEach(async () => {
    server = createServer(DEFAULT_SERVER_OPTIONS);
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

  test('holds disconnected slot for reclaim, releases it after timeout, and keeps late return as spectator', async () => {
    const host = connectClient({ sessionId: 'host-hold-timeout' });
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    host.emit('room:create', {
      name: 'Reconnect Hold Room',
      width: 52,
      height: 52,
    });
    const created = await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const player = connectClient({ sessionId: 'session-reclaim-timeout' });
    await waitForEvent<RoomJoinedPayload>(player, 'room:joined');
    player.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(player, 'room:joined');

    player.emit('room:claim-slot', { slotId: 'team-1' });
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'session-reclaim-timeout',
    );

    let usingFakeTimers = false;
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      usingFakeTimers = true;
      player.disconnect();

      const heldMembership = await waitForMembership(
        host,
        created.roomId,
        (payload) =>
          payload.participants.some(
            ({ sessionId, connectionStatus }) =>
              sessionId === 'session-reclaim-timeout' &&
              connectionStatus === 'held',
          ),
        { overallTimeoutMs: 1_000 },
      );
      const heldParticipant = heldMembership.participants.find(
        ({ sessionId }) => sessionId === 'session-reclaim-timeout',
      );
      expect(heldParticipant?.role).toBe('player');
      expect(heldParticipant?.slotId).toBe('team-1');
      expect(heldParticipant?.connectionStatus).toBe('held');
      expect(heldParticipant?.holdExpiresAt).toBeGreaterThan(Date.now());
      expect(heldMembership.heldSlots['team-1']?.sessionId).toBe(
        'session-reclaim-timeout',
      );

      const expiredMembershipPromise = waitForMembership(
        host,
        created.roomId,
        (payload) =>
          payload.slots['team-1'] === null &&
          !payload.participants.some(
            ({ sessionId }) => sessionId === 'session-reclaim-timeout',
          ),
        { overallTimeoutMs: 40_000 },
      );

      await vi.advanceTimersByTimeAsync(HOLD_EXPIRY_ADVANCE_MS);

      const expiredMembership = await expiredMembershipPromise;
      expect(expiredMembership.heldSlots['team-1']).toBeNull();
    } finally {
      if (usingFakeTimers) {
        vi.useRealTimers();
      }
    }

    const replacementPlayer = connectClient({
      sessionId: 'replacement-player',
    });
    await waitForEvent<RoomJoinedPayload>(replacementPlayer, 'room:joined');
    replacementPlayer.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(replacementPlayer, 'room:joined');
    replacementPlayer.emit('room:claim-slot', { slotId: 'team-1' });
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'replacement-player',
    );

    const lateReconnect = connectClient({
      sessionId: 'session-reclaim-timeout',
    });
    await waitForEvent<RoomJoinedPayload>(lateReconnect, 'room:joined');
    lateReconnect.emit('room:join', {
      roomId: created.roomId,
      slotId: 'team-1',
    });

    const lateError = await waitForEvent<RoomErrorPayload>(
      lateReconnect,
      'room:error',
    );
    expect(lateError.reason).toBe('slot-full');

    const finalMembership = await waitForMembership(
      host,
      created.roomId,
      (payload) =>
        payload.participants.some(
          ({ sessionId, role, slotId }) =>
            sessionId === 'session-reclaim-timeout' &&
            role === 'spectator' &&
            slotId === null,
        ),
    );

    const lateParticipant = finalMembership.participants.find(
      ({ sessionId }) => sessionId === 'session-reclaim-timeout',
    );
    expect(lateParticipant?.role).toBe('spectator');
    expect(finalMembership.slots['team-1']).toBe('replacement-player');
  }, 50_000);

  test.each(INVALID_RECONNECT_HOLD_MS_CASES)(
    'falls back to default hold window when reconnectHoldMs is $label',
    async ({ reconnectHoldMs }) => {
      const scheduledHoldDelays: number[] = [];
      await restartServer({
        ...DEFAULT_SERVER_OPTIONS,
        reconnectHoldMs,
        setTimeout: (callback, delayMs) => {
          scheduledHoldDelays.push(delayMs);
          return setTimeout(callback, delayMs);
        },
        clearTimeout: (timer) => clearTimeout(timer),
      });

      const host = connectClient({ sessionId: 'host-invalid-hold' });
      await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

      host.emit('room:create', {
        name: 'Invalid Hold Room',
        width: 52,
        height: 52,
      });
      const created = await waitForEvent<RoomJoinedPayload>(
        host,
        'room:joined',
      );

      const player = connectClient({ sessionId: 'session-invalid-hold' });
      await waitForEvent<RoomJoinedPayload>(player, 'room:joined');
      player.emit('room:join', { roomId: created.roomId });
      await waitForEvent<RoomJoinedPayload>(player, 'room:joined');

      player.emit('room:claim-slot', { slotId: 'team-1' });
      await waitForMembership(
        host,
        created.roomId,
        (payload) => payload.slots['team-1'] === 'session-invalid-hold',
      );

      player.disconnect();

      await waitForMembership(
        host,
        created.roomId,
        () => scheduledHoldDelays.length > 0,
      );

      expect(scheduledHoldDelays).toHaveLength(1);
      expect(scheduledHoldDelays[0]).toBe(DEFAULT_RECONNECT_HOLD_MS);
    },
  );

  test('gives reconnecting session priority over spectator slot claim races', async () => {
    const host = connectClient({ sessionId: 'host-race' });
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    host.emit('room:create', {
      name: 'Reconnect Race Room',
      width: 50,
      height: 50,
    });
    const created = await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const player = connectClient({ sessionId: 'session-race-player' });
    await waitForEvent<RoomJoinedPayload>(player, 'room:joined');
    player.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(player, 'room:joined');

    player.emit('room:claim-slot', { slotId: 'team-1' });
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'session-race-player',
    );

    player.disconnect();
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'session-race-player',
      { overallTimeoutMs: 10_000 },
    );

    const spectator = connectClient({ sessionId: 'session-race-spectator' });
    await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
    spectator.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');

    const reconnect = connectClient({ sessionId: 'session-race-player' });
    await waitForEvent<RoomJoinedPayload>(reconnect, 'room:joined');
    reconnect.emit('room:join', { roomId: created.roomId });
    spectator.emit('room:claim-slot', { slotId: 'team-1' });

    const raceError = await waitForEvent<RoomErrorPayload>(
      spectator,
      'room:error',
    );
    expect(raceError.reason).toBe('slot-full');
    expect(raceError.message).toBe('Selected team slot is already full');

    const finalMembership = await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'session-race-player',
    );

    const reclaimed = finalMembership.participants.find(
      ({ sessionId }) => sessionId === 'session-race-player',
    );
    expect(reclaimed?.role).toBe('player');
    expect(finalMembership.slots['team-1']).toBe('session-race-player');
  });

  test('keeps newest socket authoritative when the same session reconnects twice', async () => {
    const host = connectClient({ sessionId: 'host-newest' });
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    host.emit('room:create', {
      name: 'Newest Session Room',
      width: 48,
      height: 48,
    });
    const created = await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const firstSocket = connectClient({ sessionId: 'session-newest-wins' });
    await waitForEvent<RoomJoinedPayload>(firstSocket, 'room:joined');
    firstSocket.emit('room:join', { roomId: created.roomId, slotId: 'team-1' });
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'session-newest-wins',
    );

    const newestSocket = connectClient({ sessionId: 'session-newest-wins' });
    await waitForEvent<RoomJoinedPayload>(newestSocket, 'room:joined');
    newestSocket.emit('room:join', { roomId: created.roomId });

    const staleErrorPromise = waitForEvent<RoomErrorPayload>(
      firstSocket,
      'room:error',
    );
    const staleDisconnectPromise = waitForEvent<string>(
      firstSocket,
      'disconnect',
    );
    firstSocket.emit('room:set-ready', { ready: true });
    const staleError = await staleErrorPromise;
    expect(staleError.reason).toBe('session-replaced');
    expect([
      'This session was replaced by a newer connection',
      'This session is controlled by a newer connection',
    ]).toContain(staleError.message);
    expect(await staleDisconnectPromise).toBe('io server disconnect');

    newestSocket.emit('room:set-ready', { ready: true });
    const readyMembership = await waitForMembership(
      newestSocket,
      created.roomId,
      (payload) =>
        payload.participants.some(
          ({ sessionId, ready }) =>
            sessionId === 'session-newest-wins' && ready,
        ),
    );

    expect(
      readyMembership.participants.filter(
        ({ sessionId }) => sessionId === 'session-newest-wins',
      ),
    ).toHaveLength(1);
  });

  test('expires active disconnects after reconnect grace period', async () => {
    await restartServer({
      ...DEFAULT_SERVER_OPTIONS,
      reconnectHoldMs: 250,
    });

    const host = connectClient({ sessionId: 'host-active-expiry' });
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    host.emit('room:create', {
      name: 'Active Disconnect Expiry Room',
      width: 48,
      height: 48,
    });
    const created = await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const player = connectClient({ sessionId: 'session-active-expiry' });
    await waitForEvent<RoomJoinedPayload>(player, 'room:joined');
    player.emit('room:join', { roomId: created.roomId, slotId: 'team-1' });
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'session-active-expiry',
    );

    host.emit('room:claim-slot', { slotId: 'team-2' });
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-2'] === 'host-active-expiry',
    );

    player.emit('room:set-ready', { ready: true });
    host.emit('room:set-ready', { ready: true });
    await waitForMembership(
      host,
      created.roomId,
      (payload) =>
        payload.participants.filter(({ ready }) => ready).length >= 2,
    );

    host.emit('room:start', {});
    await waitForEvent<{ roomId: string }>(host, 'room:match-started', 15_000);
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.status === 'active',
      { overallTimeoutMs: 15_000 },
    );

    player.disconnect();
    const heldMembership = await waitForMembership(
      host,
      created.roomId,
      (payload) =>
        payload.participants.some(
          ({ sessionId, connectionStatus }) =>
            sessionId === 'session-active-expiry' &&
            connectionStatus === 'held',
        ),
    );
    expect(heldMembership.heldSlots['team-1']).toBeNull();

    const expiredMembership = await waitForMembership(
      host,
      created.roomId,
      (payload) =>
        payload.slots['team-1'] === null &&
        payload.participants.every(
          ({ sessionId }) => sessionId !== 'session-active-expiry',
        ),
      { overallTimeoutMs: 15_000 },
    );
    expect(expiredMembership.slots['team-1']).toBeNull();
  }, 30_000);
});
