import type { ServerOptions } from '../../../apps/server/src/server.js';
import { createIntegrationTest } from './fixtures.js';
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
) {
  return createIntegrationTest(defaultServerOptions).extend<RoomFixtures>({
    connectedRoom: async ({ connectClient }, use) => {
      const connectedRoom = await setupConnectedRoom({
        ...defaultRoomOptions,
        connectClient,
      });
      await use(connectedRoom);
    },
  });
}
