import { describe, expect, test } from 'vitest';

import {
  claimLobbySlot,
  createLobbyRoom,
  getLobbySnapshot,
  joinLobby,
  leaveLobby,
  setLobbyReady,
} from '../src/lobby.js';

describe('lobby', () => {
  test('supports two player slots with spectator overflow', () => {
    const lobby = createLobbyRoom({
      roomId: 'room-1',
      slotIds: ['team-1', 'team-2'],
    });

    joinLobby(lobby, { sessionId: 'p1', displayName: 'Alice' });
    joinLobby(lobby, { sessionId: 'p2', displayName: 'Bob' });
    joinLobby(lobby, { sessionId: 'p3', displayName: 'Cara' });

    expect(claimLobbySlot(lobby, 'p1', 'team-1').ok).toBe(true);
    expect(claimLobbySlot(lobby, 'p2', 'team-2').ok).toBe(true);

    const fullSlot = claimLobbySlot(lobby, 'p3', 'team-1');
    expect(fullSlot.ok).toBe(false);
    expect(fullSlot.reason).toBe('slot-full');
    expect(fullSlot.message).toMatch(/full/i);

    const snapshot = getLobbySnapshot(lobby);
    const spectator = snapshot.participants.find(
      ({ sessionId }) => sessionId === 'p3',
    );
    expect(spectator?.role).toBe('spectator');
    expect(spectator?.slotId).toBeNull();
  });

  test('rejects team switching after a slot is claimed', () => {
    const lobby = createLobbyRoom({
      roomId: 'room-2',
      slotIds: ['team-1', 'team-2'],
    });
    joinLobby(lobby, { sessionId: 'p1', displayName: 'Alice' });

    expect(claimLobbySlot(lobby, 'p1', 'team-1').ok).toBe(true);

    const teamSwitch = claimLobbySlot(lobby, 'p1', 'team-2');
    expect(teamSwitch.ok).toBe(false);
    expect(teamSwitch.reason).toBe('team-switch-locked');
  });

  test('supports explicit manual ready toggles for players', () => {
    const lobby = createLobbyRoom({
      roomId: 'room-3',
      slotIds: ['team-1', 'team-2'],
    });

    joinLobby(lobby, { sessionId: 'p1', displayName: 'Alice' });
    joinLobby(lobby, { sessionId: 'p2', displayName: 'Bob' });

    expect(claimLobbySlot(lobby, 'p1', 'team-1').ok).toBe(true);

    const spectatorReady = setLobbyReady(lobby, 'p2', true);
    expect(spectatorReady.ok).toBe(false);
    expect(spectatorReady.reason).toBe('not-player');

    expect(setLobbyReady(lobby, 'p1', true).ok).toBe(true);
    expect(setLobbyReady(lobby, 'p1', false).ok).toBe(true);

    const snapshot = getLobbySnapshot(lobby);
    const player = snapshot.participants.find(
      ({ sessionId }) => sessionId === 'p1',
    );
    expect(player?.ready).toBe(false);
  });

  test('transfers host deterministically by join order', () => {
    const lobby = createLobbyRoom({
      roomId: 'room-4',
      slotIds: ['team-1', 'team-2'],
    });

    joinLobby(lobby, { sessionId: 'p1', displayName: 'Alice' });
    joinLobby(lobby, { sessionId: 'p2', displayName: 'Bob' });
    joinLobby(lobby, { sessionId: 'p3', displayName: 'Cara' });

    expect(getLobbySnapshot(lobby).hostSessionId).toBe('p1');

    expect(leaveLobby(lobby, 'p1').ok).toBe(true);
    expect(getLobbySnapshot(lobby).hostSessionId).toBe('p2');

    expect(leaveLobby(lobby, 'p2').ok).toBe(true);
    expect(getLobbySnapshot(lobby).hostSessionId).toBe('p3');
  });
});
