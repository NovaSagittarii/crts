import { io, type Socket } from 'socket.io-client';

import {
  BASE_FOOTPRINT_HEIGHT,
  BASE_FOOTPRINT_WIDTH,
  BUILD_ZONE_RADIUS,
  getBaseCenter,
  normalizePlacementTransform,
} from '#rts-engine';
import type {
  BuildOutcomePayload,
  BuildQueuedPayload,
  BuildScheduledPayload,
  DestroyOutcomePayload,
  DestroyQueuedPayload,
  DestroyScheduledPayload,
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

export type QueueResponse<TQueued> =
  | { queued: TQueued }
  | { error: RoomErrorPayload };

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
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    function onEvent(payload: T): void {
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
  socket.emit('state:request', {
    sections,
  } satisfies StateRequestPayload);
  const requestTimer = setInterval(() => {
    socket.emit('state:request', {
      sections,
    } satisfies StateRequestPayload);
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
  const baseCenter = getBaseCenter(team.baseTopLeft);
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
          const dx = buildX + tx - baseCenter.x;
          const dy = buildY + ty - baseCenter.y;
          if (dx * dx + dy * dy > BUILD_ZONE_RADIUS * BUILD_ZONE_RADIUS) {
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

export function collectBuildScheduledEvents(
  socket: Socket,
  count: number,
  timeoutMs = 8000,
  settleMs = 0,
): Promise<BuildScheduledPayload[]> {
  return collectEventsByCount<BuildScheduledPayload>(
    socket,
    'build:scheduled',
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

function waitForQueueResponse<TQueued>(
  socket: Socket,
  queuedEvent: 'build:queued' | 'destroy:queued',
  timeoutMs: number,
  timeoutMessage: string,
): Promise<QueueResponse<TQueued>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(timeoutMessage));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      socket.off(queuedEvent, onQueued);
      socket.off('room:error', onError);
    }

    function onQueued(payload: TQueued): void {
      cleanup();
      resolve({ queued: payload });
    }

    function onError(payload: RoomErrorPayload): void {
      cleanup();
      resolve({ error: payload });
    }

    socket.once(queuedEvent, onQueued);
    socket.once('room:error', onError);
  });
}

export function waitForBuildQueueResponse(
  socket: Socket,
  timeoutMs = 2500,
): Promise<QueueResponse<BuildQueuedPayload>> {
  return waitForQueueResponse<BuildQueuedPayload>(
    socket,
    'build:queued',
    timeoutMs,
    'Timed out waiting for build queue response',
  );
}

export function waitForBuildScheduled(
  socket: Socket,
  timeoutMs = 2500,
): Promise<BuildScheduledPayload> {
  return waitForEvent(socket, 'build:scheduled', timeoutMs);
}

export function waitForDestroyQueueResponse(
  socket: Socket,
  timeoutMs = 2500,
): Promise<QueueResponse<DestroyQueuedPayload>> {
  return waitForQueueResponse<DestroyQueuedPayload>(
    socket,
    'destroy:queued',
    timeoutMs,
    'Timed out waiting for destroy queue response',
  );
}

export function waitForDestroyScheduled(
  socket: Socket,
  timeoutMs = 2500,
): Promise<DestroyScheduledPayload> {
  return waitForEvent(socket, 'destroy:scheduled', timeoutMs);
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
