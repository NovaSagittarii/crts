import { beforeEach, afterEach, describe, expect, test } from 'vitest';
import { io, type Socket } from 'socket.io-client';

import { createServer } from '../../../apps/server/src/server.js';
import { decodeGridBase64 } from '../../../packages/conway-core/src/grid.js';

interface StatePayload {
  roomId?: string;
  width: number;
  height: number;
  generation: number;
  tick?: number;
  grid: string;
  teams?: TeamPayload[];
}

interface TeamPayload {
  id: number;
  resources: number;
  income: number;
  defeated: boolean;
  baseTopLeft: Cell;
}

interface TemplateSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  activationCost: number;
  income: number;
  buildArea: number;
}

interface RoomJoinedPayload {
  roomId: string;
  roomName: string;
  teamId: number | null;
  templates: TemplateSummary[];
  state: StatePayload;
}

interface SlotClaimedPayload {
  roomId: string;
  slotId: string;
  teamId: number | null;
}

interface RoomListEntry {
  roomId: string;
  name: string;
  width: number;
  height: number;
  players: number;
  teams: number;
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

function getTeam(state: StatePayload, teamId: number): TeamPayload {
  const team = state.teams?.find(({ id }) => id === teamId);
  if (!team) {
    throw new Error(`Unable to find team ${teamId}`);
  }
  return team;
}

function findIsolatedBlock(state: StatePayload): Cell[] {
  const grid = decodeGridBase64(state.grid, state.width * state.height);

  for (let y = 1; y < state.height - 2; y += 1) {
    for (let x = 1; x < state.width - 2; x += 1) {
      let isolated = true;
      for (let dy = -1; dy <= 2; dy += 1) {
        for (let dx = -1; dx <= 2; dx += 1) {
          const gx = x + dx;
          const gy = y + dy;
          if (grid[gy * state.width + gx] === 1) {
            isolated = false;
          }
        }
      }

      if (isolated) {
        return [
          { x, y },
          { x: x + 1, y },
          { x, y: y + 1 },
          { x: x + 1, y: y + 1 },
        ];
      }
    }
  }

  throw new Error('Unable to locate an isolated 2x2 block area');
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

async function claimSlot(
  socket: Socket,
  slotId: string,
): Promise<SlotClaimedPayload> {
  socket.emit('room:claim-slot', { slotId });
  const claimed = (await waitForEvent(
    socket,
    'room:slot-claimed',
  )) as SlotClaimedPayload;
  if (claimed.teamId === null) {
    throw new Error(`Expected slot claim for ${slotId} to assign a team`);
  }
  return claimed;
}

async function waitForRoomList(
  socket: Socket,
  predicate: (rooms: RoomListEntry[]) => boolean,
  attempts = 6,
): Promise<RoomListEntry[]> {
  for (let i = 0; i < attempts; i += 1) {
    const rooms = (await waitForEvent(socket, 'room:list')) as RoomListEntry[];
    if (predicate(rooms)) return rooms;
  }
  throw new Error('Room list condition not met in allotted attempts');
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
    await claimSlot(socket, 'team-1');
    const setupState = (await waitForEvent(socket, 'state')) as StatePayload;

    const block = findIsolatedBlock(setupState);

    for (const cell of block) {
      socket.emit('cell:update', { ...cell, alive: true });
    }

    const state = await waitForCondition(
      socket,
      (payload) => blockAlive(payload, block),
      12,
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
    await claimSlot(sender, 'team-1');
    const setupState = (await waitForEvent(sender, 'state')) as StatePayload;

    const block = findIsolatedBlock(setupState);

    for (const cell of block) {
      sender.emit('cell:update', { ...cell, alive: true });
    }

    const state = await waitForCondition(
      listener,
      (payload) => blockAlive(payload, block),
      12,
    );

    expect(blockAlive(state, block)).toBe(true);

    sender.close();
    listener.close();
    await server.stop();
  });

  test('queues template builds and charges resources', async () => {
    const server = createServer({ port: 0, width: 40, height: 40, tickMs: 40 });
    const port = await server.start();

    const socket = createClient(port);
    const joined = (await waitForEvent(
      socket,
      'room:joined',
    )) as RoomJoinedPayload;
    const claimed = await claimSlot(socket, 'team-1');
    const teamId = claimed.teamId as number;
    const teamReadyState = await waitForCondition(
      socket,
      (state) => (state.teams ?? []).some(({ id }) => id === teamId),
      12,
    );
    const initialTeam = getTeam(teamReadyState, teamId);
    const blockTemplate = joined.templates.find(({ id }) => id === 'block');
    if (!blockTemplate) {
      throw new Error('Expected block template to be available');
    }

    const buildX = Math.min(
      joined.state.width - blockTemplate.width,
      initialTeam.baseTopLeft.x + 4,
    );
    const buildY = Math.min(
      joined.state.height - blockTemplate.height,
      initialTeam.baseTopLeft.y + 4,
    );

    const blockCells: Cell[] = [
      { x: buildX, y: buildY },
      { x: buildX + 1, y: buildY },
      { x: buildX, y: buildY + 1 },
      { x: buildX + 1, y: buildY + 1 },
    ];

    socket.emit('build:queue', {
      templateId: blockTemplate.id,
      x: buildX,
      y: buildY,
      delayTicks: 1,
    });

    const builtState = await waitForCondition(
      socket,
      (state) =>
        blockAlive(state, blockCells) &&
        getTeam(state, teamId).resources < initialTeam.resources,
      12,
    );

    expect(blockAlive(builtState, blockCells)).toBe(true);
    expect(getTeam(builtState, teamId).resources).toBeLessThan(
      initialTeam.resources,
    );

    socket.close();
    await server.stop();
  });

  test('marks team defeated when base integrity is breached', async () => {
    const server = createServer({ port: 0, width: 30, height: 30, tickMs: 40 });
    const port = await server.start();

    const socket = createClient(port);
    await waitForEvent(socket, 'room:joined');
    const claimed = await claimSlot(socket, 'team-1');
    const teamId = claimed.teamId as number;
    const teamReadyState = await waitForCondition(
      socket,
      (state) => (state.teams ?? []).some(({ id }) => id === teamId),
      12,
    );
    const team = getTeam(teamReadyState, teamId);

    const baseCells: Cell[] = [
      { x: team.baseTopLeft.x, y: team.baseTopLeft.y },
      { x: team.baseTopLeft.x + 1, y: team.baseTopLeft.y },
      { x: team.baseTopLeft.x, y: team.baseTopLeft.y + 1 },
      { x: team.baseTopLeft.x + 1, y: team.baseTopLeft.y + 1 },
    ];

    for (const cell of baseCells) {
      socket.emit('cell:update', { ...cell, alive: false });
    }

    const defeatedState = await waitForCondition(
      socket,
      (state) => getTeam(state, teamId).defeated,
      12,
    );

    expect(getTeam(defeatedState, teamId).defeated).toBe(true);

    socket.close();
    await server.stop();
  });

  test('creates and joins a custom room', async () => {
    const server = createServer({ port: 0, width: 30, height: 30, tickMs: 40 });
    const port = await server.start();

    const socket = createClient(port);
    await waitForEvent(socket, 'room:joined');

    socket.emit('room:create', {
      name: 'Skirmish',
      width: 48,
      height: 48,
    });

    const joined = (await waitForEvent(
      socket,
      'room:joined',
    )) as RoomJoinedPayload;
    expect(joined.roomName).toBe('Skirmish');
    expect(joined.state.width).toBe(48);
    expect(joined.state.height).toBe(48);

    socket.emit('room:list');
    const rooms = await waitForRoomList(
      socket,
      (entries) => entries.some(({ roomId }) => roomId === joined.roomId),
      8,
    );
    expect(rooms.some(({ roomId }) => roomId === joined.roomId)).toBe(true);

    socket.close();
    await server.stop();
  });

  test('supports joining and leaving rooms from another client', async () => {
    const server = createServer({ port: 0, width: 40, height: 40, tickMs: 40 });
    const port = await server.start();

    const owner = createClient(port);
    await waitForEvent(owner, 'room:joined');

    owner.emit('room:create', {
      name: 'Party Room',
      width: 40,
      height: 40,
    });
    const ownerRoom = (await waitForEvent(
      owner,
      'room:joined',
    )) as RoomJoinedPayload;
    await claimSlot(owner, 'team-1');

    const guest = createClient(port);
    await waitForEvent(guest, 'room:joined');
    guest.emit('room:join', { roomId: ownerRoom.roomId });

    const guestRoom = (await waitForEvent(
      guest,
      'room:joined',
    )) as RoomJoinedPayload;
    expect(guestRoom.roomId).toBe(ownerRoom.roomId);
    await claimSlot(guest, 'team-2');

    const withTwoTeams = await waitForCondition(
      owner,
      (state) =>
        state.roomId === ownerRoom.roomId && (state.teams?.length ?? 0) >= 2,
      12,
    );
    expect(withTwoTeams.teams?.length).toBeGreaterThanOrEqual(2);

    guest.emit('room:leave');
    const leftPayload = (await waitForEvent(guest, 'room:left')) as {
      roomId: string;
    };
    expect(leftPayload.roomId).toBe(ownerRoom.roomId);

    const backToOneTeam = await waitForCondition(
      owner,
      (state) =>
        state.roomId === ownerRoom.roomId && (state.teams?.length ?? 0) === 1,
      12,
    );
    expect(backToOneTeam.teams).toHaveLength(1);

    owner.close();
    guest.close();
    await server.stop();
  });
});
