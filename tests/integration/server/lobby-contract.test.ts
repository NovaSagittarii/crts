import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { io, type Socket } from 'socket.io-client';

import {
  createServer,
  type GameServer,
} from '../../../apps/server/src/server.js';

import type {
  ChatMessagePayload,
  MatchStartedPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomListEntryPayload,
  RoomMembershipPayload,
} from '#rts-engine';

type RoomListEntry = RoomListEntryPayload;

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
  timeoutMs = 1500,
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
  attempts = 12,
): Promise<RoomMembershipPayload> {
  for (let index = 0; index < attempts; index += 1) {
    const payload = await waitForEvent<RoomMembershipPayload>(
      socket,
      'room:membership',
      2500,
    );
    if (payload.roomId === roomId && predicate(payload)) {
      return payload;
    }
  }

  throw new Error('Membership condition not met in allotted attempts');
}

function countPlayers(payload: RoomMembershipPayload): number {
  return payload.participants.filter(({ role }) => role === 'player').length;
}

describe('lobby room/team contract', () => {
  let server: GameServer;
  let port = 0;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    server = createServer({ port: 0, width: 50, height: 50, tickMs: 40 });
    port = await server.start();
  });

  afterEach(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    await server.stop();
  });

  function connectClient(): Socket {
    const socket = createClient(port);
    sockets.push(socket);
    return socket;
  }

  test('keeps room membership revisions deterministic across join and leave', async () => {
    const owner = connectClient();
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', {
      name: 'Deterministic Room',
      width: 42,
      height: 42,
    });
    const ownerRoom = await waitForEvent<RoomJoinedPayload>(
      owner,
      'room:joined',
    );
    const ownerInitialMembership = await waitForMembership(
      owner,
      ownerRoom.roomId,
      (payload) => payload.participants.length === 1,
    );

    const guest = connectClient();
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

    guest.emit('room:join', { roomId: ownerRoom.roomId });
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

    const ownerWithGuest = await waitForMembership(
      owner,
      ownerRoom.roomId,
      (payload) => payload.participants.length === 2,
    );
    const guestWithOwner = await waitForMembership(
      guest,
      ownerRoom.roomId,
      (payload) => payload.participants.length === 2,
    );

    expect(ownerWithGuest.revision).toBe(guestWithOwner.revision);
    expect(ownerWithGuest.revision).toBeGreaterThan(
      ownerInitialMembership.revision,
    );

    guest.emit('room:leave');
    const ownerAfterLeave = await waitForMembership(
      owner,
      ownerRoom.roomId,
      (payload) => payload.participants.length === 1,
    );

    expect(ownerAfterLeave.revision).toBe(ownerWithGuest.revision + 1);
  });

  test('supports room-code join and caps players at two with spectator overflow', async () => {
    const owner = connectClient();
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', { name: 'Code Room', width: 48, height: 48 });
    const created = await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:list');
    const rooms = await waitForEvent<RoomListEntry[]>(owner, 'room:list');
    expect(rooms.some(({ roomCode }) => roomCode === created.roomCode)).toBe(
      true,
    );

    const firstPlayer = connectClient();
    await waitForEvent<RoomJoinedPayload>(firstPlayer, 'room:joined');
    firstPlayer.emit('room:join', { roomId: created.roomId });
    const firstPlayerJoined = await waitForEvent<RoomJoinedPayload>(
      firstPlayer,
      'room:joined',
    );

    const spectator = connectClient();
    await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
    spectator.emit('room:join', { roomCode: created.roomCode });
    const spectatorJoined = await waitForEvent<RoomJoinedPayload>(
      spectator,
      'room:joined',
    );

    owner.emit('room:claim-slot', { slotId: 'team-1' });
    firstPlayer.emit('room:claim-slot', { slotId: 'team-2' });

    const fullPlayers = await waitForMembership(
      owner,
      created.roomId,
      (payload) => countPlayers(payload) === 2,
    );
    expect(fullPlayers.slots['team-1']).toBe(created.playerId);
    expect(fullPlayers.slots['team-2']).toBe(firstPlayerJoined.playerId);

    spectator.emit('room:claim-slot', { slotId: 'team-1' });
    const roomError = await waitForEvent<RoomErrorPayload>(
      spectator,
      'room:error',
    );
    expect(roomError.reason).toBe('slot-full');

    const overflow = await waitForMembership(
      spectator,
      created.roomId,
      (payload) => payload.participants.length === 3,
    );
    expect(countPlayers(overflow)).toBe(2);
    expect(
      overflow.participants.find(
        ({ sessionId }) => sessionId === spectatorJoined.playerId,
      )?.role,
    ).toBe('spectator');
  });

  test('enforces slot lock and manual ready toggles', async () => {
    const owner = connectClient();
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', { name: 'Ready Room', width: 46, height: 46 });
    const created = await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    const guest = connectClient();
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');
    guest.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

    owner.emit('room:claim-slot', { slotId: 'team-1' });
    await waitForMembership(
      owner,
      created.roomId,
      (payload) => countPlayers(payload) === 1,
    );

    owner.emit('room:claim-slot', { slotId: 'team-2' });
    const switchError = await waitForEvent<RoomErrorPayload>(
      owner,
      'room:error',
    );
    expect(switchError.reason).toBe('team-switch-locked');

    guest.emit('room:set-ready', { ready: true });
    const spectatorReadyError = await waitForEvent<RoomErrorPayload>(
      guest,
      'room:error',
    );
    expect(spectatorReadyError.reason).toBe('not-player');

    owner.emit('room:set-ready', { ready: true });
    await waitForMembership(owner, created.roomId, (payload) =>
      payload.participants.some(
        ({ sessionId, ready }) => sessionId === created.playerId && ready,
      ),
    );

    owner.emit('room:set-ready', { ready: false });
    const ownerNotReady = await waitForMembership(
      owner,
      created.roomId,
      (payload) =>
        payload.participants.some(
          ({ sessionId, ready }) => sessionId === created.playerId && !ready,
        ),
    );

    expect(
      ownerNotReady.participants.find(
        ({ sessionId }) => sessionId === created.playerId,
      )?.ready,
    ).toBe(false);
  });

  test('transfers host deterministically before match start', async () => {
    const owner = connectClient();
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', { name: 'Host Room', width: 44, height: 44 });
    const created = await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    const guest = connectClient();
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');
    guest.emit('room:join', { roomId: created.roomId });
    const guestJoined = await waitForEvent<RoomJoinedPayload>(
      guest,
      'room:joined',
    );

    const viewer = connectClient();
    await waitForEvent<RoomJoinedPayload>(viewer, 'room:joined');
    viewer.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(viewer, 'room:joined');

    const withHost = await waitForMembership(
      owner,
      created.roomId,
      (payload) => payload.participants.length === 3,
    );
    expect(withHost.hostSessionId).toBe(created.playerId);

    owner.emit('room:leave');
    const transferred = await waitForMembership(
      guest,
      created.roomId,
      (payload) => payload.participants.length === 2,
    );
    expect(transferred.hostSessionId).toBe(guestJoined.playerId);
  });

  test('guards start preconditions and continues countdown when a player disconnects', async () => {
    const owner = connectClient();
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', {
      name: 'Countdown Room',
      width: 52,
      height: 52,
    });
    const created = await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    const guest = connectClient();
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');
    guest.emit('room:join', { roomId: created.roomId });
    const guestJoined = await waitForEvent<RoomJoinedPayload>(
      guest,
      'room:joined',
    );

    owner.emit('room:claim-slot', { slotId: 'team-1' });
    guest.emit('room:claim-slot', { slotId: 'team-2' });
    await waitForMembership(
      owner,
      created.roomId,
      (payload) => countPlayers(payload) === 2,
    );

    owner.emit('room:set-ready', { ready: true });
    await waitForMembership(owner, created.roomId, (payload) =>
      payload.participants.some(
        ({ sessionId, ready }) => sessionId === created.playerId && ready,
      ),
    );

    owner.emit('room:start', { force: true });
    const preconditionError = await waitForEvent<RoomErrorPayload>(
      owner,
      'room:error',
    );
    expect(preconditionError.reason).toBe('not-ready');

    guest.emit('room:set-ready', { ready: true });
    await waitForMembership(owner, created.roomId, (payload) =>
      payload.participants.some(
        ({ sessionId, ready }) => sessionId === guestJoined.playerId && ready,
      ),
    );

    owner.emit('room:start');
    await waitForMembership(
      owner,
      created.roomId,
      (payload) => payload.status === 'countdown',
      20,
    );

    guest.emit('room:set-ready', { ready: false });
    const readyLocked = await waitForEvent<RoomErrorPayload>(
      guest,
      'room:error',
    );
    expect(readyLocked.reason).toBe('countdown-locked');

    guest.close();

    const started = await waitForEvent<MatchStartedPayload>(
      owner,
      'room:match-started',
      5000,
    );
    expect(started.roomId).toBe(created.roomId);

    const activeMembership = await waitForMembership(
      owner,
      created.roomId,
      (payload) => payload.status === 'active',
      20,
    );
    expect(activeMembership.status).toBe('active');
  });

  test('broadcasts room chat to players and spectators during active match', async () => {
    const owner = connectClient();
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', { name: 'Chat Room', width: 54, height: 54 });
    const created = await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    const secondPlayer = connectClient();
    await waitForEvent<RoomJoinedPayload>(secondPlayer, 'room:joined');
    secondPlayer.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(secondPlayer, 'room:joined');

    const spectator = connectClient();
    await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
    spectator.emit('room:join', { roomCode: created.roomCode });
    const spectatorJoined = await waitForEvent<RoomJoinedPayload>(
      spectator,
      'room:joined',
    );

    owner.emit('room:claim-slot', { slotId: 'team-1' });
    secondPlayer.emit('room:claim-slot', { slotId: 'team-2' });
    owner.emit('room:set-ready', { ready: true });
    secondPlayer.emit('room:set-ready', { ready: true });

    await waitForMembership(
      owner,
      created.roomId,
      (payload) =>
        payload.participants.filter(
          ({ role, ready }) => role === 'player' && ready,
        ).length === 2,
      20,
    );

    owner.emit('room:start');
    await waitForEvent<MatchStartedPayload>(owner, 'room:match-started', 5000);

    spectator.emit('chat:send', { message: 'glhf from spectator' });

    const ownerChat = await waitForEvent<ChatMessagePayload>(
      owner,
      'chat:message',
    );
    const secondPlayerChat = await waitForEvent<ChatMessagePayload>(
      secondPlayer,
      'chat:message',
    );
    const spectatorChat = await waitForEvent<ChatMessagePayload>(
      spectator,
      'chat:message',
    );

    expect(ownerChat.message).toBe('glhf from spectator');
    expect(secondPlayerChat.message).toBe('glhf from spectator');
    expect(spectatorChat.message).toBe('glhf from spectator');
    expect(ownerChat.senderSessionId).toBe(spectatorJoined.playerId);
  });
});
