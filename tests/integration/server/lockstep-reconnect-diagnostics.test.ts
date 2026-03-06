import { describe, expect, test } from 'vitest';
import type { Socket } from 'socket.io-client';

import { createServer } from '../../../apps/server/src/server.js';
import type {
  LockstepCheckpointPayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  RoomSlotClaimedPayload,
} from '#rts-engine';
import {
  createClient,
  waitForEvent,
  waitForMembership,
} from './test-support.js';

async function claimSlot(socket: Socket, slotId: string): Promise<number> {
  const claimedPromise = waitForEvent<RoomSlotClaimedPayload>(
    socket,
    'room:slot-claimed',
  );
  socket.emit('room:claim-slot', { slotId });
  const claimed = await claimedPromise;
  if (claimed.teamId === null) {
    throw new Error(`Expected ${slotId} claim to assign a team`);
  }
  return claimed.teamId;
}

describe('lockstep reconnect diagnostics', () => {
  test('rejoining receives latest checkpoint and hash diagnostics', async () => {
    const server = createServer({
      port: 0,
      width: 52,
      height: 52,
      tickMs: 40,
      countdownSeconds: 0,
      lockstepMode: 'shadow',
      lockstepCheckpointIntervalTicks: 1,
    });
    const port = await server.start();

    let host: Socket | null = null;
    let guest: Socket | null = null;

    try {
      host = createClient(port, { sessionId: 'diag-host' });
      await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

      const createdPromise = waitForEvent<RoomJoinedPayload>(
        host,
        'room:joined',
      );
      host.emit('room:create', {
        name: 'Lockstep Diagnostics Room',
        width: 52,
        height: 52,
      });
      const hostJoined = await createdPromise;

      guest = createClient(port, { sessionId: 'diag-guest' });
      await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

      const guestJoinedPromise = waitForEvent<RoomJoinedPayload>(
        guest,
        'room:joined',
      );
      guest.emit('room:join', { roomId: hostJoined.roomId });
      const guestJoined = await guestJoinedPromise;

      await claimSlot(host, 'team-1');
      await claimSlot(guest, 'team-2');

      await waitForMembership(
        host,
        hostJoined.roomId,
        (payload: RoomMembershipPayload) =>
          payload.slots['team-1'] === hostJoined.playerId &&
          payload.slots['team-2'] === guestJoined.playerId,
      );

      const readyMembershipPromise = waitForMembership(
        host,
        hostJoined.roomId,
        (payload: RoomMembershipPayload) =>
          payload.participants.filter(
            ({ role, ready }) => role === 'player' && ready,
          ).length === 2,
      );
      host.emit('room:set-ready', { ready: true });
      guest.emit('room:set-ready', { ready: true });
      await readyMembershipPromise;

      host.emit('room:start');
      await waitForEvent(host, 'room:match-started', 7_000);

      await waitForEvent<LockstepCheckpointPayload>(
        host,
        'lockstep:checkpoint',
        4_000,
      );

      guest.close();
      guest = createClient(port, { sessionId: 'diag-guest' });

      const checkpointAfterReconnectPromise =
        waitForEvent<LockstepCheckpointPayload>(
          guest,
          'lockstep:checkpoint',
          4_000,
        );

      const rejoined = await waitForEvent<RoomJoinedPayload>(
        guest,
        'room:joined',
      );
      expect(rejoined.roomId).toBe(hostJoined.roomId);
      expect(rejoined.lockstep?.lastPrimaryHash).toMatch(/^[0-9a-f]{8}$/);
      expect(rejoined.lockstep?.mismatchCount).toBe(0);

      const replayedCheckpoint = await checkpointAfterReconnectPromise;
      expect(replayedCheckpoint.roomId).toBe(hostJoined.roomId);
      expect(replayedCheckpoint.hashHex).toBe(
        rejoined.lockstep?.lastPrimaryHash,
      );
      expect(replayedCheckpoint.mode).toBe('shadow');
    } finally {
      host?.close();
      guest?.close();
      await server.stop();
    }
  }, 25_000);
});
