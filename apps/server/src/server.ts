import http from 'node:http';
import path from 'node:path';

import express, { Express } from 'express';
import { Server as SocketIOServer, Socket } from 'socket.io';

import {
  LobbySessionCoordinator,
  type PlayerSession,
} from './lobby-session.js';

import type { CellUpdate } from '#conway-core';
import {
  claimLobbySlot,
  createLobbyRoom,
  getLobbySnapshot,
  joinLobby,
  leaveLobby,
  setLobbyReady,
  type LobbyRejectionReason,
  type LobbyRoomState,
} from '#rts-engine';
import {
  addPlayerToRoom,
  type CellUpdatePayload as SocketCellUpdatePayload,
  type ChatSendPayload,
  type ClientToServerEvents,
  type LifecyclePreconditions,
  type MatchFinishedPayload,
  createDefaultTemplates,
  createRoomState,
  createRoomStatePayload,
  createTemplateSummaries,
  transitionMatchLifecycle,
  type PlayerProfilePayload,
  queueBuildEvent,
  queueLegacyCellUpdate,
  removePlayerFromRoom,
  renamePlayerInRoom,
  type RoomClaimSlotPayload,
  type RoomCreatePayload,
  type BuildQueuedPayload,
  type RoomErrorPayload,
  type RoomJoinPayload,
  type RoomListEntryPayload,
  type RoomMembershipPayload,
  type RoomSetReadyPayload,
  type RoomStartPayload,
  type RoomState,
  type RoomStatePayload,
  type RoomStatus,
  type ServerToClientEvents,
  type TeamState,
  tickRoom,
} from '#rts-engine';

const DIST_CLIENT_DIR = path.join(process.cwd(), 'dist', 'client');
const WEB_APP_DIR = path.join(process.cwd(), 'apps', 'web');
const PLAYER_SLOT_IDS = ['team-1', 'team-2'] as const;
const COUNTDOWN_SECONDS = 3;

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

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type RoomListPayloadEntry = RoomListEntryPayload;
export type CellUpdatePayload = SocketCellUpdatePayload;

interface RuntimeRoom {
  state: RoomState;
  lobby: LobbyRoomState;
  roomCode: string;
  revision: number;
  status: RoomStatus;
  countdownSecondsRemaining: number | null;
  countdownTimer: NodeJS.Timeout | null;
  matchOutcome: MatchFinishedPayload | null;
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

function parseRoomIdentifier(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (typeof value === 'number' && Number.isInteger(value)) {
    return value.toString();
  }

  return null;
}

function parseReadyPayload(payload: unknown): boolean | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const value = (payload as Partial<RoomSetReadyPayload>).ready;
  return typeof value === 'boolean' ? value : null;
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

function sanitizeChatMessage(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.slice(0, 280);
}

function mapLobbyReasonToError(reason: LobbyRejectionReason): RoomErrorPayload {
  if (reason === 'slot-full') {
    return {
      reason,
      message: 'Selected team slot is already full',
    };
  }

  if (reason === 'team-switch-locked') {
    return {
      reason,
      message: 'Team switching is locked after a slot is claimed',
    };
  }

  if (reason === 'not-player') {
    return {
      reason,
      message: 'Only assigned players can toggle readiness',
    };
  }

  if (reason === 'invalid-slot') {
    return {
      reason,
      message: 'Selected team slot does not exist',
    };
  }

  return {
    reason,
    message: 'Room request rejected',
  };
}

export function createServer(options: ServerOptions = {}): GameServer {
  const port = options.port ?? 3000;
  const width = options.width ?? 100;
  const height = options.height ?? 100;
  const tickMs = options.tickMs ?? 100;

  const app: Express = express();
  app.use(express.static(getStaticDir()));
  app.use(express.static(WEB_APP_DIR));

  const httpServer = http.createServer(app);
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
  );

  const defaultRoomId = '1';
  let roomCounter = 2;
  let guestCounter = 1;

  const roomTemplates = createDefaultTemplates();
  const rooms = new Map<string, RuntimeRoom>();

  function buildRuntimeRoom(roomState: RoomState): RuntimeRoom {
    return {
      state: roomState,
      lobby: createLobbyRoom({
        roomId: roomState.id,
        slotIds: [...PLAYER_SLOT_IDS],
      }),
      roomCode: roomState.id,
      revision: 0,
      status: 'lobby',
      countdownSecondsRemaining: null,
      countdownTimer: null,
      matchOutcome: null,
    };
  }

  rooms.set(
    defaultRoomId,
    buildRuntimeRoom(
      createRoomState({
        id: defaultRoomId,
        name: 'Main Arena',
        width,
        height,
        templates: roomTemplates,
      }),
    ),
  );

  const sessionCoordinator = new LobbySessionCoordinator();

  function getRoomOrNull(roomId: string | null): RuntimeRoom | null {
    if (!roomId) {
      return null;
    }
    return rooms.get(roomId) ?? null;
  }

  function getRoomByIdentifier(payload: unknown): RuntimeRoom | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }

    const joinPayload = payload as RoomJoinPayload;
    const identifier =
      parseRoomIdentifier(joinPayload.roomId) ??
      parseRoomIdentifier(joinPayload.roomCode);
    if (!identifier) {
      return null;
    }

    const byId = rooms.get(identifier);
    if (byId) {
      return byId;
    }

    for (const room of rooms.values()) {
      if (room.roomCode === identifier) {
        return room;
      }
    }

    return null;
  }

  function buildMembershipPayload(room: RuntimeRoom): RoomMembershipPayload {
    const snapshot = getLobbySnapshot(room.lobby);
    const heldSlots: RoomMembershipPayload['heldSlots'] = {};

    for (const slotId of room.lobby.slotIds) {
      const sessionId = snapshot.slots[slotId];
      if (!sessionId) {
        heldSlots[slotId] = null;
        continue;
      }

      const hold = sessionCoordinator.getHold(sessionId);
      if (hold && hold.roomId === room.state.id && hold.slotId === slotId) {
        heldSlots[slotId] = {
          sessionId,
          holdExpiresAt: hold.expiresAt,
          disconnectReason: hold.disconnectReason,
        };
        continue;
      }

      heldSlots[slotId] = null;
    }

    return {
      roomId: room.state.id,
      roomCode: room.roomCode,
      roomName: room.state.name,
      revision: room.revision,
      status: room.status,
      hostSessionId: snapshot.hostSessionId,
      slots: snapshot.slots,
      participants: snapshot.participants.map((participant) => {
        const participantSession = sessionCoordinator.getSession(
          participant.sessionId,
        );
        const hold = sessionCoordinator.getHold(participant.sessionId);
        const disconnected =
          participantSession !== null && !participantSession.connected;
        const held =
          disconnected && Boolean(hold && hold.roomId === room.state.id);

        return {
          sessionId: participant.sessionId,
          displayName: participant.displayName,
          role: participant.role,
          slotId: participant.slotId,
          ready: participant.ready,
          connectionStatus: disconnected ? 'held' : 'connected',
          holdExpiresAt: disconnected ? (hold?.expiresAt ?? null) : null,
          disconnectReason: disconnected
            ? (participantSession?.disconnectReason ??
              hold?.disconnectReason ??
              null)
            : null,
        };
      }),
      heldSlots,
      countdownSecondsRemaining: room.countdownSecondsRemaining,
    };
  }

  function emitRoomList(target?: GameSocket): void {
    const payload = [...rooms.values()]
      .map((room): RoomListPayloadEntry => {
        const snapshot = getLobbySnapshot(room.lobby);
        const players = snapshot.participants.filter(
          ({ role }) => role === 'player',
        ).length;

        return {
          roomId: room.state.id,
          roomCode: room.roomCode,
          name: room.state.name,
          width: room.state.width,
          height: room.state.height,
          players,
          spectators: snapshot.participants.length - players,
          teams: room.state.teams.size,
          status: room.status,
        };
      })
      .sort((a, b) =>
        a.roomId.localeCompare(b.roomId, undefined, { numeric: true }),
      );

    if (target) {
      target.emit('room:list', payload);
      return;
    }
    io.emit('room:list', payload);
  }

  function emitRoomState(room: RuntimeRoom): void {
    io.to(roomChannel(room.state.id)).emit(
      'state',
      createRoomStatePayload(room.state),
    );
  }

  function emitMembership(room: RuntimeRoom, bumpRevision = true): void {
    if (bumpRevision) {
      room.revision += 1;
    }

    io.to(roomChannel(room.state.id)).emit(
      'room:membership',
      buildMembershipPayload(room),
    );
  }

  function stopCountdown(room: RuntimeRoom): void {
    if (room.countdownTimer) {
      clearInterval(room.countdownTimer);
      room.countdownTimer = null;
    }
    room.countdownSecondsRemaining = null;
  }

  function deleteRoomIfEmpty(room: RuntimeRoom): boolean {
    if (room.state.id === defaultRoomId) {
      return false;
    }

    if (room.lobby.participants.size > 0) {
      return false;
    }

    stopCountdown(room);
    rooms.delete(room.state.id);
    return true;
  }

  function roomError(
    socket: GameSocket,
    message: string,
    reason?: string,
  ): void {
    const payload: RoomErrorPayload = { message };
    if (reason) {
      payload.reason = reason;
    }
    socket.emit('room:error', payload);
  }

  function ensureCurrentSocket(
    socket: GameSocket,
    session: PlayerSession,
  ): boolean {
    if (sessionCoordinator.isCurrentSocket(session.id, socket.id)) {
      return true;
    }

    roomError(
      socket,
      'This session is controlled by a newer connection',
      'session-replaced',
    );
    return false;
  }

  function removeSessionFromRoom(
    room: RuntimeRoom,
    sessionId: string,
  ): boolean {
    const existingParticipant = room.lobby.participants.get(sessionId);
    const wasPlayer = Boolean(existingParticipant?.role === 'player');

    leaveLobby(room.lobby, sessionId);
    if (wasPlayer) {
      removePlayerFromRoom(room.state, sessionId);
    }

    return wasPlayer;
  }

  function finalizeDeparture(room: RuntimeRoom, wasPlayer: boolean): void {
    const deleted = deleteRoomIfEmpty(room);
    if (!deleted) {
      emitMembership(room);
      if (wasPlayer) {
        emitRoomState(room);
      }
    }

    emitRoomList();
  }

  function expireHeldSession(holdSessionId: string, roomId: string): void {
    const room = rooms.get(roomId);
    if (!room) {
      sessionCoordinator.setRoom(holdSessionId, null);
      sessionCoordinator.pruneSession(holdSessionId);
      return;
    }

    if (room.status === 'active') {
      emitMembership(room);
      emitRoomList();
      return;
    }

    const wasPlayer = removeSessionFromRoom(room, holdSessionId);
    sessionCoordinator.setRoom(holdSessionId, null);
    finalizeDeparture(room, wasPlayer);
    sessionCoordinator.pruneSession(holdSessionId);
  }

  interface LeaveCurrentRoomOptions {
    emitLeft: boolean;
    preserveHold: boolean;
    disconnectReason?: string | null;
  }

  function leaveCurrentRoom(
    socket: GameSocket,
    session: PlayerSession,
    options: LeaveCurrentRoomOptions,
  ): void {
    const room = getRoomOrNull(session.roomId);
    if (!room) {
      sessionCoordinator.setRoom(session.id, null);
      if (options.preserveHold) {
        sessionCoordinator.markSocketDisconnected(session.id, socket.id);
      }
      if (options.emitLeft) {
        socket.emit('room:left', { roomId: null });
      }
      return;
    }

    const previousRoomId = room.state.id;

    const existingParticipant = room.lobby.participants.get(session.id);
    const heldSlotId =
      existingParticipant?.role === 'player'
        ? existingParticipant.slotId
        : null;

    if (options.preserveHold && heldSlotId) {
      if (room.status === 'active') {
        sessionCoordinator.markSocketDisconnected(
          session.id,
          socket.id,
          options.disconnectReason ?? null,
        );
        emitMembership(room);
        emitRoomList();
        return;
      }

      sessionCoordinator.holdOnDisconnect({
        sessionId: session.id,
        socketId: socket.id,
        roomId: room.state.id,
        slotId: heldSlotId,
        disconnectReason: options.disconnectReason ?? null,
        onExpire: (hold) => {
          expireHeldSession(hold.sessionId, hold.roomId);
        },
      });

      emitMembership(room);
      emitRoomList();
      return;
    }

    if (options.preserveHold) {
      sessionCoordinator.markSocketDisconnected(
        session.id,
        socket.id,
        options.disconnectReason ?? null,
      );
    } else {
      void socket.leave(roomChannel(room.state.id));
    }

    const wasPlayer = removeSessionFromRoom(room, session.id);
    sessionCoordinator.clearHold(session.id);
    sessionCoordinator.setRoom(session.id, null);

    if (options.emitLeft) {
      socket.emit('room:left', {
        roomId: previousRoomId,
      });
    }

    finalizeDeparture(room, wasPlayer);
    sessionCoordinator.pruneSession(session.id);
  }

  function joinRoom(
    socket: GameSocket,
    session: PlayerSession,
    room: RuntimeRoom,
  ): void {
    if (session.roomId && session.roomId !== room.state.id) {
      leaveCurrentRoom(socket, session, {
        emitLeft: true,
        preserveHold: false,
      });
    }

    void socket.join(roomChannel(room.state.id));
    sessionCoordinator.clearHold(session.id);
    joinLobby(room.lobby, {
      sessionId: session.id,
      displayName: session.name,
    });

    sessionCoordinator.setRoom(session.id, room.state.id);

    const teamId = room.state.players.get(session.id)?.teamId ?? null;
    socket.emit('room:joined', {
      roomId: room.state.id,
      roomCode: room.roomCode,
      roomName: room.state.name,
      playerId: session.id,
      playerName: session.name,
      teamId,
      templates: createTemplateSummaries(room.state.templates),
      state: createRoomStatePayload(room.state),
    });

    emitMembership(room);
    emitRoomList();
  }

  function tryClaimSlot(
    socket: GameSocket,
    session: PlayerSession,
    payload: unknown,
  ): void {
    const room = getRoomOrNull(session.roomId);
    if (!room) {
      roomError(socket, 'Join a room first', 'not-in-room');
      return;
    }

    if (room.status !== 'lobby') {
      roomError(
        socket,
        'Slot claims are only available before match start',
        'match-started',
      );
      return;
    }

    if (!payload || typeof payload !== 'object') {
      roomError(socket, 'Invalid slot claim payload', 'invalid-slot');
      return;
    }

    const slotId = (payload as Partial<RoomClaimSlotPayload>).slotId;
    if (typeof slotId !== 'string' || !slotId.trim()) {
      roomError(socket, 'Invalid slot id', 'invalid-slot');
      return;
    }

    const trimmedSlotId = slotId.trim();
    const heldBySessionId = sessionCoordinator.getHeldSessionForSlot(
      room.state.id,
      trimmedSlotId,
    );
    if (heldBySessionId && heldBySessionId !== session.id) {
      roomError(
        socket,
        'Selected team slot is temporarily held for reconnect',
        'slot-held',
      );
      return;
    }

    const result = claimLobbySlot(room.lobby, session.id, trimmedSlotId);
    if (!result.ok) {
      const mapped = mapLobbyReasonToError(
        result.reason ?? 'participant-not-found',
      );
      roomError(socket, mapped.message, mapped.reason);
      return;
    }

    if (!room.state.players.has(session.id)) {
      addPlayerToRoom(room.state, session.id, session.name);
    }

    socket.emit('room:slot-claimed', {
      roomId: room.state.id,
      slotId: trimmedSlotId,
      teamId: room.state.players.get(session.id)?.teamId ?? null,
    });

    emitMembership(room);
    emitRoomState(room);
    emitRoomList();
  }

  function allSlotsReady(room: RuntimeRoom): boolean {
    const snapshot = getLobbySnapshot(room.lobby);
    const bySession = new Map(
      snapshot.participants.map((participant) => [
        participant.sessionId,
        participant,
      ]),
    );

    for (const slotId of room.lobby.slotIds) {
      const sessionId = snapshot.slots[slotId];
      if (!sessionId) {
        return false;
      }

      const participant = bySession.get(sessionId);
      if (!participant || participant.role !== 'player' || !participant.ready) {
        return false;
      }
    }

    return true;
  }

  function getLifecyclePreconditions(
    room: RuntimeRoom,
  ): LifecyclePreconditions {
    const snapshot = getLobbySnapshot(room.lobby);
    const assignedSessionIds = room.lobby.slotIds
      .map((slotId) => snapshot.slots[slotId])
      .filter(
        (sessionId): sessionId is string => typeof sessionId === 'string',
      );

    const hasRequiredPlayers =
      assignedSessionIds.length === room.lobby.slotIds.length &&
      new Set(assignedSessionIds).size === room.lobby.slotIds.length &&
      assignedSessionIds.every((sessionId) =>
        snapshot.participants.some(
          (participant) =>
            participant.sessionId === sessionId &&
            participant.role === 'player',
        ),
      );

    const allPlayersConnected =
      assignedSessionIds.length === room.lobby.slotIds.length &&
      assignedSessionIds.every((sessionId) =>
        sessionCoordinator.isSessionConnected(sessionId),
      );

    return {
      hasRequiredPlayers,
      allPlayersConnected,
      reconnectHoldPending: sessionCoordinator.hasPendingHoldForRoom(
        room.state.id,
      ),
    };
  }

  function resetRoomStateForRestart(room: RuntimeRoom): void {
    const previousState = room.state;
    const snapshot = getLobbySnapshot(room.lobby);
    const participantBySession = new Map(
      snapshot.participants.map((participant) => [
        participant.sessionId,
        participant,
      ]),
    );

    const nextState = createRoomState({
      id: previousState.id,
      name: previousState.name,
      width: previousState.width,
      height: previousState.height,
      templates: previousState.templates,
    });

    for (const slotId of room.lobby.slotIds) {
      const sessionId = snapshot.slots[slotId];
      if (!sessionId) {
        continue;
      }

      const displayName =
        sessionCoordinator.getSession(sessionId)?.name ??
        participantBySession.get(sessionId)?.displayName ??
        sessionId;
      addPlayerToRoom(nextState, sessionId, displayName);
    }

    room.state = nextState;
    room.matchOutcome = null;
  }

  function emitMatchFinished(room: RuntimeRoom): void {
    if (!room.matchOutcome) {
      return;
    }

    io.to(roomChannel(room.state.id)).emit('room:match-finished', {
      roomId: room.state.id,
      winner: room.matchOutcome.winner,
      ranked: room.matchOutcome.ranked,
      comparator: room.matchOutcome.comparator,
    });
  }

  function startCountdown(room: RuntimeRoom): void {
    if (room.countdownTimer) {
      return;
    }

    room.status = 'countdown';
    room.matchOutcome = null;
    room.countdownSecondsRemaining = COUNTDOWN_SECONDS;
    emitMembership(room);
    emitRoomList();
    io.to(roomChannel(room.state.id)).emit('room:countdown', {
      roomId: room.state.id,
      secondsRemaining: room.countdownSecondsRemaining,
    });

    room.countdownTimer = setInterval(() => {
      const next = (room.countdownSecondsRemaining ?? 1) - 1;
      if (next <= 0) {
        stopCountdown(room);
        const transition = transitionMatchLifecycle(
          room.status,
          'countdown-complete',
        );
        if (!transition.allowed) {
          return;
        }

        room.status = transition.nextStatus;
        emitMembership(room);
        emitRoomList();
        io.to(roomChannel(room.state.id)).emit('room:match-started', {
          roomId: room.state.id,
        });
        return;
      }

      room.countdownSecondsRemaining = next;
      emitMembership(room);
      io.to(roomChannel(room.state.id)).emit('room:countdown', {
        roomId: room.state.id,
        secondsRemaining: next,
      });
    }, 1000);
  }

  function getTeamForSession(
    room: RuntimeRoom,
    sessionId: string,
  ): TeamState | null {
    const player = room.state.players.get(sessionId);
    if (!player) {
      return null;
    }

    return room.state.teams.get(player.teamId) ?? null;
  }

  function handleCellUpdate(
    socket: GameSocket,
    session: PlayerSession,
    payload: unknown,
  ): void {
    const room = getRoomOrNull(session.roomId);
    if (!room) {
      return;
    }

    const team = getTeamForSession(room, session.id);
    if (!team) {
      return;
    }

    if (team.defeated) {
      roomError(
        socket,
        'Defeated players are locked out of gameplay mutations',
        'defeated',
      );
      return;
    }

    if (room.status !== 'active') {
      roomError(
        socket,
        'Gameplay mutations are only allowed during active matches',
        'invalid-state',
      );
      return;
    }

    const update = parseCellUpdate(payload);
    if (!update) {
      return;
    }

    if (
      update.x < 0 ||
      update.y < 0 ||
      update.x >= room.state.width ||
      update.y >= room.state.height
    ) {
      return;
    }

    queueLegacyCellUpdate(room.state, update);
  }

  function createRoomFromPayload(payload: unknown): RuntimeRoom {
    const roomPayload = (payload ?? {}) as RoomCreatePayload;
    const roomId = roomCounter.toString();
    roomCounter += 1;

    const roomState = createRoomState({
      id: roomId,
      name:
        typeof roomPayload.name === 'string' && roomPayload.name.trim()
          ? roomPayload.name.trim().slice(0, 32)
          : `Room ${roomId}`,
      width: parseRoomDimension(roomPayload.width, width),
      height: parseRoomDimension(roomPayload.height, height),
      templates: roomTemplates,
    });

    const room = buildRuntimeRoom(roomState);
    rooms.set(room.state.id, room);
    return room;
  }

  io.on('connection', (socket: GameSocket) => {
    const fallbackSessionId = `guest-${guestCounter}`;
    const fallbackName = `Player-${guestCounter}`;
    guestCounter += 1;

    const authPayload =
      socket.handshake.auth && typeof socket.handshake.auth === 'object'
        ? (socket.handshake.auth as { sessionId?: unknown })
        : {};

    const { session, replacedSocketId } = sessionCoordinator.attachSocket({
      requestedSessionId: authPayload.sessionId,
      fallbackSessionId,
      fallbackName,
      socketId: socket.id,
    });

    if (replacedSocketId) {
      const previousSocket = io.sockets.sockets.get(replacedSocketId);
      if (previousSocket) {
        roomError(
          previousSocket,
          'This session was replaced by a newer connection',
          'session-replaced',
        );
      }
    }

    const resumeRoom = getRoomOrNull(session.roomId);
    if (resumeRoom) {
      joinRoom(socket, session, resumeRoom);
    } else {
      const defaultRoom = rooms.get(defaultRoomId);
      if (defaultRoom) {
        joinRoom(socket, session, defaultRoom);
      }
    }

    emitRoomList(socket);
    const profilePayload: PlayerProfilePayload = {
      playerId: session.id,
      name: session.name,
    };
    socket.emit('player:profile', profilePayload);

    socket.on('player:set-name', (payload: unknown) => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }

      const fallback = session.name;
      const nextName =
        payload && typeof payload === 'object'
          ? sanitizePlayerName((payload as { name?: unknown }).name, fallback)
          : fallback;

      session.name = nextName;
      sessionCoordinator.setDisplayName(session.id, nextName);

      const room = getRoomOrNull(session.roomId);
      if (room) {
        joinLobby(room.lobby, {
          sessionId: session.id,
          displayName: nextName,
        });
        if (room.state.players.has(session.id)) {
          renamePlayerInRoom(room.state, session.id, nextName);
          emitRoomState(room);
        }
        emitMembership(room);
      }

      const profile: PlayerProfilePayload = {
        playerId: session.id,
        name: session.name,
      };
      socket.emit('player:profile', profile);
    });

    socket.on('room:list', () => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }
      emitRoomList(socket);
    });

    socket.on('room:create', (payload: unknown) => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }
      const room = createRoomFromPayload(payload);
      joinRoom(socket, session, room);
    });

    socket.on('room:join', (payload: unknown) => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }

      const room = getRoomByIdentifier(payload);
      if (!room) {
        roomError(socket, 'Room not found', 'room-not-found');
        return;
      }

      joinRoom(socket, session, room);

      if (payload && typeof payload === 'object') {
        const slotId = (payload as RoomJoinPayload).slotId;
        if (typeof slotId === 'string' && slotId.trim()) {
          tryClaimSlot(socket, session, { slotId });
        }
      }
    });

    socket.on('room:leave', () => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }
      leaveCurrentRoom(socket, session, {
        emitLeft: true,
        preserveHold: false,
      });
    });

    socket.on('room:claim-slot', (payload: unknown) => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }
      tryClaimSlot(socket, session, payload);
    });

    socket.on('room:set-ready', (payload: unknown) => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }

      const room = getRoomOrNull(session.roomId);
      if (!room) {
        roomError(socket, 'Join a room first', 'not-in-room');
        return;
      }

      const ready = parseReadyPayload(payload);
      if (ready === null) {
        roomError(socket, 'Invalid ready payload', 'invalid-ready');
        return;
      }

      if (room.status === 'countdown' && !ready) {
        roomError(
          socket,
          'Cannot toggle Not Ready while countdown is running',
          'countdown-locked',
        );
        return;
      }

      if (room.status === 'active' || room.status === 'finished') {
        roomError(
          socket,
          'Ready toggle is unavailable after match start',
          'match-started',
        );
        return;
      }

      const result = setLobbyReady(room.lobby, session.id, ready);
      if (!result.ok) {
        const mapped = mapLobbyReasonToError(
          result.reason ?? 'participant-not-found',
        );
        roomError(socket, mapped.message, mapped.reason);
        return;
      }

      emitMembership(room);
    });

    socket.on('room:start', (payload?: RoomStartPayload) => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }

      const room = getRoomOrNull(session.roomId);
      if (!room) {
        roomError(socket, 'Join a room first', 'not-in-room');
        return;
      }

      const hostSessionId = getLobbySnapshot(room.lobby).hostSessionId;
      if (hostSessionId !== session.id) {
        roomError(socket, 'Only the host can start the match', 'not-host');
        return;
      }

      const forceRequested = Boolean(payload?.force);
      const lifecycleEvent =
        room.status === 'finished' ? 'restart-countdown' : 'start-countdown';
      const transition = transitionMatchLifecycle(
        room.status,
        lifecycleEvent,
        getLifecyclePreconditions(room),
      );

      if (!transition.allowed) {
        if (transition.reason === 'start-preconditions-not-met') {
          roomError(
            socket,
            'Match start preconditions are not met',
            'start-preconditions-not-met',
          );
          return;
        }

        roomError(
          socket,
          'Match cannot transition from the current lifecycle state',
          'invalid-transition',
        );
        return;
      }

      if (lifecycleEvent === 'start-countdown' && !allSlotsReady(room)) {
        roomError(
          socket,
          forceRequested
            ? 'Force start is disabled when players are not ready'
            : 'Both player slots must be ready before starting',
          'not-ready',
        );
        return;
      }

      if (lifecycleEvent === 'restart-countdown') {
        resetRoomStateForRestart(room);
        emitRoomState(room);
      }

      room.status = transition.nextStatus;
      startCountdown(room);
    });

    socket.on('room:cancel-countdown', () => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }

      const room = getRoomOrNull(session.roomId);
      if (!room) {
        roomError(socket, 'Join a room first', 'not-in-room');
        return;
      }

      const hostSessionId = getLobbySnapshot(room.lobby).hostSessionId;
      if (hostSessionId !== session.id) {
        roomError(socket, 'Only the host can cancel countdown', 'not-host');
        return;
      }

      const transition = transitionMatchLifecycle(
        room.status,
        'cancel-countdown',
      );
      if (!transition.allowed) {
        roomError(
          socket,
          'Countdown can only be canceled while countdown is running',
          'invalid-transition',
        );
        return;
      }

      stopCountdown(room);
      room.status = transition.nextStatus;
      emitMembership(room);
      emitRoomList();
    });

    socket.on('chat:send', (payload: unknown) => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }

      const room = getRoomOrNull(session.roomId);
      if (!room) {
        roomError(socket, 'Join a room first', 'not-in-room');
        return;
      }

      const message =
        payload && typeof payload === 'object'
          ? sanitizeChatMessage((payload as ChatSendPayload).message)
          : null;

      if (!message) {
        roomError(socket, 'Chat message cannot be empty', 'invalid-chat');
        return;
      }

      io.to(roomChannel(room.state.id)).emit('chat:message', {
        roomId: room.state.id,
        senderSessionId: session.id,
        senderName: session.name,
        message,
        timestamp: Date.now(),
      });
    });

    socket.on('build:queue', (payload: unknown) => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }

      const room = getRoomOrNull(session.roomId);
      if (!room) {
        roomError(socket, 'Join a room first', 'not-in-room');
        return;
      }

      const team = getTeamForSession(room, session.id);
      if (!team) {
        roomError(
          socket,
          'Only assigned players can queue builds',
          'not-player',
        );
        return;
      }

      if (team.defeated) {
        roomError(
          socket,
          'Defeated players are locked out of gameplay mutations',
          'defeated',
        );
        return;
      }

      if (room.status !== 'active') {
        roomError(
          socket,
          'Gameplay mutations are only allowed during active matches',
          'invalid-state',
        );
        return;
      }

      if (!payload || typeof payload !== 'object') {
        roomError(socket, 'Invalid build payload', 'invalid-build');
        return;
      }

      const templateIdCandidate = (payload as { templateId?: unknown })
        .templateId;
      const result = queueBuildEvent(room.state, session.id, {
        templateId:
          typeof templateIdCandidate === 'string' ? templateIdCandidate : '',
        x: Number((payload as { x?: unknown }).x),
        y: Number((payload as { y?: unknown }).y),
        delayTicks:
          (payload as { delayTicks?: unknown }).delayTicks === undefined
            ? undefined
            : Number((payload as { delayTicks?: unknown }).delayTicks),
      });

      if (!result.accepted) {
        roomError(socket, result.error ?? 'Build rejected', 'build-rejected');
        return;
      }

      const queued: BuildQueuedPayload = {
        eventId: result.eventId ?? -1,
        executeTick: result.executeTick ?? room.state.tick,
      };
      socket.emit('build:queued', queued);
    });

    socket.on('cell:update', (payload: unknown) => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }
      handleCellUpdate(socket, session, payload);
    });

    socket.on('disconnect', (reason) => {
      if (!sessionCoordinator.isCurrentSocket(session.id, socket.id)) {
        return;
      }

      leaveCurrentRoom(socket, session, {
        emitLeft: false,
        preserveHold: true,
        disconnectReason: reason,
      });
    });
  });

  let interval: NodeJS.Timeout | null = null;

  function getStatePayload(): StatePayload {
    const room = rooms.get(defaultRoomId);
    if (room) {
      return createRoomStatePayload(room.state);
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
      if (room.status === 'active') {
        const tickResult = tickRoom(room.state);

        if (tickResult.outcome) {
          const transition = transitionMatchLifecycle(room.status, 'finish');
          if (transition.allowed) {
            room.status = transition.nextStatus;
            room.matchOutcome = {
              roomId: room.state.id,
              winner: tickResult.outcome.winner,
              ranked: tickResult.outcome.ranked,
              comparator: tickResult.outcome.comparator,
            };
            emitMembership(room);
            emitRoomList();
            emitMatchFinished(room);
          }
        }
      }

      if (room.lobby.participants.size > 0) {
        if (room.status === 'active' || room.status === 'finished') {
          emitRoomState(room);
        }
        // Re-emit authoritative membership snapshots so late listeners can resync.
        emitMembership(room, false);
        if (room.status === 'finished') {
          emitMatchFinished(room);
        }
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

    sessionCoordinator.stop();

    for (const room of rooms.values()) {
      stopCountdown(room);
    }

    return new Promise((resolve) => {
      void io.close();
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
  void server
    .start()
    .then((resolvedPort) => {
      console.log(`Server listening on http://0.0.0.0:${resolvedPort}`);
    })
    .catch((error: unknown) => {
      console.error('Failed to start server', error);
      process.exitCode = 1;
    });
}
