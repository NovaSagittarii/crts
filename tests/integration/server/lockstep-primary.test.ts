import { describe, expect } from 'vitest';

import type {
  BuildQueuedPayload,
  DestroyQueuedPayload,
  LockstepCheckpointPayload,
  LockstepFallbackPayload,
  MatchFinishedPayload,
  RoomJoinedPayload,
  TeamPayload,
} from '#rts-engine';

import { createLockstepTest } from './lockstep-fixtures.js';
import {
  collectBuildOutcomes,
  collectBuildQueuedEvents,
  collectCandidatePlacements,
  expectBuildQueueRejected,
  observeEvents,
  waitForBuildQueueResponse,
  waitForDestroyOutcome,
  waitForDestroyQueueResponse,
  waitForEvent,
  waitForMembership,
  waitForNoEvent,
  waitForState,
  waitForStateStructures,
} from './test-support.js';

const PRIMARY_BOUNDARY_TICK_MS = 30;
const PRIMARY_BOUNDARY_TURN_TICKS = 20;
const PRIMARY_FINISH_ADVANCE_LIMIT_TICKS = 55;
const PRIMARY_STATE_REQUEST_ADVANCE_MS = 100;

async function advanceUntilObservedCount(
  clock: { advanceTicks(ticks: number): Promise<void> },
  observer: { events: unknown[] },
  count: number,
  maxTicks: number,
): Promise<void> {
  for (
    let advancedTicks = 0;
    advancedTicks < maxTicks && observer.events.length < count;
    advancedTicks += 1
  ) {
    await clock.advanceTicks(1);
  }

  expect(observer.events.length).toBeGreaterThanOrEqual(count);
}

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
  {},
  { clockMode: 'manual' },
);
const boundaryTest = createLockstepTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: PRIMARY_BOUNDARY_TICK_MS,
    lockstepMode: 'primary',
    lockstepTurnTicks: PRIMARY_BOUNDARY_TURN_TICKS,
    lockstepCheckpointIntervalTicks: 1,
  },
  {
    roomName: 'Primary Turn Boundary Room',
    hostSessionId: 'primary-boundary-host',
    guestSessionId: 'primary-boundary-guest',
  },
  {},
  { clockMode: 'manual' },
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
  {},
  { clockMode: 'manual' },
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
  {},
  { clockMode: 'manual' },
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

describe('lockstep primary mode', () => {
  primaryTest(
    'rebroadcasts accepted queued commands immediately and emits checkpoints without fallback',
    async ({ connectedRoom, startLockstepMatch }) => {
      expect(connectedRoom.hostJoined.lockstep?.mode).toBe('primary');
      expect(connectedRoom.hostJoined.lockstep?.status).toBe('running');

      const match = await startLockstepMatch(connectedRoom);
      const fallbackEvents: LockstepFallbackPayload[] = [];
      match.host.on('lockstep:fallback', (payload: LockstepFallbackPayload) => {
        fallbackEvents.push(payload);
      });

      const firstCheckpointPromise = waitForEvent<LockstepCheckpointPayload>(
        match.host,
        'lockstep:checkpoint',
        4_000,
      );
      await connectedRoom.clock.advanceTicks(1);
      const firstCheckpoint = await firstCheckpointPromise;
      expect(firstCheckpoint.roomId).toBe(match.roomId);
      expect(firstCheckpoint.mode).toBe('primary');
      expect(firstCheckpoint.hashHex).toMatch(/^[0-9a-f]{8}$/);

      const statePromise = waitForState(
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
      await connectedRoom.clock.advanceMs(PRIMARY_STATE_REQUEST_ADVANCE_MS);
      const state = await statePromise;
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);
      const guestQueuedPromise = waitForEvent<BuildQueuedPayload>(
        match.guest,
        'build:queued',
        4_000,
      );
      const secondCheckpointPromise = waitForEvent<LockstepCheckpointPayload>(
        match.host,
        'lockstep:checkpoint',
        4_000,
      );
      const queuedPromise = waitForBuildQueueResponse(match.host, 4_000);

      match.host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
      });

      const [queued, guestQueued] = await Promise.all([
        queuedPromise,
        guestQueuedPromise,
      ]);
      if ('error' in queued) {
        throw new Error(
          `Build queue rejected: ${queued.error.reason ?? queued.error.message}`,
        );
      }

      expect(guestQueued).toEqual(queued.queued);

      const secondCheckpoint = await secondCheckpointPromise;
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
    'rebroadcasts accepted queued commands before the next turn boundary when turn ticks > 1',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);
      const statePromise = waitForState(
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
      await connectedRoom.clock.advanceMs(PRIMARY_STATE_REQUEST_ADVANCE_MS);
      const state = await statePromise;
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);
      const generatorTemplate = match.hostJoined.templates.find(
        ({ id }) => id === 'generator',
      );
      if (!generatorTemplate) {
        throw new Error('Expected generator template to be available');
      }

      const placement = collectCandidatePlacements(
        team,
        generatorTemplate,
        match.hostJoined.state.width,
        match.hostJoined.state.height,
      )[0];
      if (!placement) {
        throw new Error('Expected a valid generator placement');
      }

      const initialResources = team.resources;
      const ticksIntoTurn = state.tick % PRIMARY_BOUNDARY_TURN_TICKS;
      const ticksUntilTurnFlush =
        ticksIntoTurn === 0
          ? PRIMARY_BOUNDARY_TURN_TICKS
          : PRIMARY_BOUNDARY_TURN_TICKS - ticksIntoTurn;
      const preFlushTicks = Math.max(1, ticksUntilTurnFlush - 2);
      const guestQueuedPromise = waitForEvent<BuildQueuedPayload>(
        match.guest,
        'build:queued',
        5_000,
      );
      const queuedPromise = waitForBuildQueueResponse(match.host, 5_000);

      match.host.emit('build:queue', {
        templateId: generatorTemplate.id,
        x: placement.x,
        y: placement.y,
      });

      const [queued, guestQueued] = await Promise.all([
        queuedPromise,
        guestQueuedPromise,
      ]);
      if ('error' in queued) {
        throw new Error(
          `Build queue rejected: ${queued.error.reason ?? queued.error.message}`,
        );
      }

      expect(guestQueued).toEqual(queued.queued);
      await waitForNoEvent(match.host, 'build:queued', 150);

      expect(initialResources).toBeGreaterThan(0);

      await connectedRoom.clock.advanceTicks(preFlushTicks);
      await waitForNoEvent(match.host, 'build:queued', 150);

      expect(queued.queued.intentId).toMatch(/^intent-/);
      expect(queued.queued.eventId).toBeGreaterThan(0);
      expect(queued.queued.executeTick).toBeGreaterThan(0);
      expect(queued.queued.scheduledByTurn).toBeGreaterThan(
        queued.queued.bufferedTurn,
      );
    },
    30_000,
  );

  overflowTest(
    'falls back on turn-buffer-overflow without duplicating queued commands',
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
      const blockTemplate = match.hostJoined.templates.find(
        ({ id }) => id === 'block',
      );
      if (!blockTemplate) {
        throw new Error('Expected block template to be available');
      }

      const expectedQueuedPositions = collectCandidatePlacements(
        team,
        blockTemplate,
        match.hostJoined.state.width,
        match.hostJoined.state.height,
      ).slice(0, 5);
      expect(expectedQueuedPositions).toHaveLength(5);

      const queuedPromise = collectBuildQueuedEvents(
        match.host,
        expectedQueuedPositions.length,
        6_000,
        100,
      );
      const fallbackPromise = waitForEvent<LockstepFallbackPayload>(
        match.host,
        'lockstep:fallback',
        6_000,
      );

      for (const placement of expectedQueuedPositions) {
        match.host.emit('build:queue', {
          templateId: 'block',
          x: placement.x,
          y: placement.y,
        });
      }

      const [queuedEvents, fallback] = await Promise.all([
        queuedPromise,
        fallbackPromise,
      ]);
      expect(queuedEvents).toHaveLength(expectedQueuedPositions.length);
      expect(queuedEvents.map(({ x, y }) => ({ x, y }))).toEqual(
        expectedQueuedPositions,
      );
      expect(
        queuedEvents.every(
          ({ playerId, teamId }) =>
            playerId === match.hostJoined.playerId && teamId === team.id,
        ),
      ).toBe(true);
      expect(fallback.reason).toBe('turn-buffer-overflow');

      const queuedEventIds = queuedEvents.map(({ eventId }) => eventId);
      const outcomesById = await collectBuildOutcomes(
        match.host,
        queuedEventIds,
        12_000,
        200,
      );
      expect(outcomesById.size).toBe(queuedEventIds.length);
      for (const eventId of queuedEventIds) {
        expect(outcomesById.get(eventId)).toHaveLength(1);
      }

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
    'rejects later buffered build commands when gameplay finish resolves first',
    async ({ clock, connectedRoom, startLockstepMatch, connectClient }) => {
      const spectator = connectClient({
        sessionId: 'primary-gameplay-finish-spectator',
      });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
      spectator.emit('room:join', { roomId: connectedRoom.roomId });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');

      const match = await startLockstepMatch(connectedRoom);
      const structuresPromise = waitForStateStructures(
        match.host,
        (payload) =>
          payload.roomId === match.roomId &&
          payload.teams.some(
            (teamState) =>
              teamState.playerIds.includes(match.guestJoined.playerId) &&
              teamState.structures.some(({ isCore }) => isCore),
          ),
        {
          roomId: match.roomId,
          attempts: 40,
          timeoutMs: 2_000,
        },
      );
      await clock.advanceMs(PRIMARY_STATE_REQUEST_ADVANCE_MS);
      const structures = await structuresPromise;
      const guestTeam = resolveTeamForPlayer(
        structures.teams,
        match.guestJoined.playerId,
      );
      const hostTeam = resolveTeamForPlayer(
        structures.teams,
        match.hostJoined.playerId,
      );
      const guestCore = guestTeam.structures.find(({ isCore }) => isCore);
      if (!guestCore) {
        throw new Error('Expected guest core structure to be present');
      }

      const destroyQueuedObserver = observeEvents<DestroyQueuedPayload>(
        match.guest,
        'destroy:queued',
      );
      const destroyResponsePromise = waitForDestroyQueueResponse(
        match.guest,
        5_000,
      );
      match.guest.emit('destroy:queue', {
        structureKey: guestCore.key,
      });

      await advanceUntilObservedCount(
        clock,
        destroyQueuedObserver,
        1,
        PRIMARY_FINISH_ADVANCE_LIMIT_TICKS,
      );
      destroyQueuedObserver.stop();

      const destroyResponse = await destroyResponsePromise;
      if ('error' in destroyResponse) {
        throw new Error(
          `Expected guest core destroy queue acceptance, received ${destroyResponse.error.reason}`,
        );
      }

      const queuedPromise = waitForEvent<BuildQueuedPayload>(
        spectator,
        'build:queued',
        2_000,
      );
      const matchFinishedObserver = observeEvents<MatchFinishedPayload>(
        spectator,
        'room:match-finished',
      );
      const destroyOutcomePromise = waitForDestroyOutcome(
        match.guest,
        destroyResponse.queued.eventId,
        12_000,
      );
      const matchFinishedPromise = waitForEvent<MatchFinishedPayload>(
        spectator,
        'room:match-finished',
        6_000,
      );

      match.host.emit('build:queue', {
        templateId: 'block',
        x: hostTeam.baseTopLeft.x + 8,
        y: hostTeam.baseTopLeft.y + 8,
      });

      for (
        let advancedTicks = 0;
        advancedTicks < PRIMARY_FINISH_ADVANCE_LIMIT_TICKS &&
        matchFinishedObserver.events.length === 0;
        advancedTicks += 1
      ) {
        await clock.advanceTicks(1);
      }

      matchFinishedObserver.stop();
      expect((await queuedPromise).teamId).toBe(hostTeam.id);
      expect(matchFinishedObserver.events.length).toBeGreaterThan(0);

      const [destroyOutcome, matchFinished] = await Promise.all([
        destroyOutcomePromise,
        matchFinishedPromise,
      ]);

      expect(destroyOutcome.outcome).toBe('destroyed');
      expect(destroyOutcome.structureKey).toBe(guestCore.key);
      await waitForNoEvent(spectator, 'build:queue-rejected', 150);
      expect(matchFinished.winner.teamId).toBe(hostTeam.id);
    },
    30_000,
  );

  finishTest(
    'keeps accepted primary build commands visible when all players leave before the next tick',
    async ({ clock, connectedRoom, startLockstepMatch, connectClient }) => {
      const spectator = connectClient({
        sessionId: 'primary-finish-spectator',
      });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
      spectator.emit('room:join', { roomId: connectedRoom.roomId });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');

      const match = await startLockstepMatch(connectedRoom);
      const statePromise = waitForState(
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
      await clock.advanceMs(PRIMARY_STATE_REQUEST_ADVANCE_MS);
      const state = await statePromise;
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);
      const queuedPromise = waitForEvent<BuildQueuedPayload>(
        spectator,
        'build:queued',
        2_000,
      );
      const matchFinishedObserver = observeEvents<MatchFinishedPayload>(
        spectator,
        'room:match-finished',
      );

      match.host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
      });

      match.host.emit('room:leave');
      match.guest.emit('room:leave');

      await clock.advanceTicks(PRIMARY_FINISH_ADVANCE_LIMIT_TICKS);

      const queued = await queuedPromise;
      matchFinishedObserver.stop();
      expect(queued.roomId).toBe(match.roomId);
      expect(queued.intentId).toMatch(/^intent-/);
      expect(queued.teamId).toBe(team.id);
      await waitForNoEvent(spectator, 'build:queue-rejected', 150);
      expect(matchFinishedObserver.events).toHaveLength(0);
    },
    30_000,
  );

  finishDestroyTest(
    'keeps accepted primary destroy intents visible when all players leave before the next tick',
    async ({ clock, connectedRoom, startLockstepMatch, connectClient }) => {
      const spectator = connectClient({
        sessionId: 'primary-finish-destroy-spectator',
      });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
      spectator.emit('room:join', { roomId: connectedRoom.roomId });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');

      const match = await startLockstepMatch(connectedRoom);
      const statePromise = waitForState(
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
      await clock.advanceMs(PRIMARY_STATE_REQUEST_ADVANCE_MS);
      const state = await statePromise;
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);
      const structuresPromise = waitForStateStructures(
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
      await clock.advanceMs(PRIMARY_STATE_REQUEST_ADVANCE_MS);
      const structures = await structuresPromise;
      const ownStructure = structures.teams
        .find((teamState) => teamState.id === team.id)
        ?.structures.at(0);
      if (!ownStructure) {
        throw new Error('Expected an owned structure to destroy');
      }

      const queuedPromise = waitForEvent<DestroyQueuedPayload>(
        spectator,
        'destroy:queued',
        2_000,
      );
      const matchFinishedObserver = observeEvents<MatchFinishedPayload>(
        spectator,
        'room:match-finished',
      );

      match.host.emit('destroy:queue', {
        structureKey: ownStructure.key,
      });

      match.host.emit('room:leave');
      match.guest.emit('room:leave');

      await clock.advanceTicks(PRIMARY_FINISH_ADVANCE_LIMIT_TICKS);

      const queued = await queuedPromise;
      matchFinishedObserver.stop();
      expect(queued.roomId).toBe(match.roomId);
      expect(queued.intentId).toMatch(/^intent-/);
      expect(queued.teamId).toBe(team.id);
      expect(queued.structureKey).toBe(ownStructure.key);
      await waitForNoEvent(spectator, 'destroy:queue-rejected', 150);
      expect(matchFinishedObserver.events).toHaveLength(0);
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

      const rejected = await expectBuildQueueRejected(
        match.host,
        () => {
          match.host.emit('build:queue', {
            templateId: 'block',
            x: opposingTeam.baseTopLeft.x + 1,
            y: opposingTeam.baseTopLeft.y + 1,
          });
        },
        2_000,
      );

      expect(rejected.roomId).toBe(match.roomId);
      expect(rejected.intentId).toMatch(/^intent-/);
      expect(rejected.teamId).toBe(team.id);
      expect(rejected.reason).toBe('outside-territory');
    },
    30_000,
  );
});
