import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { Socket } from 'socket.io-client';

import {
  createServer,
  type GameServer,
} from '../../../apps/server/src/server.js';

import type {
  BuildScheduledPayload,
  BuildOutcomePayload,
  RoomJoinedPayload,
} from '#rts-engine';
import { setupActiveMatch } from './match-support.js';
import {
  createClient,
  type ActiveMatchSetup,
  type TestClientOptions,
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

async function queueAppliedHostBlock(match: ActiveMatchSetup): Promise<{
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
    const buildResponsePromise = waitForBuildQueueResponse(match.host);
    const scheduledPromise = waitForBuildScheduled(match.host, 4_000).catch(
      () => null,
    );
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

    const scheduled = await scheduledPromise;
    if (!scheduled) {
      continue;
    }

    const outcome = await waitForBuildOutcome(match.host, scheduled.eventId);
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
      scheduled,
      outcome,
      structureKey: builtStructure.key,
    };
  }

  throw new Error('Unable to queue and apply host block before destroy tests');
}

describe('destroy reconnect determinism', () => {
  let server: GameServer;
  let port = 0;
  const sockets: Socket[] = [];

  beforeEach(async () => {
    server = createServer({ port: 0, width: 52, height: 52, tickMs: 40 });
    port = await server.start();
  });

  afterEach(async () => {
    for (const socket of sockets) {
      socket.close();
    }
    await server.stop();
  });

  function connectClientForTest(options: TestClientOptions = {}): Socket {
    const socket = createClient(port, options);
    sockets.push(socket);
    return socket;
  }

  test('reconnects during pending destroy and converges on one authoritative terminal outcome', async () => {
    const match = await setupActiveMatch({
      connectClient: (options) => connectClientForTest(options),
      roomName: 'Destroy Determinism Room',
      hostSessionId: 'destroy-determinism-host',
      guestSessionId: 'destroy-determinism-guest',
    });
    const appliedBuild = await queueAppliedHostBlock(match);
    expect(appliedBuild.outcome.outcome).toBe('applied');

    const destroyResponsePromise = waitForDestroyQueueResponse(match.host);
    const destroyScheduledPromise = waitForDestroyScheduled(match.host, 4_000);
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

    const destroyScheduled = await destroyScheduledPromise;
    expect(destroyScheduled.idempotent).toBe(false);

    match.guest.disconnect();

    const reconnectGuest = connectClientForTest({
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
      { attempts: 80, timeoutMs: 2000 },
    );

    const [hostOutcome, reconnectOutcome] = await Promise.all([
      waitForDestroyOutcome(match.host, destroyScheduled.eventId, 16_000),
      waitForDestroyOutcome(reconnectGuest, destroyScheduled.eventId, 16_000),
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
              ({ eventId }) => eventId === destroyScheduled.eventId,
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
              ({ eventId }) => eventId === destroyScheduled.eventId,
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

  test('reconnects after resolved destroy and receives converged authoritative state', async () => {
    const match = await setupActiveMatch({
      connectClient: (options) => connectClientForTest(options),
      roomName: 'Destroy Determinism Room',
      hostSessionId: 'destroy-determinism-host',
      guestSessionId: 'destroy-determinism-guest',
    });
    const appliedBuild = await queueAppliedHostBlock(match);
    expect(appliedBuild.outcome.outcome).toBe('applied');

    const destroyResponsePromise = waitForDestroyQueueResponse(match.host);
    const destroyScheduledPromise = waitForDestroyScheduled(match.host, 4_000);
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

    const destroyScheduled = await destroyScheduledPromise;
    const hostOutcome = await waitForDestroyOutcome(
      match.host,
      destroyScheduled.eventId,
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
            ({ eventId }) => eventId === destroyScheduled.eventId,
          ) &&
          !hostTeam.structures.some(
            ({ key, hp }) => key === appliedBuild.structureKey && hp > 0,
          )
        );
      },
      { attempts: 80, timeoutMs: 2000 },
    );

    match.guest.disconnect();

    const reconnectGuest = connectClientForTest({
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
            ({ eventId }) => eventId === destroyScheduled.eventId,
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
