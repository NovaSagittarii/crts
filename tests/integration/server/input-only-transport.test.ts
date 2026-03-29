import { describe, expect } from 'vitest';

import type {
  BuildOutcomePayload,
  LockstepCheckpointPayload,
  RoomStateHashesPayload,
  RoomStatePayload,
  TeamPayload,
} from '#rts-engine';

import { createLockstepTest } from './lockstep-fixtures.js';
import {
  observeEvents,
  waitForBuildQueueResponse,
  waitForNoEvent,
  waitForState,
} from './test-support.js';

const STATE_REQUEST_ADVANCE_MS = 100;

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
    roomName: 'Input-Only Transport Room',
    hostSessionId: 'input-only-host',
    guestSessionId: 'input-only-guest',
  },
  {},
  { clockMode: 'manual' },
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

describe('input-only transport (XPORT-01, XPORT-02, XPORT-03)', () => {
  primaryTest(
    'no build:outcome events during primary lockstep running match',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Get state to find a valid placement
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
      await connectedRoom.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const state = await statePromise;
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);

      // Queue a build
      const queuedPromise = waitForBuildQueueResponse(match.host, 4_000);
      match.host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
      });
      const queued = await queuedPromise;
      if ('error' in queued) {
        throw new Error(
          `Build queue rejected: ${queued.error.reason ?? queued.error.message}`,
        );
      }

      // Observe build:outcome events on both clients
      const hostOutcomeObserver = observeEvents<BuildOutcomePayload>(
        match.host,
        'build:outcome',
      );
      const guestOutcomeObserver = observeEvents<BuildOutcomePayload>(
        match.guest,
        'build:outcome',
      );

      // Advance ticks well past the executeTick to ensure the build would have resolved
      const ticksToAdvance = queued.queued.executeTick + 5;
      await connectedRoom.clock.advanceTicks(ticksToAdvance);

      // Wait a bit to let any straggling events arrive
      await waitForNoEvent(match.host, 'build:outcome', 200);

      // Assert: no build:outcome events in primary lockstep mode
      expect(hostOutcomeObserver.events).toHaveLength(0);
      expect(guestOutcomeObserver.events).toHaveLength(0);

      hostOutcomeObserver.stop();
      guestOutcomeObserver.stop();
    },
    25_000,
  );

  primaryTest(
    'no periodic full-state broadcast during primary lockstep running match',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Observe state events on host
      const stateObserver = observeEvents<RoomStatePayload>(
        match.host,
        'state',
      );

      // Advance many ticks (well past the periodic snapshot interval)
      await connectedRoom.clock.advanceTicks(60);

      // Wait to ensure no late events
      await waitForNoEvent(match.host, 'state', 200);

      // Assert: no periodic state broadcasts in primary lockstep mode
      expect(stateObserver.events).toHaveLength(0);

      stateObserver.stop();
    },
    25_000,
  );

  primaryTest(
    'lockstep:checkpoint events still emitted during primary lockstep',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Observe checkpoint events
      const checkpointObserver = observeEvents<LockstepCheckpointPayload>(
        match.host,
        'lockstep:checkpoint',
      );

      // Advance a few ticks (checkpointIntervalTicks=1 so every tick emits one)
      await connectedRoom.clock.advanceTicks(5);

      // Assert: checkpoint events were received
      expect(checkpointObserver.events.length).toBeGreaterThanOrEqual(3);
      for (const checkpoint of checkpointObserver.events) {
        expect(checkpoint.mode).toBe('primary');
        expect(checkpoint.hashHex).toMatch(/^[0-9a-f]{8}$/);
      }

      checkpointObserver.stop();
    },
    25_000,
  );

  primaryTest(
    'no state:hashes events after build:queued in primary lockstep',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Get state for placement
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
      await connectedRoom.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const state = await statePromise;
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);

      // Start observing state:hashes BEFORE queuing the build
      const hashesObserver = observeEvents<RoomStateHashesPayload>(
        match.host,
        'state:hashes',
      );

      // Queue a build
      const queuedPromise = waitForBuildQueueResponse(match.host, 4_000);
      match.host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
      });
      const queued = await queuedPromise;
      if ('error' in queued) {
        throw new Error(
          `Build queue rejected: ${queued.error.reason ?? queued.error.message}`,
        );
      }

      // Wait to see if any state:hashes arrive
      await waitForNoEvent(match.host, 'state:hashes', 200);

      // Assert: no state:hashes from the build:queued emission
      expect(hashesObserver.events).toHaveLength(0);

      hashesObserver.stop();
    },
    25_000,
  );

  primaryTest(
    'build:queued payloads include sequence field as a number',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Get state for placement
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
      await connectedRoom.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const state = await statePromise;
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);

      // Queue a build
      const queuedPromise = waitForBuildQueueResponse(match.host, 4_000);
      match.host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
      });
      const queued = await queuedPromise;
      if ('error' in queued) {
        throw new Error(
          `Build queue rejected: ${queued.error.reason ?? queued.error.message}`,
        );
      }

      // Assert: sequence is a number >= 0
      expect(typeof queued.queued.sequence).toBe('number');
      expect(queued.queued.sequence).toBeGreaterThanOrEqual(0);
    },
    25_000,
  );

  primaryTest(
    'multiple queued events have ascending sequence numbers',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Get state for placement
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
      await connectedRoom.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const state = await statePromise;
      const team = resolveTeamForPlayer(state.teams, match.hostJoined.playerId);

      // Queue first build
      const queued1Promise = waitForBuildQueueResponse(match.host, 4_000);
      match.host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
      });
      const queued1 = await queued1Promise;
      if ('error' in queued1) {
        throw new Error(
          `First build queue rejected: ${queued1.error.reason ?? queued1.error.message}`,
        );
      }

      // Queue second build at a different location
      const queued2Promise = waitForBuildQueueResponse(match.host, 4_000);
      match.host.emit('build:queue', {
        templateId: 'block',
        x: team.baseTopLeft.x + 12,
        y: team.baseTopLeft.y + 8,
      });
      const queued2 = await queued2Promise;
      if ('error' in queued2) {
        throw new Error(
          `Second build queue rejected: ${queued2.error.reason ?? queued2.error.message}`,
        );
      }

      // Assert: ascending sequence numbers
      expect(queued2.queued.sequence).toBeGreaterThan(queued1.queued.sequence);
    },
    25_000,
  );
});
