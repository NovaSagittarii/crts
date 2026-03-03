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
  estimateTransformedTemplateBounds,
  getBaseCenter,
} from '#rts-engine';

import type {
  BuildOutcomePayload,
  BuildQueuedPayload,
  DestroyOutcomePayload,
  DestroyQueuedPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  RoomSlotClaimedPayload,
  RoomStatePayload,
  TeamPayload,
  PlacementTransformInput,
} from '#rts-engine';

interface ClientOptions {
  sessionId?: string;
}

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

function createClient(port: number, options: ClientOptions = {}): Socket {
  const socket = io(`http://localhost:${port}`, {
    autoConnect: false,
    transports: ['websocket'],
    auth: {
      sessionId: options.sessionId,
    },
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
  attempts = 40,
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
  attempts = 80,
  timeoutMs = 2000,
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
  transform?: PlacementTransformInput,
): Cell[] {
  const placements: Cell[] = [];
  const baseCenter = getBaseCenter(team.baseTopLeft);
  const baseLeft = team.baseTopLeft.x;
  const baseTop = team.baseTopLeft.y;
  const baseRight = baseLeft + BASE_FOOTPRINT_WIDTH;
  const baseBottom = baseTop + BASE_FOOTPRINT_HEIGHT;
  const transformedSize = estimateTransformedTemplateBounds(
    template,
    transform,
  );

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

function waitForDestroyQueueResponse(
  socket: Socket,
  timeoutMs = 4000,
): Promise<{ queued: DestroyQueuedPayload } | { error: RoomErrorPayload }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for destroy queue response'));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      socket.off('destroy:queued', onQueued);
      socket.off('room:error', onError);
    }

    function onQueued(payload: DestroyQueuedPayload): void {
      cleanup();
      resolve({ queued: payload });
    }

    function onError(payload: RoomErrorPayload): void {
      cleanup();
      resolve({ error: payload });
    }

    socket.once('destroy:queued', onQueued);
    socket.once('room:error', onError);
  });
}

function waitForDestroyOutcome(
  socket: Socket,
  eventId: number,
  timeoutMs = 12_000,
): Promise<DestroyOutcomePayload> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('destroy:outcome', onOutcome);
      reject(
        new Error(`Timed out waiting for destroy:outcome for event ${eventId}`),
      );
    }, timeoutMs);

    function onOutcome(payload: DestroyOutcomePayload): void {
      if (payload.eventId !== eventId) {
        return;
      }

      clearTimeout(timer);
      socket.off('destroy:outcome', onOutcome);
      resolve(payload);
    }

    socket.on('destroy:outcome', onOutcome);
  });
}

async function setupActiveMatch(
  connectClient: (options?: ClientOptions) => Socket,
): Promise<ActiveMatchSetup> {
  const host = connectClient({ sessionId: 'destroy-determinism-host' });
  await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

  const hostCreatedPromise = waitForEvent<RoomJoinedPayload>(
    host,
    'room:joined',
  );
  host.emit('room:create', {
    name: 'Destroy Determinism Room',
    width: 52,
    height: 52,
  });
  const hostJoined = await hostCreatedPromise;

  const guest = connectClient({ sessionId: 'destroy-determinism-guest' });
  await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

  const guestJoinedPromise = waitForEvent<RoomJoinedPayload>(
    guest,
    'room:joined',
  );
  guest.emit('room:join', { roomId: hostJoined.roomId });
  const guestJoined = await guestJoinedPromise;

  await claimSlot(host, 'team-1');
  await claimSlot(guest, 'team-2');

  await waitForMembership(
    host,
    hostJoined.roomId,
    (payload) =>
      payload.slots['team-1'] === hostJoined.playerId &&
      payload.slots['team-2'] === guestJoined.playerId,
  );

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

  host.emit('room:start');
  await waitForEvent(host, 'room:match-started', 7000);

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

interface QueueAppliedBuildOptions {
  templateId?: string;
  transform?: PlacementTransformInput;
  delayTicks?: number;
}

async function queueAppliedHostBuild(
  match: ActiveMatchSetup,
  options: QueueAppliedBuildOptions = {},
): Promise<{
  queued: BuildQueuedPayload;
  outcome: BuildOutcomePayload;
  structureKey: string;
}> {
  const templateId = options.templateId ?? 'block';
  const template = match.hostJoined.templates.find(
    ({ id }) => id === templateId,
  );
  if (!template) {
    throw new Error(`Expected ${templateId} template to be available`);
  }

  const placements = collectCandidatePlacements(
    match.hostTeam,
    template,
    match.hostJoined.state.width,
    match.hostJoined.state.height,
    options.transform,
  );

  for (const placement of placements) {
    const buildResponsePromise = waitForBuildQueueResponse(match.host);
    match.host.emit('build:queue', {
      templateId: template.id,
      x: placement.x,
      y: placement.y,
      transform: options.transform,
      delayTicks: options.delayTicks ?? 8,
    });

    const buildResponse = await buildResponsePromise;
    if ('error' in buildResponse) {
      continue;
    }

    const outcome = await waitForBuildOutcome(
      match.host,
      buildResponse.queued.eventId,
    );
    if (outcome.outcome !== 'applied') {
      continue;
    }

    const builtState = await waitForState(
      match.host,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        return hostTeam.structures.some(
          (structure) =>
            !structure.isCore &&
            structure.templateId === template.id &&
            structure.hp > 0,
        );
      },
      40,
    );

    const builtTeam = getTeamByPlayerId(builtState, match.hostJoined.playerId);
    const builtStructure = builtTeam.structures.find(
      (structure) =>
        !structure.isCore &&
        structure.templateId === template.id &&
        structure.hp > 0,
    );
    if (!builtStructure) {
      continue;
    }

    return {
      queued: buildResponse.queued,
      outcome,
      structureKey: builtStructure.key,
    };
  }

  throw new Error(`Unable to queue and apply host ${templateId} build`);
}

describe('destroy reconnect determinism', () => {
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

  function connectClientForTest(options: ClientOptions = {}): Socket {
    const socket = createClient(port, options);
    sockets.push(socket);
    return socket;
  }

  test('reconnects during pending destroy and converges on one authoritative terminal outcome', async () => {
    const match = await setupActiveMatch((options) =>
      connectClientForTest(options),
    );
    const appliedBuild = await queueAppliedHostBuild(match, {
      templateId: 'block',
      transform: {
        operations: ['rotate', 'mirror-horizontal'],
      },
      delayTicks: 8,
    });
    expect(appliedBuild.outcome.outcome).toBe('applied');

    const destroyResponsePromise = waitForDestroyQueueResponse(match.host);
    match.host.emit('destroy:queue', {
      structureKey: appliedBuild.structureKey,
      delayTicks: 20,
    });
    const destroyResponse = await destroyResponsePromise;
    if ('error' in destroyResponse) {
      throw new Error(
        `Expected destroy queue acceptance, received ${destroyResponse.error.reason}`,
      );
    }

    const destroyQueued = destroyResponse.queued;
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

    const [hostPendingState, reconnectPendingState] = await Promise.all([
      waitForState(
        match.host,
        match.roomId,
        (payload) => {
          const hostTeam = getTeamByPlayerId(
            payload,
            match.hostJoined.playerId,
          );
          return hostTeam.pendingDestroys.some(
            ({ eventId }) => eventId === destroyQueued.eventId,
          );
        },
        80,
        2000,
      ),
      waitForState(
        reconnectGuest,
        match.roomId,
        (payload) => {
          const hostTeam = getTeamByPlayerId(
            payload,
            match.hostJoined.playerId,
          );
          return hostTeam.pendingDestroys.some(
            ({ eventId }) => eventId === destroyQueued.eventId,
          );
        },
        80,
        2000,
      ),
    ]);

    const hostPendingTeam = getTeamByPlayerId(
      hostPendingState,
      match.hostJoined.playerId,
    );
    const reconnectPendingTeam = getTeamByPlayerId(
      reconnectPendingState,
      match.hostJoined.playerId,
    );
    expect(reconnectPendingTeam.pendingDestroys).toEqual(
      hostPendingTeam.pendingDestroys,
    );
    expect(reconnectPendingTeam.structures).toEqual(hostPendingTeam.structures);

    const [hostOutcome, reconnectOutcome] = await Promise.all([
      waitForDestroyOutcome(match.host, destroyQueued.eventId, 16_000),
      waitForDestroyOutcome(reconnectGuest, destroyQueued.eventId, 16_000),
    ]);

    expect(reconnectOutcome).toEqual(hostOutcome);
    expect(hostOutcome.outcome).toBe('destroyed');
    expect(hostOutcome.structureKey).toBe(appliedBuild.structureKey);

    const [hostSettled, reconnectSettled] = await Promise.all([
      waitForState(
        match.host,
        match.roomId,
        (payload) => {
          const hostTeam = getTeamByPlayerId(
            payload,
            match.hostJoined.playerId,
          );
          return (
            !hostTeam.pendingDestroys.some(
              ({ eventId }) => eventId === destroyQueued.eventId,
            ) &&
            !hostTeam.structures.some(
              ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
            )
          );
        },
        80,
        2000,
      ),
      waitForState(
        reconnectGuest,
        match.roomId,
        (payload) => {
          const hostTeam = getTeamByPlayerId(
            payload,
            match.hostJoined.playerId,
          );
          return (
            !hostTeam.pendingDestroys.some(
              ({ eventId }) => eventId === destroyQueued.eventId,
            ) &&
            !hostTeam.structures.some(
              ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
            )
          );
        },
        80,
        2000,
      ),
    ]);

    const hostTeam = getTeamByPlayerId(hostSettled, match.hostJoined.playerId);
    const reconnectTeam = getTeamByPlayerId(
      reconnectSettled,
      match.hostJoined.playerId,
    );
    expect(reconnectTeam.pendingDestroys).toEqual(hostTeam.pendingDestroys);
    expect(reconnectTeam.structures).toEqual(hostTeam.structures);
  }, 60_000);

  test('reconnects after resolved destroy and receives converged authoritative state', async () => {
    const match = await setupActiveMatch((options) =>
      connectClientForTest(options),
    );
    const appliedBuild = await queueAppliedHostBuild(match);
    expect(appliedBuild.outcome.outcome).toBe('applied');

    const destroyResponsePromise = waitForDestroyQueueResponse(match.host);
    match.host.emit('destroy:queue', {
      structureKey: appliedBuild.structureKey,
      delayTicks: 1,
    });
    const destroyResponse = await destroyResponsePromise;
    if ('error' in destroyResponse) {
      throw new Error(
        `Expected destroy queue acceptance, received ${destroyResponse.error.reason}`,
      );
    }

    const destroyQueued = destroyResponse.queued;
    const hostOutcome = await waitForDestroyOutcome(
      match.host,
      destroyQueued.eventId,
    );
    expect(hostOutcome.outcome).toBe('destroyed');
    expect(hostOutcome.structureKey).toBe(appliedBuild.structureKey);

    const hostSettled = await waitForState(
      match.host,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        return (
          !hostTeam.pendingDestroys.some(
            ({ eventId }) => eventId === destroyQueued.eventId,
          ) &&
          !hostTeam.structures.some(
            ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
          )
        );
      },
      80,
      2000,
    );

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

    const reconnectSettled = await waitForState(
      reconnectGuest,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        return (
          !hostTeam.pendingDestroys.some(
            ({ eventId }) => eventId === destroyQueued.eventId,
          ) &&
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
