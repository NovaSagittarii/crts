import { describe, expect } from 'vitest';
import type { Socket } from 'socket.io-client';

import type {
  BuildQueueRejectedPayload,
  BuildQueuedPayload,
  DestroyQueueRejectedPayload,
  LockstepCheckpointPayload,
  LockstepFallbackPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
  TeamPayload,
} from '#rts-engine';
import {
  waitForBuildQueueResponse,
  waitForBuildScheduled,
  waitForDestroyQueueResponse,
  waitForDestroyScheduled,
  waitForEvent,
  waitForMembership,
  waitForState,
  waitForStateStructures,
} from './test-support.js';
import { createLockstepTest } from './lockstep-fixtures.js';

const primaryTest = createLockstepTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 40,
    lockstepMode: 'primary',
    lockstepCheckpointIntervalTicks: 1,
  },
  {
    roomName: 'Primary Lockstep Room',
    hostSessionId: 'primary-host',
    guestSessionId: 'primary-guest',
  },
);
const boundaryTest = createLockstepTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 30,
    lockstepMode: 'primary',
    lockstepTurnTicks: 20,
    lockstepCheckpointIntervalTicks: 1,
  },
  {
    roomName: 'Primary Turn Boundary Room',
    hostSessionId: 'primary-boundary-host',
    guestSessionId: 'primary-boundary-guest',
  },
);
const overflowTest = createLockstepTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 30,
    lockstepMode: 'primary',
    lockstepTurnTicks: 20,
    lockstepMaxBufferedCommands: 4,
    lockstepCheckpointIntervalTicks: 1,
  },
  {
    roomName: 'Primary Overflow Room',
    hostSessionId: 'primary-overflow-host',
    guestSessionId: 'primary-overflow-guest',
  },
);
const finishTest = createLockstepTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 30,
    lockstepMode: 'primary',
    lockstepTurnTicks: 50,
    lockstepCheckpointIntervalTicks: 1,
  },
  {
    roomName: 'Primary Finish Room',
    hostSessionId: 'primary-finish-host',
    guestSessionId: 'primary-finish-guest',
  },
);
const finishDestroyTest = createLockstepTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 30,
    lockstepMode: 'primary',
    lockstepTurnTicks: 50,
    lockstepCheckpointIntervalTicks: 1,
  },
  {
    roomName: 'Primary Finish Destroy Room',
    hostSessionId: 'primary-finish-destroy-host',
    guestSessionId: 'primary-finish-destroy-guest',
  },
);
const rejectTest = createLockstepTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 30,
    lockstepMode: 'primary',
    lockstepTurnTicks: 50,
    lockstepCheckpointIntervalTicks: 1,
  },
  {
    roomName: 'Primary Reject Room',
    hostSessionId: 'primary-reject-host',
    guestSessionId: 'primary-reject-guest',
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
  primaryTest(
    'buffers queue commands and emits checkpoints without fallback',
    async ({ connectedRoom, startLockstepMatch }) => {
      expect(connectedRoom.hostJoined.lockstep?.mode).toBe('primary');
      expect(connectedRoom.hostJoined.lockstep?.status).toBe('running');

      const match = await startLockstepMatch(connectedRoom);
      const fallbackEvents: LockstepFallbackPayload[] = [];
      match.host.on('lockstep:fallback', (payload: LockstepFallbackPayload) => {
        fallbackEvents.push(payload);
      });

      const firstCheckpoint = await waitForEvent<LockstepCheckpointPayload>(
        match.host,
        'lockstep:checkpoint',
        4_000,
      );
      expect(firstCheckpoint.roomId).toBe(match.roomId);
      expect(firstCheckpoint.mode).toBe('primary');
      expect(firstCheckpoint.hashHex).toMatch(/^[0-9a-f]{8}$/);

      const state = await waitForState(
        match.host,
        (payload) =>
          payload.roomId === match.roomId &&
          payload.teams.some(({ playerIds }) =>
            playerIds.includes(match.hostJoined.playerId),
          ),
        {
          roomId: match.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);

      match.host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
      });

      const queued = await waitForBuildQueueResponse(match.host, 4_000);
      if ('error' in queued) {
        throw new Error(
          `Build queue rejected: ${queued.error.reason ?? queued.error.message}`,
        );
      }

      const secondCheckpoint = await waitForEvent<LockstepCheckpointPayload>(
        match.host,
        'lockstep:checkpoint',
        4_000,
      );
      expect(secondCheckpoint.tick).toBeGreaterThanOrEqual(
        firstCheckpoint.tick,
      );
      expect(secondCheckpoint.mode).toBe('primary');

      expect(fallbackEvents).toEqual([]);

      match.host.off('lockstep:fallback');
    },
    25_000,
  );

  boundaryTest(
    'uses turn boundaries for primary queue flush when turn ticks > 1',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);
      const state = await waitForState(
        match.host,
        (payload) =>
          payload.roomId === match.roomId &&
          payload.teams.some(({ playerIds }) =>
            playerIds.includes(match.hostJoined.playerId),
          ),
        {
          roomId: match.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);
      const scheduledPromise = waitForBuildScheduled(match.host, 5_000);

      match.host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
      });

      const queued = await waitForBuildQueueResponse(match.host, 250);
      if ('error' in queued) {
        throw new Error(
          `Build queue rejected: ${queued.error.reason ?? queued.error.message}`,
        );
      }

      await expect(waitForBuildScheduled(match.host, 250)).rejects.toThrow(
        /timed out/i,
      );

      const scheduled = await scheduledPromise;
      expect(scheduled.intentId).toBe(queued.queued.intentId);
    },
    30_000,
  );

  overflowTest(
    'falls back on turn-buffer-overflow and still responds to queued commands',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);
      const state = await waitForState(
        match.host,
        (payload) =>
          payload.roomId === match.roomId &&
          payload.teams.some(({ playerIds }) =>
            playerIds.includes(match.hostJoined.playerId),
          ),
        {
          roomId: match.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);

      const responsesPromise = waitForBuildResponses(match.host, 5, 6_000);
      const fallbackPromise = waitForEvent<LockstepFallbackPayload>(
        match.host,
        'lockstep:fallback',
        6_000,
      );

      for (const offset of [8, 10, 12, 14, 16]) {
        match.host.emit('build:queue', {
          templateId: 'block',
          x: team.baseTopLeft.x + offset,
          y: team.baseTopLeft.y + offset,
        });
      }

      const [responses, fallback] = await Promise.all([
        responsesPromise,
        fallbackPromise,
      ]);
      expect(responses).toHaveLength(5);
      expect(responses.some((response) => response.kind === 'queued')).toBe(
        true,
      );
      expect(fallback.reason).toBe('turn-buffer-overflow');

      await waitForMembership(
        match.host,
        match.roomId,
        (payload) =>
          payload.lockstep?.status === 'fallback' &&
          payload.lockstep.lastFallbackReason === 'turn-buffer-overflow',
      );
    },
    30_000,
  );

  finishTest(
    'rejects buffered primary commands if match finishes before turn flush',
    async ({ connectedRoom, startLockstepMatch, connectClient }) => {
      const spectator = connectClient({
        sessionId: 'primary-finish-spectator',
      });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
      spectator.emit('room:join', { roomId: connectedRoom.roomId });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');

      const match = await startLockstepMatch(connectedRoom);
      const state = await waitForState(
        match.host,
        (payload) =>
          payload.roomId === match.roomId &&
          payload.teams.some(({ playerIds }) =>
            playerIds.includes(match.hostJoined.playerId),
          ),
        {
          roomId: match.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);
      const scheduledPromise = waitForBuildScheduled(spectator, 2_000).catch(
        (error: unknown) => error,
      );
      const rejectedPromise = waitForEvent<BuildQueueRejectedPayload>(
        spectator,
        'build:queue-rejected',
        2_000,
      );

      match.host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
      });

      const queued = await waitForBuildQueueResponse(match.host, 500);
      if ('error' in queued) {
        throw new Error(
          `Expected buffered queued intent, received ${queued.error.reason ?? queued.error.message}`,
        );
      }

      match.host.emit('room:leave');
      match.guest.emit('room:leave');

      await expect(rejectedPromise).resolves.toMatchObject({
        roomId: match.roomId,
        intentId: queued.queued.intentId,
        teamId: team.id,
        reason: 'match-finished',
      });
      await expect(scheduledPromise).resolves.toBeInstanceOf(Error);
    },
    30_000,
  );

  finishDestroyTest(
    'rejects buffered primary destroy intents if match finishes before turn flush',
    async ({ connectedRoom, startLockstepMatch, connectClient }) => {
      const spectator = connectClient({
        sessionId: 'primary-finish-destroy-spectator',
      });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
      spectator.emit('room:join', { roomId: connectedRoom.roomId });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');

      const match = await startLockstepMatch(connectedRoom);
      const state = await waitForState(
        match.host,
        (payload) =>
          payload.roomId === match.roomId &&
          payload.teams.some(({ playerIds }) =>
            playerIds.includes(match.hostJoined.playerId),
          ),
        {
          roomId: match.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);
      const structures = await waitForStateStructures(
        match.host,
        (payload) =>
          payload.roomId === match.roomId &&
          payload.teams.some(
            (teamState) =>
              teamState.id === team.id && teamState.structures.length > 0,
          ),
        {
          roomId: match.roomId,
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

      match.host.emit('destroy:queue', {
        structureKey: ownStructure.key,
      });

      const queued = await waitForDestroyQueueResponse(match.host, 500);
      if ('error' in queued) {
        throw new Error(
          `Expected buffered queued destroy intent, received ${queued.error.reason ?? queued.error.message}`,
        );
      }

      match.host.emit('room:leave');
      match.guest.emit('room:leave');

      await expect(rejectedPromise).resolves.toMatchObject({
        roomId: match.roomId,
        intentId: queued.queued.intentId,
        teamId: team.id,
        structureKey: ownStructure.key,
        reason: 'match-finished',
      });
      await expect(scheduledPromise).resolves.toBeInstanceOf(Error);
    },
    30_000,
  );

  rejectTest(
    'emits buffered build rejection when primary replay validation fails',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);
      const state = await waitForState(
        match.host,
        (payload) =>
          payload.roomId === match.roomId &&
          payload.teams.some(({ playerIds }) =>
            playerIds.includes(match.hostJoined.playerId),
          ),
        {
          roomId: match.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);
      const opposingTeam = state.teams.find(({ id }) => id !== team.id);
      if (!opposingTeam) {
        throw new Error(
          'Expected an opposing team to validate territory rejection',
        );
      }

      const scheduledPromise = waitForBuildScheduled(match.host, 2_000).catch(
        (error: unknown) => error,
      );
      const rejectedPromise = waitForEvent<BuildQueueRejectedPayload>(
        match.host,
        'build:queue-rejected',
        2_000,
      );

      match.host.emit('build:queue', {
        templateId: 'block',
        x: opposingTeam.baseTopLeft.x + 1,
        y: opposingTeam.baseTopLeft.y + 1,
      });

      const queued = await waitForBuildQueueResponse(match.host, 500);
      if ('error' in queued) {
        throw new Error(
          `Expected buffered queued intent, received ${queued.error.reason ?? queued.error.message}`,
        );
      }

      await expect(rejectedPromise).resolves.toMatchObject({
        roomId: match.roomId,
        intentId: queued.queued.intentId,
        teamId: team.id,
        reason: 'outside-territory',
      });
      await expect(scheduledPromise).resolves.toBeInstanceOf(Error);
    },
    30_000,
  );
});
