import { describe, expect } from 'vitest';

import type {
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomSlotClaimedPayload,
} from '#rts-engine';

import type { ServerOptions } from '../../../apps/server/src/server.js';
import { createIntegrationTest } from './fixtures.js';
import { waitForEvent, waitForMembership } from './test-support.js';

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

const test = createIntegrationTest(DEFAULT_SERVER_OPTIONS, {
  runtimeMode: 'manual',
});

describe('lobby reconnect reliability', () => {
  test('holds disconnected slot for reclaim, releases it after timeout, and keeps late return as spectator', async ({
    connectClient,
    runtime,
  }) => {
    if (!runtime) {
      throw new Error('Expected manual runtime');
    }

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

    const heldMembershipPromise = waitForMembership(
      host,
      created.roomId,
      (payload) =>
        payload.participants.some(
          ({ sessionId, connectionStatus }) =>
            sessionId === 'session-reclaim-timeout' &&
            connectionStatus === 'held',
        ),
      { attempts: 100, overallTimeoutMs: 1_000 },
    );
    player.disconnect();

    const heldMembership = await heldMembershipPromise;
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
      { attempts: 500, overallTimeoutMs: 40_000 },
    );

    await runtime.advanceMs(HOLD_EXPIRY_ADVANCE_MS);

    const expiredMembership = await expiredMembershipPromise;
    expect(expiredMembership.heldSlots['team-1']).toBeNull();

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

  for (const { label, reconnectHoldMs } of INVALID_RECONNECT_HOLD_MS_CASES) {
    test(`falls back to default hold window when reconnectHoldMs is ${label}`, async ({
      connectClient,
      restartServer,
      runtime,
    }) => {
      if (!runtime) {
        throw new Error('Expected manual runtime');
      }

      const scheduledHoldDelays: number[] = [];
      await restartServer({
        ...DEFAULT_SERVER_OPTIONS,
        reconnectHoldMs,
        setTimeout: (callback, delayMs) => {
          scheduledHoldDelays.push(delayMs);
          return runtime.setTimeout(callback, delayMs);
        },
        clearTimeout: (timer) => runtime.clearTimeout(timer),
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

      const heldMembershipPromise = waitForMembership(
        host,
        created.roomId,
        (payload) =>
          payload.participants.some(
            ({ sessionId, connectionStatus }) =>
              sessionId === 'session-invalid-hold' &&
              connectionStatus === 'held',
          ),
        { attempts: 100, overallTimeoutMs: 1_000 },
      );

      player.disconnect();
      await heldMembershipPromise;

      expect(scheduledHoldDelays).toHaveLength(1);
      expect(scheduledHoldDelays[0]).toBe(DEFAULT_RECONNECT_HOLD_MS);
    });
  }

  test('rejects third-party claims while a disconnected player slot is held', async ({
    connectClient,
  }) => {
    const host = connectClient({ sessionId: 'host-slot-held' });
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    host.emit('room:create', {
      name: 'Held Slot Room',
      width: 50,
      height: 50,
    });
    const created = await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const player = connectClient({ sessionId: 'session-slot-held' });
    await waitForEvent<RoomJoinedPayload>(player, 'room:joined');
    player.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(player, 'room:joined');

    player.emit('room:claim-slot', { slotId: 'team-1' });
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'session-slot-held',
    );

    player.disconnect();

    const heldMembership = await waitForMembership(
      host,
      created.roomId,
      (payload) =>
        payload.heldSlots['team-1']?.sessionId === 'session-slot-held' &&
        payload.participants.some(
          ({ sessionId, connectionStatus, slotId }) =>
            sessionId === 'session-slot-held' &&
            connectionStatus === 'held' &&
            slotId === 'team-1',
        ),
      { overallTimeoutMs: 10_000 },
    );

    expect(heldMembership.slots['team-1']).toBe('session-slot-held');

    const spectator = connectClient({ sessionId: 'spectator-slot-held' });
    await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
    spectator.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');

    const claimErrorPromise = waitForEvent<RoomErrorPayload>(
      spectator,
      'room:error',
    );
    spectator.emit('room:claim-slot', { slotId: 'team-1' });

    const claimError = await claimErrorPromise;
    expect(claimError.reason).toBe('slot-held');
    expect(claimError.message).toBe(
      'Selected team slot is temporarily held for reconnect',
    );
  });

  test('allows claims into a partially open team while another commander is held', async ({
    connectClient,
  }) => {
    const host = connectClient({ sessionId: 'host-shared-hold' });
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    host.emit('room:create', {
      name: 'Shared Hold Room',
      width: 52,
      height: 52,
      slots: [
        { slotId: 'team-1', capacity: 3 },
        { slotId: 'team-2', capacity: 1 },
        { slotId: 'team-3', capacity: 1 },
      ],
    });
    const created = await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const firstCommander = connectClient({ sessionId: 'shared-hold-1' });
    await waitForEvent<RoomJoinedPayload>(firstCommander, 'room:joined');
    firstCommander.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(firstCommander, 'room:joined');

    const secondCommander = connectClient({ sessionId: 'shared-hold-2' });
    await waitForEvent<RoomJoinedPayload>(secondCommander, 'room:joined');
    secondCommander.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(secondCommander, 'room:joined');

    const reserveCommander = connectClient({ sessionId: 'shared-hold-3' });
    await waitForEvent<RoomJoinedPayload>(reserveCommander, 'room:joined');
    reserveCommander.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(reserveCommander, 'room:joined');

    const firstClaimedPromise = waitForEvent<RoomSlotClaimedPayload>(
      firstCommander,
      'room:slot-claimed',
    );
    firstCommander.emit('room:claim-slot', { slotId: 'team-1' });
    const firstClaimed = await firstClaimedPromise;

    const secondClaimedPromise = waitForEvent<RoomSlotClaimedPayload>(
      secondCommander,
      'room:slot-claimed',
    );
    secondCommander.emit('room:claim-slot', { slotId: 'team-1' });
    const secondClaimed = await secondClaimedPromise;
    expect(secondClaimed.teamId).toBe(firstClaimed.teamId);

    firstCommander.disconnect();

    const heldMembership = await waitForMembership(
      host,
      created.roomId,
      (payload) =>
        payload.heldSlotMembers['team-1']?.some(
          ({ sessionId }) => sessionId === 'shared-hold-1',
        ) ?? false,
    );
    expect(heldMembership.heldSlots['team-1']?.sessionId).toBe('shared-hold-1');

    const reserveClaimedPromise = waitForEvent<RoomSlotClaimedPayload>(
      reserveCommander,
      'room:slot-claimed',
    );
    reserveCommander.emit('room:claim-slot', { slotId: 'team-1' });
    const reserveClaimed = await reserveClaimedPromise;

    expect(reserveClaimed.teamId).toBe(firstClaimed.teamId);

    const filledMembership = await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slotMembers['team-1']?.length === 3,
    );
    expect(filledMembership.slotMembers['team-1']).toEqual([
      'shared-hold-1',
      'shared-hold-2',
      'shared-hold-3',
    ]);
    expect(filledMembership.heldSlotMembers['team-1']).toHaveLength(1);
    expect(filledMembership.heldSlotMembers['team-1']?.[0]?.sessionId).toBe(
      'shared-hold-1',
    );
  });

  test('gives reconnecting session priority over spectator slot claim races', async ({
    connectClient,
  }) => {
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

  test('keeps newest socket authoritative when the same session reconnects twice', async ({
    connectClient,
  }) => {
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

    const newestSocket = connectClient({
      sessionId: 'session-newest-wins',
      connect: false,
    });
    const newestBootstrapJoinedPromise = waitForEvent<RoomJoinedPayload>(
      newestSocket,
      'room:joined',
    );
    const staleErrorPromise = waitForEvent<RoomErrorPayload>(
      firstSocket,
      'room:error',
    );
    const staleDisconnectPromise = waitForEvent<string>(
      firstSocket,
      'disconnect',
    );

    newestSocket.connect();
    await newestBootstrapJoinedPromise;

    const newestRoomJoinedPromise = waitForEvent<RoomJoinedPayload>(
      newestSocket,
      'room:joined',
    );
    newestSocket.emit('room:join', { roomId: created.roomId });
    await newestRoomJoinedPromise;

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

  test('expires active disconnects after reconnect grace period', async ({
    connectClient,
    restartServer,
  }) => {
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
