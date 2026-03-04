import { afterEach, describe, expect, test, vi } from 'vitest';

import { LobbySessionCoordinator } from './lobby-session.js';

describe('LobbySessionCoordinator', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('normalizes requested session id and falls back for invalid values', () => {
    const coordinator = new LobbySessionCoordinator();

    const normalized = coordinator.attachSocket({
      requestedSessionId: '  player-1  ',
      fallbackSessionId: 'guest-1',
      fallbackName: 'Player 1',
      socketId: 'socket-1',
    });
    expect(normalized.session.id).toBe('player-1');
    expect(normalized.replacedSocketId).toBeNull();

    const fallback = coordinator.attachSocket({
      requestedSessionId: null,
      fallbackSessionId: 'guest-2',
      fallbackName: 'Player 2',
      socketId: 'socket-2',
    });
    expect(fallback.session.id).toBe('guest-2');
    expect(fallback.replacedSocketId).toBeNull();
  });

  test('reports replaced socket when a session reconnects', () => {
    const coordinator = new LobbySessionCoordinator();

    coordinator.attachSocket({
      requestedSessionId: 'player-1',
      fallbackSessionId: 'guest-1',
      fallbackName: 'Player 1',
      socketId: 'socket-1',
    });

    const reconnect = coordinator.attachSocket({
      requestedSessionId: 'player-1',
      fallbackSessionId: 'guest-2',
      fallbackName: 'Player 2',
      socketId: 'socket-2',
    });

    expect(reconnect.replacedSocketId).toBe('socket-1');
    expect(reconnect.session.socketId).toBe('socket-2');
    expect(reconnect.session.connected).toBe(true);
  });

  test('creates reconnect hold and expires it on timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    let nowMs = 1_000;
    const coordinator = new LobbySessionCoordinator({
      holdMs: 5_000,
      now: () => nowMs,
    });

    coordinator.attachSocket({
      requestedSessionId: 'player-1',
      fallbackSessionId: 'guest-1',
      fallbackName: 'Player 1',
      socketId: 'socket-1',
    });
    coordinator.setRoom('player-1', 'room-1');

    const onExpire = vi.fn();
    const hold = coordinator.holdOnDisconnect({
      sessionId: 'player-1',
      socketId: 'socket-1',
      roomId: 'room-1',
      slotId: 'team-1',
      disconnectReason: 'transport close',
      onExpire,
    });

    expect(hold).not.toBeNull();
    expect(coordinator.getHold('player-1')?.expiresAt).toBe(6_000);
    expect(coordinator.getHeldSessionForSlot('room-1', 'team-1')).toBe(
      'player-1',
    );

    const sessionDuringHold = coordinator.getSession('player-1');
    expect(sessionDuringHold?.connected).toBe(false);
    expect(sessionDuringHold?.heldSlotId).toBe('team-1');
    expect(sessionDuringHold?.holdExpiresAt).toBe(6_000);
    expect(sessionDuringHold?.disconnectReason).toBe('transport close');

    nowMs = 6_000;
    await vi.advanceTimersByTimeAsync(5_000);

    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'player-1',
        roomId: 'room-1',
        slotId: 'team-1',
      }),
    );
    expect(coordinator.getHold('player-1')).toBeNull();
    expect(coordinator.getHeldSessionForSlot('room-1', 'team-1')).toBeNull();

    const sessionAfterHold = coordinator.getSession('player-1');
    expect(sessionAfterHold?.heldSlotId).toBeNull();
    expect(sessionAfterHold?.holdExpiresAt).toBeNull();
    expect(sessionAfterHold?.disconnectReason).toBeNull();
  });

  test('clearing a hold cancels its expiration callback', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    const coordinator = new LobbySessionCoordinator({
      holdMs: 5_000,
      now: () => 10_000,
    });

    coordinator.attachSocket({
      requestedSessionId: 'player-1',
      fallbackSessionId: 'guest-1',
      fallbackName: 'Player 1',
      socketId: 'socket-1',
    });
    coordinator.setRoom('player-1', 'room-1');

    const onExpire = vi.fn();
    coordinator.holdOnDisconnect({
      sessionId: 'player-1',
      socketId: 'socket-1',
      roomId: 'room-1',
      slotId: 'team-1',
      disconnectReason: null,
      onExpire,
    });

    const cleared = coordinator.clearHold('player-1');
    expect(cleared).not.toBeNull();
    expect(coordinator.getHold('player-1')).toBeNull();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(onExpire).not.toHaveBeenCalled();
  });

  test('prunes disconnected sessions when they have no room or hold', () => {
    const coordinator = new LobbySessionCoordinator({ now: () => 10_000 });

    coordinator.attachSocket({
      requestedSessionId: 'player-1',
      fallbackSessionId: 'guest-1',
      fallbackName: 'Player 1',
      socketId: 'socket-1',
    });

    coordinator.pruneSession('player-1');
    expect(coordinator.getSession('player-1')).not.toBeNull();

    coordinator.markSocketDisconnected('player-1', 'socket-1', null);
    coordinator.pruneSession('player-1');
    expect(coordinator.getSession('player-1')).toBeNull();
  });
});
