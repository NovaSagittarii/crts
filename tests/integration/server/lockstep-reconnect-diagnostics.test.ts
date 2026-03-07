import { describe, expect } from 'vitest';
import type { LockstepCheckpointPayload, RoomJoinedPayload } from '#rts-engine';
import { waitForEvent } from './test-support.js';
import { createLockstepTest } from './lockstep-fixtures.js';

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

    const checkpointAfterReconnectPromise =
      waitForEvent<LockstepCheckpointPayload>(
        guest,
        'lockstep:checkpoint',
        4_000,
      );

    const rejoined = await waitForEvent<RoomJoinedPayload>(
      guest,
      'room:joined',
    );
    expect(rejoined.roomId).toBe(match.roomId);
    expect(rejoined.lockstep?.lastPrimaryHash).toMatch(/^[0-9a-f]{8}$/);
    expect(rejoined.lockstep?.mismatchCount).toBe(0);

    const replayedCheckpoint = await checkpointAfterReconnectPromise;
    expect(replayedCheckpoint.roomId).toBe(match.roomId);
    expect(replayedCheckpoint.hashHex).toBe(rejoined.lockstep?.lastPrimaryHash);
    expect(replayedCheckpoint.mode).toBe('shadow');
  }, 25_000);
});
