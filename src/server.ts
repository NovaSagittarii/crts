import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import express, { Express } from 'express';
import { Server as SocketIOServer, Socket } from 'socket.io';

import {
  applyUpdates,
  createGrid,
  encodeGridBase64,
  stepGrid,
  CellUpdate,
} from './grid.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_CLIENT_DIR = path.join(__dirname, '..', 'dist', 'client');
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

function getStaticDir(): string {
  return DIST_CLIENT_DIR;
}

export interface ServerOptions {
  port?: number;
  width?: number;
  height?: number;
  tickMs?: number;
}

export interface StatePayload {
  width: number;
  height: number;
  generation: number;
  grid: string;
}

export interface CellUpdatePayload {
  x: number;
  y: number;
  alive: boolean;
}

interface PendingUpdate extends CellUpdate {}

export interface GameServer {
  start(): Promise<number>;
  stop(): Promise<void>;
  getStatePayload(): StatePayload;
}

export function createServer(options: ServerOptions = {}): GameServer {
  const port = options.port ?? 3000;
  const width = options.width ?? 100;
  const height = options.height ?? 100;
  const tickMs = options.tickMs ?? 100;

  const app: Express = express();
  app.use(express.static(getStaticDir()));
  app.use(express.static(PUBLIC_DIR));

  const httpServer = http.createServer(app);
  const io = new SocketIOServer(httpServer);

  let grid = createGrid({ width, height });
  let generation = 0;
  let pendingUpdates: PendingUpdate[] = [];

  function drainUpdates(): PendingUpdate[] {
    const updates = pendingUpdates;
    pendingUpdates = [];
    return updates;
  }

  function getStatePayload(): StatePayload {
    return {
      width,
      height,
      generation,
      grid: encodeGridBase64(grid),
    };
  }

  function broadcastState(): void {
    io.emit('state', getStatePayload());
  }

  function handleCellUpdate(socket: Socket, payload: unknown): void {
    if (!payload || typeof payload !== 'object') return;

    const update = payload as CellUpdatePayload;
    const x = Number(update.x);
    const y = Number(update.y);

    if (!Number.isInteger(x) || !Number.isInteger(y)) return;
    if (x < 0 || y < 0 || x >= width || y >= height) return;

    pendingUpdates.push({ x, y, alive: update.alive ? 1 : 0 });
  }

  io.on('connection', (socket: Socket) => {
    socket.emit('state', getStatePayload());
    socket.on('cell:update', (payload) => handleCellUpdate(socket, payload));
  });

  let interval: NodeJS.Timeout | null = null;

  function tick(): void {
    const updates = drainUpdates();
    applyUpdates(grid, updates, width, height);
    grid = stepGrid(grid, width, height);
    generation += 1;
    broadcastState();
  }

  async function start(): Promise<number> {
    return new Promise((resolve) => {
      httpServer.listen(port, () => {
        interval = setInterval(tick, tickMs);
        const address = httpServer.address();
        const resolvedPort =
          typeof address === 'object' && address !== null ? address.port : port;
        resolve(resolvedPort);
      });
    });
  }

  async function stop(): Promise<void> {
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || 3000;
  const server = createServer({ port });
  server.start().then((resolvedPort) => {
    console.log(`Server listening on http://0.0.0.0:${resolvedPort}`);
  });
}
