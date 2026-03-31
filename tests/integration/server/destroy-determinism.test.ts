import { describe, expect } from 'vitest';

import type { DestroyQueuedPayload, RoomJoinedPayload } from '#rts-engine';

import { createMatchTest } from './match-fixtures.js';
import {
  getTeamByPlayerId,
  queueAppliedHostBlock,
  waitForDestroyOutcome,
  waitForDestroyQueueResponse,
  waitForEvent,
  waitForRoomState,
} from './test-support.js';

const OUTCOME_ADVANCE_MARGIN_TICKS = 2;

const test = createMatchTest(
  { port: 0, width: 52, height: 52, tickMs: 40, countdownSeconds: 0 },
  {
    roomName: 'Destroy Determinism Room',
    hostSessionId: 'destroy-determinism-host',
    guestSessionId: 'destroy-determinism-guest',
  },
  {},
  { clockMode: 'manual' },
);

describe('destroy reconnect determinism', () => {
  test('reconnects during pending destroy and converges on one authoritative terminal outcome', async ({
    activeMatch,
    connectClient,
    integration,
  }) => {
    const match = activeMatch;
    const appliedBuild = await queueAppliedHostBlock(match, integration.clock);
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

    const hostOutcomePromise = waitForDestroyOutcome(
      match.host,
      destroyQueued.eventId,
      16_000,
    );
    const reconnectOutcomePromise = waitForDestroyOutcome(
      reconnectGuest,
      destroyQueued.eventId,
      16_000,
    );
    await integration.clock.advanceTicks(
      destroyQueued.delayTicks + OUTCOME_ADVANCE_MARGIN_TICKS,
    );
    const [hostOutcome, reconnectOutcome] = await Promise.all([
      hostOutcomePromise,
      reconnectOutcomePromise,
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
    integration,
  }) => {
    const match = activeMatch;
    const appliedBuild = await queueAppliedHostBlock(match, integration.clock);
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
    const hostOutcomePromise = waitForDestroyOutcome(
      match.host,
      destroyQueued.eventId,
    );
    await integration.clock.advanceTicks(
      destroyQueued.delayTicks + OUTCOME_ADVANCE_MARGIN_TICKS,
    );
    const hostOutcome = await hostOutcomePromise;
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
