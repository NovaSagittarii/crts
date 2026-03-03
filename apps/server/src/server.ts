import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

import express, { Express } from 'express';
import { Server as SocketIOServer, Socket } from 'socket.io';

import {
  LobbySessionCoordinator,
  RECONNECT_HOLD_MS,
  type PlayerSession,
} from './lobby-session.js';

import { LobbyRoom, type LobbyRejectionReason } from '#rts-engine';
import {
  type BuildPreviewPayload,
  type BuildPreviewRequestPayload,
  type BuildQueuePayload,
  type DestroyQueuePayload,
  type CellUpdatePayload as SocketCellUpdatePayload,
  type ChatSendPayload,
  type ClientToServerEvents,
  type DestroyOutcomePayload,
  type DestroyQueuedPayload,
  type LifecyclePreconditions,
  type MatchFinishedPayload,
  type PlacementTransformInput,
  type PlacementTransformOperation,
  type QueueBuildResult,
  type QueueDestroyResult,
  transitionMatchLifecycle,
  type PlayerProfilePayload,
  RtsEngine,
  type RoomClaimSlotPayload,
  type RoomCreatePayload,
  type BuildQueuedPayload,
  type BuildOutcomePayload,
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
} from '#rts-engine';

const DIST_CLIENT_DIR = path.join(process.cwd(), 'dist', 'client');
const DIST_CLIENT_INDEX_HTML = path.join(DIST_CLIENT_DIR, 'index.html');
const PLAYER_SLOT_IDS = ['team-1', 'team-2'] as const;
const COUNTDOWN_SECONDS = 3;
const MEMBERSHIP_RESYNC_INTERVAL_MS = 300;
const FINISHED_ROOM_RESYNC_INTERVAL_MS = 500;

type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

type SetIntervalHook = (
  callback: () => void,
  delayMs: number,
) => IntervalHandle;
type ClearIntervalHook = (timer: IntervalHandle) => void;
type SetTimeoutHook = (callback: () => void, delayMs: number) => TimeoutHandle;
type ClearTimeoutHook = (timer: TimeoutHandle) => void;

type ClientAssetsMode = 'optional' | 'strict';

export interface ServerOptions {
  port?: number;
  width?: number;
  height?: number;
  tickMs?: number;
  clientAssetsMode?: ClientAssetsMode;
  countdownSeconds?: number;
  reconnectHoldMs?: number;
  now?: () => number;
  setInterval?: SetIntervalHook;
  clearInterval?: ClearIntervalHook;
  setTimeout?: SetTimeoutHook;
  clearTimeout?: ClearTimeoutHook;
}

export type StatePayload = RoomStatePayload;

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;
type RoomListPayloadEntry = RoomListEntryPayload;
export type CellUpdatePayload = SocketCellUpdatePayload;

function configureStaticAssets(app: Express, mode: ClientAssetsMode): void {
  if (!fs.existsSync(DIST_CLIENT_INDEX_HTML)) {
    if (mode === 'strict') {
      throw new Error(
        `Missing built client assets at ${DIST_CLIENT_INDEX_HTML}. Run \`npm run build\` before starting the server.`,
      );
    }
    return;
  }

  app.use(express.static(DIST_CLIENT_DIR));
}

interface RuntimeRoom {
  state: RoomState;
  lobby: LobbyRoom;
  roomCode: string;
  revision: number;
  status: RoomStatus;
  countdownSecondsRemaining: number | null;
  countdownTimer: IntervalHandle | null;
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

function getRuntimeRoomId(room: RuntimeRoom): string {
  return RtsEngine.getRoomId(room.state);
}

function getRuntimeRoomName(room: RuntimeRoom): string {
  return RtsEngine.getRoomName(room.state);
}

function getRuntimeRoomWidth(room: RuntimeRoom): number {
  return RtsEngine.getRoomWidth(room.state);
}

function getRuntimeRoomHeight(room: RuntimeRoom): number {
  return RtsEngine.getRoomHeight(room.state);
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

function parseReconnectHoldMs(value: unknown): number {
  const holdMs = Number(value);
  if (!Number.isFinite(holdMs) || holdMs < 0) {
    return RECONNECT_HOLD_MS;
  }

  return Math.floor(holdMs);
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

const PLACEMENT_TRANSFORM_OPERATIONS = new Set<PlacementTransformOperation>([
  'rotate',
  'mirror-horizontal',
  'mirror-vertical',
]);

function parsePlacementTransformInput(
  value: unknown,
): PlacementTransformInput | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== 'object') {
    return null;
  }

  const operationsValue = (value as { operations?: unknown }).operations;
  if (!Array.isArray(operationsValue)) {
    return null;
  }

  const operations: PlacementTransformOperation[] = [];
  for (const candidate of operationsValue) {
    if (typeof candidate !== 'string') {
      return null;
    }
    if (
      !PLACEMENT_TRANSFORM_OPERATIONS.has(
        candidate as PlacementTransformOperation,
      )
    ) {
      return null;
    }
    operations.push(candidate as PlacementTransformOperation);
  }

  return { operations };
}

function parseBuildPayload(payload: unknown): BuildQueuePayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const templateIdValue = (payload as { templateId?: unknown }).templateId;
  const transform = parsePlacementTransformInput(
    (payload as { transform?: unknown }).transform,
  );
  if (transform === null) {
    return null;
  }

  return {
    templateId: typeof templateIdValue === 'string' ? templateIdValue : '',
    x: Number((payload as { x?: unknown }).x),
    y: Number((payload as { y?: unknown }).y),
    delayTicks:
      (payload as { delayTicks?: unknown }).delayTicks === undefined
        ? undefined
        : Number((payload as { delayTicks?: unknown }).delayTicks),
    transform,
  };
}

function parseDestroyPayload(payload: unknown): DestroyQueuePayload | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const structureKeyValue = (payload as { structureKey?: unknown })
    .structureKey;
  if (typeof structureKeyValue !== 'string') {
    return null;
  }

  const structureKey = structureKeyValue.trim();
  if (!structureKey) {
    return null;
  }

  return {
    structureKey,
    delayTicks:
      (payload as { delayTicks?: unknown }).delayTicks === undefined
        ? undefined
        : Number((payload as { delayTicks?: unknown }).delayTicks),
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
  const membershipResyncIntervalTicks = Math.max(
    1,
    Math.ceil(MEMBERSHIP_RESYNC_INTERVAL_MS / tickMs),
  );
  const finishedRoomResyncIntervalTicks = Math.max(
    1,
    Math.ceil(FINISHED_ROOM_RESYNC_INTERVAL_MS / tickMs),
  );
  const clientAssetsMode = options.clientAssetsMode ?? 'optional';
  const countdownSeconds =
    typeof options.countdownSeconds === 'number' &&
    Number.isFinite(options.countdownSeconds)
      ? Math.max(0, Math.floor(options.countdownSeconds))
      : COUNTDOWN_SECONDS;
  const reconnectHoldMs = parseReconnectHoldMs(options.reconnectHoldMs);
  const now = options.now ?? (() => Date.now());
  const setIntervalHook =
    options.setInterval ??
    ((callback, delayMs) => setInterval(callback, delayMs));
  const clearIntervalHook =
    options.clearInterval ?? ((timer) => clearInterval(timer));
  const setTimeoutHook =
    options.setTimeout ??
    ((callback, delayMs) => setTimeout(callback, delayMs));
  const clearTimeoutHook =
    options.clearTimeout ?? ((timer) => clearTimeout(timer));

  const app: Express = express();
  configureStaticAssets(app, clientAssetsMode);

  const httpServer = http.createServer(app);
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
  );

  const defaultRoomId = '1';
  let roomCounter = 2;
  let guestCounter = 1;

  const roomTemplates = RtsEngine.createDefaultTemplates();
  const rooms = new Map<string, RuntimeRoom>();

  function buildRuntimeRoom(roomState: RoomState): RuntimeRoom {
    const roomId = RtsEngine.getRoomId(roomState);
    return {
      state: roomState,
      lobby: LobbyRoom.create({
        roomId,
        slotIds: [...PLAYER_SLOT_IDS],
      }),
      roomCode: roomId,
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
      RtsEngine.createRoomState({
        id: defaultRoomId,
        name: 'Main Arena',
        width,
        height,
        templates: roomTemplates,
      }),
    ),
  );

  const sessionCoordinator = new LobbySessionCoordinator({
    holdMs: reconnectHoldMs,
    now,
    setTimeout: setTimeoutHook,
    clearTimeout: clearTimeoutHook,
  });

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
    const snapshot = room.lobby.snapshot();
    const slotIds = room.lobby.slotIds();
    const heldSlots: RoomMembershipPayload['heldSlots'] = {};

    for (const slotId of slotIds) {
      const sessionId = snapshot.slots[slotId];
      if (!sessionId) {
        heldSlots[slotId] = null;
        continue;
      }

      const hold = sessionCoordinator.getHold(sessionId);
      if (
        hold &&
        hold.roomId === getRuntimeRoomId(room) &&
        hold.slotId === slotId
      ) {
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
      roomId: getRuntimeRoomId(room),
      roomCode: room.roomCode,
      roomName: getRuntimeRoomName(room),
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
        const snapshot = room.lobby.snapshot();
        const players = snapshot.participants.filter(
          ({ role }) => role === 'player',
        ).length;

        return {
          roomId: getRuntimeRoomId(room),
          roomCode: room.roomCode,
          name: getRuntimeRoomName(room),
          width: getRuntimeRoomWidth(room),
          height: getRuntimeRoomHeight(room),
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
    io.to(roomChannel(getRuntimeRoomId(room))).emit(
      'state',
      RtsEngine.createRoomStatePayload(room.state),
    );
  }

  function emitBuildOutcomes(
    room: RuntimeRoom,
    outcomes: BuildOutcomePayload[],
  ): void {
    for (const outcome of outcomes) {
      io.to(roomChannel(getRuntimeRoomId(room))).emit('build:outcome', outcome);
    }
  }

  function emitDestroyOutcomes(
    room: RuntimeRoom,
    outcomes: DestroyOutcomePayload[],
  ): void {
    for (const outcome of outcomes) {
      io.to(roomChannel(getRuntimeRoomId(room))).emit(
        'destroy:outcome',
        outcome,
      );
    }
  }

  function emitMembership(room: RuntimeRoom, bumpRevision = true): void {
    if (bumpRevision) {
      room.revision += 1;
    }

    io.to(roomChannel(getRuntimeRoomId(room))).emit(
      'room:membership',
      buildMembershipPayload(room),
    );
  }

  function stopCountdown(room: RuntimeRoom): void {
    if (room.countdownTimer) {
      clearIntervalHook(room.countdownTimer);
      room.countdownTimer = null;
    }
    room.countdownSecondsRemaining = null;
  }

  function deleteRoomIfEmpty(room: RuntimeRoom): boolean {
    if (getRuntimeRoomId(room) === defaultRoomId) {
      return false;
    }

    if (room.lobby.participantCount() > 0) {
      return false;
    }

    stopCountdown(room);
    rooms.delete(getRuntimeRoomId(room));
    return true;
  }

  function roomError(
    socket: GameSocket,
    message: string,
    reason?: string,
    affordability?: AffordabilityMetadata,
  ): void {
    const payload: RoomErrorPayload = { message };
    if (reason) {
      payload.reason = reason;
    }
    if (affordability) {
      payload.needed = affordability.needed;
      payload.current = affordability.current;
      payload.deficit = affordability.deficit;
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
    const existingParticipant = room.lobby.getParticipant(sessionId);
    const wasPlayer = Boolean(existingParticipant?.role === 'player');

    room.lobby.leave(sessionId);
    if (wasPlayer) {
      RtsEngine.removePlayerFromRoom(room.state, sessionId);
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

    const previousRoomId = getRuntimeRoomId(room);

    const existingParticipant = room.lobby.getParticipant(session.id);
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
        roomId: getRuntimeRoomId(room),
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
      void socket.leave(roomChannel(getRuntimeRoomId(room)));
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
    if (session.roomId && session.roomId !== getRuntimeRoomId(room)) {
      leaveCurrentRoom(socket, session, {
        emitLeft: true,
        preserveHold: false,
      });
    }

    void socket.join(roomChannel(getRuntimeRoomId(room)));
    sessionCoordinator.clearHold(session.id);
    room.lobby.join({
      sessionId: session.id,
      displayName: session.name,
    });

    sessionCoordinator.setRoom(session.id, getRuntimeRoomId(room));

    const teamId = room.state.players.get(session.id)?.teamId ?? null;
    socket.emit('room:joined', {
      roomId: getRuntimeRoomId(room),
      roomCode: room.roomCode,
      roomName: getRuntimeRoomName(room),
      playerId: session.id,
      playerName: session.name,
      teamId,
      templates: RtsEngine.createTemplateSummaries(room.state.templates),
      state: RtsEngine.createRoomStatePayload(room.state),
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
      getRuntimeRoomId(room),
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

    const result = room.lobby.claimSlot(session.id, trimmedSlotId);
    if (!result.ok) {
      const mapped = mapLobbyReasonToError(
        result.reason ?? 'participant-not-found',
      );
      roomError(socket, mapped.message, mapped.reason);
      return;
    }

    if (!room.state.players.has(session.id)) {
      RtsEngine.addPlayerToRoom(room.state, session.id, session.name);
    }

    socket.emit('room:slot-claimed', {
      roomId: getRuntimeRoomId(room),
      slotId: trimmedSlotId,
      teamId: room.state.players.get(session.id)?.teamId ?? null,
    });

    emitMembership(room);
    emitRoomState(room);
    emitRoomList();
  }

  function allSlotsReady(room: RuntimeRoom): boolean {
    const snapshot = room.lobby.snapshot();
    const slotIds = room.lobby.slotIds();
    const bySession = new Map(
      snapshot.participants.map((participant) => [
        participant.sessionId,
        participant,
      ]),
    );

    for (const slotId of slotIds) {
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
    const snapshot = room.lobby.snapshot();
    const slotIds = room.lobby.slotIds();
    const assignedSessionIds = slotIds
      .map((slotId) => snapshot.slots[slotId])
      .filter(
        (sessionId): sessionId is string => typeof sessionId === 'string',
      );

    const hasRequiredPlayers =
      assignedSessionIds.length === slotIds.length &&
      new Set(assignedSessionIds).size === slotIds.length &&
      assignedSessionIds.every((sessionId) =>
        snapshot.participants.some(
          (participant) =>
            participant.sessionId === sessionId &&
            participant.role === 'player',
        ),
      );

    const allPlayersConnected =
      assignedSessionIds.length === slotIds.length &&
      assignedSessionIds.every((sessionId) =>
        sessionCoordinator.isSessionConnected(sessionId),
      );

    return {
      hasRequiredPlayers,
      allPlayersConnected,
      reconnectHoldPending: sessionCoordinator.hasPendingHoldForRoom(
        getRuntimeRoomId(room),
      ),
    };
  }

  function resetRoomStateForRestart(room: RuntimeRoom): void {
    const previousState = room.state;
    const snapshot = room.lobby.snapshot();
    const slotIds = room.lobby.slotIds();
    const participantBySession = new Map(
      snapshot.participants.map((participant) => [
        participant.sessionId,
        participant,
      ]),
    );

    const nextState = RtsEngine.createRoomState({
      id: RtsEngine.getRoomId(previousState),
      name: RtsEngine.getRoomName(previousState),
      width: RtsEngine.getRoomWidth(previousState),
      height: RtsEngine.getRoomHeight(previousState),
      templates: previousState.templates,
    });

    for (const slotId of slotIds) {
      const sessionId = snapshot.slots[slotId];
      if (!sessionId) {
        continue;
      }

      const displayName =
        sessionCoordinator.getSession(sessionId)?.name ??
        participantBySession.get(sessionId)?.displayName ??
        sessionId;
      RtsEngine.addPlayerToRoom(nextState, sessionId, displayName);
    }

    room.state = nextState;
    room.matchOutcome = null;
  }

  function emitMatchFinished(room: RuntimeRoom): void {
    if (!room.matchOutcome) {
      return;
    }

    io.to(roomChannel(getRuntimeRoomId(room))).emit('room:match-finished', {
      roomId: getRuntimeRoomId(room),
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
    room.countdownSecondsRemaining = countdownSeconds;
    emitMembership(room);
    emitRoomList();
    io.to(roomChannel(getRuntimeRoomId(room))).emit('room:countdown', {
      roomId: getRuntimeRoomId(room),
      secondsRemaining: room.countdownSecondsRemaining,
    });

    if (countdownSeconds <= 0) {
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
      io.to(roomChannel(getRuntimeRoomId(room))).emit('room:match-started', {
        roomId: getRuntimeRoomId(room),
      });
      return;
    }

    room.countdownTimer = setIntervalHook(() => {
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
        io.to(roomChannel(getRuntimeRoomId(room))).emit('room:match-started', {
          roomId: getRuntimeRoomId(room),
        });
        return;
      }

      room.countdownSecondsRemaining = next;
      emitMembership(room);
      io.to(roomChannel(getRuntimeRoomId(room))).emit('room:countdown', {
        roomId: getRuntimeRoomId(room),
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

  interface GameplayMutationGateResult {
    allowed: boolean;
    team: TeamState | null;
    reason?: 'not-player' | 'invalid-state' | 'defeated';
    message?: string;
  }

  function assertGameplayMutationAllowed(
    room: RuntimeRoom,
    sessionId: string,
  ): GameplayMutationGateResult {
    const team = getTeamForSession(room, sessionId);
    if (!team) {
      return {
        allowed: false,
        team: null,
        reason: 'not-player',
        message: 'Only assigned players can issue gameplay mutations',
      };
    }

    if (team.defeated) {
      return {
        allowed: false,
        team,
        reason: 'defeated',
        message: 'Defeated players are locked out of gameplay mutations',
      };
    }

    if (room.status !== 'active') {
      return {
        allowed: false,
        team,
        reason: 'invalid-state',
        message: 'Gameplay mutations are only allowed during active matches',
      };
    }

    return {
      allowed: true,
      team,
    };
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

    const gate = assertGameplayMutationAllowed(room, session.id);
    if (!gate.allowed) {
      roomError(
        socket,
        gate.message ?? 'Gameplay mutation rejected',
        gate.reason,
      );
      return;
    }

    if (!payload || typeof payload !== 'object') {
      roomError(socket, 'Invalid cell update payload', 'invalid-build');
      return;
    }

    const update = payload as CellUpdatePayload;
    if (
      !Number.isInteger(Number(update.x)) ||
      !Number.isInteger(Number(update.y))
    ) {
      roomError(socket, 'Invalid cell update payload', 'invalid-build');
      return;
    }

    roomError(
      socket,
      'Direct cell updates are disabled; use build:queue',
      'queue-only-mutation-path',
    );
  }

  function mapQueueBuildErrorReason(error?: string): string {
    switch (error) {
      case 'Insufficient resources':
        return 'insufficient-resources';
      case 'Unknown template':
        return 'unknown-template';
      case 'x and y must be integers':
        return 'invalid-coordinates';
      case 'Outside build zone - build closer to your structures.':
      case 'Placement is outside team territory':
        return 'outside-territory';
      case 'Template exceeds map size':
        return 'template-exceeds-map-size';
      case 'delayTicks must be an integer':
        return 'invalid-delay';
      case 'Team is defeated':
        return 'team-defeated';
      case 'Player is not in this room':
        return 'not-player';
      case 'Team is not available':
        return 'team-unavailable';
      default:
        return 'build-rejected';
    }
  }

  interface AffordabilityMetadata {
    needed: number;
    current: number;
    deficit: number;
  }

  function getAffordabilityMetadata(
    result: Pick<QueueBuildResult, 'needed' | 'current' | 'deficit'>,
  ): AffordabilityMetadata | undefined {
    if (
      typeof result.needed !== 'number' ||
      typeof result.current !== 'number' ||
      typeof result.deficit !== 'number'
    ) {
      return undefined;
    }

    return {
      needed: result.needed,
      current: result.current,
      deficit: result.deficit,
    };
  }

  function resolveQueueBuildRejectionReason(result: QueueBuildResult): string {
    if (result.reason) {
      return result.reason;
    }

    return mapQueueBuildErrorReason(result.error);
  }

  function resolveQueueDestroyRejectionReason(
    result: QueueDestroyResult,
  ): string {
    if (result.reason) {
      return result.reason;
    }

    return 'destroy-rejected';
  }

  function runQueueBuildProbe(
    roomState: RoomState,
    playerId: string,
    payload: BuildQueuePayload,
  ): QueueBuildResult {
    return RtsEngine.previewBuildPlacement(roomState, playerId, payload);
  }

  function derivePreviewAffordability(
    currentResources: number,
    previewResult: QueueBuildResult,
  ): Pick<
    BuildPreviewPayload,
    'affordable' | 'needed' | 'current' | 'deficit'
  > {
    if (
      typeof previewResult.affordable === 'boolean' &&
      typeof previewResult.needed === 'number' &&
      typeof previewResult.current === 'number' &&
      typeof previewResult.deficit === 'number'
    ) {
      return {
        affordable: previewResult.affordable,
        needed: previewResult.needed,
        current: previewResult.current,
        deficit: previewResult.deficit,
      };
    }

    return {
      affordable: previewResult.accepted,
      needed: 0,
      current: currentResources,
      deficit: 0,
    };
  }

  function createBuildPreviewPayload(
    roomId: string,
    teamId: number,
    request: BuildPreviewRequestPayload,
    previewResult: QueueBuildResult,
    affordability: Pick<
      BuildPreviewPayload,
      'affordable' | 'needed' | 'current' | 'deficit'
    >,
  ): BuildPreviewPayload {
    return {
      roomId,
      teamId,
      templateId: request.templateId,
      x: request.x,
      y: request.y,
      transform: previewResult.transform ?? {
        operations: [],
        matrix: {
          xx: 1,
          xy: 0,
          yx: 0,
          yy: 1,
        },
      },
      footprint: previewResult.footprint ?? [],
      illegalCells: previewResult.illegalCells ?? [],
      bounds: previewResult.bounds ?? {
        x: request.x,
        y: request.y,
        width: 0,
        height: 0,
      },
      ...affordability,
      reason: previewResult.accepted ? undefined : previewResult.reason,
    };
  }

  function createRoomFromPayload(payload: unknown): RuntimeRoom {
    const roomPayload = (payload ?? {}) as RoomCreatePayload;
    const roomId = roomCounter.toString();
    roomCounter += 1;

    const roomState = RtsEngine.createRoomState({
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
    rooms.set(getRuntimeRoomId(room), room);
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
        room.lobby.join({
          sessionId: session.id,
          displayName: nextName,
        });
        if (room.state.players.has(session.id)) {
          RtsEngine.renamePlayerInRoom(room.state, session.id, nextName);
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

      const result = room.lobby.setReady(session.id, ready);
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

      const hostSessionId = room.lobby.snapshot().hostSessionId;
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
            'not-ready',
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

      const hostSessionId = room.lobby.snapshot().hostSessionId;
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

      io.to(roomChannel(getRuntimeRoomId(room))).emit('chat:message', {
        roomId: getRuntimeRoomId(room),
        senderSessionId: session.id,
        senderName: session.name,
        message,
        timestamp: Date.now(),
      });
    });

    socket.on('build:preview', (payload: unknown) => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }

      const room = getRoomOrNull(session.roomId);
      if (!room) {
        roomError(socket, 'Join a room first', 'not-in-room');
        return;
      }

      const gate = assertGameplayMutationAllowed(room, session.id);
      if (!gate.allowed) {
        roomError(
          socket,
          gate.message ?? 'Gameplay mutation rejected',
          gate.reason,
        );
        return;
      }

      if (!gate.team) {
        roomError(
          socket,
          'Only assigned players can issue gameplay mutations',
          'not-player',
        );
        return;
      }

      const parsedPayload = parseBuildPayload(payload);
      if (!parsedPayload) {
        roomError(socket, 'Invalid build payload', 'invalid-build');
        return;
      }

      const previewRequest: BuildPreviewRequestPayload = {
        templateId: parsedPayload.templateId,
        x: parsedPayload.x,
        y: parsedPayload.y,
        transform: parsedPayload.transform,
      };

      const previewResult = runQueueBuildProbe(
        room.state,
        session.id,
        previewRequest,
      );
      const affordability = derivePreviewAffordability(
        gate.team.resources,
        previewResult,
      );

      const previewPayload = createBuildPreviewPayload(
        getRuntimeRoomId(room),
        gate.team.id,
        previewRequest,
        previewResult,
        affordability,
      );

      socket.emit('build:preview', previewPayload);
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

      const gate = assertGameplayMutationAllowed(room, session.id);
      if (!gate.allowed) {
        roomError(
          socket,
          gate.message ?? 'Gameplay mutation rejected',
          gate.reason,
        );
        return;
      }

      if (!gate.team) {
        roomError(
          socket,
          'Only assigned players can issue gameplay mutations',
          'not-player',
        );
        return;
      }

      const parsedPayload = parseBuildPayload(payload);
      if (!parsedPayload) {
        roomError(socket, 'Invalid build payload', 'invalid-build');
        return;
      }

      const result = RtsEngine.queueBuildEvent(
        room.state,
        session.id,
        parsedPayload,
      );

      if (!result.accepted) {
        const reason = resolveQueueBuildRejectionReason(result);
        roomError(
          socket,
          result.error ?? 'Build rejected',
          reason,
          reason === 'insufficient-resources'
            ? getAffordabilityMetadata(result)
            : undefined,
        );

        const previewRequest: BuildPreviewRequestPayload = {
          templateId: parsedPayload.templateId,
          x: parsedPayload.x,
          y: parsedPayload.y,
          transform: parsedPayload.transform,
        };
        const refreshedPreview = runQueueBuildProbe(
          room.state,
          session.id,
          previewRequest,
        );
        const refreshedAffordability = derivePreviewAffordability(
          gate.team.resources,
          refreshedPreview,
        );
        socket.emit(
          'build:preview',
          createBuildPreviewPayload(
            getRuntimeRoomId(room),
            gate.team.id,
            previewRequest,
            refreshedPreview,
            refreshedAffordability,
          ),
        );

        return;
      }

      const queued: BuildQueuedPayload = {
        eventId: result.eventId ?? -1,
        executeTick: result.executeTick ?? room.state.tick,
      };
      socket.emit('build:queued', queued);
    });

    socket.on('destroy:queue', (payload: unknown) => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }

      const room = getRoomOrNull(session.roomId);
      if (!room) {
        roomError(socket, 'Join a room first', 'not-in-room');
        return;
      }

      const gate = assertGameplayMutationAllowed(room, session.id);
      if (!gate.allowed) {
        roomError(
          socket,
          gate.message ?? 'Gameplay mutation rejected',
          gate.reason,
        );
        return;
      }

      const parsedPayload = parseDestroyPayload(payload);
      if (!parsedPayload) {
        roomError(socket, 'Invalid destroy payload', 'invalid-build');
        return;
      }

      const result = RtsEngine.queueDestroyEvent(
        room.state,
        session.id,
        parsedPayload,
      );
      if (!result.accepted) {
        const reason = resolveQueueDestroyRejectionReason(result);
        roomError(socket, result.error ?? 'Destroy rejected', reason);
        return;
      }

      const queued: DestroyQueuedPayload = {
        eventId: result.eventId ?? -1,
        executeTick: result.executeTick ?? room.state.tick,
        structureKey: result.structureKey ?? parsedPayload.structureKey,
        idempotent: Boolean(result.idempotent),
      };
      socket.emit('destroy:queued', queued);
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

  let interval: IntervalHandle | null = null;
  let tickCounter = 0;

  function getStatePayload(): StatePayload {
    const room = rooms.get(defaultRoomId);
    if (room) {
      return RtsEngine.createRoomStatePayload(room.state);
    }

    return {
      roomId: defaultRoomId,
      roomName: 'Main Arena',
      width,
      height,
      generation: 0,
      tick: 0,
      grid: new ArrayBuffer(Math.ceil((width * height) / 8)),
      teams: [],
    };
  }

  function tick(): void {
    tickCounter += 1;
    const emitMembershipResync =
      tickCounter % membershipResyncIntervalTicks === 0;
    const emitFinishedRoomResync =
      tickCounter % finishedRoomResyncIntervalTicks === 0;

    for (const room of rooms.values()) {
      if (room.status === 'active') {
        const tickResult = RtsEngine.tickRoom(room.state);
        const buildOutcomes: BuildOutcomePayload[] =
          tickResult.buildOutcomes.map((outcome) => ({
            ...outcome,
            roomId: getRuntimeRoomId(room),
          }));
        const destroyOutcomes: DestroyOutcomePayload[] =
          tickResult.destroyOutcomes.map((outcome) => ({
            ...outcome,
            roomId: getRuntimeRoomId(room),
          }));
        emitBuildOutcomes(room, buildOutcomes);
        emitDestroyOutcomes(room, destroyOutcomes);

        if (tickResult.outcome) {
          const transition = transitionMatchLifecycle(room.status, 'finish');
          if (transition.allowed) {
            room.status = transition.nextStatus;
            room.matchOutcome = {
              roomId: getRuntimeRoomId(room),
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

      if (room.lobby.participantCount() > 0) {
        if (room.status === 'active') {
          emitRoomState(room);
        } else if (room.status === 'finished' && emitFinishedRoomResync) {
          emitRoomState(room);
        }

        // Re-emit authoritative snapshots on a heartbeat for late listeners.
        if (emitMembershipResync) {
          emitMembership(room, false);
        }

        if (room.status === 'finished' && emitFinishedRoomResync) {
          emitMatchFinished(room);
        }
      }
    }
  }

  async function start(): Promise<number> {
    return new Promise((resolve) => {
      httpServer.listen(port, () => {
        interval = setIntervalHook(tick, tickMs);
        const address = httpServer.address();
        const resolvedPort =
          typeof address === 'object' && address !== null ? address.port : port;
        resolve(resolvedPort);
      });
    });
  }

  async function stop(): Promise<void> {
    if (interval) {
      clearIntervalHook(interval);
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
  try {
    const server = createServer({ port, clientAssetsMode: 'strict' });
    void server
      .start()
      .then((resolvedPort) => {
        console.log(`Server listening on http://0.0.0.0:${resolvedPort}`);
      })
      .catch((error: unknown) => {
        console.error('Failed to start server', error);
        process.exitCode = 1;
      });
  } catch (error) {
    console.error('Failed to start server', error);
    process.exitCode = 1;
  }
}
