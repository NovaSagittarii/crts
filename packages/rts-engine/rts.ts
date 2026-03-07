import { Grid } from '#conway-core';
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
  DEFAULT_QUEUE_DELAY_TICKS,
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
  type PlacementBounds,
  type PlacementTransformInput,
  type PlacementTransformState,
  type TransformTemplateInput,
  type TransformedTemplate,
} from './placement-transform.js';
import {
  CORE_STRUCTURE_TEMPLATE as DEFAULT_CORE_STRUCTURE_TEMPLATE,
  createDefaultStructureTemplates,
  Structure,
  StructureTemplate,
  type StructurePayload,
  type StructureTemplateInput,
} from './structure.js';

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

export interface BuildPreviewProjection {
  transform: PlacementTransformState;
  footprint: Vector2[];
  illegalCells: Vector2[];
  bounds: PlacementBounds;
}

export interface BuildPreviewTemplateSnapshot extends TransformTemplateInput {
  activationCost: number;
}

export interface BuildPreviewSnapshotInput {
  width: number;
  height: number;
  grid: Grid;
  teamResources: number;
  teamDefeated: boolean;
  teamBuildZoneProjectionInputs: readonly BuildZoneContributorProjectionInput[];
  template: BuildPreviewTemplateSnapshot | null;
  x: number;
  y: number;
  transform?: PlacementTransformInput | null;
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
  grid: Grid;
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

export interface TeamStructuresStatePayload {
  id: number;
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

export interface HashedStateSectionPayload {
  hashAlgorithm: DeterminismHashAlgorithm;
  hashHex: string;
}

export interface RoomGridStatePayload extends HashedStateSectionPayload {
  roomId: string;
  width: number;
  height: number;
  generation: number;
  tick: number;
  grid: ArrayBuffer;
}

export interface RoomStructuresStatePayload extends HashedStateSectionPayload {
  roomId: string;
  width: number;
  height: number;
  generation: number;
  tick: number;
  teams: TeamPayload[];
}

export interface RoomStateHashes {
  tick: number;
  generation: number;
  hashAlgorithm: DeterminismHashAlgorithm;
  gridHash: string;
  structuresHash: string;
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

export type DeterminismHashAlgorithm = 'fnv1a-32';

export interface RoomDeterminismCheckpoint {
  tick: number;
  generation: number;
  hashAlgorithm: DeterminismHashAlgorithm;
  hashHex: string;
}

export interface CreateRoomOptions {
  id: string;
  name: string;
  width: number;
  height: number;
  templates?: StructureTemplateInput[];
}

export interface AddPlayerToRoomOptions {
  teamId?: number;
  teamName?: string;
}

interface BuildPlacementProjectionResult {
  transform: PlacementTransformState;
  transformedTemplate: TransformedTemplate;
  templateGrid: Grid;
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

interface BuildPlacementSnapshotProjectionInput {
  width: number;
  height: number;
  teamBuildZoneProjectionInputs: readonly BuildZoneContributorProjectionInput[];
  template: TransformTemplateInput;
  x: number;
  y: number;
  transformInput: PlacementTransformInput | null | undefined;
}

interface BuildPlacementSnapshotEvaluationInput extends BuildPlacementSnapshotProjectionInput {
  grid: Grid;
  teamResources: number;
  templateActivationCost: number;
}

type IntegrityOutcomeCategory = 'repaired' | 'destroyed-debris' | 'core-defeat';

export class RtsEngine {
  private static readonly roomEngineByState = new WeakMap<
    RoomState,
    RtsEngine
  >();

  private static readonly FNV_OFFSET_BASIS = 2166136261;

  private static readonly FNV_PRIME = 16777619;

  private static readonly aliveIntegrityPatch = new Grid(
    1,
    1,
    [{ x: 0, y: 0 }],
    'flat',
  );

  private static readonly deadIntegrityPatch = new Grid(1, 1, [], 'flat');

  public static readonly CORE_STRUCTURE_TEMPLATE =
    DEFAULT_CORE_STRUCTURE_TEMPLATE;

  private readonly roomId: string;

  private readonly roomName: string;

  private readonly roomWidth: number;

  private readonly roomHeight: number;

  private readonly roomTemplateMap: Map<string, StructureTemplate>;

  private readonly roomSpawnOrientationSeed: number;

  private nextTeamId: number;

  private nextBuildEventId: number;

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
    this.timelineEvents = [];
  }

  private static getRoomEngine(room: RoomState): RtsEngine {
    const engine = RtsEngine.roomEngineByState.get(room);
    if (!engine) {
      throw new Error(
        'RoomState must come from RtsEngine.createRoomState or RtsEngine.createRoom',
      );
    }
    return engine;
  }

  public static hasRoomEngine(room: RoomState): boolean {
    return RtsEngine.roomEngineByState.has(room);
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

  private static allocateEventId(room: RoomState): number {
    const engine = RtsEngine.getRoomEngine(room);
    const eventId = engine.nextBuildEventId;
    engine.nextBuildEventId += 1;
    return eventId;
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

  private static hashByte(hash: number, value: number): number {
    return Math.imul((hash ^ (value & 0xff)) >>> 0, RtsEngine.FNV_PRIME) >>> 0;
  }

  private static hashInt32(hash: number, value: number): number {
    const normalized = value >>> 0;
    let next = hash;
    next = RtsEngine.hashByte(next, normalized & 0xff);
    next = RtsEngine.hashByte(next, (normalized >>> 8) & 0xff);
    next = RtsEngine.hashByte(next, (normalized >>> 16) & 0xff);
    next = RtsEngine.hashByte(next, (normalized >>> 24) & 0xff);
    return next;
  }

  private static hashBoolean(hash: number, value: boolean): number {
    return RtsEngine.hashByte(hash, value ? 1 : 0);
  }

  private static hashNumber(hash: number, value: number): number {
    if (!Number.isFinite(value)) {
      return RtsEngine.hashInt32(hash, 0x7fffffff);
    }

    if (Number.isInteger(value)) {
      return RtsEngine.hashInt32(hash, value);
    }

    return RtsEngine.hashInt32(hash, Math.round(value * 1000));
  }

  private static hashString(hash: number, value: string): number {
    let next = RtsEngine.hashInt32(hash, value.length);
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      next = RtsEngine.hashByte(next, code & 0xff);
      next = RtsEngine.hashByte(next, (code >>> 8) & 0xff);
    }
    return next;
  }

  private static hashBytes(hash: number, values: Uint8Array): number {
    let next = RtsEngine.hashInt32(hash, values.length);
    for (let index = 0; index < values.length; index += 1) {
      next = RtsEngine.hashByte(next, values[index] ?? 0);
    }
    return next;
  }

  private static hashTransform(
    hash: number,
    transform: PlacementTransformState,
  ): number {
    let next = RtsEngine.hashInt32(hash, transform.operations.length);
    for (const operation of transform.operations) {
      next = RtsEngine.hashString(next, operation);
    }

    next = RtsEngine.hashNumber(next, transform.matrix.xx);
    next = RtsEngine.hashNumber(next, transform.matrix.xy);
    next = RtsEngine.hashNumber(next, transform.matrix.yx);
    next = RtsEngine.hashNumber(next, transform.matrix.yy);
    return next;
  }

  private static hashStructure(hash: number, structure: Structure): number {
    let next = hash;
    next = RtsEngine.hashString(next, structure.key);
    next = RtsEngine.hashString(next, structure.templateId);
    next = RtsEngine.hashInt32(next, structure.x);
    next = RtsEngine.hashInt32(next, structure.y);
    next = RtsEngine.hashBoolean(next, structure.active);
    next = RtsEngine.hashInt32(next, structure.hp);
    next = RtsEngine.hashBoolean(next, structure.isCore);
    next = RtsEngine.hashNumber(next, structure.buildRadius);
    return RtsEngine.hashTransform(next, structure.transform);
  }

  private static hashBuildEvent(hash: number, event: BuildEvent): number {
    let next = hash;
    next = RtsEngine.hashInt32(next, event.id);
    next = RtsEngine.hashInt32(next, event.teamId);
    next = RtsEngine.hashString(next, event.playerId);
    next = RtsEngine.hashString(next, event.templateId);
    next = RtsEngine.hashInt32(next, event.x);
    next = RtsEngine.hashInt32(next, event.y);
    next = RtsEngine.hashInt32(next, event.executeTick);
    return RtsEngine.hashTransform(next, event.transform);
  }

  private static hashDestroyEvent(hash: number, event: DestroyEvent): number {
    let next = hash;
    next = RtsEngine.hashInt32(next, event.id);
    next = RtsEngine.hashInt32(next, event.teamId);
    next = RtsEngine.hashString(next, event.playerId);
    next = RtsEngine.hashString(next, event.structureKey);
    next = RtsEngine.hashInt32(next, event.executeTick);
    return next;
  }

  private static formatHashHex(hash: number): string {
    return hash.toString(16).padStart(8, '0');
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

  private static createTeamStructuresStatePayload(
    room: RoomState,
    team: TeamState,
  ): TeamStructuresStatePayload {
    return {
      id: team.id,
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
    };
  }

  private static createTeamStatePayload(
    room: RoomState,
    team: TeamState,
  ): TeamPayload {
    const teamStructures = RtsEngine.createTeamStructuresStatePayload(
      room,
      team,
    );

    return {
      name: team.name,
      playerIds: [...team.playerIds],
      ...teamStructures,
    };
  }

  private static hashStateRoomScope(hash: number, room: RoomState): number {
    let next = hash;
    next = RtsEngine.hashString(next, room.id);
    next = RtsEngine.hashInt32(next, room.width);
    next = RtsEngine.hashInt32(next, room.height);
    return next;
  }

  private static hashStructuresSection(
    room: RoomState,
    orderedTeams: readonly TeamState[],
  ): number {
    let hash = RtsEngine.hashStateRoomScope(RtsEngine.FNV_OFFSET_BASIS, room);
    hash = RtsEngine.hashInt32(hash, orderedTeams.length);

    for (const team of orderedTeams) {
      hash = RtsEngine.hashInt32(hash, team.id);
      hash = RtsEngine.hashNumber(hash, team.resources);
      hash = RtsEngine.hashNumber(hash, team.income);
      hash = RtsEngine.hashNumber(hash, team.incomeBreakdown.base);
      hash = RtsEngine.hashNumber(hash, team.incomeBreakdown.structures);
      hash = RtsEngine.hashNumber(hash, team.incomeBreakdown.total);
      hash = RtsEngine.hashNumber(
        hash,
        team.incomeBreakdown.activeStructureCount,
      );
      hash = RtsEngine.hashBoolean(hash, team.defeated);
      hash = RtsEngine.hashInt32(hash, team.baseTopLeft.x);
      hash = RtsEngine.hashInt32(hash, team.baseTopLeft.y);
      hash = RtsEngine.hashBoolean(hash, RtsEngine.isBaseIntact(room, team));

      const structures = [...team.structures.values()].sort(
        RtsEngine.compareStructuresByKey,
      );
      hash = RtsEngine.hashInt32(hash, structures.length);
      for (const structure of structures) {
        hash = RtsEngine.hashStructure(hash, structure);
      }

      const pendingBuilds = [...team.pendingBuildEvents].sort(
        RtsEngine.compareBuildEvents,
      );
      hash = RtsEngine.hashInt32(hash, pendingBuilds.length);
      for (const pendingBuild of pendingBuilds) {
        hash = RtsEngine.hashBuildEvent(hash, pendingBuild);
      }

      const pendingDestroys = [...team.pendingDestroyEvents].sort(
        RtsEngine.compareDestroyEvents,
      );
      hash = RtsEngine.hashInt32(hash, pendingDestroys.length);
      for (const pendingDestroy of pendingDestroys) {
        hash = RtsEngine.hashDestroyEvent(hash, pendingDestroy);
      }
    }

    return hash;
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

  private static transformedTemplateFitsDimensions(
    width: number,
    height: number,
    transformedTemplate: Pick<TransformedTemplate, 'width' | 'height'>,
  ): boolean {
    return (
      transformedTemplate.width <= width && transformedTemplate.height <= height
    );
  }

  private static transformedTemplateFitsRoom(
    room: RoomState,
    transformedTemplate: Pick<TransformedTemplate, 'width' | 'height'>,
  ): boolean {
    return RtsEngine.transformedTemplateFitsDimensions(
      room.width,
      room.height,
      transformedTemplate,
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

  private static wrapAnchorCoordinate(value: number, size: number): number {
    const remainder = value % size;
    return remainder >= 0 ? remainder : remainder + size;
  }

  private static canonicalizePlacementAnchorForDimensions(
    width: number,
    height: number,
    x: number,
    y: number,
  ): Vector2 {
    return {
      x: RtsEngine.wrapAnchorCoordinate(x, width),
      y: RtsEngine.wrapAnchorCoordinate(y, height),
    };
  }

  private static canonicalizePlacementAnchor(
    room: RoomState,
    x: number,
    y: number,
  ): Vector2 {
    return RtsEngine.canonicalizePlacementAnchorForDimensions(
      room.width,
      room.height,
      x,
      y,
    );
  }

  private static collectTeamBuildZoneProjectionInputs(
    team: TeamState,
  ): BuildZoneContributorProjectionInput[] {
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

    return contributorProjectionInputs;
  }

  private static collectBuildZoneContributorsFromProjectionInputs(
    projectionInputs: readonly BuildZoneContributorProjectionInput[],
  ): BuildZoneContributor[] {
    const activeProjectionInputs = projectionInputs.filter(
      (projectionInput) => (projectionInput.hp ?? 1) > 0,
    );

    return collectBuildZoneContributors(activeProjectionInputs);
  }

  private static createTemplateProjectionInput(
    template: StructureTemplate,
  ): TransformTemplateInput {
    const projectedTemplate = template.project(
      createIdentityPlacementTransform(),
    );

    return {
      width: projectedTemplate.width,
      height: projectedTemplate.height,
      grid: projectedTemplate.grid,
      checks: template.checks,
    };
  }

  private static collectTeamBuildZoneContributors(
    team: TeamState,
  ): BuildZoneContributor[] {
    return RtsEngine.collectBuildZoneContributorsFromProjectionInputs(
      RtsEngine.collectTeamBuildZoneProjectionInputs(team),
    );
  }

  private static projectBuildPlacementFromSnapshot(
    input: BuildPlacementSnapshotProjectionInput,
  ): BuildPlacementValidationResult {
    const transform = normalizePlacementTransform(input.transformInput);
    const anchor = RtsEngine.canonicalizePlacementAnchorForDimensions(
      input.width,
      input.height,
      input.x,
      input.y,
    );
    const transformedTemplate = projectTemplateWithTransform(
      input.template,
      transform,
    );
    const templateGrid = transformedTemplate.grid;
    const bounds: PlacementBounds = {
      x: anchor.x,
      y: anchor.y,
      width: transformedTemplate.width,
      height: transformedTemplate.height,
    };

    if (
      !RtsEngine.transformedTemplateFitsDimensions(
        input.width,
        input.height,
        transformedTemplate,
      )
    ) {
      return {
        projection: {
          transform,
          transformedTemplate,
          templateGrid,
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
      anchor.x,
      anchor.y,
      input.width,
      input.height,
    );
    const illegalCells = collectIllegalBuildZoneCells(
      projected.areaCells,
      RtsEngine.collectBuildZoneContributorsFromProjectionInputs(
        input.teamBuildZoneProjectionInputs,
      ),
    );

    return {
      projection: {
        transform,
        transformedTemplate,
        templateGrid,
        bounds,
        areaCells: projected.areaCells,
        footprint: projected.occupiedCells,
        checks: projected.checks,
        illegalCells,
      },
      reason: illegalCells.length > 0 ? 'outside-territory' : undefined,
    };
  }

  private static projectBuildPlacement(
    room: RoomState,
    team: TeamState,
    template: StructureTemplate,
    x: number,
    y: number,
    transformInput: PlacementTransformInput | null | undefined,
  ): BuildPlacementValidationResult {
    return RtsEngine.projectBuildPlacementFromSnapshot({
      width: room.width,
      height: room.height,
      teamBuildZoneProjectionInputs:
        RtsEngine.collectTeamBuildZoneProjectionInputs(team),
      template: RtsEngine.createTemplateProjectionInput(template),
      x,
      y,
      transformInput,
    });
  }

  private static compareTemplateAgainstGrid(
    grid: Grid,
    templateGrid: Grid,
    bounds: PlacementBounds,
  ): number {
    return grid.compare(templateGrid, { x: bounds.x, y: bounds.y });
  }

  private static compareTemplate(
    room: RoomState,
    templateGrid: Grid,
    bounds: PlacementBounds,
  ): number {
    return RtsEngine.compareTemplateAgainstGrid(
      room.grid,
      templateGrid,
      bounds,
    );
  }

  private static applyTemplate(
    room: RoomState,
    templateGrid: Grid,
    bounds: PlacementBounds,
  ): boolean {
    room.grid.apply(templateGrid, { x: bounds.x, y: bounds.y });

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
        event.projection.templateGrid,
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
        expected: transformedTemplate.grid.isCellAlive(check.x, check.y)
          ? 1
          : 0,
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
      const x = structure.x + check.x;
      const y = structure.y + check.y;
      const actual = room.grid.isCellAlive(x, y) ? 1 : 0;
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
      room.grid.apply(
        mismatch.expected === 1
          ? RtsEngine.aliveIntegrityPatch
          : RtsEngine.deadIntegrityPatch,
        { x: mismatch.x, y: mismatch.y },
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
        if (room.grid.isCellAlive(x, y)) {
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

        room.grid.setCell(baseTopLeft.x + bx, baseTopLeft.y + by, 1);
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

  private static evaluateBuildPlacementFromSnapshot(
    input: BuildPlacementSnapshotEvaluationInput,
  ): EvaluatedBuildPlacement {
    const projectedPlacement = RtsEngine.projectBuildPlacementFromSnapshot({
      width: input.width,
      height: input.height,
      teamBuildZoneProjectionInputs: input.teamBuildZoneProjectionInputs,
      template: input.template,
      x: input.x,
      y: input.y,
      transformInput: input.transformInput,
    });

    if (projectedPlacement.reason) {
      return {
        projection: projectedPlacement.projection,
        reason: projectedPlacement.reason,
      };
    }

    let diffCells: number;
    try {
      diffCells = RtsEngine.compareTemplateAgainstGrid(
        input.grid,
        projectedPlacement.projection.templateGrid,
        projectedPlacement.projection.bounds,
      );
    } catch {
      return {
        projection: projectedPlacement.projection,
        reason: 'template-compare-failed',
      };
    }

    const needed = diffCells + input.templateActivationCost;
    const affordability = RtsEngine.evaluateAffordability(
      needed,
      input.teamResources,
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

  private static evaluateBuildPlacement(
    room: RoomState,
    team: TeamState,
    template: StructureTemplate,
    x: number,
    y: number,
    transformInput: PlacementTransformInput | null | undefined,
  ): EvaluatedBuildPlacement {
    return RtsEngine.evaluateBuildPlacementFromSnapshot({
      width: room.width,
      height: room.height,
      grid: room.grid,
      teamResources: team.resources,
      teamBuildZoneProjectionInputs:
        RtsEngine.collectTeamBuildZoneProjectionInputs(team),
      template: RtsEngine.createTemplateProjectionInput(template),
      templateActivationCost: template.activationCost,
      x,
      y,
      transformInput,
    });
  }

  private static clearDefeatedTeamEconomy(team: TeamState): void {
    team.income = 0;
    team.incomeBreakdown = {
      base: 0,
      structures: 0,
      total: 0,
      activeStructureCount: 0,
    };
  }

  private static refreshTeamEconomy(room: RoomState, team: TeamState): void {
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
  }

  private static processDueDestroyEvents(
    room: RoomState,
    team: TeamState,
    destroyOutcomes: DestroyOutcome[],
  ): void {
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
  }

  private static processDueBuildEvents(
    room: RoomState,
    team: TeamState,
    acceptedEvents: AcceptedBuildEvent[],
    buildOutcomes: BuildOutcome[],
  ): void {
    const deferredBuilds: BuildEvent[] = [];
    for (const event of team.pendingBuildEvents) {
      if (event.executeTick > room.tick) {
        deferredBuilds.push(event);
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
        evaluation.projection.bounds.x,
        evaluation.projection.bounds.y,
        evaluation.projection.bounds.width,
        evaluation.projection.bounds.height,
      );
      const isReservedInTick = acceptedEvents.some((candidate) => {
        return candidate.structureKey === key;
      });
      if (RtsEngine.findStructureOwnerTeam(room, key) || isReservedInTick) {
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
        x: evaluation.projection.bounds.x,
        y: evaluation.projection.bounds.y,
        structureKey: key,
        projection: evaluation.projection,
      });
    }

    team.pendingBuildEvents = deferredBuilds;
  }

  private static applyTeamEconomyAndQueue(
    room: RoomState,
    team: TeamState,
    acceptedEvents: AcceptedBuildEvent[],
    buildOutcomes: BuildOutcome[],
    destroyOutcomes: DestroyOutcome[],
  ): void {
    if (team.defeated) {
      RtsEngine.clearDefeatedTeamEconomy(team);
      return;
    }

    RtsEngine.refreshTeamEconomy(room, team);
    RtsEngine.processDueDestroyEvents(room, team, destroyOutcomes);
    RtsEngine.processDueBuildEvents(room, team, acceptedEvents, buildOutcomes);
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

  private static sortTeamsById(teams: Iterable<TeamState>): TeamState[] {
    return [...teams].sort((left, right) => left.id - right.id);
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
        const mismatchCount = mismatches.length;
        if (mismatchCount === 0) {
          structure.setActive(true);
          continue;
        }

        const restoreCost = mismatchCount * INTEGRITY_HP_COST_PER_CELL;
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
    return createDefaultStructureTemplates();
  }

  public static createRoom(options: CreateRoomOptions): RtsRoom {
    return RtsRoom.fromState(RtsEngine.createRoomState(options));
  }

  public static fromRoomState(room: RoomState): RtsRoom {
    return RtsRoom.fromState(room);
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
      grid: new Grid(options.width, options.height),
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
    options: AddPlayerToRoomOptions = {},
  ): TeamState {
    const existing = room.players.get(playerId);
    if (existing) {
      const existingTeam = room.teams.get(existing.teamId);
      if (existingTeam) {
        return existingTeam;
      }
    }

    const requestedTeam =
      options.teamId === undefined
        ? null
        : (room.teams.get(options.teamId) ?? null);
    if (requestedTeam) {
      requestedTeam.playerIds.add(playerId);
      if (options.teamName) {
        requestedTeam.name = options.teamName;
      }
      room.players.set(playerId, {
        id: playerId,
        name: playerName,
        teamId: requestedTeam.id,
      });
      return requestedTeam;
    }

    const teamId = options.teamId ?? RtsEngine.allocateTeamId(room);

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
      name: options.teamName ?? `${playerName}'s Team`,
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

  private static getBuildPreviewErrorMessage(
    reason: BuildRejectionReason | undefined,
  ): string | undefined {
    if (reason === 'outside-territory') {
      return 'Outside build zone - build closer to your structures.';
    }
    if (reason === 'template-exceeds-map-size') {
      return 'Template exceeds map size';
    }
    if (reason === 'insufficient-resources') {
      return 'Insufficient resources';
    }
    if (reason === 'template-compare-failed') {
      return 'Unable to compare template with current state';
    }

    return undefined;
  }

  private static createRejectedBuildPreviewResult(options: {
    reason: BuildRejectionReason;
    error: string;
    currentResources: number;
    x: number;
    y: number;
    transformInput: PlacementTransformInput | null | undefined;
  }): BuildPreviewResult {
    return {
      accepted: false,
      error: options.error,
      reason: options.reason,
      ...RtsEngine.createEmptyBuildProjection(
        options.x,
        options.y,
        options.transformInput,
      ),
      affordable: false,
      needed: 0,
      current: options.currentResources,
      deficit: 0,
    };
  }

  private static createBuildPreviewResult(
    evaluation: EvaluatedBuildPlacement,
    currentResources: number,
  ): BuildPreviewResult {
    return {
      accepted: evaluation.reason === undefined,
      reason: evaluation.reason,
      error: RtsEngine.getBuildPreviewErrorMessage(evaluation.reason),
      transform: evaluation.projection.transform,
      footprint: evaluation.projection.footprint,
      illegalCells: evaluation.projection.illegalCells,
      bounds: evaluation.projection.bounds,
      affordable: evaluation.affordability?.affordable ?? false,
      needed: evaluation.affordability?.needed ?? 0,
      current: evaluation.affordability?.current ?? currentResources,
      deficit: evaluation.affordability?.deficit ?? 0,
    };
  }

  public static previewBuildPlacementFromSnapshot(
    input: BuildPreviewSnapshotInput,
  ): BuildPreviewResult {
    const x = Number(input.x);
    const y = Number(input.y);

    if (input.teamDefeated) {
      return RtsEngine.createRejectedBuildPreviewResult({
        reason: 'team-defeated',
        error: 'Team is defeated',
        currentResources: input.teamResources,
        x,
        y,
        transformInput: input.transform,
      });
    }

    if (!input.template) {
      return RtsEngine.createRejectedBuildPreviewResult({
        reason: 'unknown-template',
        error: 'Unknown template',
        currentResources: input.teamResources,
        x,
        y,
        transformInput: input.transform,
      });
    }

    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return RtsEngine.createRejectedBuildPreviewResult({
        reason: 'invalid-coordinates',
        error: 'x and y must be integers',
        currentResources: input.teamResources,
        x,
        y,
        transformInput: input.transform,
      });
    }

    const evaluation = RtsEngine.evaluateBuildPlacementFromSnapshot({
      width: input.width,
      height: input.height,
      grid: input.grid,
      teamResources: input.teamResources,
      teamBuildZoneProjectionInputs: input.teamBuildZoneProjectionInputs,
      template: input.template,
      templateActivationCost: input.template.activationCost,
      x,
      y,
      transformInput: input.transform,
    });

    return RtsEngine.createBuildPreviewResult(evaluation, input.teamResources);
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
      return RtsEngine.createRejectedBuildPreviewResult({
        reason: 'team-defeated',
        error: 'Team is defeated',
        currentResources: team.resources,
        x,
        y,
        transformInput: payload.transform,
      });
    }

    const template = room.templateMap.get(payload.templateId);
    if (!template) {
      return RtsEngine.createRejectedBuildPreviewResult({
        reason: 'unknown-template',
        error: 'Unknown template',
        currentResources: team.resources,
        x,
        y,
        transformInput: payload.transform,
      });
    }

    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      return RtsEngine.createRejectedBuildPreviewResult({
        reason: 'invalid-coordinates',
        error: 'x and y must be integers',
        currentResources: team.resources,
        x,
        y,
        transformInput: payload.transform,
      });
    }

    const evaluation = RtsEngine.evaluateBuildPlacement(
      room,
      team,
      template,
      x,
      y,
      payload.transform,
    );

    return RtsEngine.createBuildPreviewResult(evaluation, team.resources);
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

    const delay = Number(payload.delayTicks ?? DEFAULT_QUEUE_DELAY_TICKS);
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
    const x = preview.bounds?.x ?? Number(payload.x);
    const y = preview.bounds?.y ?? Number(payload.y);
    const eventId = RtsEngine.allocateEventId(room);
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

    const ownerTeam = team.structures.has(structureKey)
      ? team
      : RtsEngine.findStructureOwnerTeam(room, structureKey);
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

    const delay = Number(payload.delayTicks ?? DEFAULT_QUEUE_DELAY_TICKS);
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
    const eventId = RtsEngine.allocateEventId(room);
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

  public static createDeterminismCheckpoint(
    room: RoomState,
  ): RoomDeterminismCheckpoint {
    const hashes = RtsEngine.createStateHashes(room);

    return {
      tick: room.tick,
      generation: room.generation,
      hashAlgorithm: 'fnv1a-32',
      hashHex: hashes.gridHash,
    };
  }

  public static createGridStatePayload(room: RoomState): RoomGridStatePayload {
    const hashes = RtsEngine.createStateHashes(room);
    return {
      roomId: room.id,
      width: room.width,
      height: room.height,
      generation: room.generation,
      tick: room.tick,
      grid: room.grid.toPacked(),
      hashAlgorithm: hashes.hashAlgorithm,
      hashHex: hashes.gridHash,
    };
  }

  public static createStructuresStatePayload(
    room: RoomState,
  ): RoomStructuresStatePayload {
    const hashes = RtsEngine.createStateHashes(room);
    const teams = RtsEngine.sortTeamsById(room.teams.values()).map((team) =>
      RtsEngine.createTeamStatePayload(room, team),
    );

    return {
      roomId: room.id,
      width: room.width,
      height: room.height,
      generation: room.generation,
      tick: room.tick,
      teams,
      hashAlgorithm: hashes.hashAlgorithm,
      hashHex: hashes.structuresHash,
    };
  }

  public static createStateHashes(room: RoomState): RoomStateHashes {
    let gridHash = RtsEngine.hashStateRoomScope(
      RtsEngine.FNV_OFFSET_BASIS,
      room,
    );
    gridHash = RtsEngine.hashBytes(
      gridHash,
      new Uint8Array(room.grid.toPacked()),
    );

    const orderedTeams = RtsEngine.sortTeamsById(room.teams.values());
    const structuresHash = RtsEngine.hashStructuresSection(room, orderedTeams);

    return {
      tick: room.tick,
      generation: room.generation,
      hashAlgorithm: 'fnv1a-32',
      gridHash: RtsEngine.formatHashHex(gridHash),
      structuresHash: RtsEngine.formatHashHex(structuresHash),
    };
  }

  public static createRoomStatePayload(room: RoomState): RoomStatePayload {
    const teams: TeamPayload[] = [];
    for (const team of RtsEngine.sortTeamsById(room.teams.values())) {
      teams.push(RtsEngine.createTeamStatePayload(room, team));
    }

    return {
      roomId: room.id,
      roomName: room.name,
      width: room.width,
      height: room.height,
      generation: room.generation,
      tick: room.tick,
      grid: room.grid.toPacked(),
      teams,
    };
  }

  public static createTeamOutcomeSnapshots(
    room: RoomState,
    coreHpBeforeResolution: ReadonlyMap<number, number> = new Map(),
  ): TeamOutcomeSnapshot[] {
    const snapshots: TeamOutcomeSnapshot[] = [];

    for (const team of RtsEngine.sortTeamsById(room.teams.values())) {
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

  private static applyAcceptedBuildEvents(
    room: RoomState,
    acceptedEvents: AcceptedBuildEvent[],
    buildOutcomes: BuildOutcome[],
  ): number {
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

    return appliedBuilds;
  }

  private static advanceGeneration(room: RoomState): void {
    room.grid.step();
    room.tick += 1;
    room.generation += 1;
  }

  private static resolveDefeatAndOutcome(
    room: RoomState,
    buildOutcomes: BuildOutcome[],
    destroyOutcomes: DestroyOutcome[],
  ): { defeatedTeams: number[]; outcome: MatchOutcome | null } {
    const coreHpBeforeResolution = RtsEngine.resolveIntegrityChecks(room);
    const defeatedTeams: number[] = [];
    const orderedTeams = RtsEngine.sortTeamsById(room.teams.values());

    for (const team of orderedTeams) {
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

    const undefeatedTeams = orderedTeams.filter((team) => !team.defeated);
    const outcome =
      defeatedTeams.length > 0 && undefeatedTeams.length <= 1
        ? RtsEngine.createCanonicalMatchOutcome(room, coreHpBeforeResolution)
        : null;

    if (outcome) {
      const teamsWithPending = orderedTeams.filter(
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

    return { defeatedTeams, outcome };
  }

  public static tickRoom(room: RoomState): RoomTickResult {
    const acceptedEvents: AcceptedBuildEvent[] = [];
    const buildOutcomes: BuildOutcome[] = [];
    const destroyOutcomes: DestroyOutcome[] = [];

    for (const team of RtsEngine.sortTeamsById(room.teams.values())) {
      RtsEngine.applyTeamEconomyAndQueue(
        room,
        team,
        acceptedEvents,
        buildOutcomes,
        destroyOutcomes,
      );
    }

    acceptedEvents.sort(RtsEngine.compareBuildEvents);

    const appliedBuilds = RtsEngine.applyAcceptedBuildEvents(
      room,
      acceptedEvents,
      buildOutcomes,
    );
    RtsEngine.advanceGeneration(room);
    const { defeatedTeams, outcome } = RtsEngine.resolveDefeatAndOutcome(
      room,
      buildOutcomes,
      destroyOutcomes,
    );

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

export class RtsRoom {
  private static readonly roomWrapperByState = new WeakMap<
    RoomState,
    RtsRoom
  >();

  public readonly state: RoomState;

  private constructor(state: RoomState) {
    this.state = state;
  }

  public static create(options: CreateRoomOptions): RtsRoom {
    return RtsEngine.createRoom(options);
  }

  public static fromState(state: RoomState): RtsRoom {
    if (!RtsEngine.hasRoomEngine(state)) {
      throw new Error(
        'RoomState must come from RtsEngine.createRoomState or RtsEngine.createRoom',
      );
    }

    const existing = RtsRoom.roomWrapperByState.get(state);
    if (existing) {
      return existing;
    }

    const wrapper = new RtsRoom(state);
    RtsRoom.roomWrapperByState.set(state, wrapper);
    return wrapper;
  }

  public get id(): string {
    return RtsEngine.getRoomId(this.state);
  }

  public get name(): string {
    return RtsEngine.getRoomName(this.state);
  }

  public get width(): number {
    return RtsEngine.getRoomWidth(this.state);
  }

  public get height(): number {
    return RtsEngine.getRoomHeight(this.state);
  }

  public getTemplate(templateId: string): StructureTemplate | null {
    return RtsEngine.getRoomTemplate(this.state, templateId);
  }

  public getTimelineEvents(): ReadonlyArray<TimelineEvent> {
    return RtsEngine.getTimelineEvents(this.state);
  }

  public addPlayer(
    playerId: string,
    playerName: string,
    options: AddPlayerToRoomOptions = {},
  ): TeamState {
    return RtsEngine.addPlayerToRoom(this.state, playerId, playerName, options);
  }

  public renamePlayer(playerId: string, name: string): void {
    RtsEngine.renamePlayerInRoom(this.state, playerId, name);
  }

  public removePlayer(playerId: string): void {
    RtsEngine.removePlayerFromRoom(this.state, playerId);
  }

  public previewBuildPlacement(
    playerId: string,
    payload: BuildQueuePayload,
  ): BuildPreviewResult {
    return RtsEngine.previewBuildPlacement(this.state, playerId, payload);
  }

  public queueBuildEvent(
    playerId: string,
    payload: BuildQueuePayload,
  ): QueueBuildResult {
    return RtsEngine.queueBuildEvent(this.state, playerId, payload);
  }

  public queueDestroyEvent(
    playerId: string,
    payload: DestroyQueuePayload,
  ): QueueDestroyResult {
    return RtsEngine.queueDestroyEvent(this.state, playerId, payload);
  }

  public createStatePayload(): RoomStatePayload {
    return RtsEngine.createRoomStatePayload(this.state);
  }

  public createGridStatePayload(): RoomGridStatePayload {
    return RtsEngine.createGridStatePayload(this.state);
  }

  public createStructuresStatePayload(): RoomStructuresStatePayload {
    return RtsEngine.createStructuresStatePayload(this.state);
  }

  public createStateHashes(): RoomStateHashes {
    return RtsEngine.createStateHashes(this.state);
  }

  public createDeterminismCheckpoint(): RoomDeterminismCheckpoint {
    return RtsEngine.createDeterminismCheckpoint(this.state);
  }

  public createTeamOutcomeSnapshots(
    coreHpBeforeResolution: ReadonlyMap<number, number> = new Map(),
  ): TeamOutcomeSnapshot[] {
    return RtsEngine.createTeamOutcomeSnapshots(
      this.state,
      coreHpBeforeResolution,
    );
  }

  public createCanonicalMatchOutcome(
    coreHpBeforeResolution: ReadonlyMap<number, number> = new Map(),
  ): MatchOutcome | null {
    return RtsEngine.createCanonicalMatchOutcome(
      this.state,
      coreHpBeforeResolution,
    );
  }

  public tick(): RoomTickResult {
    return RtsEngine.tickRoom(this.state);
  }
}
