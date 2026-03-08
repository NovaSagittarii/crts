import type { Socket } from 'socket.io-client';
import { test as base } from 'vitest';

import {
  type GameServer,
  type ServerOptions,
  createServer,
} from '../../../apps/server/src/server.js';
import { type ManualRuntime, createManualRuntime } from './runtime.js';
import { type TestClientOptions, createClient } from './test-support.js';

export type ConnectClient = (options?: TestClientOptions) => Socket;

export interface IntegrationRuntime {
  now(): number;
  settle(): Promise<void>;
  advanceMs(ms: number): Promise<void>;
  runDueTimers(): Promise<void>;
  advanceTicks(count: number): Promise<void>;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(timer: unknown): void;
  setInterval(callback: () => void, delayMs: number): unknown;
  clearInterval(timer: unknown): void;
}

export interface IntegrationHarness {
  readonly server: GameServer;
  readonly port: number;
  readonly runtime: IntegrationRuntime | null;
  connectClient: ConnectClient;
  restartServer(options?: ServerOptions): Promise<void>;
}

interface IntegrationFixtures {
  integration: IntegrationHarness;
  connectClient: ConnectClient;
  runtime: IntegrationRuntime | null;
  restartServer: IntegrationHarness['restartServer'];
}

export interface IntegrationTestOptions {
  runtimeMode?: 'real-time' | 'manual';
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
  options: IntegrationTestOptions = {},
) {
  const runtimeMode = options.runtimeMode ?? 'real-time';

  return base.extend<IntegrationFixtures>({
    // Vitest requires object destructuring for fixture contexts even with no deps.
    // eslint-disable-next-line no-empty-pattern
    integration: async ({}, use) => {
      const trackedSockets: Socket[] = [];

      let activeRuntime: IntegrationRuntime | null = null;

      function createServerHarness(serverOptions: ServerOptions): {
        server: GameServer;
        runtime: IntegrationRuntime | null;
        clientRuntime: ManualRuntime | undefined;
      } {
        if (runtimeMode !== 'manual') {
          return {
            server: createServer(serverOptions),
            runtime: null,
            clientRuntime: undefined,
          };
        }

        const manualRuntime = createManualRuntime();
        const mergedOptions: ServerOptions = {
          ...serverOptions,
          now: serverOptions.now ?? (() => manualRuntime.now()),
          setInterval:
            serverOptions.setInterval ??
            ((callback, delayMs) =>
              manualRuntime.setInterval(callback, delayMs)),
          clearInterval:
            serverOptions.clearInterval ??
            ((timer) => manualRuntime.clearInterval(timer)),
          setTimeout:
            serverOptions.setTimeout ??
            ((callback, delayMs) =>
              manualRuntime.setTimeout(callback, delayMs)),
          clearTimeout:
            serverOptions.clearTimeout ??
            ((timer) => manualRuntime.clearTimeout(timer)),
        };
        const tickMs =
          mergedOptions.tickMs ?? DEFAULT_SERVER_OPTIONS.tickMs ?? 100;
        const autoTick = mergedOptions.autoTick ?? true;
        const server = createServer(mergedOptions);

        const runtime: IntegrationRuntime = {
          now: () => manualRuntime.now(),
          settle: () => manualRuntime.settle(),
          advanceMs: (ms) => manualRuntime.advanceMs(ms),
          runDueTimers: () => manualRuntime.runDueTimers(),
          setTimeout: (callback, delayMs) =>
            manualRuntime.setTimeout(callback, delayMs),
          clearTimeout: (timer) => manualRuntime.clearTimeout(timer),
          setInterval: (callback, delayMs) =>
            manualRuntime.setInterval(callback, delayMs),
          clearInterval: (timer) => manualRuntime.clearInterval(timer),
          async advanceTicks(count: number): Promise<void> {
            const normalizedCount = Math.max(0, Math.floor(count));
            if (normalizedCount === 0) {
              await manualRuntime.settle();
              return;
            }

            if (autoTick) {
              await manualRuntime.advanceMs(normalizedCount * tickMs);
              return;
            }

            for (let index = 0; index < normalizedCount; index += 1) {
              server.tickOnce();
              await manualRuntime.settle();
            }
          },
        };

        return {
          server,
          runtime,
          clientRuntime: manualRuntime,
        };
      }

      let { server, runtime, clientRuntime } =
        createServerHarness(defaultServerOptions);
      activeRuntime = runtime;
      let port = await server.start();

      const connectClient: ConnectClient = (options = {}) => {
        const socket = createClient(port, {
          ...options,
          runtime: clientRuntime,
        });
        trackedSockets.push(socket);
        return socket;
      };

      const restartServer = async (
        options: ServerOptions = defaultServerOptions,
      ): Promise<void> => {
        closeTrackedSockets(trackedSockets);
        await server.stop();
        const nextHarness = createServerHarness(options);
        server = nextHarness.server;
        activeRuntime = nextHarness.runtime;
        clientRuntime = nextHarness.clientRuntime;
        port = await server.start();
      };

      const integration: IntegrationHarness = {
        get server() {
          return server;
        },
        get port() {
          return port;
        },
        get runtime() {
          return activeRuntime;
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
    runtime: async ({ integration }, use) => {
      await use(integration.runtime);
    },
    restartServer: async ({ integration }, use) => {
      await use((options) => integration.restartServer(options));
    },
  });
}

export const integrationTest = createIntegrationTest();
