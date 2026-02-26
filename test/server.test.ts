import { beforeEach, afterEach, describe, expect, test } from 'vitest';
import { io, type Socket } from 'socket.io-client';

import { createServer } from '../src/server.js';
import { decodeGridBase64 } from '../src/grid.js';

interface StatePayload {
  width: number;
  height: number;
  generation: number;
  grid: string;
}

interface Cell {
  x: number;
  y: number;
}

function waitForEvent(
  emitter: Socket,
  event: string,
  timeoutMs = 1000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    function handler(payload: unknown) {
      clearTimeout(timer);
      resolve(payload);
    }

    emitter.once(event, handler);
  });
}

function createClient(port: number): Socket {
  const socket = io(`http://localhost:${port}`, {
    autoConnect: false,
    transports: ['websocket'],
  });
  socket.connect();
  return socket;
}

function blockAlive(state: StatePayload, coords: Cell[]): boolean {
  const grid = decodeGridBase64(state.grid, state.width * state.height);
  return coords.every(({ x, y }) => grid[y * state.width + x] === 1);
}

async function waitForCondition(
  socket: Socket,
  predicate: (state: StatePayload) => boolean,
  attempts = 6,
): Promise<StatePayload> {
  for (let i = 0; i < attempts; i += 1) {
    const state = (await waitForEvent(socket, 'state')) as StatePayload;
    if (predicate(state)) return state;
  }
  throw new Error('Condition not met in allotted attempts');
}

describe('GameServer', () => {
  test('broadcasts generations on a cadence', async () => {
    const server = createServer({ port: 0, width: 10, height: 10, tickMs: 40 });
    const port = await server.start();

    const socket = createClient(port);

    const first = (await waitForEvent(socket, 'state')) as StatePayload;
    const second = (await waitForEvent(socket, 'state')) as StatePayload;

    expect(second.generation).toBeGreaterThan(first.generation);

    socket.close();
    await server.stop();
  });

  test('applies client updates before broadcast', async () => {
    const server = createServer({ port: 0, width: 10, height: 10, tickMs: 40 });
    const port = await server.start();

    const socket = createClient(port);

    await waitForEvent(socket, 'state');

    const block: Cell[] = [
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ];

    for (const cell of block) {
      socket.emit('cell:update', { ...cell, alive: true });
    }

    const state = await waitForCondition(socket, (payload) =>
      blockAlive(payload, block),
    );

    expect(blockAlive(state, block)).toBe(true);

    socket.close();
    await server.stop();
  });

  test('broadcasts updates to multiple clients', async () => {
    const server = createServer({ port: 0, width: 10, height: 10, tickMs: 40 });
    const port = await server.start();

    const sender = createClient(port);
    const listener = createClient(port);

    await waitForEvent(sender, 'state');
    await waitForEvent(listener, 'state');

    const block: Cell[] = [
      { x: 4, y: 4 },
      { x: 4, y: 5 },
      { x: 5, y: 4 },
      { x: 5, y: 5 },
    ];

    for (const cell of block) {
      sender.emit('cell:update', { ...cell, alive: true });
    }

    const state = await waitForCondition(listener, (payload) =>
      blockAlive(payload, block),
    );

    expect(blockAlive(state, block)).toBe(true);

    sender.close();
    listener.close();
    await server.stop();
  });
});
