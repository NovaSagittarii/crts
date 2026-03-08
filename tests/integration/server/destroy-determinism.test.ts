import { describe, expect } from 'vitest';

import type {
  BuildOutcomePayload,
  BuildQueuedPayload,
  DestroyQueuedPayload,
  RoomJoinedPayload,
} from '#rts-engine';

import { createMatchTest } from './match-fixtures.js';
import {
  type ActiveMatchSetup,
  collectCandidatePlacements,
  getTeamByPlayerId,
  waitForBuildOutcome,
  waitForBuildQueueResponse,
  waitForDestroyOutcome,
  waitForDestroyQueueResponse,
  waitForEvent,
  waitForRoomState,
} from './test-support.js';

const test = createMatchTest(
  { port: 0, width: 52, height: 52, tickMs: 40 },
  {
    roomName: 'Destroy Determinism Room',
    hostSessionId: 'destroy-determinism-host',
    guestSessionId: 'destroy-determinism-guest',
  },
  { startMode: 'manual' },
  { runtimeMode: 'manual' },
);

async function queueAppliedHostBlock(match: ActiveMatchSetup): Promise<{
  queued: BuildQueuedPayload;
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
    const buildResponsePromise = waitForBuildQueueResponse(match.host);
    match.host.emit('build:queue', {
      templateId: blockTemplate.id,
      x: placement.x,
      y: placement.y,
      delayTicks: 8,
    });

    const buildResponse = await buildResponsePromise;
    if ('error' in buildResponse) {
      continue;
    }

    const outcome = await waitForBuildOutcome(
      match.host,
      buildResponse.queued.eventId,
    );
    if (outcome.outcome !== 'applied') {
      continue;
    }

    const builtState = await waitForRoomState(
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

    const builtTeam = getTeamByPlayerId(builtState, match.hostJoined.playerId);
    const builtStructure = builtTeam.structures.find(
      (structure) =>
        !structure.isCore &&
        structure.templateId === blockTemplate.id &&
        structure.hp > 0,
    );
    if (!builtStructure) {
      continue;
    }

    return {
      queued: buildResponse.queued,
      outcome,
      structureKey: builtStructure.key,
    };
  }

  throw new Error('Unable to queue and apply host block before destroy tests');
}

describe('destroy reconnect determinism', () => {
  test('reconnects during pending destroy and converges on one authoritative terminal outcome', async ({
    activeMatch,
    connectClient,
  }) => {
    const match = activeMatch;
    const appliedBuild = await queueAppliedHostBlock(match);
    expect(appliedBuild.outcome.outcome).toBe('applied');

    const destroyResponsePromise = waitForDestroyQueueResponse(match.host);
    match.host.emit('destroy:queue', {
      structureKey: appliedBuild.structureKey,
      delayTicks: 20,
    });
    const destroyResponse = await destroyResponsePromise;
    if ('error' in destroyResponse) {
      throw new Error(
        `Expected destroy queue acceptance, received ${destroyResponse.error.reason}`,
      );
    }

    const destroyQueued: DestroyQueuedPayload = destroyResponse.queued;
    expect(destroyQueued.idempotent).toBe(false);

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
          ({ eventId }) => eventId === destroyQueued.eventId,
        );
      },
      { attempts: 80, timeoutMs: 2000 },
    );

    const [hostOutcome, reconnectOutcome] = await Promise.all([
      waitForDestroyOutcome(match.host, destroyQueued.eventId, 16_000),
      waitForDestroyOutcome(reconnectGuest, destroyQueued.eventId, 16_000),
    ]);

    expect(reconnectOutcome).toEqual(hostOutcome);
    expect(hostOutcome.outcome).toBe('destroyed');
    expect(hostOutcome.structureKey).toBe(appliedBuild.structureKey);

    const [hostSettled, reconnectSettled] = await Promise.all([
      waitForRoomState(
        match.host,
        match.roomId,
        (payload) => {
          const hostTeam = getTeamByPlayerId(
            payload,
            match.hostJoined.playerId,
          );
          return (
            !hostTeam.pendingDestroys.some(
              ({ eventId }) => eventId === destroyQueued.eventId,
            ) &&
            !hostTeam.structures.some(
              ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
            )
          );
        },
        { attempts: 80, timeoutMs: 2000 },
      ),
      waitForRoomState(
        reconnectGuest,
        match.roomId,
        (payload) => {
          const hostTeam = getTeamByPlayerId(
            payload,
            match.hostJoined.playerId,
          );
          return (
            !hostTeam.pendingDestroys.some(
              ({ eventId }) => eventId === destroyQueued.eventId,
            ) &&
            !hostTeam.structures.some(
              ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
            )
          );
        },
        { attempts: 80, timeoutMs: 2000 },
      ),
    ]);

    const hostTeam = getTeamByPlayerId(hostSettled, match.hostJoined.playerId);
    const reconnectTeam = getTeamByPlayerId(
      reconnectSettled,
      match.hostJoined.playerId,
    );
    expect(reconnectTeam.pendingDestroys).toEqual(hostTeam.pendingDestroys);
    expect(reconnectTeam.structures).toEqual(hostTeam.structures);
  }, 60_000);

  test('reconnects after resolved destroy and receives converged authoritative state', async ({
    activeMatch,
    connectClient,
  }) => {
    const match = activeMatch;
    const appliedBuild = await queueAppliedHostBlock(match);
    expect(appliedBuild.outcome.outcome).toBe('applied');

    const destroyResponsePromise = waitForDestroyQueueResponse(match.host);
    match.host.emit('destroy:queue', {
      structureKey: appliedBuild.structureKey,
      delayTicks: 1,
    });
    const destroyResponse = await destroyResponsePromise;
    if ('error' in destroyResponse) {
      throw new Error(
        `Expected destroy queue acceptance, received ${destroyResponse.error.reason}`,
      );
    }

    const destroyQueued: DestroyQueuedPayload = destroyResponse.queued;
    const hostOutcome = await waitForDestroyOutcome(
      match.host,
      destroyQueued.eventId,
    );
    expect(hostOutcome.outcome).toBe('destroyed');
    expect(hostOutcome.structureKey).toBe(appliedBuild.structureKey);

    const hostSettled = await waitForRoomState(
      match.host,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        return (
          !hostTeam.pendingDestroys.some(
            ({ eventId }) => eventId === destroyQueued.eventId,
          ) &&
          !hostTeam.structures.some(
            ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
          )
        );
      },
      { attempts: 80, timeoutMs: 2000 },
    );

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

    const reconnectSettled = await waitForRoomState(
      reconnectGuest,
      match.roomId,
      (payload) => {
        const hostTeam = getTeamByPlayerId(payload, match.hostJoined.playerId);
        return (
          !hostTeam.pendingDestroys.some(
            ({ eventId }) => eventId === destroyQueued.eventId,
          ) &&
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
