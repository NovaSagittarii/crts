import { describe, expect } from 'vitest';

import type {
  BuildQueuedPayload,
  RoomGridStatePayload,
  RoomStateHashesPayload,
  RoomStructuresStatePayload,
} from '#rts-engine';

import { createLockstepTest } from './lockstep-fixtures.js';
import { createMatchTest } from './match-fixtures.js';
import {
  collectCandidatePlacements,
  observeEvents,
  waitForBuildQueueResponse,
  waitForEvent,
  waitForState,
  waitForStateGrid,
  waitForStateHashes,
  waitForStateStructures,
} from './test-support.js';

const LOCKSTEP_SECTIONS_TURN_TICKS = 20;
const STATE_REQUEST_ADVANCE_MS = 100;
const LOCKSTEP_FLUSH_ADVANCE_LIMIT_TICKS = 5;

const sectionsMatchTest = createMatchTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 40,
    countdownSeconds: 0,
    activeStateSnapshotIntervalTicks: 1000,
  },
  {
    roomName: 'State Sections Room',
    hostSessionId: 'sections-host',
    guestSessionId: 'sections-guest',
  },
  {},
  { clockMode: 'manual' },
);

const lockstepSectionsTest = createLockstepTest(
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
    roomName: 'State Sections Room',
    hostSessionId: 'sections-host',
    guestSessionId: 'sections-guest',
  },
  {},
  { clockMode: 'manual' },
);

describe('section sync and queued fanout', () => {
  sectionsMatchTest(
    'serves grid and structures sections only to the requester',
    async ({ activeMatch, integration }) => {
      const setup = activeMatch;
      const generatorTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'generator',
      );
      if (!generatorTemplate) {
        throw new Error('Expected generator template to be available');
      }

      const guestInitialGridObserver = observeEvents<RoomGridStatePayload>(
        setup.guest,
        'state:grid',
      );
      const initialGridPromise = waitForStateGrid(
        setup.host,
        (payload: RoomGridStatePayload) => payload.roomId === setup?.roomId,
        {
          roomId: setup.roomId,
        },
      );
      await integration.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const initialGrid = await initialGridPromise;
      await integration.clock.flush();
      guestInitialGridObserver.stop();
      expect(guestInitialGridObserver.events).toHaveLength(0);
      expect(initialGrid.hashHex).toMatch(/^[0-9a-f]{8}$/);

      const duplicateGridObserver = observeEvents<RoomGridStatePayload>(
        setup.host,
        'state:grid',
      );
      setup.host.emit('state:request', { sections: ['grid'] });
      await integration.clock.flush();
      duplicateGridObserver.stop();
      expect(duplicateGridObserver.events).toHaveLength(0);

      const guestInitialStructuresObserver =
        observeEvents<RoomStructuresStatePayload>(
          setup.guest,
          'state:structures',
        );
      const initialStructuresPromise = waitForStateStructures(
        setup.host,
        (payload: RoomStructuresStatePayload) =>
          payload.roomId === setup?.roomId,
        {
          roomId: setup.roomId,
        },
      );
      await integration.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const initialStructures = await initialStructuresPromise;
      await integration.clock.flush();
      guestInitialStructuresObserver.stop();
      expect(guestInitialStructuresObserver.events).toHaveLength(0);
      const initialHostTeam = initialStructures.teams.find(
        (team) => team.id === setup.hostTeam.id,
      );
      if (!initialHostTeam) {
        throw new Error('Expected host team in initial structures state');
      }

      const placement = collectCandidatePlacements(
        setup.hostTeam,
        generatorTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      )[0];
      if (!placement) {
        throw new Error('Expected a valid generator placement');
      }

      const hashesPromise = waitForStateHashes(
        setup.host,
        (payload: RoomStateHashesPayload) =>
          payload.roomId === setup.roomId &&
          payload.structuresHash !== initialStructures.hashHex,
        { timeoutMs: 6_000, overallTimeoutMs: 6_000 },
      );
      const queuedPromise = waitForBuildQueueResponse(setup.host, 4_000);

      setup.host.emit('build:queue', {
        templateId: generatorTemplate.id,
        x: placement.x,
        y: placement.y,
        delayTicks: 20,
      });

      const queued = await queuedPromise;
      if ('error' in queued) {
        throw new Error(
          `Build queue unexpectedly failed: ${queued.error.reason ?? queued.error.message}`,
        );
      }

      const hashes = await hashesPromise;

      expect(hashes.gridHash).toBe(initialGrid.hashHex);
      expect(hashes.structuresHash).not.toBe(initialStructures.hashHex);

      const guestUpdatedStructuresObserver =
        observeEvents<RoomStructuresStatePayload>(
          setup.guest,
          'state:structures',
        );
      const updatedStructuresPromise = waitForStateStructures(
        setup.host,
        (payload: RoomStructuresStatePayload) =>
          payload.roomId === setup?.roomId &&
          payload.hashHex === hashes.structuresHash,
        {
          roomId: setup.roomId,
        },
      );
      await integration.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const updatedStructures = await updatedStructuresPromise;
      await integration.clock.flush();
      guestUpdatedStructuresObserver.stop();
      expect(guestUpdatedStructuresObserver.events).toHaveLength(0);
      expect(updatedStructures.hashHex).toBe(hashes.structuresHash);
      const updatedHostTeam = updatedStructures.teams.find(
        (team) => team.id === setup.hostTeam.id,
      );
      if (!updatedHostTeam) {
        throw new Error('Expected host team in updated structures state');
      }
      expect(updatedHostTeam.resources).toBeLessThan(initialHostTeam.resources);
      expect(
        updatedHostTeam.pendingBuilds.some(
          ({ eventId }) => eventId === queued.queued.eventId,
        ),
      ).toBe(true);
    },
    25_000,
  );

  lockstepSectionsTest(
    'broadcasts authoritative queued intents and queue hashes on turn flush',
    async ({ connectedRoom, startLockstepMatch }) => {
      const setup = await startLockstepMatch(connectedRoom, {
        waitForActiveMembership: false,
      });
      const generatorTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'generator',
      );
      if (!generatorTemplate) {
        throw new Error('Expected generator template to be available');
      }

      const placement = collectCandidatePlacements(
        setup.hostTeam,
        generatorTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      )[0];
      if (!placement) {
        throw new Error('Expected a valid generator placement');
      }

      const initialStatePromise = waitForState(
        setup.host,
        (payload) => payload.roomId === setup.roomId,
        {
          roomId: setup.roomId,
          attempts: 20,
          timeoutMs: 2_000,
        },
      );
      await connectedRoom.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const initialState = await initialStatePromise;
      const initialHostTeam = initialState.teams.find(
        (team) => team.id === setup.hostTeam.id,
      );
      if (!initialHostTeam) {
        throw new Error('Expected host team in initial structures state');
      }
      const ticksIntoTurn = initialState.tick % LOCKSTEP_SECTIONS_TURN_TICKS;
      const ticksUntilTurnFlush =
        ticksIntoTurn === 0
          ? LOCKSTEP_SECTIONS_TURN_TICKS
          : LOCKSTEP_SECTIONS_TURN_TICKS - ticksIntoTurn;
      const preFlushTicks = Math.max(1, ticksUntilTurnFlush - 2);

      const hostQueuedObserver = observeEvents<BuildQueuedPayload>(
        setup.host,
        'build:queued',
      );
      const guestQueuedObserver = observeEvents<BuildQueuedPayload>(
        setup.guest,
        'build:queued',
      );
      const hostQueuedPromise = waitForBuildQueueResponse(setup.host, 4_000);
      const guestQueuedPromise = waitForEvent<BuildQueuedPayload>(
        setup.guest,
        'build:queued',
        4_000,
      );

      setup.host.emit('build:queue', {
        templateId: generatorTemplate.id,
        x: placement.x,
        y: placement.y,
      });

      await connectedRoom.clock.advanceTicks(preFlushTicks);

      expect(hostQueuedObserver.events).toHaveLength(0);
      expect(guestQueuedObserver.events).toHaveLength(0);

      const preFlushState = await waitForState(
        setup.host,
        (payload) =>
          payload.roomId === setup.roomId &&
          payload.teams.some(
            (team) =>
              team.id === setup.hostTeam.id &&
              team.resources === initialHostTeam.resources &&
              team.pendingBuilds.length === 0,
          ),
        {
          roomId: setup.roomId,
          attempts: 10,
          timeoutMs: 1_000,
        },
      );
      expect(
        preFlushState.teams.find((team) => team.id === setup.hostTeam.id)
          ?.resources,
      ).toBe(initialHostTeam.resources);

      await connectedRoom.clock.advanceTicks(2);
      for (
        let advancedTicks = 0;
        advancedTicks < LOCKSTEP_FLUSH_ADVANCE_LIMIT_TICKS &&
        (hostQueuedObserver.events.length === 0 ||
          guestQueuedObserver.events.length === 0);
        advancedTicks += 1
      ) {
        await connectedRoom.clock.advanceTicks(1);
      }

      expect(hostQueuedObserver.events.length).toBeGreaterThan(0);
      expect(guestQueuedObserver.events.length).toBeGreaterThan(0);

      const [hostQueuedResponse, guestQueued] = await Promise.all([
        hostQueuedPromise,
        guestQueuedPromise,
      ]);
      hostQueuedObserver.stop();
      guestQueuedObserver.stop();
      if ('error' in hostQueuedResponse) {
        throw new Error(
          'Expected both clients to observe a buffered build intent',
        );
      }

      const hostQueued: BuildQueuedPayload = hostQueuedResponse.queued;
      expect(guestQueued).toEqual(hostQueued);
      expect(hostQueued.playerId).toBe(setup.hostJoined.playerId);
      expect(hostQueued.teamId).toBe(setup.hostTeam.id);
      expect(hostQueued.scheduledByTurn).toBeGreaterThan(
        hostQueued.bufferedTurn,
      );

      const hostStructuresPromise = waitForStateStructures(
        setup.host,
        (payload) =>
          payload.roomId === setup.roomId &&
          payload.teams.some(
            (team) =>
              team.id === setup.hostTeam.id &&
              team.pendingBuilds.some(
                ({ eventId }) => eventId === hostQueued.eventId,
              ),
          ),
        {
          roomId: setup.roomId,
          attempts: 10,
          timeoutMs: 1_000,
        },
      );
      const guestStructuresPromise = waitForStateStructures(
        setup.guest,
        (payload) =>
          payload.roomId === setup.roomId &&
          payload.teams.some(
            (team) =>
              team.id === setup.hostTeam.id &&
              team.pendingBuilds.some(
                ({ eventId }) => eventId === hostQueued.eventId,
              ),
          ),
        {
          roomId: setup.roomId,
          attempts: 10,
          timeoutMs: 1_000,
        },
      );
      await connectedRoom.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const [hostStructures, guestStructures] = await Promise.all([
        hostStructuresPromise,
        guestStructuresPromise,
      ]);

      const hostPendingBuilds =
        hostStructures.teams.find((team) => team.id === setup.hostTeam.id)
          ?.pendingBuilds ?? [];
      const hostQueuedTeam = hostStructures.teams.find(
        (team) => team.id === setup.hostTeam.id,
      );
      const guestPendingBuilds =
        guestStructures.teams.find((team) => team.id === setup.hostTeam.id)
          ?.pendingBuilds ?? [];
      const guestQueuedTeam = guestStructures.teams.find(
        (team) => team.id === setup.hostTeam.id,
      );

      expect(hostPendingBuilds).toEqual(guestPendingBuilds);
      expect(hostQueuedTeam?.resources).toBeLessThan(initialHostTeam.resources);
      expect(guestQueuedTeam?.resources).toBe(hostQueuedTeam?.resources);
    },
    25_000,
  );
});
