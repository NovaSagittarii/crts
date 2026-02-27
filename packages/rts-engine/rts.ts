import type { CellUpdate } from '#conway-core';
import {
  applyUpdates,
  createGrid,
  encodeGridBase64,
  stepGrid,
} from '#conway-core';
import {
  determineMatchOutcome,
  type MatchOutcome,
  type TeamOutcomeSnapshot,
} from './match-lifecycle.js';
import { createTorusSpawnLayout } from './spawn.js';

export interface Vector2 {
  x: number;
  y: number;
}

export interface StructureTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  cells: Uint8Array;
  activationCost: number;
  income: number;
  buildArea: number;
  checks: Vector2[];
}

export interface StructureTemplateSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  activationCost: number;
  income: number;
  buildArea: number;
}

export interface BuildQueuePayload {
  templateId: string;
  x: number;
  y: number;
  delayTicks?: number;
}

export interface BuildEvent {
  id: number;
  teamId: number;
  playerId: string;
  templateId: string;
  x: number;
  y: number;
  executeTick: number;
}

export interface StructureInstance {
  key: string;
  templateId: string;
  x: number;
  y: number;
  active: boolean;
  hp: number;
  isCore: boolean;
  buildRadius: number;
}

export interface BuildStats {
  queued: number;
  applied: number;
  rejected: number;
}

export interface TimelineEvent {
  tick: number;
  teamId: number;
  type:
    | 'build-queued'
    | 'build-applied'
    | 'build-rejected'
    | 'core-damaged'
    | 'core-destroyed'
    | 'team-defeated';
  metadata?: Record<string, number | string | boolean>;
}

export interface TeamState {
  id: number;
  name: string;
  playerIds: Set<string>;
  resources: number;
  income: number;
  lastIncomeTick: number;
  territoryRadius: number;
  baseTopLeft: Vector2;
  defeated: boolean;
  structures: Map<string, StructureInstance>;
  pendingBuildEvents: BuildEvent[];
  buildStats: BuildStats;
}

export interface RoomPlayerState {
  id: string;
  name: string;
  teamId: number;
}

export interface RoomState {
  id: string;
  name: string;
  width: number;
  height: number;
  generation: number;
  tick: number;
  nextTeamId: number;
  nextBuildEventId: number;
  grid: Uint8Array;
  templateMap: Map<string, StructureTemplate>;
  templates: StructureTemplate[];
  teams: Map<number, TeamState>;
  players: Map<string, RoomPlayerState>;
  spawnOrientationSeed: number;
  pendingLegacyUpdates: CellUpdate[];
  timelineEvents: TimelineEvent[];
}

export interface RoomListEntry {
  roomId: string;
  name: string;
  width: number;
  height: number;
  players: number;
  teams: number;
}

export interface TeamPayload {
  id: number;
  name: string;
  playerIds: string[];
  resources: number;
  income: number;
  defeated: boolean;
  baseTopLeft: Vector2;
  baseIntact: boolean;
}

export interface RoomStatePayload {
  roomId: string;
  roomName: string;
  width: number;
  height: number;
  generation: number;
  tick: number;
  grid: string;
  teams: TeamPayload[];
}

export interface QueueBuildResult {
  accepted: boolean;
  error?: string;
  eventId?: number;
  executeTick?: number;
}

export interface RoomTickResult {
  appliedBuilds: number;
  defeatedTeams: number[];
  outcome: MatchOutcome | null;
}

export interface CreateRoomOptions {
  id: string;
  name: string;
  width: number;
  height: number;
  templates?: StructureTemplate[];
}

interface StructureTemplateRowsOptions {
  id: string;
  name: string;
  rows: string[];
  activationCost?: number;
  income?: number;
  buildArea?: number;
  checks?: Vector2[];
}

const BASE_BLOCK_WIDTH = 2;
const BASE_BLOCK_HEIGHT = 2;
const DEFAULT_STARTING_RESOURCES = 40;
const DEFAULT_TEAM_TERRITORY_RADIUS = 12;
const DEFAULT_SPAWN_CAPACITY = 2;
const MAX_DELAY_TICKS = 20;
const CORE_TEMPLATE_ID = '__core__';
const CORE_STARTING_HP = 3;
const CORE_RESTORE_INTERVAL_TICKS = 1;

function hashSpawnSeed(roomId: string, width: number, height: number): number {
  let hash = 2166136261;
  const input = `${roomId}:${width}x${height}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function parseTemplateRows(rows: string[]): {
  width: number;
  height: number;
  cells: Uint8Array;
} {
  if (rows.length === 0) {
    throw new Error('Template rows must not be empty');
  }

  const width = rows[0].length;
  if (width === 0) {
    throw new Error('Template rows must not be empty strings');
  }

  for (const row of rows) {
    if (row.length !== width) {
      throw new Error('Template rows must have a consistent width');
    }
  }

  const height = rows.length;
  const cells = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const symbol = rows[y][x];
      if (symbol === '#') {
        cells[y * width + x] = 1;
      } else if (symbol === '.') {
        cells[y * width + x] = 0;
      } else {
        throw new Error(`Unsupported template symbol: ${symbol}`);
      }
    }
  }

  return { width, height, cells };
}

function createTemplateFromRows(
  options: StructureTemplateRowsOptions,
): StructureTemplate {
  const parsed = parseTemplateRows(options.rows);
  return {
    id: options.id,
    name: options.name,
    width: parsed.width,
    height: parsed.height,
    cells: parsed.cells,
    activationCost: options.activationCost ?? 0,
    income: options.income ?? 0,
    buildArea: options.buildArea ?? 0,
    checks: options.checks ?? [],
  };
}

const CORE_STRUCTURE_TEMPLATE = createTemplateFromRows({
  id: CORE_TEMPLATE_ID,
  name: 'Core',
  rows: ['##', '##'],
  buildArea: 0,
  checks: [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: 1 },
  ],
});

function appendTimelineEvent(
  room: RoomState,
  event: Omit<TimelineEvent, 'tick'>,
): void {
  room.timelineEvents.push({
    ...event,
    tick: room.tick,
  });
}

function getStructureTemplate(
  room: RoomState,
  structure: StructureInstance,
): StructureTemplate | null {
  if (structure.isCore) {
    return CORE_STRUCTURE_TEMPLATE;
  }

  return room.templateMap.get(structure.templateId) ?? null;
}

function getCoreStructure(team: TeamState): StructureInstance | null {
  for (const structure of team.structures.values()) {
    if (structure.isCore) {
      return structure;
    }
  }

  return null;
}

function templateCellAt(
  template: StructureTemplate,
  x: number,
  y: number,
): number {
  return template.cells[y * template.width + x];
}

function gridCellAt(
  grid: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return 0;
  }
  return grid[y * width + x];
}

function setGridCell(
  grid: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
  value: number,
): void {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }
  grid[y * width + x] = value ? 1 : 0;
}

function inBounds(
  room: RoomState,
  x: number,
  y: number,
  width: number,
  height: number,
): boolean {
  if (x < 0 || y < 0) {
    return false;
  }
  if (x + width > room.width || y + height > room.height) {
    return false;
  }
  return true;
}

function createStructureKey(
  template: StructureTemplate,
  x: number,
  y: number,
): string {
  return `${x},${y},${template.width},${template.height}`;
}

function isTeamTerritoryPlacementValid(
  team: TeamState,
  template: StructureTemplate,
  x: number,
  y: number,
): boolean {
  const templateCenterX = x + Math.floor(template.width / 2);
  const templateCenterY = y + Math.floor(template.height / 2);
  const baseCenterX = team.baseTopLeft.x + 1;
  const baseCenterY = team.baseTopLeft.y + 1;
  const radius = team.territoryRadius;
  return (
    Math.abs(templateCenterX - baseCenterX) <= radius &&
    Math.abs(templateCenterY - baseCenterY) <= radius
  );
}

function compareTemplate(
  room: RoomState,
  template: StructureTemplate,
  x: number,
  y: number,
): number {
  if (!inBounds(room, x, y, template.width, template.height)) {
    return -1;
  }

  let diffCount = 0;
  for (let ty = 0; ty < template.height; ty += 1) {
    for (let tx = 0; tx < template.width; tx += 1) {
      const templateCell = templateCellAt(template, tx, ty);
      const roomCell = gridCellAt(
        room.grid,
        room.width,
        room.height,
        x + tx,
        y + ty,
      );
      if (templateCell !== roomCell) {
        diffCount += 1;
      }
    }
  }
  return diffCount;
}

function applyTemplate(
  room: RoomState,
  template: StructureTemplate,
  x: number,
  y: number,
): boolean {
  if (!inBounds(room, x, y, template.width, template.height)) {
    return false;
  }

  for (let ty = 0; ty < template.height; ty += 1) {
    for (let tx = 0; tx < template.width; tx += 1) {
      setGridCell(
        room.grid,
        room.width,
        room.height,
        x + tx,
        y + ty,
        templateCellAt(template, tx, ty),
      );
    }
  }

  return true;
}

function checkStructureIntegrity(
  room: RoomState,
  structure: StructureInstance,
  template: StructureTemplate,
): boolean {
  if (template.checks.length === 0) {
    return false;
  }

  for (const check of template.checks) {
    const gx = structure.x + check.x;
    const gy = structure.y + check.y;
    if (gx < 0 || gy < 0 || gx >= room.width || gy >= room.height) {
      return false;
    }
    const expected = templateCellAt(template, check.x, check.y);
    const actual = gridCellAt(room.grid, room.width, room.height, gx, gy);
    if (expected !== actual) {
      return false;
    }
  }

  return true;
}

function isBaseIntact(room: RoomState, team: TeamState): boolean {
  const core = getCoreStructure(team);
  if (!core || core.hp <= 0) {
    return false;
  }

  return checkStructureIntegrity(room, core, CORE_STRUCTURE_TEMPLATE);
}

function countTerritoryCells(room: RoomState, team: TeamState): number {
  const centerX = team.baseTopLeft.x + 1;
  const centerY = team.baseTopLeft.y + 1;
  const radius = team.territoryRadius;

  let count = 0;
  for (
    let y = Math.max(0, centerY - radius);
    y <= Math.min(room.height - 1, centerY + radius);
    y += 1
  ) {
    for (
      let x = Math.max(0, centerX - radius);
      x <= Math.min(room.width - 1, centerX + radius);
      x += 1
    ) {
      if (gridCellAt(room.grid, room.width, room.height, x, y) === 1) {
        count += 1;
      }
    }
  }

  return count;
}

function seedBase(room: RoomState, baseTopLeft: Vector2): void {
  for (let by = 0; by < BASE_BLOCK_HEIGHT; by += 1) {
    for (let bx = 0; bx < BASE_BLOCK_WIDTH; bx += 1) {
      setGridCell(
        room.grid,
        room.width,
        room.height,
        baseTopLeft.x + bx,
        baseTopLeft.y + by,
        1,
      );
    }
  }
}

function pickSpawnPosition(room: RoomState, teamId: number): Vector2 {
  const occupied = new Set<string>();
  for (const team of room.teams.values()) {
    occupied.add(`${team.baseTopLeft.x},${team.baseTopLeft.y}`);
  }

  const preferredCapacity = Math.max(
    DEFAULT_SPAWN_CAPACITY,
    room.teams.size + 1,
    teamId,
  );

  for (let expansion = 0; expansion <= 6; expansion += 1) {
    const layout = createTorusSpawnLayout({
      width: room.width,
      height: room.height,
      teamCount: preferredCapacity + expansion,
      orientationSeed: room.spawnOrientationSeed,
      baseWidth: BASE_BLOCK_WIDTH,
      baseHeight: BASE_BLOCK_HEIGHT,
      minWrappedDistance: BASE_BLOCK_WIDTH + 1,
    });

    const startIndex = (teamId - 1) % layout.length;
    for (let offset = 0; offset < layout.length; offset += 1) {
      const candidate = layout[(startIndex + offset) % layout.length].topLeft;
      if (occupied.has(`${candidate.x},${candidate.y}`)) {
        continue;
      }
      return candidate;
    }
  }

  throw new Error('Unable to allocate deterministic spawn position');
}

function applyTeamEconomyAndQueue(
  room: RoomState,
  team: TeamState,
  acceptedEvents: BuildEvent[],
): void {
  if (team.defeated) {
    return;
  }

  let computedIncome = 0;
  let territoryBonus = 0;

  for (const structure of team.structures.values()) {
    const template = getStructureTemplate(room, structure);
    if (!template) {
      structure.active = false;
      structure.buildRadius = 0;
      continue;
    }

    const active =
      structure.hp > 0 && checkStructureIntegrity(room, structure, template);
    structure.active = active;
    structure.buildRadius = active ? template.buildArea : 0;

    if (active && !structure.isCore) {
      computedIncome += template.income;
      territoryBonus += structure.buildRadius;
    }
  }

  team.income = computedIncome;
  team.territoryRadius = DEFAULT_TEAM_TERRITORY_RADIUS + territoryBonus;

  if (room.tick > team.lastIncomeTick) {
    const elapsed = room.tick - team.lastIncomeTick;
    team.resources += elapsed * team.income;
    team.lastIncomeTick = room.tick;
  }

  const deferred: BuildEvent[] = [];
  for (const event of team.pendingBuildEvents) {
    if (event.executeTick > room.tick) {
      deferred.push(event);
      continue;
    }

    const template = room.templateMap.get(event.templateId);
    if (!template) {
      team.buildStats.rejected += 1;
      appendTimelineEvent(room, {
        teamId: team.id,
        type: 'build-rejected',
        metadata: { reason: 'unknown-template', eventId: event.id },
      });
      continue;
    }

    if (!inBounds(room, event.x, event.y, template.width, template.height)) {
      team.buildStats.rejected += 1;
      appendTimelineEvent(room, {
        teamId: team.id,
        type: 'build-rejected',
        metadata: { reason: 'out-of-bounds', eventId: event.id },
      });
      continue;
    }

    if (!isTeamTerritoryPlacementValid(team, template, event.x, event.y)) {
      team.buildStats.rejected += 1;
      appendTimelineEvent(room, {
        teamId: team.id,
        type: 'build-rejected',
        metadata: { reason: 'outside-territory', eventId: event.id },
      });
      continue;
    }

    const key = createStructureKey(template, event.x, event.y);
    if (team.structures.has(key)) {
      team.buildStats.rejected += 1;
      appendTimelineEvent(room, {
        teamId: team.id,
        type: 'build-rejected',
        metadata: { reason: 'occupied-site', eventId: event.id },
      });
      continue;
    }

    const diffCells = compareTemplate(room, template, event.x, event.y);
    if (diffCells < 0) {
      team.buildStats.rejected += 1;
      appendTimelineEvent(room, {
        teamId: team.id,
        type: 'build-rejected',
        metadata: { reason: 'template-compare-failed', eventId: event.id },
      });
      continue;
    }

    const buildCost = diffCells + template.activationCost;
    if (team.resources < buildCost) {
      team.buildStats.rejected += 1;
      appendTimelineEvent(room, {
        teamId: team.id,
        type: 'build-rejected',
        metadata: { reason: 'insufficient-resources', eventId: event.id },
      });
      continue;
    }

    team.resources -= buildCost;
    acceptedEvents.push(event);

    if (template.checks.length > 0) {
      team.structures.set(key, {
        key,
        templateId: template.id,
        x: event.x,
        y: event.y,
        active: false,
        hp: 1,
        isCore: false,
        buildRadius: 0,
      });
    }
  }

  team.pendingBuildEvents = deferred;
}

export function createDefaultTemplates(): StructureTemplate[] {
  return [
    createTemplateFromRows({
      id: 'block',
      name: 'Block 2x2',
      rows: ['##', '##'],
      activationCost: 0,
      income: 0,
      buildArea: 0,
      checks: [],
    }),
    createTemplateFromRows({
      id: 'generator',
      name: 'Generator Block',
      rows: ['##', '##'],
      activationCost: 6,
      income: 2,
      buildArea: 2,
      checks: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ],
    }),
    createTemplateFromRows({
      id: 'glider',
      name: 'Glider',
      rows: ['.#.', '..#', '###'],
      activationCost: 2,
      income: 0,
      buildArea: 0,
      checks: [],
    }),
    createTemplateFromRows({
      id: 'eater-1',
      name: 'Eater 1',
      rows: ['##..', '#.##', '.###', '..#.'],
      activationCost: 4,
      income: 0,
      buildArea: 1,
      checks: [],
    }),
  ];
}

export function createTemplateSummaries(
  templates: StructureTemplate[],
): StructureTemplateSummary[] {
  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    width: template.width,
    height: template.height,
    activationCost: template.activationCost,
    income: template.income,
    buildArea: template.buildArea,
  }));
}

export function createRoomState(options: CreateRoomOptions): RoomState {
  const templates = options.templates ?? createDefaultTemplates();
  const templateMap = new Map<string, StructureTemplate>();
  for (const template of templates) {
    templateMap.set(template.id, template);
  }

  return {
    id: options.id,
    name: options.name,
    width: options.width,
    height: options.height,
    generation: 0,
    tick: 0,
    nextTeamId: 1,
    nextBuildEventId: 1,
    grid: createGrid({ width: options.width, height: options.height }),
    templateMap,
    templates,
    teams: new Map<number, TeamState>(),
    players: new Map<string, RoomPlayerState>(),
    spawnOrientationSeed: hashSpawnSeed(
      options.id,
      options.width,
      options.height,
    ),
    pendingLegacyUpdates: [],
    timelineEvents: [],
  };
}

export function listRooms(rooms: Map<string, RoomState>): RoomListEntry[] {
  const entries: RoomListEntry[] = [];
  for (const room of rooms.values()) {
    entries.push({
      roomId: room.id,
      name: room.name,
      width: room.width,
      height: room.height,
      players: room.players.size,
      teams: room.teams.size,
    });
  }
  return entries;
}

export function addPlayerToRoom(
  room: RoomState,
  playerId: string,
  playerName: string,
): TeamState {
  const existing = room.players.get(playerId);
  if (existing) {
    const existingTeam = room.teams.get(existing.teamId);
    if (existingTeam) {
      return existingTeam;
    }
  }

  const teamId = room.nextTeamId;
  room.nextTeamId += 1;

  const baseTopLeft = pickSpawnPosition(room, teamId);
  const coreKey = createStructureKey(
    CORE_STRUCTURE_TEMPLATE,
    baseTopLeft.x,
    baseTopLeft.y,
  );

  const structures = new Map<string, StructureInstance>();
  structures.set(coreKey, {
    key: coreKey,
    templateId: CORE_TEMPLATE_ID,
    x: baseTopLeft.x,
    y: baseTopLeft.y,
    active: true,
    hp: CORE_STARTING_HP,
    isCore: true,
    buildRadius: 0,
  });

  const team: TeamState = {
    id: teamId,
    name: `${playerName}'s Team`,
    playerIds: new Set<string>([playerId]),
    resources: DEFAULT_STARTING_RESOURCES,
    income: 0,
    lastIncomeTick: room.tick,
    territoryRadius: DEFAULT_TEAM_TERRITORY_RADIUS,
    baseTopLeft,
    defeated: false,
    structures,
    pendingBuildEvents: [],
    buildStats: {
      queued: 0,
      applied: 0,
      rejected: 0,
    },
  };

  room.players.set(playerId, {
    id: playerId,
    name: playerName,
    teamId,
  });
  room.teams.set(teamId, team);
  seedBase(room, baseTopLeft);

  return team;
}

export function renamePlayerInRoom(
  room: RoomState,
  playerId: string,
  name: string,
): boolean {
  const player = room.players.get(playerId);
  if (!player) {
    return false;
  }
  player.name = name;
  const team = room.teams.get(player.teamId);
  if (team && team.playerIds.size === 1) {
    team.name = `${name}'s Team`;
  }
  return true;
}

export function removePlayerFromRoom(
  room: RoomState,
  playerId: string,
): boolean {
  const player = room.players.get(playerId);
  if (!player) {
    return false;
  }

  const team = room.teams.get(player.teamId);
  if (team) {
    team.playerIds.delete(playerId);
    if (team.playerIds.size === 0) {
      room.teams.delete(team.id);
    }
  }

  room.players.delete(playerId);
  return true;
}

export function queueLegacyCellUpdate(
  room: RoomState,
  update: CellUpdate,
): void {
  room.pendingLegacyUpdates.push(update);
}

export function queueBuildEvent(
  room: RoomState,
  playerId: string,
  payload: BuildQueuePayload,
): QueueBuildResult {
  const player = room.players.get(playerId);
  if (!player) {
    return {
      accepted: false,
      error: 'Player is not in this room',
    };
  }

  const team = room.teams.get(player.teamId);
  if (!team) {
    return {
      accepted: false,
      error: 'Team is not available',
    };
  }

  if (team.defeated) {
    team.buildStats.rejected += 1;
    appendTimelineEvent(room, {
      teamId: team.id,
      type: 'build-rejected',
      metadata: { reason: 'team-defeated' },
    });
    return {
      accepted: false,
      error: 'Team is defeated',
    };
  }

  const template = room.templateMap.get(payload.templateId);
  if (!template) {
    team.buildStats.rejected += 1;
    appendTimelineEvent(room, {
      teamId: team.id,
      type: 'build-rejected',
      metadata: { reason: 'unknown-template' },
    });
    return {
      accepted: false,
      error: 'Unknown template',
    };
  }

  const x = Number(payload.x);
  const y = Number(payload.y);
  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    team.buildStats.rejected += 1;
    appendTimelineEvent(room, {
      teamId: team.id,
      type: 'build-rejected',
      metadata: { reason: 'invalid-coordinates' },
    });
    return {
      accepted: false,
      error: 'x and y must be integers',
    };
  }

  if (!inBounds(room, x, y, template.width, template.height)) {
    team.buildStats.rejected += 1;
    appendTimelineEvent(room, {
      teamId: team.id,
      type: 'build-rejected',
      metadata: { reason: 'out-of-bounds' },
    });
    return {
      accepted: false,
      error: 'Placement is out of bounds',
    };
  }

  if (!isTeamTerritoryPlacementValid(team, template, x, y)) {
    team.buildStats.rejected += 1;
    appendTimelineEvent(room, {
      teamId: team.id,
      type: 'build-rejected',
      metadata: { reason: 'outside-territory' },
    });
    return {
      accepted: false,
      error: 'Placement is outside team territory',
    };
  }

  const delay = Number(payload.delayTicks ?? 2);
  if (!Number.isInteger(delay)) {
    team.buildStats.rejected += 1;
    appendTimelineEvent(room, {
      teamId: team.id,
      type: 'build-rejected',
      metadata: { reason: 'invalid-delay' },
    });
    return {
      accepted: false,
      error: 'delayTicks must be an integer',
    };
  }

  const clampedDelay = Math.max(1, Math.min(MAX_DELAY_TICKS, delay));
  const event: BuildEvent = {
    id: room.nextBuildEventId,
    teamId: team.id,
    playerId,
    templateId: template.id,
    x,
    y,
    executeTick: room.tick + clampedDelay,
  };
  room.nextBuildEventId += 1;

  team.pendingBuildEvents.push(event);
  team.pendingBuildEvents.sort((a, b) => a.executeTick - b.executeTick);
  team.buildStats.queued += 1;
  appendTimelineEvent(room, {
    teamId: team.id,
    type: 'build-queued',
    metadata: {
      eventId: event.id,
      executeTick: event.executeTick,
    },
  });

  return {
    accepted: true,
    eventId: event.id,
    executeTick: event.executeTick,
  };
}

export function createRoomStatePayload(room: RoomState): RoomStatePayload {
  const teams: TeamPayload[] = [];
  for (const team of room.teams.values()) {
    teams.push({
      id: team.id,
      name: team.name,
      playerIds: [...team.playerIds],
      resources: team.resources,
      income: team.income,
      defeated: team.defeated,
      baseTopLeft: {
        x: team.baseTopLeft.x,
        y: team.baseTopLeft.y,
      },
      baseIntact: isBaseIntact(room, team),
    });
  }

  return {
    roomId: room.id,
    roomName: room.name,
    width: room.width,
    height: room.height,
    generation: room.generation,
    tick: room.tick,
    grid: encodeGridBase64(room.grid),
    teams,
  };
}

function resolveCoreRestoreChecks(room: RoomState): Map<number, number> {
  const coreHpBeforeResolution = new Map<number, number>();

  if (
    CORE_RESTORE_INTERVAL_TICKS <= 0 ||
    room.tick % CORE_RESTORE_INTERVAL_TICKS !== 0
  ) {
    return coreHpBeforeResolution;
  }

  for (const team of room.teams.values()) {
    if (team.defeated) {
      continue;
    }

    const core = getCoreStructure(team);
    if (!core || core.hp <= 0) {
      continue;
    }

    const intact = checkStructureIntegrity(room, core, CORE_STRUCTURE_TEMPLATE);
    if (intact) {
      core.active = true;
      core.buildRadius = 0;
      continue;
    }

    const hpBefore = core.hp;
    coreHpBeforeResolution.set(team.id, hpBefore);
    core.hp = Math.max(0, core.hp - 1);
    core.buildRadius = 0;

    appendTimelineEvent(room, {
      teamId: team.id,
      type: 'core-damaged',
      metadata: {
        hpBefore,
        hpAfter: core.hp,
      },
    });

    if (core.hp > 0) {
      applyTemplate(room, CORE_STRUCTURE_TEMPLATE, core.x, core.y);
      core.active = true;
      continue;
    }

    core.active = false;
    appendTimelineEvent(room, {
      teamId: team.id,
      type: 'core-destroyed',
      metadata: {
        hpBefore,
      },
    });
  }

  return coreHpBeforeResolution;
}

export function createTeamOutcomeSnapshots(
  room: RoomState,
  coreHpBeforeResolution: ReadonlyMap<number, number> = new Map(),
): TeamOutcomeSnapshot[] {
  const snapshots: TeamOutcomeSnapshot[] = [];

  for (const team of room.teams.values()) {
    const core = getCoreStructure(team);
    const coreHp = core?.hp ?? 0;
    snapshots.push({
      teamId: team.id,
      coreHp,
      coreHpBeforeResolution: coreHpBeforeResolution.get(team.id) ?? coreHp,
      coreDestroyed: coreHp <= 0,
      territoryCellCount: countTerritoryCells(room, team),
      queuedBuildCount: team.buildStats.queued,
      appliedBuildCount: team.buildStats.applied,
      rejectedBuildCount: team.buildStats.rejected,
    });
  }

  return snapshots;
}

export function createCanonicalMatchOutcome(
  room: RoomState,
  coreHpBeforeResolution: ReadonlyMap<number, number> = new Map(),
): MatchOutcome | null {
  return determineMatchOutcome(
    createTeamOutcomeSnapshots(room, coreHpBeforeResolution),
  );
}

export function tickRoom(room: RoomState): RoomTickResult {
  const acceptedEvents: BuildEvent[] = [];

  for (const team of room.teams.values()) {
    applyTeamEconomyAndQueue(room, team, acceptedEvents);
  }

  let appliedBuilds = 0;
  for (const event of acceptedEvents) {
    const template = room.templateMap.get(event.templateId);
    const team = room.teams.get(event.teamId);
    if (!template || !team) {
      continue;
    }

    if (applyTemplate(room, template, event.x, event.y)) {
      appliedBuilds += 1;
      team.buildStats.applied += 1;
      appendTimelineEvent(room, {
        teamId: team.id,
        type: 'build-applied',
        metadata: { eventId: event.id },
      });
      continue;
    }

    team.buildStats.rejected += 1;
    appendTimelineEvent(room, {
      teamId: team.id,
      type: 'build-rejected',
      metadata: {
        reason: 'apply-failed',
        eventId: event.id,
      },
    });
  }

  if (room.pendingLegacyUpdates.length > 0) {
    applyUpdates(room.grid, room.pendingLegacyUpdates, room.width, room.height);
    room.pendingLegacyUpdates = [];
  }

  room.grid = stepGrid(room.grid, room.width, room.height);
  room.tick += 1;
  room.generation += 1;

  const coreHpBeforeResolution = resolveCoreRestoreChecks(room);
  const defeatedTeams: number[] = [];
  for (const team of room.teams.values()) {
    const core = getCoreStructure(team);
    const defeated = !core || core.hp <= 0;
    if (defeated && !team.defeated) {
      team.defeated = true;
      team.pendingBuildEvents = [];
      defeatedTeams.push(team.id);
      appendTimelineEvent(room, {
        teamId: team.id,
        type: 'team-defeated',
      });
    }
  }

  const outcome =
    defeatedTeams.length > 0
      ? createCanonicalMatchOutcome(room, coreHpBeforeResolution)
      : null;

  return {
    appliedBuilds,
    defeatedTeams,
    outcome,
  };
}
