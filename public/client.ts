import { io } from 'socket.io-client';

interface StatePayload {
  roomId: string;
  roomName: string;
  width: number;
  height: number;
  generation: number;
  tick: number;
  grid: string;
  teams: TeamPayload[];
}

interface Cell {
  x: number;
  y: number;
}

interface TeamPayload {
  id: number;
  name: string;
  resources: number;
  income: number;
  defeated: boolean;
  baseTopLeft: Cell;
  baseIntact: boolean;
}

interface RoomListEntry {
  roomId: string;
  name: string;
  width: number;
  height: number;
  players: number;
  teams: number;
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
  playerId: string;
  playerName: string;
  teamId: number;
  templates: TemplateSummary[];
  state: StatePayload;
}

interface BuildQueuedPayload {
  eventId: number;
  executeTick: number;
}

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id}`);
  }
  return el as T;
}

const canvas = getRequiredElement<HTMLCanvasElement>('grid');
const ctxRaw = canvas.getContext('2d');
if (!ctxRaw) {
  throw new Error('Failed to initialize canvas 2d context');
}
const ctx: CanvasRenderingContext2D = ctxRaw;

const generationEl = getRequiredElement<HTMLElement>('generation');
const statusEl = getRequiredElement<HTMLElement>('status');
const roomEl = getRequiredElement<HTMLElement>('room');
const teamEl = getRequiredElement<HTMLElement>('team');
const resourcesEl = getRequiredElement<HTMLElement>('resources');
const incomeEl = getRequiredElement<HTMLElement>('income');
const baseEl = getRequiredElement<HTMLElement>('base');
const messageEl = getRequiredElement<HTMLElement>('message');

const playerNameEl = getRequiredElement<HTMLInputElement>('player-name');
const setNameButton = getRequiredElement<HTMLButtonElement>('set-name');

const templateSelectEl =
  getRequiredElement<HTMLSelectElement>('template-select');
const buildModeEl = getRequiredElement<HTMLSelectElement>('build-mode');
const buildDelayEl = getRequiredElement<HTMLInputElement>('build-delay');

const newRoomNameEl = getRequiredElement<HTMLInputElement>('new-room-name');
const newRoomSizeEl = getRequiredElement<HTMLInputElement>('new-room-size');
const createRoomButton = getRequiredElement<HTMLButtonElement>('create-room');
const refreshRoomsButton =
  getRequiredElement<HTMLButtonElement>('refresh-rooms');
const roomListEl = getRequiredElement<HTMLDivElement>('room-list');

const socket = io();

let gridWidth = 0;
let gridHeight = 0;
let gridBytes: Uint8Array | null = null;
let cellSize = 6;
let isDrawing = false;
let drawValue = 1;
let lastCell: Cell | null = null;

let currentRoomId = '-';
let currentRoomName = '-';
let currentTeamId: number | null = null;
let availableTemplates: TemplateSummary[] = [];
let selectedTemplateId = '';
let templateMode = false;

function setMessage(message: string): void {
  messageEl.textContent = message;
}

function getSelectedTemplate(): TemplateSummary | null {
  if (!selectedTemplateId) return null;
  return availableTemplates.find(({ id }) => id === selectedTemplateId) ?? null;
}

function updateTemplateOptions(): void {
  templateSelectEl.innerHTML = '';

  if (availableTemplates.length === 0) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = 'No templates';
    templateSelectEl.append(option);
    selectedTemplateId = '';
    return;
  }

  for (const template of availableTemplates) {
    const option = document.createElement('option');
    option.value = template.id;
    option.textContent = `${template.name} (${template.width}x${template.height})`;
    templateSelectEl.append(option);
  }

  if (!selectedTemplateId || !getSelectedTemplate()) {
    selectedTemplateId = availableTemplates[0].id;
  }
  templateSelectEl.value = selectedTemplateId;
}

function renderRoomList(rooms: RoomListEntry[]): void {
  roomListEl.innerHTML = '';

  for (const room of rooms) {
    const item = document.createElement('div');
    item.className = 'room-item';

    const title = document.createElement('div');
    title.textContent = `${room.name} (#${room.roomId})`;

    const details = document.createElement('div');
    details.textContent = `${room.width}x${room.height} • ${room.players} players`;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = 'Join';
    button.addEventListener('click', () => {
      socket.emit('room:join', { roomId: room.roomId });
    });

    item.append(title, details, button);
    roomListEl.append(item);
  }
}

function decodeBase64ToBytes(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getBit(bytes: Uint8Array, index: number): boolean {
  const byteIndex = index >> 3;
  const bitIndex = index & 7;
  const mask = 1 << (7 - bitIndex);
  return (bytes[byteIndex] & mask) !== 0;
}

function getCell(x: number, y: number): number {
  if (!gridBytes) return 0;
  const idx = y * gridWidth + x;
  return getBit(gridBytes, idx) ? 1 : 0;
}

function chooseCellSize(width: number): number {
  const maxWidth = Math.max(240, window.innerWidth - 32);
  const proposed = Math.floor(maxWidth / width);
  return Math.max(3, Math.min(8, proposed));
}

function resizeCanvas(): void {
  if (!gridWidth || !gridHeight) return;

  cellSize = chooseCellSize(gridWidth);
  const ratio = window.devicePixelRatio || 1;
  const cssWidth = gridWidth * cellSize;
  const cssHeight = gridHeight * cellSize;

  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.floor(cssWidth * ratio);
  canvas.height = Math.floor(cssHeight * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

function render(): void {
  if (!gridBytes) return;

  ctx.fillStyle = '#05070d';
  ctx.fillRect(0, 0, gridWidth * cellSize, gridHeight * cellSize);

  ctx.fillStyle = '#46d5b6';
  for (let y = 0; y < gridHeight; y += 1) {
    for (let x = 0; x < gridWidth; x += 1) {
      const idx = y * gridWidth + x;
      if (!getBit(gridBytes, idx)) continue;
      ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
    }
  }

  if (templateMode) {
    const template = getSelectedTemplate();
    if (template) {
      ctx.strokeStyle = 'rgba(70, 213, 182, 0.75)';
      ctx.lineWidth = 1;
      ctx.strokeRect(
        0.5,
        0.5,
        template.width * cellSize,
        template.height * cellSize,
      );
    }
  }
}

function pointerToCell(event: PointerEvent): Cell | null {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((event.clientX - rect.left) / cellSize);
  const y = Math.floor((event.clientY - rect.top) / cellSize);
  if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return null;
  return { x, y };
}

function sendUpdate(x: number, y: number, alive: number): void {
  socket.emit('cell:update', { x, y, alive });
}

function queueTemplateAt(cell: Cell): void {
  if (!currentRoomId || currentRoomId === '-') {
    setMessage('Join a room before queuing templates.');
    return;
  }

  const template = getSelectedTemplate();
  if (!template) {
    setMessage('No template selected.');
    return;
  }

  const x = cell.x - Math.floor(template.width / 2);
  const y = cell.y - Math.floor(template.height / 2);
  const delayTicks = Number(buildDelayEl.value);

  socket.emit('build:queue', {
    templateId: template.id,
    x,
    y,
    delayTicks,
  });
}

function updateTeamStats(payload: StatePayload): void {
  roomEl.textContent = `${payload.roomName} (#${payload.roomId})`;

  if (currentTeamId === null) {
    teamEl.textContent = '-';
    resourcesEl.textContent = '-';
    incomeEl.textContent = '-';
    baseEl.textContent = 'Unknown';
    return;
  }

  const team = payload.teams.find(({ id }) => id === currentTeamId);
  if (!team) {
    teamEl.textContent = '#?';
    resourcesEl.textContent = '-';
    incomeEl.textContent = '-';
    baseEl.textContent = 'Unknown';
    return;
  }

  teamEl.textContent = `#${team.id}`;
  resourcesEl.textContent = `${team.resources}`;
  incomeEl.textContent = `${team.income}/tick`;
  if (team.defeated) {
    baseEl.textContent = 'Breached';
  } else if (team.baseIntact) {
    baseEl.textContent = 'Intact';
  } else {
    baseEl.textContent = 'Critical';
  }
}

function handleDraw(event: PointerEvent): void {
  const cell = pointerToCell(event);
  if (!cell) return;

  if (lastCell && lastCell.x === cell.x && lastCell.y === cell.y) return;

  lastCell = cell;
  sendUpdate(cell.x, cell.y, drawValue);
}

canvas.addEventListener('pointerdown', (event) => {
  if (!gridBytes) return;

  const cell = pointerToCell(event);
  if (!cell) return;

  if (templateMode) {
    queueTemplateAt(cell);
    return;
  }

  canvas.setPointerCapture(event.pointerId);
  isDrawing = true;
  drawValue = getCell(cell.x, cell.y) ? 0 : 1;
  lastCell = null;
  handleDraw(event);
});

canvas.addEventListener('pointermove', (event) => {
  if (!isDrawing) return;
  handleDraw(event);
});

function stopDrawing(event: PointerEvent): void {
  if (!isDrawing) return;
  isDrawing = false;
  lastCell = null;
  if (event.pointerId) {
    canvas.releasePointerCapture(event.pointerId);
  }
}

canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointerleave', stopDrawing);
canvas.addEventListener('pointercancel', stopDrawing);

window.addEventListener('resize', () => {
  const previousCellSize = cellSize;
  resizeCanvas();
  if (cellSize !== previousCellSize) render();
});

socket.on('connect', () => {
  statusEl.textContent = 'Connected';
  socket.emit('room:list');
});

socket.on('disconnect', () => {
  statusEl.textContent = 'Disconnected';
});

socket.on('room:list', (rooms: RoomListEntry[]) => {
  renderRoomList(rooms);
});

socket.on('room:joined', (payload: RoomJoinedPayload) => {
  currentRoomId = payload.roomId;
  currentRoomName = payload.roomName;
  currentTeamId = payload.teamId;
  availableTemplates = payload.templates;
  selectedTemplateId = payload.templates[0]?.id ?? '';
  updateTemplateOptions();
  playerNameEl.value = payload.playerName;
  setMessage(`Joined ${payload.roomName} as team #${payload.teamId}.`);

  gridWidth = payload.state.width;
  gridHeight = payload.state.height;
  gridBytes = decodeBase64ToBytes(payload.state.grid);
  generationEl.textContent = payload.state.generation.toString();
  updateTeamStats(payload.state);
  resizeCanvas();
  render();
});

socket.on('room:left', () => {
  currentRoomId = '-';
  currentRoomName = '-';
  currentTeamId = null;
  roomEl.textContent = '-';
  teamEl.textContent = '-';
  resourcesEl.textContent = '-';
  incomeEl.textContent = '-';
  baseEl.textContent = 'Unknown';
  setMessage('You left the room.');
});

socket.on('room:error', (payload: { message?: string }) => {
  setMessage(payload.message ?? 'Room request failed.');
});

socket.on('build:queued', (payload: BuildQueuedPayload) => {
  setMessage(
    `Build queued (#${payload.eventId}) for tick ${payload.executeTick}.`,
  );
});

socket.on('state', (payload: StatePayload) => {
  gridWidth = payload.width;
  gridHeight = payload.height;
  gridBytes = decodeBase64ToBytes(payload.grid);
  generationEl.textContent = payload.generation.toString();
  if (payload.roomId !== currentRoomId) {
    currentRoomId = payload.roomId;
  }
  if (payload.roomName !== currentRoomName) {
    currentRoomName = payload.roomName;
  }
  updateTeamStats(payload);

  resizeCanvas();
  render();
});

setNameButton.addEventListener('click', () => {
  socket.emit('player:set-name', {
    name: playerNameEl.value,
  });
});

buildModeEl.addEventListener('change', () => {
  templateMode = buildModeEl.value === 'template';
  setMessage(
    templateMode
      ? 'Template mode: click on the board to queue a structure.'
      : 'Paint mode: click and drag to toggle cells.',
  );
});

templateSelectEl.addEventListener('change', () => {
  selectedTemplateId = templateSelectEl.value;
});

createRoomButton.addEventListener('click', () => {
  const size = Number(newRoomSizeEl.value);
  socket.emit('room:create', {
    name: newRoomNameEl.value,
    width: size,
    height: size,
  });
});

refreshRoomsButton.addEventListener('click', () => {
  socket.emit('room:list');
});

updateTemplateOptions();
