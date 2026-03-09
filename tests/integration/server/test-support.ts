import { type Socket, io } from 'socket.io-client';

import {
  BASE_FOOTPRINT_HEIGHT,
  BASE_FOOTPRINT_WIDTH,
  CORE_STRUCTURE_TEMPLATE,
  isBuildZoneCoveredByContributor,
  normalizePlacementTransform,
  projectBuildZoneContributor,
} from '#rts-engine';
import type {
  BuildOutcomePayload,
  BuildQueueRejectedPayload,
  BuildQueuedPayload,
  DestroyOutcomePayload,
  DestroyQueueRejectedPayload,
  DestroyQueuedPayload,
  PlacementTransformInput,
  RoomErrorPayload,
  RoomGridStatePayload,
  RoomJoinedPayload,
  RoomListEntryPayload,
  RoomMembershipPayload,
  RoomSlotClaimedPayload,
  RoomStateHashesPayload,
  RoomStatePayload,
  RoomStructuresStatePayload,
  StateRequestPayload,
  TeamPayload,
} from '#rts-engine';

export interface TestClientOptions {
  sessionId?: string;
  connect?: boolean;
}

export interface WaitForPredicateOptions {
  attempts?: number;
  timeoutMs?: number;
  overallTimeoutMs?: number;
  timeoutMessage?: string;
}

export interface WaitForRequestedStateOptions extends WaitForPredicateOptions {
  roomId?: string;
  autoRequest?: boolean;
  requestIntervalMs?: number;
}

export interface SocketAdvanceDriver {
  subscribe(listener: () => void): () => void;
}

export interface CandidatePlacementOptions {
  transform?: PlacementTransformInput;
  searchRadius?: number;
  step?: number;
}

export interface Cell {
  x: number;
  y: number;
}

export interface ActiveMatchSetup {
  host: Socket;
  guest: Socket;
  roomId: string;
  hostJoined: RoomJoinedPayload;
  guestJoined: RoomJoinedPayload;
  hostTeam: TeamPayload;
  guestTeam: TeamPayload;
}

type QueueErrorPayload<TRejected extends { reason: string }> =
  | RoomErrorPayload
  | (TRejected & { message?: string });

export type QueueResponse<TQueued, TRejected extends { reason: string }> =
  | { queued: TQueued }
  | { error: QueueErrorPayload<TRejected> };

const MAX_BUFFERED_EVENTS_PER_NAME = 32;
const BUFFERED_EVENT_NAMES = new Set([
  'lockstep:checkpoint',
  'room:joined',
  'room:membership',
]);

type BufferedEventStore = Map<string, unknown[]>;

const bufferedSocketEvents = new WeakMap<Socket, BufferedEventStore>();
const socketPlayerIds = new WeakMap<Socket, string>();
const socketSessionIds = new WeakMap<Socket, string>();
const pendingQueueResponseKinds = new WeakMap<Socket, Set<string>>();
const socketAdvanceDrivers = new WeakMap<Socket, SocketAdvanceDriver>();

function shouldBufferEvent(socket: Socket, event: string): boolean {
  if (!BUFFERED_EVENT_NAMES.has(event)) {
    return false;
  }

  if (event !== 'room:membership') {
    return true;
  }

  return socketAdvanceDrivers.has(socket);
}

export function registerSocketAdvanceDriver(
  socket: Socket,
  driver: SocketAdvanceDriver,
): void {
  socketAdvanceDrivers.set(socket, driver);
}

function extractPlayerId(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }

  const candidate = (payload as { playerId?: unknown }).playerId;
  return typeof candidate === 'string' ? candidate : null;
}

function attachBufferedEventStore(socket: Socket): void {
  const store: BufferedEventStore = new Map();
  bufferedSocketEvents.set(socket, store);

  // Capture server events before the test starts awaiting them.
  socket.onAny((eventName, payload) => {
    const event = typeof eventName === 'string' ? eventName : null;
    if (event === null || !shouldBufferEvent(socket, event)) {
      return;
    }

    const playerId = event === 'room:joined' ? extractPlayerId(payload) : null;

    if (playerId !== null) {
      socketPlayerIds.set(socket, playerId);
    }

    const queue = store.get(event) ?? [];
    queue.push(payload);
    if (queue.length > MAX_BUFFERED_EVENTS_PER_NAME) {
      queue.splice(0, queue.length - MAX_BUFFERED_EVENTS_PER_NAME);
    }
    store.set(event, queue);
  });
}

function takeBufferedEvent<T>(
  socket: Socket,
  event: string,
  predicate?: (payload: T) => boolean,
): T | null {
  const store = bufferedSocketEvents.get(socket);
  const bufferedEvents = store?.get(event);
  if (!bufferedEvents || bufferedEvents.length === 0) {
    return null;
  }

  if (predicate === undefined) {
    const payload = bufferedEvents.shift();
    if (bufferedEvents.length === 0) {
      store?.delete(event);
    }
    return (payload as T | undefined) ?? null;
  }

  const matchedIndex = bufferedEvents.findIndex((bufferedPayload) => {
    try {
      return predicate(bufferedPayload as T);
    } catch {
      return false;
    }
  });
  if (matchedIndex === -1) {
    return null;
  }

  const [payload] = bufferedEvents.splice(matchedIndex, 1);
  if (bufferedEvents.length === 0) {
    store?.delete(event);
  }
  return (payload as T | undefined) ?? null;
}

function removeBufferedEvent(
  socket: Socket,
  event: string,
  payload: unknown,
): void {
  const store = bufferedSocketEvents.get(socket);
  const bufferedEvents = store?.get(event);
  if (!bufferedEvents || bufferedEvents.length === 0) {
    return;
  }

  const matchedIndex = bufferedEvents.findIndex((bufferedPayload) =>
    Object.is(bufferedPayload, payload),
  );
  if (matchedIndex === -1) {
    return;
  }

  bufferedEvents.splice(matchedIndex, 1);
  if (bufferedEvents.length === 0) {
    store?.delete(event);
  }
}

function acquireQueueResponseKind(socket: Socket, kind: string): void {
  const activeKinds =
    pendingQueueResponseKinds.get(socket) ?? new Set<string>();
  if (activeKinds.has(kind)) {
    throw new Error(
      `waitFor${kind[0].toUpperCase()}${kind.slice(1)}QueueResponse does not support multiple in-flight waits on the same socket`,
    );
  }

  activeKinds.add(kind);
  pendingQueueResponseKinds.set(socket, activeKinds);
}

function releaseQueueResponseKind(socket: Socket, kind: string): void {
  const activeKinds = pendingQueueResponseKinds.get(socket);
  if (!activeKinds) {
    return;
  }

  activeKinds.delete(kind);
  if (activeKinds.size === 0) {
    pendingQueueResponseKinds.delete(socket);
  }
}

export function createClient(
  port: number,
  options: TestClientOptions = {},
): Socket {
  const shouldConnect = options.connect ?? true;
  const socket = io(`http://localhost:${port}`, {
    autoConnect: false,
    transports: ['websocket'],
    auth: options.sessionId ? { sessionId: options.sessionId } : undefined,
  });
  if (options.sessionId) {
    socketSessionIds.set(socket, options.sessionId);
  }
  attachBufferedEventStore(socket);
  if (shouldConnect) {
    socket.connect();
  }
  return socket;
}

export function waitForEvent<T>(
  socket: Socket,
  event: string,
  timeoutMs = 2500,
): Promise<T> {
  if (shouldBufferEvent(socket, event)) {
    const bufferedEvent = takeBufferedEvent<T>(socket, event);
    if (bufferedEvent !== null) {
      return Promise.resolve(bufferedEvent);
    }
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    function onEvent(payload: T): void {
      removeBufferedEvent(socket, event, payload);
      clearTimeout(timer);
      resolve(payload);
    }

    socket.once(event, onEvent);
  });
}

export function waitForNoEvent(
  socket: Socket,
  event: string,
  timeoutMs = 250,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      socket.off(event, onEvent);
    }

    function onEvent(): void {
      cleanup();
      reject(new Error(`Unexpected ${event} during quiet window`));
    }

    socket.on(event, onEvent);
  });
}

export function waitForEventWithPredicate<T>(
  socket: Socket,
  event: string,
  predicate: (payload: T) => boolean,
  options: WaitForPredicateOptions = {},
): Promise<T> {
  if (shouldBufferEvent(socket, event)) {
    const bufferedEvent = takeBufferedEvent<T>(socket, event, predicate);
    if (bufferedEvent !== null) {
      return Promise.resolve(bufferedEvent);
    }
  }

  const attempts = options.attempts ?? 20;
  const timeoutMs = options.timeoutMs ?? 2500;
  const overallTimeoutMs = options.overallTimeoutMs ?? attempts * timeoutMs;
  const timeoutMessage =
    options.timeoutMessage ??
    `Condition for ${event} not met in allotted attempts`;

  if (attempts <= 0 || overallTimeoutMs <= 0) {
    return Promise.reject(new Error(timeoutMessage));
  }

  return new Promise((resolve, reject) => {
    let remainingAttempts = attempts;

    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMessage));
    }, overallTimeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      socket.off(event, onEvent);
    }

    function onEvent(payload: T): void {
      removeBufferedEvent(socket, event, payload);

      let matches = false;
      try {
        matches = predicate(payload);
      } catch (error) {
        cleanup();
        reject(error instanceof Error ? error : new Error(String(error)));
        return;
      }

      if (!matches) {
        remainingAttempts -= 1;
        if (remainingAttempts <= 0) {
          cleanup();
          reject(new Error(timeoutMessage));
        }
        return;
      }

      cleanup();
      resolve(payload);
    }

    socket.on(event, onEvent);
  });
}

export function waitForMembership(
  socket: Socket,
  roomId: string,
  predicate: (payload: RoomMembershipPayload) => boolean,
  options: WaitForPredicateOptions = {},
): Promise<RoomMembershipPayload> {
  return waitForEventWithPredicate(
    socket,
    'room:membership',
    (payload) => payload.roomId === roomId && predicate(payload),
    {
      ...options,
      timeoutMessage:
        options.timeoutMessage ??
        'Membership condition not met in allotted attempts',
    },
  );
}

function waitForRequestedStateEvent<T>(
  socket: Socket,
  event: string,
  sections: StateRequestPayload['sections'],
  predicate: (payload: T) => boolean,
  options: WaitForRequestedStateOptions = {},
): Promise<T> {
  const {
    roomId,
    autoRequest = true,
    requestIntervalMs = 120,
    ...waitOptions
  } = options;

  const waitPromise = waitForEventWithPredicate<T>(
    socket,
    event,
    (payload) => {
      if (roomId === undefined) {
        return predicate(payload);
      }

      const roomPayload = payload as { roomId?: string };
      return roomPayload.roomId === roomId && predicate(payload);
    },
    {
      ...waitOptions,
      timeoutMessage:
        waitOptions.timeoutMessage ??
        `Condition for ${event} not met in allotted attempts`,
    },
  );

  if (!autoRequest) {
    return waitPromise;
  }

  const intervalMs = Math.max(20, Math.floor(requestIntervalMs));
  const emitRequest = (): void => {
    socket.emit('state:request', {
      sections,
    } satisfies StateRequestPayload);
  };
  const advanceDriver = socketAdvanceDrivers.get(socket);

  emitRequest();
  if (advanceDriver) {
    const unsubscribe = advanceDriver.subscribe(emitRequest);
    return waitPromise.finally(() => {
      unsubscribe();
    });
  }

  const requestTimer = setInterval(() => {
    emitRequest();
  }, intervalMs);

  return waitPromise.finally(() => {
    clearInterval(requestTimer);
  });
}

export function waitForState(
  socket: Socket,
  predicate: (payload: RoomStatePayload) => boolean,
  options: WaitForRequestedStateOptions = {},
): Promise<RoomStatePayload> {
  return waitForRequestedStateEvent<RoomStatePayload>(
    socket,
    'state',
    ['full'],
    predicate,
    {
      ...options,
      timeoutMessage:
        options.timeoutMessage ??
        'State condition not met in allotted attempts',
    },
  );
}

export function waitForRoomState(
  socket: Socket,
  roomId: string,
  predicate: (payload: RoomStatePayload) => boolean,
  options: Omit<WaitForRequestedStateOptions, 'roomId'> = {},
): Promise<RoomStatePayload> {
  return waitForState(socket, predicate, {
    ...options,
    roomId,
  });
}

export function waitForStateGrid(
  socket: Socket,
  predicate: (payload: RoomGridStatePayload) => boolean,
  options: WaitForRequestedStateOptions = {},
): Promise<RoomGridStatePayload> {
  return waitForRequestedStateEvent<RoomGridStatePayload>(
    socket,
    'state:grid',
    ['grid'],
    predicate,
    options,
  );
}

export function waitForStateStructures(
  socket: Socket,
  predicate: (payload: RoomStructuresStatePayload) => boolean,
  options: WaitForRequestedStateOptions = {},
): Promise<RoomStructuresStatePayload> {
  return waitForRequestedStateEvent<RoomStructuresStatePayload>(
    socket,
    'state:structures',
    ['structures'],
    predicate,
    options,
  );
}

export function waitForStateHashes(
  socket: Socket,
  predicate: (payload: RoomStateHashesPayload) => boolean,
  options: WaitForPredicateOptions = {},
): Promise<RoomStateHashesPayload> {
  return waitForEventWithPredicate(socket, 'state:hashes', predicate, options);
}

export function waitForRoomList(
  socket: Socket,
  predicate: (payload: RoomListEntryPayload[]) => boolean,
  options: WaitForPredicateOptions = {},
): Promise<RoomListEntryPayload[]> {
  return waitForEventWithPredicate(socket, 'room:list', predicate, {
    ...options,
    timeoutMessage:
      options.timeoutMessage ??
      'Room list condition not met in allotted attempts',
  });
}

export async function claimSlot(
  socket: Socket,
  slotId: string,
  timeoutMs = 2500,
): Promise<RoomSlotClaimedPayload> {
  const claimedPromise = waitForEvent<RoomSlotClaimedPayload>(
    socket,
    'room:slot-claimed',
    timeoutMs,
  );
  socket.emit('room:claim-slot', { slotId });
  const claimed = await claimedPromise;
  if (claimed.teamId === null) {
    throw new Error(`Expected slot claim for ${slotId} to assign a team`);
  }

  return claimed;
}

export function getTeamByPlayerId(
  state: Pick<RoomStatePayload, 'teams'>,
  playerId: string,
): TeamPayload {
  const team = state.teams.find(({ playerIds }) =>
    playerIds.includes(playerId),
  );
  if (!team) {
    throw new Error(`Unable to resolve team for player ${playerId}`);
  }

  return team;
}

function getTransformedTemplateSize(
  template: Pick<RoomJoinedPayload['templates'][number], 'width' | 'height'>,
  transform?: PlacementTransformInput,
): { width: number; height: number } {
  const { matrix } = normalizePlacementTransform(transform);
  const corners = [
    { x: 0, y: 0 },
    { x: template.width - 1, y: 0 },
    { x: 0, y: template.height - 1 },
    { x: template.width - 1, y: template.height - 1 },
  ];

  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    const projectedX = matrix.xx * corner.x + matrix.xy * corner.y;
    const projectedY = matrix.yx * corner.x + matrix.yy * corner.y;
    minX = Math.min(minX, projectedX);
    maxX = Math.max(maxX, projectedX);
    minY = Math.min(minY, projectedY);
    maxY = Math.max(maxY, projectedY);
  }

  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
}

export function collectCandidatePlacements(
  team: Pick<TeamPayload, 'baseTopLeft'>,
  template: Pick<RoomJoinedPayload['templates'][number], 'width' | 'height'>,
  roomWidth: number,
  roomHeight: number,
  options: CandidatePlacementOptions = {},
): Cell[] {
  const placements: Cell[] = [];
  const searchRadius = options.searchRadius ?? 10;
  const step = options.step ?? 2;
  const coreBuildZoneContributor = projectBuildZoneContributor({
    x: team.baseTopLeft.x,
    y: team.baseTopLeft.y,
    width: CORE_STRUCTURE_TEMPLATE.width,
    height: CORE_STRUCTURE_TEMPLATE.height,
    buildRadius: CORE_STRUCTURE_TEMPLATE.buildRadius,
  });
  const baseLeft = team.baseTopLeft.x;
  const baseTop = team.baseTopLeft.y;
  const baseRight = baseLeft + BASE_FOOTPRINT_WIDTH;
  const baseBottom = baseTop + BASE_FOOTPRINT_HEIGHT;
  const transformedSize = getTransformedTemplateSize(
    template,
    options.transform,
  );

  for (let y = -searchRadius; y <= searchRadius; y += step) {
    for (let x = -searchRadius; x <= searchRadius; x += step) {
      const buildX = team.baseTopLeft.x + x;
      const buildY = team.baseTopLeft.y + y;
      if (buildX < 0 || buildY < 0) {
        continue;
      }
      if (
        buildX + transformedSize.width > roomWidth ||
        buildY + transformedSize.height > roomHeight
      ) {
        continue;
      }

      const intersectsBase =
        buildX < baseRight &&
        buildX + transformedSize.width > baseLeft &&
        buildY < baseBottom &&
        buildY + transformedSize.height > baseTop;
      if (intersectsBase) {
        continue;
      }

      let fullyInsideBuildZone = true;
      for (let ty = 0; ty < transformedSize.height; ty += 1) {
        for (let tx = 0; tx < transformedSize.width; tx += 1) {
          if (
            !isBuildZoneCoveredByContributor(
              coreBuildZoneContributor,
              buildX + tx,
              buildY + ty,
            )
          ) {
            fullyInsideBuildZone = false;
            break;
          }
        }
        if (!fullyInsideBuildZone) {
          break;
        }
      }

      if (fullyInsideBuildZone) {
        placements.push({ x: buildX, y: buildY });
      }
    }
  }

  return placements;
}

function collectEventsByCount<T>(
  socket: Socket,
  event: string,
  count: number,
  timeoutMs = 8000,
  settleMs = 0,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const collected: T[] = [];
    let settleTimer: NodeJS.Timeout | null = null;

    function cleanup(): void {
      clearTimeout(timeout);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      socket.off(event, onEvent);
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out collecting ${event} events`));
    }, timeoutMs);

    function maybeResolve(): void {
      if (collected.length < count || settleTimer) {
        return;
      }

      if (settleMs <= 0) {
        cleanup();
        resolve(collected);
        return;
      }

      settleTimer = setTimeout(() => {
        cleanup();
        resolve(collected);
      }, settleMs);
    }

    function onEvent(payload: T): void {
      removeBufferedEvent(socket, event, payload);
      collected.push(payload);
      maybeResolve();
    }

    socket.on(event, onEvent);
  });
}

function collectOutcomesByEventId<T extends { eventId: number }>(
  socket: Socket,
  event: string,
  eventIds: number[],
  timeoutMs = 8000,
  settleMs = 0,
): Promise<Map<number, T[]>> {
  return new Promise((resolve, reject) => {
    const expected = new Set(eventIds);
    const outcomesById = new Map<number, T[]>();
    let settleTimer: NodeJS.Timeout | null = null;

    function cleanup(): void {
      clearTimeout(timeout);
      if (settleTimer) {
        clearTimeout(settleTimer);
      }
      socket.off(event, onEvent);
    }

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out collecting ${event} events`));
    }, timeoutMs);

    function maybeResolve(): void {
      if (expected.size > 0 || settleTimer) {
        return;
      }

      if (settleMs <= 0) {
        cleanup();
        resolve(outcomesById);
        return;
      }

      settleTimer = setTimeout(() => {
        cleanup();
        resolve(outcomesById);
      }, settleMs);
    }

    function onEvent(payload: T): void {
      removeBufferedEvent(socket, event, payload);

      if (
        !expected.has(payload.eventId) &&
        !outcomesById.has(payload.eventId)
      ) {
        return;
      }

      const current = outcomesById.get(payload.eventId) ?? [];
      current.push(payload);
      outcomesById.set(payload.eventId, current);
      expected.delete(payload.eventId);
      maybeResolve();
    }

    socket.on(event, onEvent);
    maybeResolve();
  });
}

export function collectBuildQueuedEvents(
  socket: Socket,
  count: number,
  timeoutMs = 8000,
  settleMs = 0,
): Promise<BuildQueuedPayload[]> {
  return collectEventsByCount<BuildQueuedPayload>(
    socket,
    'build:queued',
    count,
    timeoutMs,
    settleMs,
  );
}

export function collectBuildOutcomes(
  socket: Socket,
  eventIds: number[],
  timeoutMs = 8000,
  settleMs = 0,
): Promise<Map<number, BuildOutcomePayload[]>> {
  return collectOutcomesByEventId<BuildOutcomePayload>(
    socket,
    'build:outcome',
    eventIds,
    timeoutMs,
    settleMs,
  );
}

export function collectDestroyOutcomes(
  socket: Socket,
  eventIds: number[],
  timeoutMs = 8000,
  settleMs = 0,
): Promise<Map<number, DestroyOutcomePayload[]>> {
  return collectOutcomesByEventId<DestroyOutcomePayload>(
    socket,
    'destroy:outcome',
    eventIds,
    timeoutMs,
    settleMs,
  );
}

function waitForQueueResponse<
  TQueued extends { playerId: string },
  TRejected extends { reason: string; playerId: string },
>(
  socket: Socket,
  kind: 'build' | 'destroy',
  queuedEvent: 'build:queued' | 'destroy:queued',
  rejectedEvent: 'build:queue-rejected' | 'destroy:queue-rejected',
  timeoutMs: number,
  timeoutMessage: string,
): Promise<QueueResponse<TQueued, TRejected>> {
  acquireQueueResponseKind(socket, kind);

  return new Promise((resolve, reject) => {
    const expectedPlayerId =
      socketPlayerIds.get(socket) ?? socketSessionIds.get(socket);
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      socket.off(queuedEvent, onQueued);
      socket.off(rejectedEvent, onRejected);
      socket.off('room:error', onError);
      releaseQueueResponseKind(socket, kind);
    }

    function onQueued(payload: TQueued): void {
      if (expectedPlayerId && payload.playerId !== expectedPlayerId) {
        return;
      }

      removeBufferedEvent(socket, queuedEvent, payload);
      cleanup();
      resolve({ queued: payload });
    }

    function onError(payload: RoomErrorPayload): void {
      removeBufferedEvent(socket, 'room:error', payload);
      cleanup();
      resolve({ error: payload });
    }

    function onRejected(payload: TRejected): void {
      if (expectedPlayerId && payload.playerId !== expectedPlayerId) {
        return;
      }

      removeBufferedEvent(socket, rejectedEvent, payload);
      cleanup();
      resolve({ error: payload as QueueErrorPayload<TRejected> });
    }

    socket.on(queuedEvent, onQueued);
    socket.on(rejectedEvent, onRejected);
    socket.once('room:error', onError);
  });
}

export function waitForBuildQueueResponse(
  socket: Socket,
  timeoutMs = 2500,
): Promise<QueueResponse<BuildQueuedPayload, BuildQueueRejectedPayload>> {
  return waitForQueueResponse<BuildQueuedPayload, BuildQueueRejectedPayload>(
    socket,
    'build',
    'build:queued',
    'build:queue-rejected',
    timeoutMs,
    'Timed out waiting for build queue response',
  );
}

async function expectQueueRejected<
  TQueued extends { playerId: string },
  TRejected extends { reason: string; playerId: string },
>(
  socket: Socket,
  rejectedEvent: 'build:queue-rejected' | 'destroy:queue-rejected',
  queueResponsePromise: Promise<QueueResponse<TQueued, TRejected>>,
  trigger: () => void,
  timeoutMs: number,
  queuedMessage: string,
): Promise<TRejected> {
  const rejectedPromise = waitForEvent<TRejected>(
    socket,
    rejectedEvent,
    timeoutMs,
  );
  trigger();

  const [response, rejected] = await Promise.all([
    queueResponsePromise,
    rejectedPromise,
  ]);
  if ('queued' in response) {
    throw new Error(queuedMessage);
  }
  if (response.error.reason !== rejected.reason) {
    throw new Error(
      `Queue rejection mismatch: helper saw ${response.error.reason}, event emitted ${rejected.reason}`,
    );
  }

  return rejected;
}

export function expectBuildQueueRejected(
  socket: Socket,
  trigger: () => void,
  timeoutMs = 2500,
): Promise<BuildQueueRejectedPayload> {
  return expectQueueRejected<BuildQueuedPayload, BuildQueueRejectedPayload>(
    socket,
    'build:queue-rejected',
    waitForBuildQueueResponse(socket, timeoutMs),
    trigger,
    timeoutMs,
    'Expected build queue request to be rejected',
  );
}

export function waitForDestroyQueueResponse(
  socket: Socket,
  timeoutMs = 2500,
): Promise<QueueResponse<DestroyQueuedPayload, DestroyQueueRejectedPayload>> {
  return waitForQueueResponse<
    DestroyQueuedPayload,
    DestroyQueueRejectedPayload
  >(
    socket,
    'destroy',
    'destroy:queued',
    'destroy:queue-rejected',
    timeoutMs,
    'Timed out waiting for destroy queue response',
  );
}

export function expectDestroyQueueRejected(
  socket: Socket,
  trigger: () => void,
  timeoutMs = 2500,
): Promise<DestroyQueueRejectedPayload> {
  return expectQueueRejected<DestroyQueuedPayload, DestroyQueueRejectedPayload>(
    socket,
    'destroy:queue-rejected',
    waitForDestroyQueueResponse(socket, timeoutMs),
    trigger,
    timeoutMs,
    'Expected destroy queue request to be rejected',
  );
}

function waitForOutcomeByEventId<T extends { eventId: number }>(
  socket: Socket,
  event: 'build:outcome' | 'destroy:outcome',
  eventId: number,
  timeoutMs: number,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onOutcome);
      reject(new Error(`Timed out waiting for ${event} for event ${eventId}`));
    }, timeoutMs);

    function onOutcome(payload: T): void {
      removeBufferedEvent(socket, event, payload);

      if (payload.eventId !== eventId) {
        return;
      }

      clearTimeout(timer);
      socket.off(event, onOutcome);
      resolve(payload);
    }

    socket.on(event, onOutcome);
  });
}

export function waitForBuildOutcome(
  socket: Socket,
  eventId: number,
  timeoutMs = 12_000,
): Promise<BuildOutcomePayload> {
  return waitForOutcomeByEventId<BuildOutcomePayload>(
    socket,
    'build:outcome',
    eventId,
    timeoutMs,
  );
}

export function waitForDestroyOutcome(
  socket: Socket,
  eventId: number,
  timeoutMs = 12_000,
): Promise<DestroyOutcomePayload> {
  return waitForOutcomeByEventId<DestroyOutcomePayload>(
    socket,
    'destroy:outcome',
    eventId,
    timeoutMs,
  );
}
