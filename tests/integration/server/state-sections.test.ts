import { describe, expect } from 'vitest';

import type {
  BuildQueuedPayload,
  RoomGridStatePayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  RoomStateHashesPayload,
  RoomStructuresStatePayload,
} from '#rts-engine';

import { createLockstepTest } from './lockstep-fixtures.js';
import { createMatchTest } from './match-fixtures.js';
import {
  collectCandidatePlacements,
  observeEvents,
  waitForBuildQueueResponse,
  waitForEvent,
  waitForMembership,
  waitForNoEvent,
  waitForState,
  waitForStateGrid,
  waitForStateHashes,
  waitForStateStructures,
} from './test-support.js';

const STATE_REQUEST_ADVANCE_MS = 100;
const sectionsMatchTest = createMatchTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 40,
    countdownSeconds: 0,
    activeStateSnapshotIntervalTicks: 1000,
  },
  {
    roomName: 'State Sections Room',
    hostSessionId: 'sections-host',
    guestSessionId: 'sections-guest',
  },
  {},
  { clockMode: 'manual' },
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
  {},
  { clockMode: 'manual' },
);

describe('section sync and queued fanout', () => {
  sectionsMatchTest(
    'serves grid and structures sections only to the requester',
    async ({ activeMatch, integration }) => {
      const setup = activeMatch;
      const generatorTemplate = setup.hostJoined.templates.find(
        ({ id }) => id === 'generator',
      );
      if (!generatorTemplate) {
        throw new Error('Expected generator template to be available');
      }

      const guestInitialGridObserver = observeEvents<RoomGridStatePayload>(
        setup.guest,
        'state:grid',
      );
      const initialGridPromise = waitForStateGrid(
        setup.host,
        (payload: RoomGridStatePayload) => payload.roomId === setup?.roomId,
        {
          roomId: setup.roomId,
        },
      );
      await integration.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const initialGrid = await initialGridPromise;
      await integration.clock.flush();
      guestInitialGridObserver.stop();
      expect(guestInitialGridObserver.events).toHaveLength(0);
      expect(initialGrid.hashHex).toMatch(/^[0-9a-f]{8}$/);

      const duplicateGridObserver = observeEvents<RoomGridStatePayload>(
        setup.host,
        'state:grid',
      );
      setup.host.emit('state:request', { sections: ['grid'] });
      await integration.clock.flush();
      duplicateGridObserver.stop();
      expect(duplicateGridObserver.events).toHaveLength(0);

      const guestInitialStructuresObserver =
        observeEvents<RoomStructuresStatePayload>(
          setup.guest,
          'state:structures',
        );
      const initialStructuresPromise = waitForStateStructures(
        setup.host,
        (payload: RoomStructuresStatePayload) =>
          payload.roomId === setup?.roomId,
        {
          roomId: setup.roomId,
        },
      );
      await integration.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const initialStructures = await initialStructuresPromise;
      await integration.clock.flush();
      guestInitialStructuresObserver.stop();
      expect(guestInitialStructuresObserver.events).toHaveLength(0);
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

      const guestUpdatedStructuresObserver =
        observeEvents<RoomStructuresStatePayload>(
          setup.guest,
          'state:structures',
        );
      const updatedStructuresPromise = waitForStateStructures(
        setup.host,
        (payload: RoomStructuresStatePayload) =>
          payload.roomId === setup?.roomId &&
          payload.hashHex === hashes.structuresHash,
        {
          roomId: setup.roomId,
        },
      );
      await integration.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const updatedStructures = await updatedStructuresPromise;
      await integration.clock.flush();
      guestUpdatedStructuresObserver.stop();
      expect(guestUpdatedStructuresObserver.events).toHaveLength(0);
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
    },
    25_000,
  );

  sectionsMatchTest(
    'serves membership sections only to the requester and re-serves after membership hash changes',
    async ({ activeMatch, connectClient, integration }) => {
      const setup = activeMatch;

      await integration.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      await integration.clock.flush();
      const guestMembershipObserver = observeEvents<RoomMembershipPayload>(
        setup.guest,
        'room:membership',
      );
      const requestedMembershipObserver = observeEvents<RoomMembershipPayload>(
        setup.host,
        'room:membership',
      );

      setup.host.emit('state:request', { sections: ['membership'] });
      await integration.clock.flush();

      expect(requestedMembershipObserver.events).toHaveLength(1);
      const initialMembership = requestedMembershipObserver.events[0];

      expect(initialMembership.roomId).toBe(setup.roomId);
      requestedMembershipObserver.stop();
      expect(guestMembershipObserver.events).toHaveLength(0);
      guestMembershipObserver.stop();

      const duplicateMembershipObserver = observeEvents<RoomMembershipPayload>(
        setup.host,
        'room:membership',
      );
      setup.host.emit('state:request', { sections: ['membership'] });
      await integration.clock.flush();
      expect(duplicateMembershipObserver.events).toHaveLength(0);

      await integration.clock.advanceMs(120);
      setup.host.emit('state:request', { sections: ['membership'] });
      await integration.clock.flush();
      expect(duplicateMembershipObserver.events).toHaveLength(0);
      duplicateMembershipObserver.stop();

      const spectator = connectClient({ sessionId: 'sections-spectator' });
      await waitForEvent<RoomJoinedPayload>(spectator, 'room:joined');
      spectator.emit('room:join', { roomId: setup.roomId });
      const spectatorJoined = await waitForEvent<RoomJoinedPayload>(
        spectator,
        'room:joined',
      );

      const updatedMembership = await waitForMembership(
        setup.host,
        setup.roomId,
        (payload) =>
          payload.participants.some(
            ({ sessionId }) => sessionId === spectatorJoined.playerId,
          ),
        { overallTimeoutMs: 8_000 },
      );
      expect(updatedMembership.membershipHash).not.toBe(
        initialMembership.membershipHash,
      );

      await integration.clock.advanceMs(120);
      const guestUpdatedMembershipObserver =
        observeEvents<RoomMembershipPayload>(setup.guest, 'room:membership');
      const refreshedMembershipObserver = observeEvents<RoomMembershipPayload>(
        setup.host,
        'room:membership',
      );
      setup.host.emit('state:request', { sections: ['membership'] });
      await integration.clock.flush();

      expect(refreshedMembershipObserver.events).toHaveLength(1);
      const refreshedMembership = refreshedMembershipObserver.events[0];

      expect(refreshedMembership.membershipHash).toBe(
        updatedMembership.membershipHash,
      );
      expect(
        refreshedMembership.participants.some(
          ({ sessionId }) => sessionId === spectatorJoined.playerId,
        ),
      ).toBe(true);

      await integration.clock.flush();
      expect(guestUpdatedMembershipObserver.events).toHaveLength(0);
      refreshedMembershipObserver.stop();
      guestUpdatedMembershipObserver.stop();
    },
    25_000,
  );

  lockstepSectionsTest(
    'broadcasts authoritative queued intents and queue hashes immediately in primary mode',
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

      const initialStatePromise = waitForState(
        setup.host,
        (payload) => payload.roomId === setup.roomId,
        {
          roomId: setup.roomId,
          attempts: 20,
          timeoutMs: 2_000,
        },
      );
      await connectedRoom.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const initialState = await initialStatePromise;
      const initialHostTeam = initialState.teams.find(
        (team) => team.id === setup.hostTeam.id,
      );
      if (!initialHostTeam) {
        throw new Error('Expected host team in initial structures state');
      }
      const initialStructuresHash = setup.hostJoined.stateHashes.structuresHash;

      const hostQueuedObserver = observeEvents<BuildQueuedPayload>(
        setup.host,
        'build:queued',
      );
      const guestQueuedObserver = observeEvents<BuildQueuedPayload>(
        setup.guest,
        'build:queued',
      );
      const hostQueuedPromise = waitForBuildQueueResponse(setup.host, 4_000);
      const guestQueuedPromise = waitForEvent<BuildQueuedPayload>(
        setup.guest,
        'build:queued',
        4_000,
      );
      const hostHashesPromise = waitForStateHashes(
        setup.host,
        (payload) =>
          payload.roomId === setup.roomId &&
          payload.structuresHash !== initialStructuresHash,
        {
          attempts: 10,
          timeoutMs: 1_000,
        },
      );
      const guestHashesPromise = waitForStateHashes(
        setup.guest,
        (payload) =>
          payload.roomId === setup.roomId &&
          payload.structuresHash !== initialStructuresHash,
        {
          attempts: 10,
          timeoutMs: 1_000,
        },
      );

      setup.host.emit('build:queue', {
        templateId: generatorTemplate.id,
        x: placement.x,
        y: placement.y,
      });

      const [hostQueuedResponse, guestQueued] = await Promise.all([
        hostQueuedPromise,
        guestQueuedPromise,
      ]);

      expect(hostQueuedObserver.events.length).toBeGreaterThan(0);
      expect(guestQueuedObserver.events.length).toBeGreaterThan(0);
      hostQueuedObserver.stop();
      guestQueuedObserver.stop();
      if ('error' in hostQueuedResponse) {
        throw new Error(
          'Expected both clients to observe an accepted build intent immediately',
        );
      }

      const hostQueued: BuildQueuedPayload = hostQueuedResponse.queued;
      expect(guestQueued).toEqual(hostQueued);
      expect(hostQueued.playerId).toBe(setup.hostJoined.playerId);
      expect(hostQueued.teamId).toBe(setup.hostTeam.id);
      expect(hostQueued.scheduledByTurn).toBeGreaterThan(
        hostQueued.bufferedTurn,
      );
      await waitForNoEvent(setup.host, 'build:queued', 150);
      const [hostHashes, guestHashes] = await Promise.all([
        hostHashesPromise,
        guestHashesPromise,
      ]);

      expect(hostHashes.structuresHash).not.toBe(initialStructuresHash);
      expect(hostHashes.structuresHash).toBe(guestHashes.structuresHash);
      expect(hostHashes.gridHash).toBe(guestHashes.gridHash);
      expect(hostQueued.executeTick).toBeGreaterThan(initialState.tick);
      expect(initialHostTeam.resources).toBeGreaterThan(0);
    },
    25_000,
  );
});
