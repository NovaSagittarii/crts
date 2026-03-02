import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { io, type Socket } from 'socket.io-client';

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
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  RoomSlotClaimedPayload,
  RoomStatePayload,
  TeamPayload,
} from '#rts-engine';

interface Cell {
  x: number;
  y: number;
}

interface MatchFinishedRankedTeam {
  rank: number;
  teamId: number;
  outcome: 'winner' | 'defeated' | 'eliminated';
  finalCoreHp: number;
  coreState: 'intact' | 'destroyed';
  territoryCellCount: number;
  queuedBuildCount: number;
  appliedBuildCount: number;
  rejectedBuildCount: number;
}

interface MatchFinishedPayload {
  roomId: string;
  winner: MatchFinishedRankedTeam;
  ranked: MatchFinishedRankedTeam[];
  comparator: string;
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

function createClient(port: number): Socket {
  const socket = io(`http://localhost:${port}`, {
    autoConnect: false,
    transports: ['websocket'],
  });
  socket.connect();
  return socket;
}

function waitForEvent<T>(
  socket: Socket,
  event: string,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    function onEvent(payload: T): void {
      clearTimeout(timer);
      resolve(payload);
    }

    socket.once(event, onEvent);
  });
}

async function waitForMembership(
  socket: Socket,
  roomId: string,
  predicate: (payload: RoomMembershipPayload) => boolean,
  attempts = 30,
  timeoutMs = 3000,
): Promise<RoomMembershipPayload> {
  for (let index = 0; index < attempts; index += 1) {
    const payload = await waitForEvent<RoomMembershipPayload>(
      socket,
      'room:membership',
      timeoutMs,
    );
    if (payload.roomId === roomId && predicate(payload)) {
      return payload;
    }
  }

  throw new Error('Membership condition not met in allotted attempts');
}

async function waitForState(
  socket: Socket,
  roomId: string,
  predicate: (payload: RoomStatePayload) => boolean,
  attempts = 40,
  timeoutMs = 3000,
): Promise<RoomStatePayload> {
  for (let index = 0; index < attempts; index += 1) {
    const payload = await waitForEvent<RoomStatePayload>(
      socket,
      'state',
      timeoutMs,
    );
    if (payload.roomId === roomId && predicate(payload)) {
      return payload;
    }
  }

  throw new Error('State condition not met in allotted attempts');
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

function waitForBuildQueueResponse(
  socket: Socket,
  timeoutMs = 4000,
): Promise<{ queued: BuildQueuedPayload } | { error: RoomErrorPayload }> {
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

    function onQueued(payload: BuildQueuedPayload): void {
      cleanup();
      resolve({ queued: payload });
    }

    function onError(payload: RoomErrorPayload): void {
      cleanup();
      resolve({ error: payload });
    }

    socket.once('build:queued', onQueued);
    socket.once('room:error', onError);
  });
}

function waitForBuildOutcome(
  socket: Socket,
  eventId: number,
  timeoutMs = 12_000,
): Promise<BuildOutcomePayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('build:outcome', onOutcome);
      reject(
        new Error(`Timed out waiting for build:outcome for event ${eventId}`),
      );
    }, timeoutMs);

    function onOutcome(payload: BuildOutcomePayload): void {
      if (payload.eventId !== eventId) {
        return;
      }

      clearTimeout(timer);
      socket.off('build:outcome', onOutcome);
      resolve(payload);
    }

    socket.on('build:outcome', onOutcome);
  });
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

  const placements = collectCandidatePlacements(
    match.hostTeam,
    blockTemplate,
    match.hostJoined.state.width,
    match.hostJoined.state.height,
  );

  for (const placement of placements) {
    const queueResponsePromise = waitForBuildQueueResponse(match.host);
    match.host.emit('build:queue', {
      templateId: blockTemplate.id,
      x: placement.x,
      y: placement.y,
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

  throw new Error('Unable to queue a valid build for QUAL-02 scenario');
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

  function connectClientForTest(): Socket {
    const socket = createClient(port);
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
      8000,
    );

    for (const delayTicks of [16, 17, 18, 19]) {
      const queueResponsePromise = waitForBuildQueueResponse(match.guest);
      match.guest.emit('build:queue', {
        templateId: 'glider',
        x: match.guestTeam.baseTopLeft.x,
        y: match.guestTeam.baseTopLeft.y,
        delayTicks,
      });

      const response = await queueResponsePromise;
      if ('error' in response) {
        throw new Error(
          `Expected breach queue attempt to be accepted, received ${response.error.reason}`,
        );
      }
    }

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
});
