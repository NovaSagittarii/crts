import { describe, expect, test } from 'vitest';

import { LobbyRoom } from './lobby.js';

describe('lobby', () => {
  test('validates required and unique slot IDs when creating a lobby', () => {
    expect(() =>
      LobbyRoom.create({
        roomId: 'room-invalid-empty',
        slotIds: [],
      }),
    ).toThrow('Lobby room must define at least one slot');

    expect(() =>
      LobbyRoom.create({
        roomId: 'room-invalid-duplicate',
        slotIds: ['team-1', 'team-1'],
      }),
    ).toThrow('Lobby room slot IDs must be unique');
  });

  describe('QUAL-01 lobby/team invariants', () => {
    test('[QUAL-01] enforces spectator overflow when player slots are full', () => {
      const lobby = LobbyRoom.create({
        roomId: 'room-1',
        slotIds: ['team-1', 'team-2'],
      });

      lobby.join({ sessionId: 'p1', displayName: 'Alice' });
      lobby.join({ sessionId: 'p2', displayName: 'Bob' });
      lobby.join({ sessionId: 'p3', displayName: 'Cara' });

      expect(lobby.claimSlot('p1', 'team-1').ok).toBe(true);
      expect(lobby.claimSlot('p2', 'team-2').ok).toBe(true);

      const fullSlot = lobby.claimSlot('p3', 'team-1');
      expect(fullSlot.ok).toBe(false);
      expect(fullSlot.reason).toBe('slot-full');
      expect(fullSlot.message).toMatch(/full/i);

      const snapshot = lobby.snapshot();
      const spectator = snapshot.participants.find(
        ({ sessionId }) => sessionId === 'p3',
      );
      expect(spectator?.role).toBe('spectator');
      expect(spectator?.slotId).toBeNull();
    });

    test('[QUAL-01] rejects team switching after a slot is claimed', () => {
      const lobby = LobbyRoom.create({
        roomId: 'room-2',
        slotIds: ['team-1', 'team-2'],
      });
      lobby.join({ sessionId: 'p1', displayName: 'Alice' });

      expect(lobby.claimSlot('p1', 'team-1').ok).toBe(true);

      const teamSwitch = lobby.claimSlot('p1', 'team-2');
      expect(teamSwitch.ok).toBe(false);
      expect(teamSwitch.reason).toBe('team-switch-locked');
    });

    test('[QUAL-01] gates ready toggles to claimed player roles', () => {
      const lobby = LobbyRoom.create({
        roomId: 'room-3',
        slotIds: ['team-1', 'team-2'],
      });

      lobby.join({ sessionId: 'p1', displayName: 'Alice' });
      lobby.join({ sessionId: 'p2', displayName: 'Bob' });

      expect(lobby.claimSlot('p1', 'team-1').ok).toBe(true);

      const spectatorReady = lobby.setReady('p2', true);
      expect(spectatorReady.ok).toBe(false);
      expect(spectatorReady.reason).toBe('not-player');

      expect(lobby.setReady('p1', true).ok).toBe(true);
      expect(lobby.setReady('p1', false).ok).toBe(true);

      const snapshot = lobby.snapshot();
      const player = snapshot.participants.find(
        ({ sessionId }) => sessionId === 'p1',
      );
      expect(player?.ready).toBe(false);
    });

    test('[QUAL-01] transfers host deterministically by join order', () => {
      const lobby = LobbyRoom.create({
        roomId: 'room-4',
        slotIds: ['team-1', 'team-2'],
      });

      lobby.join({ sessionId: 'p1', displayName: 'Alice' });
      lobby.join({ sessionId: 'p2', displayName: 'Bob' });
      lobby.join({ sessionId: 'p3', displayName: 'Cara' });

      expect(lobby.snapshot().hostSessionId).toBe('p1');

      expect(lobby.leave('p1').ok).toBe(true);
      expect(lobby.snapshot().hostSessionId).toBe('p2');

      expect(lobby.leave('p2').ok).toBe(true);
      expect(lobby.snapshot().hostSessionId).toBe('p3');
    });

    test('[QUAL-01] resolves slot claim contention deterministically', () => {
      const lobby = LobbyRoom.create({
        roomId: 'room-5',
        slotIds: ['team-1', 'team-2'],
      });

      lobby.join({ sessionId: 'p1', displayName: 'Alice' });
      lobby.join({ sessionId: 'p2', displayName: 'Bob' });

      expect(lobby.claimSlot('p1', 'team-1').ok).toBe(true);

      const contested = lobby.claimSlot('p2', 'team-1');
      expect(contested.ok).toBe(false);
      expect(contested.reason).toBe('slot-full');

      const idempotent = lobby.claimSlot('p1', 'team-1');
      expect(idempotent.ok).toBe(true);

      expect(lobby.leave('p1').ok).toBe(true);
      expect(lobby.claimSlot('p2', 'team-1').ok).toBe(true);
    });

    test('[QUAL-01] keeps slot claims isolated across independent lobby instances', () => {
      const lobbyA = LobbyRoom.create({
        roomId: 'room-9a',
        slotIds: ['team-1', 'team-2'],
      });
      const lobbyB = LobbyRoom.create({
        roomId: 'room-9b',
        slotIds: ['team-1', 'team-2'],
      });

      lobbyA.join({ sessionId: 'p1', displayName: 'Alice' });
      lobbyB.join({ sessionId: 'p2', displayName: 'Bob' });

      expect(lobbyA.claimSlot('p1', 'team-1').ok).toBe(true);
      expect(lobbyB.claimSlot('p2', 'team-1').ok).toBe(true);

      expect(lobbyA.snapshot().hostSessionId).toBe('p1');
      expect(lobbyB.snapshot().hostSessionId).toBe('p2');
    });
  });

  test('returns explicit slot rejections for invalid inputs', () => {
    const lobby = LobbyRoom.create({
      roomId: 'room-6',
      slotIds: ['team-1', 'team-2'],
    });

    lobby.join({ sessionId: 'p1', displayName: 'Alice' });

    const invalidSlot = lobby.claimSlot('p1', 'team-9');
    expect(invalidSlot.ok).toBe(false);
    expect(invalidSlot.reason).toBe('invalid-slot');

    const missingParticipant = lobby.claimSlot('missing', 'team-1');
    expect(missingParticipant.ok).toBe(false);
    expect(missingParticipant.reason).toBe('participant-not-found');
  });

  test('updates display names when an existing session rejoins', () => {
    const lobby = LobbyRoom.create({
      roomId: 'room-7',
      slotIds: ['team-1', 'team-2'],
    });

    lobby.join({ sessionId: 'p1', displayName: 'Alice' });
    lobby.join({ sessionId: 'p1', displayName: 'Alicia' });

    const snapshot = lobby.snapshot();
    expect(snapshot.participants).toHaveLength(1);
    expect(snapshot.participants[0]?.displayName).toBe('Alicia');
  });

  test('returns participant-not-found for unknown ready and leave operations', () => {
    const lobby = LobbyRoom.create({
      roomId: 'room-8',
      slotIds: ['team-1', 'team-2'],
    });

    const readyMissing = lobby.setReady('missing', true);
    expect(readyMissing.ok).toBe(false);
    expect(readyMissing.reason).toBe('participant-not-found');

    const leaveMissing = lobby.leave('missing');
    expect(leaveMissing.ok).toBe(false);
    expect(leaveMissing.reason).toBe('participant-not-found');
  });
});
