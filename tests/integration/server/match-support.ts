import type { Socket } from 'socket.io-client';

import type {
  MatchStartedPayload,
  RoomCountdownPayload,
  RoomJoinedPayload,
} from '#rts-engine';

import type { IntegrationClock } from './fixtures.js';
import {
  type ActiveMatchSetup,
  type TestClientOptions,
  claimSlot,
  getTeamByPlayerId,
  waitForEvent,
  waitForMembership,
  waitForRoomState,
} from './test-support.js';

export interface ConnectedRoomSetup {
  clock: IntegrationClock;
  host: Socket;
  guest: Socket;
  roomId: string;
  hostJoined: RoomJoinedPayload;
  guestJoined: RoomJoinedPayload;
}

export interface LobbyRoomSetup {
  clock: IntegrationClock;
  owner: Socket;
  roomId: string;
  created: RoomJoinedPayload;
}

export interface SetupConnectedRoomOptions {
  clock: IntegrationClock;
  connectClient: (options?: TestClientOptions) => Socket;
  roomName: string;
  width?: number;
  height?: number;
  hostSessionId?: string;
  guestSessionId?: string;
}

export interface SetupLobbyRoomOptions {
  clock: IntegrationClock;
  connectClient: (options?: TestClientOptions) => Socket;
  roomName: string;
  width?: number;
  height?: number;
  ownerSessionId?: string;
}

export interface StartMatchOptions {
  hostSlotId?: string;
  guestSlotId?: string;
  startMode?: 'manual-clock' | 'real-time';
  countdownAdvanceMs?: number;
  membershipAttempts?: number;
  membershipTimeoutMs?: number;
  stateAttempts?: number;
  stateTimeoutMs?: number;
  waitForActiveMembership?: boolean;
}

export async function setupLobbyRoom(
  options: SetupLobbyRoomOptions,
): Promise<LobbyRoomSetup> {
  const owner = options.connectClient({ sessionId: options.ownerSessionId });
  await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

  const createdPromise = waitForEvent<RoomJoinedPayload>(owner, 'room:joined');
  owner.emit('room:create', {
    name: options.roomName,
    width: options.width ?? 52,
    height: options.height ?? 52,
  });
  const created = await createdPromise;

  return {
    clock: options.clock,
    owner,
    roomId: created.roomId,
    created,
  };
}

export async function setupConnectedRoom(
  options: SetupConnectedRoomOptions,
): Promise<ConnectedRoomSetup> {
  const lobby = await setupLobbyRoom({
    clock: options.clock,
    connectClient: options.connectClient,
    roomName: options.roomName,
    width: options.width,
    height: options.height,
    ownerSessionId: options.hostSessionId,
  });

  const guest = options.connectClient({ sessionId: options.guestSessionId });
  await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

  const guestJoinedPromise = waitForEvent<RoomJoinedPayload>(
    guest,
    'room:joined',
  );
  guest.emit('room:join', { roomId: lobby.roomId });
  const guestJoined = await guestJoinedPromise;

  return {
    clock: options.clock,
    host: lobby.owner,
    guest,
    roomId: lobby.roomId,
    hostJoined: lobby.created,
    guestJoined,
  };
}

export async function startMatchAndWaitForActive(
  setup: ConnectedRoomSetup,
  options: StartMatchOptions = {},
): Promise<ActiveMatchSetup> {
  const membershipAttempts = options.membershipAttempts ?? 30;
  const membershipTimeoutMs = options.membershipTimeoutMs ?? 3000;

  await claimSlot(setup.host, options.hostSlotId ?? 'team-1');
  await claimSlot(setup.guest, options.guestSlotId ?? 'team-2');

  await waitForMembership(
    setup.host,
    setup.roomId,
    (payload) =>
      payload.slots[options.hostSlotId ?? 'team-1'] ===
        setup.hostJoined.playerId &&
      payload.slots[options.guestSlotId ?? 'team-2'] ===
        setup.guestJoined.playerId,
    {
      attempts: membershipAttempts,
      timeoutMs: membershipTimeoutMs,
    },
  );

  const readyMembershipPromise = waitForMembership(
    setup.host,
    setup.roomId,
    (payload) =>
      payload.participants.filter(
        ({ role, ready }) => role === 'player' && ready,
      ).length === 2,
    {
      attempts: membershipAttempts,
      timeoutMs: membershipTimeoutMs,
    },
  );
  setup.host.emit('room:set-ready', { ready: true });
  setup.guest.emit('room:set-ready', { ready: true });
  await readyMembershipPromise;

  const matchStartedPromise = waitForEvent<MatchStartedPayload>(
    setup.host,
    'room:match-started',
    7000,
  );
  const activeMembershipPromise = options.waitForActiveMembership
    ? waitForMembership(
        setup.host,
        setup.roomId,
        (payload) => payload.status === 'active',
        {
          attempts: options.membershipAttempts ?? 40,
          timeoutMs: membershipTimeoutMs,
        },
      )
    : null;
  if (options.startMode === 'manual-clock') {
    const countdownPromise = waitForEvent<RoomCountdownPayload>(
      setup.host,
      'room:countdown',
      3500,
    );
    setup.host.emit('room:start');
    const countdown = await countdownPromise;
    if (countdown.secondsRemaining > 0) {
      const countdownAdvanceMs =
        options.countdownAdvanceMs ?? countdown.secondsRemaining * 1_000 + 100;
      await setup.clock.advanceMs(countdownAdvanceMs);
    }
    await matchStartedPromise;
  } else {
    setup.host.emit('room:start');
    await matchStartedPromise;
  }

  if (activeMembershipPromise) {
    await activeMembershipPromise;
  }

  const activeState = await waitForRoomState(
    setup.host,
    setup.roomId,
    (payload) =>
      payload.teams.some(({ playerIds }) =>
        playerIds.includes(setup.hostJoined.playerId),
      ) &&
      payload.teams.some(({ playerIds }) =>
        playerIds.includes(setup.guestJoined.playerId),
      ),
    {
      attempts: options.stateAttempts ?? 40,
      timeoutMs: options.stateTimeoutMs ?? 2500,
    },
  );

  return {
    host: setup.host,
    guest: setup.guest,
    roomId: setup.roomId,
    hostJoined: setup.hostJoined,
    guestJoined: setup.guestJoined,
    hostTeam: getTeamByPlayerId(activeState, setup.hostJoined.playerId),
    guestTeam: getTeamByPlayerId(activeState, setup.guestJoined.playerId),
  };
}

export async function setupActiveMatch(
  options: SetupConnectedRoomOptions & StartMatchOptions,
): Promise<ActiveMatchSetup> {
  const setup = await setupConnectedRoom(options);
  return startMatchAndWaitForActive(setup, options);
}
