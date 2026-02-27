import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { io, type Socket } from 'socket.io-client';

import {
  createServer,
  type GameServer,
} from '../../../apps/server/src/server.js';

interface RoomJoinedPayload {
  roomId: string;
  roomCode: string;
  roomName: string;
  playerId: string;
  playerName: string;
  teamId: number | null;
}

interface RoomErrorPayload {
  message: string;
  reason?: string;
}

interface MembershipParticipant {
  sessionId: string;
  displayName: string;
  role: 'player' | 'spectator';
  slotId: string | null;
  ready: boolean;
}

interface RoomMembershipPayload {
  roomId: string;
  roomCode: string;
  roomName: string;
  revision: number;
  status: 'lobby' | 'countdown' | 'active';
  hostSessionId: string | null;
  slots: Record<string, string | null>;
  participants: MembershipParticipant[];
  countdownSecondsRemaining: number | null;
}

interface ClientOptions {
  sessionId?: string;
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
  timeoutMs = 2000,
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
  attempts = 20,
  timeoutMs = 2000,
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

describe('lobby reconnect reliability', () => {
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

  test('holds disconnected slot for reclaim, releases it after timeout, and keeps late return as spectator', async () => {
    const host = connectClient({ sessionId: 'host-hold-timeout' });
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    host.emit('room:create', {
      name: 'Reconnect Hold Room',
      width: 52,
      height: 52,
    });
    const created = await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const player = connectClient({ sessionId: 'session-reclaim-timeout' });
    await waitForEvent<RoomJoinedPayload>(player, 'room:joined');
    player.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(player, 'room:joined');

    player.emit('room:claim-slot', { slotId: 'team-1' });
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'session-reclaim-timeout',
    );

    player.disconnect();
    await waitForMembership(
      host,
      created.roomId,
      (payload) =>
        payload.slots['team-1'] === 'session-reclaim-timeout' &&
        payload.participants.some(
          ({ sessionId, role }) =>
            sessionId === 'session-reclaim-timeout' && role === 'player',
        ),
      10,
      1000,
    );

    await waitForMembership(
      host,
      created.roomId,
      (payload) =>
        payload.slots['team-1'] === null &&
        !payload.participants.some(
          ({ sessionId }) => sessionId === 'session-reclaim-timeout',
        ),
      80,
      1000,
    );

    const replacementPlayer = connectClient({
      sessionId: 'replacement-player',
    });
    await waitForEvent<RoomJoinedPayload>(replacementPlayer, 'room:joined');
    replacementPlayer.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(replacementPlayer, 'room:joined');
    replacementPlayer.emit('room:claim-slot', { slotId: 'team-1' });
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'replacement-player',
    );

    const lateReconnect = connectClient({
      sessionId: 'session-reclaim-timeout',
    });
    await waitForEvent<RoomJoinedPayload>(lateReconnect, 'room:joined');
    lateReconnect.emit('room:join', {
      roomId: created.roomId,
      slotId: 'team-1',
    });

    const lateError = await waitForEvent<RoomErrorPayload>(
      lateReconnect,
      'room:error',
    );
    expect(lateError.reason).toBe('slot-full');

    const finalMembership = await waitForMembership(
      host,
      created.roomId,
      (payload) =>
        payload.participants.some(
          ({ sessionId, role, slotId }) =>
            sessionId === 'session-reclaim-timeout' &&
            role === 'spectator' &&
            slotId === null,
        ),
    );

    const lateParticipant = finalMembership.participants.find(
      ({ sessionId }) => sessionId === 'session-reclaim-timeout',
    );
    expect(lateParticipant?.role).toBe('spectator');
    expect(finalMembership.slots['team-1']).toBe('replacement-player');
  }, 50_000);

  test('gives reconnecting session priority over spectator slot claim races', async () => {
    const host = connectClient({ sessionId: 'host-race' });
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    host.emit('room:create', {
      name: 'Reconnect Race Room',
      width: 50,
      height: 50,
    });
    const created = await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const player = connectClient({ sessionId: 'session-race-player' });
    await waitForEvent<RoomJoinedPayload>(player, 'room:joined');
    player.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(player, 'room:joined');

    player.emit('room:claim-slot', { slotId: 'team-1' });
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'session-race-player',
    );

    player.disconnect();
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'session-race-player',
      10,
      1000,
    );

    const spectator = connectClient({ sessionId: 'session-race-spectator' });
    await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
    spectator.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');

    const reconnect = connectClient({ sessionId: 'session-race-player' });
    await waitForEvent<RoomJoinedPayload>(reconnect, 'room:joined');
    reconnect.emit('room:join', { roomId: created.roomId });
    spectator.emit('room:claim-slot', { slotId: 'team-1' });

    const raceError = await waitForEvent<RoomErrorPayload>(
      spectator,
      'room:error',
    );
    expect(raceError.reason).toBe('slot-held');

    const finalMembership = await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'session-race-player',
    );

    const reclaimed = finalMembership.participants.find(
      ({ sessionId }) => sessionId === 'session-race-player',
    );
    expect(reclaimed?.role).toBe('player');
    expect(finalMembership.slots['team-1']).toBe('session-race-player');
  });

  test('keeps newest socket authoritative when the same session reconnects twice', async () => {
    const host = connectClient({ sessionId: 'host-newest' });
    await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    host.emit('room:create', {
      name: 'Newest Session Room',
      width: 48,
      height: 48,
    });
    const created = await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

    const firstSocket = connectClient({ sessionId: 'session-newest-wins' });
    await waitForEvent<RoomJoinedPayload>(firstSocket, 'room:joined');
    firstSocket.emit('room:join', { roomId: created.roomId, slotId: 'team-1' });
    await waitForMembership(
      host,
      created.roomId,
      (payload) => payload.slots['team-1'] === 'session-newest-wins',
    );

    const newestSocket = connectClient({ sessionId: 'session-newest-wins' });
    await waitForEvent<RoomJoinedPayload>(newestSocket, 'room:joined');
    newestSocket.emit('room:join', { roomId: created.roomId });

    firstSocket.emit('room:set-ready', { ready: true });
    const staleError = await waitForEvent<RoomErrorPayload>(
      firstSocket,
      'room:error',
    );
    expect(staleError.reason).toBe('session-replaced');

    newestSocket.emit('room:set-ready', { ready: true });
    const readyMembership = await waitForMembership(
      newestSocket,
      created.roomId,
      (payload) =>
        payload.participants.some(
          ({ sessionId, ready }) =>
            sessionId === 'session-newest-wins' && ready,
        ),
    );

    expect(
      readyMembership.participants.filter(
        ({ sessionId }) => sessionId === 'session-newest-wins',
      ),
    ).toHaveLength(1);
  });
});
