import type { Socket } from 'socket.io-client';
import { vi } from 'vitest';

import type { MatchStartedPayload, RoomJoinedPayload } from '#rts-engine';

import type { IntegrationRuntime } from './fixtures.js';
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
  startMode?: 'real-time' | 'fake-timers' | 'manual';
  runtime?: IntegrationRuntime | null;
  countdownAdvanceMs?: number;
  membershipAttempts?: number;
  membershipTimeoutMs?: number;
  stateAttempts?: number;
  stateTimeoutMs?: number;
  waitForActiveMembership?: boolean;
}

const DEFAULT_MATCH_STARTED_TIMEOUT_MS = 7000;
const DEFAULT_MANUAL_COUNTDOWN_ADVANCE_MS = 3_100;

async function startRoomAndWaitForMatchStart(
  host: Socket,
  options: StartMatchOptions,
): Promise<MatchStartedPayload> {
  const countdownAdvanceMs =
    options.countdownAdvanceMs ?? DEFAULT_MANUAL_COUNTDOWN_ADVANCE_MS;

  let matchStartedResolved = false;
  const matchStartedPromise =
    options.startMode === 'manual'
      ? new Promise<MatchStartedPayload>((resolve) => {
          host.once('room:match-started', (payload: MatchStartedPayload) => {
            matchStartedResolved = true;
            resolve(payload);
          });
        })
      : waitForEvent<MatchStartedPayload>(
          host,
          'room:match-started',
          DEFAULT_MATCH_STARTED_TIMEOUT_MS,
        ).then((payload) => {
          matchStartedResolved = true;
          return payload;
        });

  if (options.startMode === 'fake-timers') {
    const countdownPromise = waitForEvent(host, 'room:countdown', 3500);
    vi.useFakeTimers();
    try {
      host.emit('room:start');
      await countdownPromise;
      await vi.advanceTimersByTimeAsync(countdownAdvanceMs);
      return await matchStartedPromise;
    } finally {
      vi.useRealTimers();
    }
  }

  if (options.startMode === 'manual') {
    if (!options.runtime) {
      throw new Error('Manual start mode requires an integration runtime');
    }

    host.emit('room:start');
    await options.runtime.settle();
    if (!matchStartedResolved) {
      await options.runtime.advanceMs(countdownAdvanceMs);
    }
    await options.runtime.settle();
    if (!matchStartedResolved) {
      throw new Error('Manual countdown did not emit room:match-started');
    }
    return matchStartedPromise;
  }

  host.emit('room:start');
  return matchStartedPromise;
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

  await startRoomAndWaitForMatchStart(setup.host, options);

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
