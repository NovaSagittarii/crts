import { describe, expect, test } from 'vitest';
import { Grid } from '#conway-core';

import {
  BASE_FOOTPRINT_HEIGHT,
  BASE_FOOTPRINT_WIDTH,
  getBaseCenter,
  getCanonicalBaseCells,
  isCanonicalBaseCell,
} from './geometry.js';
import { BUILD_ZONE_RADIUS } from './gameplay-rules.js';
import { RtsEngine, RtsRoom } from './rts.js';
import { StructureTemplate } from './structure.js';

interface Cell {
  x: number;
  y: number;
}

interface BuildOutcomeRecord {
  eventId: number;
  teamId: number;
  outcome: 'applied' | 'rejected';
  reason?: string;
  executeTick: number;
  resolvedTick: number;
}

type RoomState = ReturnType<typeof RtsEngine.createRoomState>;
type RoomPayload = ReturnType<typeof RtsEngine.createRoomStatePayload>;
type TeamPayload = RoomPayload['teams'][number];
type StructurePayload = TeamPayload['structures'][number];

function getTeamPayload(room: RoomState, teamId: number): TeamPayload | null {
  return (
    RtsEngine.createRoomStatePayload(room).teams.find(
      (team) => team.id === teamId,
    ) ?? null
  );
}

function requireTeamPayload(room: RoomState, teamId: number): TeamPayload {
  const teamPayload = getTeamPayload(room, teamId);
  if (!teamPayload) {
    throw new Error(`Expected payload team ${String(teamId)} to exist`);
  }

  return teamPayload;
}

function getCoreStructure(
  room: RoomState,
  teamId: number,
): {
  key: string;
  hp: number;
  active: boolean;
  isCore: boolean;
} | null {
  return (
    getTeamPayload(room, teamId)?.structures.find(
      (structure) => structure.isCore,
    ) ?? null
  );
}

function getCellAlive(
  grid: ArrayBuffer,
  width: number,
  height: number,
  cell: Cell,
): boolean {
  const unpackedGrid = Grid.fromPacked(grid, width, height, 'flat');
  return unpackedGrid.isCellAlive(cell.x, cell.y);
}

function getBuildOutcomes(
  result: ReturnType<typeof RtsEngine.tickRoom>,
): BuildOutcomeRecord[] {
  return (
    (
      result as ReturnType<typeof RtsEngine.tickRoom> & {
        buildOutcomes?: BuildOutcomeRecord[];
      }
    ).buildOutcomes ?? []
  );
}

function probeQueueBuild(
  room: RoomState,
  playerId: string,
  payload: { templateId: string; x: number; y: number; delayTicks?: number },
): ReturnType<typeof RtsEngine.previewBuildPlacement> {
  return RtsEngine.previewBuildPlacement(room, playerId, payload);
}

function getRoomId(room: RoomState): string {
  return room.id;
}

function getRoomWidth(room: RoomState): number {
  return room.width;
}

function getRoomHeight(room: RoomState): number {
  return room.height;
}

function getStructureByTemplateId(
  room: RoomState,
  teamId: number,
  templateId: string,
): StructurePayload | null {
  return (
    getTeamPayload(room, teamId)?.structures.find(
      (candidate) => candidate.templateId === templateId,
    ) ?? null
  );
}

function countStructuresByTemplateId(
  room: RoomState,
  teamId: number,
  templateId: string,
): number {
  const team = room.teams.get(teamId);
  if (!team) {
    return 0;
  }

  let count = 0;
  for (const structure of team.structures.values()) {
    if (structure.templateId === templateId) {
      count += 1;
    }
  }

  return count;
}

function createTemplateGrid(
  width: number,
  height: number,
  cells: readonly number[],
): Grid {
  if (cells.length !== width * height) {
    throw new Error('Template test cells must match width and height');
  }

  const aliveCells: Cell[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (cells[y * width + x] !== 1) {
        continue;
      }

      aliveCells.push({ x, y });
    }
  }

  return new Grid(width, height, aliveCells, 'flat');
}

describe('rts', () => {
  test('provides default structure templates with expected metadata', () => {
    const templates = RtsEngine.createDefaultTemplates();

    expect(templates.map(({ id }) => id)).toEqual([
      'block',
      'generator',
      'glider',
      'eater-1',
      'gosper',
    ]);

    const generator = templates.find(({ id }) => id === 'generator');
    expect(generator).toBeDefined();
    expect(generator?.width).toBe(4);
    expect(generator?.height).toBe(4);
    expect(generator?.activationCost).toBe(6);
    expect(generator?.income).toBe(2);
    expect(generator?.checks).toHaveLength(0);
  });

  test('clones grid-backed template input during construction', () => {
    const sourceGrid = new Grid(2, 2, [{ x: 0, y: 0 }], 'flat');

    const template = new StructureTemplate({
      id: 'grid-probe',
      name: 'Grid Probe',
      grid: sourceGrid,
      activationCost: 0,
      income: 0,
      buildArea: 0,
      startingHp: 2,
      checks: [],
    });

    sourceGrid.setCell(1, 1, true);

    expect(template.width).toBe(2);
    expect(template.height).toBe(2);
    expect(template.isCellAlive(0, 0)).toBe(true);
    expect(template.isCellAlive(1, 1)).toBe(false);
    expect(template.isCellAlive(1, 0)).toBe(false);
  });

  test('provides a cached room instance API while preserving static parity', () => {
    const room = RtsEngine.createRoom({
      id: 'instance-room',
      name: 'Instance Room',
      width: 48,
      height: 48,
    });

    expect(room).toBe(RtsEngine.fromRoomState(room.state));
    expect(room).toBe(RtsRoom.fromState(room.state));
    expect(room.id).toBe(RtsEngine.getRoomId(room.state));
    expect(room.name).toBe(RtsEngine.getRoomName(room.state));
    expect(room.width).toBe(RtsEngine.getRoomWidth(room.state));
    expect(room.height).toBe(RtsEngine.getRoomHeight(room.state));

    const team = room.addPlayer('p1', 'Alice');
    expect(team.id).toBe(1);

    expect(room.getTemplate('block')?.id).toBe('block');
    expect(room.getTimelineEvents()).toEqual(
      RtsEngine.getTimelineEvents(room.state),
    );
    expect(room.createStatePayload()).toEqual(
      RtsEngine.createRoomStatePayload(room.state),
    );

    const missingBuild = room.queueBuildEvent('missing-player', {
      templateId: 'block',
      x: 0,
      y: 0,
    });
    expect(missingBuild.accepted).toBe(false);
    expect(room.tick()).toEqual(RtsEngine.tickRoom(room.state));
  });

  test('rejects detached room states for instance wrappers', () => {
    const room = RtsEngine.createRoom({
      id: 'detached-room',
      name: 'Detached Room',
      width: 32,
      height: 32,
    });

    const detachedState = {
      ...room.state,
      teams: new Map(room.state.teams),
      players: new Map(room.state.players),
      templates: [...room.state.templates],
    } as unknown as ReturnType<typeof RtsEngine.createRoomState>;

    expect(() => RtsEngine.fromRoomState(detachedState)).toThrow(
      'RoomState must come from RtsEngine.createRoomState or RtsEngine.createRoom',
    );
    expect(() => RtsRoom.fromState(detachedState)).toThrow(
      'RoomState must come from RtsEngine.createRoomState or RtsEngine.createRoom',
    );
  });

  test('adds players, seeds base cells, and lists room occupancy', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 40,
      height: 40,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    expect(team.id).toBe(1);
    expect(room.players.get('p1')?.teamId).toBe(team.id);

    const payload = RtsEngine.createRoomStatePayload(room);
    const base = team.baseTopLeft;
    const baseCells = getCanonicalBaseCells(base);
    expect(baseCells).toHaveLength(16);

    for (let localY = 0; localY < BASE_FOOTPRINT_HEIGHT; localY += 1) {
      for (let localX = 0; localX < BASE_FOOTPRINT_WIDTH; localX += 1) {
        const expectedAlive = isCanonicalBaseCell(localX, localY);
        const alive = getCellAlive(
          payload.grid,
          getRoomWidth(room),
          getRoomHeight(room),
          {
            x: base.x + localX,
            y: base.y + localY,
          },
        );
        expect(alive).toBe(expectedAlive);
      }
    }

    const rooms = RtsEngine.listRooms(new Map([[getRoomId(room), room]]));
    expect(rooms).toEqual([
      {
        roomId: '1',
        name: 'Alpha',
        width: 40,
        height: 40,
        players: 1,
        teams: 1,
      },
    ]);
  });

  test('renames and removes room players with team cleanup', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 32,
      height: 32,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    RtsEngine.renamePlayerInRoom(room, 'p1', 'Alicia');
    expect(room.players.get('p1')?.name).toBe('Alicia');
    expect(room.teams.get(team.id)?.name).toBe(`Alicia's Team`);

    RtsEngine.removePlayerFromRoom(room, 'p1');
    expect(room.players.has('p1')).toBe(false);
    expect(room.teams.has(team.id)).toBe(false);
  });

  test('[QUAL-01] validates queue rejection reasons and delay clamping', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 80,
      height: 80,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    const unknownPlayer = RtsEngine.queueBuildEvent(room, 'missing', {
      templateId: 'block',
      x: 0,
      y: 0,
    });
    expect(unknownPlayer.accepted).toBe(false);

    const unknownTemplate = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'not-a-template',
      x: 10,
      y: 10,
    });
    expect(unknownTemplate.accepted).toBe(false);

    const nonInteger = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: 10.5,
      y: 10,
    });
    expect(nonInteger.accepted).toBe(false);

    const outsideBounds = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: 79,
      y: 79,
    });
    expect(outsideBounds.accepted).toBe(false);
    expect(outsideBounds.reason).toBe('outside-territory');
    expect(RtsEngine.getTimelineEvents(room).at(-1)?.metadata?.reason).toBe(
      'outside-territory',
    );

    const blockTemplate = RtsEngine.getRoomTemplate(room, 'block');
    expect(blockTemplate).toBeDefined();
    const blockWidth = blockTemplate?.width ?? 0;
    const blockHeight = blockTemplate?.height ?? 0;
    const baseCenter = getBaseCenter(team.baseTopLeft);
    const outsideOffset = Math.floor(BUILD_ZONE_RADIUS) + 1;

    let outsideTerritoryCoordinate: Cell | null = null;
    for (const direction of [1, -1] as const) {
      const candidateX = baseCenter.x + direction * outsideOffset;
      const candidateY = Math.max(
        0,
        Math.min(baseCenter.y, getRoomHeight(room) - 1),
      );
      if (candidateX < 0 || candidateX + blockWidth > getRoomWidth(room)) {
        continue;
      }
      if (candidateY + blockHeight > getRoomHeight(room)) {
        continue;
      }

      outsideTerritoryCoordinate = {
        x: candidateX,
        y: candidateY,
      };
      break;
    }

    expect(outsideTerritoryCoordinate).not.toBeNull();

    const outsideTerritory = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: outsideTerritoryCoordinate?.x ?? 0,
      y: outsideTerritoryCoordinate?.y ?? 0,
    });
    expect(outsideTerritory.accepted).toBe(false);
    expect(outsideTerritory.reason).toBe('outside-territory');
    expect(RtsEngine.getTimelineEvents(room).at(-1)?.metadata?.reason).toBe(
      'outside-territory',
    );

    const invalidDelay = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 6,
      delayTicks: 1.5,
    });
    expect(invalidDelay.accepted).toBe(false);
    expect(invalidDelay.error).toBe('delayTicks must be an integer');
    const timelineEvents = RtsEngine.getTimelineEvents(room);
    const invalidDelayEvent = timelineEvents[timelineEvents.length - 1];
    expect(invalidDelayEvent?.metadata?.reason).toBe('invalid-delay');

    const delayLow = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 6,
      delayTicks: 0,
    });
    expect(delayLow.accepted).toBe(true);
    expect(delayLow.executeTick).toBe(1);

    const delayHigh = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
      delayTicks: 999,
    });
    expect(delayHigh.accepted).toBe(true);
    expect(delayHigh.executeTick).toBe(20);

    const queuedRows = requireTeamPayload(room, team.id).pendingBuilds;
    expect(queuedRows.map(({ executeTick }) => executeTick)).toEqual([1, 20]);
  });

  test('[BUILD-02] enforces inclusive radius-15 union-zone checks', () => {
    const probeTemplate = new StructureTemplate({
      id: 'probe',
      name: 'Probe',
      grid: createTemplateGrid(1, 1, [1]),
      activationCost: 0,
      income: 0,
      buildArea: 0,
      startingHp: 2,
      checks: [],
    });

    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 80,
      height: 80,
      templates: [...RtsEngine.createDefaultTemplates(), probeTemplate],
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const baseCenter = getBaseCenter(team.baseTopLeft);
    const blockTemplate = RtsEngine.getRoomTemplate(room, 'block');
    expect(blockTemplate).toBeDefined();
    const insideOffset = Math.floor(BUILD_ZONE_RADIUS);
    const outsideOffset = insideOffset + 1;

    let direction: 1 | -1 | null = null;
    for (const candidate of [1, -1] as const) {
      const insideX = baseCenter.x + candidate * insideOffset;
      const outsideX = baseCenter.x + candidate * outsideOffset;
      const blockX = baseCenter.x + candidate * insideOffset;
      if (insideX < 0 || insideX >= getRoomWidth(room)) {
        continue;
      }
      if (outsideX < 0 || outsideX >= getRoomWidth(room)) {
        continue;
      }
      if (
        blockX < 0 ||
        blockX + (blockTemplate?.width ?? 0) > getRoomWidth(room) ||
        baseCenter.y + (blockTemplate?.height ?? 0) > getRoomHeight(room)
      ) {
        continue;
      }
      direction = candidate;
      break;
    }

    expect(direction).not.toBeNull();
    if (direction === null) {
      throw new Error('Unable to locate in-bounds boundary direction');
    }

    const y = Math.max(0, Math.min(baseCenter.y, getRoomHeight(room) - 1));
    const boundary = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'probe',
      x: baseCenter.x + direction * insideOffset,
      y,
      delayTicks: 1,
    });
    expect(boundary.accepted).toBe(true);

    const outside = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'probe',
      x: baseCenter.x + direction * outsideOffset,
      y,
      delayTicks: 1,
    });
    expect(outside.accepted).toBe(false);
    expect(outside.reason).toBe('outside-territory');

    const footprintOverflow = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: baseCenter.x + direction * insideOffset,
      y,
      delayTicks: 1,
    });
    expect(footprintOverflow.accepted).toBe(false);
    expect(footprintOverflow.reason).toBe('outside-territory');
  });

  test('accepts torus-wrapped placements and rejects transformed templates that exceed map size', () => {
    const wideTemplate = new StructureTemplate({
      id: 'wide-13',
      name: 'Wide 13',
      grid: createTemplateGrid(13, 1, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]),
      activationCost: 0,
      income: 0,
      buildArea: 0,
      startingHp: 2,
      checks: [],
    });

    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 12,
      height: 12,
      templates: [...RtsEngine.createDefaultTemplates(), wideTemplate],
    });
    RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    const wrappedPreview = RtsEngine.previewBuildPlacement(room, 'p1', {
      templateId: 'block',
      x: 11,
      y: 11,
    });

    expect(wrappedPreview.accepted).toBe(true);
    expect(wrappedPreview.reason).toBeUndefined();
    expect(wrappedPreview.bounds).toEqual({
      x: 11,
      y: 11,
      width: 2,
      height: 2,
    });
    expect(
      new Set(
        (wrappedPreview.footprint ?? []).map((cell) => `${cell.x},${cell.y}`),
      ),
    ).toEqual(new Set(['11,11', '0,11', '11,0', '0,0']));

    const overflowPayload = {
      templateId: wideTemplate.id,
      x: 0,
      y: 0,
      transform: {
        operations: ['rotate' as const],
      },
    };

    const overflowPreview = RtsEngine.previewBuildPlacement(
      room,
      'p1',
      overflowPayload,
    );
    expect(overflowPreview.accepted).toBe(false);
    expect(overflowPreview.reason).toBe('template-exceeds-map-size');
    expect(overflowPreview.transform?.operations).toEqual(['rotate']);
    expect(overflowPreview.bounds).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 13,
    });
    expect(overflowPreview.footprint).toEqual([]);
    expect(overflowPreview.illegalCells).toEqual([]);

    const overflowQueue = RtsEngine.queueBuildEvent(
      room,
      'p1',
      overflowPayload,
    );
    expect(overflowQueue.accepted).toBe(false);
    expect(overflowQueue.reason).toBe('template-exceeds-map-size');
    expect(RtsEngine.getTimelineEvents(room).at(-1)?.metadata?.reason).toBe(
      'template-exceeds-map-size',
    );
  });

  test('normalizes wrapped-equivalent anchors to one occupied site key', () => {
    const probeTemplate = new StructureTemplate({
      id: 'probe',
      name: 'Probe',
      grid: createTemplateGrid(1, 1, [1]),
      activationCost: 0,
      income: 0,
      buildArea: 0,
      startingHp: 2,
      checks: [],
    });

    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 80,
      height: 80,
      templates: [...RtsEngine.createDefaultTemplates(), probeTemplate],
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const baseCenter = getBaseCenter(team.baseTopLeft);
    const insideOffset = Math.floor(BUILD_ZONE_RADIUS);

    let x: number | null = null;
    for (const direction of [1, -1] as const) {
      const candidateX = baseCenter.x + direction * insideOffset;
      if (candidateX < 0 || candidateX >= getRoomWidth(room)) {
        continue;
      }

      x = candidateX;
      break;
    }

    expect(x).not.toBeNull();
    if (x === null) {
      throw new Error('Unable to find wrapped anchor candidate');
    }

    const y = Math.max(0, Math.min(baseCenter.y, getRoomHeight(room) - 1));

    const first = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'probe',
      x,
      y,
      delayTicks: 1,
    });
    expect(first.accepted).toBe(true);

    const aliased = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'probe',
      x: x + getRoomWidth(room),
      y,
      delayTicks: 1,
    });
    expect(aliased.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    const tick = RtsEngine.tickRoom(room);
    const applied = tick.buildOutcomes.filter((outcome) => {
      return outcome.outcome === 'applied';
    });
    const rejected = tick.buildOutcomes.filter((outcome) => {
      return outcome.outcome === 'rejected';
    });

    expect(applied).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBe('occupied-site');
    expect(countStructuresByTemplateId(room, team.id, 'probe')).toBe(1);
  });

  test('[BUILD-01] updates union-zone eligibility after build completion and structure destruction', () => {
    const probeTemplate = new StructureTemplate({
      id: 'probe',
      name: 'Probe',
      grid: createTemplateGrid(1, 1, [1]),
      activationCost: 0,
      income: 0,
      buildArea: 0,
      startingHp: 2,
      checks: [],
    });

    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 120,
      height: 120,
      templates: [...RtsEngine.createDefaultTemplates(), probeTemplate],
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const baseCenter = getBaseCenter(team.baseTopLeft);
    const remoteOffset = Math.floor(BUILD_ZONE_RADIUS);

    let setup: {
      contributorX: number;
      contributorY: number;
      remoteX: number;
      remoteY: number;
    } | null = null;

    for (const direction of [1, -1] as const) {
      const contributorX = baseCenter.x + direction * 13;
      const contributorY = Math.max(
        0,
        Math.min(baseCenter.y, getRoomHeight(room) - 2),
      );
      const contributorCenterX = contributorX + 1;
      const contributorCenterY = contributorY + 1;
      const remoteX = contributorCenterX + direction * remoteOffset;
      const remoteY = contributorCenterY;

      if (contributorX < 0 || contributorX + 2 > getRoomWidth(room)) {
        continue;
      }
      if (remoteX < 0 || remoteX >= getRoomWidth(room)) {
        continue;
      }

      setup = {
        contributorX,
        contributorY,
        remoteX,
        remoteY,
      };
      break;
    }

    expect(setup).not.toBeNull();
    if (!setup) {
      throw new Error('Unable to derive union-zone expansion coordinates');
    }

    const beforeExpansion = probeQueueBuild(room, 'p1', {
      templateId: 'probe',
      x: setup.remoteX,
      y: setup.remoteY,
      delayTicks: 1,
    });
    expect(beforeExpansion.accepted).toBe(false);
    expect(beforeExpansion.reason).toBe('outside-territory');

    const contributor = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: setup.contributorX,
      y: setup.contributorY,
      delayTicks: 1,
    });
    expect(contributor.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    const afterExpansion = probeQueueBuild(room, 'p1', {
      templateId: 'probe',
      x: setup.remoteX,
      y: setup.remoteY,
      delayTicks: 1,
    });
    expect(afterExpansion.accepted).toBe(true);

    const blockCells = [
      { x: setup.contributorX, y: setup.contributorY },
      { x: setup.contributorX + 1, y: setup.contributorY },
      { x: setup.contributorX, y: setup.contributorY + 1 },
      { x: setup.contributorX + 1, y: setup.contributorY + 1 },
    ];
    for (const cell of blockCells) {
      RtsEngine.queueLegacyCellUpdate(room, {
        x: cell.x,
        y: cell.y,
        alive: 0,
      });
    }

    let destroyedContributor = getStructureByTemplateId(room, team.id, 'block');
    for (let index = 0; index < 8 && destroyedContributor; index += 1) {
      RtsEngine.tickRoom(room);
      destroyedContributor = getStructureByTemplateId(room, team.id, 'block');
    }

    expect(destroyedContributor).toBeNull();

    const afterDestruction = probeQueueBuild(room, 'p1', {
      templateId: 'probe',
      x: setup.remoteX,
      y: setup.remoteY,
      delayTicks: 1,
    });
    expect(afterDestruction.accepted).toBe(false);
    expect(afterDestruction.reason).toBe('outside-territory');
  });

  test('[STRUCT-02] validates destroy ownership rules, idempotency, and pending retargeting', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 90,
      height: 90,
    });
    const teamOne = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const teamTwo = RtsEngine.addPlayerToRoom(room, 'p2', 'Bob');

    const queuedBuild = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: teamOne.baseTopLeft.x + 8,
      y: teamOne.baseTopLeft.y + 8,
      delayTicks: 1,
    });
    expect(queuedBuild.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    const ownStructure = getStructureByTemplateId(room, teamOne.id, 'block');
    expect(ownStructure).not.toBeNull();
    if (!ownStructure) {
      throw new Error('Expected own block structure to exist');
    }

    const wrongOwner = RtsEngine.queueDestroyEvent(room, 'p2', {
      structureKey: ownStructure.key,
      delayTicks: 2,
    });
    expect(wrongOwner.accepted).toBe(false);
    expect(wrongOwner.reason).toBe('wrong-owner');
    expect(requireTeamPayload(room, teamTwo.id).pendingDestroys).toHaveLength(
      0,
    );

    const teamOneStructure = room.teams
      .get(teamOne.id)
      ?.structures.get(ownStructure.key);
    const teamTwoState = room.teams.get(teamTwo.id);
    if (!teamOneStructure || !teamTwoState) {
      throw new Error('Expected both teams to be present in room state');
    }
    teamTwoState.structures.set(
      ownStructure.key,
      teamOneStructure.template.instantiate({
        key: ownStructure.key,
        x: teamOneStructure.x,
        y: teamOneStructure.y,
        transform: teamOneStructure.transform,
        active: true,
        isCore: false,
      }),
    );

    const ownDuplicateKey = RtsEngine.queueDestroyEvent(room, 'p2', {
      structureKey: ownStructure.key,
      delayTicks: 2,
    });
    expect(ownDuplicateKey.accepted).toBe(true);
    expect(ownDuplicateKey.idempotent).toBe(false);

    const invalidTarget = RtsEngine.queueDestroyEvent(room, 'p1', {
      structureKey: 'missing-structure-key',
      delayTicks: 2,
    });
    expect(invalidTarget.accepted).toBe(false);
    expect(invalidTarget.reason).toBe('invalid-target');

    const first = RtsEngine.queueDestroyEvent(room, 'p1', {
      structureKey: ownStructure.key,
      delayTicks: 3,
    });
    expect(first.accepted).toBe(true);
    expect(first.idempotent).toBe(false);

    const duplicate = RtsEngine.queueDestroyEvent(room, 'p1', {
      structureKey: ownStructure.key,
      delayTicks: 3,
    });
    expect(duplicate.accepted).toBe(true);
    expect(duplicate.idempotent).toBe(true);
    expect(duplicate.eventId).toBe(first.eventId);
    expect(duplicate.executeTick).toBe(first.executeTick);

    const ownCore = getCoreStructure(room, teamOne.id);
    expect(ownCore).not.toBeNull();
    if (!ownCore) {
      throw new Error('Expected own core structure in room payload');
    }
    const retarget = RtsEngine.queueDestroyEvent(room, 'p1', {
      structureKey: ownCore.key,
      delayTicks: 3,
    });
    expect(retarget.accepted).toBe(true);
    expect(retarget.eventId).not.toBe(first.eventId);

    const pendingDestroys = requireTeamPayload(
      room,
      teamOne.id,
    ).pendingDestroys;
    expect(pendingDestroys).toHaveLength(2);
  });

  test('[STRUCT-02] applies queued destroy outcomes and removes contributor build zone', () => {
    const probeTemplate = new StructureTemplate({
      id: 'probe',
      name: 'Probe',
      grid: createTemplateGrid(1, 1, [1]),
      activationCost: 0,
      income: 0,
      buildArea: 0,
      startingHp: 2,
      checks: [],
    });

    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 120,
      height: 120,
      templates: [...RtsEngine.createDefaultTemplates(), probeTemplate],
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const baseCenter = getBaseCenter(team.baseTopLeft);
    const remoteOffset = Math.floor(BUILD_ZONE_RADIUS);

    let setup: {
      contributorX: number;
      contributorY: number;
      remoteX: number;
      remoteY: number;
    } | null = null;

    for (const direction of [1, -1] as const) {
      const contributorX = baseCenter.x + direction * 13;
      const contributorY = Math.max(
        0,
        Math.min(baseCenter.y, getRoomHeight(room) - 2),
      );
      const contributorCenterX = contributorX + 1;
      const contributorCenterY = contributorY + 1;
      const remoteX = contributorCenterX + direction * remoteOffset;
      const remoteY = contributorCenterY;

      if (contributorX < 0 || contributorX + 2 > getRoomWidth(room)) {
        continue;
      }
      if (remoteX < 0 || remoteX >= getRoomWidth(room)) {
        continue;
      }

      setup = {
        contributorX,
        contributorY,
        remoteX,
        remoteY,
      };
      break;
    }

    expect(setup).not.toBeNull();
    if (!setup) {
      throw new Error('Unable to derive contributor placement coordinates');
    }

    const contributor = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: setup.contributorX,
      y: setup.contributorY,
      delayTicks: 1,
    });
    expect(contributor.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    const expanded = probeQueueBuild(room, 'p1', {
      templateId: 'probe',
      x: setup.remoteX,
      y: setup.remoteY,
      delayTicks: 1,
    });
    expect(expanded.accepted).toBe(true);

    const builtContributor = getStructureByTemplateId(room, team.id, 'block');
    expect(builtContributor).not.toBeNull();
    if (!builtContributor) {
      throw new Error('Expected contributor structure to exist before destroy');
    }

    const queuedDestroy = RtsEngine.queueDestroyEvent(room, 'p1', {
      structureKey: builtContributor.key,
      delayTicks: 1,
    });
    expect(queuedDestroy.accepted).toBe(true);

    const preDue = RtsEngine.tickRoom(room);
    expect(preDue.destroyOutcomes).toEqual([]);

    const resolved = RtsEngine.tickRoom(room);
    expect(resolved.destroyOutcomes).toEqual([
      {
        eventId: queuedDestroy.eventId,
        teamId: team.id,
        structureKey: builtContributor.key,
        templateId: 'block',
        outcome: 'destroyed',
        executeTick: queuedDestroy.executeTick,
        resolvedTick: queuedDestroy.executeTick,
      },
    ]);

    const afterDestroy = probeQueueBuild(room, 'p1', {
      templateId: 'probe',
      x: setup.remoteX,
      y: setup.remoteY,
      delayTicks: 1,
    });
    expect(afterDestroy.accepted).toBe(false);
    expect(afterDestroy.reason).toBe('outside-territory');

    const staleDestroy = RtsEngine.queueDestroyEvent(room, 'p1', {
      structureKey: builtContributor.key,
      delayTicks: 1,
    });
    expect(staleDestroy.accepted).toBe(false);
    expect(staleDestroy.reason).toBe('invalid-lifecycle-state');
  });

  test('[QUAL-04] keeps destroy outcomes deterministic across equal-run simulations', () => {
    function runDestroySequence(): {
      destroyOutcomes: ReturnType<typeof RtsEngine.tickRoom>['destroyOutcomes'];
      payload: ReturnType<typeof RtsEngine.createRoomStatePayload>;
    } {
      const room = RtsEngine.createRoomState({
        id: 'deterministic-room',
        name: 'Deterministic',
        width: 80,
        height: 80,
      });
      const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

      const queuedBuild = RtsEngine.queueBuildEvent(room, 'p1', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
        delayTicks: 1,
      });
      expect(queuedBuild.accepted).toBe(true);

      RtsEngine.tickRoom(room);
      RtsEngine.tickRoom(room);

      const placed = getStructureByTemplateId(room, team.id, 'block');
      if (!placed) {
        throw new Error('Expected placed block before destroy sequence');
      }

      const queuedDestroy = RtsEngine.queueDestroyEvent(room, 'p1', {
        structureKey: placed.key,
        delayTicks: 1,
      });
      expect(queuedDestroy.accepted).toBe(true);

      RtsEngine.tickRoom(room);
      const resolved = RtsEngine.tickRoom(room);

      return {
        destroyOutcomes: resolved.destroyOutcomes,
        payload: RtsEngine.createRoomStatePayload(room),
      };
    }

    const firstRun = runDestroySequence();
    const secondRun = runDestroySequence();

    expect(firstRun.destroyOutcomes).toEqual(secondRun.destroyOutcomes);

    const firstTeam = firstRun.payload.teams[0];
    const secondTeam = secondRun.payload.teams[0];
    expect(firstTeam?.pendingDestroys).toEqual([]);
    expect(secondTeam?.pendingDestroys).toEqual([]);
    expect(firstTeam?.structures).toEqual(secondTeam?.structures);
  });

  test('[QUAL-01] rejects insufficient resources with numeric deficit fields', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 70,
      height: 70,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    team.resources = 9;
    const result = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'generator',
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 6,
      delayTicks: 1,
    });

    expect(result).toMatchObject({
      accepted: false,
      reason: 'insufficient-resources',
      current: 9,
    });
    expect(result.needed).toEqual(expect.any(Number));
    expect(result.deficit).toEqual(expect.any(Number));
    expect(result.deficit).toBe((result.needed ?? 0) - (result.current ?? 0));
    expect(requireTeamPayload(room, team.id).pendingBuilds).toHaveLength(0);
    expect(RtsEngine.getTimelineEvents(room).at(-1)?.metadata?.reason).toBe(
      'insufficient-resources',
    );
  });

  test('[QUAL-01] keeps queue sequencing isolated per room instance', () => {
    const roomA = RtsEngine.createRoomState({
      id: 'room-a',
      name: 'Alpha',
      width: 60,
      height: 60,
    });
    const roomB = RtsEngine.createRoomState({
      id: 'room-b',
      name: 'Bravo',
      width: 60,
      height: 60,
    });

    const teamA = RtsEngine.addPlayerToRoom(roomA, 'p1', 'Alice');
    const teamB = RtsEngine.addPlayerToRoom(roomB, 'p1', 'Alice');

    const queueA = RtsEngine.queueBuildEvent(roomA, 'p1', {
      templateId: 'block',
      x: teamA.baseTopLeft.x + 4,
      y: teamA.baseTopLeft.y + 4,
      delayTicks: 1,
    });
    const queueB = RtsEngine.queueBuildEvent(roomB, 'p1', {
      templateId: 'block',
      x: teamB.baseTopLeft.x + 4,
      y: teamB.baseTopLeft.y + 4,
      delayTicks: 1,
    });

    expect(queueA).toMatchObject({
      accepted: true,
      eventId: 1,
      executeTick: 1,
    });
    expect(queueB).toMatchObject({
      accepted: true,
      eventId: 1,
      executeTick: 1,
    });

    RtsEngine.tickRoom(roomA);
    const resolvedA = RtsEngine.tickRoom(roomA);

    expect(getBuildOutcomes(resolvedA)).toHaveLength(1);

    expect(RtsEngine.createRoomStatePayload(roomB).tick).toBe(0);
    expect(requireTeamPayload(roomB, teamB.id).pendingBuilds).toHaveLength(1);
  });

  test('projects pending queue rows sorted by executeTick then eventId', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 80,
      height: 80,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    const first = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 4,
      y: team.baseTopLeft.y + 4,
      delayTicks: 5,
    });
    const second = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'glider',
      x: team.baseTopLeft.x + 7,
      y: team.baseTopLeft.y + 4,
      delayTicks: 3,
    });
    const third = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'generator',
      x: team.baseTopLeft.x + 10,
      y: team.baseTopLeft.y + 4,
      delayTicks: 5,
    });

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(third.accepted).toBe(true);

    const payload = RtsEngine.createRoomStatePayload(room);
    const projectedTeam = payload.teams.find(({ id }) => id === team.id);

    expect(projectedTeam).toBeDefined();
    const pendingProjection =
      projectedTeam?.pendingBuilds.map(
        ({ eventId, executeTick, templateId, templateName }) => ({
          eventId,
          executeTick,
          templateId,
          templateName,
        }),
      ) ?? [];
    expect(pendingProjection).toEqual([
      {
        eventId: second.eventId,
        executeTick: second.executeTick,
        templateId: 'glider',
        templateName: 'Glider',
      },
      {
        eventId: first.eventId,
        executeTick: first.executeTick,
        templateId: 'block',
        templateName: 'Block 2x2',
      },
      {
        eventId: third.eventId,
        executeTick: third.executeTick,
        templateId: 'generator',
        templateName: 'Generator Block',
      },
    ]);
  });

  test('[QUAL-01] tracks economy income from active and inactive structures', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 60,
      height: 60,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    const initialPayload = RtsEngine.createRoomStatePayload(room);
    const initialTeam = initialPayload.teams.find(({ id }) => id === team.id);
    expect(initialTeam?.incomeBreakdown).toEqual({
      base: 0,
      structures: 0,
      total: 0,
      activeStructureCount: 0,
    });

    const position = {
      x: team.baseTopLeft.x + 5,
      y: team.baseTopLeft.y + 5,
    };
    const generatorPreview = RtsEngine.previewBuildPlacement(room, 'p1', {
      templateId: 'generator',
      x: position.x,
      y: position.y,
    });
    expect(generatorPreview.accepted).toBe(true);
    const generatorCells = generatorPreview.footprint ?? [];
    expect(generatorCells.length).toBeGreaterThan(0);

    const queued = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'generator',
      x: position.x,
      y: position.y,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    const activePayload = RtsEngine.createRoomStatePayload(room);
    const activeTeam = activePayload.teams.find(({ id }) => id === team.id);
    expect(activeTeam?.incomeBreakdown).toEqual({
      base: 0,
      structures: 2,
      total: 2,
      activeStructureCount: 1,
    });

    for (let index = 0; index < 8; index += 1) {
      for (const cell of generatorCells) {
        RtsEngine.queueLegacyCellUpdate(room, {
          x: cell.x,
          y: cell.y,
          alive: 0,
        });
      }
      RtsEngine.tickRoom(room);

      const payload = RtsEngine.createRoomStatePayload(room);
      const maybeInactive = payload.teams.find(({ id }) => id === team.id);
      if ((maybeInactive?.incomeBreakdown.activeStructureCount ?? 0) === 0) {
        break;
      }
    }

    const inactivePayload = RtsEngine.createRoomStatePayload(room);
    const inactiveTeam = inactivePayload.teams.find(({ id }) => id === team.id);
    expect(inactiveTeam?.incomeBreakdown).toEqual({
      base: 0,
      structures: 0,
      total: 0,
      activeStructureCount: 0,
    });
  });

  test('[QUAL-01] emits one terminal build outcome per accepted queue event', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 50,
      height: 50,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    const queued = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 6,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    const executeTick = queued.executeTick as number;
    const eventId = queued.eventId as number;

    const preResolution = RtsEngine.tickRoom(room);
    expect(getBuildOutcomes(preResolution)).toHaveLength(0);

    const resolved = RtsEngine.tickRoom(room);
    expect(getBuildOutcomes(resolved)).toEqual([
      {
        eventId,
        teamId: team.id,
        outcome: 'applied',
        executeTick,
        resolvedTick: executeTick,
      },
    ]);
  });

  test('resolves same-tick build events in ascending eventId order', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 70,
      height: 70,
    });
    const teamOne = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const teamTwo = RtsEngine.addPlayerToRoom(room, 'p2', 'Bob');

    const teamTwoQueued = RtsEngine.queueBuildEvent(room, 'p2', {
      templateId: 'block',
      x: teamTwo.baseTopLeft.x + 6,
      y: teamTwo.baseTopLeft.y + 6,
      delayTicks: 1,
    });
    const teamOneQueued = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: teamOne.baseTopLeft.x + 6,
      y: teamOne.baseTopLeft.y + 6,
      delayTicks: 1,
    });

    expect(teamTwoQueued.accepted).toBe(true);
    expect(teamOneQueued.accepted).toBe(true);
    expect(teamTwoQueued.executeTick).toBe(teamOneQueued.executeTick);

    RtsEngine.tickRoom(room);
    const resolved = RtsEngine.tickRoom(room);

    expect(getBuildOutcomes(resolved).map(({ eventId }) => eventId)).toEqual([
      teamTwoQueued.eventId,
      teamOneQueued.eventId,
    ]);
  });

  test('emits canonical outcome details only when a defeat occurs', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 40,
      height: 40,
    });
    const teamOne = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const teamTwo = RtsEngine.addPlayerToRoom(room, 'p2', 'Bob');
    const base = teamOne.baseTopLeft;
    const baseCells = getCanonicalBaseCells(base);

    let result = RtsEngine.tickRoom(room);
    expect(result.outcome).toBeNull();

    const teamOneCore = getCoreStructure(room, teamOne.id);
    expect(teamOneCore).not.toBeNull();
    if (!teamOneCore) {
      throw new Error('Expected team one core structure in room payload');
    }

    const destroyCore = RtsEngine.queueDestroyEvent(room, 'p1', {
      structureKey: teamOneCore.key,
      delayTicks: 0,
    });
    expect(destroyCore.accepted).toBe(true);

    for (const cell of baseCells) {
      RtsEngine.queueLegacyCellUpdate(room, {
        x: cell.x,
        y: cell.y,
        alive: 0,
      });
    }

    for (let index = 0; index < 12; index += 1) {
      result = RtsEngine.tickRoom(room);
      if (result.defeatedTeams.includes(teamOne.id)) {
        break;
      }

      for (const cell of baseCells) {
        RtsEngine.queueLegacyCellUpdate(room, {
          x: cell.x,
          y: cell.y,
          alive: 0,
        });
      }
    }

    expect(result.defeatedTeams).toEqual([teamOne.id]);
    expect(result.outcome).not.toBeNull();
    expect(result.outcome?.winner.teamId).toBe(teamTwo.id);

    const teamOneOutcome = result.outcome?.ranked.find(
      ({ teamId }) => teamId === teamOne.id,
    );
    expect(teamOneOutcome?.outcome).toBe('eliminated');
    expect(teamOneOutcome?.coreState).toBe('destroyed');

    const payload = RtsEngine.createRoomStatePayload(room);
    const payloadTeamOne = payload.teams.find(({ id }) => id === teamOne.id);
    const payloadTeamTwo = payload.teams.find(({ id }) => id === teamTwo.id);
    expect(payloadTeamOne?.baseIntact).toBe(false);
    expect(payloadTeamTwo?.baseIntact).toBe(true);

    const snapshots = RtsEngine.createTeamOutcomeSnapshots(room);
    expect(snapshots).toHaveLength(2);

    const canonical = RtsEngine.createCanonicalMatchOutcome(room);
    expect(canonical).not.toBeNull();
    expect(canonical?.winner.teamId).toBe(teamTwo.id);
  });

  test('applies queued builds and charges build costs', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 50,
      height: 50,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const initialResources = team.resources;

    const buildPosition = {
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 6,
    };
    const queued = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: buildPosition.x,
      y: buildPosition.y,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);
    const expectedCost = queued.needed ?? 0;

    const first = RtsEngine.tickRoom(room);
    const second = RtsEngine.tickRoom(room);

    expect(first.appliedBuilds).toBe(0);
    expect(second.appliedBuilds).toBe(1);
    expect(room.tick).toBe(2);
    expect(room.generation).toBe(2);
    expect(team.resources).toBe(initialResources - expectedCost);

    const payload = RtsEngine.createRoomStatePayload(room);
    expect(
      getCellAlive(payload.grid, getRoomWidth(room), getRoomHeight(room), {
        x: buildPosition.x,
        y: buildPosition.y,
      }),
    ).toBe(true);
    expect(
      getCellAlive(payload.grid, getRoomWidth(room), getRoomHeight(room), {
        x: buildPosition.x + 1,
        y: buildPosition.y + 1,
      }),
    ).toBe(true);
  });

  test('updates income based on dynamic structure integrity', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 60,
      height: 60,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    const position = {
      x: team.baseTopLeft.x + 5,
      y: team.baseTopLeft.y + 5,
    };
    const generatorPreview = RtsEngine.previewBuildPlacement(room, 'p1', {
      templateId: 'generator',
      x: position.x,
      y: position.y,
    });
    expect(generatorPreview.accepted).toBe(true);
    const generatorCells = generatorPreview.footprint ?? [];
    expect(generatorCells.length).toBeGreaterThan(0);

    const queued = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'generator',
      x: position.x,
      y: position.y,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    const postBuildResources = team.resources;
    RtsEngine.tickRoom(room);

    expect(team.income).toBe(2);
    expect(team.resources).toBe(postBuildResources + 2);

    for (let index = 0; index < 8; index += 1) {
      for (const cell of generatorCells) {
        RtsEngine.queueLegacyCellUpdate(room, {
          x: cell.x,
          y: cell.y,
          alive: 0,
        });
      }
      RtsEngine.tickRoom(room);

      const currentGenerator = getStructureByTemplateId(
        room,
        team.id,
        'generator',
      );
      if (!currentGenerator || !currentGenerator.active) {
        break;
      }
    }

    expect(team.income).toBe(0);

    const generator = getStructureByTemplateId(room, team.id, 'generator');
    expect(generator).not.toBeNull();
    expect(generator?.active).toBe(false);
  });

  test('activates and deactivates generator based on integrity state', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 60,
      height: 60,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    const position = {
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 6,
    };
    const generatorPreview = RtsEngine.previewBuildPlacement(room, 'p1', {
      templateId: 'generator',
      x: position.x,
      y: position.y,
    });
    expect(generatorPreview.accepted).toBe(true);
    const generatorCells = generatorPreview.footprint ?? [];
    expect(generatorCells.length).toBeGreaterThan(0);

    const queued = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'generator',
      x: position.x,
      y: position.y,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    const activeGenerator = getStructureByTemplateId(
      room,
      team.id,
      'generator',
    );
    expect(activeGenerator).not.toBeNull();
    expect(activeGenerator?.active).toBe(true);

    for (const cell of generatorCells) {
      RtsEngine.queueLegacyCellUpdate(room, {
        x: cell.x,
        y: cell.y,
        alive: 0,
      });
    }

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    const inactiveGenerator = getStructureByTemplateId(
      room,
      team.id,
      'generator',
    );
    expect(inactiveGenerator).toBeNull();
    expect(team.income).toBe(0);
  });

  test('[STRUCT-01] tracks templates without checks using default integrity masks', () => {
    const sentinelTemplate = new StructureTemplate({
      id: 'sentinel',
      name: 'Sentinel',
      grid: createTemplateGrid(1, 1, [1]),
      activationCost: 0,
      income: 0,
      buildArea: 0,
      startingHp: 2,
      checks: [],
    });
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 40,
      height: 40,
      templates: [...RtsEngine.createDefaultTemplates(), sentinelTemplate],
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    const placement = {
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
    };
    const queued = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'sentinel',
      x: placement.x,
      y: placement.y,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    RtsEngine.queueLegacyCellUpdate(room, {
      x: placement.x,
      y: placement.y,
      alive: 0,
    });
    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    const repaired = getStructureByTemplateId(room, team.id, 'sentinel');
    expect(repaired).not.toBeNull();
    expect(repaired?.hp).toBe(1);
    expect(repaired?.active).toBe(true);

    const repairedPayload = RtsEngine.createRoomStatePayload(room);
    expect(
      getCellAlive(
        repairedPayload.grid,
        getRoomWidth(room),
        getRoomHeight(room),
        placement,
      ),
    ).toBe(true);

    RtsEngine.queueLegacyCellUpdate(room, {
      x: placement.x,
      y: placement.y,
      alive: 0,
    });
    for (let index = 0; index < 4; index += 1) {
      RtsEngine.tickRoom(room);
    }

    const destroyed = getStructureByTemplateId(room, team.id, 'sentinel');
    expect(destroyed).toBeNull();

    const outcomes = RtsEngine.getTimelineEvents(room)
      .filter(
        ({ type, metadata }) =>
          type === 'integrity-resolved' &&
          metadata?.structureKey === repaired?.key,
      )
      .map(({ metadata }) => metadata?.category);
    expect(outcomes).toEqual(['repaired', 'destroyed-debris']);
  });

  test('[STRUCT-01] applies full restoration cost for destroyed non-core structures', () => {
    const durableTemplate = new StructureTemplate({
      id: 'durable',
      name: 'Durable',
      grid: createTemplateGrid(1, 1, [1]),
      activationCost: 0,
      income: 0,
      buildArea: 0,
      startingHp: 7,
      checks: [],
    });
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 40,
      height: 40,
      templates: [...RtsEngine.createDefaultTemplates(), durableTemplate],
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const core = getCoreStructure(room, team.id);
    expect(core).not.toBeNull();
    expect(core?.hp).toBe(RtsEngine.CORE_STRUCTURE_TEMPLATE.startingHp);

    const durablePlacement = {
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 8,
    };
    const durableQueued = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'durable',
      x: durablePlacement.x,
      y: durablePlacement.y,
      delayTicks: 1,
    });
    expect(durableQueued.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    const durable = getStructureByTemplateId(room, team.id, 'durable');
    expect(durable).not.toBeNull();
    expect(durable?.hp).toBe(7);

    const placement = {
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
    };
    const queued = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: placement.x,
      y: placement.y,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    const placed = getStructureByTemplateId(room, team.id, 'block');
    expect(placed).not.toBeNull();
    expect(placed?.hp).toBe(2);

    const blockCells = [
      { x: placement.x, y: placement.y },
      { x: placement.x + 1, y: placement.y },
      { x: placement.x, y: placement.y + 1 },
      { x: placement.x + 1, y: placement.y + 1 },
    ];
    for (const cell of blockCells) {
      RtsEngine.queueLegacyCellUpdate(room, {
        x: cell.x,
        y: cell.y,
        alive: 0,
      });
    }

    let destroyed = getStructureByTemplateId(room, team.id, 'block');
    for (let index = 0; index < 8 && destroyed; index += 1) {
      for (const cell of blockCells) {
        RtsEngine.queueLegacyCellUpdate(room, {
          x: cell.x,
          y: cell.y,
          alive: 0,
        });
      }
      RtsEngine.tickRoom(room);
      destroyed = getStructureByTemplateId(room, team.id, 'block');
    }

    expect(destroyed).toBeNull();

    const payload = RtsEngine.createRoomStatePayload(room);
    for (const cell of blockCells) {
      expect(
        getCellAlive(
          payload.grid,
          getRoomWidth(room),
          getRoomHeight(room),
          cell,
        ),
      ).toBe(false);
    }
  });

  test('applies full base restoration cost to core hp and defeats on breach', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 30,
      height: 30,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const initialCore = getCoreStructure(room, team.id);
    expect(initialCore).not.toBeNull();
    if (!initialCore) {
      throw new Error('Expected core structure in room payload');
    }

    const initialHp = initialCore.hp;
    const baseCells = getCanonicalBaseCells(team.baseTopLeft);
    let lastSeenCoreHp = initialHp;

    let result = RtsEngine.tickRoom(room);
    for (let index = 0; index < 400; index += 1) {
      for (const cell of baseCells) {
        RtsEngine.queueLegacyCellUpdate(room, {
          x: cell.x,
          y: cell.y,
          alive: 0,
        });
      }
      result = RtsEngine.tickRoom(room);
      const currentCore = getCoreStructure(room, team.id);
      if (currentCore) {
        lastSeenCoreHp = currentCore.hp;
      }
      if (result.defeatedTeams.includes(team.id)) {
        break;
      }
    }
    const core = getCoreStructure(room, team.id);

    expect(result.defeatedTeams).toEqual([team.id]);
    expect(lastSeenCoreHp).toBeLessThan(initialHp);
    expect(core).toBeNull();
    expect(team.defeated).toBe(true);

    const payload = RtsEngine.createRoomStatePayload(room);
    const payloadTeam = payload.teams.find(({ id }) => id === team.id);
    expect(payloadTeam?.baseIntact).toBe(false);
  });

  test('marks team defeated and drains pending queue when core is breached', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 30,
      height: 30,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const base = team.baseTopLeft;
    const blockTemplate = RtsEngine.getRoomTemplate(room, 'block');
    expect(blockTemplate).toBeDefined();

    let queued: ReturnType<typeof RtsEngine.queueBuildEvent> | null = null;
    for (
      let y = 0;
      y <= getRoomHeight(room) - (blockTemplate?.height ?? 0) && !queued;
      y += 1
    ) {
      for (
        let x = 0;
        x <= getRoomWidth(room) - (blockTemplate?.width ?? 0);
        x += 1
      ) {
        const result = RtsEngine.queueBuildEvent(room, 'p1', {
          templateId: 'block',
          x,
          y,
          delayTicks: 20,
        });
        if (result.accepted) {
          queued = result;
          break;
        }
      }
    }

    expect(queued?.accepted).toBe(true);
    if (!queued) {
      throw new Error('Expected at least one valid queued build before breach');
    }

    const ownCore = getCoreStructure(room, team.id);
    expect(ownCore).not.toBeNull();
    if (!ownCore) {
      throw new Error('Expected own core structure in room payload');
    }

    const destroyCore = RtsEngine.queueDestroyEvent(room, 'p1', {
      structureKey: ownCore.key,
      delayTicks: 0,
    });
    expect(destroyCore.accepted).toBe(true);

    let result = RtsEngine.tickRoom(room);
    for (let index = 0; index < 8; index += 1) {
      if (result.defeatedTeams.includes(team.id)) {
        break;
      }
      result = RtsEngine.tickRoom(room);
    }

    const terminalOutcomes = getBuildOutcomes(result);
    const pendingOutcome = terminalOutcomes.find(
      ({ eventId }) => eventId === queued.eventId,
    );

    expect(result.defeatedTeams).toEqual([team.id]);
    expect(team.defeated).toBe(true);
    expect(requireTeamPayload(room, team.id).pendingBuilds).toHaveLength(0);
    expect(pendingOutcome).toMatchObject({
      eventId: queued.eventId,
      teamId: team.id,
      outcome: 'rejected',
      reason: 'team-defeated',
      executeTick: queued.executeTick,
    });
    expect(pendingOutcome?.resolvedTick).toBeLessThan(
      queued.executeTick as number,
    );

    const afterDefeat = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: base.x + 10,
      y: base.y + 10,
    });
    expect(afterDefeat.accepted).toBe(false);
    expect(afterDefeat.error).toMatch(/defeated/i);
  });
});
