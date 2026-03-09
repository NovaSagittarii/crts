import type { ServerOptions } from '../../../apps/server/src/server.js';
import type { CreateIntegrationTestOptions } from './fixtures.js';
import {
  type ConnectedRoomSetup,
  type StartMatchOptions,
  startMatchAndWaitForActive,
} from './match-support.js';
import { type RoomFixtureOptions, createRoomTest } from './room-fixtures.js';
import type { ActiveMatchSetup } from './test-support.js';

export type StartLockstepMatch = (
  connectedRoom: ConnectedRoomSetup,
  options?: StartMatchOptions,
) => Promise<ActiveMatchSetup>;

interface LockstepFixtures {
  startLockstepMatch: StartLockstepMatch;
}

export function createLockstepTest(
  defaultServerOptions: ServerOptions,
  defaultRoomOptions: RoomFixtureOptions,
  defaultMatchOptions: StartMatchOptions = {},
  testOptions: CreateIntegrationTestOptions = {},
) {
  return createRoomTest(
    {
      countdownSeconds: 0,
      ...defaultServerOptions,
    },
    defaultRoomOptions,
    testOptions,
  ).extend<LockstepFixtures>({
    // Vitest requires object destructuring for fixture contexts even with no deps.
    // eslint-disable-next-line no-empty-pattern
    startLockstepMatch: async ({}, use) => {
      await use(
        async (
          connectedRoom: ConnectedRoomSetup,
          options: StartMatchOptions = {},
        ) =>
          startMatchAndWaitForActive(connectedRoom, {
            waitForActiveMembership: true,
            ...defaultMatchOptions,
            ...options,
          }),
      );
    },
  });
}
