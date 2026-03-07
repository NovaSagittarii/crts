import { describe, expect, test } from 'vitest';

import { createServer } from '../../../apps/server/src/server.js';
import type {
  BuildScheduledPayload,
  BuildQueuedPayload,
  RoomGridStatePayload,
  RoomStateHashesPayload,
  RoomStructuresStatePayload,
} from '#rts-engine';
import { setupActiveMatch } from './match-support.js';
import {
  type ActiveMatchSetup,
  createClient,
  waitForBuildQueueResponse,
  waitForBuildScheduled,
  waitForEvent,
  waitForNoEvent,
  waitForStateGrid,
  waitForStateHashes,
  waitForStateStructures,
} from './test-support.js';

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

    let setup: ActiveMatchSetup | null = null;

    try {
      setup = await setupActiveMatch({
        connectClient: (options) => createClient(port, options),
        roomName: 'State Sections Room',
        hostSessionId: 'sections-host',
        guestSessionId: 'sections-guest',
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

      await Promise.all([
        waitForNoEvent(setup.guest, 'state:grid', 250),
        waitForNoEvent(setup.guest, 'state:structures', 250),
      ]);
    } finally {
      setup?.host.close();
      setup?.guest.close();
      await server.stop();
    }
  }, 25_000);

  test('broadcasts authoritative queued intents and scheduled builds on turn flush', async () => {
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

    let setup: ActiveMatchSetup | null = null;

    try {
      setup = await setupActiveMatch({
        connectClient: (options) => createClient(port, options),
        roomName: 'State Sections Room',
        hostSessionId: 'sections-host',
        guestSessionId: 'sections-guest',
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
      const hostScheduledPromise = waitForBuildScheduled(setup.host, 6_000);
      const guestScheduledPromise = waitForBuildScheduled(setup.guest, 6_000);
      const earlyHostScheduledPromise = waitForEvent<BuildScheduledPayload>(
        setup.host,
        'build:scheduled',
        250,
      );

      setup.host.emit('build:queue', {
        templateId: 'block',
        x: setup.hostTeam.baseTopLeft.x + 8,
        y: setup.hostTeam.baseTopLeft.y + 8,
      });

      await expect(earlyHostQueuedPromise).rejects.toThrow(/timed out/i);
      await expect(earlyGuestQueuedPromise).rejects.toThrow(/timed out/i);
      await expect(earlyHostScheduledPromise).rejects.toThrow(/timed out/i);

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

      const [hostScheduled, guestScheduled] = await Promise.all([
        hostScheduledPromise,
        guestScheduledPromise,
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
