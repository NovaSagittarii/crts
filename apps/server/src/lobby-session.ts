export const RECONNECT_HOLD_MS = 30_000;

const MAX_SESSION_ID_LENGTH = 64;

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
  timer: NodeJS.Timeout;
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
}

export interface AttachSocketResult {
  session: PlayerSession;
  replacedSocketId: string | null;
}

export class LobbySessionCoordinator {
  private readonly holdMs: number;

  private readonly now: () => number;

  private readonly sessions = new Map<string, PlayerSession>();

  private readonly socketToSession = new Map<string, string>();

  private readonly holdsBySession = new Map<string, ActiveHold>();

  private readonly heldSlots = new Map<string, string>();

  public constructor(options: CoordinatorOptions = {}) {
    this.holdMs = options.holdMs ?? RECONNECT_HOLD_MS;
    this.now = options.now ?? (() => Date.now());
  }

  public attachSocket(input: AttachSocketInput): AttachSocketResult {
    const sessionId = this.normalizeSessionId(
      input.requestedSessionId,
      input.fallbackSessionId,
    );
    const existing = this.sessions.get(sessionId);

    if (!existing) {
      const session: PlayerSession = {
        id: sessionId,
        name: input.fallbackName,
        socketId: input.socketId,
        roomId: null,
        connected: true,
        disconnectedAt: null,
        holdExpiresAt: null,
        heldSlotId: null,
        disconnectReason: null,
      };
      this.sessions.set(sessionId, session);
      this.socketToSession.set(input.socketId, sessionId);
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
      session.heldSlotId = null;
      session.holdExpiresAt = null;
      session.disconnectReason = null;
    }
  }

  public setDisplayName(sessionId: string, name: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }
    session.name = name;
  }

  public holdOnDisconnect(input: HoldDisconnectInput): SessionHold | null {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      return null;
    }

    if (session.socketId !== input.socketId) {
      return null;
    }

    this.socketToSession.delete(input.socketId);
    session.socketId = null;
    session.connected = false;
    session.roomId = input.roomId;
    session.disconnectedAt = this.now();
    session.disconnectReason = input.disconnectReason;

    const disconnectedAt = session.disconnectedAt;
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

    const slotKey = this.slotKey(hold.roomId, hold.slotId);
    const timer = setTimeout(() => {
      const active = this.holdsBySession.get(hold.sessionId);
      if (!active || active.hold.expiresAt !== hold.expiresAt) {
        return;
      }

      this.holdsBySession.delete(hold.sessionId);
      this.heldSlots.delete(slotKey);

      const activeSession = this.sessions.get(hold.sessionId);
      if (activeSession) {
        activeSession.heldSlotId = null;
        activeSession.holdExpiresAt = null;
        activeSession.disconnectReason = null;
      }

      input.onExpire(hold);
    }, this.holdMs);

    this.holdsBySession.set(hold.sessionId, { hold, timer });
    this.heldSlots.set(slotKey, hold.sessionId);
    session.heldSlotId = hold.slotId;
    session.holdExpiresAt = hold.expiresAt;

    return hold;
  }

  public markSocketDisconnected(
    sessionId: string,
    socketId: string,
    disconnectReason: string | null = null,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.socketId !== socketId) {
      return;
    }

    this.socketToSession.delete(socketId);
    session.socketId = null;
    session.connected = false;
    session.disconnectedAt = this.now();
    session.disconnectReason = disconnectReason;
  }

  public isSessionConnected(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.connected ?? false;
  }

  public clearHold(sessionId: string): SessionHold | null {
    const active = this.holdsBySession.get(sessionId);
    if (!active) {
      return null;
    }

    clearTimeout(active.timer);
    this.holdsBySession.delete(sessionId);
    this.heldSlots.delete(this.slotKey(active.hold.roomId, active.hold.slotId));

    const session = this.sessions.get(sessionId);
    if (session) {
      session.heldSlotId = null;
      session.holdExpiresAt = null;
      session.disconnectReason = null;
    }

    return active.hold;
  }

  public getHold(sessionId: string): SessionHold | null {
    return this.holdsBySession.get(sessionId)?.hold ?? null;
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

  public releaseSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (session.socketId) {
      this.socketToSession.delete(session.socketId);
    }

    this.clearHold(sessionId);
    session.roomId = null;
    session.connected = false;
    session.disconnectedAt = null;
    session.socketId = null;
    session.heldSlotId = null;
    session.holdExpiresAt = null;
    session.disconnectReason = null;
  }

  public pruneSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return;
    }

    if (
      session.connected ||
      session.roomId ||
      this.holdsBySession.has(sessionId)
    ) {
      return;
    }

    this.sessions.delete(sessionId);
  }

  public stop(): void {
    for (const active of this.holdsBySession.values()) {
      clearTimeout(active.timer);
    }

    this.holdsBySession.clear();
    this.heldSlots.clear();
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

  private slotKey(roomId: string, slotId: string): string {
    return `${roomId}:${slotId}`;
  }
}
