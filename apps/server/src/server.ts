import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express, { Express } from 'express';
import { Socket, Server as SocketIOServer } from 'socket.io';

import {
  type LobbyRejectionReason,
  LobbyRoom,
  type LobbySlotDefinition,
} from '#rts-engine';
import {
  type BuildOutcomePayload,
  type BuildQueuePayload,
  type BuildQueueRejectedPayload,
  type BuildQueueRejectedReason,
  type BuildQueuedPayload,
  type ChatSendPayload,
  type ClientToServerEvents,
  type DestroyOutcomePayload,
  type DestroyQueuePayload,
  type DestroyQueueRejectedPayload,
  type DestroyQueueRejectedReason,
  type DestroyQueuedPayload,
  type LifecyclePreconditions,
  type LockstepCheckpointPayload,
  type LockstepFallbackReason,
  type LockstepMode,
  type LockstepStatusPayload,
  type PlacementTransformInput,
  type PlacementTransformOperation,
  type PlayerProfilePayload,
  type QueueBuildResult,
  type QueueDestroyResult,
  type RoomClaimSlotPayload,
  type RoomCreatePayload,
  type RoomErrorPayload,
  type RoomGridStatePayload,
  type RoomJoinPayload,
  type RoomSetReadyPayload,
  type RoomSlotDefinitionPayload,
  type RoomStartPayload,
  type RoomStateHashesPayload,
  type RoomStatePayload,
  type RoomStructuresStatePayload,
  RtsEngine,
  type RtsRoom,
  type ServerToClientEvents,
  type StateRequestPayload,
  type StateRequestSection,
  type TeamState,
  transitionMatchLifecycle,
} from '#rts-engine';

import {
  LobbySessionCoordinator,
  type PlayerSession,
  RECONNECT_HOLD_MS,
} from './lobby-session.js';
import {
  RoomBroadcastService,
  type RuntimeBroadcastRoom,
} from './server-room-broadcast.js';

const DEFAULT_DIST_CLIENT_DIR = path.resolve(
  import.meta.dirname,
  '../../../dist/client',
);
const DEFAULT_SLOT_DEFINITIONS: readonly LobbySlotDefinition[] = [
  { id: 'team-1', capacity: 1 },
  { id: 'team-2', capacity: 1 },
];
const COUNTDOWN_SECONDS = 3;
const MEMBERSHIP_RESYNC_INTERVAL_MS = 300;
const FINISHED_ROOM_RESYNC_INTERVAL_MS = 500;
const DEFAULT_LOCKSTEP_TURN_TICKS = 1;
const DEFAULT_LOCKSTEP_CHECKPOINT_INTERVAL_TICKS = 4;
const DEFAULT_LOCKSTEP_MAX_BUFFERED_TURNS = 64;
const DEFAULT_ACTIVE_STATE_SNAPSHOT_INTERVAL_TICKS = 50;
const STATE_REQUEST_MIN_INTERVAL_MS = 100;

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
  clientAssetsDir?: string;
  countdownSeconds?: number;
  reconnectHoldMs?: number;
  lockstepMode?: LockstepMode;
  lockstepTurnTicks?: number;
  lockstepCheckpointIntervalTicks?: number;
  lockstepMaxBufferedCommands?: number;
  lockstepMaxBufferedTurns?: number;
  activeStateSnapshotIntervalTicks?: number;
  now?: () => number;
  setInterval?: SetIntervalHook;
  clearInterval?: ClearIntervalHook;
  setTimeout?: SetTimeoutHook;
  clearTimeout?: ClearTimeoutHook;
}

type GameSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

function configureStaticAssets(
  app: Express,
  mode: ClientAssetsMode,
  clientAssetsDir: string,
): void {
  const clientIndexHtmlPath = path.join(clientAssetsDir, 'index.html');

  if (!fs.existsSync(clientIndexHtmlPath)) {
    if (mode === 'strict') {
      throw new Error(
        `Missing built client assets at ${clientIndexHtmlPath}. Run \`npm run build\` before starting the server.`,
      );
    }
    return;
  }

  app.use(express.static(clientAssetsDir));
}

interface BufferedLockstepCommand {
  sequence: number;
  turn: number;
  intentId: string;
  bufferedTurn: number;
  scheduledByTurn: number;
  kind: 'build' | 'destroy';
  sessionId: string;
  teamId: number;
  payload: BuildQueuePayload | DestroyQueuePayload;
  expectedAccepted: boolean;
  expectedExecuteTick: number | null;
  expectedReason: string | null;
}

type LockstepRuntimeStatus = 'running' | 'fallback';

interface LockstepRuntimeState {
  mode: LockstepMode;
  status: LockstepRuntimeStatus;
  turnLengthTicks: number;
  checkpointIntervalTicks: number;
  maxBufferedCommands: number;
  nextTurn: number;
  nextSequence: number;
  nextIntentId: number;
  lastFlushedTurn: number;
  bufferedCommandCount: number;
  turnBuffer: Map<number, BufferedLockstepCommand[]>;
  shadowRoom: RtsRoom | null;
  mismatchCount: number;
  lastFallbackReason: LockstepFallbackReason | null;
  lastPrimaryHash: string | null;
  lastShadowHash: string | null;
  checkpoints: LockstepCheckpointPayload[];
}

interface StateRequestBudget {
  roomId: string;
  lastRequestedAtMs: number;
  lastServedHashes: Partial<Record<StateRequestSection, string>>;
}

interface RuntimeRoom extends RuntimeBroadcastRoom {
  countdownTimer: IntervalHandle | null;
  lockstepRuntime: LockstepRuntimeState;
}

export interface GameServer {
  start(): Promise<number>;
  stop(): Promise<void>;
  getStatePayload(): RoomStatePayload;
}

function roomChannel(roomId: string): string {
  return `room:${roomId}`;
}

function getRuntimeRoomId(room: RuntimeRoom): string {
  return room.rtsRoom.id;
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

function cloneSlotDefinitions(
  slotDefinitions: readonly LobbySlotDefinition[],
): LobbySlotDefinition[] {
  return slotDefinitions.map(({ id, capacity }) => ({ id, capacity }));
}

function parseRoomSlotDefinitions(value: unknown): LobbySlotDefinition[] {
  if (!Array.isArray(value) || value.length === 0) {
    return cloneSlotDefinitions(DEFAULT_SLOT_DEFINITIONS);
  }

  const seenSlotIds = new Set<string>();
  const definitions: LobbySlotDefinition[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      return cloneSlotDefinitions(DEFAULT_SLOT_DEFINITIONS);
    }

    const slotIdValue = (candidate as Partial<RoomSlotDefinitionPayload>)
      .slotId;
    const capacity = Number(
      (candidate as Partial<RoomSlotDefinitionPayload>).capacity,
    );
    if (typeof slotIdValue !== 'string') {
      return cloneSlotDefinitions(DEFAULT_SLOT_DEFINITIONS);
    }

    const slotId = slotIdValue.trim();
    if (!slotId || !Number.isInteger(capacity) || capacity < 1) {
      return cloneSlotDefinitions(DEFAULT_SLOT_DEFINITIONS);
    }

    if (seenSlotIds.has(slotId)) {
      return cloneSlotDefinitions(DEFAULT_SLOT_DEFINITIONS);
    }

    seenSlotIds.add(slotId);
    definitions.push({ id: slotId, capacity });
  }

  return definitions;
}

function getSlotTeamName(slotId: string): string {
  const normalized = slotId.trim();
  const numberedTeamMatch = /^team-(\d+)$/i.exec(normalized);
  if (numberedTeamMatch) {
    return `Team ${numberedTeamMatch[1]}`;
  }

  return normalized;
}

function parseReconnectHoldMs(value: unknown): number {
  const holdMs = Number(value);
  if (!Number.isFinite(holdMs) || holdMs < 0) {
    return RECONNECT_HOLD_MS;
  }

  return Math.floor(holdMs);
}

function parseLockstepMode(value: unknown): LockstepMode {
  if (value === 'shadow' || value === 'primary') {
    return value;
  }

  return 'off';
}

function parseBoundedInteger(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
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
      roomId: null,
      reason,
      message: 'Selected team slot is already full',
    };
  }

  if (reason === 'team-switch-locked') {
    return {
      roomId: null,
      reason,
      message: 'Team switching is locked after a slot is claimed',
    };
  }

  if (reason === 'not-player') {
    return {
      roomId: null,
      reason,
      message: 'Only assigned players can toggle readiness',
    };
  }

  if (reason === 'invalid-slot') {
    return {
      roomId: null,
      reason,
      message: 'Selected team slot does not exist',
    };
  }

  return {
    roomId: null,
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
  const clientAssetsDir = options.clientAssetsDir ?? DEFAULT_DIST_CLIENT_DIR;
  const countdownSeconds =
    typeof options.countdownSeconds === 'number' &&
    Number.isFinite(options.countdownSeconds)
      ? Math.max(0, Math.floor(options.countdownSeconds))
      : COUNTDOWN_SECONDS;
  const reconnectHoldMs = parseReconnectHoldMs(options.reconnectHoldMs);
  const lockstepMode = parseLockstepMode(options.lockstepMode);
  const lockstepTurnTicks = parseBoundedInteger(
    options.lockstepTurnTicks,
    DEFAULT_LOCKSTEP_TURN_TICKS,
    1,
    60,
  );
  const lockstepCheckpointIntervalTicks = parseBoundedInteger(
    options.lockstepCheckpointIntervalTicks,
    DEFAULT_LOCKSTEP_CHECKPOINT_INTERVAL_TICKS,
    1,
    240,
  );
  const lockstepMaxBufferedCommands = parseBoundedInteger(
    options.lockstepMaxBufferedCommands ?? options.lockstepMaxBufferedTurns,
    DEFAULT_LOCKSTEP_MAX_BUFFERED_TURNS,
    4,
    512,
  );
  const activeStateSnapshotIntervalTicks = parseBoundedInteger(
    options.activeStateSnapshotIntervalTicks,
    DEFAULT_ACTIVE_STATE_SNAPSHOT_INTERVAL_TICKS,
    1,
    1000,
  );
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
  configureStaticAssets(app, clientAssetsMode, clientAssetsDir);

  const httpServer = http.createServer(app);
  const io = new SocketIOServer<ClientToServerEvents, ServerToClientEvents>(
    httpServer,
  );

  const defaultRoomId = '1';
  let roomCounter = 2;
  let guestCounter = 1;

  const roomTemplates = RtsEngine.createDefaultTemplates();
  const rooms = new Map<string, RuntimeRoom>();
  const stateRequestBudgetBySession = new Map<string, StateRequestBudget>();

  function createLockstepRuntimeState(): LockstepRuntimeState {
    return {
      mode: lockstepMode,
      status: 'running',
      turnLengthTicks: lockstepTurnTicks,
      checkpointIntervalTicks: lockstepCheckpointIntervalTicks,
      maxBufferedCommands: lockstepMaxBufferedCommands,
      nextTurn: 0,
      nextSequence: 0,
      nextIntentId: 0,
      lastFlushedTurn: -1,
      bufferedCommandCount: 0,
      turnBuffer: new Map(),
      shadowRoom: null,
      mismatchCount: 0,
      lastFallbackReason: null,
      lastPrimaryHash: null,
      lastShadowHash: null,
      checkpoints: [],
    };
  }

  function toLockstepStatusPayload(
    lockstepRuntime: LockstepRuntimeState,
  ): LockstepStatusPayload {
    return {
      mode: lockstepRuntime.mode,
      status: lockstepRuntime.status,
      turnLengthTicks: lockstepRuntime.turnLengthTicks,
      nextTurn: lockstepRuntime.nextTurn,
      bufferedTurnCount: lockstepRuntime.turnBuffer.size,
      mismatchCount: lockstepRuntime.mismatchCount,
      lastFallbackReason: lockstepRuntime.lastFallbackReason ?? undefined,
      lastPrimaryHash: lockstepRuntime.lastPrimaryHash ?? undefined,
      lastShadowHash: lockstepRuntime.lastShadowHash ?? undefined,
    };
  }

  function resetLockstepRuntime(room: RuntimeRoom): void {
    room.lockstepRuntime = createLockstepRuntimeState();
    room.lockstep = toLockstepStatusPayload(room.lockstepRuntime);
  }

  function clearStateRequestBudget(sessionId: string): void {
    stateRequestBudgetBySession.delete(sessionId);
  }

  function normalizeStateRequestSections(
    payload?: StateRequestPayload,
  ): StateRequestSection[] {
    const requested = payload?.sections ?? ['full'];
    const unique = new Set<StateRequestSection>();

    for (const section of requested) {
      if (
        section === 'full' ||
        section === 'grid' ||
        section === 'structures' ||
        section === 'membership'
      ) {
        unique.add(section);
      }
    }

    if (unique.size === 0) {
      unique.add('full');
    }

    return [...unique];
  }

  function createStateHashesPayload(room: RuntimeRoom): RoomStateHashesPayload {
    return roomBroadcast.buildStateHashesPayload(room);
  }

  function getRequestedSectionHash(
    hashes: RoomStateHashesPayload,
    section: StateRequestSection,
  ): string {
    switch (section) {
      case 'grid':
        return hashes.gridHash;
      case 'structures':
        return hashes.structuresHash;
      case 'membership':
        return hashes.roomMembershipHash;
      case 'full':
      default:
        return `${hashes.gridHash}:${hashes.structuresHash}:${hashes.roomMembershipHash}`;
    }
  }

  function shouldServeStateRequest(
    sessionId: string,
    room: RuntimeRoom,
    sections: readonly StateRequestSection[],
  ): boolean {
    const currentRoomId = room.rtsRoom.id;
    const currentTimeMs = now();
    const budget = stateRequestBudgetBySession.get(sessionId);
    const hashes = createStateHashesPayload(room);

    if (
      budget &&
      budget.roomId === currentRoomId &&
      currentTimeMs - budget.lastRequestedAtMs < STATE_REQUEST_MIN_INTERVAL_MS
    ) {
      return false;
    }

    if (
      budget &&
      budget.roomId === currentRoomId &&
      sections.every(
        (section) =>
          budget.lastServedHashes[section] ===
          getRequestedSectionHash(hashes, section),
      )
    ) {
      return false;
    }

    const nextServedHashes =
      budget && budget.roomId === currentRoomId
        ? { ...budget.lastServedHashes }
        : {};
    for (const section of sections) {
      nextServedHashes[section] = getRequestedSectionHash(hashes, section);
    }

    stateRequestBudgetBySession.set(sessionId, {
      roomId: currentRoomId,
      lastRequestedAtMs: currentTimeMs,
      lastServedHashes: nextServedHashes,
    });
    return true;
  }

  function cloneBuildQueuePayload(
    payload: BuildQueuePayload,
  ): BuildQueuePayload {
    return {
      ...payload,
      transform: payload.transform
        ? { operations: [...(payload.transform.operations ?? [])] }
        : undefined,
    };
  }

  function cloneDestroyQueuePayload(
    payload: DestroyQueuePayload,
  ): DestroyQueuePayload {
    return { ...payload };
  }

  function allocateIntentId(lockstepRuntime: LockstepRuntimeState): string {
    const intentId = `intent-${lockstepRuntime.nextIntentId}`;
    lockstepRuntime.nextIntentId += 1;
    return intentId;
  }

  function getBufferedTurn(room: RuntimeRoom): number {
    const lockstepRuntime = room.lockstepRuntime;
    return lockstepRuntime.mode === 'primary' &&
      lockstepRuntime.status === 'running'
      ? getLockstepTurnForTick(lockstepRuntime, room.rtsRoom.state.tick)
      : room.rtsRoom.state.tick;
  }

  function getScheduledByTurn(room: RuntimeRoom, bufferedTurn: number): number {
    const lockstepRuntime = room.lockstepRuntime;
    return lockstepRuntime.mode === 'primary' &&
      lockstepRuntime.status === 'running'
      ? bufferedTurn + 1
      : bufferedTurn;
  }

  function requirePendingBuildEvent(
    room: RuntimeRoom,
    teamId: number,
    eventId: number,
  ) {
    const team = room.rtsRoom.state.teams.get(teamId);
    const event = team?.pendingBuildEvents.find(
      (candidate) => candidate.id === eventId,
    );
    if (!event) {
      throw new Error(
        `Missing pending build event ${eventId} for team ${teamId}`,
      );
    }
    return event;
  }

  function requirePendingDestroyEvent(
    room: RuntimeRoom,
    teamId: number,
    eventId: number,
  ) {
    const team = room.rtsRoom.state.teams.get(teamId);
    const event = team?.pendingDestroyEvents.find(
      (candidate) => candidate.id === eventId,
    );
    if (!event) {
      throw new Error(
        `Missing pending destroy event ${eventId} for team ${teamId}`,
      );
    }
    return event;
  }

  function createBuildQueuedPayload(
    room: RuntimeRoom,
    teamId: number,
    intentId: string,
    bufferedTurn: number,
    scheduledByTurn: number,
    result: QueueBuildResult,
  ): BuildQueuedPayload {
    if (result.eventId === undefined || result.executeTick === undefined) {
      throw new Error(
        'Accepted build queue result is missing canonical event metadata',
      );
    }

    const event = requirePendingBuildEvent(room, teamId, result.eventId);

    return {
      roomId: room.rtsRoom.id,
      intentId,
      playerId: event.playerId,
      teamId: event.teamId,
      bufferedTurn,
      scheduledByTurn,
      templateId: event.templateId,
      x: event.x,
      y: event.y,
      transform: event.transform,
      delayTicks: Math.max(1, event.executeTick - room.rtsRoom.state.tick),
      eventId: event.id,
      executeTick: event.executeTick,
    };
  }

  function createDestroyQueuedPayload(
    room: RuntimeRoom,
    teamId: number,
    intentId: string,
    bufferedTurn: number,
    scheduledByTurn: number,
    result: QueueDestroyResult,
  ): DestroyQueuedPayload {
    if (result.eventId === undefined || result.executeTick === undefined) {
      throw new Error(
        'Accepted destroy queue result is missing canonical event metadata',
      );
    }

    const event = requirePendingDestroyEvent(room, teamId, result.eventId);

    return {
      roomId: room.rtsRoom.id,
      intentId,
      playerId: event.playerId,
      teamId: event.teamId,
      bufferedTurn,
      scheduledByTurn,
      delayTicks: Math.max(1, event.executeTick - room.rtsRoom.state.tick),
      structureKey: event.structureKey,
      eventId: event.id,
      executeTick: event.executeTick,
      idempotent: Boolean(result.idempotent),
    };
  }

  function createBuildQueueRejectedPayload(
    room: RuntimeRoom,
    teamId: number,
    sessionId: string,
    intentId: string,
    reason: BuildQueueRejectedReason,
    affordability?: AffordabilityMetadata,
  ): BuildQueueRejectedPayload {
    return {
      roomId: room.rtsRoom.id,
      intentId,
      playerId: sessionId,
      teamId,
      reason,
      needed: affordability?.needed,
      current: affordability?.current,
      deficit: affordability?.deficit,
    };
  }

  function createDestroyQueueRejectedPayload(
    room: RuntimeRoom,
    teamId: number,
    sessionId: string,
    intentId: string,
    structureKey: string,
    reason: DestroyQueueRejectedReason,
  ): DestroyQueueRejectedPayload {
    return {
      roomId: room.rtsRoom.id,
      intentId,
      playerId: sessionId,
      teamId,
      structureKey,
      reason,
    };
  }

  function createShadowRoom(room: RuntimeRoom): RtsRoom {
    const shadowRoom = RtsEngine.createRoom({
      id: room.rtsRoom.id,
      name: room.rtsRoom.name,
      width: room.rtsRoom.width,
      height: room.rtsRoom.height,
      templates: room.rtsRoom.state.templates,
    });

    const orderedTeams = [...room.rtsRoom.state.teams.values()].sort(
      (left, right) => left.id - right.id,
    );

    for (const team of orderedTeams) {
      const orderedPlayers = [...team.playerIds]
        .map((playerId) => room.rtsRoom.state.players.get(playerId))
        .filter((player): player is NonNullable<typeof player> =>
          Boolean(player),
        )
        .sort((left, right) => left.id.localeCompare(right.id));

      for (const [index, player] of orderedPlayers.entries()) {
        shadowRoom.addPlayer(player.id, player.name, {
          teamId: team.id,
          teamName: index === 0 ? team.name : undefined,
        });
      }
    }

    return shadowRoom;
  }

  function buildRuntimeRoom(
    rtsRoom: RtsRoom,
    slotDefinitions: LobbySlotDefinition[] = cloneSlotDefinitions(
      DEFAULT_SLOT_DEFINITIONS,
    ),
  ): RuntimeRoom {
    const roomId = rtsRoom.id;
    const lockstepRuntime = createLockstepRuntimeState();
    return {
      rtsRoom,
      lobby: LobbyRoom.create({
        roomId,
        slots: slotDefinitions,
      }),
      roomCode: roomId,
      revision: 0,
      status: 'lobby',
      countdownSecondsRemaining: null,
      countdownTimer: null,
      matchOutcome: null,
      lockstepRuntime,
      lockstep: toLockstepStatusPayload(lockstepRuntime),
    };
  }

  rooms.set(
    defaultRoomId,
    buildRuntimeRoom(
      RtsEngine.createRoom({
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

  const roomBroadcast = new RoomBroadcastService({
    io,
    sessionCoordinator,
    roomChannel,
    listRooms: () => rooms.values(),
  });
  const activeDisconnectTimers = new Map<string, TimeoutHandle>();

  function emitRoomList(target?: GameSocket): void {
    roomBroadcast.emitRoomList(target);
  }

  function emitRoomState(room: RuntimeRoom): void {
    roomBroadcast.emitRoomState(room);
    roomBroadcast.emitStateHashes(room);
  }

  function emitRoomStateToSocket(room: RuntimeRoom, socket: GameSocket): void {
    socket.emit('state', room.rtsRoom.createStatePayload());
    roomBroadcast.emitStateHashes(room, socket);
  }

  function emitGridStateToSocket(room: RuntimeRoom, socket: GameSocket): void {
    const payload: RoomGridStatePayload = room.rtsRoom.createGridStatePayload();
    socket.emit('state:grid', payload);
  }

  function emitStructuresStateToSocket(
    room: RuntimeRoom,
    socket: GameSocket,
  ): void {
    const payload: RoomStructuresStatePayload =
      room.rtsRoom.createStructuresStatePayload();
    socket.emit('state:structures', payload);
  }

  function emitRequestedStateSections(
    room: RuntimeRoom,
    socket: GameSocket,
    sections: readonly StateRequestSection[],
  ): void {
    for (const section of sections) {
      if (section === 'full') {
        emitRoomStateToSocket(room, socket);
        continue;
      }

      if (section === 'grid') {
        emitGridStateToSocket(room, socket);
        continue;
      }

      if (section === 'structures') {
        emitStructuresStateToSocket(room, socket);
        continue;
      }

      socket.emit(
        'room:membership',
        roomBroadcast.buildMembershipPayload(room),
      );
    }
  }

  function emitBuildOutcomes(
    room: RuntimeRoom,
    outcomes: BuildOutcomePayload[],
  ): void {
    roomBroadcast.emitBuildOutcomes(room, outcomes);
  }

  function emitDestroyOutcomes(
    room: RuntimeRoom,
    outcomes: DestroyOutcomePayload[],
  ): void {
    roomBroadcast.emitDestroyOutcomes(room, outcomes);
  }

  function emitMembership(room: RuntimeRoom, bumpRevision = true): void {
    roomBroadcast.emitMembership(room, bumpRevision);
    roomBroadcast.emitStateHashes(room);
  }

  function emitBuildQueued(
    room: RuntimeRoom,
    payload: BuildQueuedPayload,
  ): void {
    roomBroadcast.emitBuildQueued(room, payload);
    roomBroadcast.emitStateHashes(room);
  }

  function emitBuildQueueRejected(
    room: RuntimeRoom,
    payload: BuildQueueRejectedPayload,
  ): void {
    roomBroadcast.emitBuildQueueRejected(room, payload);
  }

  function emitDestroyQueued(
    room: RuntimeRoom,
    payload: DestroyQueuedPayload,
  ): void {
    roomBroadcast.emitDestroyQueued(room, payload);
    roomBroadcast.emitStateHashes(room);
  }

  function emitDestroyQueueRejected(
    room: RuntimeRoom,
    payload: DestroyQueueRejectedPayload,
  ): void {
    roomBroadcast.emitDestroyQueueRejected(room, payload);
  }

  function syncLockstepStatus(room: RuntimeRoom): void {
    room.lockstep = toLockstepStatusPayload(room.lockstepRuntime);
  }

  function getLockstepTurnForTick(
    lockstepRuntime: LockstepRuntimeState,
    tick: number,
  ): number {
    return Math.floor(Math.max(0, tick) / lockstepRuntime.turnLengthTicks);
  }

  function fallbackToLegacyLockstep(
    room: RuntimeRoom,
    reason: 'hash-mismatch' | 'shadow-unavailable' | 'turn-buffer-overflow',
    checkpoint?: ReturnType<RtsRoom['createDeterminismCheckpoint']>,
  ): void {
    const lockstepRuntime = room.lockstepRuntime;
    if (lockstepRuntime.mode === 'off') {
      return;
    }

    const fromMode = lockstepRuntime.mode;
    const pendingPrimaryCommands =
      fromMode === 'primary' && reason === 'turn-buffer-overflow'
        ? [...lockstepRuntime.turnBuffer.values()]
            .flat()
            .sort((left, right) => {
              if (left.turn !== right.turn) {
                return left.turn - right.turn;
              }

              return left.sequence - right.sequence;
            })
        : [];

    lockstepRuntime.mode = 'off';
    lockstepRuntime.status = 'fallback';
    lockstepRuntime.lastFallbackReason = reason;
    if (checkpoint) {
      lockstepRuntime.lastPrimaryHash = checkpoint.hashHex;
    }
    lockstepRuntime.turnBuffer.clear();
    lockstepRuntime.bufferedCommandCount = 0;
    lockstepRuntime.shadowRoom = null;
    lockstepRuntime.nextTurn =
      fromMode === 'primary'
        ? getLockstepTurnForTick(lockstepRuntime, room.rtsRoom.state.tick)
        : room.rtsRoom.state.tick;
    lockstepRuntime.lastFlushedTurn = -1;
    syncLockstepStatus(room);

    roomBroadcast.emitLockstepFallback(room, {
      fromMode,
      reason,
      checkpoint,
      mismatchCount: lockstepRuntime.mismatchCount,
    });

    if (pendingPrimaryCommands.length > 0) {
      executeBufferedCommands(room, pendingPrimaryCommands);
    }
  }

  function initializeLockstepForMatch(room: RuntimeRoom): void {
    const lockstepRuntime = room.lockstepRuntime;
    lockstepRuntime.nextTurn =
      lockstepRuntime.mode === 'primary'
        ? getLockstepTurnForTick(lockstepRuntime, room.rtsRoom.state.tick)
        : room.rtsRoom.state.tick;
    lockstepRuntime.nextSequence = 0;
    lockstepRuntime.lastFlushedTurn = -1;
    lockstepRuntime.turnBuffer.clear();
    lockstepRuntime.bufferedCommandCount = 0;
    lockstepRuntime.shadowRoom = null;
    lockstepRuntime.mismatchCount = 0;
    lockstepRuntime.lastFallbackReason = null;
    lockstepRuntime.lastPrimaryHash = null;
    lockstepRuntime.lastShadowHash = null;
    lockstepRuntime.checkpoints = [];

    if (lockstepRuntime.mode === 'shadow') {
      try {
        lockstepRuntime.shadowRoom = createShadowRoom(room);
      } catch {
        fallbackToLegacyLockstep(room, 'shadow-unavailable');
        return;
      }
    }

    syncLockstepStatus(room);
  }

  function bufferLockstepCommand(
    room: RuntimeRoom,
    command: Omit<BufferedLockstepCommand, 'sequence' | 'turn'>,
  ): boolean {
    const lockstepRuntime = room.lockstepRuntime;
    if (
      lockstepRuntime.mode === 'off' ||
      lockstepRuntime.status !== 'running'
    ) {
      return false;
    }

    const turn =
      lockstepRuntime.mode === 'primary'
        ? getLockstepTurnForTick(lockstepRuntime, room.rtsRoom.state.tick)
        : room.rtsRoom.state.tick;
    const bufferedCommands = lockstepRuntime.turnBuffer.get(turn) ?? [];
    bufferedCommands.push({
      ...command,
      sequence: lockstepRuntime.nextSequence,
      turn,
    });
    lockstepRuntime.nextSequence += 1;
    lockstepRuntime.turnBuffer.set(turn, bufferedCommands);
    lockstepRuntime.bufferedCommandCount += 1;
    lockstepRuntime.nextTurn =
      lockstepRuntime.mode === 'primary'
        ? Math.max(lockstepRuntime.nextTurn, turn + 1)
        : turn;

    if (
      lockstepRuntime.bufferedCommandCount > lockstepRuntime.maxBufferedCommands
    ) {
      fallbackToLegacyLockstep(room, 'turn-buffer-overflow');
      return true;
    }

    syncLockstepStatus(room);
    return true;
  }

  function replayBufferedCommandInShadow(
    room: RuntimeRoom,
    command: BufferedLockstepCommand,
  ): boolean {
    const shadowRoom = room.lockstepRuntime.shadowRoom;
    if (!shadowRoom) {
      return false;
    }

    if (command.kind === 'build') {
      const shadowResult = shadowRoom.queueBuildEvent(
        command.sessionId,
        command.payload as BuildQueuePayload,
      );
      if (shadowResult.accepted !== command.expectedAccepted) {
        return false;
      }

      if (shadowResult.accepted && command.expectedExecuteTick !== null) {
        return shadowResult.executeTick === command.expectedExecuteTick;
      }

      if (!shadowResult.accepted && command.expectedReason) {
        return shadowResult.reason === command.expectedReason;
      }

      return true;
    }

    const shadowResult = shadowRoom.queueDestroyEvent(
      command.sessionId,
      command.payload as DestroyQueuePayload,
    );
    if (shadowResult.accepted !== command.expectedAccepted) {
      return false;
    }

    if (shadowResult.accepted && command.expectedExecuteTick !== null) {
      return shadowResult.executeTick === command.expectedExecuteTick;
    }

    if (!shadowResult.accepted && command.expectedReason) {
      return shadowResult.reason === command.expectedReason;
    }

    return true;
  }

  function executeBufferedCommand(
    room: RuntimeRoom,
    command: BufferedLockstepCommand,
  ): void {
    if (command.kind === 'build') {
      const queueResult = room.rtsRoom.queueBuildEvent(
        command.sessionId,
        command.payload as BuildQueuePayload,
      );

      if (!queueResult.accepted) {
        emitBuildQueueRejected(
          room,
          createBuildQueueRejectedPayload(
            room,
            command.teamId,
            command.sessionId,
            command.intentId,
            resolveQueueBuildRejectionReason(queueResult),
            getAffordabilityMetadata(queueResult),
          ),
        );
        return;
      }

      emitBuildQueued(
        room,
        createBuildQueuedPayload(
          room,
          command.teamId,
          command.intentId,
          command.bufferedTurn,
          command.scheduledByTurn,
          queueResult,
        ),
      );
      return;
    }

    const queueResult = room.rtsRoom.queueDestroyEvent(
      command.sessionId,
      command.payload as DestroyQueuePayload,
    );

    if (!queueResult.accepted) {
      emitDestroyQueueRejected(
        room,
        createDestroyQueueRejectedPayload(
          room,
          command.teamId,
          command.sessionId,
          command.intentId,
          (command.payload as DestroyQueuePayload).structureKey,
          resolveQueueDestroyRejectionReason(queueResult),
        ),
      );
      return;
    }

    emitDestroyQueued(
      room,
      createDestroyQueuedPayload(
        room,
        command.teamId,
        command.intentId,
        command.bufferedTurn,
        command.scheduledByTurn,
        queueResult,
      ),
    );
  }

  function executeBufferedCommands(
    room: RuntimeRoom,
    bufferedCommands: readonly BufferedLockstepCommand[],
  ): void {
    for (const command of bufferedCommands) {
      executeBufferedCommand(room, command);
    }
  }

  function rejectPendingBufferedCommandsOnFinish(room: RuntimeRoom): void {
    const lockstepRuntime = room.lockstepRuntime;
    if (lockstepRuntime.turnBuffer.size === 0) {
      return;
    }

    const pendingPrimaryCommands = [...lockstepRuntime.turnBuffer.entries()]
      .flatMap(([turn, commands]) =>
        commands.map((command) => ({
          turn,
          sequence: command.sequence,
          command,
        })),
      )
      .sort((left, right) =>
        left.turn === right.turn
          ? left.sequence - right.sequence
          : left.turn - right.turn,
      )
      .map((entry) => entry.command);

    for (const command of pendingPrimaryCommands) {
      if (command.kind === 'build') {
        emitBuildQueueRejected(
          room,
          createBuildQueueRejectedPayload(
            room,
            command.teamId,
            command.sessionId,
            command.intentId,
            'match-finished',
          ),
        );
        continue;
      }

      emitDestroyQueueRejected(
        room,
        createDestroyQueueRejectedPayload(
          room,
          command.teamId,
          command.sessionId,
          command.intentId,
          (command.payload as DestroyQueuePayload).structureKey,
          'match-finished',
        ),
      );
    }

    lockstepRuntime.turnBuffer.clear();
    lockstepRuntime.bufferedCommandCount = 0;
    lockstepRuntime.lastFlushedTurn = lockstepRuntime.nextTurn - 1;

    syncLockstepStatus(room);
  }

  function flushPrimaryTurnCommands(room: RuntimeRoom): void {
    const lockstepRuntime = room.lockstepRuntime;
    if (
      lockstepRuntime.mode !== 'primary' ||
      lockstepRuntime.status !== 'running'
    ) {
      return;
    }

    const currentTurn = getLockstepTurnForTick(
      lockstepRuntime,
      room.rtsRoom.state.tick,
    );
    const turn = currentTurn - 1;
    if (turn <= lockstepRuntime.lastFlushedTurn) {
      return;
    }

    const bufferedCommands = [
      ...(lockstepRuntime.turnBuffer.get(turn) ?? []),
    ].sort((left, right) => left.sequence - right.sequence);
    lockstepRuntime.turnBuffer.delete(turn);
    lockstepRuntime.bufferedCommandCount = Math.max(
      0,
      lockstepRuntime.bufferedCommandCount - bufferedCommands.length,
    );
    lockstepRuntime.lastFlushedTurn = turn;
    lockstepRuntime.nextTurn = currentTurn;

    executeBufferedCommands(room, bufferedCommands);

    syncLockstepStatus(room);
  }

  function runShadowTick(room: RuntimeRoom): void {
    const lockstepRuntime = room.lockstepRuntime;
    if (
      lockstepRuntime.mode !== 'shadow' ||
      lockstepRuntime.status !== 'running'
    ) {
      return;
    }

    const shadowRoom = lockstepRuntime.shadowRoom;
    if (!shadowRoom) {
      fallbackToLegacyLockstep(room, 'shadow-unavailable');
      return;
    }

    const processedTurn = Math.max(0, room.rtsRoom.state.tick - 1);
    const bufferedCommands = [
      ...(lockstepRuntime.turnBuffer.get(processedTurn) ?? []),
    ].sort((left, right) => left.sequence - right.sequence);
    for (const command of bufferedCommands) {
      if (!replayBufferedCommandInShadow(room, command)) {
        lockstepRuntime.mismatchCount += 1;
        fallbackToLegacyLockstep(room, 'hash-mismatch');
        return;
      }
    }
    lockstepRuntime.turnBuffer.delete(processedTurn);
    lockstepRuntime.bufferedCommandCount = Math.max(
      0,
      lockstepRuntime.bufferedCommandCount - bufferedCommands.length,
    );

    shadowRoom.tick();
    lockstepRuntime.nextTurn = room.rtsRoom.state.tick;
    syncLockstepStatus(room);
  }

  function recordLockstepCheckpoint(
    room: RuntimeRoom,
    checkpoint: LockstepCheckpointPayload,
  ): void {
    const checkpoints = room.lockstepRuntime.checkpoints;
    checkpoints.push(checkpoint);
    if (checkpoints.length > 16) {
      checkpoints.shift();
    }
  }

  function emitLockstepCheckpointIfDue(room: RuntimeRoom): void {
    const lockstepRuntime = room.lockstepRuntime;
    if (
      lockstepRuntime.mode === 'off' ||
      lockstepRuntime.status !== 'running'
    ) {
      return;
    }

    if (
      room.rtsRoom.state.tick % lockstepRuntime.checkpointIntervalTicks !==
      0
    ) {
      return;
    }

    const checkpoint = room.rtsRoom.createDeterminismCheckpoint();
    lockstepRuntime.lastPrimaryHash = checkpoint.hashHex;
    if (lockstepRuntime.mode === 'shadow') {
      const shadowRoom = lockstepRuntime.shadowRoom;
      if (!shadowRoom) {
        fallbackToLegacyLockstep(room, 'shadow-unavailable', checkpoint);
        return;
      }

      const shadowCheckpoint = shadowRoom.createDeterminismCheckpoint();
      lockstepRuntime.lastShadowHash = shadowCheckpoint.hashHex;
      if (shadowCheckpoint.hashHex !== checkpoint.hashHex) {
        lockstepRuntime.mismatchCount += 1;
        fallbackToLegacyLockstep(room, 'hash-mismatch', checkpoint);
        return;
      }
    } else {
      lockstepRuntime.lastShadowHash = null;
    }

    const payload: Omit<LockstepCheckpointPayload, 'roomId'> = {
      ...checkpoint,
      mode: lockstepRuntime.mode,
      turn: lockstepRuntime.nextTurn,
    };
    recordLockstepCheckpoint(room, {
      roomId: room.rtsRoom.id,
      ...payload,
    });
    syncLockstepStatus(room);
    roomBroadcast.emitLockstepCheckpoint(room, payload);
  }

  function clearActiveDisconnectExpiry(sessionId: string): void {
    const timer = activeDisconnectTimers.get(sessionId);
    if (!timer) {
      return;
    }

    clearTimeoutHook(timer);
    activeDisconnectTimers.delete(sessionId);
  }

  function scheduleActiveDisconnectExpiry(
    sessionId: string,
    roomId: string,
  ): void {
    clearActiveDisconnectExpiry(sessionId);

    const timer = setTimeoutHook(() => {
      activeDisconnectTimers.delete(sessionId);

      const session = sessionCoordinator.getSession(sessionId);
      if (!session || session.connected || session.roomId !== roomId) {
        return;
      }

      const room = getRoomOrNull(roomId);
      if (!room) {
        sessionCoordinator.setRoom(sessionId, null);
        sessionCoordinator.pruneSession(sessionId);
        return;
      }

      const wasPlayer = removeSessionFromRoom(room, sessionId);
      sessionCoordinator.clearHold(sessionId);
      sessionCoordinator.setRoom(sessionId, null);
      finalizeDeparture(room, wasPlayer);
      sessionCoordinator.pruneSession(sessionId);
    }, reconnectHoldMs);

    activeDisconnectTimers.set(sessionId, timer);
  }

  function stopCountdown(room: RuntimeRoom): void {
    if (room.countdownTimer) {
      clearIntervalHook(room.countdownTimer);
      room.countdownTimer = null;
    }
    room.countdownSecondsRemaining = null;
  }

  function deleteRoomIfEmpty(room: RuntimeRoom): boolean {
    if (room.rtsRoom.id === defaultRoomId) {
      return false;
    }

    if (room.lobby.participantCount() > 0) {
      return false;
    }

    stopCountdown(room);
    rooms.delete(room.rtsRoom.id);
    return true;
  }

  function roomError(
    socket: GameSocket,
    message: string,
    reason?: string,
    affordabilityOrRoomId?: AffordabilityMetadata | string | null,
    roomId?: string | null,
  ): void {
    const affordability =
      typeof affordabilityOrRoomId === 'object' &&
      affordabilityOrRoomId !== null
        ? affordabilityOrRoomId
        : undefined;
    const resolvedRoomId =
      typeof affordabilityOrRoomId === 'string' ||
      affordabilityOrRoomId === null
        ? affordabilityOrRoomId
        : (roomId ?? null);
    const payload: RoomErrorPayload = { roomId: resolvedRoomId, message };
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
      room.rtsRoom.removePlayer(sessionId);
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
    clearActiveDisconnectExpiry(holdSessionId);

    const room = rooms.get(roomId);
    if (!room) {
      sessionCoordinator.setRoom(holdSessionId, null);
      sessionCoordinator.pruneSession(holdSessionId);
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
    clearActiveDisconnectExpiry(session.id);
    clearStateRequestBudget(session.id);

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

    const previousRoomId = room.rtsRoom.id;

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
        scheduleActiveDisconnectExpiry(session.id, room.rtsRoom.id);
        emitMembership(room);
        emitRoomList();
        return;
      }

      sessionCoordinator.holdOnDisconnect({
        sessionId: session.id,
        socketId: socket.id,
        roomId: room.rtsRoom.id,
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
      void socket.leave(roomChannel(room.rtsRoom.id));
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
    clearActiveDisconnectExpiry(session.id);

    if (session.roomId && session.roomId !== room.rtsRoom.id) {
      leaveCurrentRoom(socket, session, {
        emitLeft: true,
        preserveHold: false,
      });
    }

    void socket.join(roomChannel(room.rtsRoom.id));
    sessionCoordinator.clearHold(session.id);
    room.lobby.join({
      sessionId: session.id,
      displayName: session.name,
    });

    sessionCoordinator.setRoom(session.id, room.rtsRoom.id);

    const teamId = room.rtsRoom.state.players.get(session.id)?.teamId ?? null;
    socket.emit('room:joined', {
      roomId: room.rtsRoom.id,
      roomCode: room.roomCode,
      roomName: room.rtsRoom.name,
      tickMs,
      playerId: session.id,
      playerName: session.name,
      teamId,
      templates: room.rtsRoom.state.templates.map((template) =>
        template.toPayload(),
      ),
      state: room.rtsRoom.createStatePayload(),
      stateHashes: createStateHashesPayload(room),
      lockstep: room.lockstep,
    });

    const latestCheckpoint = room.lockstepRuntime.checkpoints.at(-1);
    if (latestCheckpoint) {
      socket.emit('lockstep:checkpoint', latestCheckpoint);
    }

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
    const heldSessionIds = sessionCoordinator.getHeldSessionsForSlot(
      room.rtsRoom.id,
      trimmedSlotId,
    );
    const openSeatCount =
      room.lobby.slotCapacity(trimmedSlotId) -
      room.lobby.slotMemberIds(trimmedSlotId).length;
    if (
      heldSessionIds.some((heldSessionId) => heldSessionId !== session.id) &&
      openSeatCount <= 0
    ) {
      roomError(
        socket,
        'Selected team slot is temporarily held for reconnect',
        'slot-held',
        getRuntimeRoomId(room),
      );
      return;
    }

    const result = room.lobby.claimSlot(session.id, trimmedSlotId);
    if (!result.ok) {
      const mapped = mapLobbyReasonToError(
        result.reason ?? 'participant-not-found',
      );
      roomError(socket, mapped.message, mapped.reason, getRuntimeRoomId(room));
      return;
    }

    if (!room.rtsRoom.state.players.has(session.id)) {
      const sharedTeamId = room.lobby
        .slotMemberIds(trimmedSlotId)
        .filter((slotSessionId) => slotSessionId !== session.id)
        .map(
          (slotSessionId) =>
            room.rtsRoom.state.players.get(slotSessionId)?.teamId ?? null,
        )
        .find((teamId): teamId is number => teamId !== null);

      room.rtsRoom.addPlayer(
        session.id,
        session.name,
        sharedTeamId === undefined
          ? { teamName: getSlotTeamName(trimmedSlotId) }
          : { teamId: sharedTeamId },
      );
    }

    socket.emit('room:slot-claimed', {
      roomId: room.rtsRoom.id,
      slotId: trimmedSlotId,
      teamId: room.rtsRoom.state.players.get(session.id)?.teamId ?? null,
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
      const slotMembers = snapshot.slotMembers[slotId] ?? [];
      if (slotMembers.length !== room.lobby.slotCapacity(slotId)) {
        return false;
      }

      for (const sessionId of slotMembers) {
        const participant = bySession.get(sessionId);
        if (
          !participant ||
          participant.role !== 'player' ||
          participant.slotId !== slotId ||
          !participant.ready
        ) {
          return false;
        }
      }
    }

    return true;
  }

  function getLifecyclePreconditions(
    room: RuntimeRoom,
  ): LifecyclePreconditions {
    const snapshot = room.lobby.snapshot();
    const slotIds = room.lobby.slotIds();
    const participantBySession = new Map(
      snapshot.participants.map((participant) => [
        participant.sessionId,
        participant,
      ]),
    );
    const requiredSeatCount = slotIds.reduce(
      (seatCount, slotId) => seatCount + room.lobby.slotCapacity(slotId),
      0,
    );
    const assignedSessionIds = slotIds.flatMap(
      (slotId) => snapshot.slotMembers[slotId] ?? [],
    );

    const hasRequiredPlayers =
      assignedSessionIds.length === requiredSeatCount &&
      new Set(assignedSessionIds).size === assignedSessionIds.length &&
      slotIds.every((slotId) => {
        const slotMembers = snapshot.slotMembers[slotId] ?? [];
        if (slotMembers.length !== room.lobby.slotCapacity(slotId)) {
          return false;
        }

        return slotMembers.every((sessionId) => {
          const participant = participantBySession.get(sessionId);
          return (
            participant?.role === 'player' && participant.slotId === slotId
          );
        });
      });

    const allPlayersConnected =
      assignedSessionIds.length === requiredSeatCount &&
      assignedSessionIds.every((sessionId) =>
        sessionCoordinator.isSessionConnected(sessionId),
      );

    return {
      hasRequiredPlayers,
      allPlayersConnected,
      reconnectHoldPending: sessionCoordinator.hasPendingHoldForRoom(
        room.rtsRoom.id,
      ),
    };
  }

  function resetRoomStateForRestart(room: RuntimeRoom): void {
    const previousRoom = room.rtsRoom;
    const snapshot = room.lobby.snapshot();
    const slotIds = room.lobby.slotIds();
    const participantBySession = new Map(
      snapshot.participants.map((participant) => [
        participant.sessionId,
        participant,
      ]),
    );

    const nextRoom = RtsEngine.createRoom({
      id: previousRoom.id,
      name: previousRoom.name,
      width: previousRoom.width,
      height: previousRoom.height,
      templates: previousRoom.state.templates,
    });

    for (const slotId of slotIds) {
      const slotMembers = snapshot.slotMembers[slotId] ?? [];
      let slotTeamId: number | null = null;

      for (const sessionId of slotMembers) {
        const displayName =
          sessionCoordinator.getSession(sessionId)?.name ??
          participantBySession.get(sessionId)?.displayName ??
          sessionId;
        const team = nextRoom.addPlayer(
          sessionId,
          displayName,
          slotTeamId === null
            ? { teamName: getSlotTeamName(slotId) }
            : { teamId: slotTeamId },
        );
        slotTeamId = team.id;
      }
    }

    room.rtsRoom = nextRoom;
    room.matchOutcome = null;
    resetLockstepRuntime(room);
  }

  function emitMatchFinished(room: RuntimeRoom): void {
    roomBroadcast.emitMatchFinished(room);
  }

  function startCountdown(room: RuntimeRoom): void {
    if (room.countdownTimer) {
      return;
    }

    resetRoomStateForRestart(room);
    room.status = 'countdown';
    initializeLockstepForMatch(room);
    room.countdownSecondsRemaining = countdownSeconds;
    emitMembership(room);
    emitRoomList();
    io.to(roomChannel(room.rtsRoom.id)).emit('room:countdown', {
      roomId: room.rtsRoom.id,
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
      io.to(roomChannel(room.rtsRoom.id)).emit('room:match-started', {
        roomId: room.rtsRoom.id,
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
        io.to(roomChannel(room.rtsRoom.id)).emit('room:match-started', {
          roomId: room.rtsRoom.id,
        });
        return;
      }

      room.countdownSecondsRemaining = next;
      emitMembership(room);
      io.to(roomChannel(room.rtsRoom.id)).emit('room:countdown', {
        roomId: room.rtsRoom.id,
        secondsRemaining: next,
      });
    }, 1000);
  }

  function getTeamForSession(
    room: RuntimeRoom,
    sessionId: string,
  ): TeamState | null {
    const player = room.rtsRoom.state.players.get(sessionId);
    if (!player) {
      return null;
    }

    return room.rtsRoom.state.teams.get(player.teamId) ?? null;
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

  function resolveQueueBuildRejectionReason(
    result: QueueBuildResult,
  ): BuildQueueRejectedReason {
    if (result.reason) {
      return result.reason as BuildQueueRejectedReason;
    }

    return mapQueueBuildErrorReason(result.error);
  }

  function resolveQueueDestroyRejectionReason(
    result: QueueDestroyResult,
  ): DestroyQueueRejectedReason {
    if (result.reason) {
      return result.reason as DestroyQueueRejectedReason;
    }

    return 'destroy-rejected';
  }

  function createRoomFromPayload(payload: unknown): RuntimeRoom {
    const roomPayload = (payload ?? {}) as RoomCreatePayload;
    const roomId = roomCounter.toString();
    roomCounter += 1;
    const slotDefinitions = parseRoomSlotDefinitions(roomPayload.slots);

    const rtsRoom = RtsEngine.createRoom({
      id: roomId,
      name:
        typeof roomPayload.name === 'string' && roomPayload.name.trim()
          ? roomPayload.name.trim().slice(0, 32)
          : `Room ${roomId}`,
      width: parseRoomDimension(roomPayload.width, width),
      height: parseRoomDimension(roomPayload.height, height),
      templates: roomTemplates,
    });

    const room = buildRuntimeRoom(rtsRoom, slotDefinitions);
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
        previousSocket.disconnect(true);
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
        if (room.rtsRoom.state.players.has(session.id)) {
          room.rtsRoom.renamePlayer(session.id, nextName);
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

    socket.on('state:request', (payload?: StateRequestPayload) => {
      if (!ensureCurrentSocket(socket, session)) {
        return;
      }

      const room = getRoomOrNull(session.roomId);
      if (!room) {
        clearStateRequestBudget(session.id);
        return;
      }

      const sections = normalizeStateRequestSections(payload);
      if (!shouldServeStateRequest(session.id, room, sections)) {
        return;
      }

      emitRequestedStateSections(room, socket, sections);
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
        roomError(
          socket,
          'Invalid ready payload',
          'invalid-ready',
          getRuntimeRoomId(room),
        );
        return;
      }

      if (room.status === 'countdown' && !ready) {
        roomError(
          socket,
          'Cannot toggle Not Ready while countdown is running',
          'countdown-locked',
          getRuntimeRoomId(room),
        );
        return;
      }

      if (room.status === 'active' || room.status === 'finished') {
        roomError(
          socket,
          'Ready toggle is unavailable after match start',
          'match-started',
          getRuntimeRoomId(room),
        );
        return;
      }

      const result = room.lobby.setReady(session.id, ready);
      if (!result.ok) {
        const mapped = mapLobbyReasonToError(
          result.reason ?? 'participant-not-found',
        );
        roomError(
          socket,
          mapped.message,
          mapped.reason,
          getRuntimeRoomId(room),
        );
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
        roomError(
          socket,
          'Only the host can start the match',
          'not-host',
          getRuntimeRoomId(room),
        );
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
            getRuntimeRoomId(room),
          );
          return;
        }

        roomError(
          socket,
          'Match cannot transition from the current lifecycle state',
          'invalid-transition',
          getRuntimeRoomId(room),
        );
        return;
      }

      if (lifecycleEvent === 'start-countdown' && !allSlotsReady(room)) {
        roomError(
          socket,
          forceRequested
            ? 'Force start is disabled when players are not ready'
            : 'All assigned team seats must be ready before starting',
          'not-ready',
          getRuntimeRoomId(room),
        );
        return;
      }

      room.status = transition.nextStatus;
      startCountdown(room);

      if (lifecycleEvent === 'restart-countdown') {
        emitRoomState(room);
      }
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
        roomError(
          socket,
          'Only the host can cancel countdown',
          'not-host',
          getRuntimeRoomId(room),
        );
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
          getRuntimeRoomId(room),
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
        roomError(
          socket,
          'Chat message cannot be empty',
          'invalid-chat',
          getRuntimeRoomId(room),
        );
        return;
      }

      io.to(roomChannel(room.rtsRoom.id)).emit('chat:message', {
        roomId: room.rtsRoom.id,
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

      const gate = assertGameplayMutationAllowed(room, session.id);
      if (!gate.allowed) {
        roomError(
          socket,
          gate.message ?? 'Gameplay mutation rejected',
          gate.reason,
          getRuntimeRoomId(room),
        );
        return;
      }

      if (!gate.team) {
        roomError(
          socket,
          'Only assigned players can issue gameplay mutations',
          'not-player',
          getRuntimeRoomId(room),
        );
        return;
      }

      const team = gate.team;

      const parsedPayload = parseBuildPayload(payload);
      if (!parsedPayload) {
        roomError(
          socket,
          'Invalid build payload',
          'invalid-build',
          getRuntimeRoomId(room),
        );
        return;
      }

      const lockstepRuntime = room.lockstepRuntime;
      const intentId = allocateIntentId(lockstepRuntime);
      const bufferedTurn = getBufferedTurn(room);
      const scheduledByTurn = getScheduledByTurn(room, bufferedTurn);
      if (
        lockstepRuntime.mode === 'primary' &&
        lockstepRuntime.status === 'running'
      ) {
        if (
          bufferLockstepCommand(room, {
            intentId,
            bufferedTurn,
            scheduledByTurn,
            kind: 'build',
            sessionId: session.id,
            teamId: team.id,
            payload: cloneBuildQueuePayload(parsedPayload),
            expectedAccepted: false,
            expectedExecuteTick: null,
            expectedReason: null,
          })
        ) {
          return;
        }
      }

      const result = room.rtsRoom.queueBuildEvent(session.id, parsedPayload);
      bufferLockstepCommand(room, {
        intentId,
        bufferedTurn,
        scheduledByTurn,
        kind: 'build',
        sessionId: session.id,
        teamId: team.id,
        payload: cloneBuildQueuePayload(parsedPayload),
        expectedAccepted: result.accepted,
        expectedExecuteTick: result.executeTick ?? null,
        expectedReason: result.accepted ? null : (result.reason ?? null),
      });

      if (!result.accepted) {
        const reason = resolveQueueBuildRejectionReason(result);
        emitBuildQueueRejected(
          room,
          createBuildQueueRejectedPayload(
            room,
            team.id,
            session.id,
            intentId,
            reason,
            reason === 'insufficient-resources'
              ? getAffordabilityMetadata(result)
              : undefined,
          ),
        );
        return;
      }

      emitBuildQueued(
        room,
        createBuildQueuedPayload(
          room,
          team.id,
          intentId,
          bufferedTurn,
          scheduledByTurn,
          result,
        ),
      );
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
          getRuntimeRoomId(room),
        );
        return;
      }

      if (!gate.team) {
        roomError(
          socket,
          'Only assigned players can issue gameplay mutations',
          'not-player',
          getRuntimeRoomId(room),
        );
        return;
      }

      const team = gate.team;

      const parsedPayload = parseDestroyPayload(payload);
      if (!parsedPayload) {
        roomError(
          socket,
          'Invalid destroy payload',
          'invalid-build',
          getRuntimeRoomId(room),
        );
        return;
      }

      const lockstepRuntime = room.lockstepRuntime;
      const intentId = allocateIntentId(lockstepRuntime);
      const bufferedTurn = getBufferedTurn(room);
      const scheduledByTurn = getScheduledByTurn(room, bufferedTurn);
      if (
        lockstepRuntime.mode === 'primary' &&
        lockstepRuntime.status === 'running'
      ) {
        if (
          bufferLockstepCommand(room, {
            intentId,
            bufferedTurn,
            scheduledByTurn,
            kind: 'destroy',
            sessionId: session.id,
            teamId: team.id,
            payload: cloneDestroyQueuePayload(parsedPayload),
            expectedAccepted: false,
            expectedExecuteTick: null,
            expectedReason: null,
          })
        ) {
          return;
        }
      }

      const result = room.rtsRoom.queueDestroyEvent(session.id, parsedPayload);
      bufferLockstepCommand(room, {
        intentId,
        bufferedTurn,
        scheduledByTurn,
        kind: 'destroy',
        sessionId: session.id,
        teamId: team.id,
        payload: cloneDestroyQueuePayload(parsedPayload),
        expectedAccepted: result.accepted,
        expectedExecuteTick: result.executeTick ?? null,
        expectedReason: result.accepted ? null : (result.reason ?? null),
      });
      if (!result.accepted) {
        const reason = resolveQueueDestroyRejectionReason(result);
        emitDestroyQueueRejected(
          room,
          createDestroyQueueRejectedPayload(
            room,
            team.id,
            session.id,
            intentId,
            parsedPayload.structureKey,
            reason,
          ),
        );
        return;
      }

      emitDestroyQueued(
        room,
        createDestroyQueuedPayload(
          room,
          team.id,
          intentId,
          bufferedTurn,
          scheduledByTurn,
          result,
        ),
      );
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

  function getStatePayload(): RoomStatePayload {
    const room = rooms.get(defaultRoomId);
    if (room) {
      return room.rtsRoom.createStatePayload();
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
    const emitActiveStateSnapshot =
      tickCounter % activeStateSnapshotIntervalTicks === 0;

    for (const room of rooms.values()) {
      if (room.status === 'active') {
        if (room.rtsRoom.state.players.size === 0) {
          const transition = transitionMatchLifecycle(room.status, 'finish');
          if (transition.allowed) {
            rejectPendingBufferedCommandsOnFinish(room);
            room.status = transition.nextStatus;
            const outcome = room.rtsRoom.createCanonicalMatchOutcome();
            room.matchOutcome = outcome
              ? {
                  roomId: room.rtsRoom.id,
                  winner: outcome.winner,
                  ranked: outcome.ranked,
                  comparator: outcome.comparator,
                }
              : null;
            emitMembership(room);
            emitRoomList();
            emitMatchFinished(room);
          }
          continue;
        }

        flushPrimaryTurnCommands(room);
        const tickResult = room.rtsRoom.tick();
        const buildOutcomes: BuildOutcomePayload[] =
          tickResult.buildOutcomes.map((outcome) => ({
            ...outcome,
            roomId: room.rtsRoom.id,
          }));
        const destroyOutcomes: DestroyOutcomePayload[] =
          tickResult.destroyOutcomes.map((outcome) => ({
            ...outcome,
            roomId: room.rtsRoom.id,
          }));
        emitBuildOutcomes(room, buildOutcomes);
        emitDestroyOutcomes(room, destroyOutcomes);
        runShadowTick(room);
        emitLockstepCheckpointIfDue(room);

        if (tickResult.outcome) {
          const transition = transitionMatchLifecycle(room.status, 'finish');
          if (transition.allowed) {
            rejectPendingBufferedCommandsOnFinish(room);
            room.status = transition.nextStatus;
            room.matchOutcome = {
              roomId: room.rtsRoom.id,
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
        if (room.status === 'active' && emitActiveStateSnapshot) {
          emitRoomState(room);
        } else if (room.status === 'finished' && emitFinishedRoomResync) {
          emitRoomState(room);
        }

        // Re-emit shared snapshots on a heartbeat for late listeners.
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

    for (const timer of activeDisconnectTimers.values()) {
      clearTimeoutHook(timer);
    }
    activeDisconnectTimers.clear();

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
