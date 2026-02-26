const http = require('node:http');
const path = require('node:path');

const express = require('express');
const { Server } = require('socket.io');

const {
  applyUpdates,
  createGrid,
  encodeGridBase64,
  stepGrid,
} = require('./lib/grid');

const DEFAULT_WIDTH = 100;
const DEFAULT_HEIGHT = 100;
const DEFAULT_TICK_MS = 100;

function createServer(options = {}) {
  const port = options.port ?? 3000;
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;

  const app = express();
  app.use(express.static(path.join(__dirname, 'public')));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer);

  let grid = createGrid(width, height);
  let generation = 0;
  let pendingUpdates = [];

  function drainUpdates() {
    const updates = pendingUpdates;
    pendingUpdates = [];
    return updates;
  }

  function getStatePayload() {
    return {
      width,
      height,
      generation,
      grid: encodeGridBase64(grid),
    };
  }

  function broadcastState() {
    io.emit('state', getStatePayload());
  }

  io.on('connection', (socket) => {
    socket.emit('state', getStatePayload());

    socket.on('cell:update', (payload) => {
      if (!payload) {
        return;
      }

      const x = Number(payload.x);
      const y = Number(payload.y);
      if (!Number.isInteger(x) || !Number.isInteger(y)) {
        return;
      }

      if (x < 0 || y < 0 || x >= width || y >= height) {
        return;
      }

      pendingUpdates.push({ x, y, alive: payload.alive ? 1 : 0 });
    });
  });

  let interval = null;

  function tick() {
    const updates = drainUpdates();
    applyUpdates(grid, updates, width, height);
    grid = stepGrid(grid, width, height);
    generation += 1;
    broadcastState();
  }

  function start() {
    return new Promise((resolve) => {
      httpServer.listen(port, () => {
        interval = setInterval(tick, tickMs);
        const address = httpServer.address();
        resolve(typeof address === 'object' && address ? address.port : port);
      });
    });
  }

  function stop() {
    if (interval) {
      clearInterval(interval);
      interval = null;
    }

    return new Promise((resolve) => {
      io.close();
      httpServer.close(() => resolve());
    });
  }

  return {
    getStatePayload,
    start,
    stop,
  };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const server = createServer({ port });
  server.start().then((resolvedPort) => {
    console.log(`Server listening on http://0.0.0.0:${resolvedPort}`);
  });
}

module.exports = { createServer };
