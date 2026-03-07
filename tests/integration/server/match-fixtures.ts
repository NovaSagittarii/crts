import type { ServerOptions } from '../../../apps/server/src/server.js';
import {
  type StartMatchOptions,
  startMatchAndWaitForActive,
} from './match-support.js';
import { type RoomFixtureOptions, createRoomTest } from './room-fixtures.js';
import { type ActiveMatchSetup } from './test-support.js';

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
