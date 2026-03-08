import type { ServerOptions } from '../../../apps/server/src/server.js';
import {
  type IntegrationTestOptions,
  createIntegrationTest,
} from './fixtures.js';
import {
  type ConnectedRoomSetup,
  type SetupConnectedRoomOptions,
  setupConnectedRoom,
} from './match-support.js';

export type RoomFixtureOptions = Omit<
  SetupConnectedRoomOptions,
  'connectClient'
>;

interface RoomFixtures {
  connectedRoom: ConnectedRoomSetup;
}

export function createRoomTest(
  defaultServerOptions: ServerOptions,
  defaultRoomOptions: RoomFixtureOptions,
  integrationOptions: IntegrationTestOptions = {},
) {
  return createIntegrationTest(
    defaultServerOptions,
    integrationOptions,
  ).extend<RoomFixtures>({
    connectedRoom: async ({ connectClient }, use) => {
      const connectedRoom = await setupConnectedRoom({
        ...defaultRoomOptions,
        connectClient,
      });
      await use(connectedRoom);
    },
  });
}
