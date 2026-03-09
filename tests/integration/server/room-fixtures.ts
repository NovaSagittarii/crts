import type { ServerOptions } from '../../../apps/server/src/server.js';
import {
  type CreateIntegrationTestOptions,
  createIntegrationTest,
} from './fixtures.js';
import {
  type ConnectedRoomSetup,
  type SetupConnectedRoomOptions,
  setupConnectedRoom,
} from './match-support.js';

export type RoomFixtureOptions = Omit<
  SetupConnectedRoomOptions,
  'clock' | 'connectClient'
>;

interface RoomFixtures {
  connectedRoom: ConnectedRoomSetup;
}

export function createRoomTest(
  defaultServerOptions: ServerOptions,
  defaultRoomOptions: RoomFixtureOptions,
  testOptions: CreateIntegrationTestOptions = {},
) {
  return createIntegrationTest(
    defaultServerOptions,
    testOptions,
  ).extend<RoomFixtures>({
    connectedRoom: async ({ connectClient, integration }, use) => {
      const connectedRoom = await setupConnectedRoom({
        ...defaultRoomOptions,
        clock: integration.clock,
        connectClient,
      });
      await use(connectedRoom);
    },
  });
}
