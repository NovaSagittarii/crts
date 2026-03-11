import { describe, expect } from 'vitest';

import { createIntegrationTest } from './fixtures.js';
import { setupActiveMatch } from './match-support.js';

const test = createIntegrationTest(
  { port: 0, width: 52, height: 52, tickMs: 40 },
  { clockMode: 'manual' },
);

describe('manual countdown harness', () => {
  test('starts a match by advancing the injected clock', async ({
    clock,
    connectClient,
  }) => {
    const activeMatch = await setupActiveMatch({
      clock,
      connectClient,
      roomName: 'Manual Countdown Room',
      membershipAttempts: 200,
      stateAttempts: 100,
      startMode: 'manual-clock',
      waitForActiveMembership: true,
    });

    expect(clock.mode).toBe('manual');
    expect(clock.nowMs).toBe(3_100);
    expect(activeMatch.roomId).toBeTruthy();
    expect(activeMatch.hostTeam.id).not.toBe(activeMatch.guestTeam.id);
  }, 15_000);
});
