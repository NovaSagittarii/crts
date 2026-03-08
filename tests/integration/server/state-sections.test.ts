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
  collectCandidatePlacements,
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
  { startMode: 'manual' },
  { runtimeMode: 'manual' },
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
  { startMode: 'manual' },
  { runtimeMode: 'manual' },
);

describe('section sync and queued fanout', () => {
  sectionsMatchTest(
    'serves grid and structures sections only to the requester',
    async ({ activeMatch }) => {
      const setup = activeMatch;
      const generatorTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'generator',
      );
      if (!generatorTemplate) {
        throw new Error('Expected generator template to be available');
      }

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
      const initialHostTeam = initialStructures.teams.find(
        (team) => team.id === setup.hostTeam.id,
      );
      if (!initialHostTeam) {
        throw new Error('Expected host team in initial structures state');
      }

      const placement = collectCandidatePlacements(
        setup.hostTeam,
        generatorTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      )[0];
      if (!placement) {
        throw new Error('Expected a valid generator placement');
      }

      const hashesPromise = waitForStateHashes(
        setup.host,
        (payload: RoomStateHashesPayload) =>
          payload.roomId === setup.roomId &&
          payload.structuresHash !== initialStructures.hashHex,
        { timeoutMs: 6_000, overallTimeoutMs: 6_000 },
      );
      const queuedPromise = waitForBuildQueueResponse(setup.host, 4_000);

      setup.host.emit('build:queue', {
        templateId: generatorTemplate.id,
        x: placement.x,
        y: placement.y,
        delayTicks: 20,
      });

      const queued = await queuedPromise;
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
      const updatedHostTeam = updatedStructures.teams.find(
        (team) => team.id === setup.hostTeam.id,
      );
      if (!updatedHostTeam) {
        throw new Error('Expected host team in updated structures state');
      }
      expect(updatedHostTeam.resources).toBeLessThan(initialHostTeam.resources);
      expect(
        updatedHostTeam.pendingBuilds.some(
          ({ eventId }) => eventId === queued.queued.eventId,
        ),
      ).toBe(true);

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
      const generatorTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'generator',
      );
      if (!generatorTemplate) {
        throw new Error('Expected generator template to be available');
      }

      const placement = collectCandidatePlacements(
        setup.hostTeam,
        generatorTemplate,
        setup.hostJoined.state.width,
        setup.hostJoined.state.height,
      )[0];
      if (!placement) {
        throw new Error('Expected a valid generator placement');
      }

      const initialStructures = await waitForStateStructures(
        setup.host,
        (payload) => payload.roomId === setup.roomId,
        {
          roomId: setup.roomId,
          attempts: 20,
          timeoutMs: 2_000,
        },
      );
      const initialHostTeam = initialStructures.teams.find(
        (team) => team.id === setup.hostTeam.id,
      );
      if (!initialHostTeam) {
        throw new Error('Expected host team in initial structures state');
      }

      const hostQueuedPromise = waitForBuildQueueResponse(setup.host, 4_000);
      const guestQueuedPromise = waitForEvent<BuildQueuedPayload>(
        setup.guest,
        'build:queued',
        4_000,
      );
      const earlyHostQueuedPromise = waitForEvent<BuildQueuedPayload>(
        setup.host,
        'build:queued',
        250,
      ).catch((error: unknown) => error);
      const earlyGuestQueuedPromise = waitForEvent<BuildQueuedPayload>(
        setup.guest,
        'build:queued',
        250,
      ).catch((error: unknown) => error);

      setup.host.emit('build:queue', {
        templateId: generatorTemplate.id,
        x: placement.x,
        y: placement.y,
      });

      const [earlyHostQueuedError, earlyGuestQueuedError] = await Promise.all([
        earlyHostQueuedPromise,
        earlyGuestQueuedPromise,
      ]);
      expect(earlyHostQueuedError).toBeInstanceOf(Error);
      expect(earlyGuestQueuedError).toBeInstanceOf(Error);
      expect((earlyHostQueuedError as Error).message).toMatch(/timed out/i);
      expect((earlyGuestQueuedError as Error).message).toMatch(/timed out/i);

      const [hostQueuedResponse, guestQueued] = await Promise.all([
        hostQueuedPromise,
        guestQueuedPromise,
      ]);
      if ('error' in hostQueuedResponse) {
        throw new Error(
          'Expected both clients to observe a buffered build intent',
        );
      }

      const hostQueued: BuildQueuedPayload = hostQueuedResponse.queued;
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
      const hostQueuedTeam = hostStructures.teams.find(
        (team) => team.id === setup.hostTeam.id,
      );
      const guestPendingBuilds =
        guestStructures.teams.find((team) => team.id === setup.hostTeam.id)
          ?.pendingBuilds ?? [];
      const guestQueuedTeam = guestStructures.teams.find(
        (team) => team.id === setup.hostTeam.id,
      );

      expect(hostPendingBuilds).toEqual(guestPendingBuilds);
      expect(hostQueuedTeam?.resources).toBeLessThan(initialHostTeam.resources);
      expect(guestQueuedTeam?.resources).toBe(hostQueuedTeam?.resources);
    },
    25_000,
  );
});
