import { describe, expect } from 'vitest';

import type {
  BuildQueuedPayload,
  RoomJoinedPayload,
  RoomStatePayload,
  TeamPayload,
} from '#rts-engine';

import { createLockstepTest } from './lockstep-fixtures.js';
import {
  observeEvents,
  waitForBuildQueueResponse,
  waitForEvent,
  waitForState,
} from './test-support.js';

const STATE_REQUEST_ADVANCE_MS = 100;

const test = createLockstepTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 40,
    lockstepMode: 'primary',
    lockstepCheckpointIntervalTicks: 5,
  },
  {
    roomName: 'Reconnect Input-Replay Room',
    hostSessionId: 'recon-host',
    guestSessionId: 'recon-guest',
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

describe('reconnect input-log replay (RECON-01)', () => {
  test(
    'reconnecting player receives inputLog field in room:joined payload (RECON-01)',
    async ({ connectedRoom, startLockstepMatch, connectClient }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Advance a few ticks so server has progressed
      await connectedRoom.clock.advanceTicks(3);

      // Guest disconnects
      match.guest.close();

      // Advance more ticks while guest is disconnected
      await connectedRoom.clock.advanceTicks(5);

      // Guest reconnects
      const guest2 = connectClient({ sessionId: 'recon-guest' });
      const rejoined = await waitForEvent<RoomJoinedPayload>(
        guest2,
        'room:joined',
        5_000,
      );

      // Assert inputLog is present and is an array
      expect(rejoined.inputLog).toBeDefined();
      expect(Array.isArray(rejoined.inputLog)).toBe(true);

      // Snapshot has advanced past tick 0
      expect(rejoined.state.tick).toBeGreaterThan(0);

      // Lockstep status present for primary mode
      expect(rejoined.lockstep).toBeDefined();
    },
    25_000,
  );

  test(
    'reconnect with queued builds includes input log entries from snapshot tick forward (RECON-01)',
    async ({ connectedRoom, startLockstepMatch, connectClient }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Get state to find a valid build placement
      const statePromise = waitForState(
        match.host,
        (payload: RoomStatePayload) =>
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
      const team = resolveTeamForPlayer(
        state.teams,
        match.hostJoined.playerId,
      );

      // Advance initial ticks
      await connectedRoom.clock.advanceTicks(3);

      // Guest disconnects
      match.guest.close();

      // Host queues a build while guest is disconnected
      const queuedPromise = waitForBuildQueueResponse(match.host, 5_000);
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
      const buildQueued: BuildQueuedPayload = queued.queued;

      // Advance 1 tick but stay before executeTick (build still pending)
      await connectedRoom.clock.advanceTicks(1);

      // Guest reconnects
      const guest2 = connectClient({ sessionId: 'recon-guest' });
      const rejoined = await waitForEvent<RoomJoinedPayload>(
        guest2,
        'room:joined',
        5_000,
      );

      expect(rejoined.inputLog).toBeDefined();

      if (buildQueued.executeTick > rejoined.state.tick) {
        // Build event should be in the inputLog (queued after last snapshot tick,
        // executeTick is still in the future)
        expect(rejoined.inputLog!.length).toBeGreaterThanOrEqual(1);
        const buildEntry = rejoined.inputLog!.find((e) => e.kind === 'build');
        expect(buildEntry).toBeDefined();
      } else {
        // Build is already reflected in the snapshot. The inputLog from tick+1
        // correctly excludes it.
        const matchingBuildEntries = rejoined.inputLog!.filter(
          (e) =>
            e.kind === 'build' &&
            (e.payload as BuildQueuedPayload).eventId === buildQueued.eventId,
        );
        expect(matchingBuildEntries.length).toBe(0);
      }
    },
    25_000,
  );

  test(
    'reconnect without pending events produces empty inputLog (RECON-01)',
    async ({ connectedRoom, startLockstepMatch, connectClient }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Advance a few ticks with no builds or destroys
      await connectedRoom.clock.advanceTicks(5);

      // Guest disconnects
      match.guest.close();

      // Advance 2 more ticks (still no events)
      await connectedRoom.clock.advanceTicks(2);

      // Guest reconnects
      const guest2 = connectClient({ sessionId: 'recon-guest' });
      const rejoined = await waitForEvent<RoomJoinedPayload>(
        guest2,
        'room:joined',
        5_000,
      );

      // inputLog exists and is empty since no events to replay
      expect(rejoined.inputLog).toBeDefined();
      expect(rejoined.inputLog!.length).toBe(0);
    },
    25_000,
  );

  test(
    'no full state broadcast emitted to room after reconnect in input-only mode (RECON-01)',
    async ({ connectedRoom, startLockstepMatch, connectClient }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Advance ticks
      await connectedRoom.clock.advanceTicks(3);

      // Set up host to observe 'state' events
      const stateObserver = observeEvents<RoomStatePayload>(
        match.host,
        'state',
      );

      // Guest disconnects
      match.guest.close();

      // Guest reconnects
      const guest2 = connectClient({ sessionId: 'recon-guest' });
      await waitForEvent<RoomJoinedPayload>(guest2, 'room:joined', 5_000);

      // Advance a few more ticks to allow any straggling events
      await connectedRoom.clock.advanceTicks(3);

      // Host did NOT receive any full 'state' broadcast
      // (input-only mode suppresses them)
      expect(stateObserver.events.length).toBe(0);

      stateObserver.stop();
    },
    25_000,
  );
});
