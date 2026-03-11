import { describe, expect } from 'vitest';

import {
  type BuildQueuedPayload,
  type DestroyQueuedPayload,
  type RoomErrorPayload,
  type RoomGridStatePayload,
  type RoomJoinedPayload,
  type RoomLeftPayload,
  type RoomStateHashesPayload,
  type RoomStatePayload,
  type TeamPayload,
  normalizePlacementTransform,
} from '#rts-engine';

import { type IntegrationClock, createIntegrationTest } from './fixtures.js';
import { createMatchTest } from './match-fixtures.js';
import {
  claimSlot,
  collectBuildOutcomes,
  collectBuildQueuedEvents,
  collectCandidatePlacements,
  collectDestroyOutcomes,
  expectBuildQueueRejected,
  expectDestroyQueueRejected,
  getTeamByPlayerId,
  observeEvents,
  waitForBuildQueueResponse,
  waitForDestroyQueueResponse,
  waitForEvent,
  waitForRoomList,
  waitForRoomState,
  waitForStateHashes,
  waitForStateStructures,
} from './test-support.js';

const SNAPSHOT_INTERVAL_TICKS = 50;
const SNAPSHOT_ADVANCE_LIMIT_TICKS = 5;
const QUEUE_FANOUT_ADVANCE_LIMIT_TICKS = 5;
const OUTCOME_ADVANCE_MARGIN_TICKS = 2;
const STATE_REQUEST_ADVANCE_MS = 100;

const defaultServerOptions = { port: 0, width: 52, height: 52, tickMs: 40 };
const buildQueueRoomOptions = { roomName: 'Build Queue Contract Room' };

const matchTest = createMatchTest(
  {
    ...defaultServerOptions,
    countdownSeconds: 0,
  },
  buildQueueRoomOptions,
);
const snapshotMatchTest = createMatchTest(
  {
    ...defaultServerOptions,
    countdownSeconds: 0,
    activeStateSnapshotIntervalTicks: 50,
  },
  buildQueueRoomOptions,
  {},
  { clockMode: 'manual' },
);
const stateRequestMatchTest = createMatchTest(
  {
    ...defaultServerOptions,
    countdownSeconds: 0,
    activeStateSnapshotIntervalTicks: 1000,
  },
  buildQueueRoomOptions,
  {},
  { clockMode: 'manual' },
);
const fanoutMatchTest = createMatchTest(
  {
    ...defaultServerOptions,
    countdownSeconds: 0,
  },
  buildQueueRoomOptions,
  {},
  { clockMode: 'manual' },
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
const lobbyMutationTest = createIntegrationTest({
  ...defaultServerOptions,
  countdownSeconds: 3,
});

function getTeam(state: RoomStatePayload, teamId: number): TeamPayload {
  const team = state.teams?.find(({ id }) => id === teamId);
  if (!team) {
    throw new Error(`Unable to find team ${teamId}`);
  }
  return team;
}

async function advanceUntilObservedCount(
  clock: IntegrationClock,
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

describe('GameServer', () => {
  snapshotMatchTest(
    'broadcasts periodic snapshots during active matches',
    async ({ activeMatch, integration }) => {
      const setup = activeMatch;

      const stateObserver = observeEvents<RoomStatePayload>(
        setup.host,
        'state',
      );
      for (
        let advancedTicks = 0;
        advancedTicks <
          SNAPSHOT_INTERVAL_TICKS + SNAPSHOT_ADVANCE_LIMIT_TICKS &&
        stateObserver.events.length < 1;
        advancedTicks += 1
      ) {
        await integration.clock.advanceTicks(1);
      }
      expect(stateObserver.events.length).toBeGreaterThanOrEqual(1);
      const first = stateObserver.events[0];

      for (
        let advancedTicks = 0;
        advancedTicks <
          SNAPSHOT_INTERVAL_TICKS + SNAPSHOT_ADVANCE_LIMIT_TICKS &&
        stateObserver.events.length < 2;
        advancedTicks += 1
      ) {
        await integration.clock.advanceTicks(1);
      }
      stateObserver.stop();
      expect(stateObserver.events.length).toBeGreaterThanOrEqual(2);
      const second = stateObserver.events[1];

      expect(second.generation).toBeGreaterThan(first.generation);
      expect(second.tick).toBeGreaterThan(first.tick);
      expect(second.tick - first.tick).toBeGreaterThanOrEqual(50);
    },
    20_000,
  );

  stateRequestMatchTest(
    'responds to on-demand grid requests only to requester',
    async ({ activeMatch, integration }) => {
      const setup = activeMatch;

      await integration.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const guestGridObserver = observeEvents<RoomGridStatePayload>(
        setup.guest,
        'state:grid',
      );

      setup.host.emit('state:request', { sections: ['grid'] });
      const requestedState = await waitForEvent<RoomGridStatePayload>(
        setup.host,
        'state:grid',
        2500,
      );

      expect(requestedState.roomId).toBe(setup.roomId);
      await integration.clock.flush();
      expect(guestGridObserver.events).toHaveLength(0);

      const duplicateGridObserver = observeEvents<RoomGridStatePayload>(
        setup.host,
        'state:grid',
      );

      setup.host.emit('state:request', { sections: ['grid'] });
      await integration.clock.flush();
      expect(duplicateGridObserver.events).toHaveLength(0);

      await integration.clock.advanceMs(120);
      setup.host.emit('state:request', { sections: ['grid'] });
      await integration.clock.flush();
      expect(duplicateGridObserver.events).toHaveLength(0);
      duplicateGridObserver.stop();

      expect(guestGridObserver.events).toHaveLength(0);
      guestGridObserver.stop();
    },
    20_000,
  );

  lobbyMutationTest(
    'rejects gameplay mutations before the match becomes active',
    async ({ connectClient }) => {
      const owner = connectClient({ sessionId: 'lobby-mutation-owner' });
      await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

      owner.emit('room:create', {
        name: 'Lobby Mutation Room',
        width: 52,
        height: 52,
      });
      const created = await waitForEvent<RoomJoinedPayload>(
        owner,
        'room:joined',
      );

      await claimSlot(owner, 'team-1');

      const claimedState = await waitForRoomState(
        owner,
        created.roomId,
        (state) =>
          state.roomId === created.roomId &&
          state.teams.some(({ playerIds }) =>
            playerIds.includes(created.playerId),
          ),
      );
      const ownedTeam = claimedState.teams.find(({ playerIds }) =>
        playerIds.includes(created.playerId),
      );
      const ownedStructure = ownedTeam?.structures[0];
      const blockTemplate = created.templates.find(({ id }) => id === 'block');
      if (!ownedStructure || !blockTemplate) {
        throw new Error('Expected claimed team structure and block template');
      }

      const buildErrorPromise = waitForEvent<RoomErrorPayload>(
        owner,
        'room:error',
      );
      owner.emit('build:queue', {
        templateId: blockTemplate.id,
        x: 1,
        y: 1,
        delayTicks: 1,
      });
      await expect(buildErrorPromise).resolves.toMatchObject({
        roomId: created.roomId,
        reason: 'invalid-state',
        message: 'Gameplay mutations are only allowed during active matches',
      });

      const destroyErrorPromise = waitForEvent<RoomErrorPayload>(
        owner,
        'room:error',
      );
      owner.emit('destroy:queue', {
        structureKey: ownedStructure.key,
        delayTicks: 1,
      });
      await expect(destroyErrorPromise).resolves.toMatchObject({
        roomId: created.roomId,
        reason: 'invalid-state',
        message: 'Gameplay mutations are only allowed during active matches',
      });
    },
    20_000,
  );

  fanoutMatchTest(
    'queues buffered builds and emits one terminal outcome per queued event',
    async ({ activeMatch, integration }) => {
      const setup = activeMatch;

      const blockTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'block',
      );
      if (!blockTemplate) {
        throw new Error('Expected block template to be available');
      }

      const candidatePlacements = collectCandidatePlacements(
        setup.hostTeam,
        blockTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      );
      const duplicatePlacement = candidatePlacements[0];
      const controlPlacement = candidatePlacements[1];
      if (!duplicatePlacement || !controlPlacement) {
        throw new Error('Expected at least two valid block placements');
      }

      const queuedObserver = observeEvents<BuildQueuedPayload>(
        setup.host,
        'build:queued',
      );
      const queuedIntentsPromise = collectBuildQueuedEvents(
        setup.host,
        3,
        4_000,
      );
      for (const placement of [
        duplicatePlacement,
        duplicatePlacement,
        controlPlacement,
      ]) {
        setup.host.emit('build:queue', {
          templateId: blockTemplate.id,
          x: placement.x,
          y: placement.y,
          delayTicks: 8,
        });
      }

      await advanceUntilObservedCount(
        integration.clock,
        queuedObserver,
        3,
        QUEUE_FANOUT_ADVANCE_LIMIT_TICKS,
      );
      queuedObserver.stop();

      const queuedIntents = await queuedIntentsPromise;

      expect(queuedIntents).toHaveLength(3);

      const queuedById = new Map(
        queuedIntents.map((queued) => [queued.eventId, queued]),
      );
      const outcomesByIdPromise = collectBuildOutcomes(
        setup.host,
        [...queuedById.keys()],
        10_000,
      );
      await integration.clock.advanceTicks(8 + OUTCOME_ADVANCE_MARGIN_TICKS);
      const outcomesById = await outcomesByIdPromise;

      expect(outcomesById.size).toBe(queuedById.size);

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
      }

      const [firstDuplicate, secondDuplicate, controlBuild] = queuedIntents;
      const firstDuplicateOutcome =
        outcomesById.get(firstDuplicate.eventId)?.[0] ?? null;
      const secondDuplicateOutcome =
        outcomesById.get(secondDuplicate.eventId)?.[0] ?? null;
      const controlOutcome =
        outcomesById.get(controlBuild.eventId)?.[0] ?? null;

      expect(firstDuplicateOutcome?.outcome).toBe('applied');
      expect(secondDuplicateOutcome?.outcome).toBe('rejected');
      expect(secondDuplicateOutcome?.reason).toBe('occupied-site');
      expect(controlOutcome?.outcome).toBe('applied');
    },
    25_000,
  );

  fanoutMatchTest(
    'emits one terminal outcome to both clients for overlapping queued builds',
    async ({ activeMatch, integration }) => {
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
      for (let index = 0; index < hostPlacements.length; index += 1) {
        const queuedObserver = observeEvents<BuildQueuedPayload>(
          setup.host,
          'build:queued',
        );
        const queuedPromise = collectBuildQueuedEvents(setup.host, 2, 4_000);

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

        await advanceUntilObservedCount(
          integration.clock,
          queuedObserver,
          2,
          QUEUE_FANOUT_ADVANCE_LIMIT_TICKS,
        );
        queuedObserver.stop();

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
      }

      expect(new Set(queuedEvents.map(({ intentId }) => intentId)).size).toBe(
        queuedEvents.length,
      );

      const eventIds = queuedEvents.map(({ eventId }) => eventId);
      expect(new Set(eventIds).size).toBe(eventIds.length);

      const queuedById = new Map(
        queuedEvents.map((queued) => [queued.eventId, queued]),
      );
      const hostOutcomesByIdPromise = collectBuildOutcomes(
        setup.host,
        eventIds,
        12_000,
      );
      const guestOutcomesByIdPromise = collectBuildOutcomes(
        setup.guest,
        eventIds,
        12_000,
      );
      await integration.clock.advanceTicks(40 + OUTCOME_ADVANCE_MARGIN_TICKS);
      const [hostOutcomesById, guestOutcomesById] = await Promise.all([
        hostOutcomesByIdPromise,
        guestOutcomesByIdPromise,
      ]);

      for (const eventId of eventIds) {
        const hostOutcomes = hostOutcomesById.get(eventId) ?? [];
        const guestOutcomes = guestOutcomesById.get(eventId) ?? [];
        expect(hostOutcomes).toHaveLength(1);
        expect(guestOutcomes).toHaveLength(1);

        const hostOutcome = hostOutcomes[0];
        const guestOutcome = guestOutcomes[0];
        const queued = queuedById.get(eventId);
        if (!queued) {
          throw new Error(`Missing queued payload for event ${eventId}`);
        }

        expect(hostOutcome.executeTick).toBe(queued.executeTick);
        expect(hostOutcome.resolvedTick).toBeGreaterThanOrEqual(
          hostOutcome.executeTick,
        );
        expect(guestOutcome).toEqual(hostOutcome);

        if (hostOutcome.outcome === 'rejected') {
          expect(hostOutcome.reason).toBeDefined();
        }

        const expectedTeamId =
          queued.source === 'host' ? setup.hostTeam.id : setup.guestTeam.id;
        expect(hostOutcome.teamId).toBe(expectedTeamId);
      }
    },
    30_000,
  );

  matchTest(
    'returns explicit rejection reasons for out-of-zone build attempts',
    async ({ activeMatch }) => {
      const setup = activeMatch;

      const outOfBoundsRejected = await expectBuildQueueRejected(
        setup.host,
        () => {
          setup.host.emit('build:queue', {
            templateId: 'block',
            x: -1,
            y: 0,
            delayTicks: 1,
          });
        },
        1_500,
      );
      expect(outOfBoundsRejected.reason).toBe('outside-territory');

      const outsideTerritoryRejected = await expectBuildQueueRejected(
        setup.host,
        () => {
          setup.host.emit('build:queue', {
            templateId: 'block',
            x: setup.guestTeam.baseTopLeft.x,
            y: setup.guestTeam.baseTopLeft.y,
            delayTicks: 1,
          });
        },
        1_500,
      );
      expect(outsideTerritoryRejected.reason).toBe('outside-territory');
    },
    20_000,
  );

  matchTest(
    'rejects unaffordable queue attempts with exact deficit metadata after buffering',
    async ({ activeMatch }) => {
      const setup = activeMatch;
      const initialState = await waitForRoomState(
        setup.host,
        setup.roomId,
        (state) => state.roomId === setup.roomId,
        { attempts: 20 },
      );

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

      let lastObservedResources = getTeam(
        initialState,
        setup.hostTeam.id,
      ).resources;
      let acceptedQueues = 0;
      let insufficient: Awaited<
        ReturnType<typeof waitForBuildQueueResponse>
      > | null = null;
      for (let attempt = 0; attempt < placements.length; attempt += 1) {
        const placement = placements[attempt];
        const queueResponsePromise = waitForBuildQueueResponse(
          setup.host,
          4_000,
        );
        setup.host.emit('build:queue', {
          templateId: expensiveTemplate.id,
          x: placement.x,
          y: placement.y,
          delayTicks: 80,
        });

        const response = await queueResponsePromise;
        if ('error' in response) {
          if (response.error.reason === 'insufficient-resources') {
            insufficient = { error: response.error };
            break;
          }
          continue;
        }

        acceptedQueues += 1;
        const queuedState = await waitForRoomState(
          setup.host,
          setup.roomId,
          (state) => {
            const team = getTeam(state, setup.hostTeam.id);
            return (
              team.pendingBuilds.some(
                ({ eventId }) => eventId === response.queued.eventId,
              ) &&
              team.pendingBuilds.length >= acceptedQueues &&
              team.resources < lastObservedResources
            );
          },
          { attempts: 20 },
        );
        lastObservedResources = getTeam(
          queuedState,
          setup.hostTeam.id,
        ).resources;
      }

      if (!insufficient || !('error' in insufficient)) {
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

      expect(current).toBe(lastObservedResources);
      expect(current).toBeLessThan(needed);
      expect(deficit).toBe(needed - current);
    },
    25_000,
  );

  fanoutMatchTest(
    'projects pending queue rows in sorted state order and removes rows after resolution',
    async ({ activeMatch, integration }) => {
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

      const delays = [18, 14, 18];
      const queuedObserver = observeEvents<BuildQueuedPayload>(
        setup.host,
        'build:queued',
      );
      const queuedPayloadsPromise = collectBuildQueuedEvents(
        setup.host,
        placements.length,
        4_000,
      );

      for (let index = 0; index < placements.length; index += 1) {
        const placement = placements[index];
        setup.host.emit('build:queue', {
          templateId: blockTemplate.id,
          x: placement.x,
          y: placement.y,
          delayTicks: delays[index],
        });
      }

      await advanceUntilObservedCount(
        integration.clock,
        queuedObserver,
        placements.length,
        QUEUE_FANOUT_ADVANCE_LIMIT_TICKS,
      );
      queuedObserver.stop();

      const queuedPayloads = await queuedPayloadsPromise;

      const queuedEventIds = queuedPayloads.map(({ eventId }) => eventId);
      const expectedPendingOrder = [...queuedPayloads]
        .sort((a, b) => a.executeTick - b.executeTick || a.eventId - b.eventId)
        .map(({ eventId }) => eventId);

      const pendingStatePromise = waitForRoomState(
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
      await integration.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const pendingState = await pendingStatePromise;

      const pendingTeam = getTeamByPlayerId(
        pendingState,
        setup.hostJoined.playerId,
      );
      const observedPendingOrder = pendingTeam.pendingBuilds
        .filter(({ eventId }) => queuedEventIds.includes(eventId))
        .map(({ eventId }) => eventId);

      expect(observedPendingOrder).toEqual(expectedPendingOrder);

      const outcomesPromise = collectBuildOutcomes(
        setup.host,
        queuedEventIds,
        12_000,
      );
      await integration.clock.advanceTicks(18 + OUTCOME_ADVANCE_MARGIN_TICKS);
      await outcomesPromise;

      const clearedStatePromise = waitForRoomState(
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
      await integration.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const clearedState = await clearedStatePromise;

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

  fanoutMatchTest(
    'queues owned destroys, rejects invalid requests, and emits one terminal outcome to both clients',
    async ({ activeMatch, integration }) => {
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
        const queueResponsePromise = waitForBuildQueueResponse(
          setup.host,
          4_000,
        );
        const queueObserver = observeEvents<BuildQueuedPayload>(
          setup.host,
          'build:queued',
        );

        setup.host.emit('build:queue', {
          templateId: blockTemplate.id,
          x: placement.x,
          y: placement.y,
          delayTicks: 1,
        });

        for (
          let advancedTicks = 0;
          advancedTicks < QUEUE_FANOUT_ADVANCE_LIMIT_TICKS &&
          queueObserver.events.length === 0;
          advancedTicks += 1
        ) {
          await integration.clock.advanceTicks(1);
        }

        const response = await queueResponsePromise;
        queueObserver.stop();
        if ('error' in response) {
          continue;
        }
        expect(queueObserver.events.length).toBeGreaterThan(0);

        const outcomesByIdPromise = collectBuildOutcomes(
          setup.host,
          [response.queued.eventId],
          8_000,
        );
        await integration.clock.advanceTicks(
          response.queued.delayTicks + OUTCOME_ADVANCE_MARGIN_TICKS,
        );
        const outcomesById = await outcomesByIdPromise;
        const outcome = outcomesById.get(response.queued.eventId)?.[0];
        if (!outcome || outcome.outcome !== 'applied') {
          continue;
        }

        const builtStatePromise = waitForRoomState(
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
        await integration.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
        const builtState = await builtStatePromise;
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

      const wrongOwnerRejected = await expectDestroyQueueRejected(
        setup.guest,
        () => {
          setup.guest.emit('destroy:queue', {
            structureKey: targetStructureKey,
            delayTicks: 1,
          });
        },
        1_500,
      );
      expect(wrongOwnerRejected.reason).toBe('wrong-owner');

      const destroyQueuedObserver = observeEvents<DestroyQueuedPayload>(
        setup.host,
        'destroy:queued',
      );
      const firstDestroyResponsePromise = waitForDestroyQueueResponse(
        setup.host,
      );
      setup.host.emit('destroy:queue', {
        structureKey: targetStructureKey,
        delayTicks: 8,
      });
      await advanceUntilObservedCount(
        integration.clock,
        destroyQueuedObserver,
        1,
        QUEUE_FANOUT_ADVANCE_LIMIT_TICKS,
      );
      const firstDestroyResponse = await firstDestroyResponsePromise;
      if ('error' in firstDestroyResponse) {
        throw new Error(
          `Expected first destroy queue request to be accepted, received ${firstDestroyResponse.error.reason}`,
        );
      }

      const firstDestroyQueued: DestroyQueuedPayload =
        firstDestroyResponse.queued;
      expect(firstDestroyQueued.idempotent).toBe(false);

      const duplicateDestroyResponsePromise = waitForDestroyQueueResponse(
        setup.host,
      );
      setup.host.emit('destroy:queue', {
        structureKey: targetStructureKey,
        delayTicks: 8,
      });
      await advanceUntilObservedCount(
        integration.clock,
        destroyQueuedObserver,
        2,
        QUEUE_FANOUT_ADVANCE_LIMIT_TICKS,
      );
      destroyQueuedObserver.stop();
      const duplicateDestroyResponse = await duplicateDestroyResponsePromise;
      if ('error' in duplicateDestroyResponse) {
        throw new Error(
          `Expected duplicate destroy queue request to be idempotent, received ${duplicateDestroyResponse.error.reason}`,
        );
      }

      const duplicateDestroyQueued: DestroyQueuedPayload =
        duplicateDestroyResponse.queued;
      expect(duplicateDestroyQueued.idempotent).toBe(true);
      expect(duplicateDestroyQueued.eventId).toBe(firstDestroyQueued.eventId);
      expect(duplicateDestroyQueued.executeTick).toBe(
        firstDestroyQueued.executeTick,
      );

      const invalidTargetRejected = await expectDestroyQueueRejected(
        setup.host,
        () => {
          setup.host.emit('destroy:queue', {
            structureKey: 'missing-target-key',
            delayTicks: 1,
          });
        },
        1_500,
      );
      expect(invalidTargetRejected.reason).toBe('invalid-target');

      const hostOutcomesByIdPromise = collectDestroyOutcomes(
        setup.host,
        [firstDestroyQueued.eventId],
        12_000,
      );
      const guestOutcomesByIdPromise = collectDestroyOutcomes(
        setup.guest,
        [firstDestroyQueued.eventId],
        12_000,
      );
      await integration.clock.advanceTicks(
        firstDestroyQueued.delayTicks + OUTCOME_ADVANCE_MARGIN_TICKS,
      );
      const [hostOutcomesById, guestOutcomesById] = await Promise.all([
        hostOutcomesByIdPromise,
        guestOutcomesByIdPromise,
      ]);

      const hostOutcomes =
        hostOutcomesById.get(firstDestroyQueued.eventId) ?? [];
      const guestOutcomes =
        guestOutcomesById.get(firstDestroyQueued.eventId) ?? [];
      expect(hostOutcomes).toHaveLength(1);
      expect(guestOutcomes).toHaveLength(1);

      const hostOutcome = hostOutcomes[0];
      const guestOutcome = guestOutcomes[0];
      expect(guestOutcome).toEqual(hostOutcome);
      expect(hostOutcome.outcome).toBe('destroyed');
      expect(hostOutcome.structureKey).toBe(targetStructureKey);
      expect(hostOutcome.executeTick).toBe(firstDestroyQueued.executeTick);
      expect(hostOutcome.resolvedTick).toBeGreaterThanOrEqual(
        hostOutcome.executeTick,
      );

      const staleDestroyRejected = await expectDestroyQueueRejected(
        setup.host,
        () => {
          setup.host.emit('destroy:queue', {
            structureKey: targetStructureKey,
            delayTicks: 1,
          });
        },
        1_500,
      );
      expect(staleDestroyRejected.reason).toBe('invalid-lifecycle-state');
    },
    40_000,
  );

  matchTest(
    'rejects gameplay mutations from spectators during active matches',
    async ({ activeMatch, connectClient }) => {
      const setup = activeMatch;
      const spectator = connectClient({ sessionId: 'active-match-spectator' });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');

      spectator.emit('room:join', { roomId: setup.roomId });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');

      const blockTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'block',
      );
      if (!blockTemplate) {
        throw new Error('Expected block template to be available');
      }

      const [placement] = collectCandidatePlacements(
        setup.hostTeam,
        blockTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      );
      if (!placement) {
        throw new Error('Expected a valid block placement');
      }

      const currentState = await waitForRoomState(
        setup.host,
        setup.roomId,
        (state) =>
          state.roomId === setup.roomId &&
          state.teams.some(({ id }) => id === setup.hostTeam.id),
        { attempts: 20 },
      );
      const hostStructure = getTeam(currentState, setup.hostTeam.id)
        .structures[0];
      if (!hostStructure) {
        throw new Error('Expected host team to own at least one structure');
      }

      const buildErrorPromise = waitForEvent<RoomErrorPayload>(
        spectator,
        'room:error',
      );
      spectator.emit('build:queue', {
        templateId: blockTemplate.id,
        x: placement.x,
        y: placement.y,
        delayTicks: 1,
      });
      await expect(buildErrorPromise).resolves.toMatchObject({
        roomId: setup.roomId,
        reason: 'not-player',
        message: 'Only assigned players can issue gameplay mutations',
      });

      const destroyErrorPromise = waitForEvent<RoomErrorPayload>(
        spectator,
        'room:error',
      );
      spectator.emit('destroy:queue', {
        structureKey: hostStructure.key,
        delayTicks: 1,
      });
      await expect(destroyErrorPromise).resolves.toMatchObject({
        roomId: setup.roomId,
        reason: 'not-player',
        message: 'Only assigned players can issue gameplay mutations',
      });
    },
    20_000,
  );

  matchTest(
    'charges resources after authoritative queue acceptance for costly builds',
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

      const costlyTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'eater-1',
      );
      if (!costlyTemplate) {
        throw new Error('Expected eater-1 template to be available');
      }

      const placements = collectCandidatePlacements(
        initialTeam,
        costlyTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      );
      const selectedPlacement = placements[0];
      if (!selectedPlacement) {
        throw new Error('Expected at least one valid eater-1 placement');
      }

      const buildX = selectedPlacement.x;
      const buildY = selectedPlacement.y;

      const initialStructures = await waitForStateStructures(
        setup.host,
        (payload) => payload.roomId === setup.roomId,
        {
          roomId: setup.roomId,
          attempts: 20,
          timeoutMs: 2_000,
        },
      );
      const initialStructuresTeam = initialStructures.teams.find(
        (team) => team.id === teamId,
      );
      if (!initialStructuresTeam) {
        throw new Error('Expected host team in initial structures state');
      }
      const pendingStructuresPromise = waitForStateStructures(
        setup.host,
        (payload) =>
          payload.roomId === setup.roomId &&
          payload.teams.some(
            (team) =>
              team.id === teamId &&
              team.resources < initialStructuresTeam.resources,
          ),
        {
          roomId: setup.roomId,
          attempts: 20,
          timeoutMs: 2_000,
        },
      );

      const queuedResponsePromise = waitForBuildQueueResponse(
        setup.host,
        4_000,
      );
      const guestQueuedPromise = waitForEvent<BuildQueuedPayload>(
        setup.guest,
        'build:queued',
      );

      setup.host.emit('build:queue', {
        templateId: costlyTemplate.id,
        x: buildX,
        y: buildY,
        delayTicks: 80,
      });

      const [queuedResponse, guestQueued] = await Promise.all([
        queuedResponsePromise,
        guestQueuedPromise,
      ]);
      if ('error' in queuedResponse) {
        throw new Error(
          `Expected build queue acceptance, received ${queuedResponse.error.reason}`,
        );
      }

      const queued = queuedResponse.queued;
      const pendingStructures = await pendingStructuresPromise;

      expect(queued.intentId).toMatch(/^intent-/);
      expect(queued).toMatchObject({
        roomId: setup.roomId,
        playerId: setup.hostJoined.playerId,
        teamId,
        templateId: costlyTemplate.id,
        x: buildX,
        y: buildY,
      });
      expect(guestQueued).toEqual(queued);
      expect(queued.eventId).toBeGreaterThan(0);
      expect(queued.executeTick).toBeGreaterThan(0);
      const pendingTeam = pendingStructures.teams.find(
        (team) => team.id === teamId,
      );
      expect(pendingTeam?.resources).toBeLessThan(
        initialStructuresTeam.resources,
      );

      const outcomesById = await collectBuildOutcomes(
        setup.host,
        [queued.eventId],
        12_000,
      );
      expect(outcomesById.get(queued.eventId)?.[0]).toMatchObject({
        eventId: queued.eventId,
        teamId,
        outcome: 'applied',
      });
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

  fanoutMatchTest(
    'broadcasts build:queued to peers after authoritative queue fanout',
    async ({ activeMatch, integration }) => {
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

      const hostQueuedPromise = waitForBuildQueueResponse(setup.host, 4_000);
      const guestQueuedPromise = waitForEvent<BuildQueuedPayload>(
        setup.guest,
        'build:queued',
        4_000,
      );
      const hostQueuedObserver = observeEvents<BuildQueuedPayload>(
        setup.host,
        'build:queued',
      );
      const guestQueuedObserver = observeEvents<BuildQueuedPayload>(
        setup.guest,
        'build:queued',
      );

      setup.host.emit('build:queue', {
        templateId: blockTemplate.id,
        x: selectedPlacement.x,
        y: selectedPlacement.y,
        delayTicks: 1,
      });

      for (
        let advancedTicks = 0;
        advancedTicks < QUEUE_FANOUT_ADVANCE_LIMIT_TICKS &&
        (hostQueuedObserver.events.length === 0 ||
          guestQueuedObserver.events.length === 0);
        advancedTicks += 1
      ) {
        await integration.clock.advanceTicks(1);
      }

      hostQueuedObserver.stop();
      guestQueuedObserver.stop();
      expect(hostQueuedObserver.events.length).toBeGreaterThan(0);
      expect(guestQueuedObserver.events.length).toBeGreaterThan(0);

      const [hostQueuedResponse, guestQueued] = await Promise.all([
        hostQueuedPromise,
        guestQueuedPromise,
      ]);
      if ('error' in hostQueuedResponse) {
        throw new Error(
          `Expected build queue acceptance, received ${hostQueuedResponse.error.reason}`,
        );
      }

      expect(guestQueued).toEqual(hostQueuedResponse.queued);
    },
    20_000,
  );

  fanoutMatchTest(
    'emits queue-state hashes after authoritative queue fanout',
    async ({ activeMatch, integration }) => {
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

      const hostHashesPromise = waitForStateHashes(
        setup.host,
        (payload) => payload.roomId === setup.roomId,
        { timeoutMs: 4_000, overallTimeoutMs: 4_000 },
      );
      const guestHashesPromise = waitForStateHashes(
        setup.guest,
        (payload) => payload.roomId === setup.roomId,
        { timeoutMs: 4_000, overallTimeoutMs: 4_000 },
      );
      const hostQueuedPromise = waitForBuildQueueResponse(setup.host, 4_000);
      const hostQueuedObserver = observeEvents<BuildQueuedPayload>(
        setup.host,
        'build:queued',
      );
      const hostHashesObserver = observeEvents<RoomStateHashesPayload>(
        setup.host,
        'state:hashes',
      );
      const guestHashesObserver = observeEvents<RoomStateHashesPayload>(
        setup.guest,
        'state:hashes',
      );

      setup.host.emit('build:queue', {
        templateId: blockTemplate.id,
        x: selectedPlacement.x,
        y: selectedPlacement.y,
        delayTicks: 1,
      });

      for (
        let advancedTicks = 0;
        advancedTicks < QUEUE_FANOUT_ADVANCE_LIMIT_TICKS &&
        (hostQueuedObserver.events.length === 0 ||
          hostHashesObserver.events.length === 0 ||
          guestHashesObserver.events.length === 0);
        advancedTicks += 1
      ) {
        await integration.clock.advanceTicks(1);
      }

      hostQueuedObserver.stop();
      hostHashesObserver.stop();
      guestHashesObserver.stop();
      expect(hostQueuedObserver.events.length).toBeGreaterThan(0);
      expect(hostHashesObserver.events.length).toBeGreaterThan(0);
      expect(guestHashesObserver.events.length).toBeGreaterThan(0);

      const hostQueuedResponse = await hostQueuedPromise;
      if ('error' in hostQueuedResponse) {
        throw new Error(
          `Expected build queue acceptance, received ${hostQueuedResponse.error.reason}`,
        );
      }

      const [hostHashes, guestHashes] = await Promise.all([
        hostHashesPromise,
        guestHashesPromise,
      ]);
      expect(hostHashes).toEqual(guestHashes);
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
