import { describe, expect } from 'vitest';

import { Grid } from '#conway-core';
import {
  type BuildOutcomePayload,
  type BuildQueuedPayload,
  type BuildScheduledPayload,
  type RoomErrorPayload,
  type RoomGridStatePayload,
  type RoomJoinedPayload,
  type RoomLeftPayload,
  type RoomStatePayload,
  type TeamPayload,
  normalizePlacementTransform,
} from '#rts-engine';

import { createIntegrationTest } from './fixtures.js';
import { createMatchTest } from './match-fixtures.js';
import {
  type Cell,
  claimSlot,
  collectBuildOutcomes,
  collectBuildQueuedEvents,
  collectBuildScheduledEvents,
  collectCandidatePlacements,
  collectDestroyOutcomes,
  getTeamByPlayerId,
  waitForBuildQueueResponse,
  waitForBuildScheduled,
  waitForDestroyQueueResponse,
  waitForDestroyScheduled,
  waitForEvent,
  waitForNoEvent,
  waitForRoomList,
  waitForRoomState,
} from './test-support.js';

const defaultServerOptions = { port: 0, width: 52, height: 52, tickMs: 40 };
const buildQueueRoomOptions = { roomName: 'Build Queue Contract Room' };
const bufferedMatchOptions = { startMode: 'fake-timers' as const };

const matchTest = createMatchTest(
  defaultServerOptions,
  buildQueueRoomOptions,
  bufferedMatchOptions,
);
const snapshotMatchTest = createMatchTest(
  {
    ...defaultServerOptions,
    activeStateSnapshotIntervalTicks: 50,
  },
  buildQueueRoomOptions,
  bufferedMatchOptions,
);
const stateRequestMatchTest = createMatchTest(
  {
    ...defaultServerOptions,
    activeStateSnapshotIntervalTicks: 1000,
  },
  buildQueueRoomOptions,
  bufferedMatchOptions,
);
const skirmishRoomTest = createIntegrationTest({
  port: 0,
  width: 30,
  height: 30,
  tickMs: 40,
});
const partyRoomTest = createIntegrationTest({
  port: 0,
  width: 40,
  height: 40,
  tickMs: 40,
});

function blockAlive(state: RoomStatePayload, coords: Cell[]): boolean {
  const unpackedGrid = Grid.unpack(state.grid, state.width, state.height);
  return coords.every(({ x, y }) => unpackedGrid[y * state.width + x] === 1);
}

function getTeam(state: RoomStatePayload, teamId: number): TeamPayload {
  const team = state.teams?.find(({ id }) => id === teamId);
  if (!team) {
    throw new Error(`Unable to find team ${teamId}`);
  }
  return team;
}

describe('GameServer', () => {
  snapshotMatchTest(
    'broadcasts periodic snapshots during active matches',
    async ({ activeMatch }) => {
      const setup = activeMatch;

      const first = await waitForEvent<RoomStatePayload>(
        setup.host,
        'state',
        7000,
      );
      const second = await waitForEvent<RoomStatePayload>(
        setup.host,
        'state',
        7000,
      );

      expect(second.generation).toBeGreaterThan(first.generation);
      expect(second.tick).toBeGreaterThan(first.tick);
      expect(second.tick - first.tick).toBeGreaterThanOrEqual(50);
    },
    20_000,
  );

  stateRequestMatchTest(
    'responds to on-demand grid requests only to requester',
    async ({ activeMatch }) => {
      const setup = activeMatch;

      await waitForNoEvent(setup.guest, 'state:grid', 120);

      setup.host.emit('state:request', { sections: ['grid'] });
      const requestedState = await waitForEvent<RoomGridStatePayload>(
        setup.host,
        'state:grid',
        2500,
      );

      expect(requestedState.roomId).toBe(setup.roomId);

      setup.host.emit('state:request', { sections: ['grid'] });
      await expect(
        waitForEvent<RoomGridStatePayload>(setup.host, 'state:grid', 80),
      ).rejects.toThrow(/timed out/i);

      await waitForNoEvent(setup.host, 'state:grid', 120);
      setup.host.emit('state:request', { sections: ['grid'] });
      await expect(
        waitForEvent<RoomGridStatePayload>(setup.host, 'state:grid', 120),
      ).rejects.toThrow(/timed out/i);

      await waitForNoEvent(setup.guest, 'state:grid', 250);
    },
    20_000,
  );

  matchTest(
    'schedules buffered builds and emits one terminal outcome per scheduled event',
    async ({ activeMatch }) => {
      const setup = activeMatch;

      const generatorTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'generator',
      );
      if (!generatorTemplate) {
        throw new Error('Expected generator template to be available');
      }

      const candidatePlacements = collectCandidatePlacements(
        setup.hostTeam,
        generatorTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      );

      const queuedIntents: BuildQueuedPayload[] = [];
      const scheduledEvents: BuildScheduledPayload[] = [];
      for (const placement of candidatePlacements) {
        const scheduledPromise = waitForBuildScheduled(setup.host, 2_000).catch(
          () => null,
        );
        setup.host.emit('build:queue', {
          templateId: generatorTemplate.id,
          x: placement.x,
          y: placement.y,
          delayTicks: 40,
        });

        const response = await waitForBuildQueueResponse(setup.host);
        if ('queued' in response) {
          queuedIntents.push(response.queued);
          const scheduled = await scheduledPromise;
          if (scheduled) {
            scheduledEvents.push(scheduled);
          }
        }

        if (scheduledEvents.length === 8) {
          break;
        }
      }

      expect(queuedIntents.length).toBeGreaterThanOrEqual(8);
      expect(scheduledEvents.length).toBe(8);
      expect(
        queuedIntents.every(
          ({ intentId, scheduledByTurn, bufferedTurn }) =>
            intentId.length > 0 && scheduledByTurn >= bufferedTurn,
        ),
      ).toBe(true);

      const queuedById = new Map(
        scheduledEvents.map((scheduled) => [scheduled.eventId, scheduled]),
      );
      const outcomesById = await collectBuildOutcomes(
        setup.host,
        [...queuedById.keys()],
        10_000,
        200,
      );

      expect(outcomesById.size).toBe(queuedById.size);

      const observedOutcomes: BuildOutcomePayload[] = [];
      for (const [eventId, outcomes] of outcomesById.entries()) {
        expect(outcomes).toHaveLength(1);

        const outcome = outcomes[0];
        const queued = queuedById.get(eventId);
        if (!queued) {
          throw new Error(`Missing queued payload for event ${eventId}`);
        }

        expect(outcome.executeTick).toBe(queued.executeTick);
        expect(outcome.resolvedTick).toBeGreaterThanOrEqual(
          outcome.executeTick,
        );
        if (outcome.outcome === 'rejected') {
          expect(outcome.reason).toBeDefined();
        }

        observedOutcomes.push(outcome);
      }

      expect(
        observedOutcomes.some(({ outcome }) => outcome === 'applied'),
      ).toBe(true);
      expect(
        observedOutcomes.some(({ outcome }) => outcome === 'rejected'),
      ).toBe(true);
    },
    25_000,
  );

  matchTest(
    'emits one terminal outcome to both clients for overlapping scheduled builds',
    async ({ activeMatch }) => {
      const setup = activeMatch;

      const blockTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'block',
      );
      if (!blockTemplate) {
        throw new Error('Expected block template to be available');
      }

      const hostPlacements = collectCandidatePlacements(
        setup.hostTeam,
        blockTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      ).slice(0, 2);
      const guestPlacements = collectCandidatePlacements(
        setup.guestTeam,
        blockTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      ).slice(0, 2);

      expect(hostPlacements).toHaveLength(2);
      expect(guestPlacements).toHaveLength(2);

      const queuedEvents: Array<
        BuildQueuedPayload & { source: 'host' | 'guest' }
      > = [];
      const scheduledEvents: Array<
        BuildScheduledPayload & { source: 'host' | 'guest' }
      > = [];
      for (let index = 0; index < hostPlacements.length; index += 1) {
        const queuedPromise = collectBuildQueuedEvents(
          setup.host,
          2,
          4_000,
          50,
        );
        const scheduledPromise = collectBuildScheduledEvents(
          setup.host,
          2,
          4_000,
          50,
        );

        setup.host.emit('build:queue', {
          templateId: blockTemplate.id,
          x: hostPlacements[index].x,
          y: hostPlacements[index].y,
          delayTicks: 40,
        });
        setup.guest.emit('build:queue', {
          templateId: blockTemplate.id,
          x: guestPlacements[index].x,
          y: guestPlacements[index].y,
          delayTicks: 40,
        });

        const roundQueued = await queuedPromise;
        queuedEvents.push(
          ...roundQueued.map((queued) => ({
            ...queued,
            source:
              queued.teamId === setup.hostTeam.id
                ? ('host' as const)
                : ('guest' as const),
          })),
        );

        const roundScheduled = await scheduledPromise;
        scheduledEvents.push(
          ...roundScheduled.map((scheduled) => ({
            ...scheduled,
            source:
              scheduled.teamId === setup.hostTeam.id
                ? ('host' as const)
                : ('guest' as const),
          })),
        );
      }

      expect(new Set(queuedEvents.map(({ intentId }) => intentId)).size).toBe(
        queuedEvents.length,
      );

      const eventIds = scheduledEvents.map(({ eventId }) => eventId);
      expect(new Set(eventIds).size).toBe(eventIds.length);

      const queuedById = new Map(
        scheduledEvents.map((scheduled) => [scheduled.eventId, scheduled]),
      );
      const [hostOutcomesById, guestOutcomesById] = await Promise.all([
        collectBuildOutcomes(setup.host, eventIds, 12_000, 200),
        collectBuildOutcomes(setup.guest, eventIds, 12_000, 200),
      ]);

      for (const eventId of eventIds) {
        const hostOutcomes = hostOutcomesById.get(eventId) ?? [];
        const guestOutcomes = guestOutcomesById.get(eventId) ?? [];
        expect(hostOutcomes).toHaveLength(1);
        expect(guestOutcomes).toHaveLength(1);

        const hostOutcome = hostOutcomes[0];
        const guestOutcome = guestOutcomes[0];
        const scheduled = queuedById.get(eventId);
        if (!scheduled) {
          throw new Error(`Missing queued payload for event ${eventId}`);
        }

        expect(hostOutcome.executeTick).toBe(scheduled.executeTick);
        expect(hostOutcome.resolvedTick).toBeGreaterThanOrEqual(
          hostOutcome.executeTick,
        );
        expect(guestOutcome).toEqual(hostOutcome);

        if (hostOutcome.outcome === 'rejected') {
          expect(hostOutcome.reason).toBeDefined();
        }

        const expectedTeamId =
          scheduled.source === 'host' ? setup.hostTeam.id : setup.guestTeam.id;
        expect(hostOutcome.teamId).toBe(expectedTeamId);
      }
    },
    30_000,
  );

  matchTest(
    'returns explicit rejection reasons for out-of-zone build attempts',
    async ({ activeMatch }) => {
      const setup = activeMatch;

      setup.host.emit('build:queue', {
        templateId: 'block',
        x: -1,
        y: 0,
        delayTicks: 1,
      });
      const outOfBounds = await waitForEvent<RoomErrorPayload>(
        setup.host,
        'room:error',
      );
      expect(outOfBounds.reason).toBe('outside-territory');

      setup.host.emit('build:queue', {
        templateId: 'block',
        x: setup.guestTeam.baseTopLeft.x,
        y: setup.guestTeam.baseTopLeft.y,
        delayTicks: 1,
      });
      const outsideTerritory = await waitForEvent<RoomErrorPayload>(
        setup.host,
        'room:error',
      );
      expect(outsideTerritory.reason).toBe('outside-territory');
    },
    20_000,
  );

  matchTest(
    'rejects unaffordable queue attempts with exact deficit metadata after buffering',
    async ({ activeMatch }) => {
      const setup = activeMatch;

      const expensiveTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'generator',
      );
      if (!expensiveTemplate) {
        throw new Error('Expected generator template to be available');
      }

      const placements = collectCandidatePlacements(
        setup.hostTeam,
        expensiveTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
        { searchRadius: 18, step: 1 },
      );
      expect(placements.length).toBeGreaterThan(0);

      let insufficient: { error: RoomErrorPayload } | null = null;
      for (let attempt = 0; attempt < placements.length; attempt += 1) {
        const placement = placements[attempt];
        setup.host.emit('build:queue', {
          templateId: expensiveTemplate.id,
          x: placement.x,
          y: placement.y,
          delayTicks: 1,
        });

        const response = await waitForBuildQueueResponse(setup.host, 4_000);
        if ('error' in response) {
          if (response.error.reason === 'insufficient-resources') {
            insufficient = { error: response.error };
            break;
          }
          continue;
        }
      }

      expect(insufficient).not.toBeNull();
      if (!insufficient) {
        throw new Error(
          'Expected at least one insufficient-resources queue rejection',
        );
      }

      expect(insufficient.error.reason).toBe('insufficient-resources');
      const needed = insufficient.error.needed;
      const current = insufficient.error.current;
      const deficit = insufficient.error.deficit;

      if (
        typeof needed !== 'number' ||
        typeof current !== 'number' ||
        typeof deficit !== 'number'
      ) {
        throw new Error(
          'Expected insufficient-resources payload to include deficit fields',
        );
      }

      expect(current).toBeLessThan(needed);
      expect(deficit).toBe(needed - current);
    },
    25_000,
  );

  matchTest(
    'projects pending queue rows in sorted state order and removes rows after resolution',
    async ({ activeMatch }) => {
      const setup = activeMatch;

      const blockTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'block',
      );
      if (!blockTemplate) {
        throw new Error('Expected block template to be available');
      }

      const placements = collectCandidatePlacements(
        setup.hostTeam,
        blockTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      ).slice(0, 3);
      expect(placements).toHaveLength(3);

      const scheduled: BuildScheduledPayload[] = [];
      const delays = [18, 14, 18];

      for (let index = 0; index < placements.length; index += 1) {
        const placement = placements[index];
        const scheduledPromise = waitForBuildScheduled(setup.host, 4_000);
        setup.host.emit('build:queue', {
          templateId: blockTemplate.id,
          x: placement.x,
          y: placement.y,
          delayTicks: delays[index],
        });

        const response = await waitForBuildQueueResponse(setup.host, 4_000);
        if ('error' in response) {
          throw new Error(
            `Expected queued build response, received error: ${response.error.reason}`,
          );
        }

        scheduled.push(await scheduledPromise);
      }

      const queuedEventIds = scheduled.map(({ eventId }) => eventId);
      const expectedPendingOrder = [...scheduled]
        .sort((a, b) => a.executeTick - b.executeTick || a.eventId - b.eventId)
        .map(({ eventId }) => eventId);

      const pendingState = await waitForRoomState(
        setup.host,
        setup.roomId,
        (state) => {
          const team = state.teams.find(({ id }) => id === setup.hostTeam.id);
          if (!team) {
            return false;
          }

          const pendingIds = team.pendingBuilds.map(({ eventId }) => eventId);
          return queuedEventIds.every((eventId) =>
            pendingIds.includes(eventId),
          );
        },
        { attempts: 30 },
      );

      const pendingTeam = getTeamByPlayerId(
        pendingState,
        setup.hostJoined.playerId,
      );
      const observedPendingOrder = pendingTeam.pendingBuilds
        .filter(({ eventId }) => queuedEventIds.includes(eventId))
        .map(({ eventId }) => eventId);

      expect(observedPendingOrder).toEqual(expectedPendingOrder);

      await collectBuildOutcomes(setup.host, queuedEventIds, 12_000);

      const clearedState = await waitForRoomState(
        setup.host,
        setup.roomId,
        (state) => {
          const team = state.teams.find(({ id }) => id === setup.hostTeam.id);
          if (!team) {
            return false;
          }

          const pendingIds = new Set(
            team.pendingBuilds.map(({ eventId }) => eventId),
          );
          return queuedEventIds.every((eventId) => !pendingIds.has(eventId));
        },
        { attempts: 40 },
      );

      const clearedTeam = getTeamByPlayerId(
        clearedState,
        setup.hostJoined.playerId,
      );
      expect(
        clearedTeam.pendingBuilds.some(({ eventId }) =>
          queuedEventIds.includes(eventId),
        ),
      ).toBe(false);
    },
    30_000,
  );

  matchTest(
    'queues owned destroys, rejects invalid requests, and emits one terminal outcome to both clients',
    async ({ activeMatch }) => {
      const setup = activeMatch;

      const blockTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'block',
      );
      if (!blockTemplate) {
        throw new Error('Expected block template to be available');
      }

      const placements = collectCandidatePlacements(
        setup.hostTeam,
        blockTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      );
      expect(placements.length).toBeGreaterThan(0);

      let targetStructureKey: string | null = null;

      for (const placement of placements) {
        const scheduledPromise = waitForBuildScheduled(setup.host, 4_000).catch(
          () => null,
        );
        setup.host.emit('build:queue', {
          templateId: blockTemplate.id,
          x: placement.x,
          y: placement.y,
          delayTicks: 1,
        });

        const response = await waitForBuildQueueResponse(setup.host, 4_000);
        if ('error' in response) {
          continue;
        }

        const scheduled = await scheduledPromise;
        if (!scheduled) {
          continue;
        }

        const outcomesById = await collectBuildOutcomes(
          setup.host,
          [scheduled.eventId],
          8_000,
        );
        const outcome = outcomesById.get(scheduled.eventId)?.[0];
        if (!outcome || outcome.outcome !== 'applied') {
          continue;
        }

        const builtState = await waitForRoomState(
          setup.host,
          setup.roomId,
          (state) => {
            const hostTeamState = getTeamByPlayerId(
              state,
              setup.hostJoined.playerId,
            );
            return hostTeamState.structures.some(
              (structure) =>
                !structure.isCore &&
                structure.templateId === blockTemplate.id &&
                structure.hp > 0,
            );
          },
          { attempts: 30 },
        );
        const builtTeam = getTeamByPlayerId(
          builtState,
          setup.hostJoined.playerId,
        );
        const builtStructure = builtTeam.structures.find(
          (structure) =>
            !structure.isCore &&
            structure.templateId === blockTemplate.id &&
            structure.hp > 0,
        );

        if (builtStructure) {
          targetStructureKey = builtStructure.key;
          break;
        }
      }

      expect(targetStructureKey).not.toBeNull();
      if (!targetStructureKey) {
        throw new Error(
          'Expected an applied block structure to use as destroy target',
        );
      }

      const firstDestroyScheduledPromise = waitForDestroyScheduled(
        setup.host,
        4_000,
      );
      setup.host.emit('destroy:queue', {
        structureKey: targetStructureKey,
        delayTicks: 8,
      });
      const firstDestroyResponse = await waitForDestroyQueueResponse(
        setup.host,
      );
      if ('error' in firstDestroyResponse) {
        throw new Error(
          `Expected first destroy queue request to be accepted, received ${firstDestroyResponse.error.reason}`,
        );
      }

      const firstDestroyScheduled = await firstDestroyScheduledPromise;
      expect(firstDestroyScheduled.idempotent).toBe(false);

      const duplicateDestroyScheduledPromise = waitForDestroyScheduled(
        setup.host,
        4_000,
      );
      setup.host.emit('destroy:queue', {
        structureKey: targetStructureKey,
        delayTicks: 8,
      });
      const duplicateDestroyResponse = await waitForDestroyQueueResponse(
        setup.host,
      );
      if ('error' in duplicateDestroyResponse) {
        throw new Error(
          `Expected duplicate destroy queue request to be idempotent, received ${duplicateDestroyResponse.error.reason}`,
        );
      }

      const duplicateDestroyScheduled = await duplicateDestroyScheduledPromise;
      expect(duplicateDestroyScheduled.idempotent).toBe(true);
      expect(duplicateDestroyScheduled.eventId).toBe(
        firstDestroyScheduled.eventId,
      );
      expect(duplicateDestroyScheduled.executeTick).toBe(
        firstDestroyScheduled.executeTick,
      );

      setup.guest.emit('destroy:queue', {
        structureKey: targetStructureKey,
        delayTicks: 1,
      });
      const wrongOwnerError = await waitForEvent<RoomErrorPayload>(
        setup.guest,
        'room:error',
        1_500,
      );
      expect(wrongOwnerError.reason).toBe('wrong-owner');

      setup.host.emit('destroy:queue', {
        structureKey: 'missing-target-key',
        delayTicks: 1,
      });
      const invalidTargetError = await waitForEvent<RoomErrorPayload>(
        setup.host,
        'room:error',
        1_500,
      );
      expect(invalidTargetError.reason).toBe('invalid-target');

      const [hostOutcomesById, guestOutcomesById] = await Promise.all([
        collectDestroyOutcomes(
          setup.host,
          [firstDestroyScheduled.eventId],
          12_000,
          200,
        ),
        collectDestroyOutcomes(
          setup.guest,
          [firstDestroyScheduled.eventId],
          12_000,
          200,
        ),
      ]);

      const hostOutcomes =
        hostOutcomesById.get(firstDestroyScheduled.eventId) ?? [];
      const guestOutcomes =
        guestOutcomesById.get(firstDestroyScheduled.eventId) ?? [];
      expect(hostOutcomes).toHaveLength(1);
      expect(guestOutcomes).toHaveLength(1);

      const hostOutcome = hostOutcomes[0];
      const guestOutcome = guestOutcomes[0];
      expect(guestOutcome).toEqual(hostOutcome);
      expect(hostOutcome.outcome).toBe('destroyed');
      expect(hostOutcome.structureKey).toBe(targetStructureKey);
      expect(hostOutcome.executeTick).toBe(firstDestroyScheduled.executeTick);
      expect(hostOutcome.resolvedTick).toBeGreaterThanOrEqual(
        hostOutcome.executeTick,
      );

      setup.host.emit('destroy:queue', {
        structureKey: targetStructureKey,
        delayTicks: 1,
      });
      const staleDestroyError = await waitForEvent<RoomErrorPayload>(
        setup.host,
        'room:error',
        1_500,
      );
      expect(staleDestroyError.reason).toBe('invalid-lifecycle-state');
    },
    40_000,
  );

  matchTest(
    'queues template builds and charges resources',
    async ({ activeMatch }) => {
      const setup = activeMatch;

      const teamId = setup.hostTeam.id;
      const initialTeamState = await waitForRoomState(
        setup.host,
        setup.roomId,
        (state) =>
          state.roomId === setup.roomId &&
          state.teams.some(({ id }) => id === teamId),
        { attempts: 20 },
      );
      const initialTeam = getTeam(initialTeamState, teamId);

      const blockTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'block',
      );
      if (!blockTemplate) {
        throw new Error('Expected block template to be available');
      }

      const placements = collectCandidatePlacements(
        initialTeam,
        blockTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      );
      const selectedPlacement = placements[0];
      if (!selectedPlacement) {
        throw new Error('Expected at least one valid block placement');
      }

      const buildX = selectedPlacement.x;
      const buildY = selectedPlacement.y;
      const buildTransform = normalizePlacementTransform({
        operations: ['rotate'],
      });

      const blockCells: Cell[] = [
        { x: buildX, y: buildY },
        { x: buildX + 1, y: buildY },
        { x: buildX, y: buildY + 1 },
        { x: buildX + 1, y: buildY + 1 },
      ];

      const scheduledPromise = waitForBuildScheduled(setup.host, 4_000);
      const guestQueuedPromise = waitForEvent<BuildQueuedPayload>(
        setup.guest,
        'build:queued',
      );

      setup.host.emit('build:queue', {
        templateId: blockTemplate.id,
        x: buildX,
        y: buildY,
        transform: { operations: ['rotate'] },
        delayTicks: 1,
      });

      const queued = await waitForEvent<BuildQueuedPayload>(
        setup.host,
        'build:queued',
      );
      const [scheduled, guestQueued] = await Promise.all([
        scheduledPromise,
        guestQueuedPromise,
      ]);

      expect(queued.intentId).toMatch(/^intent-/);
      expect(queued).toMatchObject({
        roomId: setup.roomId,
        playerId: setup.hostJoined.playerId,
        teamId,
        templateId: blockTemplate.id,
        x: buildX,
        y: buildY,
        transform: buildTransform,
        delayTicks: 1,
        eventId: scheduled.eventId,
        executeTick: scheduled.executeTick,
      });
      expect(guestQueued).toEqual(queued);
      expect(scheduled.eventId).toBeGreaterThan(0);
      expect(scheduled.executeTick).toBeGreaterThan(0);

      const builtState = await waitForRoomState(
        setup.host,
        setup.roomId,
        (state) =>
          blockAlive(state, blockCells) &&
          getTeam(state, teamId).resources < initialTeam.resources,
        { attempts: 12 },
      );

      expect(blockAlive(builtState, blockCells)).toBe(true);
      expect(getTeam(builtState, teamId).resources).toBeLessThan(
        initialTeam.resources,
      );
    },
    20_000,
  );

  matchTest(
    'canonicalizes authoritative queued payload coordinates and delay',
    async ({ activeMatch }) => {
      const setup = activeMatch;
      const blockTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'block',
      );
      if (!blockTemplate) {
        throw new Error('Expected block template to be available');
      }

      const placements = collectCandidatePlacements(
        setup.hostTeam,
        blockTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      );
      const selectedPlacement = placements[0];
      if (!selectedPlacement) {
        throw new Error('Expected at least one valid block placement');
      }

      const queuedPromise = waitForEvent<BuildQueuedPayload>(
        setup.host,
        'build:queued',
      );

      setup.host.emit('build:queue', {
        templateId: blockTemplate.id,
        x: selectedPlacement.x + setup.hostJoined.state.width,
        y: selectedPlacement.y,
        transform: { operations: ['rotate'] },
        delayTicks: 999,
      });

      const queued = await queuedPromise;
      expect(queued.x).toBe(selectedPlacement.x);
      expect(queued.y).toBe(selectedPlacement.y);
      expect(queued.transform).toEqual(
        normalizePlacementTransform({ operations: ['rotate'] }),
      );
      expect(queued.delayTicks).toBe(20);
      expect(queued.executeTick - queued.bufferedTurn).toBe(20);
    },
    20_000,
  );

  matchTest.fails(
    'sends build:scheduled only to the queueing client after authoritative queue fanout',
    async ({ activeMatch }) => {
      const setup = activeMatch;
      const blockTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'block',
      );
      if (!blockTemplate) {
        throw new Error('Expected block template to be available');
      }

      const placements = collectCandidatePlacements(
        setup.hostTeam,
        blockTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      );
      const selectedPlacement = placements[0];
      if (!selectedPlacement) {
        throw new Error('Expected at least one valid block placement');
      }

      setup.host.emit('build:queue', {
        templateId: blockTemplate.id,
        x: selectedPlacement.x,
        y: selectedPlacement.y,
        delayTicks: 1,
      });

      await waitForBuildScheduled(setup.host, 4_000);
      await waitForNoEvent(setup.guest, 'build:scheduled', 750);
    },
    20_000,
  );

  matchTest.fails(
    'detects missing authoritative queue events and requests a resync',
    () => {
      // TODO: Replace with queue-gap coverage once the resync path exists.
      expect(true).toBe(false);
    },
    20_000,
  );

  skirmishRoomTest(
    'creates and joins a custom room',
    async ({ connectClient }) => {
      const socket = connectClient();
      await waitForEvent(socket, 'room:joined');

      socket.emit('room:create', {
        name: 'Skirmish',
        width: 48,
        height: 48,
      });

      const joined = await waitForEvent<RoomJoinedPayload>(
        socket,
        'room:joined',
      );
      expect(joined.roomName).toBe('Skirmish');
      expect(joined.state.width).toBe(48);
      expect(joined.state.height).toBe(48);

      socket.emit('room:list');
      const rooms = await waitForRoomList(
        socket,
        (entries) => entries.some(({ roomId }) => roomId === joined.roomId),
        { attempts: 8 },
      );
      expect(rooms.some(({ roomId }) => roomId === joined.roomId)).toBe(true);
    },
  );

  partyRoomTest(
    'supports joining and leaving rooms from another client',
    async ({ connectClient }) => {
      const owner = connectClient();
      await waitForEvent(owner, 'room:joined');

      owner.emit('room:create', {
        name: 'Party Room',
        width: 40,
        height: 40,
      });
      const ownerRoom = await waitForEvent<RoomJoinedPayload>(
        owner,
        'room:joined',
      );
      await claimSlot(owner, 'team-1');

      const guest = connectClient();
      await waitForEvent(guest, 'room:joined');
      guest.emit('room:join', { roomId: ownerRoom.roomId });

      const guestRoom = await waitForEvent<RoomJoinedPayload>(
        guest,
        'room:joined',
      );
      expect(guestRoom.roomId).toBe(ownerRoom.roomId);
      await claimSlot(guest, 'team-2');

      const withTwoTeams = await waitForRoomState(
        owner,
        ownerRoom.roomId,
        (state) => state.roomId === ownerRoom.roomId && state.teams.length >= 2,
        { attempts: 12 },
      );
      expect(withTwoTeams.teams.length).toBeGreaterThanOrEqual(2);

      guest.emit('room:leave');
      const leftPayload = await waitForEvent<RoomLeftPayload>(
        guest,
        'room:left',
      );
      expect(leftPayload.roomId).toBe(ownerRoom.roomId);

      const backToOneTeam = await waitForRoomState(
        owner,
        ownerRoom.roomId,
        (state) =>
          state.roomId === ownerRoom.roomId && state.teams.length === 1,
        { attempts: 12 },
      );
      expect(backToOneTeam.teams).toHaveLength(1);
    },
  );
});
