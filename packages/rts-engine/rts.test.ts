import { describe, expect, test } from 'vitest';
import { unpackGridBits } from '#conway-core';

import {
  BASE_FOOTPRINT_HEIGHT,
  BASE_FOOTPRINT_WIDTH,
  getBaseCenter,
  getCanonicalBaseCells,
  isCanonicalBaseCell,
} from './geometry.js';
import { BUILD_ZONE_RADIUS } from './gameplay-rules.js';
import {
  addPlayerToRoom,
  createCanonicalMatchOutcome,
  createDefaultTemplates,
  createRoomState,
  createRoomStatePayload,
  createTeamOutcomeSnapshots,
  createTemplateSummaries,
  listRooms,
  previewBuildPlacement,
  queueBuildEvent,
  queueDestroyEvent,
  queueLegacyCellUpdate,
  removePlayerFromRoom,
  renamePlayerInRoom,
  tickRoom,
  type StructureTemplate,
} from './rts.js';
import { GridView } from './grid-view.js';

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

function getCoreStructure(team: ReturnType<typeof addPlayerToRoom>): {
  key: string;
  hp: number;
  active: boolean;
  isCore: boolean;
  buildRadius: number;
} {
  const core = [...team.structures.values()].find(
    (structure) => structure.isCore,
  );
  expect(core).toBeDefined();
  return core as {
    key: string;
    hp: number;
    active: boolean;
    isCore: boolean;
    buildRadius: number;
  };
}

function getCellAlive(
  grid: Uint8Array | ArrayBuffer,
  width: number,
  height: number,
  cell: Cell,
): boolean {
  const packedGrid = (
    grid instanceof Uint8Array ? Uint8Array.from(grid).buffer : grid
  ) as ArrayBuffer;
  const unpackedGrid = unpackGridBits(packedGrid, width, height);
  return unpackedGrid[cell.y * width + cell.x] === 1;
}

function getBuildOutcomes(
  result: ReturnType<typeof tickRoom>,
): BuildOutcomeRecord[] {
  return (
    (
      result as ReturnType<typeof tickRoom> & {
        buildOutcomes?: BuildOutcomeRecord[];
      }
    ).buildOutcomes ?? []
  );
}

function probeQueueBuild(
  room: ReturnType<typeof createRoomState>,
  playerId: string,
  payload: {
    templateId: string;
    x: number;
    y: number;
    delayTicks?: number;
    transform?: {
      operations: Array<'rotate' | 'mirror-horizontal' | 'mirror-vertical'>;
    };
  },
): ReturnType<typeof previewBuildPlacement> {
  return previewBuildPlacement(room, playerId, payload);
}

function getStructureByTemplateId(
  team: ReturnType<typeof addPlayerToRoom>,
  templateId: string,
): {
  key: string;
  hp: number;
  active: boolean;
  buildRadius: number;
} | null {
  const structure = [...team.structures.values()].find(
    (candidate) => candidate.templateId === templateId,
  );
  if (!structure) {
    return null;
  }

  return {
    key: structure.key,
    hp: structure.hp,
    active: structure.active,
    buildRadius: structure.buildRadius,
  };
}

function withTemplateGrid(
  template: Omit<StructureTemplate, 'grid'>,
): StructureTemplate {
  const cells = new Uint8Array(template.cells);
  const checks = template.checks.map((check) => ({ x: check.x, y: check.y }));

  return {
    ...template,
    cells,
    checks,
    grid(): GridView {
      const gridCells = [];
      for (let y = 0; y < template.height; y += 1) {
        for (let x = 0; x < template.width; x += 1) {
          gridCells.push({
            x,
            y,
            alive: cells[y * template.width + x] === 1,
          });
        }
      }

      return GridView.fromCells(gridCells);
    },
  };
}

describe('rts', () => {
  test('provides default structure templates with expected metadata', () => {
    const templates = createDefaultTemplates();

    expect(templates.map(({ id }) => id)).toEqual([
      'block',
      'generator',
      'glider',
      'eater-1',
    ]);

    const generator = templates.find(({ id }) => id === 'generator');
    expect(generator).toBeDefined();
    expect(generator?.width).toBe(2);
    expect(generator?.height).toBe(2);
    expect(generator?.activationCost).toBe(6);
    expect(generator?.income).toBe(2);
    expect(generator?.checks).toHaveLength(4);
  });

  test('projects template summaries used by room payloads', () => {
    const summaries = createTemplateSummaries(createDefaultTemplates());

    expect(summaries.map(({ id }) => id)).toEqual([
      'block',
      'generator',
      'glider',
      'eater-1',
    ]);

    const generator = summaries.find(({ id }) => id === 'generator');
    expect(generator).toMatchObject({
      id: 'generator',
      width: 2,
      height: 2,
      activationCost: 6,
      income: 2,
      buildArea: 2,
    });
  });

  test('normalizes templates with canonical fresh grid() views', () => {
    const room = createRoomState({
      id: 'grid-room',
      name: 'Grid Room',
      width: 40,
      height: 40,
    });
    const template = room.templateMap.get('glider');

    expect(template).toBeDefined();
    const firstView = template?.grid();
    const secondView = template?.grid();

    expect(firstView).toBeDefined();
    expect(secondView).toBeDefined();
    expect(firstView).not.toBe(secondView);
    expect(firstView?.cells()).toEqual(secondView?.cells());

    const rotated = firstView?.rotate();
    expect(template?.grid().cells()).toEqual(secondView?.cells());
    expect(rotated?.cells()).not.toEqual(secondView?.cells());
  });

  test('keeps preview and queue parity for canonical transformed placements', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 70,
      height: 70,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    const payload = {
      templateId: 'glider',
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 6,
      delayTicks: 1,
      transform: {
        operations: ['rotate' as const, 'mirror-horizontal' as const],
      },
    };

    const preview = previewBuildPlacement(room, 'p1', payload);
    const queued = queueBuildEvent(room, 'p1', payload);

    expect(preview.accepted).toBe(true);
    expect(queued.accepted).toBe(true);
    expect(queued.transform).toEqual(preview.transform);
    expect(queued.bounds).toEqual(preview.bounds);
    expect(queued.footprint).toEqual(preview.footprint);
    expect(queued.illegalCells).toEqual(preview.illegalCells);
  });

  test('keeps transformed structure payloads deterministic and fallback integrity masks active', () => {
    const transformedTemplate: StructureTemplate = withTemplateGrid({
      id: 'sentinel-eater',
      name: 'Sentinel Eater',
      width: 4,
      height: 4,
      cells: new Uint8Array([1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 0, 1, 0]),
      activationCost: 0,
      income: 0,
      buildArea: 0,
      checks: [],
    });
    const room = createRoomState({
      id: 'transformed-read-room',
      name: 'Transformed Read Room',
      width: 52,
      height: 52,
      templates: [...createDefaultTemplates(), transformedTemplate],
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    const queued = queueBuildEvent(room, 'p1', {
      templateId: 'sentinel-eater',
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
      delayTicks: 1,
      transform: {
        operations: ['rotate', 'mirror-horizontal'],
      },
    });
    expect(queued.accepted).toBe(true);

    tickRoom(room);
    tickRoom(room);

    const firstPayload = createRoomStatePayload(room);
    const secondPayload = createRoomStatePayload(room);
    const firstTeam = firstPayload.teams.find(({ id }) => id === team.id);
    const secondTeam = secondPayload.teams.find(({ id }) => id === team.id);

    const firstStructure = firstTeam?.structures.find(
      ({ templateId }) => templateId === 'sentinel-eater',
    );
    const secondStructure = secondTeam?.structures.find(
      ({ templateId }) => templateId === 'sentinel-eater',
    );

    expect(firstStructure).toBeDefined();
    expect(secondStructure).toEqual(firstStructure);

    const damagedCell = queued.footprint?.[0];
    expect(damagedCell).toBeDefined();
    if (!damagedCell) {
      throw new Error('Expected transformed footprint data for integrity test');
    }

    queueLegacyCellUpdate(room, {
      x: damagedCell.x,
      y: damagedCell.y,
      alive: 0,
    });

    tickRoom(room);
    tickRoom(room);

    const damagedStructure = [...team.structures.values()].find(
      ({ templateId }) => templateId === 'sentinel-eater',
    );
    expect(damagedStructure).toBeDefined();
    expect(damagedStructure?.hp ?? 0).toBeLessThan(2);
  });

  test('adds players, seeds base cells, and lists room occupancy', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 40,
      height: 40,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    expect(team.id).toBe(1);
    expect(room.players.get('p1')?.teamId).toBe(team.id);

    const payload = createRoomStatePayload(room);
    const base = team.baseTopLeft;
    const baseCells = getCanonicalBaseCells(base);
    expect(baseCells).toHaveLength(16);

    for (let localY = 0; localY < BASE_FOOTPRINT_HEIGHT; localY += 1) {
      for (let localX = 0; localX < BASE_FOOTPRINT_WIDTH; localX += 1) {
        const expectedAlive = isCanonicalBaseCell(localX, localY);
        const alive = getCellAlive(payload.grid, room.width, room.height, {
          x: base.x + localX,
          y: base.y + localY,
        });
        expect(alive).toBe(expectedAlive);
      }
    }

    const rooms = listRooms(new Map([[room.id, room]]));
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
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 32,
      height: 32,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    expect(renamePlayerInRoom(room, 'p1', 'Alicia')).toBe(true);
    expect(room.players.get('p1')?.name).toBe('Alicia');
    expect(room.teams.get(team.id)?.name).toBe(`Alicia's Team`);

    expect(removePlayerFromRoom(room, 'p1')).toBe(true);
    expect(room.players.has('p1')).toBe(false);
    expect(room.teams.has(team.id)).toBe(false);
  });

  test('[QUAL-01] validates queue rejection reasons and delay clamping', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 80,
      height: 80,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    const unknownPlayer = queueBuildEvent(room, 'missing', {
      templateId: 'block',
      x: 0,
      y: 0,
    });
    expect(unknownPlayer.accepted).toBe(false);

    const unknownTemplate = queueBuildEvent(room, 'p1', {
      templateId: 'not-a-template',
      x: 10,
      y: 10,
    });
    expect(unknownTemplate.accepted).toBe(false);

    const nonInteger = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: 10.5,
      y: 10,
    });
    expect(nonInteger.accepted).toBe(false);

    const outsideBounds = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: 79,
      y: 79,
    });
    expect(outsideBounds.accepted).toBe(false);
    expect(outsideBounds.reason).toBe('outside-territory');
    expect(room.timelineEvents.at(-1)?.metadata?.reason).toBe(
      'outside-territory',
    );

    const blockTemplate = room.templateMap.get('block');
    expect(blockTemplate).toBeDefined();
    const blockWidth = blockTemplate?.width ?? 0;
    const blockHeight = blockTemplate?.height ?? 0;
    const baseCenter = getBaseCenter(team.baseTopLeft);

    let outsideTerritoryCoordinate: Cell | null = null;
    for (const direction of [1, -1] as const) {
      const candidateX = baseCenter.x + direction * BUILD_ZONE_RADIUS;
      const candidateY = Math.max(0, Math.min(baseCenter.y, room.height - 1));
      if (candidateX < 0 || candidateX + blockWidth > room.width) {
        continue;
      }
      if (candidateY + blockHeight > room.height) {
        continue;
      }

      outsideTerritoryCoordinate = {
        x: candidateX,
        y: candidateY,
      };
      break;
    }

    expect(outsideTerritoryCoordinate).not.toBeNull();

    const outsideTerritory = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: outsideTerritoryCoordinate?.x ?? 0,
      y: outsideTerritoryCoordinate?.y ?? 0,
    });
    expect(outsideTerritory.accepted).toBe(false);
    expect(outsideTerritory.reason).toBe('outside-territory');
    expect(room.timelineEvents.at(-1)?.metadata?.reason).toBe(
      'outside-territory',
    );

    const invalidDelay = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 6,
      delayTicks: 1.5,
    });
    expect(invalidDelay.accepted).toBe(false);
    expect(invalidDelay.error).toBe('delayTicks must be an integer');
    const invalidDelayEvent =
      room.timelineEvents[room.timelineEvents.length - 1];
    expect(invalidDelayEvent?.metadata?.reason).toBe('invalid-delay');

    const delayLow = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 6,
      delayTicks: 0,
    });
    expect(delayLow.accepted).toBe(true);
    expect(delayLow.executeTick).toBe(1);

    const delayHigh = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
      delayTicks: 999,
    });
    expect(delayHigh.accepted).toBe(true);
    expect(delayHigh.executeTick).toBe(20);

    const queued = room.teams.get(team.id)?.pendingBuildEvents ?? [];
    expect(queued.map(({ executeTick }) => executeTick)).toEqual([1, 20]);
  });

  test('[BUILD-02] enforces inclusive radius-15 union-zone checks', () => {
    const probeTemplate: StructureTemplate = withTemplateGrid({
      id: 'probe',
      name: 'Probe',
      width: 1,
      height: 1,
      cells: new Uint8Array([1]),
      activationCost: 0,
      income: 0,
      buildArea: 0,
      checks: [],
    });

    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 80,
      height: 80,
      templates: [...createDefaultTemplates(), probeTemplate],
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');
    const baseCenter = getBaseCenter(team.baseTopLeft);
    const blockTemplate = room.templateMap.get('block');
    expect(blockTemplate).toBeDefined();

    let direction: 1 | -1 | null = null;
    for (const candidate of [1, -1] as const) {
      const insideX = baseCenter.x + candidate * BUILD_ZONE_RADIUS;
      const outsideX = baseCenter.x + candidate * (BUILD_ZONE_RADIUS + 1);
      const blockX = baseCenter.x + candidate * BUILD_ZONE_RADIUS;
      if (insideX < 0 || insideX >= room.width) {
        continue;
      }
      if (outsideX < 0 || outsideX >= room.width) {
        continue;
      }
      if (
        blockX < 0 ||
        blockX + (blockTemplate?.width ?? 0) > room.width ||
        baseCenter.y + (blockTemplate?.height ?? 0) > room.height
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

    const y = Math.max(0, Math.min(baseCenter.y, room.height - 1));
    const boundary = queueBuildEvent(room, 'p1', {
      templateId: 'probe',
      x: baseCenter.x + direction * BUILD_ZONE_RADIUS,
      y,
      delayTicks: 1,
    });
    expect(boundary.accepted).toBe(true);

    const outside = queueBuildEvent(room, 'p1', {
      templateId: 'probe',
      x: baseCenter.x + direction * (BUILD_ZONE_RADIUS + 1),
      y,
      delayTicks: 1,
    });
    expect(outside.accepted).toBe(false);
    expect(outside.reason).toBe('outside-territory');

    const footprintOverflow = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: baseCenter.x + direction * BUILD_ZONE_RADIUS,
      y,
      delayTicks: 1,
    });
    expect(footprintOverflow.accepted).toBe(false);
    expect(footprintOverflow.reason).toBe('outside-territory');
  });

  test('accepts torus-wrapped placements and rejects transformed templates that exceed map size', () => {
    const wideTemplate: StructureTemplate = withTemplateGrid({
      id: 'wide-6',
      name: 'Wide 6',
      width: 6,
      height: 1,
      cells: new Uint8Array([1, 1, 1, 1, 1, 1]),
      activationCost: 0,
      income: 0,
      buildArea: 0,
      checks: [],
    });

    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 5,
      height: 5,
      templates: [...createDefaultTemplates(), wideTemplate],
    });
    addPlayerToRoom(room, 'p1', 'Alice');

    const wrappedPreview = previewBuildPlacement(room, 'p1', {
      templateId: 'block',
      x: 4,
      y: 4,
    });

    expect(wrappedPreview.accepted).toBe(true);
    expect(wrappedPreview.reason).toBeUndefined();
    expect(wrappedPreview.bounds).toEqual({
      x: 4,
      y: 4,
      width: 2,
      height: 2,
    });
    expect(
      new Set(
        (wrappedPreview.footprint ?? []).map((cell) => `${cell.x},${cell.y}`),
      ),
    ).toEqual(new Set(['4,4', '0,4', '4,0', '0,0']));

    const overflowPayload = {
      templateId: wideTemplate.id,
      x: 0,
      y: 0,
      transform: {
        operations: ['rotate' as const],
      },
    };

    const overflowPreview = previewBuildPlacement(room, 'p1', overflowPayload);
    expect(overflowPreview.accepted).toBe(false);
    expect(overflowPreview.reason).toBe('template-exceeds-map-size');
    expect(overflowPreview.transform?.operations).toEqual(['rotate']);
    expect(overflowPreview.bounds).toEqual({
      x: 0,
      y: 0,
      width: 1,
      height: 6,
    });
    expect(overflowPreview.footprint).toEqual([]);
    expect(overflowPreview.illegalCells).toEqual([]);

    const overflowQueue = queueBuildEvent(room, 'p1', overflowPayload);
    expect(overflowQueue.accepted).toBe(false);
    expect(overflowQueue.reason).toBe('template-exceeds-map-size');
    expect(overflowQueue.transform?.operations).toEqual(['rotate']);
    expect(room.timelineEvents.at(-1)?.metadata?.reason).toBe(
      'template-exceeds-map-size',
    );
  });

  test('[BUILD-01] updates union-zone eligibility after build completion and structure destruction', () => {
    const probeTemplate: StructureTemplate = withTemplateGrid({
      id: 'probe',
      name: 'Probe',
      width: 1,
      height: 1,
      cells: new Uint8Array([1]),
      activationCost: 0,
      income: 0,
      buildArea: 0,
      checks: [],
    });

    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 120,
      height: 120,
      templates: [...createDefaultTemplates(), probeTemplate],
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');
    const baseCenter = getBaseCenter(team.baseTopLeft);

    let setup: {
      contributorX: number;
      contributorY: number;
      remoteX: number;
      remoteY: number;
    } | null = null;

    for (const direction of [1, -1] as const) {
      const contributorX = baseCenter.x + direction * 13;
      const contributorY = Math.max(0, Math.min(baseCenter.y, room.height - 2));
      const contributorCenterX = contributorX + 1;
      const contributorCenterY = contributorY + 1;
      const remoteX = contributorCenterX + direction * BUILD_ZONE_RADIUS;
      const remoteY = contributorCenterY;

      if (contributorX < 0 || contributorX + 2 > room.width) {
        continue;
      }
      if (remoteX < 0 || remoteX >= room.width) {
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

    const contributor = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: setup.contributorX,
      y: setup.contributorY,
      delayTicks: 1,
    });
    expect(contributor.accepted).toBe(true);

    tickRoom(room);
    tickRoom(room);

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
      queueLegacyCellUpdate(room, {
        x: cell.x,
        y: cell.y,
        alive: 0,
      });
    }

    tickRoom(room);

    const destroyedContributor = getStructureByTemplateId(team, 'block');
    expect(destroyedContributor).not.toBeNull();
    expect(destroyedContributor?.hp).toBeLessThanOrEqual(0);

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
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 90,
      height: 90,
    });
    const teamOne = addPlayerToRoom(room, 'p1', 'Alice');
    const teamTwo = addPlayerToRoom(room, 'p2', 'Bob');

    const queuedBuild = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: teamOne.baseTopLeft.x + 8,
      y: teamOne.baseTopLeft.y + 8,
      delayTicks: 1,
    });
    expect(queuedBuild.accepted).toBe(true);

    tickRoom(room);
    tickRoom(room);

    const ownStructure = getStructureByTemplateId(teamOne, 'block');
    expect(ownStructure).not.toBeNull();
    if (!ownStructure) {
      throw new Error('Expected own block structure to exist');
    }

    const wrongOwner = queueDestroyEvent(room, 'p2', {
      structureKey: ownStructure.key,
      delayTicks: 2,
    });
    expect(wrongOwner.accepted).toBe(false);
    expect(wrongOwner.reason).toBe('wrong-owner');

    const invalidTarget = queueDestroyEvent(room, 'p1', {
      structureKey: 'missing-structure-key',
      delayTicks: 2,
    });
    expect(invalidTarget.accepted).toBe(false);
    expect(invalidTarget.reason).toBe('invalid-target');

    const first = queueDestroyEvent(room, 'p1', {
      structureKey: ownStructure.key,
      delayTicks: 3,
    });
    expect(first.accepted).toBe(true);
    expect(first.idempotent).toBe(false);

    const duplicate = queueDestroyEvent(room, 'p1', {
      structureKey: ownStructure.key,
      delayTicks: 3,
    });
    expect(duplicate.accepted).toBe(true);
    expect(duplicate.idempotent).toBe(true);
    expect(duplicate.eventId).toBe(first.eventId);
    expect(duplicate.executeTick).toBe(first.executeTick);

    const ownCore = getCoreStructure(teamOne);
    const retarget = queueDestroyEvent(room, 'p1', {
      structureKey: ownCore.key,
      delayTicks: 3,
    });
    expect(retarget.accepted).toBe(true);
    expect(retarget.eventId).not.toBe(first.eventId);
    expect(teamOne.pendingDestroyEvents).toHaveLength(2);
    expect(teamTwo.pendingDestroyEvents).toHaveLength(0);
  });

  test('[STRUCT-02] applies queued destroy outcomes and removes contributor build zone', () => {
    const probeTemplate: StructureTemplate = withTemplateGrid({
      id: 'probe',
      name: 'Probe',
      width: 1,
      height: 1,
      cells: new Uint8Array([1]),
      activationCost: 0,
      income: 0,
      buildArea: 0,
      checks: [],
    });

    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 120,
      height: 120,
      templates: [...createDefaultTemplates(), probeTemplate],
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');
    const baseCenter = getBaseCenter(team.baseTopLeft);

    let setup: {
      contributorX: number;
      contributorY: number;
      remoteX: number;
      remoteY: number;
    } | null = null;

    for (const direction of [1, -1] as const) {
      const contributorX = baseCenter.x + direction * 13;
      const contributorY = Math.max(0, Math.min(baseCenter.y, room.height - 2));
      const contributorCenterX = contributorX + 1;
      const contributorCenterY = contributorY + 1;
      const remoteX = contributorCenterX + direction * BUILD_ZONE_RADIUS;
      const remoteY = contributorCenterY;

      if (contributorX < 0 || contributorX + 2 > room.width) {
        continue;
      }
      if (remoteX < 0 || remoteX >= room.width) {
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

    const contributor = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: setup.contributorX,
      y: setup.contributorY,
      delayTicks: 1,
    });
    expect(contributor.accepted).toBe(true);

    tickRoom(room);
    tickRoom(room);

    const expanded = probeQueueBuild(room, 'p1', {
      templateId: 'probe',
      x: setup.remoteX,
      y: setup.remoteY,
      delayTicks: 1,
    });
    expect(expanded.accepted).toBe(true);

    const builtContributor = getStructureByTemplateId(team, 'block');
    expect(builtContributor).not.toBeNull();
    if (!builtContributor) {
      throw new Error('Expected contributor structure to exist before destroy');
    }

    const queuedDestroy = queueDestroyEvent(room, 'p1', {
      structureKey: builtContributor.key,
      delayTicks: 1,
    });
    expect(queuedDestroy.accepted).toBe(true);

    const preDue = tickRoom(room);
    expect(preDue.destroyOutcomes).toEqual([]);

    const resolved = tickRoom(room);
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

    const staleDestroy = queueDestroyEvent(room, 'p1', {
      structureKey: builtContributor.key,
      delayTicks: 1,
    });
    expect(staleDestroy.accepted).toBe(false);
    expect(staleDestroy.reason).toBe('invalid-lifecycle-state');
  });

  test('[QUAL-04] keeps destroy outcomes deterministic across equal-run simulations', () => {
    function runDestroySequence(): {
      destroyOutcomes: ReturnType<typeof tickRoom>['destroyOutcomes'];
      payload: ReturnType<typeof createRoomStatePayload>;
    } {
      const room = createRoomState({
        id: 'deterministic-room',
        name: 'Deterministic',
        width: 80,
        height: 80,
      });
      const team = addPlayerToRoom(room, 'p1', 'Alice');

      const queuedBuild = queueBuildEvent(room, 'p1', {
        templateId: 'block',
        x: team.baseTopLeft.x + 8,
        y: team.baseTopLeft.y + 8,
        delayTicks: 1,
      });
      expect(queuedBuild.accepted).toBe(true);

      tickRoom(room);
      tickRoom(room);

      const placed = getStructureByTemplateId(team, 'block');
      if (!placed) {
        throw new Error('Expected placed block before destroy sequence');
      }

      const queuedDestroy = queueDestroyEvent(room, 'p1', {
        structureKey: placed.key,
        delayTicks: 1,
      });
      expect(queuedDestroy.accepted).toBe(true);

      tickRoom(room);
      const resolved = tickRoom(room);

      return {
        destroyOutcomes: resolved.destroyOutcomes,
        payload: createRoomStatePayload(room),
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
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 70,
      height: 70,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    team.resources = 9;
    const result = queueBuildEvent(room, 'p1', {
      templateId: 'generator',
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 6,
      delayTicks: 1,
    });

    expect(result).toMatchObject({
      accepted: false,
      reason: 'insufficient-resources',
      needed: 10,
      current: 9,
      deficit: 1,
    });
    expect(team.pendingBuildEvents).toHaveLength(0);
    expect(room.timelineEvents.at(-1)?.metadata?.reason).toBe(
      'insufficient-resources',
    );
  });

  test('[QUAL-01] keeps queue sequencing isolated per room instance', () => {
    const roomA = createRoomState({
      id: 'room-a',
      name: 'Alpha',
      width: 60,
      height: 60,
    });
    const roomB = createRoomState({
      id: 'room-b',
      name: 'Bravo',
      width: 60,
      height: 60,
    });

    const teamA = addPlayerToRoom(roomA, 'p1', 'Alice');
    const teamB = addPlayerToRoom(roomB, 'p1', 'Alice');

    const queueA = queueBuildEvent(roomA, 'p1', {
      templateId: 'block',
      x: teamA.baseTopLeft.x + 4,
      y: teamA.baseTopLeft.y + 4,
      delayTicks: 1,
    });
    const queueB = queueBuildEvent(roomB, 'p1', {
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

    tickRoom(roomA);
    const resolvedA = tickRoom(roomA);

    expect(getBuildOutcomes(resolvedA)).toHaveLength(1);
    expect(roomB.tick).toBe(0);
    expect(roomB.teams.get(teamB.id)?.pendingBuildEvents).toHaveLength(1);
  });

  test('projects pending queue rows sorted by executeTick then eventId', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 80,
      height: 80,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    const first = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 4,
      y: team.baseTopLeft.y + 4,
      delayTicks: 5,
    });
    const second = queueBuildEvent(room, 'p1', {
      templateId: 'glider',
      x: team.baseTopLeft.x + 7,
      y: team.baseTopLeft.y + 4,
      delayTicks: 3,
    });
    const third = queueBuildEvent(room, 'p1', {
      templateId: 'generator',
      x: team.baseTopLeft.x + 10,
      y: team.baseTopLeft.y + 4,
      delayTicks: 5,
    });

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    expect(third.accepted).toBe(true);

    const payload = createRoomStatePayload(room);
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
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 60,
      height: 60,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    const initialPayload = createRoomStatePayload(room);
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
    const queued = queueBuildEvent(room, 'p1', {
      templateId: 'generator',
      x: position.x,
      y: position.y,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    tickRoom(room);
    tickRoom(room);
    tickRoom(room);

    const activePayload = createRoomStatePayload(room);
    const activeTeam = activePayload.teams.find(({ id }) => id === team.id);
    expect(activeTeam?.incomeBreakdown).toEqual({
      base: 0,
      structures: 2,
      total: 2,
      activeStructureCount: 1,
    });

    const generatorCells = [
      { x: position.x, y: position.y },
      { x: position.x + 1, y: position.y },
      { x: position.x, y: position.y + 1 },
      { x: position.x + 1, y: position.y + 1 },
    ];
    for (const cell of generatorCells) {
      queueLegacyCellUpdate(room, {
        x: cell.x,
        y: cell.y,
        alive: 0,
      });
    }

    tickRoom(room);
    tickRoom(room);

    const inactivePayload = createRoomStatePayload(room);
    const inactiveTeam = inactivePayload.teams.find(({ id }) => id === team.id);
    expect(inactiveTeam?.incomeBreakdown).toEqual({
      base: 0,
      structures: 0,
      total: 0,
      activeStructureCount: 0,
    });
  });

  test('[QUAL-01] emits one terminal build outcome per accepted queue event', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 50,
      height: 50,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    const queued = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 6,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    const executeTick = queued.executeTick as number;
    const eventId = queued.eventId as number;

    const preResolution = tickRoom(room);
    expect(getBuildOutcomes(preResolution)).toHaveLength(0);

    const resolved = tickRoom(room);
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
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 70,
      height: 70,
    });
    const teamOne = addPlayerToRoom(room, 'p1', 'Alice');
    const teamTwo = addPlayerToRoom(room, 'p2', 'Bob');

    const teamTwoQueued = queueBuildEvent(room, 'p2', {
      templateId: 'block',
      x: teamTwo.baseTopLeft.x + 6,
      y: teamTwo.baseTopLeft.y + 6,
      delayTicks: 1,
    });
    const teamOneQueued = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: teamOne.baseTopLeft.x + 6,
      y: teamOne.baseTopLeft.y + 6,
      delayTicks: 1,
    });

    expect(teamTwoQueued.accepted).toBe(true);
    expect(teamOneQueued.accepted).toBe(true);
    expect(teamTwoQueued.executeTick).toBe(teamOneQueued.executeTick);

    tickRoom(room);
    const resolved = tickRoom(room);

    expect(getBuildOutcomes(resolved).map(({ eventId }) => eventId)).toEqual([
      teamTwoQueued.eventId,
      teamOneQueued.eventId,
    ]);
  });

  test('emits canonical outcome details only when a defeat occurs', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 40,
      height: 40,
    });
    const teamOne = addPlayerToRoom(room, 'p1', 'Alice');
    const teamTwo = addPlayerToRoom(room, 'p2', 'Bob');
    const base = teamOne.baseTopLeft;
    const baseCells = getCanonicalBaseCells(base);

    let result = tickRoom(room);
    expect(result.outcome).toBeNull();

    for (const cell of baseCells) {
      queueLegacyCellUpdate(room, {
        x: cell.x,
        y: cell.y,
        alive: 0,
      });
    }

    result = tickRoom(room);

    expect(result.defeatedTeams).toEqual([teamOne.id]);
    expect(result.outcome).not.toBeNull();
    expect(result.outcome?.winner.teamId).toBe(teamTwo.id);

    const teamOneOutcome = result.outcome?.ranked.find(
      ({ teamId }) => teamId === teamOne.id,
    );
    expect(teamOneOutcome?.outcome).toBe('eliminated');
    expect(teamOneOutcome?.coreState).toBe('destroyed');

    const payload = createRoomStatePayload(room);
    const payloadTeamOne = payload.teams.find(({ id }) => id === teamOne.id);
    const payloadTeamTwo = payload.teams.find(({ id }) => id === teamTwo.id);
    expect(payloadTeamOne?.baseIntact).toBe(false);
    expect(payloadTeamTwo?.baseIntact).toBe(true);

    const snapshots = createTeamOutcomeSnapshots(room);
    expect(snapshots).toHaveLength(2);

    const canonical = createCanonicalMatchOutcome(room);
    expect(canonical).not.toBeNull();
    expect(canonical?.winner.teamId).toBe(teamTwo.id);
  });

  test('applies queued builds and charges build costs', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 50,
      height: 50,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');
    const initialResources = team.resources;

    const buildPosition = {
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 6,
    };
    const queued = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: buildPosition.x,
      y: buildPosition.y,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    const first = tickRoom(room);
    const second = tickRoom(room);

    expect(first.appliedBuilds).toBe(0);
    expect(second.appliedBuilds).toBe(1);
    expect(room.tick).toBe(2);
    expect(room.generation).toBe(2);
    expect(team.resources).toBe(initialResources - 4);

    const payload = createRoomStatePayload(room);
    expect(
      getCellAlive(payload.grid, room.width, room.height, {
        x: buildPosition.x,
        y: buildPosition.y,
      }),
    ).toBe(true);
    expect(
      getCellAlive(payload.grid, room.width, room.height, {
        x: buildPosition.x + 1,
        y: buildPosition.y + 1,
      }),
    ).toBe(true);
  });

  test('updates income based on dynamic structure integrity', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 60,
      height: 60,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    const position = {
      x: team.baseTopLeft.x + 5,
      y: team.baseTopLeft.y + 5,
    };
    const queued = queueBuildEvent(room, 'p1', {
      templateId: 'generator',
      x: position.x,
      y: position.y,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    tickRoom(room);
    tickRoom(room);

    const postBuildResources = team.resources;
    tickRoom(room);

    expect(team.income).toBe(2);
    expect(team.resources).toBe(postBuildResources + 2);

    const generatorCells = [
      { x: position.x, y: position.y },
      { x: position.x + 1, y: position.y },
      { x: position.x, y: position.y + 1 },
      { x: position.x + 1, y: position.y + 1 },
    ];
    for (const cell of generatorCells) {
      queueLegacyCellUpdate(room, {
        x: cell.x,
        y: cell.y,
        alive: 0,
      });
    }

    tickRoom(room);
    tickRoom(room);

    expect(team.income).toBe(0);

    const generator = [...team.structures.values()].find(
      (structure) => structure.templateId === 'generator',
    );
    expect(generator).toBeDefined();
    expect(generator?.buildRadius).toBe(0);
  });

  test('projects structure buildRadius from template buildArea when active', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 60,
      height: 60,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    const position = {
      x: team.baseTopLeft.x + 6,
      y: team.baseTopLeft.y + 6,
    };
    const queued = queueBuildEvent(room, 'p1', {
      templateId: 'generator',
      x: position.x,
      y: position.y,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    tickRoom(room);
    tickRoom(room);
    tickRoom(room);

    const generator = [...team.structures.values()].find(
      (structure) => structure.templateId === 'generator',
    );
    expect(generator).toBeDefined();
    expect(generator?.active).toBe(true);
    expect(generator?.buildRadius).toBe(2);

    const generatorCells = [
      { x: position.x, y: position.y },
      { x: position.x + 1, y: position.y },
      { x: position.x, y: position.y + 1 },
      { x: position.x + 1, y: position.y + 1 },
    ];
    for (const cell of generatorCells) {
      queueLegacyCellUpdate(room, {
        x: cell.x,
        y: cell.y,
        alive: 0,
      });
    }

    tickRoom(room);
    tickRoom(room);

    expect(generator?.active).toBe(false);
    expect(generator?.buildRadius).toBe(0);
  });

  test('[STRUCT-01] tracks templates without checks using default integrity masks', () => {
    const sentinelTemplate: StructureTemplate = withTemplateGrid({
      id: 'sentinel',
      name: 'Sentinel',
      width: 1,
      height: 1,
      cells: new Uint8Array([1]),
      activationCost: 0,
      income: 0,
      buildArea: 0,
      checks: [],
    });
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 40,
      height: 40,
      templates: [...createDefaultTemplates(), sentinelTemplate],
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    const placement = {
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
    };
    const queued = queueBuildEvent(room, 'p1', {
      templateId: 'sentinel',
      x: placement.x,
      y: placement.y,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    tickRoom(room);
    tickRoom(room);

    const repaired = getStructureByTemplateId(team, 'sentinel');
    expect(repaired).not.toBeNull();
    expect(repaired?.hp).toBe(1);
    expect(repaired?.active).toBe(true);

    const repairedPayload = createRoomStatePayload(room);
    expect(
      getCellAlive(repairedPayload.grid, room.width, room.height, placement),
    ).toBe(true);

    tickRoom(room);

    const destroyed = getStructureByTemplateId(team, 'sentinel');
    expect(destroyed).not.toBeNull();
    expect(destroyed?.hp).toBe(0);
    expect(destroyed?.active).toBe(false);
    expect(destroyed?.buildRadius).toBe(0);

    const outcomes = room.timelineEvents
      .filter(
        ({ type, metadata }) =>
          type === 'integrity-resolved' &&
          metadata?.structureKey === repaired?.key,
      )
      .map(({ metadata }) => metadata?.category);
    expect(outcomes).toEqual(['repaired', 'destroyed-debris']);
  });

  test('[STRUCT-01] applies full restoration cost for destroyed non-core structures', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 40,
      height: 40,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');

    const placement = {
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
    };
    const queued = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: placement.x,
      y: placement.y,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    tickRoom(room);
    tickRoom(room);

    const placed = getStructureByTemplateId(team, 'block');
    expect(placed).not.toBeNull();
    expect(placed?.hp).toBe(2);

    const blockCells = [
      { x: placement.x, y: placement.y },
      { x: placement.x + 1, y: placement.y },
      { x: placement.x, y: placement.y + 1 },
      { x: placement.x + 1, y: placement.y + 1 },
    ];
    for (const cell of blockCells) {
      queueLegacyCellUpdate(room, {
        x: cell.x,
        y: cell.y,
        alive: 0,
      });
    }

    tickRoom(room);

    const destroyed = getStructureByTemplateId(team, 'block');
    expect(destroyed).not.toBeNull();
    expect(destroyed?.hp).toBe(-2);
    expect(destroyed?.active).toBe(false);

    const payload = createRoomStatePayload(room);
    for (const cell of blockCells) {
      expect(getCellAlive(payload.grid, room.width, room.height, cell)).toBe(
        false,
      );
    }
  });

  test('applies full base restoration cost to core hp and defeats on breach', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 30,
      height: 30,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');
    const initialHp = getCoreStructure(team).hp;
    const baseCells = getCanonicalBaseCells(team.baseTopLeft);

    for (const cell of baseCells) {
      queueLegacyCellUpdate(room, {
        x: cell.x,
        y: cell.y,
        alive: 0,
      });
    }

    const result = tickRoom(room);
    const core = getCoreStructure(team);

    expect(result.defeatedTeams).toEqual([team.id]);
    expect(core.hp).toBe(initialHp - baseCells.length);
    expect(core.active).toBe(false);
    expect(team.defeated).toBe(true);

    const payload = createRoomStatePayload(room);
    const payloadTeam = payload.teams.find(({ id }) => id === team.id);
    expect(payloadTeam?.baseIntact).toBe(false);
  });

  test('marks team defeated and drains pending queue when core is breached', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 30,
      height: 30,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');
    const base = team.baseTopLeft;

    const blockTemplate = room.templateMap.get('block');
    expect(blockTemplate).toBeDefined();

    let queued: ReturnType<typeof queueBuildEvent> | null = null;
    for (
      let y = 0;
      y <= room.height - (blockTemplate?.height ?? 0) && !queued;
      y += 1
    ) {
      for (let x = 0; x <= room.width - (blockTemplate?.width ?? 0); x += 1) {
        const result = queueBuildEvent(room, 'p1', {
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

    const baseCells = getCanonicalBaseCells(base);
    for (const cell of baseCells) {
      queueLegacyCellUpdate(room, {
        x: cell.x,
        y: cell.y,
        alive: 0,
      });
    }

    const result = tickRoom(room);

    const terminalOutcomes = getBuildOutcomes(result);
    const pendingOutcome = terminalOutcomes.find(
      ({ eventId }) => eventId === queued.eventId,
    );

    expect(result.defeatedTeams).toEqual([team.id]);
    expect(team.defeated).toBe(true);
    expect(team.pendingBuildEvents).toHaveLength(0);
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

    const afterDefeat = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: base.x + 10,
      y: base.y + 10,
    });
    expect(afterDefeat.accepted).toBe(false);
    expect(afterDefeat.error).toMatch(/defeated/i);
  });
});
