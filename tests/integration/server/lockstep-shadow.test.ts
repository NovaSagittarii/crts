import { describe, expect, test } from 'vitest';
import type { Socket } from 'socket.io-client';

import { createServer } from '../../../apps/server/src/server.js';
import type {
  LockstepCheckpointPayload,
  LockstepFallbackPayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  RoomSlotClaimedPayload,
  TeamPayload,
} from '#rts-engine';
import {
  createClient,
  waitForBuildQueueResponse,
  waitForEvent,
  waitForMembership,
  waitForState,
} from './test-support.js';

function resolveTeamForPlayer(
  teams: TeamPayload[],
  playerId: string,
): TeamPayload {
  const team = teams.find(({ playerIds }) => playerIds.includes(playerId));
  if (!team) {
    throw new Error(`Failed to find team for player ${playerId}`);
  }
  return team;
}

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

describe('lockstep shadow mode', () => {
  test('emits checkpoints and avoids fallback during normal queue flow', async () => {
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
      host = createClient(port, { sessionId: 'shadow-host' });
      await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

      const createdPromise = waitForEvent<RoomJoinedPayload>(
        host,
        'room:joined',
      );
      host.emit('room:create', {
        name: 'Shadow Lockstep Room',
        width: 52,
        height: 52,
      });
      const hostJoined = await createdPromise;

      expect(hostJoined.lockstep?.mode).toBe('shadow');
      expect(hostJoined.lockstep?.status).toBe('running');

      guest = createClient(port, { sessionId: 'shadow-guest' });
      await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

      const guestJoinedPromise = waitForEvent<RoomJoinedPayload>(
        guest,
        'room:joined',
      );
      guest.emit('room:join', { roomId: hostJoined.roomId });
      const guestJoined = await guestJoinedPromise;

      await claimSlot(host, 'team-1');
      const hostLeftPromise = waitForEvent(host, 'room:left');
      host.emit('room:leave');
      await hostLeftPromise;

      const hostRejoinedPromise = waitForEvent<RoomJoinedPayload>(
        host,
        'room:joined',
      );
      host.emit('room:join', { roomId: hostJoined.roomId });
      const hostRejoined = await hostRejoinedPromise;

      await claimSlot(host, 'team-1');
      await claimSlot(guest, 'team-2');

      await waitForMembership(
        host,
        hostJoined.roomId,
        (payload: RoomMembershipPayload) =>
          payload.slots['team-1'] === hostRejoined.playerId &&
          payload.slots['team-2'] === guestJoined.playerId,
      );

      const fallbackEvents: LockstepFallbackPayload[] = [];
      host.on('lockstep:fallback', (payload: LockstepFallbackPayload) => {
        fallbackEvents.push(payload);
      });

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

      guest.emit('room:start');
      await waitForEvent(host, 'room:match-started', 7_000);

      const firstCheckpoint = await waitForEvent<LockstepCheckpointPayload>(
        host,
        'lockstep:checkpoint',
        4_000,
      );
      expect(firstCheckpoint.roomId).toBe(hostJoined.roomId);
      expect(firstCheckpoint.mode).toBe('shadow');
      expect(firstCheckpoint.hashHex).toMatch(/^[0-9a-f]{8}$/);

      const state = await waitForState(
        host,
        (payload) =>
          payload.roomId === hostJoined.roomId &&
          payload.teams.some(({ playerIds }) =>
            playerIds.includes(hostRejoined.playerId),
          ),
        {
          roomId: hostJoined.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const team = resolveTeamForPlayer(state.teams, hostRejoined.playerId);

      host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
      });
      const queued = await waitForBuildQueueResponse(host, 3_000);
      if ('error' in queued) {
        throw new Error(
          `Build queue rejected: ${queued.error.reason ?? queued.error.message}`,
        );
      }

      const secondCheckpoint = await waitForEvent<LockstepCheckpointPayload>(
        host,
        'lockstep:checkpoint',
        4_000,
      );
      expect(secondCheckpoint.tick).toBeGreaterThanOrEqual(
        firstCheckpoint.tick,
      );
      expect(secondCheckpoint.mode).toBe('shadow');

      expect(fallbackEvents).toEqual([]);

      host.off('lockstep:fallback');
    } finally {
      host?.close();
      guest?.close();
      await server.stop();
    }
  }, 25_000);
});
