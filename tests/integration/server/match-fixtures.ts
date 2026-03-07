import type { ServerOptions } from '../../../apps/server/src/server.js';

import {
  startMatchAndWaitForActive,
  type StartMatchOptions,
} from './match-support.js';
import { type ActiveMatchSetup } from './test-support.js';
import { createRoomTest, type RoomFixtureOptions } from './room-fixtures.js';

interface MatchFixtures {
  activeMatch: ActiveMatchSetup;
}

export function createMatchTest(
  defaultServerOptions: ServerOptions,
  defaultRoomOptions: RoomFixtureOptions,
  defaultMatchOptions: StartMatchOptions = {},
) {
  return createRoomTest(
    defaultServerOptions,
    defaultRoomOptions,
  ).extend<MatchFixtures>({
    activeMatch: async ({ connectedRoom }, use) => {
      const activeMatch = await startMatchAndWaitForActive(
        connectedRoom,
        defaultMatchOptions,
      );
      await use(activeMatch);
    },
  });
}
