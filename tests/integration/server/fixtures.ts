import type { Socket } from 'socket.io-client';
import { test as base } from 'vitest';

import {
  createServer,
  type GameServer,
  type ServerOptions,
} from '../../../apps/server/src/server.js';

import { createClient, type TestClientOptions } from './test-support.js';

export type ConnectClient = (options?: TestClientOptions) => Socket;

export interface IntegrationHarness {
  readonly server: GameServer;
  readonly port: number;
  connectClient: ConnectClient;
  restartServer(options?: ServerOptions): Promise<void>;
}

interface IntegrationFixtures {
  integration: IntegrationHarness;
  connectClient: ConnectClient;
  restartServer: IntegrationHarness['restartServer'];
}

const DEFAULT_SERVER_OPTIONS: ServerOptions = {
  port: 0,
  width: 52,
  height: 52,
  tickMs: 40,
};

function closeTrackedSockets(trackedSockets: Socket[]): void {
  for (const socket of trackedSockets) {
    socket.close();
  }
  trackedSockets.length = 0;
}

export function createIntegrationTest(
  defaultServerOptions: ServerOptions = DEFAULT_SERVER_OPTIONS,
) {
  return base.extend<IntegrationFixtures>({
    // Vitest requires object destructuring for fixture contexts even with no deps.
    // eslint-disable-next-line no-empty-pattern
    integration: async ({}, use) => {
      const trackedSockets: Socket[] = [];
      let server = createServer(defaultServerOptions);
      let port = await server.start();

      const connectClient: ConnectClient = (options = {}) => {
        const socket = createClient(port, options);
        trackedSockets.push(socket);
        return socket;
      };

      const restartServer = async (
        options: ServerOptions = defaultServerOptions,
      ): Promise<void> => {
        closeTrackedSockets(trackedSockets);
        await server.stop();
        server = createServer(options);
        port = await server.start();
      };

      const integration: IntegrationHarness = {
        get server() {
          return server;
        },
        get port() {
          return port;
        },
        connectClient,
        restartServer,
      };

      try {
        await use(integration);
      } finally {
        closeTrackedSockets(trackedSockets);
        await server.stop();
      }
    },
    connectClient: async ({ integration }, use) => {
      await use(integration.connectClient);
    },
    restartServer: async ({ integration }, use) => {
      await use((options) => integration.restartServer(options));
    },
  });
}

export const integrationTest = createIntegrationTest();
