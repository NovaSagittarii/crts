import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Socket } from 'socket.io-client';

import {
  createServer,
  type GameServer,
} from '../../../apps/server/src/server.js';
import {
  BASE_FOOTPRINT_HEIGHT,
  BASE_FOOTPRINT_WIDTH,
  BUILD_ZONE_RADIUS,
  getBaseCenter,
} from '#rts-engine';

import type {
  BuildOutcomePayload,
  BuildQueuedPayload,
  MatchFinishedPayload,
  PlacementTransformInput,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  RoomSlotClaimedPayload,
  RoomStatePayload,
  TeamPayload,
} from '#rts-engine';
import {
  createClient,
  type ActiveMatchSetup,
  type Cell,
  type TestClientOptions,
  waitForBuildOutcome,
  waitForBuildQueueResponse,
  waitForDestroyOutcome,
  waitForDestroyQueueResponse,
  waitForEvent as waitForEventBase,
  waitForMembership as waitForMembershipBase,
  waitForState as waitForStateBase,
} from './test-support.js';

function waitForEvent<T>(
  socket: Socket,
  event: string,
  timeoutMs = 3000,
): Promise<T> {
  return waitForEventBase(socket, event, timeoutMs);
}

async function waitForMembership(
  socket: Socket,
  roomId: string,
  predicate: (payload: RoomMembershipPayload) => boolean,
  attempts = 30,
  timeoutMs = 3000,
): Promise<RoomMembershipPayload> {
  return waitForMembershipBase(socket, roomId, predicate, {
    attempts,
    timeoutMs,
  });
}

async function waitForState(
  socket: Socket,
  roomId: string,
  predicate: (payload: RoomStatePayload) => boolean,
  attempts = 40,
  timeoutMs = 3000,
): Promise<RoomStatePayload> {
  return waitForStateBase(socket, predicate, {
    roomId,
    attempts,
    timeoutMs,
  });
}

async function claimSlot(socket: Socket, slotId: string): Promise<void> {
  const claimedPromise = waitForEvent<RoomSlotClaimedPayload>(
    socket,
    'room:slot-claimed',
  );
  socket.emit('room:claim-slot', { slotId });
  const claimed = await claimedPromise;
  if (claimed.teamId === null) {
    throw new Error(`Expected ${slotId} claim to assign a team`);
  }
}

function getTeamByPlayerId(
  state: RoomStatePayload,
  playerId: string,
): TeamPayload {
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
  transform?: PlacementTransformInput,
): Cell[] {
  const placements: Cell[] = [];
  const baseCenter = getBaseCenter(team.baseTopLeft);
  const baseLeft = team.baseTopLeft.x;
  const baseTop = team.baseTopLeft.y;
  const baseRight = baseLeft + BASE_FOOTPRINT_WIDTH;
  const baseBottom = baseTop + BASE_FOOTPRINT_HEIGHT;
  const transformedSize = estimateTransformedTemplateSize(template, transform);

  for (let y = -10; y <= 10; y += 2) {
    for (let x = -10; x <= 10; x += 2) {
      const buildX = team.baseTopLeft.x + x;
      const buildY = team.baseTopLeft.y + y;
      if (buildX < 0 || buildY < 0) {
        continue;
      }
      if (
        buildX + transformedSize.width > roomWidth ||
        buildY + transformedSize.height > roomHeight
      ) {
        continue;
      }

      const intersectsBase =
        buildX < baseRight &&
        buildX + transformedSize.width > baseLeft &&
        buildY < baseBottom &&
        buildY + transformedSize.height > baseTop;
      if (intersectsBase) {
        continue;
      }

      let fullyInsideBuildZone = true;
      for (let ty = 0; ty < transformedSize.height; ty += 1) {
        for (let tx = 0; tx < transformedSize.width; tx += 1) {
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

function estimateTransformedTemplateSize(
  template: RoomJoinedPayload['templates'][number],
  transform: PlacementTransformInput | undefined,
): { width: number; height: number } {
  const operations = transform?.operations ?? [];
  let quarterTurns = 0;
  for (const operation of operations) {
    if (operation === 'rotate') {
      quarterTurns = (quarterTurns + 1) % 4;
    }
  }

  if (quarterTurns % 2 === 1) {
    return {
      width: template.height,
      height: template.width,
    };
  }

  return {
    width: template.width,
    height: template.height,
  };
}

interface QueueBuildAttempt {
  transform?: PlacementTransformInput;
}

async function setupActiveMatch(
  connectClient: () => Socket,
): Promise<ActiveMatchSetup> {
  const host = connectClient();
  await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

  const hostCreatedPromise = waitForEvent<RoomJoinedPayload>(
    host,
    'room:joined',
  );
  host.emit('room:create', {
    name: 'QUAL-02 Loop Room',
    width: 52,
    height: 52,
  });
  const hostJoined = await hostCreatedPromise;

  const guest = connectClient();
  await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

  const guestJoinedPromise = waitForEvent<RoomJoinedPayload>(
    guest,
    'room:joined',
  );
  guest.emit('room:join', { roomId: hostJoined.roomId });
  const guestJoined = await guestJoinedPromise;

  await claimSlot(host, 'team-1');
  await claimSlot(guest, 'team-2');

  const slotMembershipPromise = waitForMembership(
    host,
    hostJoined.roomId,
    (payload) =>
      payload.slots['team-1'] === hostJoined.playerId &&
      payload.slots['team-2'] === guestJoined.playerId,
  );
  await slotMembershipPromise;

  const readyMembershipPromise = waitForMembership(
    host,
    hostJoined.roomId,
    (payload) =>
      payload.participants.filter(
        ({ role, ready }) => role === 'player' && ready,
      ).length === 2,
  );
  host.emit('room:set-ready', { ready: true });
  guest.emit('room:set-ready', { ready: true });
  await readyMembershipPromise;

  const matchStartedPromise = waitForEvent(host, 'room:match-started', 7000);
  host.emit('room:start');
  await matchStartedPromise;

  await waitForMembership(
    host,
    hostJoined.roomId,
    (payload) => payload.status === 'active',
    40,
  );

  const activeState = await waitForState(
    host,
    hostJoined.roomId,
    (payload) =>
      payload.teams.some(({ playerIds }) =>
        playerIds.includes(hostJoined.playerId),
      ) &&
      payload.teams.some(({ playerIds }) =>
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

async function queueValidHostBuild(
  match: ActiveMatchSetup,
): Promise<{ queued: BuildQueuedPayload; outcome: BuildOutcomePayload }> {
  const blockTemplate = match.hostJoined.templates.find(
    ({ id }) => id === 'block',
  );
  if (!blockTemplate) {
    throw new Error('Expected block template to be available');
  }

  const attempts: QueueBuildAttempt[] = [{ transform: undefined }];

  for (const attempt of attempts) {
    const placements = collectCandidatePlacements(
      match.hostTeam,
      blockTemplate,
      match.hostJoined.state.width,
      match.hostJoined.state.height,
      attempt.transform,
    );

    for (const placement of placements) {
      const queueResponsePromise = waitForBuildQueueResponse(match.host);
      match.host.emit('build:queue', {
        templateId: blockTemplate.id,
        x: placement.x,
        y: placement.y,
        transform: attempt.transform,
        delayTicks: 12,
      });

      const response = await queueResponsePromise;
      if ('error' in response) {
        continue;
      }

      const outcome = await waitForBuildOutcome(
        match.host,
        response.queued.eventId,
      );
      return {
        queued: response.queued,
        outcome,
      };
    }
  }

  throw new Error('Unable to queue a valid build for QUAL-02 scenario');
}

async function queueAppliedHostBuild(match: ActiveMatchSetup): Promise<{
  queued: BuildQueuedPayload;
  outcome: BuildOutcomePayload;
  structureKey: string;
}> {
  const blockTemplate = match.hostJoined.templates.find(
    ({ id }) => id === 'block',
  );
  if (!blockTemplate) {
    throw new Error('Expected block template to be available');
  }

  const placements = collectCandidatePlacements(
    match.hostTeam,
    blockTemplate,
    match.hostJoined.state.width,
    match.hostJoined.state.height,
  );

  for (const placement of placements) {
    const responsePromise = waitForBuildQueueResponse(match.host);
    match.host.emit('build:queue', {
      templateId: blockTemplate.id,
      x: placement.x,
      y: placement.y,
      delayTicks: 8,
    });

    const response = await responsePromise;
    if ('error' in response) {
      continue;
    }

    const outcome = await waitForBuildOutcome(
      match.host,
      response.queued.eventId,
    );
    if (outcome.outcome !== 'applied') {
      continue;
    }

    const stateWithBuiltBlock = await waitForState(
      match.host,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        return hostTeam.structures.some(
          (structure) =>
            !structure.isCore &&
            structure.templateId === blockTemplate.id &&
            structure.hp > 0,
        );
      },
      40,
    );

    const hostTeam = getTeamByPlayerId(
      stateWithBuiltBlock,
      match.hostJoined.playerId,
    );
    const structure = hostTeam.structures.find(
      (candidate) =>
        !candidate.isCore &&
        candidate.templateId === blockTemplate.id &&
        candidate.hp > 0,
    );
    if (!structure) {
      continue;
    }

    return {
      queued: response.queued,
      outcome,
      structureKey: structure.key,
    };
  }

  throw new Error(
    'Unable to queue and apply a host block structure for destroy scenario',
  );
}

describe('QUAL-02 quality gate integration loop', () => {
  let server: GameServer;
  let port = 0;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    port = await server.start();
  });

  afterEach(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    await server.stop();
  });

  function connectClientForTest(options: TestClientOptions = {}): Socket {
    const socket = createClient(port, options);
    sockets.push(socket);
    return socket;
  }

  test('QUAL-02: join -> build -> tick -> breach -> defeat with defeated build rejection', async () => {
    const match = await setupActiveMatch(() => connectClientForTest());

    // QUAL-02 requires one explicit build queue + terminal outcome in the loop.
    const { queued, outcome } = await queueValidHostBuild(match);
    expect(queued.eventId).toBeGreaterThan(0);
    expect(outcome.eventId).toBe(queued.eventId);
    expect(outcome.resolvedTick).toBeGreaterThanOrEqual(queued.executeTick);

    const matchFinishedPromise = waitForEvent<MatchFinishedPayload>(
      match.host,
      'room:match-finished',
      15_000,
    );

    const guestCore = match.guestTeam.structures.find(({ isCore }) => isCore);
    if (!guestCore) {
      throw new Error('Expected guest core structure to exist');
    }

    const destroyQueueResponsePromise = waitForDestroyQueueResponse(
      match.guest,
    );
    match.guest.emit('destroy:queue', {
      structureKey: guestCore.key,
      delayTicks: 1,
    });

    const destroyQueueResponse = await destroyQueueResponsePromise;
    if ('error' in destroyQueueResponse) {
      throw new Error(
        `Expected breach destroy queue acceptance, received ${destroyQueueResponse.error.reason}`,
      );
    }

    const destroyOutcome = await waitForDestroyOutcome(
      match.guest,
      destroyQueueResponse.queued.eventId,
      12_000,
    );
    expect(destroyOutcome.outcome).toBe('destroyed');
    expect(destroyOutcome.structureKey).toBe(guestCore.key);

    const finished = await matchFinishedPromise;
    expect(finished.roomId).toBe(match.roomId);
    expect(finished.comparator).toContain('coreHpBeforeResolution');

    const defeated = finished.ranked.find(
      ({ outcome: rankedOutcome }) => rankedOutcome !== 'winner',
    );
    if (!defeated) {
      throw new Error(
        'Expected a defeated team in room:match-finished payload',
      );
    }

    const defeatedSocket =
      defeated.teamId === match.hostTeam.id ? match.host : match.guest;
    const defeatedBaseTopLeft =
      defeated.teamId === match.hostTeam.id
        ? match.hostTeam.baseTopLeft
        : match.guestTeam.baseTopLeft;

    const defeatedErrorPromise = waitForEvent<RoomErrorPayload>(
      defeatedSocket,
      'room:error',
      4000,
    );
    defeatedSocket.emit('build:queue', {
      templateId: 'block',
      x: defeatedBaseTopLeft.x + 3,
      y: defeatedBaseTopLeft.y + 3,
      delayTicks: 1,
    });
    const defeatedError = await defeatedErrorPromise;

    expect(defeatedError.reason).toBe('defeated');
  }, 45_000);

  test('QUAL-04: build plus destroy stays deterministic across reconnect checkpoints', async () => {
    const match = await setupActiveMatch(() => connectClientForTest());

    const appliedBuild = await queueAppliedHostBuild(match);
    expect(appliedBuild.outcome.outcome).toBe('applied');

    const destroyQueueResponsePromise = waitForDestroyQueueResponse(match.host);
    match.host.emit('destroy:queue', {
      structureKey: appliedBuild.structureKey,
      delayTicks: 20,
    });
    const destroyQueueResponse = await destroyQueueResponsePromise;
    if ('error' in destroyQueueResponse) {
      throw new Error(
        `Expected destroy queue acceptance in QUAL-04 scenario, received ${destroyQueueResponse.error.reason}`,
      );
    }

    const destroyQueued = destroyQueueResponse.queued;
    expect(destroyQueued.idempotent).toBe(false);

    match.guest.disconnect();
    const reconnectGuest = connectClientForTest({
      sessionId: match.guestJoined.playerId,
    });
    const rejoined = await waitForEvent<RoomJoinedPayload>(
      reconnectGuest,
      'room:joined',
      6000,
    );
    expect(rejoined.roomId).toBe(match.roomId);

    await waitForState(
      reconnectGuest,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        return hostTeam.pendingDestroys.some(
          ({ eventId }) => eventId === destroyQueued.eventId,
        );
      },
      60,
      2000,
    );

    const [hostOutcome, reconnectOutcome] = await Promise.all([
      waitForDestroyOutcome(match.host, destroyQueued.eventId, 16_000),
      waitForDestroyOutcome(reconnectGuest, destroyQueued.eventId, 16_000),
    ]);
    expect(reconnectOutcome).toEqual(hostOutcome);
    expect(hostOutcome.outcome).toBe('destroyed');
    expect(hostOutcome.structureKey).toBe(appliedBuild.structureKey);

    const hostSettled = await waitForState(
      match.host,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        const pendingIds = hostTeam.pendingDestroys.map(
          ({ eventId }) => eventId,
        );
        return (
          !pendingIds.includes(destroyQueued.eventId) &&
          !hostTeam.structures.some(
            ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
          )
        );
      },
      80,
      2000,
    );

    const reconnectSettled = await waitForState(
      reconnectGuest,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        const pendingIds = hostTeam.pendingDestroys.map(
          ({ eventId }) => eventId,
        );
        return (
          !pendingIds.includes(destroyQueued.eventId) &&
          !hostTeam.structures.some(
            ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
          )
        );
      },
      80,
      2000,
    );

    const hostTeam = getTeamByPlayerId(hostSettled, match.hostJoined.playerId);
    const reconnectTeam = getTeamByPlayerId(
      reconnectSettled,
      match.hostJoined.playerId,
    );
    expect(reconnectTeam.pendingDestroys).toEqual(hostTeam.pendingDestroys);
    expect(reconnectTeam.structures).toEqual(hostTeam.structures);
  }, 60_000);
});
