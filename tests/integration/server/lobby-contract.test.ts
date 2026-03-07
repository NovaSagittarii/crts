import { describe, expect } from 'vitest';

import type {
  ChatMessagePayload,
  MatchStartedPayload,
  RoomErrorPayload,
  RoomJoinedPayload,
  RoomListEntryPayload,
  RoomMembershipPayload,
  RoomSlotClaimedPayload,
} from '#rts-engine';
import {
  waitForEvent,
  waitForMembership,
  waitForRoomState,
} from './test-support.js';
import { createIntegrationTest } from './fixtures.js';

const test = createIntegrationTest({
  port: 0,
  width: 50,
  height: 50,
  tickMs: 40,
});

function countPlayers(payload: RoomMembershipPayload): number {
  return payload.participants.filter(({ role }) => role === 'player').length;
}

describe('lobby room/team contract', () => {
  test('keeps room membership revisions deterministic across join and leave', async ({
    connectClient,
  }) => {
    const owner = connectClient();
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', {
      name: 'Deterministic Room',
      width: 42,
      height: 42,
    });
    const ownerRoom = await waitForEvent<RoomJoinedPayload>(
      owner,
      'room:joined',
    );
    const ownerInitialMembership = await waitForMembership(
      owner,
      ownerRoom.roomId,
      (payload) => payload.participants.length === 1,
    );

    const guest = connectClient();
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

    guest.emit('room:join', { roomId: ownerRoom.roomId });
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

    const ownerWithGuest = await waitForMembership(
      owner,
      ownerRoom.roomId,
      (payload) => payload.participants.length === 2,
    );
    const guestWithOwner = await waitForMembership(
      guest,
      ownerRoom.roomId,
      (payload) => payload.participants.length === 2,
    );

    expect(ownerWithGuest.revision).toBe(guestWithOwner.revision);
    expect(ownerWithGuest.revision).toBeGreaterThan(
      ownerInitialMembership.revision,
    );

    guest.emit('room:leave');
    const ownerAfterLeave = await waitForMembership(
      owner,
      ownerRoom.roomId,
      (payload) => payload.participants.length === 1,
    );

    expect(ownerAfterLeave.revision).toBe(ownerWithGuest.revision + 1);
  });

  test('supports room-code join and caps players at two with spectator overflow', async ({
    connectClient,
  }) => {
    const owner = connectClient();
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', { name: 'Code Room', width: 48, height: 48 });
    const created = await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:list');
    const rooms = await waitForEvent<RoomListEntryPayload[]>(
      owner,
      'room:list',
    );
    expect(rooms.some(({ roomCode }) => roomCode === created.roomCode)).toBe(
      true,
    );

    const firstPlayer = connectClient();
    await waitForEvent<RoomJoinedPayload>(firstPlayer, 'room:joined');
    firstPlayer.emit('room:join', { roomId: created.roomId });
    const firstPlayerJoined = await waitForEvent<RoomJoinedPayload>(
      firstPlayer,
      'room:joined',
    );

    const spectator = connectClient();
    await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
    spectator.emit('room:join', { roomCode: created.roomCode });
    const spectatorJoined = await waitForEvent<RoomJoinedPayload>(
      spectator,
      'room:joined',
    );

    owner.emit('room:claim-slot', { slotId: 'team-1' });
    firstPlayer.emit('room:claim-slot', { slotId: 'team-2' });

    const fullPlayers = await waitForMembership(
      owner,
      created.roomId,
      (payload) => countPlayers(payload) === 2,
    );
    expect(fullPlayers.slots['team-1']).toBe(created.playerId);
    expect(fullPlayers.slots['team-2']).toBe(firstPlayerJoined.playerId);

    spectator.emit('room:claim-slot', { slotId: 'team-1' });
    const roomError = await waitForEvent<RoomErrorPayload>(
      spectator,
      'room:error',
    );
    expect(roomError.reason).toBe('slot-full');

    const overflow = await waitForMembership(
      spectator,
      created.roomId,
      (payload) => payload.participants.length === 3,
    );
    expect(countPlayers(overflow)).toBe(2);
    expect(
      overflow.participants.find(
        ({ sessionId }) => sessionId === spectatorJoined.playerId,
      )?.role,
    ).toBe('spectator');
  });

  test('supports configured multi-seat teams with shared team ids', async ({
    connectClient,
  }) => {
    const owner = connectClient();
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', {
      name: 'Shared Command Room',
      width: 54,
      height: 54,
      slots: [
        { slotId: 'team-1', capacity: 2 },
        { slotId: 'team-2', capacity: 2 },
        { slotId: 'team-3', capacity: 2 },
      ],
    });
    const created = await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    const teammate = connectClient();
    await waitForEvent<RoomJoinedPayload>(teammate, 'room:joined');
    teammate.emit('room:join', { roomId: created.roomId });
    const teammateJoined = await waitForEvent<RoomJoinedPayload>(
      teammate,
      'room:joined',
    );

    const rival = connectClient();
    await waitForEvent<RoomJoinedPayload>(rival, 'room:joined');
    rival.emit('room:join', { roomId: created.roomId });
    const rivalJoined = await waitForEvent<RoomJoinedPayload>(
      rival,
      'room:joined',
    );

    const thirdTeam = connectClient();
    await waitForEvent<RoomJoinedPayload>(thirdTeam, 'room:joined');
    thirdTeam.emit('room:join', { roomId: created.roomId });
    const thirdTeamJoined = await waitForEvent<RoomJoinedPayload>(
      thirdTeam,
      'room:joined',
    );

    const ownerClaimedPromise = waitForEvent<RoomSlotClaimedPayload>(
      owner,
      'room:slot-claimed',
    );
    owner.emit('room:claim-slot', { slotId: 'team-1' });
    const ownerClaimed = await ownerClaimedPromise;

    const teammateClaimedPromise = waitForEvent<RoomSlotClaimedPayload>(
      teammate,
      'room:slot-claimed',
    );
    teammate.emit('room:claim-slot', { slotId: 'team-1' });
    const teammateClaimed = await teammateClaimedPromise;

    const rivalClaimedPromise = waitForEvent<RoomSlotClaimedPayload>(
      rival,
      'room:slot-claimed',
    );
    rival.emit('room:claim-slot', { slotId: 'team-2' });
    const rivalClaimed = await rivalClaimedPromise;

    const thirdTeamClaimedPromise = waitForEvent<RoomSlotClaimedPayload>(
      thirdTeam,
      'room:slot-claimed',
    );
    thirdTeam.emit('room:claim-slot', { slotId: 'team-3' });
    const thirdTeamClaimed = await thirdTeamClaimedPromise;

    expect(ownerClaimed.teamId).not.toBeNull();
    expect(teammateClaimed.teamId).toBe(ownerClaimed.teamId);
    expect(rivalClaimed.teamId).not.toBe(ownerClaimed.teamId);
    expect(thirdTeamClaimed.teamId).not.toBe(ownerClaimed.teamId);

    const membership = await waitForMembership(
      owner,
      created.roomId,
      (payload) =>
        countPlayers(payload) === 4 &&
        payload.slotMembers['team-1']?.length === 2 &&
        payload.slotMembers['team-2']?.length === 1 &&
        payload.slotMembers['team-3']?.length === 1,
    );

    expect(membership.slotDefinitions).toEqual([
      { slotId: 'team-1', capacity: 2 },
      { slotId: 'team-2', capacity: 2 },
      { slotId: 'team-3', capacity: 2 },
    ]);
    expect(membership.slotMembers['team-1']).toEqual([
      created.playerId,
      teammateJoined.playerId,
    ]);
    expect(membership.slotMembers['team-2']).toEqual([rivalJoined.playerId]);
    expect(membership.slotMembers['team-3']).toEqual([
      thirdTeamJoined.playerId,
    ]);

    const roomState = await waitForRoomState(
      owner,
      created.roomId,
      (payload) =>
        payload.teams.some(
          ({ playerIds }) =>
            playerIds.includes(created.playerId) &&
            playerIds.includes(teammateJoined.playerId),
        ) &&
        payload.teams.some(({ playerIds }) =>
          playerIds.includes(rivalJoined.playerId),
        ) &&
        payload.teams.some(({ playerIds }) =>
          playerIds.includes(thirdTeamJoined.playerId),
        ),
    );

    expect(
      roomState.teams.find(({ playerIds }) =>
        playerIds.includes(created.playerId),
      )?.playerIds,
    ).toEqual([created.playerId, teammateJoined.playerId]);
  });

  test('enforces slot lock and manual ready toggles', async ({
    connectClient,
  }) => {
    const owner = connectClient();
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', { name: 'Ready Room', width: 46, height: 46 });
    const created = await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    const guest = connectClient();
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');
    guest.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

    owner.emit('room:claim-slot', { slotId: 'team-1' });
    await waitForMembership(
      owner,
      created.roomId,
      (payload) => countPlayers(payload) === 1,
    );

    owner.emit('room:claim-slot', { slotId: 'team-2' });
    const switchError = await waitForEvent<RoomErrorPayload>(
      owner,
      'room:error',
    );
    expect(switchError.reason).toBe('team-switch-locked');

    guest.emit('room:set-ready', { ready: true });
    const spectatorReadyError = await waitForEvent<RoomErrorPayload>(
      guest,
      'room:error',
    );
    expect(spectatorReadyError.reason).toBe('not-player');

    owner.emit('room:set-ready', { ready: true });
    await waitForMembership(owner, created.roomId, (payload) =>
      payload.participants.some(
        ({ sessionId, ready }) => sessionId === created.playerId && ready,
      ),
    );

    owner.emit('room:set-ready', { ready: false });
    const ownerNotReady = await waitForMembership(
      owner,
      created.roomId,
      (payload) =>
        payload.participants.some(
          ({ sessionId, ready }) => sessionId === created.playerId && !ready,
        ),
    );

    expect(
      ownerNotReady.participants.find(
        ({ sessionId }) => sessionId === created.playerId,
      )?.ready,
    ).toBe(false);
  });

  test('transfers host deterministically before match start', async ({
    connectClient,
  }) => {
    const owner = connectClient();
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', { name: 'Host Room', width: 44, height: 44 });
    const created = await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    const guest = connectClient();
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');
    guest.emit('room:join', { roomId: created.roomId });
    const guestJoined = await waitForEvent<RoomJoinedPayload>(
      guest,
      'room:joined',
    );

    const viewer = connectClient();
    await waitForEvent<RoomJoinedPayload>(viewer, 'room:joined');
    viewer.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(viewer, 'room:joined');

    const withHost = await waitForMembership(
      owner,
      created.roomId,
      (payload) => payload.participants.length === 3,
    );
    expect(withHost.hostSessionId).toBe(created.playerId);

    owner.emit('room:leave');
    const transferred = await waitForMembership(
      guest,
      created.roomId,
      (payload) => payload.participants.length === 2,
    );
    expect(transferred.hostSessionId).toBe(guestJoined.playerId);
  });

  test('guards start preconditions and continues countdown when a player disconnects', async ({
    connectClient,
  }) => {
    const owner = connectClient();
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', {
      name: 'Countdown Room',
      width: 52,
      height: 52,
    });
    const created = await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    const guest = connectClient();
    await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');
    guest.emit('room:join', { roomId: created.roomId });
    const guestJoined = await waitForEvent<RoomJoinedPayload>(
      guest,
      'room:joined',
    );

    owner.emit('room:claim-slot', { slotId: 'team-1' });
    guest.emit('room:claim-slot', { slotId: 'team-2' });
    await waitForMembership(
      owner,
      created.roomId,
      (payload) => countPlayers(payload) === 2,
    );

    owner.emit('room:set-ready', { ready: true });
    await waitForMembership(owner, created.roomId, (payload) =>
      payload.participants.some(
        ({ sessionId, ready }) => sessionId === created.playerId && ready,
      ),
    );

    owner.emit('room:start', { force: true });
    const preconditionError = await waitForEvent<RoomErrorPayload>(
      owner,
      'room:error',
    );
    expect(preconditionError.reason).toBe('not-ready');

    guest.emit('room:set-ready', { ready: true });
    await waitForMembership(owner, created.roomId, (payload) =>
      payload.participants.some(
        ({ sessionId, ready }) => sessionId === guestJoined.playerId && ready,
      ),
    );

    owner.emit('room:start');
    await waitForMembership(
      owner,
      created.roomId,
      (payload) => payload.status === 'countdown',
      { attempts: 20 },
    );

    guest.emit('room:set-ready', { ready: false });
    const readyLocked = await waitForEvent<RoomErrorPayload>(
      guest,
      'room:error',
    );
    expect(readyLocked.reason).toBe('countdown-locked');

    guest.close();

    const started = await waitForEvent<MatchStartedPayload>(
      owner,
      'room:match-started',
      5000,
    );
    expect(started.roomId).toBe(created.roomId);

    const activeMembership = await waitForMembership(
      owner,
      created.roomId,
      (payload) => payload.status === 'active',
      { attempts: 20 },
    );
    expect(activeMembership.status).toBe('active');
  });

  test('broadcasts room chat to players and spectators during active match', async ({
    connectClient,
  }) => {
    const owner = connectClient();
    await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    owner.emit('room:create', { name: 'Chat Room', width: 54, height: 54 });
    const created = await waitForEvent<RoomJoinedPayload>(owner, 'room:joined');

    const secondPlayer = connectClient();
    await waitForEvent<RoomJoinedPayload>(secondPlayer, 'room:joined');
    secondPlayer.emit('room:join', { roomId: created.roomId });
    await waitForEvent<RoomJoinedPayload>(secondPlayer, 'room:joined');

    const spectator = connectClient();
    await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
    spectator.emit('room:join', { roomCode: created.roomCode });
    const spectatorJoined = await waitForEvent<RoomJoinedPayload>(
      spectator,
      'room:joined',
    );

    owner.emit('room:claim-slot', { slotId: 'team-1' });
    secondPlayer.emit('room:claim-slot', { slotId: 'team-2' });
    owner.emit('room:set-ready', { ready: true });
    secondPlayer.emit('room:set-ready', { ready: true });

    await waitForMembership(
      owner,
      created.roomId,
      (payload) =>
        payload.participants.filter(
          ({ role, ready }) => role === 'player' && ready,
        ).length === 2,
      { attempts: 20 },
    );

    owner.emit('room:start');
    await waitForEvent<MatchStartedPayload>(owner, 'room:match-started', 5000);

    spectator.emit('chat:send', { message: 'glhf from spectator' });

    const ownerChat = await waitForEvent<ChatMessagePayload>(
      owner,
      'chat:message',
    );
    const secondPlayerChat = await waitForEvent<ChatMessagePayload>(
      secondPlayer,
      'chat:message',
    );
    const spectatorChat = await waitForEvent<ChatMessagePayload>(
      spectator,
      'chat:message',
    );

    expect(ownerChat.message).toBe('glhf from spectator');
    expect(secondPlayerChat.message).toBe('glhf from spectator');
    expect(spectatorChat.message).toBe('glhf from spectator');
    expect(ownerChat.senderSessionId).toBe(spectatorJoined.playerId);
  });
});
