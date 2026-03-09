import type { Socket } from 'socket.io-client';
import { test as base } from 'vitest';

import {
  type GameServer,
  type ServerOptions,
  createServer,
} from '../../../apps/server/src/server.js';
import { createManualClock, flushAsyncWork } from './manual-clock.js';
import {
  type TestClientOptions,
  createClient,
  registerSocketAdvanceDriver,
} from './test-support.js';

export type ConnectClient = (options?: TestClientOptions) => Socket;

export interface IntegrationClock {
  readonly mode: 'manual' | 'real';
  readonly nowMs: number;
  readonly pendingTaskCount: number;
  advanceMs(ms: number): Promise<void>;
  advanceTicks(ticks: number): Promise<void>;
  flush(): Promise<void>;
}

export interface IntegrationHarness {
  readonly server: GameServer;
  readonly port: number;
  readonly clock: IntegrationClock;
  connectClient: ConnectClient;
  restartServer(options?: ServerOptions): Promise<void>;
}

interface IntegrationFixtures {
  integration: IntegrationHarness;
  clock: IntegrationClock;
  connectClient: ConnectClient;
  restartServer: IntegrationHarness['restartServer'];
}

export interface CreateIntegrationTestOptions {
  clockMode?: 'manual' | 'real';
  initialTimeMs?: number;
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

function getEffectiveTickMs(options: ServerOptions): number {
  return options.tickMs ?? 100;
}

export function createIntegrationTest(
  defaultServerOptions: ServerOptions = DEFAULT_SERVER_OPTIONS,
  options: CreateIntegrationTestOptions = {},
) {
  const clockMode = options.clockMode ?? 'real';

  return base.extend<IntegrationFixtures>({
    // Vitest requires object destructuring for fixture contexts even with no deps.
    // eslint-disable-next-line no-empty-pattern
    integration: async ({}, use) => {
      const trackedSockets: Socket[] = [];
      let currentServerOptions = defaultServerOptions;
      let manualClock = createManualClock(options.initialTimeMs);
      let advanceListeners = new Set<() => void>();

      const notifyAdvanceListeners = async (): Promise<void> => {
        if (advanceListeners.size === 0) {
          return;
        }

        for (const listener of advanceListeners) {
          listener();
        }
        await flushAsyncWork();
      };

      const clock: IntegrationClock = {
        get mode() {
          return clockMode;
        },
        get nowMs() {
          return clockMode === 'manual' ? manualClock.nowMs : Date.now();
        },
        get pendingTaskCount() {
          return clockMode === 'manual' ? manualClock.pendingTaskCount : 0;
        },
        async advanceMs(ms) {
          if (clockMode === 'manual') {
            await manualClock.advanceBy(ms);
            await notifyAdvanceListeners();
            return;
          }

          await new Promise<void>((resolve) => {
            setTimeout(resolve, ms);
          });
        },
        async advanceTicks(ticks) {
          await clock.advanceMs(
            ticks * getEffectiveTickMs(currentServerOptions),
          );
        },
        async flush() {
          if (clockMode === 'manual') {
            await manualClock.flush();
            await notifyAdvanceListeners();
            return;
          }

          await flushAsyncWork();
        },
      };

      const createServerWithHarness = (
        serverOptions: ServerOptions,
      ): GameServer => {
        currentServerOptions = serverOptions;
        if (clockMode !== 'manual') {
          return createServer(serverOptions);
        }

        manualClock = createManualClock(options.initialTimeMs);
        advanceListeners = new Set<() => void>();
        return createServer({
          ...serverOptions,
          now: manualClock.now,
          setInterval: manualClock.setInterval,
          clearInterval: manualClock.clearInterval,
          setTimeout: manualClock.setTimeout,
          clearTimeout: manualClock.clearTimeout,
        });
      };

      let server = createServerWithHarness(defaultServerOptions);
      let port = await server.start();

      const connectClient: ConnectClient = (options = {}) => {
        const socket = createClient(port, options);
        if (clockMode === 'manual') {
          registerSocketAdvanceDriver(socket, {
            subscribe(listener) {
              advanceListeners.add(listener);
              return () => {
                advanceListeners.delete(listener);
              };
            },
          });
        }
        trackedSockets.push(socket);
        return socket;
      };

      const restartServer = async (
        options: ServerOptions = defaultServerOptions,
      ): Promise<void> => {
        closeTrackedSockets(trackedSockets);
        await server.stop();
        server = createServerWithHarness(options);
        port = await server.start();
      };

      const integration: IntegrationHarness = {
        get server() {
          return server;
        },
        get port() {
          return port;
        },
        get clock() {
          return clock;
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
    clock: async ({ integration }, use) => {
      await use(integration.clock);
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
