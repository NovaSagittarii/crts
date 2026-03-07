import type { Socket } from 'socket.io-client';
import { describe, expect, vi } from 'vitest';

import type {
  ChatMessagePayload,
  MatchFinishedPayload,
  MatchStartedPayload,
  RoomCountdownPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
} from '#rts-engine';

import {
  type ConnectedRoomSetup,
  startMatchAndWaitForActive,
} from './match-support.js';
import { createRoomTest } from './room-fixtures.js';
import {
  waitForDestroyOutcome,
  waitForDestroyQueueResponse,
  waitForDestroyScheduled,
  waitForEvent,
  waitForMembership,
  waitForRoomState,
} from './test-support.js';

const test = createRoomTest(
  { port: 0, width: 52, height: 52, tickMs: 40 },
  { roomName: 'Lifecycle Room' },
);

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

function setupConnectedPair(setup: ConnectedRoomSetup): ConnectedPair {
  return {
    host: setup.host,
    guest: setup.guest,
    room: setup.hostJoined,
    guestJoined: setup.guestJoined,
  };
}

async function moveToActive(pair: ConnectedPair): Promise<ActiveMatch> {
  const activeSetup = await startMatchAndWaitForActive(
    {
      host: pair.host,
      guest: pair.guest,
      roomId: pair.room.roomId,
      hostJoined: pair.room,
      guestJoined: pair.guestJoined,
    },
    {
      startMode: 'fake-timers',
      waitForActiveMembership: true,
      membershipAttempts: 40,
    },
  );

  const activeMembership = await waitForMembership(
    pair.host,
    pair.room.roomId,
    (payload) => payload.status === 'active',
    { attempts: 40 },
  );
  expect(activeMembership.status).toBe('active');

  const activeState = await waitForRoomState(
    pair.host,
    pair.room.roomId,
    (payload) => payload.roomId === pair.room.roomId,
  );

  return {
    ...pair,
    hostTeamId: activeSetup.hostTeam.id,
    guestTeamId: activeSetup.guestTeam.id,
    hostBaseTopLeft: activeSetup.hostTeam.baseTopLeft,
    guestBaseTopLeft: activeSetup.guestTeam.baseTopLeft,
    initialGrid: activeState.grid,
  };
}

async function breachGuestCore(
  match: ActiveMatch,
): Promise<MatchFinishedPayload> {
  const activeState = await waitForRoomState(
    match.host,
    match.room.roomId,
    (payload) => payload.roomId === match.room.roomId,
  );
  const guestTeam = activeState.teams.find(
    ({ id }) => id === match.guestTeamId,
  );
  if (!guestTeam) {
    throw new Error('Guest team was not found in active match state');
  }

  const guestCore = guestTeam.structures.find(({ isCore }) => isCore);
  if (!guestCore) {
    throw new Error('Guest core structure was not found');
  }

  const finishedPromise = waitForEvent<MatchFinishedPayload>(
    match.host,
    'room:match-finished',
    15_000,
  );

  const destroyScheduledPromise = waitForDestroyScheduled(match.guest, 4_000);
  const queueResponsePromise = waitForDestroyQueueResponse(match.guest);
  match.guest.emit('destroy:queue', {
    structureKey: guestCore.key,
    delayTicks: 1,
  });
  const queueResponse = await queueResponsePromise;
  if ('error' in queueResponse) {
    throw new Error(
      `Expected guest core destroy queue acceptance, received ${queueResponse.error.reason}`,
    );
  }
  const destroyScheduled = await destroyScheduledPromise;

  const destroyOutcome = await waitForDestroyOutcome(
    match.guest,
    destroyScheduled.eventId,
  );
  expect(destroyOutcome.outcome).toBe('destroyed');
  expect(destroyOutcome.structureKey).toBe(guestCore.key);

  return finishedPromise;
}

describe('server match lifecycle contract', () => {
  test('enforces start preconditions and allows host countdown cancel', async ({
    connectedRoom,
    connectClient,
  }) => {
    const setup = setupConnectedPair(connectedRoom);

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
      { attempts: 30 },
    );
    expect(backToLobby.countdownSecondsRemaining).toBeNull();
  }, 10_000);

  test('keeps countdown running through disconnect and finishes through breach-only outcomes', async ({
    connectedRoom,
    connectClient,
  }) => {
    const setup = setupConnectedPair(connectedRoom);

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

    const openingCountdownPromise = waitForEvent<RoomCountdownPayload>(
      setup.host,
      'room:countdown',
      3500,
    );
    const countdownMembershipPromise = waitForMembership(
      setup.host,
      setup.room.roomId,
      (payload) => payload.status === 'countdown',
    );
    const matchStartedPromise = waitForEvent<MatchStartedPayload>(
      setup.host,
      'room:match-started',
      7000,
    );

    vi.useFakeTimers();
    try {
      setup.host.emit('room:start');
      await openingCountdownPromise;
      await countdownMembershipPromise;

      const countdownAfterDisconnectPromise =
        waitForEvent<RoomCountdownPayload>(setup.host, 'room:countdown', 3500);

      setup.guest.disconnect();

      await vi.advanceTimersByTimeAsync(1_100);
      const countdownAfterDisconnect = await countdownAfterDisconnectPromise;
      expect(countdownAfterDisconnect.secondsRemaining).toBeLessThan(3);

      await vi.advanceTimersByTimeAsync(2_100);
      await matchStartedPromise;
    } finally {
      vi.useRealTimers();
    }
    await waitForMembership(
      setup.host,
      setup.room.roomId,
      (payload) => payload.status === 'active',
      { attempts: 35 },
    );

    const guestReconnect = connectClient({
      sessionId: setup.guestJoined.playerId,
    });
    await waitForEvent<RoomJoinedPayload>(guestReconnect, 'room:joined');
    guestReconnect.emit('room:join', { roomId: setup.room.roomId });

    const activeState = await waitForRoomState(
      setup.host,
      setup.room.roomId,
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
      { attempts: 35 },
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

  test('supports host-only restart from finished and resets prior match state', async ({
    connectedRoom,
    connectClient,
  }) => {
    const setup = setupConnectedPair(connectedRoom);
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

    const restartCountdownMembershipPromise = waitForMembership(
      match.host,
      setup.room.roomId,
      (payload) => payload.status === 'countdown',
      { attempts: 35 },
    );
    const restartMatchStartedPromise = waitForEvent<MatchStartedPayload>(
      match.host,
      'room:match-started',
      7000,
    );

    vi.useFakeTimers();
    try {
      match.host.emit('room:start');
      await restartCountdownMembershipPromise;
      await vi.advanceTimersByTimeAsync(3_100);
      await restartMatchStartedPromise;
    } finally {
      vi.useRealTimers();
    }

    const restartedState = await waitForRoomState(
      match.host,
      setup.room.roomId,
      (payload) => payload.roomId === setup.room.roomId,
      { attempts: 40 },
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
        ({ teamId, coreState }) =>
          teamId === restartedMatch.guestTeamId && coreState === 'destroyed',
      ),
    ).toBe(true);
    expect(secondFinished.winner.teamId).toBe(restartedMatch.hostTeamId);
  }, 60_000);
});
