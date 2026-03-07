import type { Socket } from 'socket.io-client';
import { describe, expect, vi } from 'vitest';

import type {
  ChatMessagePayload,
  MatchStartedPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomListEntryPayload,
  RoomMembershipPayload,
} from '#rts-engine';

import { createIntegrationTest } from './fixtures.js';
import { waitForEvent, waitForMembership } from './test-support.js';

const HOLD_EXPIRY_ADVANCE_MS = 31_000;
const test = createIntegrationTest({
  port: 0,
  width: 58,
  height: 58,
  tickMs: 40,
});

function normalizeMembership(payload: RoomMembershipPayload): object {
  const sortedSlots: Record<string, string | null> = {};
  for (const slotId of Object.keys(payload.slots).sort()) {
    sortedSlots[slotId] = payload.slots[slotId];
  }

  const sortedHeldSlots: Record<string, string | null> = {};
  for (const slotId of Object.keys(payload.heldSlots).sort()) {
    sortedHeldSlots[slotId] = payload.heldSlots[slotId]?.sessionId ?? null;
  }

  const participants = [...payload.participants]
    .sort((left, right) => left.sessionId.localeCompare(right.sessionId))
    .map((participant) => ({
      sessionId: participant.sessionId,
      displayName: participant.displayName,
      role: participant.role,
      slotId: participant.slotId,
      ready: participant.ready,
      connectionStatus: participant.connectionStatus,
      holdExpiresAt: participant.holdExpiresAt,
      disconnectReason: participant.disconnectReason,
    }));

  return {
    revision: payload.revision,
    status: payload.status,
    hostSessionId: payload.hostSessionId,
    slots: sortedSlots,
    participants,
    heldSlots: sortedHeldSlots,
    countdownSecondsRemaining: payload.countdownSecondsRemaining,
  };
}

async function waitForConsistentMembership(
  sockets: Socket[],
  roomId: string,
  predicate: (payload: RoomMembershipPayload) => boolean,
): Promise<RoomMembershipPayload[]> {
  const snapshots = await Promise.all(
    sockets.map((socket) => waitForMembership(socket, roomId, predicate)),
  );

  const targetRevision = Math.max(...snapshots.map(({ revision }) => revision));
  const converged = await Promise.all(
    snapshots.map((snapshot, index) => {
      if (snapshot.revision === targetRevision) {
        return Promise.resolve(snapshot);
      }

      return waitForMembership(
        sockets[index],
        roomId,
        (payload) => payload.revision === targetRevision && predicate(payload),
      );
    }),
  );

  const baseline = JSON.stringify(normalizeMembership(converged[0]));
  for (const snapshot of converged.slice(1)) {
    expect(JSON.stringify(normalizeMembership(snapshot))).toBe(baseline);
  }

  return converged;
}

describe('lobby reliability regression', () => {
  test('keeps room state deterministic across host transfer, countdown guards, spectator chat, and reconnect reclaim races', async ({
    connectClient,
  }) => {
    const host = connectClient({ sessionId: 'host-main' });
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    host.emit('room:create', {
      name: 'Reliability Room',
      width: 58,
      height: 58,
    });
    const created = await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    host.emit('room:list');
    const listedRooms = await waitForEvent<RoomListEntryPayload[]>(
      host,
      'room:list',
    );
    expect(
      listedRooms.some(
        ({ roomId, roomCode }) =>
          roomId === created.roomId && roomCode === created.roomCode,
      ),
    ).toBe(true);

    const playerTwo = connectClient({ sessionId: 'player-two' });
    await waitForEvent<RoomJoinedPayload>(playerTwo, 'room:joined');
    playerTwo.emit('room:join', { roomCode: created.roomCode });
    await waitForEvent<RoomJoinedPayload>(playerTwo, 'room:joined');

    const observer = connectClient({ sessionId: 'observer' });
    await waitForEvent<RoomJoinedPayload>(observer, 'room:joined');
    observer.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(observer, 'room:joined');

    let previousRevision = 0;
    const joinedMembership = await waitForConsistentMembership(
      [host, playerTwo, observer],
      created.roomId,
      (payload) => payload.participants.length === 3,
    );
    previousRevision = joinedMembership[0].revision;

    host.emit('room:claim-slot', { slotId: 'team-1' });
    playerTwo.emit('room:claim-slot', { slotId: 'team-2' });
    const claimedMembership = await waitForConsistentMembership(
      [host, playerTwo, observer],
      created.roomId,
      (payload) =>
        payload.slots['team-1'] === 'host-main' &&
        payload.slots['team-2'] === 'player-two',
    );
    expect(claimedMembership[0].revision).toBeGreaterThan(previousRevision);
    previousRevision = claimedMembership[0].revision;

    observer.emit('room:claim-slot', { slotId: 'team-1' });
    const slotFullError = await waitForEvent<RoomErrorPayload>(
      observer,
      'room:error',
    );
    expect(slotFullError.reason).toBe('slot-full');

    host.emit('room:leave');
    const hostTransferred = await waitForConsistentMembership(
      [playerTwo, observer],
      created.roomId,
      (payload) =>
        payload.participants.length === 2 &&
        payload.hostSessionId === 'player-two' &&
        payload.slots['team-1'] === null,
    );
    expect(hostTransferred[0].revision).toBeGreaterThan(previousRevision);
    previousRevision = hostTransferred[0].revision;

    observer.emit('room:claim-slot', { slotId: 'team-1' });
    const explicitClaim = await waitForConsistentMembership(
      [playerTwo, observer],
      created.roomId,
      (payload) =>
        payload.slots['team-1'] === 'observer' &&
        payload.participants.filter(({ role }) => role === 'player').length ===
          2,
    );
    expect(explicitClaim[0].revision).toBeGreaterThan(previousRevision);
    previousRevision = explicitClaim[0].revision;

    playerTwo.emit('room:start', { force: true });
    const notReadyError = await waitForEvent<RoomErrorPayload>(
      playerTwo,
      'room:error',
    );
    expect(notReadyError.reason).toBe('not-ready');

    let usingFakeTimers = false;
    try {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      usingFakeTimers = true;
      observer.disconnect();

      const observerHeld = await waitForMembership(
        playerTwo,
        created.roomId,
        (payload) =>
          payload.slots['team-1'] === 'observer' &&
          payload.participants.some(
            ({ sessionId, connectionStatus }) =>
              sessionId === 'observer' && connectionStatus === 'held',
          ),
        { attempts: 1000, timeoutMs: 1000 },
      );
      expect(observerHeld.heldSlots['team-1']?.sessionId).toBe('observer');

      const observerExpiredPromise = waitForMembership(
        playerTwo,
        created.roomId,
        (payload) =>
          payload.slots['team-1'] === null &&
          !payload.participants.some(
            ({ sessionId }) => sessionId === 'observer',
          ),
        { attempts: 2000, timeoutMs: 1000 },
      );

      await vi.advanceTimersByTimeAsync(HOLD_EXPIRY_ADVANCE_MS);

      const observerExpired = await observerExpiredPromise;
      expect(observerExpired.heldSlots['team-1']).toBeNull();
    } finally {
      if (usingFakeTimers) {
        vi.useRealTimers();
      }
    }

    const replacement = connectClient({ sessionId: 'replacement' });
    await waitForEvent<RoomJoinedPayload>(replacement, 'room:joined');
    replacement.emit('room:join', { roomCode: created.roomCode });
    await waitForEvent<RoomJoinedPayload>(replacement, 'room:joined');
    replacement.emit('room:claim-slot', { slotId: 'team-1' });

    const replacementClaimed = await waitForConsistentMembership(
      [playerTwo, replacement],
      created.roomId,
      (payload) => payload.slots['team-1'] === 'replacement',
    );
    expect(replacementClaimed[0].revision).toBeGreaterThan(previousRevision);
    previousRevision = replacementClaimed[0].revision;

    const observerLate = connectClient({ sessionId: 'observer' });
    await waitForEvent<RoomJoinedPayload>(observerLate, 'room:joined');
    const lateJoinedPromise = waitForEvent<RoomJoinedPayload>(
      observerLate,
      'room:joined',
    );
    const lateErrorPromise = waitForEvent<RoomErrorPayload>(
      observerLate,
      'room:error',
    );
    observerLate.emit('room:join', {
      roomId: created.roomId,
      slotId: 'team-1',
    });
    await lateJoinedPromise;
    const lateError = await lateErrorPromise;
    expect(lateError.reason).toBe('slot-full');

    playerTwo.emit('room:set-ready', { ready: true });
    replacement.emit('room:set-ready', { ready: true });
    const readyMembership = await waitForConsistentMembership(
      [playerTwo, replacement, observerLate],
      created.roomId,
      (payload) =>
        payload.participants.filter(
          ({ role, ready }) => role === 'player' && ready,
        ).length === 2,
    );
    expect(readyMembership[0].revision).toBeGreaterThan(previousRevision);
    previousRevision = readyMembership[0].revision;

    playerTwo.emit('room:start');
    await waitForMembership(
      playerTwo,
      created.roomId,
      (payload) =>
        payload.status === 'countdown' &&
        payload.countdownSecondsRemaining !== null,
      { attempts: 30, timeoutMs: 1500 },
    );

    const countdownLockedPromise = waitForEvent<RoomErrorPayload>(
      replacement,
      'room:error',
    );
    replacement.emit('room:set-ready', { ready: false });
    const countdownLocked = await countdownLockedPromise;
    expect(countdownLocked.reason).toBe('countdown-locked');

    const started = await waitForEvent<MatchStartedPayload>(
      playerTwo,
      'room:match-started',
      5000,
    );
    expect(started.roomId).toBe(created.roomId);

    await waitForMembership(
      playerTwo,
      created.roomId,
      (payload) => payload.status === 'active',
      { attempts: 20, timeoutMs: 1500 },
    );

    observerLate.emit('chat:send', { message: 'spectator visibility check' });
    const playerChat = await waitForEvent<ChatMessagePayload>(
      playerTwo,
      'chat:message',
    );
    const spectatorChat = await waitForEvent<ChatMessagePayload>(
      observerLate,
      'chat:message',
    );

    expect(playerChat.message).toBe('spectator visibility check');
    expect(spectatorChat.senderSessionId).toBe('observer');

    playerTwo.disconnect();
    const playerTwoHeld = await waitForMembership(
      replacement,
      created.roomId,
      (payload) =>
        payload.slots['team-2'] === 'player-two' &&
        payload.participants.some(
          ({ sessionId, connectionStatus }) =>
            sessionId === 'player-two' && connectionStatus === 'held',
        ),
      { attempts: 20, timeoutMs: 1500 },
    );
    expect(playerTwoHeld.heldSlots['team-2']?.sessionId ?? null).toBeNull();

    const playerTwoReconnect = connectClient({ sessionId: 'player-two' });
    await waitForEvent<RoomJoinedPayload>(playerTwoReconnect, 'room:joined');
    playerTwoReconnect.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(playerTwoReconnect, 'room:joined');

    const reclaimed = await waitForMembership(
      playerTwoReconnect,
      created.roomId,
      (payload) =>
        payload.slots['team-2'] === 'player-two' &&
        payload.heldSlots['team-2'] === null &&
        payload.participants.some(
          ({ sessionId, connectionStatus }) =>
            sessionId === 'player-two' && connectionStatus === 'connected',
        ),
      { attempts: 24, timeoutMs: 1500 },
    );
    expect(reclaimed.heldSlots['team-2']).toBeNull();

    const finalMembership = await waitForConsistentMembership(
      [playerTwoReconnect, replacement, observerLate],
      created.roomId,
      (payload) =>
        payload.slots['team-1'] === 'replacement' &&
        payload.slots['team-2'] === 'player-two' &&
        payload.participants.some(
          ({ sessionId, role, slotId }) =>
            sessionId === 'observer' && role === 'spectator' && slotId === null,
        ),
    );

    expect(finalMembership[0].revision).toBeGreaterThan(previousRevision);
  }, 90_000);
});
