import { io } from 'socket.io-client';

type RoomStatus = 'lobby' | 'countdown' | 'active';
type ConnectionStatus = 'connected' | 'held';

interface Cell {
  x: number;
  y: number;
}

interface TeamPayload {
  id: number;
  name: string;
  playerIds: string[];
  resources: number;
  income: number;
  defeated: boolean;
  baseTopLeft: Cell;
  baseIntact: boolean;
}

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

interface RoomListEntry {
  roomId: string;
  roomCode: string;
  name: string;
  width: number;
  height: number;
  players: number;
  spectators: number;
  teams: number;
  status: RoomStatus;
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
  roomCode: string;
  roomName: string;
  playerId: string;
  playerName: string;
  teamId: number | null;
  templates: TemplateSummary[];
  state: StatePayload;
}

interface BuildQueuedPayload {
  eventId: number;
  executeTick: number;
}

interface MembershipParticipant {
  sessionId: string;
  displayName: string;
  role: 'player' | 'spectator';
  slotId: string | null;
  ready: boolean;
  connectionStatus: ConnectionStatus;
  holdExpiresAt: number | null;
  disconnectReason: string | null;
}

interface RoomMembershipPayload {
  roomId: string;
  roomCode: string;
  roomName: string;
  revision: number;
  status: RoomStatus;
  hostSessionId: string | null;
  slots: Record<string, string | null>;
  participants: MembershipParticipant[];
  heldSlots: Record<
    string,
    {
      sessionId: string;
      holdExpiresAt: number;
      disconnectReason: string | null;
    } | null
  >;
  countdownSecondsRemaining: number | null;
}

interface RoomCountdownPayload {
  roomId: string;
  secondsRemaining: number;
}

interface RoomErrorPayload {
  message?: string;
  reason?: string;
}

function getRequiredElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) {
    throw new Error(`Missing #${id}`);
  }
  return el as T;
}

function getTeamLabel(slotId: string): string {
  if (slotId === 'team-1') {
    return 'Team A';
  }
  if (slotId === 'team-2') {
    return 'Team B';
  }
  return slotId;
}

function getTeamColor(slotId: string): string {
  if (slotId === 'team-1') {
    return 'var(--team-a)';
  }
  if (slotId === 'team-2') {
    return 'var(--team-b)';
  }
  return 'var(--accent)';
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
const roomCodeEl = getRequiredElement<HTMLElement>('room-code');
const teamEl = getRequiredElement<HTMLElement>('team');
const resourcesEl = getRequiredElement<HTMLElement>('resources');
const incomeEl = getRequiredElement<HTMLElement>('income');
const baseEl = getRequiredElement<HTMLElement>('base');
const messageEl = getRequiredElement<HTMLElement>('message');
const lobbyStatusEl = getRequiredElement<HTMLElement>('lobby-status');
const lobbyCountdownEl = getRequiredElement<HTMLElement>('lobby-countdown');
const lobbyPlayerSlotsEl =
  getRequiredElement<HTMLDivElement>('lobby-player-slots');
const lobbySpectatorsEl =
  getRequiredElement<HTMLDivElement>('lobby-spectators');
const spawnMarkersEl = getRequiredElement<HTMLDivElement>('spawn-markers');

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
let currentRoomCode = '-';
let currentRoomName = '-';
let currentTeamId: number | null = null;
let currentMembership: RoomMembershipPayload | null = null;
let availableTemplates: TemplateSummary[] = [];
let selectedTemplateId = '';
let templateMode = false;

function setMessage(message: string, isError = false): void {
  messageEl.textContent = message;
  messageEl.classList.toggle('message--error', isError);
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
    title.textContent = `${room.name} (#${room.roomId}, code ${room.roomCode})`;

    const details = document.createElement('div');
    details.className = 'slot-meta';
    details.textContent = `${room.width}x${room.height} | ${room.players} players | ${room.spectators} spectators | ${room.status}`;

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
    setMessage('Join a room before queuing templates.', true);
    return;
  }

  const template = getSelectedTemplate();
  if (!template) {
    setMessage('No template selected.', true);
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
  roomCodeEl.textContent = currentRoomCode;

  if (currentTeamId === null) {
    teamEl.textContent = 'Spectator';
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

function renderLobbyStatus(payload: RoomMembershipPayload): void {
  const hostText = payload.hostSessionId
    ? `Host: ${payload.hostSessionId}`
    : 'Host: none';
  lobbyStatusEl.textContent = `${hostText} | rev ${payload.revision} | ${payload.status}`;

  if (payload.status === 'countdown') {
    const seconds = payload.countdownSecondsRemaining ?? 0;
    lobbyCountdownEl.textContent = `Match starts in ${seconds}s`;
    return;
  }

  if (payload.status === 'active') {
    lobbyCountdownEl.textContent = 'Match active';
    return;
  }

  lobbyCountdownEl.textContent = 'Waiting for both players to ready up';
}

function createBadge(label: string, className: string): HTMLElement {
  const badge = document.createElement('span');
  badge.className = `badge ${className}`;
  badge.textContent = label;
  return badge;
}

function createHeldBadge(participant: MembershipParticipant): HTMLElement {
  const badge = document.createElement('span');
  badge.className = 'badge badge--held';

  const dot = document.createElement('span');
  dot.className = 'status-dot status-dot--held';
  badge.append(dot);

  const heldRemainingMs =
    participant.holdExpiresAt === null
      ? 0
      : Math.max(0, participant.holdExpiresAt - Date.now());
  const heldRemainingSec = Math.ceil(heldRemainingMs / 1000);

  const text = document.createElement('span');
  text.textContent = `Disconnected (${heldRemainingSec}s hold)`;
  badge.append(text);

  return badge;
}

function renderLobbyMembership(payload: RoomMembershipPayload): void {
  currentMembership = payload;
  currentRoomCode = payload.roomCode;
  roomCodeEl.textContent = payload.roomCode;

  renderLobbyStatus(payload);

  lobbyPlayerSlotsEl.innerHTML = '';
  const participantBySession = new Map(
    payload.participants.map((participant) => [
      participant.sessionId,
      participant,
    ]),
  );

  for (const [slotId, occupantSessionId] of Object.entries(payload.slots)) {
    const row = document.createElement('div');
    row.className = 'slot-item';

    const head = document.createElement('div');
    head.className = 'slot-head';

    const teamInfo = document.createElement('div');
    teamInfo.className = 'slot-team';

    const chip = document.createElement('span');
    chip.className = 'team-chip';
    chip.style.backgroundColor = getTeamColor(slotId);

    const label = document.createElement('strong');
    label.textContent = getTeamLabel(slotId);
    teamInfo.append(chip, label);

    const occupant = document.createElement('div');
    if (!occupantSessionId) {
      occupant.textContent = 'Open slot';
      occupant.className = 'slot-meta';
      head.append(teamInfo, occupant);
      row.append(head);
      lobbyPlayerSlotsEl.append(row);
      continue;
    }

    const participant = participantBySession.get(occupantSessionId);
    occupant.textContent = participant?.displayName ?? occupantSessionId;
    head.append(teamInfo, occupant);

    const meta = document.createElement('div');
    meta.className = 'slot-meta';
    meta.textContent = `session: ${occupantSessionId}`;

    const badges = document.createElement('div');
    badges.className = 'badge-row';

    if (payload.hostSessionId === occupantSessionId) {
      badges.append(createBadge('Host', 'badge--host'));
    }

    if (participant?.ready) {
      badges.append(createBadge('Ready', 'badge--ready'));
    } else {
      badges.append(createBadge('Not Ready', 'badge--held'));
    }

    if (participant?.connectionStatus === 'held') {
      badges.append(createHeldBadge(participant));
    }

    row.append(head, meta, badges);
    lobbyPlayerSlotsEl.append(row);
  }

  lobbySpectatorsEl.innerHTML = '';
  const spectators = payload.participants.filter(
    (participant) => participant.role === 'spectator',
  );

  if (spectators.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'spectator-item';
    empty.textContent = 'No spectators in room.';
    lobbySpectatorsEl.append(empty);
  } else {
    for (const spectator of spectators) {
      const item = document.createElement('div');
      item.className = 'spectator-item';

      const title = document.createElement('div');
      title.textContent = spectator.displayName;

      const meta = document.createElement('div');
      meta.className = 'spectator-meta';
      meta.textContent = `session: ${spectator.sessionId}`;

      item.append(title, meta);
      lobbySpectatorsEl.append(item);
    }
  }
}

function renderSpawnMarkers(payload: StatePayload): void {
  spawnMarkersEl.innerHTML = '';

  if (payload.teams.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'spawn-item';
    empty.textContent = 'Spawn markers appear after player slots are claimed.';
    spawnMarkersEl.append(empty);
    return;
  }

  const sortedTeams = [...payload.teams].sort((a, b) => a.id - b.id);
  for (const team of sortedTeams) {
    const item = document.createElement('div');
    item.className = 'spawn-item';

    const title = document.createElement('div');
    title.className = 'slot-team';

    const chip = document.createElement('span');
    chip.className = 'team-chip';
    chip.style.backgroundColor =
      team.id === 1 ? 'var(--team-a)' : 'var(--team-b)';

    const label = document.createElement('strong');
    label.textContent = `Team ${team.id}`;
    title.append(chip, label);

    const meta = document.createElement('div');
    meta.className = 'spawn-meta';
    meta.textContent = `base top-left: (${team.baseTopLeft.x}, ${team.baseTopLeft.y})`;

    item.append(title, meta);
    spawnMarkersEl.append(item);
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
  currentRoomCode = payload.roomCode;
  currentRoomName = payload.roomName;
  currentTeamId = payload.teamId;
  availableTemplates = payload.templates;
  selectedTemplateId = payload.templates[0]?.id ?? '';
  updateTemplateOptions();
  playerNameEl.value = payload.playerName;

  setMessage(
    payload.teamId === null
      ? `Joined ${payload.roomName} as spectator.`
      : `Joined ${payload.roomName} as team #${payload.teamId}.`,
  );

  gridWidth = payload.state.width;
  gridHeight = payload.state.height;
  gridBytes = decodeBase64ToBytes(payload.state.grid);
  generationEl.textContent = payload.state.generation.toString();
  updateTeamStats(payload.state);
  renderSpawnMarkers(payload.state);
  resizeCanvas();
  render();
});

socket.on('room:left', () => {
  currentRoomId = '-';
  currentRoomCode = '-';
  currentRoomName = '-';
  currentTeamId = null;
  currentMembership = null;

  roomEl.textContent = '-';
  roomCodeEl.textContent = '-';
  teamEl.textContent = '-';
  resourcesEl.textContent = '-';
  incomeEl.textContent = '-';
  baseEl.textContent = 'Unknown';

  lobbyStatusEl.textContent = '';
  lobbyCountdownEl.textContent = 'Waiting for host';
  lobbyPlayerSlotsEl.innerHTML = '';
  lobbySpectatorsEl.innerHTML = '';
  spawnMarkersEl.innerHTML = '';

  setMessage('You left the room.');
});

socket.on('room:error', (payload: RoomErrorPayload) => {
  setMessage(payload.message ?? 'Room request failed.', true);
});

socket.on('room:membership', (payload: RoomMembershipPayload) => {
  renderLobbyMembership(payload);
});

socket.on('room:countdown', (payload: RoomCountdownPayload) => {
  if (!currentMembership || payload.roomId !== currentMembership.roomId) {
    return;
  }

  lobbyCountdownEl.textContent = `Match starts in ${payload.secondsRemaining}s`;
});

socket.on('room:match-started', () => {
  lobbyCountdownEl.textContent = 'Match active';
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
  renderSpawnMarkers(payload);
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
