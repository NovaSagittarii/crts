import { describe, expect, test, vi } from 'vitest';
import type { Socket } from 'socket.io-client';

import { createServer } from '../../../apps/server/src/server.js';
import { Grid } from '#conway-core';
import {
  BASE_FOOTPRINT_HEIGHT,
  BASE_FOOTPRINT_WIDTH,
  BUILD_ZONE_RADIUS,
  getBaseCenter,
} from '#rts-engine';
import type {
  BuildScheduledPayload,
  BuildPreviewPayload,
  BuildOutcomePayload,
  BuildQueuedPayload,
  DestroyOutcomePayload,
  RoomGridStatePayload,
  RoomJoinedPayload,
  RoomErrorPayload,
  RoomLeftPayload,
  RoomStatePayload,
  TeamPayload,
} from '#rts-engine';
import { setupActiveMatch as setupActiveMatchBase } from './match-support.js';
import {
  createClient,
  type Cell,
  type TestClientOptions,
  claimSlot,
  waitForBuildQueueResponse,
  waitForBuildScheduled,
  waitForDestroyScheduled,
  waitForDestroyQueueResponse,
  waitForEvent,
  waitForRoomList,
  waitForRoomState,
} from './test-support.js';

type StatePayload = RoomStatePayload;
type BuildPreview = BuildPreviewPayload;
type BuildQueued = BuildQueuedPayload;
type BuildScheduled = BuildScheduledPayload;
type BuildOutcome = BuildOutcomePayload;
type DestroyOutcome = DestroyOutcomePayload;
type RoomError = RoomErrorPayload;

function blockAlive(state: StatePayload, coords: Cell[]): boolean {
  const unpackedGrid = Grid.unpack(state.grid, state.width, state.height);
  return coords.every(({ x, y }) => unpackedGrid[y * state.width + x] === 1);
}

function getTeam(state: StatePayload, teamId: number): TeamPayload {
  const team = state.teams?.find(({ id }) => id === teamId);
  if (!team) {
    throw new Error(`Unable to find team ${teamId}`);
  }
  return team;
}

function createPortClient(
  port: number,
): (options?: TestClientOptions) => Socket {
  return (options?: TestClientOptions) => createClient(port, options);
}

function setupActiveMatch(port: number) {
  return setupActiveMatchBase({
    connectClient: createPortClient(port),
    roomName: 'Build Queue Contract Room',
    startMode: 'fake-timers',
  });
}

function collectBuildOutcomes(
  socket: Socket,
  eventIds: number[],
  timeoutMs = 8000,
  settleMs = 0,
): Promise<Map<number, BuildOutcome[]>> {
  return new Promise((resolve, reject) => {
    const expected = new Set(eventIds);
    const outcomesById = new Map<number, BuildOutcome[]>();
    let settleTimer: NodeJS.Timeout | null = null;

    function cleanup(): void {
      clearTimeout(timeout);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      socket.off('build:outcome', onOutcome);
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out collecting expected build outcomes'));
    }, timeoutMs);

    function maybeScheduleResolve(): void {
      if (expected.size === 0 && !settleTimer) {
        if (settleMs <= 0) {
          cleanup();
          resolve(outcomesById);
          return;
        }

        settleTimer = setTimeout(() => {
          cleanup();
          resolve(outcomesById);
        }, settleMs);
      }
    }

    function onOutcome(payload: BuildOutcome): void {
      if (
        !expected.has(payload.eventId) &&
        !outcomesById.has(payload.eventId)
      ) {
        return;
      }

      const current = outcomesById.get(payload.eventId) ?? [];
      current.push(payload);
      outcomesById.set(payload.eventId, current);
      expected.delete(payload.eventId);
      maybeScheduleResolve();
    }

    socket.on('build:outcome', onOutcome);
    maybeScheduleResolve();
  });
}

function collectBuildScheduledEvents(
  socket: Socket,
  count: number,
  timeoutMs = 8000,
  settleMs = 0,
): Promise<BuildScheduled[]> {
  return new Promise((resolve, reject) => {
    const scheduled: BuildScheduled[] = [];
    let settleTimer: NodeJS.Timeout | null = null;

    function cleanup(): void {
      clearTimeout(timeout);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      socket.off('build:scheduled', onScheduled);
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out collecting scheduled build events'));
    }, timeoutMs);

    function maybeResolve(): void {
      if (scheduled.length < count || settleTimer) {
        return;
      }

      if (settleMs <= 0) {
        cleanup();
        resolve(scheduled);
        return;
      }

      settleTimer = setTimeout(() => {
        cleanup();
        resolve(scheduled);
      }, settleMs);
    }

    function onScheduled(payload: BuildScheduled): void {
      scheduled.push(payload);
      maybeResolve();
    }

    socket.on('build:scheduled', onScheduled);
  });
}

function collectBuildQueuedEvents(
  socket: Socket,
  count: number,
  timeoutMs = 8000,
  settleMs = 0,
): Promise<BuildQueued[]> {
  return new Promise((resolve, reject) => {
    const queued: BuildQueued[] = [];
    let settleTimer: NodeJS.Timeout | null = null;

    function cleanup(): void {
      clearTimeout(timeout);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      socket.off('build:queued', onQueued);
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out collecting queued build intents'));
    }, timeoutMs);

    function maybeResolve(): void {
      if (queued.length < count || settleTimer) {
        return;
      }

      if (settleMs <= 0) {
        cleanup();
        resolve(queued);
        return;
      }

      settleTimer = setTimeout(() => {
        cleanup();
        resolve(queued);
      }, settleMs);
    }

    function onQueued(payload: BuildQueued): void {
      queued.push(payload);
      maybeResolve();
    }

    socket.on('build:queued', onQueued);
  });
}

function collectDestroyOutcomes(
  socket: Socket,
  eventIds: number[],
  timeoutMs = 8000,
  settleMs = 0,
): Promise<Map<number, DestroyOutcome[]>> {
  return new Promise((resolve, reject) => {
    const expected = new Set(eventIds);
    const outcomesById = new Map<number, DestroyOutcome[]>();
    let settleTimer: NodeJS.Timeout | null = null;

    function cleanup(): void {
      clearTimeout(timeout);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      socket.off('destroy:outcome', onOutcome);
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out collecting expected destroy outcomes'));
    }, timeoutMs);

    function maybeScheduleResolve(): void {
      if (expected.size === 0 && !settleTimer) {
        if (settleMs <= 0) {
          cleanup();
          resolve(outcomesById);
          return;
        }

        settleTimer = setTimeout(() => {
          cleanup();
          resolve(outcomesById);
        }, settleMs);
      }
    }

    function onOutcome(payload: DestroyOutcome): void {
      if (
        !expected.has(payload.eventId) &&
        !outcomesById.has(payload.eventId)
      ) {
        return;
      }

      const current = outcomesById.get(payload.eventId) ?? [];
      current.push(payload);
      outcomesById.set(payload.eventId, current);
      expected.delete(payload.eventId);
      maybeScheduleResolve();
    }

    socket.on('destroy:outcome', onOutcome);
    maybeScheduleResolve();
  });
}

function getTeamByPlayerId(state: StatePayload, playerId: string): TeamPayload {
  const team = state.teams.find(({ playerIds }) =>
    playerIds.includes(playerId),
  );
  if (!team) {
    throw new Error(`Unable to resolve team for player ${playerId}`);
  }
  return team;
}

function collectCandidatePlacements(
  team: TeamPayload,
  template: RoomJoinedPayload['templates'][number],
  roomWidth: number,
  roomHeight: number,
): Cell[] {
  const placements: Cell[] = [];
  const baseCenter = getBaseCenter(team.baseTopLeft);
  const baseLeft = team.baseTopLeft.x;
  const baseTop = team.baseTopLeft.y;
  const baseRight = baseLeft + BASE_FOOTPRINT_WIDTH;
  const baseBottom = baseTop + BASE_FOOTPRINT_HEIGHT;

  for (let y = -10; y <= 10; y += 2) {
    for (let x = -10; x <= 10; x += 2) {
      const buildX = team.baseTopLeft.x + x;
      const buildY = team.baseTopLeft.y + y;
      if (buildX < 0 || buildY < 0) {
        continue;
      }
      if (
        buildX + template.width > roomWidth ||
        buildY + template.height > roomHeight
      ) {
        continue;
      }

      const intersectsBase =
        buildX < baseRight &&
        buildX + template.width > baseLeft &&
        buildY < baseBottom &&
        buildY + template.height > baseTop;
      if (intersectsBase) {
        continue;
      }

      let fullyInsideBuildZone = true;
      for (let ty = 0; ty < template.height; ty += 1) {
        for (let tx = 0; tx < template.width; tx += 1) {
          const dx = buildX + tx - baseCenter.x;
          const dy = buildY + ty - baseCenter.y;
          if (dx * dx + dy * dy > BUILD_ZONE_RADIUS * BUILD_ZONE_RADIUS) {
            fullyInsideBuildZone = false;
            break;
          }
        }
        if (!fullyInsideBuildZone) {
          break;
        }
      }

      if (!fullyInsideBuildZone) {
        continue;
      }

      placements.push({ x: buildX, y: buildY });
    }
  }

  return placements;
}

describe('GameServer', () => {
  test('broadcasts periodic snapshots during active matches', async () => {
    const server = createServer({
      port: 0,
      width: 52,
      height: 52,
      tickMs: 40,
      activeStateSnapshotIntervalTicks: 50,
    });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

    const first = await waitForEvent<StatePayload>(setup.host, 'state', 7000);
    const second = await waitForEvent<StatePayload>(setup.host, 'state', 7000);

    expect(second.generation).toBeGreaterThan(first.generation);
    expect(second.tick).toBeGreaterThan(first.tick);
    expect(second.tick - first.tick).toBeGreaterThanOrEqual(50);

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 20_000);

  test('responds to on-demand grid requests only to requester', async () => {
    const server = createServer({
      port: 0,
      width: 52,
      height: 52,
      tickMs: 40,
      activeStateSnapshotIntervalTicks: 1000,
    });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

    let guestGridCount = 0;
    function onGuestGrid(): void {
      guestGridCount += 1;
    }
    setup.guest.on('state:grid', onGuestGrid);

    await new Promise((resolve) => setTimeout(resolve, 120));

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

    await new Promise((resolve) => setTimeout(resolve, 120));
    setup.host.emit('state:request', { sections: ['grid'] });
    await expect(
      waitForEvent<RoomGridStatePayload>(setup.host, 'state:grid', 120),
    ).rejects.toThrow(/timed out/i);

    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(guestGridCount).toBe(0);

    setup.guest.off('state:grid', onGuestGrid);
    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 20_000);

  test('schedules buffered builds and emits one terminal outcome per scheduled event', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

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

    const queuedIntents: BuildQueued[] = [];
    const scheduledEvents: BuildScheduled[] = [];
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

    const observedOutcomes: BuildOutcome[] = [];
    for (const [eventId, outcomes] of outcomesById.entries()) {
      expect(outcomes).toHaveLength(1);

      const outcome = outcomes[0];
      const queued = queuedById.get(eventId);
      if (!queued) {
        throw new Error(`Missing queued payload for event ${eventId}`);
      }

      expect(outcome.executeTick).toBe(queued.executeTick);
      expect(outcome.resolvedTick).toBeGreaterThanOrEqual(outcome.executeTick);
      if (outcome.outcome === 'rejected') {
        expect(outcome.reason).toBeDefined();
      }

      observedOutcomes.push(outcome);
    }

    expect(observedOutcomes.some(({ outcome }) => outcome === 'applied')).toBe(
      true,
    );
    expect(observedOutcomes.some(({ outcome }) => outcome === 'rejected')).toBe(
      true,
    );

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 25_000);

  test('emits one terminal outcome to both clients for overlapping scheduled builds', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

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

    const queuedEvents: Array<BuildQueued & { source: 'host' | 'guest' }> = [];
    const scheduledEvents: Array<
      BuildScheduled & { source: 'host' | 'guest' }
    > = [];
    for (let index = 0; index < hostPlacements.length; index += 1) {
      const queuedPromise = collectBuildQueuedEvents(setup.host, 2, 4_000, 50);
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

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 30_000);

  test('returns explicit rejection reasons for out-of-zone build attempts', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

    setup.host.emit('build:queue', {
      templateId: 'block',
      x: -1,
      y: 0,
      delayTicks: 1,
    });
    const outOfBounds = await waitForEvent<RoomError>(setup.host, 'room:error');
    expect(outOfBounds.reason).toBe('outside-territory');

    setup.host.emit('build:queue', {
      templateId: 'block',
      x: setup.guestTeam.baseTopLeft.x,
      y: setup.guestTeam.baseTopLeft.y,
      delayTicks: 1,
    });
    const outsideTerritory = await waitForEvent<RoomError>(
      setup.host,
      'room:error',
    );
    expect(outsideTerritory.reason).toBe('outside-territory');

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 20_000);

  test('refreshes rejected queue preview with the same anchor and transform', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);
    const transformOperations = ['rotate', 'mirror-horizontal'] as const;

    const refreshedPreviewPromise = waitForEvent(
      setup.host,
      'build:preview',
      4_000,
    );

    setup.host.emit('build:queue', {
      templateId: 'block',
      x: setup.guestTeam.baseTopLeft.x,
      y: setup.guestTeam.baseTopLeft.y,
      transform: {
        operations: [...transformOperations],
      },
      delayTicks: 1,
    });

    const rejection = await waitForEvent<RoomError>(setup.host, 'room:error');
    expect(rejection.reason).toBe('outside-territory');

    const refreshedPreview = (await refreshedPreviewPromise) as BuildPreview;

    expect(refreshedPreview.templateId).toBe('block');
    expect(refreshedPreview.x).toBe(setup.guestTeam.baseTopLeft.x);
    expect(refreshedPreview.y).toBe(setup.guestTeam.baseTopLeft.y);
    expect(refreshedPreview.transform.operations).toEqual(transformOperations);
    expect(refreshedPreview.reason).toBe('outside-territory');
    expect(refreshedPreview.bounds.x).toBe(setup.guestTeam.baseTopLeft.x);
    expect(refreshedPreview.bounds.y).toBe(setup.guestTeam.baseTopLeft.y);
    expect(refreshedPreview.illegalCells.length).toBeGreaterThan(0);

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 20_000);

  test('returns affordability preview payloads for valid build placements', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

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
    const previewTarget = candidatePlacements[0];
    if (!previewTarget) {
      throw new Error('Expected at least one valid placement for preview test');
    }

    setup.host.emit('build:preview', {
      templateId: blockTemplate.id,
      x: previewTarget.x,
      y: previewTarget.y,
    });

    const preview = await waitForEvent<BuildPreview>(
      setup.host,
      'build:preview',
    );

    expect(preview.roomId).toBe(setup.roomId);
    expect(preview.teamId).toBe(setup.hostTeam.id);
    expect(preview.templateId).toBe(blockTemplate.id);
    expect(preview.x).toBe(previewTarget.x);
    expect(preview.y).toBe(previewTarget.y);
    expect(preview.transform.operations).toEqual([]);
    expect(preview.bounds).toEqual({
      x: previewTarget.x,
      y: previewTarget.y,
      width: blockTemplate.width,
      height: blockTemplate.height,
    });
    expect(preview.footprint.length).toBeGreaterThan(0);
    expect(preview.illegalCells).toEqual([]);
    expect(Number.isInteger(preview.needed)).toBe(true);
    expect(Number.isInteger(preview.current)).toBe(true);
    expect(Number.isInteger(preview.deficit)).toBe(true);
    expect(preview.deficit).toBe(Math.max(0, preview.needed - preview.current));
    expect(preview.affordable).toBe(preview.deficit === 0);

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 20_000);

  test('rejects unaffordable queue attempts with exact deficit metadata after buffering', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

    const expensiveTemplate = setup.hostJoined.templates.find(
      ({ id }) => id === 'eater-1',
    );
    if (!expensiveTemplate) {
      throw new Error('Expected eater-1 template to be available');
    }

    const placements = collectCandidatePlacements(
      setup.hostTeam,
      expensiveTemplate,
      setup.hostJoined.state.width,
      setup.hostJoined.state.height,
    );
    expect(placements.length).toBeGreaterThan(0);

    let insufficient: { error: RoomError } | null = null;
    for (let attempt = 0; attempt < placements.length; attempt += 1) {
      const placement = placements[attempt];
      const errorPromise = waitForEvent<RoomError>(
        setup.host,
        'room:error',
        1_500,
      ).catch(() => null);
      const scheduledPromise = waitForBuildScheduled(setup.host, 1_500).catch(
        () => null,
      );
      setup.host.emit('build:queue', {
        templateId: expensiveTemplate.id,
        x: placement.x,
        y: placement.y,
        delayTicks: 1,
      });

      const response = await waitForBuildQueueResponse(setup.host, 4_000);
      if ('error' in response) {
        continue;
      }

      const [error, scheduled] = await Promise.all([
        errorPromise,
        scheduledPromise,
      ]);
      if (error?.reason === 'insufficient-resources') {
        insufficient = { error };
        break;
      }
      if (scheduled) {
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

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 25_000);

  test('projects pending queue rows in sorted state order and removes rows after resolution', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

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

    const scheduled: BuildScheduled[] = [];
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
        return queuedEventIds.every((eventId) => pendingIds.includes(eventId));
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

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 30_000);

  test('queues owned destroys, rejects invalid requests, and emits one terminal outcome to both clients', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

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
    const firstDestroyResponse = await waitForDestroyQueueResponse(setup.host);
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
    const wrongOwnerError = await waitForEvent<RoomError>(
      setup.guest,
      'room:error',
      1_500,
    );
    expect(wrongOwnerError.reason).toBe('wrong-owner');

    setup.host.emit('destroy:queue', {
      structureKey: 'missing-target-key',
      delayTicks: 1,
    });
    const invalidTargetError = await waitForEvent<RoomError>(
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
    const staleDestroyError = await waitForEvent<RoomError>(
      setup.host,
      'room:error',
      1_500,
    );
    expect(staleDestroyError.reason).toBe('invalid-lifecycle-state');

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 40_000);

  test('queues template builds and charges resources', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

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

    const blockCells: Cell[] = [
      { x: buildX, y: buildY },
      { x: buildX + 1, y: buildY },
      { x: buildX, y: buildY + 1 },
      { x: buildX + 1, y: buildY + 1 },
    ];

    setup.host.emit('build:queue', {
      templateId: blockTemplate.id,
      x: buildX,
      y: buildY,
      delayTicks: 1,
    });

    const scheduledPromise = waitForBuildScheduled(setup.host, 4_000);
    const queued = await waitForEvent<BuildQueued>(setup.host, 'build:queued');
    expect(queued.intentId).toMatch(/^intent-/);
    const scheduled = await scheduledPromise;
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

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 20_000);

  test('creates and joins a custom room', async () => {
    const server = createServer({ port: 0, width: 30, height: 30, tickMs: 40 });
    const port = await server.start();

    const socket = createClient(port);
    await waitForEvent(socket, 'room:joined');

    socket.emit('room:create', {
      name: 'Skirmish',
      width: 48,
      height: 48,
    });

    const joined = await waitForEvent<RoomJoinedPayload>(socket, 'room:joined');
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

    socket.close();
    await server.stop();
  });

  test('supports joining and leaving rooms from another client', async () => {
    const server = createServer({ port: 0, width: 40, height: 40, tickMs: 40 });
    const port = await server.start();

    const owner = createClient(port);
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

    const guest = createClient(port);
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
    const leftPayload = await waitForEvent<RoomLeftPayload>(guest, 'room:left');
    expect(leftPayload.roomId).toBe(ownerRoom.roomId);

    const backToOneTeam = await waitForRoomState(
      owner,
      ownerRoom.roomId,
      (state) => state.roomId === ownerRoom.roomId && state.teams.length === 1,
      { attempts: 12 },
    );
    expect(backToOneTeam.teams).toHaveLength(1);

    owner.close();
    guest.close();
    await server.stop();
  });
});
