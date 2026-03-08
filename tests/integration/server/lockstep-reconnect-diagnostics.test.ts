import { describe, expect } from 'vitest';

import type { LockstepCheckpointPayload, RoomJoinedPayload } from '#rts-engine';

import { createLockstepTest } from './lockstep-fixtures.js';
import { waitForEvent, waitForEventWithPredicate } from './test-support.js';

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
    roomName: 'Lockstep Diagnostics Room',
    hostSessionId: 'diag-host',
    guestSessionId: 'diag-guest',
  },
);

describe('lockstep reconnect diagnostics', () => {
  test('rejoining receives latest checkpoint and hash diagnostics', async ({
    connectedRoom,
    startLockstepMatch,
    connectClient,
  }) => {
    const match = await startLockstepMatch(connectedRoom);
    const host = match.host;
    let guest = match.guest;

    await waitForEvent<LockstepCheckpointPayload>(
      host,
      'lockstep:checkpoint',
      4_000,
    );

    guest.close();
    guest = connectClient({ sessionId: 'diag-guest' });

    const rejoined = await waitForEvent<RoomJoinedPayload>(
      guest,
      'room:joined',
    );
    expect(rejoined.roomId).toBe(match.roomId);
    expect(rejoined.lockstep?.lastPrimaryHash).toMatch(/^[0-9a-f]{8}$/);
    expect(rejoined.lockstep?.mismatchCount).toBe(0);

    const expectedHash = rejoined.lockstep?.lastPrimaryHash;
    expect(expectedHash).toBeDefined();

    const replayedCheckpoint =
      await waitForEventWithPredicate<LockstepCheckpointPayload>(
        guest,
        'lockstep:checkpoint',
        (payload) =>
          payload.roomId === match.roomId && payload.hashHex === expectedHash,
        {
          attempts: 200,
          overallTimeoutMs: 4_000,
          timeoutMessage: 'Timed out waiting for replayed lockstep checkpoint',
        },
      );
    expect(replayedCheckpoint.roomId).toBe(match.roomId);
    expect(replayedCheckpoint.hashHex).toBe(expectedHash);
    expect(replayedCheckpoint.mode).toBe('shadow');
  }, 25_000);
});
