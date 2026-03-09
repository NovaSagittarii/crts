import type { ServerOptions } from '../../../apps/server/src/server.js';
import type { CreateIntegrationTestOptions } from './fixtures.js';
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
  testOptions: CreateIntegrationTestOptions = {},
) {
  return createRoomTest(
    defaultServerOptions,
    defaultRoomOptions,
    testOptions,
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
