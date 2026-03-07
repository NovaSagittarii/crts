import { describe, expect } from 'vitest';

import type {
  LockstepCheckpointPayload,
  LockstepFallbackPayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  TeamPayload,
} from '#rts-engine';

import { createLockstepTest } from './lockstep-fixtures.js';
import {
  claimSlot,
  waitForBuildQueueResponse,
  waitForEvent,
  waitForMembership,
  waitForState,
} from './test-support.js';

const test = createLockstepTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 40,
    lockstepMode: 'shadow',
    lockstepCheckpointIntervalTicks: 1,
  },
  {
    roomName: 'Shadow Lockstep Room',
    hostSessionId: 'shadow-host',
    guestSessionId: 'shadow-guest',
  },
);

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

describe('lockstep shadow mode', () => {
  test('emits checkpoints and avoids fallback during normal queue flow', async ({
    connectedRoom,
  }) => {
    const host = connectedRoom.host;
    const guest = connectedRoom.guest;
    const hostJoined = connectedRoom.hostJoined;
    const guestJoined = connectedRoom.guestJoined;

    expect(hostJoined.lockstep?.mode).toBe('shadow');
    expect(hostJoined.lockstep?.status).toBe('running');

    await claimSlot(host, 'team-1');
    const hostLeftPromise = waitForEvent(host, 'room:left');
    host.emit('room:leave');
    await hostLeftPromise;

    const hostRejoinedPromise = waitForEvent<RoomJoinedPayload>(
      host,
      'room:joined',
    );
    host.emit('room:join', { roomId: connectedRoom.roomId });
    const hostRejoined = await hostRejoinedPromise;

    await claimSlot(host, 'team-1');
    await claimSlot(guest, 'team-2');

    await waitForMembership(
      host,
      connectedRoom.roomId,
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
      connectedRoom.roomId,
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
    expect(firstCheckpoint.roomId).toBe(connectedRoom.roomId);
    expect(firstCheckpoint.mode).toBe('shadow');
    expect(firstCheckpoint.hashHex).toMatch(/^[0-9a-f]{8}$/);

    const state = await waitForState(
      host,
      (payload) =>
        payload.roomId === connectedRoom.roomId &&
        payload.teams.some(({ playerIds }) =>
          playerIds.includes(hostRejoined.playerId),
        ),
      {
        roomId: connectedRoom.roomId,
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
    expect(secondCheckpoint.tick).toBeGreaterThanOrEqual(firstCheckpoint.tick);
    expect(secondCheckpoint.mode).toBe('shadow');

    expect(fallbackEvents).toEqual([]);

    host.off('lockstep:fallback');
  }, 25_000);
});
