import type { ServerOptions } from '../../../apps/server/src/server.js';

import {
  startMatchAndWaitForActive,
  type ConnectedRoomSetup,
  type StartMatchOptions,
} from './match-support.js';
import type { ActiveMatchSetup } from './test-support.js';
import { createRoomTest, type RoomFixtureOptions } from './room-fixtures.js';

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
) {
  return createRoomTest(
    {
      countdownSeconds: 0,
      ...defaultServerOptions,
    },
    defaultRoomOptions,
  ).extend<LockstepFixtures>({
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
