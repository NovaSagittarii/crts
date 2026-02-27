import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { io, type Socket } from 'socket.io-client';

import {
  createServer,
  type GameServer,
} from '../../../apps/server/src/server.js';

import type {
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
  initialGrid: string;
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
  const baseCells = [
    { x: match.guestBaseTopLeft.x, y: match.guestBaseTopLeft.y },
    { x: match.guestBaseTopLeft.x + 1, y: match.guestBaseTopLeft.y },
    { x: match.guestBaseTopLeft.x, y: match.guestBaseTopLeft.y + 1 },
    { x: match.guestBaseTopLeft.x + 1, y: match.guestBaseTopLeft.y + 1 },
  ];

  for (let cycle = 0; cycle < 4; cycle += 1) {
    for (const cell of baseCells) {
      match.host.emit('cell:update', {
        x: cell.x,
        y: cell.y,
        alive: false,
      });
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 160);
    });
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
    expect(slotError.reason).toBe('start-preconditions-not-met');

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
    expect(holdError.reason).toBe('start-preconditions-not-met');

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
    expect(heldRestart.reason).toBe('start-preconditions-not-met');

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
    expect(restartedState.grid).toBe(match.initialGrid);
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
      secondFinished.ranked.every(
        ({ queuedBuildCount, appliedBuildCount, rejectedBuildCount }) =>
          queuedBuildCount === 0 &&
          appliedBuildCount === 0 &&
          rejectedBuildCount === 0,
      ),
    ).toBe(true);
  }, 60_000);
});
