import { describe, expect, test } from 'vitest';
import { io, type Socket } from 'socket.io-client';

import { createServer } from '../../../apps/server/src/server.js';
import { decodeGridBase64 } from '#conway-core';
import type {
  BuildPreviewPayload,
  BuildOutcomePayload,
  BuildQueuedPayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  RoomErrorPayload,
  RoomLeftPayload,
  RoomListEntryPayload,
  RoomSlotClaimedPayload,
  RoomStatePayload,
  TeamPayload,
} from '#rts-engine';

type StatePayload = RoomStatePayload;
type SlotClaimedPayload = RoomSlotClaimedPayload;
type RoomListEntry = RoomListEntryPayload;
type BuildPreview = BuildPreviewPayload;
type BuildQueued = BuildQueuedPayload;
type BuildOutcome = BuildOutcomePayload;
type RoomError = RoomErrorPayload;

interface Cell {
  x: number;
  y: number;
}

interface ActiveMatchSetup {
  host: Socket;
  guest: Socket;
  roomId: string;
  hostJoined: RoomJoinedPayload;
  guestJoined: RoomJoinedPayload;
  hostTeam: TeamPayload;
  guestTeam: TeamPayload;
}

function waitForEvent(
  emitter: Socket,
  event: string,
  timeoutMs = 2500,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    function handler(payload: unknown) {
      clearTimeout(timer);
      resolve(payload);
    }

    emitter.once(event, handler);
  });
}

function createClient(port: number): Socket {
  const socket = io(`http://localhost:${port}`, {
    autoConnect: false,
    transports: ['websocket'],
  });
  socket.connect();
  return socket;
}

function blockAlive(state: StatePayload, coords: Cell[]): boolean {
  const grid = decodeGridBase64(state.grid, state.width * state.height);
  return coords.every(({ x, y }) => grid[y * state.width + x] === 1);
}

function getTeam(state: StatePayload, teamId: number): TeamPayload {
  const team = state.teams?.find(({ id }) => id === teamId);
  if (!team) {
    throw new Error(`Unable to find team ${teamId}`);
  }
  return team;
}

async function waitForCondition(
  socket: Socket,
  predicate: (state: StatePayload) => boolean,
  attempts = 6,
): Promise<StatePayload> {
  for (let i = 0; i < attempts; i += 1) {
    const state = (await waitForEvent(socket, 'state')) as StatePayload;
    if (predicate(state)) return state;
  }
  throw new Error('Condition not met in allotted attempts');
}

async function claimSlot(
  socket: Socket,
  slotId: string,
): Promise<SlotClaimedPayload> {
  socket.emit('room:claim-slot', { slotId });
  const claimed = (await waitForEvent(
    socket,
    'room:slot-claimed',
  )) as SlotClaimedPayload;
  if (claimed.teamId === null) {
    throw new Error(`Expected slot claim for ${slotId} to assign a team`);
  }
  return claimed;
}

async function waitForRoomList(
  socket: Socket,
  predicate: (rooms: RoomListEntry[]) => boolean,
  attempts = 6,
): Promise<RoomListEntry[]> {
  for (let i = 0; i < attempts; i += 1) {
    const rooms = (await waitForEvent(socket, 'room:list')) as RoomListEntry[];
    if (predicate(rooms)) return rooms;
  }
  throw new Error('Room list condition not met in allotted attempts');
}

async function waitForMembership(
  socket: Socket,
  predicate: (membership: RoomMembershipPayload) => boolean,
  attempts = 20,
): Promise<RoomMembershipPayload> {
  for (let i = 0; i < attempts; i += 1) {
    const membership = (await waitForEvent(
      socket,
      'room:membership',
    )) as RoomMembershipPayload;
    if (predicate(membership)) {
      return membership;
    }
  }

  throw new Error('Membership condition not met in allotted attempts');
}

function waitForBuildQueueResponse(
  socket: Socket,
  timeoutMs = 2000,
): Promise<{ queued: BuildQueued } | { error: RoomError }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for build queue response'));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      socket.off('build:queued', onQueued);
      socket.off('room:error', onError);
    }

    function onQueued(payload: BuildQueued): void {
      cleanup();
      resolve({ queued: payload });
    }

    function onError(payload: RoomError): void {
      cleanup();
      resolve({ error: payload });
    }

    socket.once('build:queued', onQueued);
    socket.once('room:error', onError);
  });
}

function collectBuildOutcomes(
  socket: Socket,
  eventIds: number[],
  timeoutMs = 8000,
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
        settleTimer = setTimeout(() => {
          cleanup();
          resolve(outcomesById);
        }, 200);
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
      if (buildX === team.baseTopLeft.x && buildY === team.baseTopLeft.y) {
        continue;
      }

      placements.push({ x: buildX, y: buildY });
    }
  }

  return placements;
}

async function setupActiveMatch(port: number): Promise<ActiveMatchSetup> {
  const host = createClient(port);
  await waitForEvent(host, 'room:joined');

  host.emit('room:create', {
    name: 'Build Queue Contract Room',
    width: 52,
    height: 52,
  });

  const hostJoined = (await waitForEvent(
    host,
    'room:joined',
  )) as RoomJoinedPayload;

  const guest = createClient(port);
  await waitForEvent(guest, 'room:joined');
  guest.emit('room:join', { roomId: hostJoined.roomId });
  const guestJoined = (await waitForEvent(
    guest,
    'room:joined',
  )) as RoomJoinedPayload;

  await claimSlot(host, 'team-1');
  await claimSlot(guest, 'team-2');

  host.emit('room:set-ready', { ready: true });
  guest.emit('room:set-ready', { ready: true });

  await waitForMembership(
    host,
    (membership) =>
      membership.roomId === hostJoined.roomId &&
      membership.participants.filter(
        ({ role, ready }) => role === 'player' && ready,
      ).length === 2,
  );

  host.emit('room:start');
  await waitForEvent(host, 'room:match-started', 7000);

  const activeState = await waitForCondition(
    host,
    (state) =>
      state.roomId === hostJoined.roomId &&
      state.teams.some(({ playerIds }) =>
        playerIds.includes(hostJoined.playerId),
      ) &&
      state.teams.some(({ playerIds }) =>
        playerIds.includes(guestJoined.playerId),
      ),
    40,
  );

  return {
    host,
    guest,
    roomId: hostJoined.roomId,
    hostJoined,
    guestJoined,
    hostTeam: getTeamByPlayerId(activeState, hostJoined.playerId),
    guestTeam: getTeamByPlayerId(activeState, guestJoined.playerId),
  };
}

describe('GameServer', () => {
  test('broadcasts generations on a cadence during active matches', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

    const first = (await waitForEvent(setup.host, 'state')) as StatePayload;
    const second = (await waitForEvent(setup.host, 'state')) as StatePayload;

    expect(second.generation).toBeGreaterThan(first.generation);
    expect(second.tick).toBeGreaterThan(first.tick);

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 20_000);

  test('acknowledges queued builds and emits one terminal outcome per acknowledged event', async () => {
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

    const queuedEvents: BuildQueued[] = [];
    for (const placement of candidatePlacements) {
      setup.host.emit('build:queue', {
        templateId: generatorTemplate.id,
        x: placement.x,
        y: placement.y,
        delayTicks: 12,
      });

      const response = await waitForBuildQueueResponse(setup.host);
      if ('queued' in response) {
        queuedEvents.push(response.queued);
      }

      if (queuedEvents.length === 8) {
        break;
      }
    }

    expect(queuedEvents.length).toBe(8);
    expect(
      queuedEvents.every(
        ({ eventId, executeTick }) =>
          Number.isInteger(eventId) &&
          eventId > 0 &&
          Number.isInteger(executeTick) &&
          executeTick > 0,
      ),
    ).toBe(true);

    const queuedById = new Map(
      queuedEvents.map((queued) => [queued.eventId, queued]),
    );
    const outcomesById = await collectBuildOutcomes(
      setup.host,
      [...queuedById.keys()],
      10_000,
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

  test('emits one terminal outcome to both clients for overlapping queued builds', async () => {
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
    for (let index = 0; index < hostPlacements.length; index += 1) {
      const hostResponsePromise = waitForBuildQueueResponse(setup.host);
      const guestResponsePromise = waitForBuildQueueResponse(setup.guest);

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

      const [hostResponse, guestResponse] = await Promise.all([
        hostResponsePromise,
        guestResponsePromise,
      ]);

      if ('error' in hostResponse) {
        throw new Error(
          `Host queue request unexpectedly failed: ${hostResponse.error.reason}`,
        );
      }
      if ('error' in guestResponse) {
        throw new Error(
          `Guest queue request unexpectedly failed: ${guestResponse.error.reason}`,
        );
      }

      queuedEvents.push({ ...hostResponse.queued, source: 'host' });
      queuedEvents.push({ ...guestResponse.queued, source: 'guest' });
    }

    const eventIds = queuedEvents.map(({ eventId }) => eventId);
    expect(new Set(eventIds).size).toBe(eventIds.length);

    const queuedById = new Map(
      queuedEvents.map((queued) => [queued.eventId, queued]),
    );
    const [hostOutcomesById, guestOutcomesById] = await Promise.all([
      collectBuildOutcomes(setup.host, eventIds, 12_000),
      collectBuildOutcomes(setup.guest, eventIds, 12_000),
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

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 30_000);

  test('returns explicit rejection reasons for out-of-bounds and outside-territory builds', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

    setup.host.emit('build:queue', {
      templateId: 'block',
      x: -1,
      y: 0,
      delayTicks: 1,
    });
    const outOfBounds = (await waitForEvent(
      setup.host,
      'room:error',
    )) as RoomError;
    expect(outOfBounds.reason).toBe('out-of-bounds');

    setup.host.emit('build:queue', {
      templateId: 'block',
      x: setup.guestTeam.baseTopLeft.x,
      y: setup.guestTeam.baseTopLeft.y,
      delayTicks: 1,
    });
    const outsideTerritory = (await waitForEvent(
      setup.host,
      'room:error',
    )) as RoomError;
    expect(outsideTerritory.reason).toBe('outside-territory');

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

    const preview = (await waitForEvent(
      setup.host,
      'build:preview',
    )) as BuildPreview;

    expect(preview.roomId).toBe(setup.roomId);
    expect(preview.teamId).toBe(setup.hostTeam.id);
    expect(preview.templateId).toBe(blockTemplate.id);
    expect(preview.x).toBe(previewTarget.x);
    expect(preview.y).toBe(previewTarget.y);
    expect(Number.isInteger(preview.needed)).toBe(true);
    expect(Number.isInteger(preview.current)).toBe(true);
    expect(Number.isInteger(preview.deficit)).toBe(true);
    expect(preview.deficit).toBe(Math.max(0, preview.needed - preview.current));
    expect(preview.affordable).toBe(preview.deficit === 0);

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 20_000);

  test('rejects unaffordable queue attempts with exact deficit metadata and no queue ack', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

    const generatorTemplate = setup.hostJoined.templates.find(
      ({ id }) => id === 'generator',
    );
    if (!generatorTemplate) {
      throw new Error('Expected generator template to be available');
    }

    const placements = collectCandidatePlacements(
      setup.hostTeam,
      generatorTemplate,
      setup.hostJoined.state.width,
      setup.hostJoined.state.height,
    );
    expect(placements.length).toBeGreaterThan(0);

    let drainPlacement: Cell | null = null;
    for (const placement of placements) {
      setup.host.emit('build:queue', {
        templateId: generatorTemplate.id,
        x: placement.x,
        y: placement.y,
        delayTicks: 1,
      });

      const response = await waitForBuildQueueResponse(setup.host, 4_000);
      if ('error' in response) {
        continue;
      }

      drainPlacement = placement;
      await collectBuildOutcomes(setup.host, [response.queued.eventId], 8_000);
      break;
    }

    if (!drainPlacement) {
      throw new Error(
        'Unable to find a valid generator placement to drain resources',
      );
    }

    let insufficient: { error: RoomError } | null = null;
    for (let attempt = 0; attempt < 24; attempt += 1) {
      setup.host.emit('build:queue', {
        templateId: generatorTemplate.id,
        x: drainPlacement.x,
        y: drainPlacement.y,
        delayTicks: 1,
      });

      const response = await waitForBuildQueueResponse(setup.host, 4_000);
      if ('error' in response) {
        if (response.error.reason === 'insufficient-resources') {
          insufficient = response;
          break;
        }
        continue;
      }

      await collectBuildOutcomes(setup.host, [response.queued.eventId], 8_000);
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

    const queued: BuildQueued[] = [];
    const delays = [18, 14, 18];

    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index];
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

      queued.push(response.queued);
    }

    const queuedEventIds = queued.map(({ eventId }) => eventId);
    const expectedPendingOrder = [...queued]
      .sort((a, b) => a.executeTick - b.executeTick || a.eventId - b.eventId)
      .map(({ eventId }) => eventId);

    const pendingState = await waitForCondition(
      setup.host,
      (state) => {
        const team = state.teams.find(({ id }) => id === setup.hostTeam.id);
        if (!team) {
          return false;
        }

        const pendingIds = team.pendingBuilds.map(({ eventId }) => eventId);
        return queuedEventIds.every((eventId) => pendingIds.includes(eventId));
      },
      30,
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

    const clearedState = await waitForCondition(
      setup.host,
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
      40,
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

  test('queues template builds and charges resources', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);

    const teamId = setup.hostTeam.id;
    const initialTeamState = await waitForCondition(
      setup.host,
      (state) =>
        state.roomId === setup.roomId &&
        state.teams.some(({ id }) => id === teamId),
      20,
    );
    const initialTeam = getTeam(initialTeamState, teamId);

    const blockTemplate = setup.hostJoined.templates.find(
      ({ id }) => id === 'block',
    );
    if (!blockTemplate) {
      throw new Error('Expected block template to be available');
    }

    const buildX = Math.min(
      52 - blockTemplate.width,
      initialTeam.baseTopLeft.x + 4,
    );
    const buildY = Math.min(
      52 - blockTemplate.height,
      initialTeam.baseTopLeft.y + 4,
    );

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

    const queued = (await waitForEvent(
      setup.host,
      'build:queued',
    )) as BuildQueued;
    expect(queued.eventId).toBeGreaterThan(0);
    expect(queued.executeTick).toBeGreaterThan(0);

    const builtState = await waitForCondition(
      setup.host,
      (state) =>
        blockAlive(state, blockCells) &&
        getTeam(state, teamId).resources < initialTeam.resources,
      12,
    );

    expect(blockAlive(builtState, blockCells)).toBe(true);
    expect(getTeam(builtState, teamId).resources).toBeLessThan(
      initialTeam.resources,
    );

    setup.host.close();
    setup.guest.close();
    await server.stop();
  }, 20_000);

  test('rejects direct cell:update bypass attempts with queue-only reason and no defeat side effects', async () => {
    const server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    const port = await server.start();

    const setup = await setupActiveMatch(port);
    const teamId = setup.hostTeam.id;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      setup.host.emit('cell:update', {
        x: setup.hostTeam.baseTopLeft.x,
        y: setup.hostTeam.baseTopLeft.y,
        alive: false,
      });

      const rejection = (await waitForEvent(
        setup.host,
        'room:error',
      )) as RoomError;
      expect(rejection.reason).toBe('queue-only-mutation-path');
    }

    const stableState = await waitForCondition(
      setup.host,
      (state) => state.roomId === setup.roomId && state.tick > 8,
      40,
    );

    const hostTeamState = getTeam(stableState, teamId);
    expect(hostTeamState.defeated).toBe(false);
    expect(hostTeamState.baseIntact).toBe(true);

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

    const joined = (await waitForEvent(
      socket,
      'room:joined',
    )) as RoomJoinedPayload;
    expect(joined.roomName).toBe('Skirmish');
    expect(joined.state.width).toBe(48);
    expect(joined.state.height).toBe(48);

    socket.emit('room:list');
    const rooms = await waitForRoomList(
      socket,
      (entries) => entries.some(({ roomId }) => roomId === joined.roomId),
      8,
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
    const ownerRoom = (await waitForEvent(
      owner,
      'room:joined',
    )) as RoomJoinedPayload;
    await claimSlot(owner, 'team-1');

    const guest = createClient(port);
    await waitForEvent(guest, 'room:joined');
    guest.emit('room:join', { roomId: ownerRoom.roomId });

    const guestRoom = (await waitForEvent(
      guest,
      'room:joined',
    )) as RoomJoinedPayload;
    expect(guestRoom.roomId).toBe(ownerRoom.roomId);
    await claimSlot(guest, 'team-2');

    const withTwoTeams = await waitForCondition(
      owner,
      (state) => state.roomId === ownerRoom.roomId && state.teams.length >= 2,
      12,
    );
    expect(withTwoTeams.teams.length).toBeGreaterThanOrEqual(2);

    guest.emit('room:leave');
    const leftPayload = (await waitForEvent(
      guest,
      'room:left',
    )) as RoomLeftPayload;
    expect(leftPayload.roomId).toBe(ownerRoom.roomId);

    const backToOneTeam = await waitForCondition(
      owner,
      (state) => state.roomId === ownerRoom.roomId && state.teams.length === 1,
      12,
    );
    expect(backToOneTeam.teams).toHaveLength(1);

    owner.close();
    guest.close();
    await server.stop();
  });
});
