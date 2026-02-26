const assert = require('node:assert/strict');
const test = require('node:test');

const { io } = require('socket.io-client');

const { createServer } = require('../index');
const { decodeGridBase64 } = require('../lib/grid');

function waitForEvent(emitter, event, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      emitter.off(event, handler);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    function handler(payload) {
      clearTimeout(timer);
      resolve(payload);
    }

    emitter.once(event, handler);
  });
}

function createClient(port) {
  const socket = io(`http://localhost:${port}`, {
    autoConnect: false,
    transports: ['websocket'],
  });
  socket.connect();
  return socket;
}

function blockAlive(state, coords) {
  const grid = decodeGridBase64(state.grid, state.width * state.height);
  return coords.every(({ x, y }) => grid[y * state.width + x] === 1);
}

async function waitForCondition(socket, predicate, attempts = 6) {
  for (let i = 0; i < attempts; i += 1) {
    const state = await waitForEvent(socket, 'state');
    if (predicate(state)) {
      return state;
    }
  }
  throw new Error('Condition not met in allotted attempts');
}

test('broadcasts generations on a cadence', async (t) => {
  const server = createServer({ port: 0, width: 10, height: 10, tickMs: 40 });
  const port = await server.start();

  t.after(async () => {
    await server.stop();
  });

  const socket = createClient(port);
  t.after(() => socket.close());

  const first = await waitForEvent(socket, 'state');
  const second = await waitForEvent(socket, 'state');

  assert.ok(second.generation > first.generation);
});

test('applies client updates before broadcast', async (t) => {
  const server = createServer({ port: 0, width: 10, height: 10, tickMs: 40 });
  const port = await server.start();

  t.after(async () => {
    await server.stop();
  });

  const socket = createClient(port);
  t.after(() => socket.close());

  await waitForEvent(socket, 'state');

  const block = [
    { x: 1, y: 1 },
    { x: 1, y: 2 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
  ];

  for (const cell of block) {
    socket.emit('cell:update', { ...cell, alive: true });
  }

  const state = await waitForCondition(
    socket,
    (payload) => blockAlive(payload, block),
  );

  assert.ok(blockAlive(state, block));
});

test('broadcasts updates to multiple clients', async (t) => {
  const server = createServer({ port: 0, width: 10, height: 10, tickMs: 40 });
  const port = await server.start();

  t.after(async () => {
    await server.stop();
  });

  const sender = createClient(port);
  const listener = createClient(port);
  t.after(() => sender.close());
  t.after(() => listener.close());

  await waitForEvent(sender, 'state');
  await waitForEvent(listener, 'state');

  const block = [
    { x: 4, y: 4 },
    { x: 4, y: 5 },
    { x: 5, y: 4 },
    { x: 5, y: 5 },
  ];

  for (const cell of block) {
    sender.emit('cell:update', { ...cell, alive: true });
  }

  const state = await waitForCondition(
    listener,
    (payload) => blockAlive(payload, block),
  );

  assert.ok(blockAlive(state, block));
});
