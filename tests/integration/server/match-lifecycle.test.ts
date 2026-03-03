import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { io, type Socket } from 'socket.io-client';

import {
  createServer,
  type GameServer,
} from '../../../apps/server/src/server.js';

import type {
  BuildOutcomePayload,
  BuildQueuedPayload,
  ChatMessagePayload,
  RoomCountdownPayload,
  MatchStartedPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  RoomStatePayload,
} from '#rts-engine';

interface ClientOptions {
  sessionId?: string;
}

interface RankedTeamResult {
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
  winner: RankedTeamResult;
  ranked: RankedTeamResult[];
  comparator: string;
}

interface ConnectedPair {
  host: Socket;
  guest: Socket;
  room: RoomJoinedPayload;
  guestJoined: RoomJoinedPayload;
}

interface ActiveMatch extends ConnectedPair {
  hostTeamId: number;
  guestTeamId: number;
  hostBaseTopLeft: { x: number; y: number };
  guestBaseTopLeft: { x: number; y: number };
  initialGrid: ArrayBuffer;
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
  timeoutMs = 2500,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    function handler(payload: T): void {
      clearTimeout(timer);
      resolve(payload);
    }

    socket.once(event, handler);
  });
}

async function waitForMembership(
  socket: Socket,
  roomId: string,
  predicate: (payload: RoomMembershipPayload) => boolean,
  attempts = 25,
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
  predicate: (payload: RoomStatePayload) => boolean,
  attempts = 40,
  timeoutMs = 2500,
): Promise<RoomStatePayload> {
  for (let index = 0; index < attempts; index += 1) {
    const payload = await waitForEvent<RoomStatePayload>(
      socket,
      'state',
      timeoutMs,
    );
    if (predicate(payload)) {
      return payload;
    }
  }

  throw new Error('State condition not met in allotted attempts');
}

function waitForBuildQueueResponse(
  socket: Socket,
  timeoutMs = 2500,
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

function collectOrderedBuildOutcomes(
  socket: Socket,
  eventIds: number[],
  timeoutMs = 16_000,
): Promise<BuildOutcomePayload[]> {
  return new Promise((resolve, reject) => {
    const pending = new Set(eventIds);
    const ordered: BuildOutcomePayload[] = [];

    function cleanup(): void {
      clearTimeout(timeout);
      socket.off('build:outcome', onOutcome);
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out collecting ordered build outcomes'));
    }, timeoutMs);

    function onOutcome(payload: BuildOutcomePayload): void {
      if (!pending.has(payload.eventId)) {
        return;
      }

      ordered.push(payload);
      pending.delete(payload.eventId);
      if (pending.size === 0) {
        cleanup();
        resolve(ordered);
      }
    }

    socket.on('build:outcome', onOutcome);
  });
}

function createPlacementCandidates(
  baseTopLeft: { x: number; y: number },
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  const offsets = [
    { x: 4, y: 4 },
    { x: 6, y: 4 },
    { x: 4, y: 6 },
    { x: 8, y: 4 },
    { x: 6, y: 6 },
    { x: 10, y: 4 },
    { x: -4, y: 4 },
    { x: 4, y: -4 },
  ];

  const unique = new Set<string>();
  const candidates: Array<{ x: number; y: number }> = [];
  for (const offset of offsets) {
    const x = baseTopLeft.x + offset.x;
    const y = baseTopLeft.y + offset.y;
    if (x < 0 || y < 0 || x >= width || y >= height) {
      continue;
    }

    const key = `${x},${y}`;
    if (unique.has(key)) {
      continue;
    }
    unique.add(key);
    candidates.push({ x, y });
  }

  return candidates;
}

async function queueFirstAcceptedBuild(
  socket: Socket,
  templateId: string,
  candidates: Array<{ x: number; y: number }>,
  delayTicks: number,
): Promise<{
  queued: BuildQueuedPayload;
  placement: { x: number; y: number };
}> {
  for (const candidate of candidates) {
    const queueResponsePromise = waitForBuildQueueResponse(socket, 4000);
    socket.emit('build:queue', {
      templateId,
      x: candidate.x,
      y: candidate.y,
      delayTicks,
    });

    const response = await queueResponsePromise;
    if ('error' in response) {
      continue;
    }

    return {
      queued: response.queued,
      placement: candidate,
    };
  }

  throw new Error(`Unable to queue accepted ${templateId} build`);
}

async function runQueuedOutcomeTimeline(match: ActiveMatch): Promise<
  Array<{
    teamId: number;
    outcome: BuildOutcomePayload['outcome'];
    reason: BuildOutcomePayload['reason'] | null;
    executeTick: number;
    resolvedTick: number;
  }>
> {
  const roomWidth = match.room.state.width;
  const roomHeight = match.room.state.height;
  const hostCandidates = createPlacementCandidates(
    match.hostBaseTopLeft,
    roomWidth,
    roomHeight,
  );
  const guestCandidates = createPlacementCandidates(
    match.guestBaseTopLeft,
    roomWidth,
    roomHeight,
  );

  const hostApplied = await queueFirstAcceptedBuild(
    match.host,
    'block',
    hostCandidates,
    8,
  );
  const guestApplied = await queueFirstAcceptedBuild(
    match.guest,
    'block',
    guestCandidates,
    8,
  );

  const duplicateQueuePromise = waitForBuildQueueResponse(match.host, 4000);
  match.host.emit('build:queue', {
    templateId: 'block',
    x: hostApplied.placement.x,
    y: hostApplied.placement.y,
    delayTicks: 9,
  });
  const duplicateQueueResponse = await duplicateQueuePromise;
  if ('error' in duplicateQueueResponse) {
    throw new Error(
      `Expected duplicate queue acceptance, received ${duplicateQueueResponse.error.reason}`,
    );
  }

  const orderedOutcomes = await collectOrderedBuildOutcomes(match.host, [
    hostApplied.queued.eventId,
    guestApplied.queued.eventId,
    duplicateQueueResponse.queued.eventId,
  ]);
  const baseExecuteTick = orderedOutcomes[0]?.executeTick ?? 0;
  const baseResolvedTick = orderedOutcomes[0]?.resolvedTick ?? 0;

  return orderedOutcomes.map((outcome) => ({
    teamId: outcome.teamId,
    outcome: outcome.outcome,
    reason: outcome.reason ?? null,
    executeTick: outcome.executeTick - baseExecuteTick,
    resolvedTick: outcome.resolvedTick - baseResolvedTick,
  }));
}

async function setupConnectedPair(
  connect: () => Socket,
): Promise<ConnectedPair> {
  const host = connect();
  await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

  host.emit('room:create', {
    name: 'Lifecycle Room',
    width: 52,
    height: 52,
  });
  const room = await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

  const guest = connect();
  await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');
  guest.emit('room:join', { roomId: room.roomId });
  const guestJoined = await waitForEvent<RoomJoinedPayload>(
    guest,
    'room:joined',
  );

  return {
    host,
    guest,
    room,
    guestJoined,
  };
}

async function moveToActive(pair: ConnectedPair): Promise<ActiveMatch> {
  const { host, guest, room, guestJoined } = pair;

  host.emit('room:claim-slot', { slotId: 'team-1' });
  guest.emit('room:claim-slot', { slotId: 'team-2' });
  await waitForMembership(
    host,
    room.roomId,
    (payload) =>
      payload.slots['team-1'] === room.playerId &&
      payload.slots['team-2'] === guestJoined.playerId,
  );

  host.emit('room:set-ready', { ready: true });
  guest.emit('room:set-ready', { ready: true });
  await waitForMembership(
    host,
    room.roomId,
    (payload) =>
      payload.participants.filter(
        ({ role, ready }) => role === 'player' && ready,
      ).length === 2,
  );

  host.emit('room:start');
  await waitForMembership(
    host,
    room.roomId,
    (payload) => payload.status === 'countdown',
  );
  await waitForEvent<MatchStartedPayload>(host, 'room:match-started', 6000);

  const activeMembership = await waitForMembership(
    host,
    room.roomId,
    (payload) => payload.status === 'active',
    40,
  );
  expect(activeMembership.status).toBe('active');

  const activeState = await waitForState(
    host,
    (payload) => payload.roomId === room.roomId,
  );

  const hostTeam = activeState.teams.find(({ playerIds }) =>
    playerIds.includes(room.playerId),
  );
  const guestTeam = activeState.teams.find(({ playerIds }) =>
    playerIds.includes(guestJoined.playerId),
  );
  expect(hostTeam).toBeDefined();
  expect(guestTeam).toBeDefined();

  return {
    ...pair,
    hostTeamId: hostTeam?.id ?? 0,
    guestTeamId: guestTeam?.id ?? 0,
    hostBaseTopLeft: {
      x: hostTeam?.baseTopLeft.x ?? 0,
      y: hostTeam?.baseTopLeft.y ?? 0,
    },
    guestBaseTopLeft: {
      x: guestTeam?.baseTopLeft.x ?? 0,
      y: guestTeam?.baseTopLeft.y ?? 0,
    },
    initialGrid: activeState.grid,
  };
}

async function breachGuestCore(
  match: ActiveMatch,
): Promise<MatchFinishedPayload> {
  const breachCandidates = [
    { x: match.guestBaseTopLeft.x, y: match.guestBaseTopLeft.y },
    { x: match.guestBaseTopLeft.x + 2, y: match.guestBaseTopLeft.y },
    { x: match.guestBaseTopLeft.x, y: match.guestBaseTopLeft.y + 2 },
    { x: match.guestBaseTopLeft.x + 2, y: match.guestBaseTopLeft.y + 2 },
  ];

  let accepted = 0;
  for (const candidate of breachCandidates) {
    match.guest.emit('build:queue', {
      templateId: 'glider',
      x: candidate.x,
      y: candidate.y,
      delayTicks: accepted + 1,
    });

    const response = await waitForBuildQueueResponse(match.guest);
    if ('error' in response) {
      continue;
    }

    const queued = response.queued;
    expect(queued.eventId).toBeGreaterThan(0);
    expect(queued.executeTick).toBeGreaterThan(0);
    accepted += 1;

    if (accepted >= 2) {
      break;
    }
  }

  if (accepted === 0) {
    throw new Error('Expected at least one accepted breach queue event');
  }

  return waitForEvent<MatchFinishedPayload>(
    match.host,
    'room:match-finished',
    7000,
  );
}

describe('server match lifecycle contract', () => {
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

  function connectClient(options: ClientOptions = {}): Socket {
    const socket = createClient(port, options);
    sockets.push(socket);
    return socket;
  }

  test('enforces start preconditions and allows host countdown cancel', async () => {
    const setup = await setupConnectedPair(() => connectClient());

    setup.host.emit('room:claim-slot', { slotId: 'team-1' });
    await waitForMembership(
      setup.host,
      setup.room.roomId,
      (payload) => payload.slots['team-1'] === setup.room.playerId,
    );

    setup.host.emit('room:set-ready', { ready: true });
    await waitForMembership(setup.host, setup.room.roomId, (payload) =>
      payload.participants.some(
        ({ sessionId, ready }) => sessionId === setup.room.playerId && ready,
      ),
    );

    setup.host.emit('room:start');
    const slotError = await waitForEvent<RoomErrorPayload>(
      setup.host,
      'room:error',
    );
    expect(slotError.reason).toBe('not-ready');

    setup.guest.emit('room:start');
    const guestNotHostError = await waitForEvent<RoomErrorPayload>(
      setup.guest,
      'room:error',
    );
    expect(guestNotHostError.reason).toBe('not-host');

    setup.guest.emit('room:claim-slot', { slotId: 'team-2' });
    setup.guest.emit('room:set-ready', { ready: true });
    await waitForMembership(
      setup.host,
      setup.room.roomId,
      (payload) =>
        payload.participants.filter(
          ({ role, ready }) => role === 'player' && ready,
        ).length === 2,
    );

    setup.guest.disconnect();
    await waitForMembership(setup.host, setup.room.roomId, (payload) =>
      payload.participants.some(
        ({ sessionId, connectionStatus }) =>
          sessionId === setup.guestJoined.playerId &&
          connectionStatus === 'held',
      ),
    );

    setup.host.emit('room:start');
    const holdError = await waitForEvent<RoomErrorPayload>(
      setup.host,
      'room:error',
    );
    expect(holdError.reason).toBe('not-ready');

    const guestReconnect = connectClient({
      sessionId: setup.guestJoined.playerId,
    });
    await waitForEvent<RoomJoinedPayload>(guestReconnect, 'room:joined');
    guestReconnect.emit('room:join', { roomId: setup.room.roomId });
    await waitForMembership(setup.host, setup.room.roomId, (payload) =>
      payload.participants.some(
        ({ sessionId, connectionStatus }) =>
          sessionId === setup.guestJoined.playerId &&
          connectionStatus === 'connected',
      ),
    );

    setup.host.emit('room:start');
    const openingCountdown = await waitForEvent<RoomCountdownPayload>(
      setup.host,
      'room:countdown',
      3500,
    );
    expect(openingCountdown.secondsRemaining).toBe(3);

    await waitForMembership(
      setup.host,
      setup.room.roomId,
      (payload) => payload.status === 'countdown',
    );

    guestReconnect.emit('chat:send', {
      message: 'chat still open in countdown',
    });
    const countdownChat = await waitForEvent<ChatMessagePayload>(
      setup.host,
      'chat:message',
    );
    expect(countdownChat.message).toBe('chat still open in countdown');

    guestReconnect.emit('room:cancel-countdown');
    const notHostError = await waitForEvent<RoomErrorPayload>(
      guestReconnect,
      'room:error',
    );
    expect(notHostError.reason).toBe('not-host');

    setup.host.emit('room:cancel-countdown');
    const backToLobby = await waitForMembership(
      setup.host,
      setup.room.roomId,
      (payload) => payload.status === 'lobby',
      30,
    );
    expect(backToLobby.countdownSecondsRemaining).toBeNull();
  });

  test('keeps countdown running through disconnect and finishes through breach-only outcomes', async () => {
    const setup = await setupConnectedPair(() => connectClient());

    setup.host.emit('room:claim-slot', { slotId: 'team-1' });
    setup.guest.emit('room:claim-slot', { slotId: 'team-2' });
    setup.host.emit('room:set-ready', { ready: true });
    setup.guest.emit('room:set-ready', { ready: true });

    await waitForMembership(
      setup.host,
      setup.room.roomId,
      (payload) =>
        payload.participants.filter(
          ({ role, ready }) => role === 'player' && ready,
        ).length === 2,
    );

    setup.host.emit('room:start');
    await waitForEvent<RoomCountdownPayload>(
      setup.host,
      'room:countdown',
      3500,
    );
    await waitForMembership(
      setup.host,
      setup.room.roomId,
      (payload) => payload.status === 'countdown',
    );

    setup.guest.disconnect();

    const countdownAfterDisconnect = await waitForEvent<RoomCountdownPayload>(
      setup.host,
      'room:countdown',
      3500,
    );
    expect(countdownAfterDisconnect.secondsRemaining).toBeLessThan(3);

    await waitForEvent<MatchStartedPayload>(
      setup.host,
      'room:match-started',
      7000,
    );
    await waitForMembership(
      setup.host,
      setup.room.roomId,
      (payload) => payload.status === 'active',
      35,
    );

    const guestReconnect = connectClient({
      sessionId: setup.guestJoined.playerId,
    });
    await waitForEvent<RoomJoinedPayload>(guestReconnect, 'room:joined');
    guestReconnect.emit('room:join', { roomId: setup.room.roomId });

    const activeState = await waitForState(
      setup.host,
      (payload) => payload.roomId === setup.room.roomId,
    );
    const hostTeam = activeState.teams.find(({ playerIds }) =>
      playerIds.includes(setup.room.playerId),
    );
    const guestTeam = activeState.teams.find(({ playerIds }) =>
      playerIds.includes(setup.guestJoined.playerId),
    );
    expect(hostTeam).toBeDefined();
    expect(guestTeam).toBeDefined();

    const match: ActiveMatch = {
      host: setup.host,
      guest: guestReconnect,
      room: setup.room,
      guestJoined: setup.guestJoined,
      hostTeamId: hostTeam?.id ?? 0,
      guestTeamId: guestTeam?.id ?? 0,
      hostBaseTopLeft: {
        x: hostTeam?.baseTopLeft.x ?? 0,
        y: hostTeam?.baseTopLeft.y ?? 0,
      },
      guestBaseTopLeft: {
        x: guestTeam?.baseTopLeft.x ?? 0,
        y: guestTeam?.baseTopLeft.y ?? 0,
      },
      initialGrid: activeState.grid,
    };

    match.host.emit('chat:send', { message: 'active chat still open' });
    const activeChat = await waitForEvent<ChatMessagePayload>(
      guestReconnect,
      'chat:message',
    );
    expect(activeChat.message).toBe('active chat still open');

    const finished = await breachGuestCore(match);

    expect(finished.roomId).toBe(setup.room.roomId);
    expect(finished.winner.outcome).toBe('winner');
    expect(finished.ranked[0]?.outcome).toBe('winner');
    expect(finished.ranked[0]?.teamId).toBe(finished.winner.teamId);
    expect(finished.ranked[finished.ranked.length - 1]?.coreState).toBe(
      'destroyed',
    );
    expect(finished.comparator).toContain('coreHpBeforeResolution');

    const finishedMembership = await waitForMembership(
      match.host,
      setup.room.roomId,
      (payload) => (payload.status as string) === 'finished',
      35,
    );
    expect(finishedMembership.status).toBe('finished');

    const defeatedTeamId = finished.ranked.find(
      ({ outcome }) => outcome !== 'winner',
    )?.teamId;
    expect(defeatedTeamId).not.toBeUndefined();

    guestReconnect.emit('build:queue', {
      templateId: 'block',
      x: match.guestBaseTopLeft.x + 3,
      y: match.guestBaseTopLeft.y + 3,
    });
    const defeatedError = await waitForEvent<RoomErrorPayload>(
      guestReconnect,
      'room:error',
    );
    expect(defeatedError.reason).toBe('defeated');

    guestReconnect.emit('chat:send', {
      message: 'still chatting while defeated',
    });
    const finishedChat = await waitForEvent<ChatMessagePayload>(
      match.host,
      'chat:message',
    );
    expect(finishedChat.message).toBe('still chatting while defeated');
  }, 35_000);

  test('keeps queued action outcome ordering deterministic across reruns', async () => {
    const firstRunPair = await setupConnectedPair(() => connectClient());
    const firstRunMatch = await moveToActive(firstRunPair);
    const firstRunOutcomes = await runQueuedOutcomeTimeline(firstRunMatch);

    firstRunMatch.host.close();
    firstRunMatch.guest.close();

    const secondRunPair = await setupConnectedPair(() => connectClient());
    const secondRunMatch = await moveToActive(secondRunPair);
    const secondRunOutcomes = await runQueuedOutcomeTimeline(secondRunMatch);

    expect(firstRunOutcomes).toEqual(secondRunOutcomes);
    expect(
      firstRunOutcomes.map(({ outcome, reason }) => ({ outcome, reason })),
    ).toEqual([
      { outcome: 'applied', reason: null },
      { outcome: 'applied', reason: null },
      { outcome: 'rejected', reason: 'occupied-site' },
    ]);
  }, 60_000);

  test('supports host-only restart from finished and resets prior match state', async () => {
    const setup = await setupConnectedPair(() => connectClient());
    const match = await moveToActive(setup);

    match.host.emit('room:start');
    const restartWhileActive = await waitForEvent<RoomErrorPayload>(
      match.host,
      'room:error',
    );
    expect(restartWhileActive.reason).toBe('invalid-transition');

    match.host.emit('build:queue', {
      templateId: 'block',
      x: match.hostBaseTopLeft.x + 4,
      y: match.hostBaseTopLeft.y + 4,
    });
    await waitForEvent(match.host, 'build:queued');

    const firstFinished = await breachGuestCore(match);
    expect(
      firstFinished.ranked.some(({ queuedBuildCount }) => queuedBuildCount > 0),
    ).toBe(true);

    match.guest.emit('room:start');
    const nonHostRestart = await waitForEvent<RoomErrorPayload>(
      match.guest,
      'room:error',
    );
    expect(nonHostRestart.reason).toBe('not-host');

    match.guest.disconnect();
    await waitForMembership(match.host, setup.room.roomId, (payload) =>
      payload.participants.some(
        ({ sessionId, connectionStatus }) =>
          sessionId === setup.guestJoined.playerId &&
          connectionStatus === 'held',
      ),
    );

    match.host.emit('room:start');
    const heldRestart = await waitForEvent<RoomErrorPayload>(
      match.host,
      'room:error',
    );
    expect(heldRestart.reason).toBe('not-ready');

    const reconnectedGuest = connectClient({
      sessionId: setup.guestJoined.playerId,
    });
    await waitForEvent<RoomJoinedPayload>(reconnectedGuest, 'room:joined');
    reconnectedGuest.emit('room:join', { roomId: setup.room.roomId });
    await waitForMembership(match.host, setup.room.roomId, (payload) =>
      payload.participants.some(
        ({ sessionId, connectionStatus }) =>
          sessionId === setup.guestJoined.playerId &&
          connectionStatus === 'connected',
      ),
    );

    match.host.emit('room:start');
    await waitForMembership(
      match.host,
      setup.room.roomId,
      (payload) => payload.status === 'countdown',
      35,
    );
    await waitForEvent<MatchStartedPayload>(
      match.host,
      'room:match-started',
      7000,
    );

    const restartedState = await waitForState(
      match.host,
      (payload) => payload.roomId === setup.room.roomId,
      40,
    );
    expect(restartedState.grid).toStrictEqual(match.initialGrid);
    expect(restartedState.tick).toBeLessThan(4);
    expect(
      restartedState.teams.every(({ resources }) => resources === 40),
    ).toBe(true);
    expect(restartedState.teams.every(({ defeated }) => !defeated)).toBe(true);
    expect(restartedState.teams.every(({ baseIntact }) => baseIntact)).toBe(
      true,
    );

    const restartedHostTeam = restartedState.teams.find(({ playerIds }) =>
      playerIds.includes(setup.room.playerId),
    );
    const restartedGuestTeam = restartedState.teams.find(({ playerIds }) =>
      playerIds.includes(setup.guestJoined.playerId),
    );
    expect(restartedHostTeam).toBeDefined();
    expect(restartedGuestTeam).toBeDefined();

    const restartedMatch: ActiveMatch = {
      host: match.host,
      guest: reconnectedGuest,
      room: setup.room,
      guestJoined: setup.guestJoined,
      hostTeamId: restartedHostTeam?.id ?? 0,
      guestTeamId: restartedGuestTeam?.id ?? 0,
      hostBaseTopLeft: {
        x: restartedHostTeam?.baseTopLeft.x ?? 0,
        y: restartedHostTeam?.baseTopLeft.y ?? 0,
      },
      guestBaseTopLeft: {
        x: restartedGuestTeam?.baseTopLeft.x ?? 0,
        y: restartedGuestTeam?.baseTopLeft.y ?? 0,
      },
      initialGrid: restartedState.grid,
    };

    const secondFinished = await breachGuestCore(restartedMatch);
    expect(
      secondFinished.ranked.some(
        ({ queuedBuildCount }) => queuedBuildCount > 0,
      ),
    ).toBe(true);
  }, 60_000);
});
