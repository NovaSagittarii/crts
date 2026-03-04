export const RECONNECT_HOLD_MS = 30_000;

const MAX_SESSION_ID_LENGTH = 64;

type TimeoutHandle = ReturnType<typeof setTimeout>;

type SetTimeoutHook = (callback: () => void, delayMs: number) => TimeoutHandle;

type ClearTimeoutHook = (timer: TimeoutHandle) => void;

export interface PlayerSession {
  id: string;
  name: string;
  socketId: string | null;
  roomId: string | null;
  connected: boolean;
  disconnectedAt: number | null;
  holdExpiresAt: number | null;
  heldSlotId: string | null;
  disconnectReason: string | null;
}

export interface SessionHold {
  sessionId: string;
  roomId: string;
  slotId: string;
  disconnectedAt: number;
  expiresAt: number;
  disconnectReason: string | null;
}

interface ActiveHold {
  hold: SessionHold;
  timer: TimeoutHandle;
}

interface AttachSocketDirectoryInput {
  sessionId: string;
  fallbackName: string;
  socketId: string;
}

interface AttachSocketInput {
  requestedSessionId: unknown;
  fallbackSessionId: string;
  fallbackName: string;
  socketId: string;
}

interface HoldDisconnectInput {
  sessionId: string;
  socketId: string;
  roomId: string;
  slotId: string;
  disconnectReason: string | null;
  onExpire: (hold: SessionHold) => void;
}

interface CoordinatorOptions {
  holdMs?: number;
  now?: () => number;
  setTimeout?: SetTimeoutHook;
  clearTimeout?: ClearTimeoutHook;
}

export interface AttachSocketResult {
  session: PlayerSession;
  replacedSocketId: string | null;
}

interface HoldRegistryOptions {
  holdMs: number;
  setTimeout: SetTimeoutHook;
  clearTimeout: ClearTimeoutHook;
}

class SessionDirectory {
  private readonly sessions = new Map<string, PlayerSession>();

  private readonly socketToSession = new Map<string, string>();

  public attachSocket(input: AttachSocketDirectoryInput): AttachSocketResult {
    const existing = this.sessions.get(input.sessionId);

    if (!existing) {
      const session: PlayerSession = {
        id: input.sessionId,
        name: input.fallbackName,
        socketId: input.socketId,
        roomId: null,
        connected: true,
        disconnectedAt: null,
        holdExpiresAt: null,
        heldSlotId: null,
        disconnectReason: null,
      };
      this.sessions.set(input.sessionId, session);
      this.socketToSession.set(input.socketId, input.sessionId);
      return {
        session,
        replacedSocketId: null,
      };
    }

    const replacedSocketId =
      existing.socketId && existing.socketId !== input.socketId
        ? existing.socketId
        : null;

    if (replacedSocketId) {
      this.socketToSession.delete(replacedSocketId);
    }

    existing.socketId = input.socketId;
    existing.connected = true;
    existing.disconnectedAt = null;
    existing.disconnectReason = null;
    this.socketToSession.set(input.socketId, existing.id);

    return {
      session: existing,
      replacedSocketId,
    };
  }

  public getSession(sessionId: string): PlayerSession | null {
    return this.sessions.get(sessionId) ?? null;
  }

  public isCurrentSocket(sessionId: string, socketId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return false;
    }
    return session.socketId === socketId;
  }

  public setRoom(sessionId: string, roomId: string | null): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.roomId = roomId;
    if (!roomId) {
      this.clearHoldMetadata(sessionId);
    }
  }

  public setDisplayName(sessionId: string, name: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.name = name;
  }

  public markDisconnectedForHold(
    sessionId: string,
    socketId: string,
    roomId: string,
    disconnectedAt: number,
    disconnectReason: string | null,
  ): PlayerSession | null {
    const session = this.sessions.get(sessionId);
    if (!session || session.socketId !== socketId) {
      return null;
    }

    this.socketToSession.delete(socketId);
    session.socketId = null;
    session.connected = false;
    session.roomId = roomId;
    session.disconnectedAt = disconnectedAt;
    session.disconnectReason = disconnectReason;
    return session;
  }

  public markSocketDisconnected(
    sessionId: string,
    socketId: string,
    disconnectedAt: number,
    disconnectReason: string | null,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.socketId !== socketId) {
      return;
    }

    this.socketToSession.delete(socketId);
    session.socketId = null;
    session.connected = false;
    session.disconnectedAt = disconnectedAt;
    session.disconnectReason = disconnectReason;
  }

  public isSessionConnected(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.connected ?? false;
  }

  public clearHoldMetadata(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.heldSlotId = null;
    session.holdExpiresAt = null;
    session.disconnectReason = null;
  }

  public applyHoldMetadata(
    sessionId: string,
    slotId: string,
    expiresAt: number,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    session.heldSlotId = slotId;
    session.holdExpiresAt = expiresAt;
  }

  public releaseSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.socketId) {
      this.socketToSession.delete(session.socketId);
    }

    session.roomId = null;
    session.connected = false;
    session.disconnectedAt = null;
    session.socketId = null;
    session.heldSlotId = null;
    session.holdExpiresAt = null;
    session.disconnectReason = null;
  }

  public pruneSession(sessionId: string, hasActiveHold: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.connected || session.roomId || hasActiveHold) {
      return;
    }

    this.sessions.delete(sessionId);
  }
}

class ReconnectHoldRegistry {
  private readonly holdMs: number;

  private readonly setTimeoutHook: SetTimeoutHook;

  private readonly clearTimeoutHook: ClearTimeoutHook;

  private readonly holdsBySession = new Map<string, ActiveHold>();

  private readonly heldSlots = new Map<string, string>();

  public constructor(options: HoldRegistryOptions) {
    this.holdMs = options.holdMs;
    this.setTimeoutHook = options.setTimeout;
    this.clearTimeoutHook = options.clearTimeout;
  }

  public scheduleHold(
    hold: SessionHold,
    onExpire: (hold: SessionHold) => void,
  ): void {
    this.clearHold(hold.sessionId);

    const slotKey = this.slotKey(hold.roomId, hold.slotId);
    const timer = this.setTimeoutHook(() => {
      const active = this.holdsBySession.get(hold.sessionId);
      if (!active || active.hold.expiresAt !== hold.expiresAt) {
        return;
      }

      this.holdsBySession.delete(hold.sessionId);
      this.heldSlots.delete(slotKey);
      onExpire(hold);
    }, this.holdMs);

    this.holdsBySession.set(hold.sessionId, { hold, timer });
    this.heldSlots.set(slotKey, hold.sessionId);
  }

  public clearHold(sessionId: string): SessionHold | null {
    const active = this.holdsBySession.get(sessionId);
    if (!active) {
      return null;
    }

    this.clearTimeoutHook(active.timer);
    this.holdsBySession.delete(sessionId);
    this.heldSlots.delete(this.slotKey(active.hold.roomId, active.hold.slotId));
    return active.hold;
  }

  public getHold(sessionId: string): SessionHold | null {
    return this.holdsBySession.get(sessionId)?.hold ?? null;
  }

  public hasHold(sessionId: string): boolean {
    return this.holdsBySession.has(sessionId);
  }

  public getHeldSessionForSlot(roomId: string, slotId: string): string | null {
    return this.heldSlots.get(this.slotKey(roomId, slotId)) ?? null;
  }

  public hasPendingHoldForRoom(roomId: string): boolean {
    for (const { hold } of this.holdsBySession.values()) {
      if (hold.roomId === roomId) {
        return true;
      }
    }

    return false;
  }

  public stop(): void {
    for (const active of this.holdsBySession.values()) {
      this.clearTimeoutHook(active.timer);
    }

    this.holdsBySession.clear();
    this.heldSlots.clear();
  }

  private slotKey(roomId: string, slotId: string): string {
    return `${roomId}:${slotId}`;
  }
}

export class LobbySessionCoordinator {
  private readonly holdMs: number;

  private readonly now: () => number;

  private readonly sessions: SessionDirectory;

  private readonly holds: ReconnectHoldRegistry;

  public constructor(options: CoordinatorOptions = {}) {
    this.holdMs = options.holdMs ?? RECONNECT_HOLD_MS;
    this.now = options.now ?? (() => Date.now());
    const setTimeoutHook =
      options.setTimeout ??
      ((callback, delayMs) => setTimeout(callback, delayMs));
    const clearTimeoutHook =
      options.clearTimeout ?? ((timer) => clearTimeout(timer));
    this.sessions = new SessionDirectory();
    this.holds = new ReconnectHoldRegistry({
      holdMs: this.holdMs,
      setTimeout: setTimeoutHook,
      clearTimeout: clearTimeoutHook,
    });
  }

  public attachSocket(input: AttachSocketInput): AttachSocketResult {
    const sessionId = this.normalizeSessionId(
      input.requestedSessionId,
      input.fallbackSessionId,
    );
    return this.sessions.attachSocket({
      sessionId,
      fallbackName: input.fallbackName,
      socketId: input.socketId,
    });
  }

  public getSession(sessionId: string): PlayerSession | null {
    return this.sessions.getSession(sessionId);
  }

  public isCurrentSocket(sessionId: string, socketId: string): boolean {
    return this.sessions.isCurrentSocket(sessionId, socketId);
  }

  public setRoom(sessionId: string, roomId: string | null): void {
    this.sessions.setRoom(sessionId, roomId);
  }

  public setDisplayName(sessionId: string, name: string): void {
    this.sessions.setDisplayName(sessionId, name);
  }

  public holdOnDisconnect(input: HoldDisconnectInput): SessionHold | null {
    const disconnectedAt = this.now();
    const session = this.sessions.markDisconnectedForHold(
      input.sessionId,
      input.socketId,
      input.roomId,
      disconnectedAt,
      input.disconnectReason,
    );
    if (!session) {
      return null;
    }

    const expiresAt = disconnectedAt + this.holdMs;
    const hold: SessionHold = {
      sessionId: input.sessionId,
      roomId: input.roomId,
      slotId: input.slotId,
      disconnectedAt,
      expiresAt,
      disconnectReason: input.disconnectReason,
    };

    this.clearHold(input.sessionId);

    this.holds.scheduleHold(hold, (expiredHold) => {
      this.sessions.clearHoldMetadata(expiredHold.sessionId);
      input.onExpire(expiredHold);
    });
    this.sessions.applyHoldMetadata(
      input.sessionId,
      hold.slotId,
      hold.expiresAt,
    );

    return hold;
  }

  public markSocketDisconnected(
    sessionId: string,
    socketId: string,
    disconnectReason: string | null = null,
  ): void {
    this.sessions.markSocketDisconnected(
      sessionId,
      socketId,
      this.now(),
      disconnectReason,
    );
  }

  public isSessionConnected(sessionId: string): boolean {
    return this.sessions.isSessionConnected(sessionId);
  }

  public clearHold(sessionId: string): SessionHold | null {
    const hold = this.holds.clearHold(sessionId);
    if (!hold) {
      return null;
    }

    this.sessions.clearHoldMetadata(sessionId);
    return hold;
  }

  public getHold(sessionId: string): SessionHold | null {
    return this.holds.getHold(sessionId);
  }

  public getHeldSessionForSlot(roomId: string, slotId: string): string | null {
    return this.holds.getHeldSessionForSlot(roomId, slotId);
  }

  public hasPendingHoldForRoom(roomId: string): boolean {
    return this.holds.hasPendingHoldForRoom(roomId);
  }

  public releaseSession(sessionId: string): void {
    this.clearHold(sessionId);
    this.sessions.releaseSession(sessionId);
  }

  public pruneSession(sessionId: string): void {
    this.sessions.pruneSession(sessionId, this.holds.hasHold(sessionId));
  }

  public stop(): void {
    this.holds.stop();
  }

  private normalizeSessionId(value: unknown, fallback: string): string {
    if (typeof value !== 'string') {
      return fallback;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return fallback;
    }

    return trimmed.slice(0, MAX_SESSION_ID_LENGTH);
  }
}
