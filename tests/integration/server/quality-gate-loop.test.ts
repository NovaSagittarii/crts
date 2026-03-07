import { describe, expect } from 'vitest';

import type {
  BuildScheduledPayload,
  BuildOutcomePayload,
  MatchFinishedPayload,
  PlacementTransformInput,
  RoomErrorPayload,
  RoomJoinedPayload,
} from '#rts-engine';
import {
  type ActiveMatchSetup,
  collectCandidatePlacements,
  getTeamByPlayerId,
  waitForBuildOutcome,
  waitForBuildQueueResponse,
  waitForBuildScheduled,
  waitForDestroyOutcome,
  waitForDestroyQueueResponse,
  waitForDestroyScheduled,
  waitForEvent,
  waitForRoomState,
} from './test-support.js';
import { createMatchTest } from './match-fixtures.js';

const test = createMatchTest(
  { port: 0, width: 52, height: 52, tickMs: 40 },
  { roomName: 'QUAL-02 Loop Room' },
  { waitForActiveMembership: true },
);

interface QueueBuildAttempt {
  transform?: PlacementTransformInput;
}

async function queueValidHostBuild(
  match: ActiveMatchSetup,
): Promise<{ scheduled: BuildScheduledPayload; outcome: BuildOutcomePayload }> {
  const blockTemplate = match.hostJoined.templates.find(
    ({ id }) => id === 'block',
  );
  if (!blockTemplate) {
    throw new Error('Expected block template to be available');
  }

  const attempts: QueueBuildAttempt[] = [{ transform: undefined }];

  for (const attempt of attempts) {
    const placements = collectCandidatePlacements(
      match.hostTeam,
      blockTemplate,
      match.hostJoined.state.width,
      match.hostJoined.state.height,
      { transform: attempt.transform },
    );

    for (const placement of placements) {
      const queueResponsePromise = waitForBuildQueueResponse(match.host);
      const scheduledPromise = waitForBuildScheduled(match.host, 4_000).catch(
        () => null,
      );
      match.host.emit('build:queue', {
        templateId: blockTemplate.id,
        x: placement.x,
        y: placement.y,
        transform: attempt.transform,
        delayTicks: 12,
      });

      const response = await queueResponsePromise;
      if ('error' in response) {
        continue;
      }

      const scheduled = await scheduledPromise;
      if (!scheduled) {
        continue;
      }

      const outcome = await waitForBuildOutcome(match.host, scheduled.eventId);
      return {
        scheduled,
        outcome,
      };
    }
  }

  throw new Error('Unable to queue a valid build for QUAL-02 scenario');
}

async function queueAppliedHostBuild(match: ActiveMatchSetup): Promise<{
  scheduled: BuildScheduledPayload;
  outcome: BuildOutcomePayload;
  structureKey: string;
}> {
  const blockTemplate = match.hostJoined.templates.find(
    ({ id }) => id === 'block',
  );
  if (!blockTemplate) {
    throw new Error('Expected block template to be available');
  }

  const placements = collectCandidatePlacements(
    match.hostTeam,
    blockTemplate,
    match.hostJoined.state.width,
    match.hostJoined.state.height,
  );

  for (const placement of placements) {
    const responsePromise = waitForBuildQueueResponse(match.host);
    const scheduledPromise = waitForBuildScheduled(match.host, 4_000).catch(
      () => null,
    );
    match.host.emit('build:queue', {
      templateId: blockTemplate.id,
      x: placement.x,
      y: placement.y,
      delayTicks: 8,
    });

    const response = await responsePromise;
    if ('error' in response) {
      continue;
    }

    const scheduled = await scheduledPromise;
    if (!scheduled) {
      continue;
    }

    const outcome = await waitForBuildOutcome(match.host, scheduled.eventId);
    if (outcome.outcome !== 'applied') {
      continue;
    }

    const stateWithBuiltBlock = await waitForRoomState(
      match.host,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        return hostTeam.structures.some(
          (structure) =>
            !structure.isCore &&
            structure.templateId === blockTemplate.id &&
            structure.hp > 0,
        );
      },
      { attempts: 40 },
    );

    const hostTeam = getTeamByPlayerId(
      stateWithBuiltBlock,
      match.hostJoined.playerId,
    );
    const structure = hostTeam.structures.find(
      (candidate) =>
        !candidate.isCore &&
        candidate.templateId === blockTemplate.id &&
        candidate.hp > 0,
    );
    if (!structure) {
      continue;
    }

    return {
      scheduled,
      outcome,
      structureKey: structure.key,
    };
  }

  throw new Error(
    'Unable to queue and apply a host block structure for destroy scenario',
  );
}

describe('QUAL-02 quality gate integration loop', () => {
  test('QUAL-02: join -> build -> tick -> breach -> defeat with defeated build rejection', async ({
    activeMatch,
  }) => {
    const match = activeMatch;

    // QUAL-02 requires one explicit build queue + terminal outcome in the loop.
    const { scheduled, outcome } = await queueValidHostBuild(match);
    expect(scheduled.eventId).toBeGreaterThan(0);
    expect(outcome.eventId).toBe(scheduled.eventId);
    expect(outcome.resolvedTick).toBeGreaterThanOrEqual(scheduled.executeTick);

    const matchFinishedPromise = waitForEvent<MatchFinishedPayload>(
      match.host,
      'room:match-finished',
      15_000,
    );

    const guestCore = match.guestTeam.structures.find(({ isCore }) => isCore);
    if (!guestCore) {
      throw new Error('Expected guest core structure to exist');
    }

    const destroyQueueResponsePromise = waitForDestroyQueueResponse(
      match.guest,
    );
    const destroyScheduledPromise = waitForDestroyScheduled(match.guest, 4_000);
    match.guest.emit('destroy:queue', {
      structureKey: guestCore.key,
      delayTicks: 1,
    });

    const destroyQueueResponse = await destroyQueueResponsePromise;
    if ('error' in destroyQueueResponse) {
      throw new Error(
        `Expected breach destroy queue acceptance, received ${destroyQueueResponse.error.reason}`,
      );
    }

    const destroyScheduled = await destroyScheduledPromise;

    const destroyOutcome = await waitForDestroyOutcome(
      match.guest,
      destroyScheduled.eventId,
      12_000,
    );
    expect(destroyOutcome.outcome).toBe('destroyed');
    expect(destroyOutcome.structureKey).toBe(guestCore.key);

    const finished = await matchFinishedPromise;
    expect(finished.roomId).toBe(match.roomId);
    expect(finished.comparator).toContain('coreHpBeforeResolution');

    const defeated = finished.ranked.find(
      ({ outcome: rankedOutcome }) => rankedOutcome !== 'winner',
    );
    if (!defeated) {
      throw new Error(
        'Expected a defeated team in room:match-finished payload',
      );
    }

    const defeatedSocket =
      defeated.teamId === match.hostTeam.id ? match.host : match.guest;
    const defeatedBaseTopLeft =
      defeated.teamId === match.hostTeam.id
        ? match.hostTeam.baseTopLeft
        : match.guestTeam.baseTopLeft;

    const defeatedErrorPromise = waitForEvent<RoomErrorPayload>(
      defeatedSocket,
      'room:error',
      4000,
    );
    defeatedSocket.emit('build:queue', {
      templateId: 'block',
      x: defeatedBaseTopLeft.x + 3,
      y: defeatedBaseTopLeft.y + 3,
      delayTicks: 1,
    });
    const defeatedError = await defeatedErrorPromise;

    expect(defeatedError.reason).toBe('defeated');
  }, 45_000);

  test('QUAL-04: build plus destroy stays deterministic across reconnect checkpoints', async ({
    activeMatch,
    connectClient,
  }) => {
    const match = activeMatch;

    const appliedBuild = await queueAppliedHostBuild(match);
    expect(appliedBuild.outcome.outcome).toBe('applied');

    const destroyQueueResponsePromise = waitForDestroyQueueResponse(match.host);
    const destroyScheduledPromise = waitForDestroyScheduled(match.host, 4_000);
    match.host.emit('destroy:queue', {
      structureKey: appliedBuild.structureKey,
      delayTicks: 20,
    });
    const destroyQueueResponse = await destroyQueueResponsePromise;
    if ('error' in destroyQueueResponse) {
      throw new Error(
        `Expected destroy queue acceptance in QUAL-04 scenario, received ${destroyQueueResponse.error.reason}`,
      );
    }

    const destroyScheduled = await destroyScheduledPromise;
    expect(destroyScheduled.idempotent).toBe(false);

    match.guest.disconnect();
    const reconnectGuest = connectClient({
      sessionId: match.guestJoined.playerId,
    });
    const rejoined = await waitForEvent<RoomJoinedPayload>(
      reconnectGuest,
      'room:joined',
      6000,
    );
    expect(rejoined.roomId).toBe(match.roomId);

    await waitForRoomState(
      reconnectGuest,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        return hostTeam.pendingDestroys.some(
          ({ eventId }) => eventId === destroyScheduled.eventId,
        );
      },
      { attempts: 60, timeoutMs: 2000 },
    );

    const [hostOutcome, reconnectOutcome] = await Promise.all([
      waitForDestroyOutcome(match.host, destroyScheduled.eventId, 16_000),
      waitForDestroyOutcome(reconnectGuest, destroyScheduled.eventId, 16_000),
    ]);
    expect(reconnectOutcome).toEqual(hostOutcome);
    expect(hostOutcome.outcome).toBe('destroyed');
    expect(hostOutcome.structureKey).toBe(appliedBuild.structureKey);

    const hostSettled = await waitForRoomState(
      match.host,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        const pendingIds = hostTeam.pendingDestroys.map(
          ({ eventId }) => eventId,
        );
        return (
          !pendingIds.includes(destroyScheduled.eventId) &&
          !hostTeam.structures.some(
            ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
          )
        );
      },
      { attempts: 80, timeoutMs: 2000 },
    );

    const reconnectSettled = await waitForRoomState(
      reconnectGuest,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        const pendingIds = hostTeam.pendingDestroys.map(
          ({ eventId }) => eventId,
        );
        return (
          !pendingIds.includes(destroyScheduled.eventId) &&
          !hostTeam.structures.some(
            ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
          )
        );
      },
      { attempts: 80, timeoutMs: 2000 },
    );

    const hostTeam = getTeamByPlayerId(hostSettled, match.hostJoined.playerId);
    const reconnectTeam = getTeamByPlayerId(
      reconnectSettled,
      match.hostJoined.playerId,
    );
    expect(reconnectTeam.pendingDestroys).toEqual(hostTeam.pendingDestroys);
    expect(reconnectTeam.structures).toEqual(hostTeam.structures);
  }, 60_000);
});
