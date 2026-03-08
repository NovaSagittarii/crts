import type { ServerOptions } from '../../../apps/server/src/server.js';
import type { IntegrationTestOptions } from './fixtures.js';
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
  integrationOptions: IntegrationTestOptions = {},
) {
  return createRoomTest(
    defaultServerOptions,
    defaultRoomOptions,
    integrationOptions,
  ).extend<MatchFixtures>({
    activeMatch: async ({ connectedRoom, runtime }, use) => {
      const activeMatch = await startMatchAndWaitForActive(connectedRoom, {
        ...defaultMatchOptions,
        runtime: defaultMatchOptions.runtime ?? runtime,
      });
      await use(activeMatch);
    },
  });
}
