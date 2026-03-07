import { describe, expect, test } from 'vitest';
import type { Socket } from 'socket.io-client';

import { createServer } from '../../../apps/server/src/server.js';
import type {
  BuildQueueRejectedPayload,
  BuildQueuedPayload,
  DestroyQueueRejectedPayload,
  LockstepCheckpointPayload,
  LockstepFallbackPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  RoomSlotClaimedPayload,
  TeamPayload,
} from '#rts-engine';
import {
  createClient,
  waitForBuildQueueResponse,
  waitForBuildScheduled,
  waitForDestroyQueueResponse,
  waitForDestroyScheduled,
  waitForEvent,
  waitForMembership,
  waitForState,
  waitForStateStructures,
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

function waitForBuildResponses(
  socket: Socket,
  count: number,
  timeoutMs = 4_000,
): Promise<
  Array<
    | { kind: 'queued'; payload: BuildQueuedPayload }
    | { kind: 'error'; payload: RoomErrorPayload }
  >
> {
  return new Promise((resolve, reject) => {
    const responses: Array<
      | { kind: 'queued'; payload: BuildQueuedPayload }
      | { kind: 'error'; payload: RoomErrorPayload }
    > = [];
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${count} build responses`));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      socket.off('build:queued', onQueued);
      socket.off('room:error', onError);
    }

    function onQueued(payload: BuildQueuedPayload): void {
      responses.push({ kind: 'queued', payload });
      if (responses.length >= count) {
        cleanup();
        resolve(responses);
      }
    }

    function onError(payload: RoomErrorPayload): void {
      responses.push({ kind: 'error', payload });
      if (responses.length >= count) {
        cleanup();
        resolve(responses);
      }
    }

    socket.on('build:queued', onQueued);
    socket.on('room:error', onError);
  });
}

describe('lockstep primary mode', () => {
  test('buffers queue commands and emits checkpoints without fallback', async () => {
    const server = createServer({
      port: 0,
      width: 52,
      height: 52,
      tickMs: 40,
      countdownSeconds: 0,
      lockstepMode: 'primary',
      lockstepCheckpointIntervalTicks: 1,
    });
    const port = await server.start();

    let host: Socket | null = null;
    let guest: Socket | null = null;

    try {
      host = createClient(port, { sessionId: 'primary-host' });
      await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

      const createdPromise = waitForEvent<RoomJoinedPayload>(
        host,
        'room:joined',
      );
      host.emit('room:create', {
        name: 'Primary Lockstep Room',
        width: 52,
        height: 52,
      });
      const hostJoined = await createdPromise;

      expect(hostJoined.lockstep?.mode).toBe('primary');
      expect(hostJoined.lockstep?.status).toBe('running');

      guest = createClient(port, { sessionId: 'primary-guest' });
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

      host.emit('room:start');
      await waitForEvent(host, 'room:match-started', 7_000);

      const firstCheckpoint = await waitForEvent<LockstepCheckpointPayload>(
        host,
        'lockstep:checkpoint',
        4_000,
      );
      expect(firstCheckpoint.roomId).toBe(hostJoined.roomId);
      expect(firstCheckpoint.mode).toBe('primary');
      expect(firstCheckpoint.hashHex).toMatch(/^[0-9a-f]{8}$/);

      const state = await waitForState(
        host,
        (payload) =>
          payload.roomId === hostJoined.roomId &&
          payload.teams.some(({ playerIds }) =>
            playerIds.includes(hostJoined.playerId),
          ),
        {
          roomId: hostJoined.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const team = resolveTeamForPlayer(state.teams, hostJoined.playerId);

      host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
      });

      const queued = await waitForBuildQueueResponse(host, 4_000);
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
      expect(secondCheckpoint.mode).toBe('primary');

      expect(fallbackEvents).toEqual([]);

      host.off('lockstep:fallback');
    } finally {
      host?.close();
      guest?.close();
      await server.stop();
    }
  }, 25_000);

  test('uses turn boundaries for primary queue flush when turn ticks > 1', async () => {
    const server = createServer({
      port: 0,
      width: 52,
      height: 52,
      tickMs: 30,
      countdownSeconds: 0,
      lockstepMode: 'primary',
      lockstepTurnTicks: 20,
      lockstepCheckpointIntervalTicks: 1,
    });
    const port = await server.start();

    let host: Socket | null = null;
    let guest: Socket | null = null;

    try {
      host = createClient(port, { sessionId: 'primary-boundary-host' });
      await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

      const createdPromise = waitForEvent<RoomJoinedPayload>(
        host,
        'room:joined',
      );
      host.emit('room:create', {
        name: 'Primary Turn Boundary Room',
        width: 52,
        height: 52,
      });
      const hostJoined = await createdPromise;

      guest = createClient(port, { sessionId: 'primary-boundary-guest' });
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

      const state = await waitForState(
        host,
        (payload) =>
          payload.roomId === hostJoined.roomId &&
          payload.teams.some(({ playerIds }) =>
            playerIds.includes(hostJoined.playerId),
          ),
        {
          roomId: hostJoined.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const team = resolveTeamForPlayer(state.teams, hostJoined.playerId);
      const scheduledPromise = waitForBuildScheduled(host, 5_000);

      host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
      });

      await expect(
        waitForEvent<BuildQueuedPayload>(host, 'build:queued', 250),
      ).rejects.toThrow(/timed out/i);

      await expect(waitForBuildScheduled(host, 250)).rejects.toThrow(
        /timed out/i,
      );

      const queued = await waitForBuildQueueResponse(host, 5_000);
      if ('error' in queued) {
        throw new Error(
          `Build queue rejected: ${queued.error.reason ?? queued.error.message}`,
        );
      }

      const scheduled = await scheduledPromise;
      expect(scheduled.intentId).toBe(queued.queued.intentId);
      expect(scheduled.eventId).toBe(queued.queued.eventId);
      expect(scheduled.executeTick).toBe(queued.queued.executeTick);
    } finally {
      host?.close();
      guest?.close();
      await server.stop();
    }
  }, 30_000);

  test('falls back on turn-buffer-overflow and still responds to queued commands', async () => {
    const server = createServer({
      port: 0,
      width: 52,
      height: 52,
      tickMs: 30,
      countdownSeconds: 0,
      lockstepMode: 'primary',
      lockstepTurnTicks: 20,
      lockstepMaxBufferedCommands: 4,
      lockstepCheckpointIntervalTicks: 1,
    });
    const port = await server.start();

    let host: Socket | null = null;
    let guest: Socket | null = null;

    try {
      host = createClient(port, { sessionId: 'primary-overflow-host' });
      await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

      const createdPromise = waitForEvent<RoomJoinedPayload>(
        host,
        'room:joined',
      );
      host.emit('room:create', {
        name: 'Primary Overflow Room',
        width: 52,
        height: 52,
      });
      const hostJoined = await createdPromise;

      guest = createClient(port, { sessionId: 'primary-overflow-guest' });
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

      const state = await waitForState(
        host,
        (payload) =>
          payload.roomId === hostJoined.roomId &&
          payload.teams.some(({ playerIds }) =>
            playerIds.includes(hostJoined.playerId),
          ),
        {
          roomId: hostJoined.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const team = resolveTeamForPlayer(state.teams, hostJoined.playerId);

      const queuedPromise = waitForEvent<BuildQueuedPayload>(
        host,
        'build:queued',
        6_000,
      );
      const fallbackPromise = waitForEvent<LockstepFallbackPayload>(
        host,
        'lockstep:fallback',
        6_000,
      );

      for (const offset of [8, 10, 12, 14, 16]) {
        host.emit('build:queue', {
          templateId: 'block',
          x: team.baseTopLeft.x + offset,
          y: team.baseTopLeft.y + offset,
        });
      }

      const [queued, fallback] = await Promise.all([
        queuedPromise,
        fallbackPromise,
      ]);
      expect(queued.playerId).toBe(hostJoined.playerId);
      expect(queued.teamId).toBe(team.id);
      expect(fallback.reason).toBe('turn-buffer-overflow');

      await waitForMembership(
        host,
        hostJoined.roomId,
        (payload: RoomMembershipPayload) =>
          payload.lockstep?.status === 'fallback' &&
          payload.lockstep.lastFallbackReason === 'turn-buffer-overflow',
      );
    } finally {
      host?.close();
      guest?.close();
      await server.stop();
    }
  }, 30_000);

  test('rejects buffered primary commands if match finishes before turn flush', async () => {
    const server = createServer({
      port: 0,
      width: 52,
      height: 52,
      tickMs: 30,
      countdownSeconds: 0,
      lockstepMode: 'primary',
      lockstepTurnTicks: 50,
      lockstepCheckpointIntervalTicks: 1,
    });
    const port = await server.start();

    let host: Socket | null = null;
    let guest: Socket | null = null;
    let spectator: Socket | null = null;

    try {
      host = createClient(port, { sessionId: 'primary-finish-host' });
      const hostJoined = await waitForEvent<RoomJoinedPayload>(
        host,
        'room:joined',
      );

      guest = createClient(port, { sessionId: 'primary-finish-guest' });
      await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');
      guest.emit('room:join', { roomId: hostJoined.roomId });
      const guestJoined = await waitForEvent<RoomJoinedPayload>(
        guest,
        'room:joined',
      );

      spectator = createClient(port, { sessionId: 'primary-finish-spectator' });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
      spectator.emit('room:join', { roomId: hostJoined.roomId });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');

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

      const state = await waitForState(
        host,
        (payload) =>
          payload.roomId === hostJoined.roomId &&
          payload.teams.some(({ playerIds }) =>
            playerIds.includes(hostJoined.playerId),
          ),
        {
          roomId: hostJoined.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const team = resolveTeamForPlayer(state.teams, hostJoined.playerId);
      const scheduledPromise = waitForBuildScheduled(spectator, 2_000).catch(
        (error: unknown) => error,
      );
      const rejectedPromise = waitForEvent<BuildQueueRejectedPayload>(
        spectator,
        'build:queue-rejected',
        2_000,
      );

      host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
      });

      await expect(waitForBuildQueueResponse(host, 500)).rejects.toThrow(
        /timed out/i,
      );

      host.emit('room:leave');
      guest.emit('room:leave');

      await expect(rejectedPromise).resolves.toMatchObject({
        roomId: hostJoined.roomId,
        intentId: expect.stringMatching(/^intent-/),
        teamId: team.id,
        reason: 'match-finished',
      });
      await expect(scheduledPromise).resolves.toBeInstanceOf(Error);
    } finally {
      host?.close();
      guest?.close();
      spectator?.close();
      await server.stop();
    }
  }, 30_000);

  test('rejects buffered primary destroy intents if match finishes before turn flush', async () => {
    const server = createServer({
      port: 0,
      width: 52,
      height: 52,
      tickMs: 30,
      countdownSeconds: 0,
      lockstepMode: 'primary',
      lockstepTurnTicks: 50,
      lockstepCheckpointIntervalTicks: 1,
    });
    const port = await server.start();

    let host: Socket | null = null;
    let guest: Socket | null = null;
    let spectator: Socket | null = null;

    try {
      host = createClient(port, { sessionId: 'primary-finish-destroy-host' });
      const hostJoined = await waitForEvent<RoomJoinedPayload>(
        host,
        'room:joined',
      );

      guest = createClient(port, { sessionId: 'primary-finish-destroy-guest' });
      await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');
      guest.emit('room:join', { roomId: hostJoined.roomId });
      const guestJoined = await waitForEvent<RoomJoinedPayload>(
        guest,
        'room:joined',
      );

      spectator = createClient(port, {
        sessionId: 'primary-finish-destroy-spectator',
      });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
      spectator.emit('room:join', { roomId: hostJoined.roomId });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');

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

      const state = await waitForState(
        host,
        (payload) =>
          payload.roomId === hostJoined.roomId &&
          payload.teams.some(({ playerIds }) =>
            playerIds.includes(hostJoined.playerId),
          ),
        {
          roomId: hostJoined.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const team = resolveTeamForPlayer(state.teams, hostJoined.playerId);
      const structures = await waitForStateStructures(
        host,
        (payload) =>
          payload.roomId === hostJoined.roomId &&
          payload.teams.some(
            (teamState) =>
              teamState.id === team.id && teamState.structures.length > 0,
          ),
        {
          roomId: hostJoined.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const ownStructure = structures.teams
        .find((teamState) => teamState.id === team.id)
        ?.structures.at(0);
      if (!ownStructure) {
        throw new Error('Expected an owned structure to destroy');
      }

      const scheduledPromise = waitForDestroyScheduled(spectator, 2_000).catch(
        (error: unknown) => error,
      );
      const rejectedPromise = waitForEvent<DestroyQueueRejectedPayload>(
        spectator,
        'destroy:queue-rejected',
        2_000,
      );

      host.emit('destroy:queue', {
        structureKey: ownStructure.key,
      });

      await expect(waitForDestroyQueueResponse(host, 500)).rejects.toThrow(
        /timed out/i,
      );

      host.emit('room:leave');
      guest.emit('room:leave');

      await expect(rejectedPromise).resolves.toMatchObject({
        roomId: hostJoined.roomId,
        intentId: expect.stringMatching(/^intent-/),
        teamId: team.id,
        structureKey: ownStructure.key,
        reason: 'match-finished',
      });
      await expect(scheduledPromise).resolves.toBeInstanceOf(Error);
    } finally {
      host?.close();
      guest?.close();
      spectator?.close();
      await server.stop();
    }
  }, 30_000);

  test('emits buffered build rejection when primary replay validation fails', async () => {
    const server = createServer({
      port: 0,
      width: 52,
      height: 52,
      tickMs: 30,
      countdownSeconds: 0,
      lockstepMode: 'primary',
      lockstepTurnTicks: 50,
      lockstepCheckpointIntervalTicks: 1,
    });
    const port = await server.start();

    let host: Socket | null = null;
    let guest: Socket | null = null;

    try {
      host = createClient(port, { sessionId: 'primary-reject-host' });
      const hostJoined = await waitForEvent<RoomJoinedPayload>(
        host,
        'room:joined',
      );

      guest = createClient(port, { sessionId: 'primary-reject-guest' });
      const guestJoined = await waitForEvent<RoomJoinedPayload>(
        guest,
        'room:joined',
      );

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

      const state = await waitForState(
        host,
        (payload) =>
          payload.roomId === hostJoined.roomId &&
          payload.teams.some(({ playerIds }) =>
            playerIds.includes(hostJoined.playerId),
          ),
        {
          roomId: hostJoined.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const team = resolveTeamForPlayer(state.teams, hostJoined.playerId);
      const opposingTeam = state.teams.find(({ id }) => id !== team.id);
      if (!opposingTeam) {
        throw new Error(
          'Expected an opposing team to validate territory rejection',
        );
      }

      const scheduledPromise = waitForBuildScheduled(host, 2_000).catch(
        (error: unknown) => error,
      );
      const rejectedPromise = waitForEvent<BuildQueueRejectedPayload>(
        host,
        'build:queue-rejected',
        2_000,
      );

      host.emit('build:queue', {
        templateId: 'block',
        x: opposingTeam.baseTopLeft.x + 1,
        y: opposingTeam.baseTopLeft.y + 1,
      });

      await expect(waitForBuildQueueResponse(host, 500)).rejects.toThrow(
        /timed out/i,
      );

      await expect(rejectedPromise).resolves.toMatchObject({
        roomId: hostJoined.roomId,
        intentId: expect.stringMatching(/^intent-/),
        teamId: team.id,
        reason: 'outside-territory',
      });
      await expect(scheduledPromise).resolves.toBeInstanceOf(Error);
    } finally {
      host?.close();
      guest?.close();
      await server.stop();
    }
  }, 30_000);
});
