import { describe, expect, test } from 'vitest';
import type { Socket } from 'socket.io-client';

import { createServer } from '../../../apps/server/src/server.js';
import type {
  BuildQueuedPayload,
  BuildScheduledPayload,
  RoomGridStatePayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  RoomStateHashesPayload,
  RoomStructuresStatePayload,
  RoomStatePayload,
  RoomSlotClaimedPayload,
  TeamPayload,
} from '#rts-engine';
import {
  createClient,
  waitForBuildQueueResponse,
  waitForBuildScheduled,
  waitForEvent,
  waitForMembership,
  waitForState,
  waitForStateGrid,
  waitForStateHashes,
  waitForStateStructures,
} from './test-support.js';

function resolveTeamForPlayer(
  teams: TeamPayload[],
  playerId: string,
): TeamPayload {
  const team = teams.find(({ playerIds }) => playerIds.includes(playerId));
  if (!team) {
    throw new Error(`Unable to resolve team for player ${playerId}`);
  }

  return team;
}

async function claimSlot(socket: Socket, slotId: string): Promise<number> {
  const claimedPromise = waitForEvent<RoomSlotClaimedPayload>(
    socket,
    'room:slot-claimed',
  );
  socket.emit('room:claim-slot', { slotId });
  const claimed = await claimedPromise;
  if (claimed.teamId === null) {
    throw new Error(`Expected ${slotId} claim to assign a team`);
  }

  return claimed.teamId;
}

async function setupActiveMatch(port: number): Promise<{
  host: Socket;
  guest: Socket;
  roomId: string;
  hostJoined: RoomJoinedPayload;
  guestJoined: RoomJoinedPayload;
  hostTeam: TeamPayload;
}> {
  const host = createClient(port, { sessionId: 'sections-host' });
  await waitForEvent<RoomJoinedPayload>(host, 'room:joined');

  const createdPromise = waitForEvent<RoomJoinedPayload>(host, 'room:joined');
  host.emit('room:create', {
    name: 'State Sections Room',
    width: 52,
    height: 52,
  });
  const hostJoined = await createdPromise;

  const guest = createClient(port, { sessionId: 'sections-guest' });
  await waitForEvent<RoomJoinedPayload>(guest, 'room:joined');

  const guestJoinedPromise = waitForEvent<RoomJoinedPayload>(
    guest,
    'room:joined',
  );
  guest.emit('room:join', { roomId: hostJoined.roomId });
  const guestJoined = await guestJoinedPromise;

  await claimSlot(host, 'team-1');
  await claimSlot(guest, 'team-2');
  await waitForMembership(
    host,
    hostJoined.roomId,
    (payload: RoomMembershipPayload) =>
      payload.slots['team-1'] === hostJoined.playerId &&
      payload.slots['team-2'] === guestJoined.playerId,
  );

  const readyMembershipPromise = waitForMembership(
    host,
    hostJoined.roomId,
    (payload: RoomMembershipPayload) =>
      payload.participants.filter(
        ({ role, ready }) => role === 'player' && ready,
      ).length === 2,
  );
  host.emit('room:set-ready', { ready: true });
  guest.emit('room:set-ready', { ready: true });
  await readyMembershipPromise;

  host.emit('room:start');
  await waitForEvent(host, 'room:match-started', 7_000);

  const state = await waitForState(
    host,
    (payload: RoomStatePayload) =>
      payload.roomId === hostJoined.roomId &&
      payload.teams.some(({ playerIds }) =>
        playerIds.includes(hostJoined.playerId),
      ),
    {
      roomId: hostJoined.roomId,
      attempts: 40,
      timeoutMs: 2_000,
    },
  );

  return {
    host,
    guest,
    roomId: hostJoined.roomId,
    hostJoined,
    guestJoined,
    hostTeam: resolveTeamForPlayer(state.teams, hostJoined.playerId),
  };
}

describe('section sync and queued scheduling', () => {
  test('serves grid and structures sections only to the requester', async () => {
    const server = createServer({
      port: 0,
      width: 52,
      height: 52,
      tickMs: 40,
      activeStateSnapshotIntervalTicks: 1000,
    });
    const port = await server.start();

    let setup: Awaited<ReturnType<typeof setupActiveMatch>> | null = null;

    try {
      setup = await setupActiveMatch(port);

      let guestGridCount = 0;
      let guestStructuresCount = 0;
      setup.guest.on('state:grid', () => {
        guestGridCount += 1;
      });
      setup.guest.on('state:structures', () => {
        guestStructuresCount += 1;
      });

      const initialGrid = await waitForStateGrid(
        setup.host,
        (payload: RoomGridStatePayload) => payload.roomId === setup?.roomId,
        {
          roomId: setup.roomId,
        },
      );
      expect(initialGrid.hashHex).toMatch(/^[0-9a-f]{8}$/);

      setup.host.emit('state:request', { sections: ['grid'] });
      await expect(
        waitForEvent<RoomGridStatePayload>(setup.host, 'state:grid', 120),
      ).rejects.toThrow(/timed out/i);

      const initialStructures = await waitForStateStructures(
        setup.host,
        (payload: RoomStructuresStatePayload) =>
          payload.roomId === setup?.roomId,
        {
          roomId: setup.roomId,
        },
      );

      const scheduledPromise = waitForBuildScheduled(setup.host, 6_000);

      setup.host.emit('build:queue', {
        templateId: 'block',
        x: setup.hostTeam.baseTopLeft.x + 8,
        y: setup.hostTeam.baseTopLeft.y + 8,
      });

      const queued = await waitForBuildQueueResponse(setup.host, 4_000);
      if ('error' in queued) {
        throw new Error(
          `Build queue unexpectedly failed: ${queued.error.reason ?? queued.error.message}`,
        );
      }

      await scheduledPromise;
      const hashes = await waitForStateHashes(
        setup.host,
        (payload: RoomStateHashesPayload) =>
          payload.roomId === setup?.roomId &&
          payload.structuresHash !== initialStructures.hashHex,
        { timeoutMs: 6_000, overallTimeoutMs: 6_000 },
      );

      expect(hashes.gridHash).toBe(initialGrid.hashHex);
      expect(hashes.structuresHash).not.toBe(initialStructures.hashHex);

      const updatedStructures = await waitForStateStructures(
        setup.host,
        (payload: RoomStructuresStatePayload) =>
          payload.roomId === setup?.roomId &&
          payload.hashHex === hashes.structuresHash,
        {
          roomId: setup.roomId,
        },
      );
      expect(updatedStructures.hashHex).toBe(hashes.structuresHash);

      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(guestGridCount).toBe(0);
      expect(guestStructuresCount).toBe(0);
    } finally {
      setup?.host.close();
      setup?.guest.close();
      await server.stop();
    }
  }, 25_000);

  test('broadcasts queued intents immediately and scheduled builds on turn flush', async () => {
    const server = createServer({
      port: 0,
      width: 52,
      height: 52,
      tickMs: 30,
      countdownSeconds: 0,
      lockstepMode: 'primary',
      lockstepTurnTicks: 20,
      lockstepCheckpointIntervalTicks: 1,
    });
    const port = await server.start();

    let setup: Awaited<ReturnType<typeof setupActiveMatch>> | null = null;

    try {
      setup = await setupActiveMatch(port);

      const hostQueuedPromise = waitForBuildQueueResponse(setup.host, 4_000);
      const guestQueuedPromise = waitForBuildQueueResponse(setup.guest, 4_000);

      setup.host.emit('build:queue', {
        templateId: 'block',
        x: setup.hostTeam.baseTopLeft.x + 8,
        y: setup.hostTeam.baseTopLeft.y + 8,
      });

      const [hostQueuedResponse, guestQueuedResponse] = await Promise.all([
        hostQueuedPromise,
        guestQueuedPromise,
      ]);
      if ('error' in hostQueuedResponse || 'error' in guestQueuedResponse) {
        throw new Error(
          'Expected both clients to observe a buffered build intent',
        );
      }

      const hostQueued: BuildQueuedPayload = hostQueuedResponse.queued;
      const guestQueued: BuildQueuedPayload = guestQueuedResponse.queued;
      expect(guestQueued).toEqual(hostQueued);
      expect(hostQueued.playerId).toBe(setup.hostJoined.playerId);
      expect(hostQueued.teamId).toBe(setup.hostTeam.id);
      expect(hostQueued.scheduledByTurn).toBeGreaterThan(
        hostQueued.bufferedTurn,
      );

      await expect(waitForBuildScheduled(setup.host, 250)).rejects.toThrow(
        /timed out/i,
      );

      const [hostScheduled, guestScheduled] = await Promise.all([
        waitForBuildScheduled(setup.host, 6_000),
        waitForBuildScheduled(setup.guest, 6_000),
      ]);

      expect(hostScheduled).toEqual(guestScheduled);
      expect(hostScheduled.intentId).toBe(hostQueued.intentId);
      expect(hostScheduled.eventId).toBeGreaterThan(0);
      expect(hostScheduled.executeTick).toBeGreaterThan(0);
      expect(hostScheduled.teamId).toBe(setup.hostTeam.id);
    } finally {
      setup?.host.close();
      setup?.guest.close();
      await server.stop();
    }
  }, 25_000);
});
