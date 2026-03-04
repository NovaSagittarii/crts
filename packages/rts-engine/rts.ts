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
  DEFAULT_SPAWN_CAPACITY,
  DEFAULT_STARTING_RESOURCES,
  DEFAULT_TEAM_TERRITORY_RADIUS,
  INTEGRITY_CHECK_INTERVAL_TICKS,
  INTEGRITY_HP_COST_PER_CELL,
  MAX_DELAY_TICKS,
  SPAWN_MIN_WRAPPED_DISTANCE,
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
  type TransformTemplateInput,
  type PlacementTransformInput,
  type PlacementTransformState,
  type TransformedTemplate,
} from './placement-transform.js';

export interface StructureTemplateOptions {
  id: string;
  name: string;
  width: number;
  height: number;
  cells: Uint8Array;
  activationCost: number;
  income: number;
  buildArea: number;
  startingHp: number;
  checks: Vector2[];
  requiresDestroyConfirm?: boolean;
}

export type StructureTemplateInput =
  | StructureTemplate
  | StructureTemplateOptions;

export interface StructureInstantiationOptions {
  key: string;
  x: number;
  y: number;
  transform: PlacementTransformState;
  active: boolean;
  isCore: boolean;
}

interface StructureOptions extends StructureInstantiationOptions {
  template: StructureTemplate;
  hp: number;
}

export class StructureTemplate implements TransformTemplateInput {
  public readonly id: string;

  public readonly name: string;

  public readonly width: number;

  public readonly height: number;

  public readonly cells: Uint8Array;

  public readonly activationCost: number;

  public readonly income: number;

  public readonly buildArea: number;

  public readonly startingHp: number;

  public readonly checks: Vector2[];

  public readonly requiresDestroyConfirm: boolean;

  public constructor(options: StructureTemplateOptions) {
    this.id = options.id;
    this.name = options.name;
    this.width = options.width;
    this.height = options.height;
    this.cells = new Uint8Array(options.cells);
    this.activationCost = options.activationCost;
    this.income = options.income;
    this.buildArea = options.buildArea;
    if (!Number.isFinite(options.startingHp) || options.startingHp <= 0) {
      throw new Error('Template starting HP must be greater than zero');
    }
    this.startingHp = options.startingHp;
    this.checks = options.checks.map((check) => ({ x: check.x, y: check.y }));
    this.requiresDestroyConfirm = Boolean(options.requiresDestroyConfirm);
  }

  public static from(input: StructureTemplateInput): StructureTemplate {
    return input instanceof StructureTemplate
      ? input
      : new StructureTemplate(input);
  }

  public instantiate(options: StructureInstantiationOptions): Structure {
    return new Structure({
      template: this,
      ...options,
      hp: this.startingHp,
    });
  }

  public project(transform: PlacementTransformState): TransformedTemplate {
    return projectTemplateWithTransform(this, transform);
  }

  public projectPlacement(
    x: number,
    y: number,
    transform: PlacementTransformState,
    roomWidth: number,
    roomHeight: number,
  ): ReturnType<typeof projectPlacementToWorld> {
    return projectPlacementToWorld(
      this.project(transform),
      x,
      y,
      roomWidth,
      roomHeight,
    );
  }

  public toSummary(): StructureTemplateSummary {
    return {
      id: this.id,
      name: this.name,
      width: this.width,
      height: this.height,
      activationCost: this.activationCost,
      income: this.income,
      buildArea: this.buildArea,
    };
  }
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

export class Structure {
  public readonly key: string;

  public readonly template: StructureTemplate;

  public readonly x: number;

  public readonly y: number;

  public readonly transform: PlacementTransformState;

  public active: boolean;

  public hp: number;

  public readonly isCore: boolean;

  public constructor(options: StructureOptions) {
    this.key = options.key;
    this.template = options.template;
    this.x = options.x;
    this.y = options.y;
    this.transform = options.transform;
    this.active = options.active;
    this.hp = options.hp;
    this.isCore = options.isCore;
  }

  public get templateId(): string {
    return this.template.id;
  }

  public get buildRadius(): number {
    return this.active && !this.isCore ? this.template.buildArea : 0;
  }

  public projectTemplate(): TransformedTemplate {
    return this.template.project(this.transform);
  }

  public projectPlacement(
    roomWidth: number,
    roomHeight: number,
  ): ReturnType<typeof projectPlacementToWorld> {
    return this.template.projectPlacement(
      this.x,
      this.y,
      this.transform,
      roomWidth,
      roomHeight,
    );
  }

  public destroy(): void {
    this.hp = 0;
    this.active = false;
  }

  public deactivate(): void {
    this.active = false;
  }

  public setActive(next: boolean): void {
    this.active = this.hp > 0 && next;
  }

  public applyIntegrityDamage(amount: number): void {
    this.hp -= amount;
  }

  public toPayload(roomWidth: number, roomHeight: number): StructurePayload {
    const transformedTemplate = this.projectTemplate();
    const projection = projectPlacementToWorld(
      transformedTemplate,
      this.x,
      this.y,
      roomWidth,
      roomHeight,
    );
    return {
      key: this.key,
      templateId: this.template.id,
      templateName: this.template.name,
      x: this.x,
      y: this.y,
      width: transformedTemplate.width,
      height: transformedTemplate.height,
      hp: this.hp,
      active: this.active,
      isCore: this.isCore,
      requiresDestroyConfirm: this.template.requiresDestroyConfirm,
      footprint: projection.occupiedCells,
    };
  }
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
  structures: Map<string, Structure>;
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
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  generation: number;
  tick: number;
  grid: Uint8Array;
  readonly templateMap: ReadonlyMap<string, StructureTemplate>;
  templates: StructureTemplate[];
  teams: Map<number, TeamState>;
  players: Map<string, RoomPlayerState>;
  readonly spawnOrientationSeed: number;
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

interface BuildResultBase {
  accepted: boolean;
  error?: string;
  reason?: BuildRejectionReason;
  affordable?: boolean;
  needed?: number;
  current?: number;
  deficit?: number;
}

export interface BuildPreviewResult extends BuildResultBase {
  transform: PlacementTransformState;
  footprint: Vector2[];
  illegalCells: Vector2[];
  bounds: PlacementBounds;
}

export interface QueueBuildResult extends BuildResultBase {
  eventId?: number;
  executeTick?: number;
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
  templates?: StructureTemplateInput[];
}

interface StructureTemplateRowsOptions {
  id: string;
  name: string;
  rows: string[];
  activationCost?: number;
  income?: number;
  buildArea?: number;
  startingHp: number;
  requiresDestroyConfirm?: boolean;
  padding?: number;
  checked?: boolean;
}

const CORE_TEMPLATE_ID = '__core__';

interface PackedGrid {
  width: number;
  height: number;
  cells: Uint8Array;
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

interface EvaluatedBuildPlacement {
  projection: BuildPlacementProjectionResult;
  affordability?: AffordabilityResult;
  diffCells?: number;
  reason?: BuildRejectionReason;
}

type IntegrityOutcomeCategory = 'repaired' | 'destroyed-debris' | 'core-defeat';

export class RtsEngine {
  private static readonly roomEngineByState = new WeakMap<
    RoomState,
    RtsEngine
  >();

  public static readonly CORE_STRUCTURE_TEMPLATE =
    RtsEngine.createTemplateFromRows({
      id: CORE_TEMPLATE_ID,
      name: 'Core',
      rows: ['##.##', '##.##', '.....', '##.##', '##.##'],
      buildArea: 0,
      startingHp: 500,
      requiresDestroyConfirm: true,
      padding: 3,
    });

  private readonly roomId: string;

  private readonly roomName: string;

  private readonly roomWidth: number;

  private readonly roomHeight: number;

  private readonly roomTemplateMap: Map<string, StructureTemplate>;

  private readonly roomSpawnOrientationSeed: number;

  private nextTeamId: number;

  private nextBuildEventId: number;

  private pendingLegacyUpdates: CellUpdate[];

  private timelineEvents: TimelineEvent[];

  private constructor(options: {
    id: string;
    name: string;
    width: number;
    height: number;
    templateMap: Map<string, StructureTemplate>;
    spawnOrientationSeed: number;
  }) {
    this.roomId = options.id;
    this.roomName = options.name;
    this.roomWidth = options.width;
    this.roomHeight = options.height;
    this.roomTemplateMap = options.templateMap;
    this.roomSpawnOrientationSeed = options.spawnOrientationSeed;
    this.nextTeamId = 1;
    this.nextBuildEventId = 1;
    this.pendingLegacyUpdates = [];
    this.timelineEvents = [];
  }

  private static getRoomEngine(room: RoomState): RtsEngine {
    const engine = RtsEngine.roomEngineByState.get(room);
    if (!engine) {
      throw new Error('Room state is not bound to an engine instance');
    }
    return engine;
  }

  public static getRoomId(room: RoomState): string {
    return RtsEngine.getRoomEngine(room).roomId;
  }

  public static getRoomName(room: RoomState): string {
    return RtsEngine.getRoomEngine(room).roomName;
  }

  public static getRoomWidth(room: RoomState): number {
    return RtsEngine.getRoomEngine(room).roomWidth;
  }

  public static getRoomHeight(room: RoomState): number {
    return RtsEngine.getRoomEngine(room).roomHeight;
  }

  public static getRoomTemplate(
    room: RoomState,
    templateId: string,
  ): StructureTemplate | null {
    return (
      RtsEngine.getRoomEngine(room).roomTemplateMap.get(templateId) ?? null
    );
  }

  public static getTimelineEvents(
    room: RoomState,
  ): ReadonlyArray<TimelineEvent> {
    return [...RtsEngine.getRoomEngine(room).timelineEvents];
  }

  private static allocateTeamId(room: RoomState): number {
    const engine = RtsEngine.getRoomEngine(room);
    const teamId = engine.nextTeamId;
    engine.nextTeamId += 1;
    return teamId;
  }

  private static allocateBuildEventId(room: RoomState): number {
    const engine = RtsEngine.getRoomEngine(room);
    const eventId = engine.nextBuildEventId;
    engine.nextBuildEventId += 1;
    return eventId;
  }

  private static pushPendingLegacyUpdate(
    room: RoomState,
    update: CellUpdate,
  ): void {
    RtsEngine.getRoomEngine(room).pendingLegacyUpdates.push(update);
  }

  private static drainPendingLegacyUpdates(room: RoomState): CellUpdate[] {
    const engine = RtsEngine.getRoomEngine(room);
    const updates = engine.pendingLegacyUpdates;
    engine.pendingLegacyUpdates = [];
    return updates;
  }

  private static hashSpawnSeed(
    roomId: string,
    width: number,
    height: number,
  ): number {
    let hash = 2166136261;
    const input = `${roomId}:${width}x${height}`;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  private static parseTemplateRows(rows: string[]): PackedGrid {
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

  private static padTemplate(
    template: PackedGrid,
    padding: number,
  ): PackedGrid {
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

  private static createTemplateFromRows({
    id,
    name,
    rows,
    activationCost = 0,
    income = 0,
    requiresDestroyConfirm = false,
    buildArea = 0,
    startingHp,
    padding = 0,
  }: StructureTemplateRowsOptions): StructureTemplate {
    const parsed = RtsEngine.parseTemplateRows(rows);
    const padded = RtsEngine.padTemplate(parsed, padding);
    return new StructureTemplate({
      id: id,
      name: name,
      width: padded.width,
      height: padded.height,
      cells: padded.cells,
      activationCost: activationCost,
      income: income,
      buildArea: buildArea,
      startingHp: startingHp,
      requiresDestroyConfirm: requiresDestroyConfirm,
      checks: [], // TODO: implement checked and checks
      // checked,
    });
  }

  private static appendTimelineEvent(
    room: RoomState,
    event: Omit<TimelineEvent, 'tick'>,
  ): void {
    RtsEngine.getRoomEngine(room).timelineEvents.push({
      ...event,
      tick: room.tick,
    });
  }

  private static evaluateAffordability(
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

  private static rejectBuild(
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
    RtsEngine.appendTimelineEvent(room, {
      teamId: team.id,
      type: 'build-rejected',
      metadata,
    });
  }

  private static rejectDestroy(
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

    RtsEngine.appendTimelineEvent(room, {
      teamId: team.id,
      type: 'destroy-rejected',
      metadata,
    });
  }

  private static insertBuildEventSorted(
    queue: BuildEvent[],
    event: BuildEvent,
  ): void {
    const compare = RtsEngine.compareBuildEvents;
    let insertIndex = queue.length;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (compare(queue[index], event) <= 0) {
        break;
      }
      insertIndex = index;
    }

    queue.splice(insertIndex, 0, event);
  }

  private static insertDestroyEventSorted(
    queue: DestroyEvent[],
    event: DestroyEvent,
  ): void {
    const compare = RtsEngine.compareDestroyEvents;
    let insertIndex = queue.length;
    for (let index = queue.length - 1; index >= 0; index -= 1) {
      if (compare(queue[index], event) <= 0) {
        break;
      }
      insertIndex = index;
    }

    queue.splice(insertIndex, 0, event);
  }

  private static compareBuildEvents(
    this: void,
    a: BuildEvent,
    b: BuildEvent,
  ): number {
    return a.executeTick - b.executeTick || a.id - b.id;
  }

  private static compareDestroyEvents(
    this: void,
    a: DestroyEvent,
    b: DestroyEvent,
  ): number {
    return a.executeTick - b.executeTick || a.id - b.id;
  }

  private static compareBuildOutcomes(
    this: void,
    a: BuildOutcome,
    b: BuildOutcome,
  ): number {
    return a.executeTick - b.executeTick || a.eventId - b.eventId;
  }

  private static compareDestroyOutcomes(
    this: void,
    a: DestroyOutcome,
    b: DestroyOutcome,
  ): number {
    return a.executeTick - b.executeTick || a.eventId - b.eventId;
  }

  private static projectPendingBuilds(
    room: RoomState,
    team: TeamState,
  ): PendingBuildPayload[] {
    const pending = [...team.pendingBuildEvents];
    pending.sort(RtsEngine.compareBuildEvents);
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

  private static projectPendingDestroys(
    team: TeamState,
  ): PendingDestroyPayload[] {
    const pending = [...team.pendingDestroyEvents];
    pending.sort(RtsEngine.compareDestroyEvents);
    return pending.map((event) => {
      const structure = team.structures.get(event.structureKey);
      const template = structure?.template;

      return {
        eventId: event.id,
        executeTick: event.executeTick,
        structureKey: event.structureKey,
        templateId: structure?.templateId ?? 'unknown',
        templateName: template?.name ?? structure?.templateId ?? 'Unknown',
        x: structure?.x ?? 0,
        y: structure?.y ?? 0,
        requiresDestroyConfirm: template?.requiresDestroyConfirm ?? false,
      };
    });
  }

  private static projectStructures(
    room: RoomState,
    team: TeamState,
  ): StructurePayload[] {
    const orderedStructures = [...team.structures.values()].sort(
      RtsEngine.compareStructuresByKey,
    );
    const projected: StructurePayload[] = [];

    for (const structure of orderedStructures) {
      if (structure.hp <= 0) {
        continue;
      }

      projected.push(structure.toPayload(room.width, room.height));
    }

    return projected;
  }

  private static recordRejectedBuildOutcome(
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

  private static recordRejectedDestroyOutcome(
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

  private static drainPendingBuildEvents(
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

    pendingEvents.sort(RtsEngine.compareBuildEvents);

    for (const event of pendingEvents) {
      const team = room.teams.get(event.teamId);
      if (!team) {
        continue;
      }

      RtsEngine.rejectBuild(room, team, reason, event.id);
      RtsEngine.recordRejectedBuildOutcome(
        buildOutcomes,
        event,
        reason,
        resolvedTick,
      );
    }
  }

  private static drainPendingDestroyEvents(
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

    pendingEvents.sort(RtsEngine.compareDestroyEvents);

    for (const event of pendingEvents) {
      const team = room.teams.get(event.teamId);
      if (!team) {
        continue;
      }

      const target = team.structures.get(event.structureKey);
      RtsEngine.rejectDestroy(room, team, reason, event.id, event.structureKey);
      RtsEngine.recordRejectedDestroyOutcome(
        destroyOutcomes,
        event,
        reason,
        resolvedTick,
        target?.templateId ?? 'unknown',
      );
    }
  }

  private static getCoreStructure(team: TeamState): Structure | null {
    for (const structure of team.structures.values()) {
      if (structure.isCore) {
        return structure;
      }
    }

    return null;
  }

  private static findStructureOwnerTeam(
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

  private static gridCellAt(
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

  private static setGridCell(
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

  private static transformedTemplateFitsRoom(
    room: RoomState,
    transformedTemplate: Pick<TransformedTemplate, 'width' | 'height'>,
  ): boolean {
    return (
      transformedTemplate.width <= room.width &&
      transformedTemplate.height <= room.height
    );
  }

  private static createStructureKey(
    x: number,
    y: number,
    width: number,
    height: number,
  ): string {
    return `${x},${y},${width},${height}`;
  }

  private static collectTeamBuildZoneContributors(
    room: RoomState,
    team: TeamState,
  ): BuildZoneContributor[] {
    const contributorProjectionInputs: BuildZoneContributorProjectionInput[] =
      [];
    const orderedStructures = [...team.structures.values()].sort(
      RtsEngine.compareStructuresByKey,
    );

    for (const structure of orderedStructures) {
      if (structure.hp <= 0) {
        continue;
      }

      const transformedTemplate = structure.projectTemplate();

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

  private static projectBuildPlacement(
    room: RoomState,
    team: TeamState,
    template: StructureTemplate,
    x: number,
    y: number,
    transformInput: PlacementTransformInput | null | undefined,
  ): BuildPlacementValidationResult {
    const transform = normalizePlacementTransform(transformInput);
    const transformedTemplate = template.project(transform);
    const bounds: PlacementBounds = {
      x,
      y,
      width: transformedTemplate.width,
      height: transformedTemplate.height,
    };

    if (!RtsEngine.transformedTemplateFitsRoom(room, transformedTemplate)) {
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
      RtsEngine.collectTeamBuildZoneContributors(room, team),
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

  private static compareTemplate(
    room: RoomState,
    transformedTemplate: TransformedTemplate,
    bounds: PlacementBounds,
  ): number {
    let diffCount = 0;
    for (let ty = 0; ty < transformedTemplate.height; ty += 1) {
      for (let tx = 0; tx < transformedTemplate.width; tx += 1) {
        const templateCell =
          transformedTemplate.cells[ty * transformedTemplate.width + tx];
        const roomCell = RtsEngine.gridCellAt(
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

  private static applyTemplate(
    room: RoomState,
    transformedTemplate: TransformedTemplate,
    bounds: PlacementBounds,
  ): boolean {
    for (let ty = 0; ty < transformedTemplate.height; ty += 1) {
      for (let tx = 0; tx < transformedTemplate.width; tx += 1) {
        RtsEngine.setGridCell(
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

  private static createStructure(
    room: RoomState,
    team: TeamState,
    template: StructureTemplate,
    event: AcceptedBuildEvent,
  ): boolean {
    if (
      !RtsEngine.applyTemplate(
        room,
        event.projection.transformedTemplate,
        event.projection.bounds,
      )
    ) {
      return false;
    }

    team.structures.set(
      event.structureKey,
      template.instantiate({
        key: event.structureKey,
        x: event.x,
        y: event.y,
        transform: event.projection.transform,
        active: false,
        isCore: false,
      }),
    );

    return true;
  }

  private static getIntegrityMaskCells(
    structure: Structure,
  ): readonly IntegrityMaskCell[] {
    const transformedTemplate = structure.projectTemplate();

    const sourceChecks =
      structure.template.checks.length > 0
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

  private static collectIntegrityMismatches(
    room: RoomState,
    structure: Structure,
  ): IntegrityMismatchCell[] {
    const mismatches: IntegrityMismatchCell[] = [];

    for (const check of RtsEngine.getIntegrityMaskCells(structure)) {
      const x = wrapCoordinate(structure.x + check.x, room.width);
      const y = wrapCoordinate(structure.y + check.y, room.height);
      const actual = RtsEngine.gridCellAt(
        room.grid,
        room.width,
        room.height,
        x,
        y,
      );
      if (actual !== check.expected) {
        mismatches.push({ x, y, expected: check.expected });
      }
    }

    return mismatches;
  }

  private static restoreIntegrityMismatches(
    room: RoomState,
    mismatches: readonly IntegrityMismatchCell[],
  ): void {
    for (const mismatch of mismatches) {
      RtsEngine.setGridCell(
        room.grid,
        room.width,
        room.height,
        mismatch.x,
        mismatch.y,
        mismatch.expected,
      );
    }
  }

  private static checkStructureIntegrity(
    room: RoomState,
    structure: Structure,
  ): boolean {
    return RtsEngine.collectIntegrityMismatches(room, structure).length === 0;
  }

  private static isBaseIntact(room: RoomState, team: TeamState): boolean {
    const core = RtsEngine.getCoreStructure(team);
    if (!core || core.hp <= 0) {
      return false;
    }

    return RtsEngine.checkStructureIntegrity(room, core);
  }

  private static countTerritoryCells(room: RoomState, team: TeamState): number {
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
        if (
          RtsEngine.gridCellAt(room.grid, room.width, room.height, x, y) === 1
        ) {
          count += 1;
        }
      }
    }

    return count;
  }

  private static seedBase(room: RoomState, baseTopLeft: Vector2): void {
    for (let by = 0; by < BASE_FOOTPRINT_HEIGHT; by += 1) {
      for (let bx = 0; bx < BASE_FOOTPRINT_WIDTH; bx += 1) {
        if (!isCanonicalBaseCell(bx, by)) {
          continue;
        }

        RtsEngine.setGridCell(
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

  private static hasSpawnSeparation(
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

  private static greatestCommonDivisor(a: number, b: number): number {
    let left = Math.abs(a);
    let right = Math.abs(b);

    while (right !== 0) {
      const remainder = left % right;
      left = right;
      right = remainder;
    }

    return left;
  }

  private static pickDeterministicFallbackSpawn(
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
    while (RtsEngine.greatestCommonDivisor(step, totalPositions) !== 1) {
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
      if (RtsEngine.hasSpawnSeparation(room, candidate, occupied)) {
        return candidate;
      }
    }

    if (firstUnoccupied) {
      return firstUnoccupied;
    }

    throw new Error('Unable to allocate deterministic spawn position');
  }

  private static pickSpawnPosition(room: RoomState, teamId: number): Vector2 {
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
        if (!RtsEngine.hasSpawnSeparation(room, candidate, occupied)) {
          continue;
        }

        return candidate;
      }
    }

    return RtsEngine.pickDeterministicFallbackSpawn(room, teamId, occupied);
  }

  private static createEmptyBuildProjection(
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

  private static evaluateBuildPlacement(
    room: RoomState,
    team: TeamState,
    template: StructureTemplate,
    x: number,
    y: number,
    transformInput: PlacementTransformInput | null | undefined,
  ): EvaluatedBuildPlacement {
    const projectedPlacement = RtsEngine.projectBuildPlacement(
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
      diffCells = RtsEngine.compareTemplate(
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
    const affordability = RtsEngine.evaluateAffordability(
      needed,
      team.resources,
    );

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

  private static applyTeamEconomyAndQueue(
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
      const template = structure.template;

      const active =
        structure.hp > 0 && RtsEngine.checkStructureIntegrity(room, structure);
      structure.setActive(active);

      if (structure.active && !structure.isCore) {
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
        RtsEngine.rejectDestroy(
          room,
          team,
          'invalid-target',
          event.id,
          event.structureKey,
        );
        RtsEngine.recordRejectedDestroyOutcome(
          destroyOutcomes,
          event,
          'invalid-target',
          room.tick,
        );
        continue;
      }

      if (structure.hp <= 0) {
        RtsEngine.rejectDestroy(
          room,
          team,
          'invalid-lifecycle-state',
          event.id,
          event.structureKey,
        );
        RtsEngine.recordRejectedDestroyOutcome(
          destroyOutcomes,
          event,
          'invalid-lifecycle-state',
          room.tick,
          structure.templateId,
        );
        continue;
      }

      structure.destroy();

      RtsEngine.appendTimelineEvent(room, {
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
        RtsEngine.rejectBuild(room, team, 'unknown-template', event.id);
        RtsEngine.recordRejectedBuildOutcome(
          buildOutcomes,
          event,
          'unknown-template',
          room.tick,
        );
        continue;
      }

      const evaluation = RtsEngine.evaluateBuildPlacement(
        room,
        team,
        template,
        event.x,
        event.y,
        event.transform,
      );
      if (evaluation.reason && evaluation.reason !== 'insufficient-resources') {
        RtsEngine.rejectBuild(room, team, evaluation.reason, event.id);
        RtsEngine.recordRejectedBuildOutcome(
          buildOutcomes,
          event,
          evaluation.reason,
          room.tick,
        );
        continue;
      }

      const key = RtsEngine.createStructureKey(
        event.x,
        event.y,
        evaluation.projection.bounds.width,
        evaluation.projection.bounds.height,
      );
      const isReservedInTick = acceptedEvents.some((candidate) => {
        return candidate.teamId === team.id && candidate.structureKey === key;
      });
      if (team.structures.has(key) || isReservedInTick) {
        RtsEngine.rejectBuild(room, team, 'occupied-site', event.id);
        RtsEngine.recordRejectedBuildOutcome(
          buildOutcomes,
          event,
          'occupied-site',
          room.tick,
        );
        continue;
      }

      const affordability = evaluation.affordability;
      if (!affordability || !affordability.affordable) {
        RtsEngine.rejectBuild(
          room,
          team,
          'insufficient-resources',
          event.id,
          affordability,
        );
        RtsEngine.recordRejectedBuildOutcome(
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

  private static compareStructuresByKey(
    this: void,
    left: Structure,
    right: Structure,
  ): number {
    if (left.key < right.key) {
      return -1;
    }
    if (left.key > right.key) {
      return 1;
    }
    return 0;
  }

  private static resolveIntegrityChecks(room: RoomState): Map<number, number> {
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
        RtsEngine.compareStructuresByKey,
      );

      for (const structure of orderedStructures) {
        if (structure.hp <= 0) {
          structure.deactivate();
          continue;
        }

        const mismatches = RtsEngine.collectIntegrityMismatches(
          room,
          structure,
        );
        if (mismatches.length === 0) {
          structure.setActive(true);
          continue;
        }

        const restoreCost = mismatches.length * INTEGRITY_HP_COST_PER_CELL;
        const hpBefore = structure.hp;

        if (structure.isCore && !coreHpBeforeResolution.has(team.id)) {
          coreHpBeforeResolution.set(team.id, hpBefore);
        }

        structure.applyIntegrityDamage(restoreCost);
        if (structure.isCore) {
          RtsEngine.appendTimelineEvent(room, {
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
          RtsEngine.restoreIntegrityMismatches(room, mismatches);
          structure.setActive(true);

          RtsEngine.appendTimelineEvent(room, {
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

        structure.deactivate();

        const category: IntegrityOutcomeCategory = structure.isCore
          ? 'core-defeat'
          : 'destroyed-debris';

        RtsEngine.appendTimelineEvent(room, {
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
          RtsEngine.appendTimelineEvent(room, {
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

  public static createDefaultTemplates(): StructureTemplate[] {
    return [
      RtsEngine.createTemplateFromRows({
        id: 'block',
        name: 'Block 2x2',
        rows: ['##', '##'],
        activationCost: 0,
        income: 0,
        buildArea: 0,
        startingHp: 2,
      }),
      RtsEngine.createTemplateFromRows({
        id: 'generator',
        name: 'Generator Block',
        rows: ['##', '##'],
        activationCost: 6,
        income: 2,
        buildArea: 2,
        startingHp: 2,
        padding: 1,
        checked: true,
      }),
      RtsEngine.createTemplateFromRows({
        id: 'glider',
        name: 'Glider',
        rows: ['.#.', '..#', '###'],
        activationCost: 2,
        income: 0,
        buildArea: 0,
        startingHp: 2,
      }),
      RtsEngine.createTemplateFromRows({
        id: 'eater-1',
        name: 'Eater 1',
        rows: ['##..', '#.##', '.###', '..#.'],
        activationCost: 4,
        income: 0,
        buildArea: 1,
        startingHp: 2,
      }),
      RtsEngine.createTemplateFromRows({
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
        startingHp: 2,
      }),
    ];
  }

  public static createRoomState(options: CreateRoomOptions): RoomState {
    const templateInputs =
      options.templates ?? RtsEngine.createDefaultTemplates();
    const templates = templateInputs.map((template) =>
      StructureTemplate.from(template),
    );
    const templateMap = new Map<string, StructureTemplate>();
    for (const template of templates) {
      templateMap.set(template.id, template);
    }

    const engine = new RtsEngine({
      id: options.id,
      name: options.name,
      width: options.width,
      height: options.height,
      templateMap,
      spawnOrientationSeed: RtsEngine.hashSpawnSeed(
        options.id,
        options.width,
        options.height,
      ),
    });

    const room = {
      generation: 0,
      tick: 0,
      grid: createGrid({ width: options.width, height: options.height }),
      templates,
      teams: new Map<number, TeamState>(),
      players: new Map<string, RoomPlayerState>(),
    } as unknown as RoomState;

    Object.defineProperties(room, {
      id: {
        enumerable: true,
        get: () => engine.roomId,
      },
      name: {
        enumerable: true,
        get: () => engine.roomName,
      },
      width: {
        enumerable: true,
        get: () => engine.roomWidth,
      },
      height: {
        enumerable: true,
        get: () => engine.roomHeight,
      },
      templateMap: {
        enumerable: true,
        get: () => engine.roomTemplateMap,
      },
      spawnOrientationSeed: {
        enumerable: true,
        get: () => engine.roomSpawnOrientationSeed,
      },
    });

    RtsEngine.roomEngineByState.set(room, engine);

    return room;
  }

  public static listRooms(rooms: Map<string, RoomState>): RoomListEntry[] {
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

  public static addPlayerToRoom(
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

    const teamId = RtsEngine.allocateTeamId(room);

    const baseTopLeft = RtsEngine.pickSpawnPosition(room, teamId);
    const coreKey = RtsEngine.createStructureKey(
      baseTopLeft.x,
      baseTopLeft.y,
      RtsEngine.CORE_STRUCTURE_TEMPLATE.width,
      RtsEngine.CORE_STRUCTURE_TEMPLATE.height,
    );

    const structures = new Map<string, Structure>();
    structures.set(
      coreKey,
      RtsEngine.CORE_STRUCTURE_TEMPLATE.instantiate({
        key: coreKey,
        x: baseTopLeft.x,
        y: baseTopLeft.y,
        transform: createIdentityPlacementTransform(),
        active: true,
        isCore: true,
      }),
    );

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
    RtsEngine.seedBase(room, baseTopLeft);

    return team;
  }

  public static renamePlayerInRoom(
    room: RoomState,
    playerId: string,
    name: string,
  ): void {
    const player = room.players.get(playerId);
    if (!player) {
      return;
    }
    player.name = name;
    const team = room.teams.get(player.teamId);
    if (team && team.playerIds.size === 1) {
      team.name = `${name}'s Team`;
    }
  }

  public static removePlayerFromRoom(room: RoomState, playerId: string): void {
    const player = room.players.get(playerId);
    if (!player) {
      return;
    }

    const team = room.teams.get(player.teamId);
    if (team) {
      team.playerIds.delete(playerId);
      if (team.playerIds.size === 0) {
        room.teams.delete(team.id);
      }
    }

    room.players.delete(playerId);
  }

  public static queueLegacyCellUpdate(
    room: RoomState,
    update: CellUpdate,
  ): void {
    RtsEngine.pushPendingLegacyUpdate(room, update);
  }

  public static previewBuildPlacement(
    room: RoomState,
    playerId: string,
    payload: BuildQueuePayload,
  ): BuildPreviewResult {
    const x = Number(payload.x);
    const y = Number(payload.y);

    const player = room.players.get(playerId);
    if (!player) {
      return {
        accepted: false,
        error: 'Player is not in this room',
        ...RtsEngine.createEmptyBuildProjection(x, y, payload.transform),
      };
    }

    const team = room.teams.get(player.teamId);
    if (!team) {
      return {
        accepted: false,
        error: 'Team is not available',
        ...RtsEngine.createEmptyBuildProjection(x, y, payload.transform),
      };
    }

    if (team.defeated) {
      return {
        accepted: false,
        error: 'Team is defeated',
        reason: 'team-defeated',
        ...RtsEngine.createEmptyBuildProjection(x, y, payload.transform),
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
        ...RtsEngine.createEmptyBuildProjection(x, y, payload.transform),
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
        ...RtsEngine.createEmptyBuildProjection(x, y, payload.transform),
        affordable: false,
        needed: 0,
        current: team.resources,
        deficit: 0,
      };
    }

    const evaluation = RtsEngine.evaluateBuildPlacement(
      room,
      team,
      template,
      x,
      y,
      payload.transform,
    );

    const result: BuildPreviewResult = {
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

  public static queueBuildEvent(
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

    const preview = RtsEngine.previewBuildPlacement(room, playerId, payload);
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

        RtsEngine.rejectBuild(
          room,
          team,
          preview.reason,
          undefined,
          affordability,
        );
      }
      return {
        accepted: false,
        error: preview.error,
        reason: preview.reason,
        affordable: preview.affordable,
        needed: preview.needed,
        current: preview.current,
        deficit: preview.deficit,
      };
    }

    const delay = Number(payload.delayTicks ?? 2);
    if (!Number.isInteger(delay)) {
      RtsEngine.rejectBuild(room, team, 'invalid-delay');
      return {
        accepted: false,
        error: 'delayTicks must be an integer',
        reason: 'invalid-delay',
        affordable: preview.affordable,
        needed: preview.needed,
        current: preview.current,
        deficit: preview.deficit,
      };
    }

    const clampedDelay = Math.max(1, Math.min(MAX_DELAY_TICKS, delay));
    const x = Number(payload.x);
    const y = Number(payload.y);
    const eventId = RtsEngine.allocateBuildEventId(room);
    const event: BuildEvent = {
      id: eventId,
      teamId: team.id,
      playerId,
      templateId: payload.templateId,
      x,
      y,
      transform: preview.transform,
      executeTick: room.tick + clampedDelay,
    };

    RtsEngine.insertBuildEventSorted(team.pendingBuildEvents, event);
    team.buildStats.queued += 1;
    RtsEngine.appendTimelineEvent(room, {
      teamId: team.id,
      type: 'build-queued',
      metadata: {
        eventId: event.id,
        executeTick: event.executeTick,
      },
    });

    return {
      accepted: true,
      affordable: preview.affordable,
      needed: preview.needed,
      current: preview.current,
      deficit: preview.deficit,
      eventId: event.id,
      executeTick: event.executeTick,
    };
  }

  public static queueDestroyEvent(
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
      RtsEngine.rejectDestroy(room, team, 'team-defeated');
      return {
        accepted: false,
        error: 'Team is defeated',
        reason: 'team-defeated',
      };
    }

    const structureKey =
      typeof payload.structureKey === 'string'
        ? payload.structureKey.trim()
        : '';
    if (!structureKey) {
      RtsEngine.rejectDestroy(room, team, 'invalid-target');
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

    const ownerTeam = RtsEngine.findStructureOwnerTeam(room, structureKey);
    if (!ownerTeam) {
      RtsEngine.rejectDestroy(
        room,
        team,
        'invalid-target',
        undefined,
        structureKey,
      );
      return {
        accepted: false,
        error: 'Target structure does not exist',
        reason: 'invalid-target',
        structureKey,
      };
    }

    if (ownerTeam.id !== team.id) {
      RtsEngine.rejectDestroy(
        room,
        team,
        'wrong-owner',
        undefined,
        structureKey,
      );
      return {
        accepted: false,
        error: 'Cannot destroy structures owned by another team',
        reason: 'wrong-owner',
        structureKey,
      };
    }

    const structure = ownerTeam.structures.get(structureKey);
    if (!structure || structure.hp <= 0) {
      RtsEngine.rejectDestroy(
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
      RtsEngine.rejectDestroy(
        room,
        team,
        'invalid-delay',
        undefined,
        structureKey,
      );
      return {
        accepted: false,
        error: 'delayTicks must be an integer',
        reason: 'invalid-delay',
        structureKey,
      };
    }

    const clampedDelay = Math.max(1, Math.min(MAX_DELAY_TICKS, delay));
    const eventId = RtsEngine.allocateBuildEventId(room);
    const event: DestroyEvent = {
      id: eventId,
      teamId: team.id,
      playerId,
      structureKey,
      executeTick: room.tick + clampedDelay,
    };

    RtsEngine.insertDestroyEventSorted(team.pendingDestroyEvents, event);
    RtsEngine.appendTimelineEvent(room, {
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

  public static createRoomStatePayload(room: RoomState): RoomStatePayload {
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
        pendingBuilds: RtsEngine.projectPendingBuilds(room, team),
        pendingDestroys: RtsEngine.projectPendingDestroys(team),
        structures: RtsEngine.projectStructures(room, team),
        defeated: team.defeated,
        baseTopLeft: {
          x: team.baseTopLeft.x,
          y: team.baseTopLeft.y,
        },
        baseIntact: RtsEngine.isBaseIntact(room, team),
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

  public static createTeamOutcomeSnapshots(
    room: RoomState,
    coreHpBeforeResolution: ReadonlyMap<number, number> = new Map(),
  ): TeamOutcomeSnapshot[] {
    const snapshots: TeamOutcomeSnapshot[] = [];

    for (const team of room.teams.values()) {
      const core = RtsEngine.getCoreStructure(team);
      const coreHp = core?.hp ?? 0;
      snapshots.push({
        teamId: team.id,
        coreHp,
        coreHpBeforeResolution: coreHpBeforeResolution.get(team.id) ?? coreHp,
        coreDestroyed: coreHp <= 0,
        territoryCellCount: RtsEngine.countTerritoryCells(room, team),
        queuedBuildCount: team.buildStats.queued,
        appliedBuildCount: team.buildStats.applied,
        rejectedBuildCount: team.buildStats.rejected,
      });
    }

    return snapshots;
  }

  public static createCanonicalMatchOutcome(
    room: RoomState,
    coreHpBeforeResolution: ReadonlyMap<number, number> = new Map(),
  ): MatchOutcome | null {
    return determineMatchOutcome(
      RtsEngine.createTeamOutcomeSnapshots(room, coreHpBeforeResolution),
    );
  }

  public static tickRoom(room: RoomState): RoomTickResult {
    const acceptedEvents: AcceptedBuildEvent[] = [];
    const buildOutcomes: BuildOutcome[] = [];
    const destroyOutcomes: DestroyOutcome[] = [];

    for (const team of room.teams.values()) {
      RtsEngine.applyTeamEconomyAndQueue(
        room,
        team,
        acceptedEvents,
        buildOutcomes,
        destroyOutcomes,
      );
    }

    acceptedEvents.sort(RtsEngine.compareBuildEvents);

    let appliedBuilds = 0;
    for (const event of acceptedEvents) {
      const template = room.templateMap.get(event.templateId);
      const team = room.teams.get(event.teamId);
      if (!template || !team) {
        continue;
      }

      if (RtsEngine.createStructure(room, team, template, event)) {
        appliedBuilds += 1;
        team.buildStats.applied += 1;
        RtsEngine.appendTimelineEvent(room, {
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

      RtsEngine.rejectBuild(room, team, 'apply-failed', event.id);
      RtsEngine.recordRejectedBuildOutcome(
        buildOutcomes,
        event,
        'apply-failed',
        room.tick,
      );
    }

    const pendingLegacyUpdates = RtsEngine.drainPendingLegacyUpdates(room);
    if (pendingLegacyUpdates.length > 0) {
      applyUpdates(room.grid, pendingLegacyUpdates, room.width, room.height);
    }

    room.grid = stepGrid(room.grid, room.width, room.height);
    room.tick += 1;
    room.generation += 1;

    const coreHpBeforeResolution = RtsEngine.resolveIntegrityChecks(room);
    const defeatedTeams: number[] = [];
    for (const team of room.teams.values()) {
      const core = RtsEngine.getCoreStructure(team);
      const defeated = !core || core.hp <= 0;
      if (defeated && !team.defeated) {
        team.defeated = true;
        RtsEngine.drainPendingBuildEvents(
          room,
          [team],
          'team-defeated',
          room.tick,
          buildOutcomes,
        );
        RtsEngine.drainPendingDestroyEvents(
          room,
          [team],
          'team-defeated',
          room.tick,
          destroyOutcomes,
        );
        defeatedTeams.push(team.id);
        RtsEngine.appendTimelineEvent(room, {
          teamId: team.id,
          type: 'team-defeated',
        });
      }
    }

    const outcome =
      defeatedTeams.length > 0
        ? RtsEngine.createCanonicalMatchOutcome(room, coreHpBeforeResolution)
        : null;

    if (outcome) {
      const teamsWithPending = [...room.teams.values()].filter(
        ({ pendingBuildEvents, pendingDestroyEvents }) =>
          pendingBuildEvents.length > 0 || pendingDestroyEvents.length > 0,
      );
      RtsEngine.drainPendingBuildEvents(
        room,
        teamsWithPending,
        'match-finished',
        room.tick,
        buildOutcomes,
      );
      RtsEngine.drainPendingDestroyEvents(
        room,
        teamsWithPending,
        'match-finished',
        room.tick,
        destroyOutcomes,
      );
    }

    buildOutcomes.sort(RtsEngine.compareBuildOutcomes);
    destroyOutcomes.sort(RtsEngine.compareDestroyOutcomes);

    return {
      appliedBuilds,
      defeatedTeams,
      outcome,
      buildOutcomes,
      destroyOutcomes,
    };
  }
}
