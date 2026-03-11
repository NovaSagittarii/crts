import { describe, expect } from 'vitest';

import type {
  BuildOutcomePayload,
  BuildQueuedPayload,
  DestroyOutcomePayload,
  DestroyQueuedPayload,
  LockstepCheckpointPayload,
  LockstepFallbackPayload,
  MatchFinishedPayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  TeamPayload,
} from '#rts-engine';

import { createLockstepTest } from './lockstep-fixtures.js';
import {
  claimSlot,
  collectCandidatePlacements,
  getTeamByPlayerId,
  observeEvents,
  waitForBuildOutcome,
  waitForBuildQueueResponse,
  waitForDestroyOutcome,
  waitForDestroyQueueResponse,
  waitForEvent,
  waitForMembership,
  waitForRoomState,
  waitForState,
} from './test-support.js';

const SHADOW_QUEUE_ADVANCE_LIMIT_TICKS = 5;
const SHADOW_STATE_REQUEST_ADVANCE_MS = 100;

const test = createLockstepTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 40,
    lockstepMode: 'shadow',
    lockstepCheckpointIntervalTicks: 1,
  },
  {
    roomName: 'Shadow Lockstep Room',
    hostSessionId: 'shadow-host',
    guestSessionId: 'shadow-guest',
  },
  {},
  { clockMode: 'manual' },
);

function resolveTeamForPlayer(
  teams: TeamPayload[],
  playerId: string,
): TeamPayload {
  const team = teams.find(({ playerIds }) => playerIds.includes(playerId));
  if (!team) {
    throw new Error(`Failed to find team for player ${playerId}`);
  }
  return team;
}

describe('lockstep shadow mode', () => {
  test('keeps a two-player match in lockstep during normal queue flow', async ({
    clock,
    connectedRoom,
  }) => {
    const host = connectedRoom.host;
    const guest = connectedRoom.guest;
    const hostJoined = connectedRoom.hostJoined;
    const guestJoined = connectedRoom.guestJoined;

    expect(hostJoined.lockstep?.mode).toBe('shadow');
    expect(hostJoined.lockstep?.status).toBe('running');

    await claimSlot(host, 'team-1');
    const hostLeftPromise = waitForEvent(host, 'room:left');
    host.emit('room:leave');
    await hostLeftPromise;

    const hostRejoinedPromise = waitForEvent<RoomJoinedPayload>(
      host,
      'room:joined',
    );
    host.emit('room:join', { roomId: connectedRoom.roomId });
    const hostRejoined = await hostRejoinedPromise;

    await claimSlot(host, 'team-1');
    await claimSlot(guest, 'team-2');

    await waitForMembership(
      host,
      connectedRoom.roomId,
      (payload: RoomMembershipPayload) =>
        payload.slots['team-1'] === hostRejoined.playerId &&
        payload.slots['team-2'] === guestJoined.playerId,
    );

    const fallbackEvents: LockstepFallbackPayload[] = [];
    host.on('lockstep:fallback', (payload: LockstepFallbackPayload) => {
      fallbackEvents.push(payload);
    });

    const readyMembershipPromise = waitForMembership(
      host,
      connectedRoom.roomId,
      (payload: RoomMembershipPayload) =>
        payload.participants.filter(
          ({ role, ready }) => role === 'player' && ready,
        ).length === 2,
    );
    host.emit('room:set-ready', { ready: true });
    guest.emit('room:set-ready', { ready: true });
    await readyMembershipPromise;

    guest.emit('room:start');
    await waitForEvent(host, 'room:match-started', 7_000);

    const firstCheckpointPromise = waitForEvent<LockstepCheckpointPayload>(
      host,
      'lockstep:checkpoint',
      4_000,
    );
    await clock.advanceTicks(1);
    const firstCheckpoint = await firstCheckpointPromise;
    expect(firstCheckpoint.roomId).toBe(connectedRoom.roomId);
    expect(firstCheckpoint.mode).toBe('shadow');
    expect(firstCheckpoint.hashHex).toMatch(/^[0-9a-f]{8}$/);

    const statePromise = waitForState(
      host,
      (payload) =>
        payload.roomId === connectedRoom.roomId &&
        payload.teams.some(({ playerIds }) =>
          playerIds.includes(hostRejoined.playerId),
        ),
      {
        roomId: connectedRoom.roomId,
        attempts: 40,
        timeoutMs: 2_000,
      },
    );
    await clock.advanceMs(SHADOW_STATE_REQUEST_ADVANCE_MS);
    const state = await statePromise;
    const team = resolveTeamForPlayer(state.teams, hostRejoined.playerId);

    const queuedObserver = observeEvents<BuildQueuedPayload>(
      host,
      'build:queued',
    );
    const queuedPromise = waitForBuildQueueResponse(host, 3_000);
    const guestQueuedPromise = waitForEvent<BuildQueuedPayload>(
      guest,
      'build:queued',
      3_000,
    );
    const secondCheckpointPromise = waitForEvent<LockstepCheckpointPayload>(
      host,
      'lockstep:checkpoint',
      4_000,
    );

    host.emit('build:queue', {
      templateId: 'block',
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
    });

    for (
      let advancedTicks = 0;
      advancedTicks < SHADOW_QUEUE_ADVANCE_LIMIT_TICKS &&
      queuedObserver.events.length === 0;
      advancedTicks += 1
    ) {
      await clock.advanceTicks(1);
    }

    queuedObserver.stop();
    expect(queuedObserver.events.length).toBeGreaterThan(0);

    const [queued, guestQueued] = await Promise.all([
      queuedPromise,
      guestQueuedPromise,
    ]);
    if ('error' in queued) {
      throw new Error(
        `Build queue rejected: ${queued.error.reason ?? queued.error.message}`,
      );
    }

    expect(guestQueued).toEqual(queued.queued);
    expect(guestQueued.playerId).toBe(hostRejoined.playerId);
    expect(guestQueued.teamId).toBe(team.id);

    const secondCheckpoint = await secondCheckpointPromise;
    expect(secondCheckpoint.tick).toBeGreaterThanOrEqual(firstCheckpoint.tick);
    expect(secondCheckpoint.mode).toBe('shadow');

    expect(fallbackEvents).toEqual([]);

    host.off('lockstep:fallback');
  }, 25_000);

  test('keeps two players synchronized through build, destroy, and match finish', async ({
    clock,
    connectedRoom,
    startLockstepMatch,
  }) => {
    expect(connectedRoom.hostJoined.lockstep?.mode).toBe('shadow');
    expect(connectedRoom.hostJoined.lockstep?.status).toBe('running');

    const match = await startLockstepMatch(connectedRoom);
    const fallbackEvents: LockstepFallbackPayload[] = [];
    match.host.on('lockstep:fallback', (payload: LockstepFallbackPayload) => {
      fallbackEvents.push(payload);
    });

    const blockTemplate = match.hostJoined.templates.find(
      ({ id }) => id === 'block',
    );
    if (!blockTemplate) {
      throw new Error('Expected block template in joined payload');
    }

    const initialHostStructureKeys = new Set(
      match.hostTeam.structures.map(({ key }) => key),
    );
    const candidatePlacements = collectCandidatePlacements(
      match.hostTeam,
      blockTemplate,
      match.hostJoined.state.width,
      match.hostJoined.state.height,
    );
    if (candidatePlacements.length === 0) {
      throw new Error('Expected at least one valid host build placement');
    }

    let buildQueued: BuildQueuedPayload | null = null;
    let hostBuildOutcome: BuildOutcomePayload | null = null;
    let guestBuildOutcome: BuildOutcomePayload | null = null;
    for (const placement of candidatePlacements) {
      const hostQueuedPromise = waitForBuildQueueResponse(match.host, 4_000);
      const guestQueuedPromise = waitForEvent<BuildQueuedPayload>(
        match.guest,
        'build:queued',
        4_000,
      );

      match.host.emit('build:queue', {
        templateId: blockTemplate.id,
        x: placement.x,
        y: placement.y,
        delayTicks: 8,
      });

      const [hostQueueResponse, guestQueued] = await Promise.all([
        hostQueuedPromise,
        guestQueuedPromise,
      ]);
      if ('error' in hostQueueResponse) {
        continue;
      }

      expect(guestQueued).toEqual(hostQueueResponse.queued);

      const currentQueued = hostQueueResponse.queued;
      const hostOutcomePromise = waitForBuildOutcome(
        match.host,
        currentQueued.eventId,
        12_000,
      );
      const guestOutcomePromise = waitForBuildOutcome(
        match.guest,
        currentQueued.eventId,
        12_000,
      );

      await clock.advanceTicks(currentQueued.delayTicks + 2);

      const [nextHostOutcome, nextGuestOutcome] = await Promise.all([
        hostOutcomePromise,
        guestOutcomePromise,
      ]);
      expect(nextGuestOutcome).toEqual(nextHostOutcome);

      if (nextHostOutcome.outcome !== 'applied') {
        continue;
      }

      buildQueued = currentQueued;
      hostBuildOutcome = nextHostOutcome;
      guestBuildOutcome = nextGuestOutcome;
      break;
    }

    expect(buildQueued).not.toBeNull();
    expect(hostBuildOutcome?.outcome).toBe('applied');
    expect(guestBuildOutcome).toEqual(hostBuildOutcome);

    const [hostSettledState, guestSettledState] = await Promise.all([
      waitForRoomState(
        match.host,
        match.roomId,
        (payload) => {
          const hostTeam = getTeamByPlayerId(
            payload,
            match.hostJoined.playerId,
          );
          return hostTeam.structures.some(
            ({ isCore, key }) => !initialHostStructureKeys.has(key) && !isCore,
          );
        },
        { attempts: 40, timeoutMs: 2_000 },
      ),
      waitForRoomState(
        match.guest,
        match.roomId,
        (payload) => {
          const hostTeam = getTeamByPlayerId(
            payload,
            match.hostJoined.playerId,
          );
          return hostTeam.structures.some(
            ({ isCore, key }) => !initialHostStructureKeys.has(key) && !isCore,
          );
        },
        { attempts: 40, timeoutMs: 2_000 },
      ),
    ]);

    const hostBuiltStructure = getTeamByPlayerId(
      hostSettledState,
      match.hostJoined.playerId,
    ).structures.find(
      ({ isCore, key }) => !initialHostStructureKeys.has(key) && !isCore,
    );
    const guestBuiltStructure = getTeamByPlayerId(
      guestSettledState,
      match.hostJoined.playerId,
    ).structures.find(
      ({ isCore, key }) => !initialHostStructureKeys.has(key) && !isCore,
    );
    expect(hostBuiltStructure).toBeDefined();
    expect(guestBuiltStructure).toEqual(hostBuiltStructure);

    const guestCore = match.guestTeam.structures.find(({ isCore }) => isCore);
    if (!guestCore) {
      throw new Error('Expected guest core structure');
    }

    const guestDestroyQueuedPromise = waitForDestroyQueueResponse(
      match.guest,
      4_000,
    );
    const hostDestroyQueuedPromise = waitForEvent<DestroyQueuedPayload>(
      match.host,
      'destroy:queued',
      4_000,
    );

    match.guest.emit('destroy:queue', {
      structureKey: guestCore.key,
      delayTicks: 1,
    });

    const [guestDestroyQueueResponse, hostDestroyQueued] = await Promise.all([
      guestDestroyQueuedPromise,
      hostDestroyQueuedPromise,
    ]);
    if ('error' in guestDestroyQueueResponse) {
      throw new Error(
        `Destroy queue rejected: ${guestDestroyQueueResponse.error.reason ?? guestDestroyQueueResponse.error.message}`,
      );
    }

    expect(hostDestroyQueued).toEqual(guestDestroyQueueResponse.queued);

    const destroyQueued = guestDestroyQueueResponse.queued;
    const hostDestroyOutcomePromise = waitForDestroyOutcome(
      match.host,
      destroyQueued.eventId,
      12_000,
    );
    const guestDestroyOutcomePromise = waitForDestroyOutcome(
      match.guest,
      destroyQueued.eventId,
      12_000,
    );
    const hostMatchFinishedPromise = waitForEvent<MatchFinishedPayload>(
      match.host,
      'room:match-finished',
      12_000,
    );
    const guestMatchFinishedPromise = waitForEvent<MatchFinishedPayload>(
      match.guest,
      'room:match-finished',
      12_000,
    );

    await clock.advanceTicks(destroyQueued.delayTicks + 3);

    const [
      hostDestroyOutcome,
      guestDestroyOutcome,
      hostMatchFinished,
      guestMatchFinished,
    ] = await Promise.all([
      hostDestroyOutcomePromise,
      guestDestroyOutcomePromise,
      hostMatchFinishedPromise,
      guestMatchFinishedPromise,
    ]);

    expect(guestDestroyOutcome).toEqual(hostDestroyOutcome);
    expect(hostDestroyOutcome.outcome).toBe('destroyed');
    expect(hostDestroyOutcome.structureKey).toBe(guestCore.key);
    expect(hostMatchFinished).toEqual(guestMatchFinished);
    expect(hostMatchFinished.winner.teamId).toBe(match.hostTeam.id);
    expect(
      hostMatchFinished.ranked.some(
        ({ outcome, teamId }) =>
          teamId === match.guestTeam.id &&
          (outcome === 'defeated' || outcome === 'eliminated'),
      ),
    ).toBe(true);
    expect(fallbackEvents).toEqual([]);

    match.host.off('lockstep:fallback');
  }, 35_000);
});
