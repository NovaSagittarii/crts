import { describe, expect } from 'vitest';

import type {
  BuildQueuedPayload,
  RoomGridStatePayload,
  RoomStateHashesPayload,
  RoomStructuresStatePayload,
} from '#rts-engine';

import { createLockstepTest } from './lockstep-fixtures.js';
import { createMatchTest } from './match-fixtures.js';
import {
  waitForBuildQueueResponse,
  waitForEvent,
  waitForNoEvent,
  waitForStateGrid,
  waitForStateHashes,
  waitForStateStructures,
} from './test-support.js';

const sectionsMatchTest = createMatchTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 40,
    activeStateSnapshotIntervalTicks: 1000,
  },
  {
    roomName: 'State Sections Room',
    hostSessionId: 'sections-host',
    guestSessionId: 'sections-guest',
  },
);

const lockstepSectionsTest = createLockstepTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 30,
    lockstepMode: 'primary',
    lockstepTurnTicks: 20,
    lockstepCheckpointIntervalTicks: 1,
  },
  {
    roomName: 'State Sections Room',
    hostSessionId: 'sections-host',
    guestSessionId: 'sections-guest',
  },
);

describe('section sync and queued fanout', () => {
  sectionsMatchTest(
    'serves grid and structures sections only to the requester',
    async ({ activeMatch }) => {
      const setup = activeMatch;

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

      const hashesPromise = waitForStateHashes(
        setup.host,
        (payload: RoomStateHashesPayload) =>
          payload.roomId === setup.roomId &&
          payload.structuresHash !== initialStructures.hashHex,
        { timeoutMs: 6_000, overallTimeoutMs: 6_000 },
      );

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

      const hashes = await hashesPromise;

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

      await Promise.all([
        waitForNoEvent(setup.guest, 'state:grid', 250),
        waitForNoEvent(setup.guest, 'state:structures', 250),
      ]);
    },
    25_000,
  );

  lockstepSectionsTest(
    'broadcasts authoritative queued intents and queue hashes on turn flush',
    async ({ connectedRoom, startLockstepMatch }) => {
      const setup = await startLockstepMatch(connectedRoom, {
        waitForActiveMembership: false,
      });

      const hostQueuedPromise = waitForBuildQueueResponse(setup.host, 4_000);
      const guestQueuedPromise = waitForBuildQueueResponse(setup.guest, 4_000);
      const earlyHostQueuedPromise = waitForEvent<BuildQueuedPayload>(
        setup.host,
        'build:queued',
        250,
      );
      const earlyGuestQueuedPromise = waitForEvent<BuildQueuedPayload>(
        setup.guest,
        'build:queued',
        250,
      );

      setup.host.emit('build:queue', {
        templateId: 'block',
        x: setup.hostTeam.baseTopLeft.x + 8,
        y: setup.hostTeam.baseTopLeft.y + 8,
      });

      await expect(earlyHostQueuedPromise).rejects.toThrow(/timed out/i);
      await expect(earlyGuestQueuedPromise).rejects.toThrow(/timed out/i);

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

      const hostStructures = await waitForStateStructures(
        setup.host,
        (payload) =>
          payload.roomId === setup.roomId &&
          payload.teams.some(
            (team) =>
              team.id === setup.hostTeam.id &&
              team.pendingBuilds.some(
                ({ eventId }) => eventId === hostQueued.eventId,
              ),
          ),
        {
          roomId: setup.roomId,
          attempts: 60,
          timeoutMs: 2_000,
          overallTimeoutMs: 6_000,
        },
      );
      const guestStructures = await waitForStateStructures(
        setup.guest,
        (payload) =>
          payload.roomId === setup.roomId &&
          payload.teams.some(
            (team) =>
              team.id === setup.hostTeam.id &&
              team.pendingBuilds.some(
                ({ eventId }) => eventId === hostQueued.eventId,
              ),
          ),
        {
          roomId: setup.roomId,
          attempts: 60,
          timeoutMs: 2_000,
          overallTimeoutMs: 6_000,
        },
      );

      const hostPendingBuilds =
        hostStructures.teams.find((team) => team.id === setup.hostTeam.id)
          ?.pendingBuilds ?? [];
      const guestPendingBuilds =
        guestStructures.teams.find((team) => team.id === setup.hostTeam.id)
          ?.pendingBuilds ?? [];

      expect(hostPendingBuilds).toEqual(guestPendingBuilds);
    },
    25_000,
  );
});
