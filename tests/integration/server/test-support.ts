import { io, type Socket } from 'socket.io-client';

import type {
  BuildOutcomePayload,
  BuildQueuedPayload,
  DestroyOutcomePayload,
  DestroyQueuedPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  RoomStatePayload,
  TeamPayload,
} from '#rts-engine';

export interface TestClientOptions {
  sessionId?: string;
}

export interface WaitForPredicateOptions {
  attempts?: number;
  timeoutMs?: number;
  overallTimeoutMs?: number;
  timeoutMessage?: string;
}

export interface WaitForStateOptions extends WaitForPredicateOptions {
  roomId?: string;
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
  const socket = io(`http://localhost:${port}`, {
    autoConnect: false,
    transports: ['websocket'],
    auth: options.sessionId ? { sessionId: options.sessionId } : undefined,
  });
  socket.connect();
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

  if (overallTimeoutMs <= 0) {
    return Promise.reject(new Error(timeoutMessage));
  }

  return new Promise((resolve, reject) => {
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
  const { roomId, ...waitOptions } = options;
  return waitForEventWithPredicate(
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
