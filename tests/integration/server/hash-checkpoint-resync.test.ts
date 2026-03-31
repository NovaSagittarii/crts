import { describe, expect } from 'vitest';

import type { LockstepCheckpointPayload } from '#rts-engine';

import { createLockstepTest } from './lockstep-fixtures.js';
import { observeEvents, waitForEvent, waitForState } from './test-support.js';

const STATE_REQUEST_ADVANCE_MS = 100;

const primaryTest = createLockstepTest(
  {
    port: 0,
    width: 52,
    height: 52,
    tickMs: 40,
    lockstepMode: 'primary',
    lockstepCheckpointIntervalTicks: 5,
  },
  {
    roomName: 'Checkpoint Resync Room',
    hostSessionId: 'resync-host',
    guestSessionId: 'resync-guest',
  },
  {},
  { clockMode: 'manual' },
);

describe('hash checkpoint resync protocol (SYNC-01, SYNC-02)', () => {
  primaryTest(
    'client receives full state after requesting resync on desync detection (SYNC-01, SYNC-02)',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Advance ticks past initial state to generate checkpoints
      await connectedRoom.clock.advanceTicks(10);

      // Wait for at least one checkpoint to confirm they are flowing
      const checkpoint = await waitForEvent<LockstepCheckpointPayload>(
        match.host,
        'lockstep:checkpoint',
        5_000,
      );
      expect(checkpoint.roomId).toBe(match.roomId);

      // Request full state snapshot via state:request with sections: ['full']
      // (simulating client desync recovery after hash mismatch)
      const statePromise = waitForState(
        match.host,
        (payload) => payload.roomId === match.roomId,
        {
          roomId: match.roomId,
          attempts: 40,
          timeoutMs: 5_000,
        },
      );
      await connectedRoom.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const statePayload = await statePromise;

      // Assert state payload has valid fields
      expect(statePayload.roomId).toBe(match.roomId);
      expect(statePayload.tick).toBeGreaterThan(0);
      expect(typeof statePayload.generation).toBe('number');
      expect(statePayload.teams.length).toBeGreaterThanOrEqual(2);
      expect(statePayload.grid).toBeTruthy();

      // Snapshot tick should be at least as recent as the checkpoint tick
      expect(statePayload.tick).toBeGreaterThanOrEqual(checkpoint.tick);
    },
    25_000,
  );

  primaryTest(
    'state snapshot tick is consistent with server checkpoint tick (SYNC-02)',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Observe checkpoints to capture the last one
      const checkpointObserver = observeEvents<LockstepCheckpointPayload>(
        match.host,
        'lockstep:checkpoint',
      );

      // Advance 15 ticks (3 checkpoint intervals with interval=5)
      await connectedRoom.clock.advanceTicks(15);

      // Capture last checkpoint
      expect(checkpointObserver.events.length).toBeGreaterThan(0);
      const lastCheckpoint =
        checkpointObserver.events[checkpointObserver.events.length - 1];
      checkpointObserver.stop();

      // Request full state snapshot
      const statePromise = waitForState(
        match.host,
        (payload) => payload.roomId === match.roomId,
        {
          roomId: match.roomId,
          attempts: 40,
          timeoutMs: 5_000,
        },
      );
      await connectedRoom.clock.advanceMs(STATE_REQUEST_ADVANCE_MS);
      const statePayload = await statePromise;

      // Snapshot tick must be at or after the most recent checkpoint tick
      // (server flush guarantee: turn-buffer commands flushed before snapshot)
      expect(statePayload.tick).toBeGreaterThanOrEqual(lastCheckpoint.tick);
      expect(statePayload.roomId).toBe(match.roomId);
    },
    25_000,
  );

  primaryTest(
    'multiple checkpoints emitted during primary lockstep match carry valid hashes (SYNC-01)',
    async ({ connectedRoom, startLockstepMatch }) => {
      const match = await startLockstepMatch(connectedRoom);

      // Observe checkpoint events
      const checkpointObserver = observeEvents<LockstepCheckpointPayload>(
        match.host,
        'lockstep:checkpoint',
      );

      // Advance 25 ticks (5 checkpoint intervals with interval=5)
      await connectedRoom.clock.advanceTicks(25);

      // Assert at least 3 checkpoints received
      expect(checkpointObserver.events.length).toBeGreaterThanOrEqual(3);

      // Validate each checkpoint has proper determinism hash fields
      for (const cp of checkpointObserver.events) {
        expect(cp.mode).toBe('primary');
        expect(cp.hashHex).toMatch(/^[0-9a-f]{8}$/);
        expect(cp.tick).toBeGreaterThan(0);
        expect(cp.roomId).toBe(match.roomId);
      }

      // Assert checkpoint ticks are strictly ascending
      for (let i = 1; i < checkpointObserver.events.length; i++) {
        expect(checkpointObserver.events[i].tick).toBeGreaterThan(
          checkpointObserver.events[i - 1].tick,
        );
      }

      checkpointObserver.stop();
    },
    25_000,
  );
});
