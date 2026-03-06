import { describe, expect, test, vi } from 'vitest';

import { LobbySessionCoordinator } from './lobby-session.js';
import {
  RoomBroadcastService,
  type RuntimeBroadcastRoom,
} from './server-room-broadcast.js';

import {
  type ClientToServerEvents,
  LobbyRoom,
  OUTCOME_COMPARATOR_DESCRIPTION,
  RtsEngine,
  type RoomStatus,
  type ServerToClientEvents,
} from '#rts-engine';
import type { Server as SocketIOServer, Socket } from 'socket.io';

interface EmittedEvent {
  channel: 'global' | 'room' | 'socket';
  roomId: string | null;
  event: string;
  payload: unknown;
}

function createFakeIo() {
  const events: EmittedEvent[] = [];

  const io = {
    emit(event: string, payload: unknown): void {
      events.push({ channel: 'global', roomId: null, event, payload });
    },
    to(roomId: string) {
      return {
        emit(event: string, payload: unknown): void {
          events.push({ channel: 'room', roomId, event, payload });
        },
      };
    },
  };

  return {
    io: io as unknown as SocketIOServer<
      ClientToServerEvents,
      ServerToClientEvents
    >,
    events,
  };
}

function createFakeSocket(events: EmittedEvent[]) {
  return {
    emit(event: string, payload: unknown): void {
      events.push({ channel: 'socket', roomId: null, event, payload });
    },
  } as unknown as Socket<ClientToServerEvents, ServerToClientEvents>;
}

function createRoom(
  roomId: string,
  status: RoomStatus = 'lobby',
): RuntimeBroadcastRoom {
  return {
    rtsRoom: RtsEngine.createRoom({
      id: roomId,
      name: `Room ${roomId}`,
      width: 24,
      height: 24,
    }),
    lobby: LobbyRoom.create({ roomId, slotIds: ['team-1', 'team-2'] }),
    roomCode: `code-${roomId}`,
    revision: 0,
    status,
    countdownSecondsRemaining: null,
    matchOutcome: null,
    lockstep: {
      mode: 'off',
      status: 'running',
      turnLengthTicks: 1,
      nextTurn: 0,
      bufferedTurns: 0,
      mismatchCount: 0,
    },
  };
}

describe('RoomBroadcastService', () => {
  test('buildMembershipPayload marks held participants and slot holds', () => {
    const { io } = createFakeIo();
    const sessionCoordinator = new LobbySessionCoordinator({
      holdMs: 5_000,
      now: () => 10_000,
    });
    const room = createRoom('1');

    room.lobby.join({ sessionId: 'alpha', displayName: 'Alpha' });
    room.lobby.join({ sessionId: 'bravo', displayName: 'Bravo' });
    room.lobby.claimSlot('alpha', 'team-1');
    room.lobby.claimSlot('bravo', 'team-2');

    sessionCoordinator.attachSocket({
      requestedSessionId: 'alpha',
      fallbackSessionId: 'alpha',
      fallbackName: 'Alpha',
      socketId: 'socket-alpha',
    });
    sessionCoordinator.setRoom('alpha', '1');

    sessionCoordinator.attachSocket({
      requestedSessionId: 'bravo',
      fallbackSessionId: 'bravo',
      fallbackName: 'Bravo',
      socketId: 'socket-bravo',
    });
    sessionCoordinator.setRoom('bravo', '1');

    sessionCoordinator.holdOnDisconnect({
      sessionId: 'bravo',
      socketId: 'socket-bravo',
      roomId: '1',
      slotId: 'team-2',
      disconnectReason: 'transport close',
      onExpire: vi.fn(),
    });

    const service = new RoomBroadcastService({
      io,
      sessionCoordinator,
      roomChannel: (id) => `room:${id}`,
      listRooms: () => [room],
    });

    const payload = service.buildMembershipPayload(room);
    const alpha = payload.participants.find(
      ({ sessionId }) => sessionId === 'alpha',
    );
    const bravo = payload.participants.find(
      ({ sessionId }) => sessionId === 'bravo',
    );

    expect(alpha?.connectionStatus).toBe('connected');
    expect(alpha?.holdExpiresAt).toBeNull();
    expect(bravo?.connectionStatus).toBe('held');
    expect(bravo?.holdExpiresAt).toBe(15_000);
    expect(bravo?.disconnectReason).toBe('transport close');
    expect(payload.heldSlots['team-2']).toEqual({
      sessionId: 'bravo',
      holdExpiresAt: 15_000,
      disconnectReason: 'transport close',
    });
    expect(payload.lockstep).toEqual(room.lockstep);
  });

  test('emitRoomList sorts rooms and reports player/spectator totals', () => {
    const { io, events } = createFakeIo();
    const sessionCoordinator = new LobbySessionCoordinator();
    const room10 = createRoom('10');
    const room2 = createRoom('2');

    room10.lobby.join({ sessionId: 'a', displayName: 'A' });
    room10.lobby.join({ sessionId: 'b', displayName: 'B' });
    room10.lobby.claimSlot('a', 'team-1');

    room2.lobby.join({ sessionId: 'c', displayName: 'C' });
    room2.lobby.claimSlot('c', 'team-1');

    const service = new RoomBroadcastService({
      io,
      sessionCoordinator,
      roomChannel: (id) => `room:${id}`,
      listRooms: () => [room10, room2],
    });

    service.emitRoomList();

    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('room:list');
    const payload = events[0]?.payload as Array<{
      roomId: string;
      players: number;
      spectators: number;
    }>;
    expect(payload.map(({ roomId }) => roomId)).toEqual(['2', '10']);
    expect(payload[1]).toMatchObject({ players: 1, spectators: 1 });

    const socket = createFakeSocket(events);
    service.emitRoomList(socket);
    expect(events[1]?.channel).toBe('socket');
    expect(events[1]?.event).toBe('room:list');
  });

  test('emitMembership increments revision unless disabled', () => {
    const { io, events } = createFakeIo();
    const sessionCoordinator = new LobbySessionCoordinator();
    const room = createRoom('3');
    room.revision = 7;

    const service = new RoomBroadcastService({
      io,
      sessionCoordinator,
      roomChannel: (id) => `room:${id}`,
      listRooms: () => [room],
    });

    service.emitMembership(room);
    expect(room.revision).toBe(8);
    expect(events[0]).toMatchObject({
      channel: 'room',
      roomId: 'room:3',
      event: 'room:membership',
    });

    service.emitMembership(room, false);
    expect(room.revision).toBe(8);
  });

  test('emits room state and queued outcomes on room channel', () => {
    const { io, events } = createFakeIo();
    const sessionCoordinator = new LobbySessionCoordinator();
    const room = createRoom('4');

    const service = new RoomBroadcastService({
      io,
      sessionCoordinator,
      roomChannel: (id) => `room:${id}`,
      listRooms: () => [room],
    });

    service.emitRoomState(room);
    service.emitBuildOutcomes(room, [
      {
        roomId: '4',
        eventId: 101,
        teamId: 1,
        outcome: 'applied',
        executeTick: 5,
        resolvedTick: 5,
      },
    ]);
    service.emitDestroyOutcomes(room, [
      {
        roomId: '4',
        eventId: 202,
        teamId: 1,
        structureKey: '10:10:3:3',
        templateId: 'block',
        outcome: 'rejected',
        reason: 'invalid-target',
        executeTick: 6,
        resolvedTick: 6,
      },
    ]);

    expect(events[0]).toMatchObject({
      channel: 'room',
      roomId: 'room:4',
      event: 'state',
    });
    expect(events[1]).toMatchObject({
      channel: 'room',
      roomId: 'room:4',
      event: 'build:outcome',
      payload: { roomId: '4', eventId: 101 },
    });
    expect(events[2]).toMatchObject({
      channel: 'room',
      roomId: 'room:4',
      event: 'destroy:outcome',
      payload: { roomId: '4', eventId: 202 },
    });
  });

  test('emitMatchFinished only emits when match outcome is present', () => {
    const { io, events } = createFakeIo();
    const sessionCoordinator = new LobbySessionCoordinator();
    const room = createRoom('5', 'active');

    const service = new RoomBroadcastService({
      io,
      sessionCoordinator,
      roomChannel: (id) => `room:${id}`,
      listRooms: () => [room],
    });

    service.emitMatchFinished(room);
    expect(events).toHaveLength(0);

    room.matchOutcome = {
      roomId: '5',
      winner: {
        rank: 1,
        teamId: 1,
        outcome: 'winner',
        finalCoreHp: 300,
        coreState: 'intact',
        territoryCellCount: 18,
        queuedBuildCount: 0,
        appliedBuildCount: 2,
        rejectedBuildCount: 0,
      },
      ranked: [
        {
          rank: 1,
          teamId: 1,
          outcome: 'winner',
          finalCoreHp: 300,
          coreState: 'intact',
          territoryCellCount: 18,
          queuedBuildCount: 0,
          appliedBuildCount: 2,
          rejectedBuildCount: 0,
        },
      ],
      comparator: OUTCOME_COMPARATOR_DESCRIPTION,
    };

    service.emitMatchFinished(room);
    expect(events[0]).toMatchObject({
      channel: 'room',
      roomId: 'room:5',
      event: 'room:match-finished',
      payload: {
        roomId: '5',
        comparator: OUTCOME_COMPARATOR_DESCRIPTION,
      },
    });
  });

  test('emits lockstep checkpoint and fallback on room channel', () => {
    const { io, events } = createFakeIo();
    const sessionCoordinator = new LobbySessionCoordinator();
    const room = createRoom('6', 'active');

    const service = new RoomBroadcastService({
      io,
      sessionCoordinator,
      roomChannel: (id) => `room:${id}`,
      listRooms: () => [room],
    });

    service.emitLockstepCheckpoint(room, {
      tick: 10,
      generation: 10,
      hashAlgorithm: 'fnv1a-32',
      hashHex: 'deadbeef',
      mode: 'shadow',
      turn: 10,
    });
    service.emitLockstepFallback(room, {
      fromMode: 'shadow',
      reason: 'hash-mismatch',
      checkpoint: {
        tick: 10,
        generation: 10,
        hashAlgorithm: 'fnv1a-32',
        hashHex: 'deadbeef',
      },
    });

    expect(events[0]).toMatchObject({
      channel: 'room',
      roomId: 'room:6',
      event: 'lockstep:checkpoint',
      payload: { roomId: '6', hashHex: 'deadbeef', mode: 'shadow' },
    });
    expect(events[1]).toMatchObject({
      channel: 'room',
      roomId: 'room:6',
      event: 'lockstep:fallback',
      payload: { roomId: '6', fromMode: 'shadow', reason: 'hash-mismatch' },
    });
  });
});
