import { io, type Socket } from 'socket.io-client';

import type {
  BuildOutcomePayload,
  BuildQueuedPayload,
  BuildScheduledPayload,
  DestroyOutcomePayload,
  DestroyQueuedPayload,
  DestroyScheduledPayload,
  RoomErrorPayload,
  RoomGridStatePayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
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

export interface WaitForStateOptions extends WaitForPredicateOptions {
  roomId?: string;
  autoRequest?: boolean;
  requestIntervalMs?: number;
}

export interface WaitForStateSectionOptions extends WaitForPredicateOptions {
  roomId?: string;
  autoRequest?: boolean;
  requestIntervalMs?: number;
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

export function waitForState(
  socket: Socket,
  predicate: (payload: RoomStatePayload) => boolean,
  options: WaitForStateOptions = {},
): Promise<RoomStatePayload> {
  const {
    roomId,
    autoRequest = true,
    requestIntervalMs = 120,
    ...waitOptions
  } = options;

  const waitPromise = waitForEventWithPredicate<RoomStatePayload>(
    socket,
    'state',
    (payload) =>
      (roomId === undefined || payload.roomId === roomId) && predicate(payload),
    {
      ...waitOptions,
      timeoutMessage:
        waitOptions.timeoutMessage ??
        'State condition not met in allotted attempts',
    },
  );

  if (!autoRequest) {
    return waitPromise;
  }

  const intervalMs = Math.max(20, Math.floor(requestIntervalMs));
  socket.emit('state:request', {
    sections: ['full'],
  } satisfies StateRequestPayload);
  const requestTimer = setInterval(() => {
    socket.emit('state:request', {
      sections: ['full'],
    } satisfies StateRequestPayload);
  }, intervalMs);

  return waitPromise.finally(() => {
    clearInterval(requestTimer);
  });
}

function waitForStateSection<T>(
  socket: Socket,
  event: 'state:grid' | 'state:structures',
  section: 'grid' | 'structures',
  predicate: (payload: T) => boolean,
  options: WaitForStateSectionOptions = {},
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
      if (!roomId) {
        return predicate(payload);
      }

      const roomPayload = payload as { roomId?: string };
      return roomPayload.roomId === roomId && predicate(payload);
    },
    waitOptions,
  );

  if (!autoRequest) {
    return waitPromise;
  }

  const intervalMs = Math.max(20, Math.floor(requestIntervalMs));
  socket.emit('state:request', {
    sections: [section],
  } satisfies StateRequestPayload);
  const requestTimer = setInterval(() => {
    socket.emit('state:request', {
      sections: [section],
    } satisfies StateRequestPayload);
  }, intervalMs);

  return waitPromise.finally(() => {
    clearInterval(requestTimer);
  });
}

export function waitForStateGrid(
  socket: Socket,
  predicate: (payload: RoomGridStatePayload) => boolean,
  options: WaitForStateSectionOptions = {},
): Promise<RoomGridStatePayload> {
  return waitForStateSection<RoomGridStatePayload>(
    socket,
    'state:grid',
    'grid',
    predicate,
    options,
  );
}

export function waitForStateStructures(
  socket: Socket,
  predicate: (payload: RoomStructuresStatePayload) => boolean,
  options: WaitForStateSectionOptions = {},
): Promise<RoomStructuresStatePayload> {
  return waitForStateSection<RoomStructuresStatePayload>(
    socket,
    'state:structures',
    'structures',
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
