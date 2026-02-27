import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { Express } from 'express';
import { Server as SocketIOServer, Socket } from 'socket.io';

import type { CellUpdate } from './grid.js';
import {
  addPlayerToRoom,
  createDefaultTemplates,
  createRoomState,
  createRoomStatePayload,
  createTemplateSummaries,
  listRooms,
  queueBuildEvent,
  queueLegacyCellUpdate,
  removePlayerFromRoom,
  renamePlayerInRoom,
  RoomState,
  RoomStatePayload,
  tickRoom,
} from './rts.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_CLIENT_DIR = path.join(__dirname, '..', 'dist', 'client');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function getStaticDir(): string {
  return DIST_CLIENT_DIR;
}

export interface ServerOptions {
  port?: number;
  width?: number;
  height?: number;
  tickMs?: number;
}

export type StatePayload = RoomStatePayload;

export interface CellUpdatePayload {
  x: number;
  y: number;
  alive: boolean;
}

interface RoomCreatePayload {
  name?: string;
  width?: number;
  height?: number;
}

interface RoomJoinPayload {
  roomId: string | number;
}

interface BuildQueuedPayload {
  eventId: number;
  executeTick: number;
}

interface PlayerSession {
  id: string;
  name: string;
  roomId: string | null;
  teamId: number | null;
}

export interface GameServer {
  start(): Promise<number>;
  stop(): Promise<void>;
  getStatePayload(): StatePayload;
}

function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}

function sanitizePlayerName(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.slice(0, 24);
}

function parseRoomDimension(value: unknown, fallback: number): number {
  const num = Number(value);
  if (!Number.isInteger(num)) {
    return fallback;
  }
  return Math.max(24, Math.min(300, num));
}

function parseRoomId(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    return value.toString();
  }

  return null;
}

function parseCellUpdate(payload: unknown): CellUpdate | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const update = payload as CellUpdatePayload;
  const x = Number(update.x);
  const y = Number(update.y);

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return null;
  }

  return {
    x,
    y,
    alive: update.alive ? 1 : 0,
  };
}

export function createServer(options: ServerOptions = {}): GameServer {
  const port = options.port ?? 3000;
  const width = options.width ?? 100;
  const height = options.height ?? 100;
  const tickMs = options.tickMs ?? 100;

  const app: Express = express();
  app.use(express.static(getStaticDir()));
  app.use(express.static(PUBLIC_DIR));

  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer);

  const defaultRoomId = '1';
  let roomCounter = 2;
  let guestCounter = 1;

  const roomTemplates = createDefaultTemplates();
  const rooms = new Map<string, RoomState>();
  rooms.set(
    defaultRoomId,
    createRoomState({
      id: defaultRoomId,
      name: 'Main Arena',
      width,
      height,
      templates: roomTemplates,
    }),
  );

  const sessions = new Map<string, PlayerSession>();

  function getRoomOrNull(roomId: string | null): RoomState | null {
    if (!roomId) {
      return null;
    }
    return rooms.get(roomId) ?? null;
  }

  function emitRoomList(target?: Socket): void {
    const payload = listRooms(rooms);
    if (target) {
      target.emit('room:list', payload);
      return;
    }
    io.emit('room:list', payload);
  }

  function emitRoomState(room: RoomState): void {
    io.to(roomChannel(room.id)).emit('state', createRoomStatePayload(room));
  }

  function leaveCurrentRoom(socket: Socket, session: PlayerSession): void {
    const room = getRoomOrNull(session.roomId);
    if (!room) {
      session.roomId = null;
      session.teamId = null;
      return;
    }

    socket.leave(roomChannel(room.id));
    removePlayerFromRoom(room, session.id);

    const previousRoomId = room.id;
    session.roomId = null;
    session.teamId = null;

    if (room.players.size === 0 && room.id !== defaultRoomId) {
      rooms.delete(room.id);
    } else {
      emitRoomState(room);
    }

    socket.emit('room:left', {
      roomId: previousRoomId,
    });
    emitRoomList();
  }

  function joinRoom(
    socket: Socket,
    session: PlayerSession,
    room: RoomState,
  ): void {
    if (session.roomId) {
      leaveCurrentRoom(socket, session);
    }

    const team = addPlayerToRoom(room, session.id, session.name);
    session.roomId = room.id;
    session.teamId = team.id;

    socket.join(roomChannel(room.id));
    socket.emit('room:joined', {
      roomId: room.id,
      roomName: room.name,
      playerId: session.id,
      playerName: session.name,
      teamId: team.id,
      templates: createTemplateSummaries(room.templates),
      state: createRoomStatePayload(room),
    });

    emitRoomState(room);
    emitRoomList();
  }

  function createRoomFromPayload(payload: unknown): RoomState {
    const roomPayload = (payload ?? {}) as RoomCreatePayload;
    const roomId = roomCounter.toString();
    roomCounter += 1;

    const room = createRoomState({
      id: roomId,
      name:
        typeof roomPayload.name === 'string' && roomPayload.name.trim()
          ? roomPayload.name.trim().slice(0, 32)
          : `Room ${roomId}`,
      width: parseRoomDimension(roomPayload.width, width),
      height: parseRoomDimension(roomPayload.height, height),
      templates: roomTemplates,
    });
    rooms.set(room.id, room);
    return room;
  }

  function handleCellUpdate(session: PlayerSession, payload: unknown): void {
    const room = getRoomOrNull(session.roomId);
    if (!room) {
      return;
    }

    const update = parseCellUpdate(payload);
    if (!update) {
      return;
    }

    if (
      update.x < 0 ||
      update.y < 0 ||
      update.x >= room.width ||
      update.y >= room.height
    ) {
      return;
    }

    queueLegacyCellUpdate(room, update);
  }

  io.on('connection', (socket: Socket) => {
    const session: PlayerSession = {
      id: socket.id,
      name: `Player-${guestCounter}`,
      roomId: null,
      teamId: null,
    };
    guestCounter += 1;
    sessions.set(socket.id, session);

    const defaultRoom = rooms.get(defaultRoomId);
    if (defaultRoom) {
      joinRoom(socket, session, defaultRoom);
    }
    emitRoomList(socket);

    socket.on('player:set-name', (payload: unknown) => {
      const fallback = session.name;
      const nextName =
        payload && typeof payload === 'object'
          ? sanitizePlayerName((payload as { name?: unknown }).name, fallback)
          : fallback;

      session.name = nextName;
      const room = getRoomOrNull(session.roomId);
      if (room) {
        renamePlayerInRoom(room, session.id, nextName);
        emitRoomState(room);
      }
      socket.emit('player:profile', {
        playerId: session.id,
        name: session.name,
      });
    });

    socket.on('room:list', () => {
      emitRoomList(socket);
    });

    socket.on('room:create', (payload: unknown) => {
      const room = createRoomFromPayload(payload);
      joinRoom(socket, session, room);
    });

    socket.on('room:join', (payload: unknown) => {
      const roomId =
        payload && typeof payload === 'object'
          ? parseRoomId((payload as RoomJoinPayload).roomId)
          : null;
      if (!roomId) {
        socket.emit('room:error', { message: 'Invalid room id' });
        return;
      }

      const room = rooms.get(roomId);
      if (!room) {
        socket.emit('room:error', { message: 'Room not found' });
        return;
      }

      joinRoom(socket, session, room);
    });

    socket.on('room:leave', () => {
      leaveCurrentRoom(socket, session);
    });

    socket.on('build:queue', (payload: unknown) => {
      const room = getRoomOrNull(session.roomId);
      if (!room) {
        socket.emit('room:error', { message: 'Join a room first' });
        return;
      }

      if (!payload || typeof payload !== 'object') {
        socket.emit('room:error', { message: 'Invalid build payload' });
        return;
      }

      const result = queueBuildEvent(room, session.id, {
        templateId: String(
          (payload as { templateId?: unknown }).templateId ?? '',
        ),
        x: Number((payload as { x?: unknown }).x),
        y: Number((payload as { y?: unknown }).y),
        delayTicks:
          (payload as { delayTicks?: unknown }).delayTicks === undefined
            ? undefined
            : Number((payload as { delayTicks?: unknown }).delayTicks),
      });

      if (!result.accepted) {
        socket.emit('room:error', {
          message: result.error ?? 'Build rejected',
        });
        return;
      }

      const queued: BuildQueuedPayload = {
        eventId: result.eventId ?? -1,
        executeTick: result.executeTick ?? room.tick,
      };
      socket.emit('build:queued', queued);
    });

    socket.on('cell:update', (payload: unknown) => {
      handleCellUpdate(session, payload);
    });

    socket.on('disconnect', () => {
      leaveCurrentRoom(socket, session);
      sessions.delete(socket.id);
    });
  });

  let interval: NodeJS.Timeout | null = null;

  function getStatePayload(): StatePayload {
    const room = rooms.get(defaultRoomId);
    if (room) {
      return createRoomStatePayload(room);
    }

    return {
      roomId: defaultRoomId,
      roomName: 'Main Arena',
      width,
      height,
      generation: 0,
      tick: 0,
      grid: '',
      teams: [],
    };
  }

  function tick(): void {
    for (const room of rooms.values()) {
      tickRoom(room);
      if (room.players.size > 0) {
        emitRoomState(room);
      }
    }
  }

  async function start(): Promise<number> {
    return new Promise((resolve) => {
      httpServer.listen(port, () => {
        interval = setInterval(tick, tickMs);
        const address = httpServer.address();
        const resolvedPort =
          typeof address === 'object' && address !== null ? address.port : port;
        resolve(resolvedPort);
      });
    });
  }

  async function stop(): Promise<void> {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }

    return new Promise((resolve) => {
      io.close();
      httpServer.close(() => resolve());
    });
  }

  return {
    getStatePayload,
    start,
    stop,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || 3000;
  const server = createServer({ port });
  server.start().then((resolvedPort) => {
    console.log(`Server listening on http://0.0.0.0:${resolvedPort}`);
  });
}
