#!/usr/bin/env tsx
/**
 * CLI entry point for the live bot process.
 *
 * Connects a trained PPO model (or random fallback) to a live game server
 * via Socket.IO and plays matches autonomously.
 *
 * Usage: tsx bin/play-bot.ts --room <roomId|roomCode> [options]
 */
import { parseArgs } from 'node:util';
import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';

import { LiveBotStrategy, TickBudgetTracker, loadBotModel } from '#bot-harness';
import type { FallbackStrategy } from '#bot-harness';
import type {
  BuildQueueRejectedPayload,
  ClientToServerEvents,
  MatchFinishedPayload,
  RoomJoinedPayload,
  RoomMembershipPayload,
  RoomSlotClaimedPayload,
  RoomStatePayload,
  ServerToClientEvents,
} from '#rts-engine';

const DEFAULT_MAX_TICKS = 2000;

const { values } = parseArgs({
  options: {
    server: { type: 'string', default: 'http://localhost:3000' },
    room: { type: 'string' },
    slot: { type: 'string', default: 'team-2' },
    model: { type: 'string' },
    'runs-dir': { type: 'string', default: 'runs' },
    fallback: { type: 'string', default: 'noop' },
    'budget-ms': { type: 'string', default: '80' },
    'single-match': { type: 'boolean', default: false },
    verbose: { type: 'boolean', default: false },
    name: { type: 'string', default: 'Bot (PPO)' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`Usage: tsx bin/play-bot.ts --room <id|code> [options]

Options:
  --server <url>       Server URL (default: http://localhost:3000)
  --room <id|code>     Room ID or room code (required)
  --slot <id>          Target slot (default: team-2)
  --model <path>       Explicit model directory path
  --runs-dir <dir>     Auto-detect dir (default: runs)
  --fallback <type>    Budget fallback: noop|cached|deadline (default: noop)
  --budget-ms <ms>     Tick budget in ms (default: 80)
  --single-match       Disconnect after one match
  --verbose            Log tick budget metrics
  --name <name>        Bot display name (default: Bot (PPO))
  --help, -h           Show this help message`);
  process.exit(0);
}

if (!values.room) {
  console.error('Error: --room is required');
  process.exit(1);
}

const serverUrl = values.server;
const roomArg = values.room;
const slotId = values.slot;
const modelPath = values.model;
const runsDir = values['runs-dir'];
const fallback = values.fallback as FallbackStrategy;
const budgetMs = parseInt(values['budget-ms'], 10);
const singleMatch = values['single-match'];
const verbose = values.verbose;
const botName = values.name;

async function main(): Promise<void> {
  // Load model (or fall back to random)
  const model = await loadBotModel({
    modelPath,
    runsDir,
  }).catch(() => null);

  if (!model) {
    console.error('No trained model found, using random actions');
  }

  const budgetTracker = new TickBudgetTracker({ budgetMs, fallback });

  // Connect to server
  const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
    serverUrl,
    {
      transports: ['websocket'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
    },
  );

  // State tracking
  let roomStatus: string = 'lobby';
  let teamId: number | null = null;
  let gridWidth = 52;
  let gridHeight = 52;
  let strategy: LiveBotStrategy | null = null;
  let inferring = false;

  socket.on('connect', () => {
    console.error(`Connected to server at ${serverUrl}`);

    // Join room -- try roomId first, then roomCode
    const isNumericOrCode = /^[A-Z0-9]{4,}$/i.test(roomArg);
    if (isNumericOrCode) {
      socket.emit('room:join', { roomCode: roomArg });
    } else {
      socket.emit('room:join', { roomId: roomArg });
    }

    // Set display name
    socket.emit('player:set-name', { name: botName });
  });

  socket.on('room:joined', (payload: RoomJoinedPayload) => {
    console.error(`Joined room ${payload.roomId} (code: ${payload.roomCode})`);
    teamId = payload.teamId;
    gridWidth = payload.state.width;
    gridHeight = payload.state.height;
    strategy = new LiveBotStrategy(model, gridWidth, gridHeight);

    // Claim the target slot
    socket.emit('room:claim-slot', { slotId });
  });

  socket.on('room:slot-claimed', (payload: RoomSlotClaimedPayload) => {
    teamId = payload.teamId;
    console.error(`Slot claimed, teamId: ${String(teamId)}`);

    // Mark ready
    socket.emit('room:set-ready', { ready: true });
  });

  socket.on('room:membership', (payload: RoomMembershipPayload) => {
    roomStatus = payload.status;
  });

  socket.on('room:match-started', () => {
    roomStatus = 'active';
    if (strategy && model) {
      strategy.warmUp();
    }
    console.error(`Match started, team ${String(teamId)}`);
  });

  socket.on('state', (payload: RoomStatePayload) => {
    // Guard: teamId must be resolved before inference
    if (teamId === null) {
      if (verbose) {
        console.error('Received state but teamId is null, skipping');
      }
      return;
    }

    // Only act during active match and when not already inferring
    if (roomStatus !== 'active' || inferring || !strategy) {
      return;
    }

    inferring = true;

    budgetTracker.startTick();
    const actionIndex = strategy.infer(payload, teamId, DEFAULT_MAX_TICKS);
    const metrics = budgetTracker.endTick();

    if (verbose) {
      console.error(budgetTracker.formatMetricsLog(metrics, payload.tick));
    }

    if (budgetTracker.shouldAct(metrics)) {
      const buildPayload = strategy.decode(actionIndex);
      if (buildPayload) {
        socket.emit('build:queue', buildPayload);
      }
    } else if (fallback === 'cached') {
      const lastAction = strategy.getLastAction();
      if (lastAction !== null && lastAction !== 0) {
        const buildPayload = strategy.decode(lastAction);
        if (buildPayload) {
          socket.emit('build:queue', buildPayload);
        }
      }
    }

    inferring = false;
  });

  socket.on('build:queue-rejected', (payload: BuildQueueRejectedPayload) => {
    if (verbose) {
      console.error(`Build rejected: ${payload.reason}`);
    }
  });

  socket.on('room:match-finished', (payload: MatchFinishedPayload) => {
    console.error(
      `Match finished. Winner: team ${String(payload.winner.teamId)}`,
    );

    const stats = budgetTracker.getStats();
    console.error(
      `Tick budget stats: ${String(stats.totalTicks)} ticks, ` +
        `avg ${stats.avgInferenceMs.toFixed(1)}ms, ` +
        `max ${stats.maxInferenceMs.toFixed(1)}ms, ` +
        `fallbacks ${String(stats.fallbackCount)}`,
    );

    if (singleMatch) {
      console.error('Single match mode, disconnecting');
      socket.disconnect();
      process.exit(0);
    }

    roomStatus = 'finished';
  });

  socket.on('disconnect', () => {
    console.error('Disconnected, reconnecting...');
  });

  socket.on('connect_error', (error: Error) => {
    console.error(`Connection error: ${error.message}`);
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    socket.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    socket.disconnect();
    process.exit(0);
  });
}

void main();
