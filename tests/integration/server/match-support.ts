import type { Socket } from 'socket.io-client';
import { vi } from 'vitest';

import type { MatchStartedPayload, RoomJoinedPayload } from '#rts-engine';

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
  host: Socket;
  guest: Socket;
  roomId: string;
  hostJoined: RoomJoinedPayload;
  guestJoined: RoomJoinedPayload;
}

export interface SetupConnectedRoomOptions {
  connectClient: (options?: TestClientOptions) => Socket;
  roomName: string;
  width?: number;
  height?: number;
  hostSessionId?: string;
  guestSessionId?: string;
}

export interface StartMatchOptions {
  hostSlotId?: string;
  guestSlotId?: string;
  startMode?: 'real-time' | 'fake-timers';
  countdownAdvanceMs?: number;
  membershipAttempts?: number;
  membershipTimeoutMs?: number;
  stateAttempts?: number;
  stateTimeoutMs?: number;
  waitForActiveMembership?: boolean;
}

export async function setupConnectedRoom(
  options: SetupConnectedRoomOptions,
): Promise<ConnectedRoomSetup> {
  const host = options.connectClient({ sessionId: options.hostSessionId });
  await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

  const hostCreatedPromise = waitForEvent<RoomJoinedPayload>(
    host,
    'room:joined',
  );
  host.emit('room:create', {
    name: options.roomName,
    width: options.width ?? 52,
    height: options.height ?? 52,
  });
  const hostJoined = await hostCreatedPromise;

  const guest = options.connectClient({ sessionId: options.guestSessionId });
  await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

  const guestJoinedPromise = waitForEvent<RoomJoinedPayload>(
    guest,
    'room:joined',
  );
  guest.emit('room:join', { roomId: hostJoined.roomId });
  const guestJoined = await guestJoinedPromise;

  return {
    host,
    guest,
    roomId: hostJoined.roomId,
    hostJoined,
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
  if (options.startMode === 'fake-timers') {
    const countdownPromise = waitForEvent(setup.host, 'room:countdown', 3500);
    vi.useFakeTimers();
    try {
      setup.host.emit('room:start');
      await countdownPromise;
      await vi.advanceTimersByTimeAsync(options.countdownAdvanceMs ?? 3_100);
      await matchStartedPromise;
    } finally {
      vi.useRealTimers();
    }
  } else {
    setup.host.emit('room:start');
    await matchStartedPromise;
  }

  if (options.waitForActiveMembership) {
    await waitForMembership(
      setup.host,
      setup.roomId,
      (payload) => payload.status === 'active',
      {
        attempts: options.membershipAttempts ?? 40,
        timeoutMs: membershipTimeoutMs,
      },
    );
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
