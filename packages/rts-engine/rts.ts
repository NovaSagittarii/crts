import type { CellUpdate } from '#conway-core';
import { applyUpdates, createGrid, packGridBits, stepGrid } from '#conway-core';
import {
  determineMatchOutcome,
  type MatchOutcome,
  type TeamOutcomeSnapshot,
} from './match-lifecycle.js';
import {
  BASE_FOOTPRINT_HEIGHT,
  BASE_FOOTPRINT_WIDTH,
  getBaseCenter,
  isCanonicalBaseCell,
  type Vector2,
} from './geometry.js';
import {
  CORE_STARTING_HP,
  DEFAULT_SPAWN_CAPACITY,
  DEFAULT_STARTING_RESOURCES,
  DEFAULT_TEAM_TERRITORY_RADIUS,
  INTEGRITY_CHECK_INTERVAL_TICKS,
  INTEGRITY_HP_COST_PER_CELL,
  MAX_DELAY_TICKS,
  SPAWN_MIN_WRAPPED_DISTANCE,
  STRUCTURE_STARTING_HP,
} from './gameplay-rules.js';
import {
  collectBuildZoneContributors,
  collectIllegalBuildZoneCells,
  type BuildZoneContributor,
  type BuildZoneContributorProjectionInput,
} from './build-zone.js';
import { createTorusSpawnLayout, wrappedDelta } from './spawn.js';
import {
  createIdentityPlacementTransform,
  normalizePlacementTransform,
  projectPlacementToWorld,
  projectTemplateWithTransform,
  wrapCoordinate,
  type PlacementBounds,
  type PlacementTransformInput,
  type PlacementTransformState,
  type TransformedTemplate,
} from './placement-transform.js';

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
  requiresDestroyConfirm?: boolean;
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
  transform?: PlacementTransformInput;
}

export interface DestroyQueuePayload {
  structureKey: string;
  delayTicks?: number;
}

export interface BuildEvent {
  id: number;
  teamId: number;
  playerId: string;
  templateId: string;
  x: number;
  y: number;
  transform: PlacementTransformState;
  executeTick: number;
}

export interface DestroyEvent {
  id: number;
  teamId: number;
  playerId: string;
  structureKey: string;
  executeTick: number;
}

interface AcceptedBuildEvent extends BuildEvent {
  structureKey: string;
  projection: BuildPlacementProjectionResult;
}

export interface StructureInstance {
  key: string;
  templateId: string;
  x: number;
  y: number;
  transform: PlacementTransformState;
  active: boolean;
  hp: number;
  isCore: boolean;
  buildRadius: number;
}

export interface BuildPreviewProjection {
  transform: PlacementTransformState;
  footprint: Vector2[];
  illegalCells: Vector2[];
  bounds: PlacementBounds;
}

export interface StructurePayload {
  key: string;
  templateId: string;
  templateName: string;
  x: number;
  y: number;
  width: number;
  height: number;
  hp: number;
  active: boolean;
  isCore: boolean;
  requiresDestroyConfirm: boolean;
  footprint: Vector2[];
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
    | 'destroy-queued'
    | 'destroy-applied'
    | 'destroy-rejected'
    | 'core-damaged'
    | 'core-destroyed'
    | 'integrity-resolved'
    | 'team-defeated';
  metadata?: Record<string, number | string | boolean>;
}

export type BuildRejectionReason =
  | 'apply-failed'
  | 'insufficient-resources'
  | 'invalid-coordinates'
  | 'invalid-delay'
  | 'match-finished'
  | 'occupied-site'
  | 'outside-territory'
  | 'template-exceeds-map-size'
  | 'team-defeated'
  | 'template-compare-failed'
  | 'unknown-template';

export type DestroyRejectionReason =
  | 'invalid-delay'
  | 'invalid-lifecycle-state'
  | 'invalid-target'
  | 'match-finished'
  | 'team-defeated'
  | 'wrong-owner';

export interface BuildOutcome {
  eventId: number;
  teamId: number;
  outcome: 'applied' | 'rejected';
  reason?: BuildRejectionReason;
  affordable?: boolean;
  needed?: number;
  current?: number;
  deficit?: number;
  executeTick: number;
  resolvedTick: number;
}

export interface DestroyOutcome {
  eventId: number;
  teamId: number;
  structureKey: string;
  templateId: string;
  outcome: 'destroyed' | 'rejected';
  reason?: DestroyRejectionReason;
  executeTick: number;
  resolvedTick: number;
}

export interface AffordabilityResult {
  affordable: boolean;
  needed: number;
  current: number;
  deficit: number;
}

export interface TeamIncomeBreakdown {
  base: number;
  structures: number;
  total: number;
  activeStructureCount: number;
}

export interface PendingBuildPayload {
  eventId: number;
  executeTick: number;
  templateId: string;
  templateName: string;
  x: number;
  y: number;
}

export interface PendingDestroyPayload {
  eventId: number;
  executeTick: number;
  structureKey: string;
  templateId: string;
  templateName: string;
  x: number;
  y: number;
  requiresDestroyConfirm: boolean;
}

export interface TeamState {
  id: number;
  name: string;
  playerIds: Set<string>;
  resources: number;
  income: number;
  incomeBreakdown: TeamIncomeBreakdown;
  lastIncomeTick: number;
  territoryRadius: number;
  baseTopLeft: Vector2;
  defeated: boolean;
  structures: Map<string, StructureInstance>;
  pendingBuildEvents: BuildEvent[];
  pendingDestroyEvents: DestroyEvent[];
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
  incomeBreakdown: TeamIncomeBreakdown;
  pendingBuilds: PendingBuildPayload[];
  pendingDestroys: PendingDestroyPayload[];
  structures: StructurePayload[];
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
  grid: ArrayBuffer; // bit-packed
  teams: TeamPayload[];
}

export interface QueueBuildResult {
  accepted: boolean;
  error?: string;
  reason?: BuildRejectionReason;
  affordable?: boolean;
  needed?: number;
  current?: number;
  deficit?: number;
  eventId?: number;
  executeTick?: number;
  transform?: PlacementTransformState;
  footprint?: Vector2[];
  illegalCells?: Vector2[];
  bounds?: PlacementBounds;
}

export interface QueueDestroyResult {
  accepted: boolean;
  error?: string;
  reason?: DestroyRejectionReason;
  eventId?: number;
  executeTick?: number;
  structureKey?: string;
  idempotent?: boolean;
}

export interface RoomTickResult {
  appliedBuilds: number;
  defeatedTeams: number[];
  outcome: MatchOutcome | null;
  buildOutcomes: BuildOutcome[];
  destroyOutcomes: DestroyOutcome[];
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
  requiresDestroyConfirm?: boolean;
  padding?: number;
  checked?: boolean;
}

const CORE_TEMPLATE_ID = '__core__';

function hashSpawnSeed(roomId: string, width: number, height: number): number {
  let hash = 2166136261;
  const input = `${roomId}:${width}x${height}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

interface PackedGrid {
  width: number;
  height: number;
  cells: Uint8Array;
}

function parseTemplateRows(rows: string[]): PackedGrid {
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

function padTemplate(template: PackedGrid, padding: number): PackedGrid {
  const paddedWidth = template.width + padding * 2;
  const paddedHeight = template.height + padding * 2;
  const paddedCells = new Uint8Array(paddedWidth * paddedHeight);
  for (let i = 0; i < template.height; ++i) {
    for (let j = 0; j < template.width; ++j) {
      paddedCells[(i + padding) * paddedWidth + (j + padding)] =
        template.cells[i * template.width + j];
    }
  }
  return {
    width: paddedWidth,
    height: paddedHeight,
    cells: paddedCells,
  };
}

function createTemplateFromRows({
  id,
  name,
  rows,
  activationCost = 0,
  income = 0,
  requiresDestroyConfirm = false,
  buildArea = 0,
  padding = 0,
  checked = false,
}: StructureTemplateRowsOptions): StructureTemplate {
  const parsed = parseTemplateRows(rows);
  const padded = padTemplate(parsed, padding);
  return {
    id: id,
    name: name,
    width: padded.width,
    height: padded.height,
    cells: padded.cells,
    activationCost: activationCost,
    income: income,
    buildArea: buildArea,
    requiresDestroyConfirm: requiresDestroyConfirm,
    checks: [], // TODO: implement checked and checks
    // checked,
  };
}

export const CORE_STRUCTURE_TEMPLATE = createTemplateFromRows({
  id: CORE_TEMPLATE_ID,
  name: 'Core',
  rows: ['##.##', '##.##', '.....', '##.##', '##.##'],
  buildArea: 0,
  requiresDestroyConfirm: true,
  padding: 3,
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

function evaluateAffordability(
  needed: number,
  current: number,
): AffordabilityResult {
  const deficit = Math.max(0, needed - current);
  return {
    affordable: deficit === 0,
    needed,
    current,
    deficit,
  };
}

function rejectBuild(
  room: RoomState,
  team: TeamState,
  reason: BuildRejectionReason,
  eventId?: number,
  affordability?: AffordabilityResult,
): void {
  const metadata: Record<string, number | string | boolean> = { reason };
  if (eventId !== undefined) {
    metadata.eventId = eventId;
  }
  if (affordability) {
    metadata.affordable = affordability.affordable;
    metadata.needed = affordability.needed;
    metadata.current = affordability.current;
    metadata.deficit = affordability.deficit;
  }

  team.buildStats.rejected += 1;
  appendTimelineEvent(room, {
    teamId: team.id,
    type: 'build-rejected',
    metadata,
  });
}

function rejectDestroy(
  room: RoomState,
  team: TeamState,
  reason: DestroyRejectionReason,
  eventId?: number,
  structureKey?: string,
): void {
  const metadata: Record<string, number | string | boolean> = { reason };
  if (eventId !== undefined) {
    metadata.eventId = eventId;
  }
  if (structureKey) {
    metadata.structureKey = structureKey;
  }

  appendTimelineEvent(room, {
    teamId: team.id,
    type: 'destroy-rejected',
    metadata,
  });
}

function insertBuildEventSorted(queue: BuildEvent[], event: BuildEvent): void {
  const compare = compareBuildEvents;
  let insertIndex = queue.length;
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (compare(queue[index], event) <= 0) {
      break;
    }
    insertIndex = index;
  }

  queue.splice(insertIndex, 0, event);
}

function insertDestroyEventSorted(
  queue: DestroyEvent[],
  event: DestroyEvent,
): void {
  const compare = compareDestroyEvents;
  let insertIndex = queue.length;
  for (let index = queue.length - 1; index >= 0; index -= 1) {
    if (compare(queue[index], event) <= 0) {
      break;
    }
    insertIndex = index;
  }

  queue.splice(insertIndex, 0, event);
}

function compareBuildEvents(a: BuildEvent, b: BuildEvent): number {
  return a.executeTick - b.executeTick || a.id - b.id;
}

function compareDestroyEvents(a: DestroyEvent, b: DestroyEvent): number {
  return a.executeTick - b.executeTick || a.id - b.id;
}

function compareBuildOutcomes(a: BuildOutcome, b: BuildOutcome): number {
  return a.executeTick - b.executeTick || a.eventId - b.eventId;
}

function compareDestroyOutcomes(a: DestroyOutcome, b: DestroyOutcome): number {
  return a.executeTick - b.executeTick || a.eventId - b.eventId;
}

function projectPendingBuilds(
  room: RoomState,
  team: TeamState,
): PendingBuildPayload[] {
  const pending = [...team.pendingBuildEvents];
  pending.sort(compareBuildEvents);
  return pending.map((event) => {
    const templateName = room.templateMap.get(event.templateId)?.name;
    return {
      eventId: event.id,
      executeTick: event.executeTick,
      templateId: event.templateId,
      templateName: templateName ?? event.templateId,
      x: event.x,
      y: event.y,
    };
  });
}

function projectPendingDestroys(
  room: RoomState,
  team: TeamState,
): PendingDestroyPayload[] {
  const pending = [...team.pendingDestroyEvents];
  pending.sort(compareDestroyEvents);
  return pending.map((event) => {
    const structure = team.structures.get(event.structureKey);
    const template = structure ? getStructureTemplate(room, structure) : null;

    return {
      eventId: event.id,
      executeTick: event.executeTick,
      structureKey: event.structureKey,
      templateId: structure?.templateId ?? 'unknown',
      templateName: template?.name ?? structure?.templateId ?? 'Unknown',
      x: structure?.x ?? 0,
      y: structure?.y ?? 0,
      requiresDestroyConfirm: Boolean(template?.requiresDestroyConfirm),
    };
  });
}

function projectStructures(
  room: RoomState,
  team: TeamState,
): StructurePayload[] {
  const orderedStructures = [...team.structures.values()].sort(
    compareStructuresByKey,
  );
  const projected: StructurePayload[] = [];

  for (const structure of orderedStructures) {
    if (structure.hp <= 0) {
      continue;
    }

    const template = getStructureTemplate(room, structure);
    if (!template) {
      continue;
    }

    const transformedTemplate = projectTemplateWithTransform(
      template,
      structure.transform,
    );
    const projection = projectPlacementToWorld(
      transformedTemplate,
      structure.x,
      structure.y,
      room.width,
      room.height,
    );

    projected.push({
      key: structure.key,
      templateId: structure.templateId,
      templateName: template.name,
      x: structure.x,
      y: structure.y,
      width: transformedTemplate.width,
      height: transformedTemplate.height,
      hp: structure.hp,
      active: structure.active,
      isCore: structure.isCore,
      requiresDestroyConfirm: Boolean(template.requiresDestroyConfirm),
      footprint: projection.occupiedCells,
    });
  }

  return projected;
}

function recordRejectedBuildOutcome(
  buildOutcomes: BuildOutcome[],
  event: BuildEvent,
  reason: BuildRejectionReason,
  resolvedTick: number,
  affordability?: AffordabilityResult,
): void {
  const outcome: BuildOutcome = {
    eventId: event.id,
    teamId: event.teamId,
    outcome: 'rejected',
    reason,
    executeTick: event.executeTick,
    resolvedTick,
  };

  if (affordability) {
    outcome.affordable = affordability.affordable;
    outcome.needed = affordability.needed;
    outcome.current = affordability.current;
    outcome.deficit = affordability.deficit;
  }

  buildOutcomes.push(outcome);
}

function recordRejectedDestroyOutcome(
  destroyOutcomes: DestroyOutcome[],
  event: DestroyEvent,
  reason: DestroyRejectionReason,
  resolvedTick: number,
  templateId = 'unknown',
): void {
  destroyOutcomes.push({
    eventId: event.id,
    teamId: event.teamId,
    structureKey: event.structureKey,
    templateId,
    outcome: 'rejected',
    reason,
    executeTick: event.executeTick,
    resolvedTick,
  });
}

function drainPendingBuildEvents(
  room: RoomState,
  teams: TeamState[],
  reason: BuildRejectionReason,
  resolvedTick: number,
  buildOutcomes: BuildOutcome[],
): void {
  const pendingEvents: BuildEvent[] = [];
  for (const team of teams) {
    pendingEvents.push(...team.pendingBuildEvents);
    team.pendingBuildEvents = [];
  }

  pendingEvents.sort(compareBuildEvents);

  for (const event of pendingEvents) {
    const team = room.teams.get(event.teamId);
    if (!team) {
      continue;
    }

    rejectBuild(room, team, reason, event.id);
    recordRejectedBuildOutcome(buildOutcomes, event, reason, resolvedTick);
  }
}

function drainPendingDestroyEvents(
  room: RoomState,
  teams: TeamState[],
  reason: DestroyRejectionReason,
  resolvedTick: number,
  destroyOutcomes: DestroyOutcome[],
): void {
  const pendingEvents: DestroyEvent[] = [];
  for (const team of teams) {
    pendingEvents.push(...team.pendingDestroyEvents);
    team.pendingDestroyEvents = [];
  }

  pendingEvents.sort(compareDestroyEvents);

  for (const event of pendingEvents) {
    const team = room.teams.get(event.teamId);
    if (!team) {
      continue;
    }

    const target = team.structures.get(event.structureKey);
    rejectDestroy(room, team, reason, event.id, event.structureKey);
    recordRejectedDestroyOutcome(
      destroyOutcomes,
      event,
      reason,
      resolvedTick,
      target?.templateId ?? 'unknown',
    );
  }
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

function findStructureOwnerTeam(
  room: RoomState,
  structureKey: string,
): TeamState | null {
  for (const team of room.teams.values()) {
    if (team.structures.has(structureKey)) {
      return team;
    }
  }

  return null;
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

function transformedTemplateFitsRoom(
  room: RoomState,
  transformedTemplate: Pick<TransformedTemplate, 'width' | 'height'>,
): boolean {
  return (
    transformedTemplate.width <= room.width &&
    transformedTemplate.height <= room.height
  );
}

function createStructureKey(
  x: number,
  y: number,
  width: number,
  height: number,
): string {
  return `${x},${y},${width},${height}`;
}

function collectTeamBuildZoneContributors(
  room: RoomState,
  team: TeamState,
): BuildZoneContributor[] {
  const contributorProjectionInputs: BuildZoneContributorProjectionInput[] = [];
  const orderedStructures = [...team.structures.values()].sort(
    compareStructuresByKey,
  );

  for (const structure of orderedStructures) {
    if (structure.hp <= 0) {
      continue;
    }

    const template = getStructureTemplate(room, structure);
    if (!template) {
      continue;
    }

    const transformedTemplate = projectTemplateWithTransform(
      template,
      structure.transform,
    );

    contributorProjectionInputs.push({
      x: structure.x,
      y: structure.y,
      width: transformedTemplate.width,
      height: transformedTemplate.height,
      hp: structure.hp,
    });
  }

  return collectBuildZoneContributors(contributorProjectionInputs);
}

interface BuildPlacementProjectionResult {
  transform: PlacementTransformState;
  transformedTemplate: TransformedTemplate;
  bounds: PlacementBounds;
  areaCells: Vector2[];
  footprint: Vector2[];
  checks: Vector2[];
  illegalCells: Vector2[];
}

interface BuildPlacementValidationResult {
  projection: BuildPlacementProjectionResult;
  reason?: BuildRejectionReason;
}

function projectBuildPlacement(
  room: RoomState,
  team: TeamState,
  template: StructureTemplate,
  x: number,
  y: number,
  transformInput: PlacementTransformInput | null | undefined,
): BuildPlacementValidationResult {
  const transform = normalizePlacementTransform(transformInput);
  const transformedTemplate = projectTemplateWithTransform(template, transform);
  const bounds: PlacementBounds = {
    x,
    y,
    width: transformedTemplate.width,
    height: transformedTemplate.height,
  };

  if (!transformedTemplateFitsRoom(room, transformedTemplate)) {
    return {
      projection: {
        transform,
        transformedTemplate,
        bounds,
        areaCells: [],
        footprint: [],
        checks: [],
        illegalCells: [],
      },
      reason: 'template-exceeds-map-size',
    };
  }

  const projected = projectPlacementToWorld(
    transformedTemplate,
    x,
    y,
    room.width,
    room.height,
  );
  const illegalCells = collectIllegalBuildZoneCells(
    projected.areaCells,
    collectTeamBuildZoneContributors(room, team),
  );

  return {
    projection: {
      transform,
      transformedTemplate,
      bounds,
      areaCells: projected.areaCells,
      footprint: projected.occupiedCells,
      checks: projected.checks,
      illegalCells,
    },
    reason: illegalCells.length > 0 ? 'outside-territory' : undefined,
  };
}

function compareTemplate(
  room: RoomState,
  transformedTemplate: TransformedTemplate,
  bounds: PlacementBounds,
): number {
  let diffCount = 0;
  for (let ty = 0; ty < transformedTemplate.height; ty += 1) {
    for (let tx = 0; tx < transformedTemplate.width; tx += 1) {
      const templateCell =
        transformedTemplate.cells[ty * transformedTemplate.width + tx];
      const roomCell = gridCellAt(
        room.grid,
        room.width,
        room.height,
        wrapCoordinate(bounds.x + tx, room.width),
        wrapCoordinate(bounds.y + ty, room.height),
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
  transformedTemplate: TransformedTemplate,
  bounds: PlacementBounds,
): boolean {
  for (let ty = 0; ty < transformedTemplate.height; ty += 1) {
    for (let tx = 0; tx < transformedTemplate.width; tx += 1) {
      setGridCell(
        room.grid,
        room.width,
        room.height,
        wrapCoordinate(bounds.x + tx, room.width),
        wrapCoordinate(bounds.y + ty, room.height),
        transformedTemplate.cells[ty * transformedTemplate.width + tx],
      );
    }
  }

  return true;
}

interface IntegrityMaskCell {
  x: number;
  y: number;
  expected: number;
}

interface IntegrityMismatchCell {
  x: number;
  y: number;
  expected: number;
}

function getIntegrityMaskCells(
  structure: StructureInstance,
  template: StructureTemplate,
): readonly IntegrityMaskCell[] {
  const transformedTemplate = projectTemplateWithTransform(
    template,
    structure.transform,
  );

  const sourceChecks =
    template.checks.length > 0
      ? transformedTemplate.checks
      : transformedTemplate.occupiedCells;

  const mask: IntegrityMaskCell[] = [];
  for (const check of sourceChecks) {
    mask.push({
      x: check.x,
      y: check.y,
      expected:
        transformedTemplate.cells[
          check.y * transformedTemplate.width + check.x
        ],
    });
  }

  return mask;
}

function collectIntegrityMismatches(
  room: RoomState,
  structure: StructureInstance,
  template: StructureTemplate,
): IntegrityMismatchCell[] {
  const mismatches: IntegrityMismatchCell[] = [];

  for (const check of getIntegrityMaskCells(structure, template)) {
    const x = wrapCoordinate(structure.x + check.x, room.width);
    const y = wrapCoordinate(structure.y + check.y, room.height);
    const actual = gridCellAt(room.grid, room.width, room.height, x, y);
    if (actual !== check.expected) {
      mismatches.push({ x, y, expected: check.expected });
    }
  }

  return mismatches;
}

function restoreIntegrityMismatches(
  room: RoomState,
  mismatches: readonly IntegrityMismatchCell[],
): void {
  for (const mismatch of mismatches) {
    setGridCell(
      room.grid,
      room.width,
      room.height,
      mismatch.x,
      mismatch.y,
      mismatch.expected,
    );
  }
}

function checkStructureIntegrity(
  room: RoomState,
  structure: StructureInstance,
  template: StructureTemplate,
): boolean {
  return collectIntegrityMismatches(room, structure, template).length === 0;
}

function isBaseIntact(room: RoomState, team: TeamState): boolean {
  const core = getCoreStructure(team);
  if (!core || core.hp <= 0) {
    return false;
  }

  return checkStructureIntegrity(room, core, CORE_STRUCTURE_TEMPLATE);
}

function countTerritoryCells(room: RoomState, team: TeamState): number {
  const center = getBaseCenter(team.baseTopLeft);
  const radius = team.territoryRadius;

  let count = 0;
  for (
    let y = Math.max(0, center.y - radius);
    y <= Math.min(room.height - 1, center.y + radius);
    y += 1
  ) {
    for (
      let x = Math.max(0, center.x - radius);
      x <= Math.min(room.width - 1, center.x + radius);
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
  for (let by = 0; by < BASE_FOOTPRINT_HEIGHT; by += 1) {
    for (let bx = 0; bx < BASE_FOOTPRINT_WIDTH; bx += 1) {
      if (!isCanonicalBaseCell(bx, by)) {
        continue;
      }

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

function hasSpawnSeparation(
  room: RoomState,
  candidate: Vector2,
  occupied: readonly Vector2[],
): boolean {
  for (const current of occupied) {
    if (candidate.x === current.x && candidate.y === current.y) {
      return false;
    }

    const dx = wrappedDelta(
      candidate.x + BASE_FOOTPRINT_WIDTH / 2,
      current.x + BASE_FOOTPRINT_WIDTH / 2,
      room.width,
    );
    const dy = wrappedDelta(
      candidate.y + BASE_FOOTPRINT_HEIGHT / 2,
      current.y + BASE_FOOTPRINT_HEIGHT / 2,
      room.height,
    );
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < SPAWN_MIN_WRAPPED_DISTANCE) {
      return false;
    }
  }

  return true;
}

function greatestCommonDivisor(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);

  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }

  return left;
}

function pickDeterministicFallbackSpawn(
  room: RoomState,
  teamId: number,
  occupied: readonly Vector2[],
): Vector2 {
  const spanX = room.width - BASE_FOOTPRINT_WIDTH + 1;
  const spanY = room.height - BASE_FOOTPRINT_HEIGHT + 1;
  if (spanX <= 0 || spanY <= 0) {
    throw new Error('Spawn footprint does not fit in room bounds');
  }

  const totalPositions = spanX * spanY;
  const seed =
    (room.spawnOrientationSeed ^ Math.imul(teamId + 1, 0x9e37_79b1)) >>> 0;
  const start = seed % totalPositions;

  let step = seed % totalPositions || 1;
  while (greatestCommonDivisor(step, totalPositions) !== 1) {
    step = (step + 1) % totalPositions;
    if (step === 0) {
      step = 1;
    }
  }

  let firstUnoccupied: Vector2 | null = null;
  for (let offset = 0; offset < totalPositions; offset += 1) {
    const index = (start + offset * step) % totalPositions;
    const candidate = {
      x: index % spanX,
      y: Math.floor(index / spanX),
    };

    const occupiedTopLeft = occupied.some(
      (position) => position.x === candidate.x && position.y === candidate.y,
    );
    if (occupiedTopLeft) {
      continue;
    }

    if (!firstUnoccupied) {
      firstUnoccupied = candidate;
    }
    if (hasSpawnSeparation(room, candidate, occupied)) {
      return candidate;
    }
  }

  if (firstUnoccupied) {
    return firstUnoccupied;
  }

  throw new Error('Unable to allocate deterministic spawn position');
}

function pickSpawnPosition(room: RoomState, teamId: number): Vector2 {
  const occupied = [...room.teams.values()].map((team) => team.baseTopLeft);

  const preferredCapacity = Math.max(
    DEFAULT_SPAWN_CAPACITY,
    room.teams.size + 1,
    teamId,
  );

  for (let expansion = 0; expansion <= 6; expansion += 1) {
    let layout;
    try {
      layout = createTorusSpawnLayout({
        width: room.width,
        height: room.height,
        teamCount: preferredCapacity + expansion,
        orientationSeed: room.spawnOrientationSeed,
        baseWidth: BASE_FOOTPRINT_WIDTH,
        baseHeight: BASE_FOOTPRINT_HEIGHT,
        minWrappedDistance: SPAWN_MIN_WRAPPED_DISTANCE,
      });
    } catch {
      continue;
    }

    const startIndex = (teamId - 1) % layout.length;
    for (let offset = 0; offset < layout.length; offset += 1) {
      const candidate = layout[(startIndex + offset) % layout.length].topLeft;
      if (!hasSpawnSeparation(room, candidate, occupied)) {
        continue;
      }

      return candidate;
    }
  }

  return pickDeterministicFallbackSpawn(room, teamId, occupied);
}

interface EvaluatedBuildPlacement {
  projection: BuildPlacementProjectionResult;
  affordability?: AffordabilityResult;
  diffCells?: number;
  reason?: BuildRejectionReason;
}

function createEmptyBuildProjection(
  x: number,
  y: number,
  transformInput: PlacementTransformInput | null | undefined,
): BuildPreviewProjection {
  const safeX = Number.isFinite(x) ? x : 0;
  const safeY = Number.isFinite(y) ? y : 0;
  return {
    transform: normalizePlacementTransform(transformInput),
    footprint: [],
    illegalCells: [],
    bounds: {
      x: safeX,
      y: safeY,
      width: 0,
      height: 0,
    },
  };
}

function evaluateBuildPlacement(
  room: RoomState,
  team: TeamState,
  template: StructureTemplate,
  x: number,
  y: number,
  transformInput: PlacementTransformInput | null | undefined,
): EvaluatedBuildPlacement {
  const projectedPlacement = projectBuildPlacement(
    room,
    team,
    template,
    x,
    y,
    transformInput,
  );

  if (projectedPlacement.reason) {
    return {
      projection: projectedPlacement.projection,
      reason: projectedPlacement.reason,
    };
  }

  let diffCells: number;
  try {
    diffCells = compareTemplate(
      room,
      projectedPlacement.projection.transformedTemplate,
      projectedPlacement.projection.bounds,
    );
  } catch {
    return {
      projection: projectedPlacement.projection,
      reason: 'template-compare-failed',
    };
  }

  const needed = diffCells + template.activationCost;
  const affordability = evaluateAffordability(needed, team.resources);

  if (!affordability.affordable) {
    return {
      projection: projectedPlacement.projection,
      diffCells,
      affordability,
      reason: 'insufficient-resources',
    };
  }

  return {
    projection: projectedPlacement.projection,
    diffCells,
    affordability,
  };
}

export function previewBuildPlacement(
  room: RoomState,
  playerId: string,
  payload: BuildQueuePayload,
): QueueBuildResult {
  const x = Number(payload.x);
  const y = Number(payload.y);

  const player = room.players.get(playerId);
  if (!player) {
    return {
      accepted: false,
      error: 'Player is not in this room',
      ...createEmptyBuildProjection(x, y, payload.transform),
    };
  }

  const team = room.teams.get(player.teamId);
  if (!team) {
    return {
      accepted: false,
      error: 'Team is not available',
      ...createEmptyBuildProjection(x, y, payload.transform),
    };
  }

  if (team.defeated) {
    return {
      accepted: false,
      error: 'Team is defeated',
      reason: 'team-defeated',
      ...createEmptyBuildProjection(x, y, payload.transform),
      affordable: false,
      needed: 0,
      current: team.resources,
      deficit: 0,
    };
  }

  const template = room.templateMap.get(payload.templateId);
  if (!template) {
    return {
      accepted: false,
      error: 'Unknown template',
      reason: 'unknown-template',
      ...createEmptyBuildProjection(x, y, payload.transform),
      affordable: false,
      needed: 0,
      current: team.resources,
      deficit: 0,
    };
  }

  if (!Number.isInteger(x) || !Number.isInteger(y)) {
    return {
      accepted: false,
      error: 'x and y must be integers',
      reason: 'invalid-coordinates',
      ...createEmptyBuildProjection(x, y, payload.transform),
      affordable: false,
      needed: 0,
      current: team.resources,
      deficit: 0,
    };
  }

  const evaluation = evaluateBuildPlacement(
    room,
    team,
    template,
    x,
    y,
    payload.transform,
  );

  const result: QueueBuildResult = {
    accepted: evaluation.reason === undefined,
    reason: evaluation.reason,
    transform: evaluation.projection.transform,
    footprint: evaluation.projection.footprint,
    illegalCells: evaluation.projection.illegalCells,
    bounds: evaluation.projection.bounds,
    affordable: evaluation.affordability?.affordable ?? false,
    needed: evaluation.affordability?.needed ?? 0,
    current: evaluation.affordability?.current ?? team.resources,
    deficit: evaluation.affordability?.deficit ?? 0,
  };

  if (evaluation.reason === 'outside-territory') {
    result.error = 'Outside build zone - build closer to your structures.';
  } else if (evaluation.reason === 'template-exceeds-map-size') {
    result.error = 'Template exceeds map size';
  } else if (evaluation.reason === 'insufficient-resources') {
    result.error = 'Insufficient resources';
  } else if (evaluation.reason === 'template-compare-failed') {
    result.error = 'Unable to compare template with current state';
  }

  return result;
}

function applyTeamEconomyAndQueue(
  room: RoomState,
  team: TeamState,
  acceptedEvents: AcceptedBuildEvent[],
  buildOutcomes: BuildOutcome[],
  destroyOutcomes: DestroyOutcome[],
): void {
  if (team.defeated) {
    team.income = 0;
    team.incomeBreakdown = {
      base: 0,
      structures: 0,
      total: 0,
      activeStructureCount: 0,
    };
    return;
  }

  const baseIncome = 0;
  let structureIncome = 0;
  let activeStructureCount = 0;
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
      structureIncome += template.income;
      activeStructureCount += 1;
      territoryBonus += structure.buildRadius;
    }
  }

  team.incomeBreakdown = {
    base: baseIncome,
    structures: structureIncome,
    total: baseIncome + structureIncome,
    activeStructureCount,
  };
  team.income = team.incomeBreakdown.total;
  team.territoryRadius = DEFAULT_TEAM_TERRITORY_RADIUS + territoryBonus;

  if (room.tick > team.lastIncomeTick) {
    const elapsed = room.tick - team.lastIncomeTick;
    team.resources += elapsed * team.income;
    team.lastIncomeTick = room.tick;
  }

  const deferredDestroys: DestroyEvent[] = [];
  for (const event of team.pendingDestroyEvents) {
    if (event.executeTick > room.tick) {
      deferredDestroys.push(event);
      continue;
    }

    const structure = team.structures.get(event.structureKey);
    if (!structure) {
      rejectDestroy(room, team, 'invalid-target', event.id, event.structureKey);
      recordRejectedDestroyOutcome(
        destroyOutcomes,
        event,
        'invalid-target',
        room.tick,
      );
      continue;
    }

    if (structure.hp <= 0) {
      rejectDestroy(
        room,
        team,
        'invalid-lifecycle-state',
        event.id,
        event.structureKey,
      );
      recordRejectedDestroyOutcome(
        destroyOutcomes,
        event,
        'invalid-lifecycle-state',
        room.tick,
        structure.templateId,
      );
      continue;
    }

    structure.hp = 0;
    structure.active = false;
    structure.buildRadius = 0;

    appendTimelineEvent(room, {
      teamId: team.id,
      type: 'destroy-applied',
      metadata: {
        eventId: event.id,
        structureKey: event.structureKey,
        templateId: structure.templateId,
        isCore: structure.isCore,
      },
    });

    destroyOutcomes.push({
      eventId: event.id,
      teamId: team.id,
      structureKey: event.structureKey,
      templateId: structure.templateId,
      outcome: 'destroyed',
      executeTick: event.executeTick,
      resolvedTick: room.tick,
    });
  }

  team.pendingDestroyEvents = deferredDestroys;

  const deferred: BuildEvent[] = [];
  for (const event of team.pendingBuildEvents) {
    if (event.executeTick > room.tick) {
      deferred.push(event);
      continue;
    }

    const template = room.templateMap.get(event.templateId);
    if (!template) {
      rejectBuild(room, team, 'unknown-template', event.id);
      recordRejectedBuildOutcome(
        buildOutcomes,
        event,
        'unknown-template',
        room.tick,
      );
      continue;
    }

    const evaluation = evaluateBuildPlacement(
      room,
      team,
      template,
      event.x,
      event.y,
      event.transform,
    );
    if (evaluation.reason && evaluation.reason !== 'insufficient-resources') {
      rejectBuild(room, team, evaluation.reason, event.id);
      recordRejectedBuildOutcome(
        buildOutcomes,
        event,
        evaluation.reason,
        room.tick,
      );
      continue;
    }

    const key = createStructureKey(
      event.x,
      event.y,
      evaluation.projection.bounds.width,
      evaluation.projection.bounds.height,
    );
    const isReservedInTick = acceptedEvents.some((candidate) => {
      return candidate.teamId === team.id && candidate.structureKey === key;
    });
    if (team.structures.has(key) || isReservedInTick) {
      rejectBuild(room, team, 'occupied-site', event.id);
      recordRejectedBuildOutcome(
        buildOutcomes,
        event,
        'occupied-site',
        room.tick,
      );
      continue;
    }

    const affordability = evaluation.affordability;
    if (!affordability || !affordability.affordable) {
      rejectBuild(
        room,
        team,
        'insufficient-resources',
        event.id,
        affordability,
      );
      recordRejectedBuildOutcome(
        buildOutcomes,
        event,
        'insufficient-resources',
        room.tick,
        affordability,
      );
      continue;
    }

    team.resources -= affordability.needed;
    acceptedEvents.push({
      ...event,
      structureKey: key,
      projection: evaluation.projection,
    });
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
    }),
    createTemplateFromRows({
      id: 'generator',
      name: 'Generator Block',
      rows: ['##', '##'],
      activationCost: 6,
      income: 2,
      buildArea: 2,
      padding: 1,
      checked: true,
    }),
    createTemplateFromRows({
      id: 'glider',
      name: 'Glider',
      rows: ['.#.', '..#', '###'],
      activationCost: 2,
      income: 0,
      buildArea: 0,
    }),
    createTemplateFromRows({
      id: 'eater-1',
      name: 'Eater 1',
      rows: ['##..', '#.##', '.###', '..#.'],
      activationCost: 4,
      income: 0,
      buildArea: 1,
    }),
    createTemplateFromRows({
      id: 'gosper',
      name: 'Gosper glider gun',
      rows: [
        '........................#...........',
        '......................#.#...........',
        '............##......##............##',
        '...........#...#....##............##',
        '##........#.....#...##..............',
        '##........#...#.##....#.#...........',
        '..........#.....#.......#...........',
        '...........#...#....................',
        '............##......................',
      ],
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
    baseTopLeft.x,
    baseTopLeft.y,
    CORE_STRUCTURE_TEMPLATE.width,
    CORE_STRUCTURE_TEMPLATE.height,
  );

  const structures = new Map<string, StructureInstance>();
  structures.set(coreKey, {
    key: coreKey,
    templateId: CORE_TEMPLATE_ID,
    x: baseTopLeft.x,
    y: baseTopLeft.y,
    transform: createIdentityPlacementTransform(),
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
    incomeBreakdown: {
      base: 0,
      structures: 0,
      total: 0,
      activeStructureCount: 0,
    },
    lastIncomeTick: room.tick,
    territoryRadius: DEFAULT_TEAM_TERRITORY_RADIUS,
    baseTopLeft,
    defeated: false,
    structures,
    pendingBuildEvents: [],
    pendingDestroyEvents: [],
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

  const preview = previewBuildPlacement(room, playerId, payload);
  if (!preview.accepted) {
    if (preview.reason) {
      const affordability =
        preview.reason === 'insufficient-resources' &&
        typeof preview.needed === 'number' &&
        typeof preview.current === 'number' &&
        typeof preview.deficit === 'number'
          ? {
              affordable: false,
              needed: preview.needed,
              current: preview.current,
              deficit: preview.deficit,
            }
          : undefined;

      rejectBuild(room, team, preview.reason, undefined, affordability);
    }
    return preview;
  }

  const delay = Number(payload.delayTicks ?? 2);
  if (!Number.isInteger(delay)) {
    rejectBuild(room, team, 'invalid-delay');
    return {
      ...preview,
      accepted: false,
      error: 'delayTicks must be an integer',
      reason: 'invalid-delay',
    };
  }

  const clampedDelay = Math.max(1, Math.min(MAX_DELAY_TICKS, delay));
  const x = Number(payload.x);
  const y = Number(payload.y);
  const event: BuildEvent = {
    id: room.nextBuildEventId,
    teamId: team.id,
    playerId,
    templateId: payload.templateId,
    x,
    y,
    transform: preview.transform ?? createIdentityPlacementTransform(),
    executeTick: room.tick + clampedDelay,
  };
  room.nextBuildEventId += 1;

  insertBuildEventSorted(team.pendingBuildEvents, event);
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
    ...preview,
    accepted: true,
    eventId: event.id,
    executeTick: event.executeTick,
  };
}

export function queueDestroyEvent(
  room: RoomState,
  playerId: string,
  payload: DestroyQueuePayload,
): QueueDestroyResult {
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
    rejectDestroy(room, team, 'team-defeated');
    return {
      accepted: false,
      error: 'Team is defeated',
      reason: 'team-defeated',
    };
  }

  const structureKey =
    typeof payload.structureKey === 'string' ? payload.structureKey.trim() : '';
  if (!structureKey) {
    rejectDestroy(room, team, 'invalid-target');
    return {
      accepted: false,
      error: 'Invalid structure target',
      reason: 'invalid-target',
    };
  }

  const duplicate = team.pendingDestroyEvents.find(
    (event) => event.structureKey === structureKey,
  );
  if (duplicate) {
    return {
      accepted: true,
      eventId: duplicate.id,
      executeTick: duplicate.executeTick,
      structureKey,
      idempotent: true,
    };
  }

  const ownerTeam = findStructureOwnerTeam(room, structureKey);
  if (!ownerTeam) {
    rejectDestroy(room, team, 'invalid-target', undefined, structureKey);
    return {
      accepted: false,
      error: 'Target structure does not exist',
      reason: 'invalid-target',
      structureKey,
    };
  }

  if (ownerTeam.id !== team.id) {
    rejectDestroy(room, team, 'wrong-owner', undefined, structureKey);
    return {
      accepted: false,
      error: 'Cannot destroy structures owned by another team',
      reason: 'wrong-owner',
      structureKey,
    };
  }

  const structure = ownerTeam.structures.get(structureKey);
  if (!structure || structure.hp <= 0) {
    rejectDestroy(
      room,
      team,
      'invalid-lifecycle-state',
      undefined,
      structureKey,
    );
    return {
      accepted: false,
      error: 'Target structure is not destroyable',
      reason: 'invalid-lifecycle-state',
      structureKey,
    };
  }

  const delay = Number(payload.delayTicks ?? 1);
  if (!Number.isInteger(delay)) {
    rejectDestroy(room, team, 'invalid-delay', undefined, structureKey);
    return {
      accepted: false,
      error: 'delayTicks must be an integer',
      reason: 'invalid-delay',
      structureKey,
    };
  }

  const clampedDelay = Math.max(1, Math.min(MAX_DELAY_TICKS, delay));
  const event: DestroyEvent = {
    id: room.nextBuildEventId,
    teamId: team.id,
    playerId,
    structureKey,
    executeTick: room.tick + clampedDelay,
  };
  room.nextBuildEventId += 1;

  insertDestroyEventSorted(team.pendingDestroyEvents, event);
  appendTimelineEvent(room, {
    teamId: team.id,
    type: 'destroy-queued',
    metadata: {
      eventId: event.id,
      executeTick: event.executeTick,
      structureKey,
    },
  });

  return {
    accepted: true,
    eventId: event.id,
    executeTick: event.executeTick,
    structureKey,
    idempotent: false,
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
      incomeBreakdown: {
        base: team.incomeBreakdown.base,
        structures: team.incomeBreakdown.structures,
        total: team.incomeBreakdown.total,
        activeStructureCount: team.incomeBreakdown.activeStructureCount,
      },
      pendingBuilds: projectPendingBuilds(room, team),
      pendingDestroys: projectPendingDestroys(room, team),
      structures: projectStructures(room, team),
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
    grid: packGridBits(room.grid, room.width, room.height),
    teams,
  };
}

type IntegrityOutcomeCategory = 'repaired' | 'destroyed-debris' | 'core-defeat';

function compareStructuresByKey(
  left: StructureInstance,
  right: StructureInstance,
): number {
  if (left.key < right.key) {
    return -1;
  }
  if (left.key > right.key) {
    return 1;
  }
  return 0;
}

function resolveIntegrityChecks(room: RoomState): Map<number, number> {
  const coreHpBeforeResolution = new Map<number, number>();

  if (
    INTEGRITY_CHECK_INTERVAL_TICKS <= 0 ||
    room.tick % INTEGRITY_CHECK_INTERVAL_TICKS !== 0
  ) {
    return coreHpBeforeResolution;
  }

  const orderedTeams = [...room.teams.values()].sort((left, right) => {
    return left.id - right.id;
  });

  for (const team of orderedTeams) {
    if (team.defeated) {
      continue;
    }

    const orderedStructures = [...team.structures.values()].sort(
      compareStructuresByKey,
    );

    for (const structure of orderedStructures) {
      if (structure.hp <= 0) {
        structure.active = false;
        structure.buildRadius = 0;
        continue;
      }

      const template = getStructureTemplate(room, structure);
      if (!template) {
        structure.active = false;
        structure.buildRadius = 0;
        continue;
      }

      const mismatches = collectIntegrityMismatches(room, structure, template);
      if (mismatches.length === 0) {
        structure.active = true;
        structure.buildRadius = structure.isCore ? 0 : template.buildArea;
        continue;
      }

      const restoreCost = mismatches.length * INTEGRITY_HP_COST_PER_CELL;
      const hpBefore = structure.hp;

      if (structure.isCore && !coreHpBeforeResolution.has(team.id)) {
        coreHpBeforeResolution.set(team.id, hpBefore);
      }

      structure.hp -= restoreCost;
      if (structure.isCore) {
        appendTimelineEvent(room, {
          teamId: team.id,
          type: 'core-damaged',
          metadata: {
            hpBefore,
            hpAfter: structure.hp,
            restoreCost,
          },
        });
      }

      if (structure.hp > 0) {
        restoreIntegrityMismatches(room, mismatches);
        structure.active = true;
        structure.buildRadius = structure.isCore ? 0 : template.buildArea;

        appendTimelineEvent(room, {
          teamId: team.id,
          type: 'integrity-resolved',
          metadata: {
            structureKey: structure.key,
            category: 'repaired',
            restoreCost,
            hpBefore,
            hpAfter: structure.hp,
            isCore: structure.isCore,
          },
        });
        continue;
      }

      structure.active = false;
      structure.buildRadius = 0;

      const category: IntegrityOutcomeCategory = structure.isCore
        ? 'core-defeat'
        : 'destroyed-debris';

      appendTimelineEvent(room, {
        teamId: team.id,
        type: 'integrity-resolved',
        metadata: {
          structureKey: structure.key,
          category,
          restoreCost,
          hpBefore,
          hpAfter: structure.hp,
          isCore: structure.isCore,
        },
      });

      if (structure.isCore) {
        appendTimelineEvent(room, {
          teamId: team.id,
          type: 'core-destroyed',
          metadata: {
            hpBefore,
            hpAfter: structure.hp,
            restoreCost,
          },
        });
      }
    }
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
  const acceptedEvents: AcceptedBuildEvent[] = [];
  const buildOutcomes: BuildOutcome[] = [];
  const destroyOutcomes: DestroyOutcome[] = [];

  for (const team of room.teams.values()) {
    applyTeamEconomyAndQueue(
      room,
      team,
      acceptedEvents,
      buildOutcomes,
      destroyOutcomes,
    );
  }

  acceptedEvents.sort(compareBuildEvents);

  let appliedBuilds = 0;
  for (const event of acceptedEvents) {
    const template = room.templateMap.get(event.templateId);
    const team = room.teams.get(event.teamId);
    if (!template || !team) {
      continue;
    }

    if (
      applyTemplate(
        room,
        event.projection.transformedTemplate,
        event.projection.bounds,
      )
    ) {
      team.structures.set(event.structureKey, {
        key: event.structureKey,
        templateId: template.id,
        x: event.x,
        y: event.y,
        transform: event.projection.transform,
        active: false,
        hp: STRUCTURE_STARTING_HP,
        isCore: false,
        buildRadius: 0,
      });

      appliedBuilds += 1;
      team.buildStats.applied += 1;
      appendTimelineEvent(room, {
        teamId: team.id,
        type: 'build-applied',
        metadata: { eventId: event.id },
      });
      buildOutcomes.push({
        eventId: event.id,
        teamId: team.id,
        outcome: 'applied',
        executeTick: event.executeTick,
        resolvedTick: room.tick,
      });
      continue;
    }

    rejectBuild(room, team, 'apply-failed', event.id);
    recordRejectedBuildOutcome(buildOutcomes, event, 'apply-failed', room.tick);
  }

  if (room.pendingLegacyUpdates.length > 0) {
    applyUpdates(room.grid, room.pendingLegacyUpdates, room.width, room.height);
    room.pendingLegacyUpdates = [];
  }

  room.grid = stepGrid(room.grid, room.width, room.height);
  room.tick += 1;
  room.generation += 1;

  const coreHpBeforeResolution = resolveIntegrityChecks(room);
  const defeatedTeams: number[] = [];
  for (const team of room.teams.values()) {
    const core = getCoreStructure(team);
    const defeated = !core || core.hp <= 0;
    if (defeated && !team.defeated) {
      team.defeated = true;
      drainPendingBuildEvents(
        room,
        [team],
        'team-defeated',
        room.tick,
        buildOutcomes,
      );
      drainPendingDestroyEvents(
        room,
        [team],
        'team-defeated',
        room.tick,
        destroyOutcomes,
      );
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

  if (outcome) {
    const teamsWithPending = [...room.teams.values()].filter(
      ({ pendingBuildEvents, pendingDestroyEvents }) =>
        pendingBuildEvents.length > 0 || pendingDestroyEvents.length > 0,
    );
    drainPendingBuildEvents(
      room,
      teamsWithPending,
      'match-finished',
      room.tick,
      buildOutcomes,
    );
    drainPendingDestroyEvents(
      room,
      teamsWithPending,
      'match-finished',
      room.tick,
      destroyOutcomes,
    );
  }

  buildOutcomes.sort(compareBuildOutcomes);
  destroyOutcomes.sort(compareDestroyOutcomes);

  return {
    appliedBuilds,
    defeatedTeams,
    outcome,
    buildOutcomes,
    destroyOutcomes,
  };
}

export class RtsEngine {
  public static readonly CORE_STRUCTURE_TEMPLATE = CORE_STRUCTURE_TEMPLATE;

  public static createDefaultTemplates(): StructureTemplate[] {
    return createDefaultTemplates();
  }

  public static createTemplateSummaries(
    templates: StructureTemplate[],
  ): StructureTemplateSummary[] {
    return createTemplateSummaries(templates);
  }

  public static createRoomState(options: CreateRoomOptions): RoomState {
    return createRoomState(options);
  }

  public static listRooms(rooms: Map<string, RoomState>): RoomListEntry[] {
    return listRooms(rooms);
  }

  public static addPlayerToRoom(
    room: RoomState,
    playerId: string,
    playerName: string,
  ): TeamState {
    return addPlayerToRoom(room, playerId, playerName);
  }

  public static renamePlayerInRoom(
    room: RoomState,
    playerId: string,
    name: string,
  ): void {
    renamePlayerInRoom(room, playerId, name);
  }

  public static removePlayerFromRoom(room: RoomState, playerId: string): void {
    removePlayerFromRoom(room, playerId);
  }

  public static queueLegacyCellUpdate(
    room: RoomState,
    update: CellUpdate,
  ): void {
    queueLegacyCellUpdate(room, update);
  }

  public static previewBuildPlacement(
    room: RoomState,
    playerId: string,
    payload: BuildQueuePayload,
  ): QueueBuildResult {
    return previewBuildPlacement(room, playerId, payload);
  }

  public static queueBuildEvent(
    room: RoomState,
    playerId: string,
    payload: BuildQueuePayload,
  ): QueueBuildResult {
    return queueBuildEvent(room, playerId, payload);
  }

  public static queueDestroyEvent(
    room: RoomState,
    playerId: string,
    payload: DestroyQueuePayload,
  ): QueueDestroyResult {
    return queueDestroyEvent(room, playerId, payload);
  }

  public static createRoomStatePayload(room: RoomState): RoomStatePayload {
    return createRoomStatePayload(room);
  }

  public static createTeamOutcomeSnapshots(
    room: RoomState,
    coreHpBeforeResolution: ReadonlyMap<number, number> = new Map(),
  ): TeamOutcomeSnapshot[] {
    return createTeamOutcomeSnapshots(room, coreHpBeforeResolution);
  }

  public static createCanonicalMatchOutcome(
    room: RoomState,
    coreHpBeforeResolution: ReadonlyMap<number, number> = new Map(),
  ): MatchOutcome | null {
    return createCanonicalMatchOutcome(room, coreHpBeforeResolution);
  }

  public static tickRoom(room: RoomState): RoomTickResult {
    return tickRoom(room);
  }
}
