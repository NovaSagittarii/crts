import { describe, expect, test } from 'vitest';

import { Grid } from '#conway-core';

import {
  DEFAULT_QUEUE_DELAY_TICKS,
  MAX_DELAY_TICKS,
} from './gameplay-rules.js';
import {
  BASE_FOOTPRINT_HEIGHT,
  BASE_FOOTPRINT_WIDTH,
  getBaseCenter,
  getCanonicalBaseCells,
  isCanonicalBaseCell,
} from './geometry.js';
import {
  createIdentityPlacementTransform,
  normalizePlacementTransform,
} from './placement-transform.js';
import {
  type Cell,
  clearCells,
  countStructuresByTemplateId,
  createTemplateGrid,
  getBuildOutcomes,
  getCellAlive,
  getCoreStructure,
  getRoomHeight,
  getRoomWidth,
  getStructureByTemplateId,
  probeQueueBuild,
  requireTeamPayload,
} from './rts-test-support.js';
import { type BuildPreviewSnapshotInput, RtsEngine, RtsRoom } from './rts.js';
import { StructureTemplate } from './structure.js';

type RoomState = ReturnType<typeof RtsEngine.createRoomState>;

function toPreviewSnapshotInput(
  room: RoomState,
  teamId: number,
  payload: {
    templateId: string;
    x: number;
    y: number;
    transform?: BuildPreviewSnapshotInput['transform'];
  },
): BuildPreviewSnapshotInput {
  const team = room.teams.get(teamId);
  if (!team) {
    throw new Error(`Expected team ${String(teamId)} to exist`);
  }

  const template = room.templateMap.get(payload.templateId) ?? null;
  const identityTemplate =
    template === null
      ? null
      : template.project(createIdentityPlacementTransform());

  return {
    width: room.width,
    height: room.height,
    grid: room.grid,
    structures: RtsEngine.createRoomStatePayload(room).teams.flatMap(
      (candidateTeam) => candidateTeam.structures,
    ),
    teamResources: team.resources,
    teamDefeated: team.defeated,
    teamBuildZoneProjectionInputs: [...team.structures.values()]
      .sort((left, right) => left.key.localeCompare(right.key))
      .map((structure) => {
        const projectedTemplate = structure.projectTemplate();
        return {
          x: structure.x,
          y: structure.y,
          width: projectedTemplate.width,
          height: projectedTemplate.height,
          buildRadius: structure.buildRadius,
        };
      }),
    template:
      template === null || identityTemplate === null
        ? null
        : {
            width: template.width,
            height: template.height,
            grid: identityTemplate.grid,
            checks: template.checks,
            activationCost: template.activationCost,
          },
    x: payload.x,
    y: payload.y,
    transform: payload.transform,
  };
}

function getRoomId(room: RoomState): string {
  return room.id;
}

describe('rts', () => {
  test('serializes template payloads with packed cells and checks', () => {
    const blockTemplate = RtsEngine.createDefaultTemplates().find(
      (template) => template.id === 'block',
    );

    if (!blockTemplate) {
      throw new Error('Expected default block template to exist');
    }

    const payload = blockTemplate.toPayload();

    expect(payload.id).toBe(blockTemplate.id);
    expect(payload.width).toBe(blockTemplate.width);
    expect(payload.height).toBe(blockTemplate.height);
    expect(payload.activationCost).toBe(blockTemplate.activationCost);
    expect(payload.checks).toEqual(blockTemplate.checks);

    const unpackedCells = Grid.unpack(
      Uint8Array.from(payload.cells),
      payload.width,
      payload.height,
    );

    for (let y = 0; y < payload.height; y += 1) {
      for (let x = 0; x < payload.width; x += 1) {
        expect(unpackedCells[y * payload.width + x]).toBe(
          blockTemplate.isCellAlive(x, y) ? 1 : 0,
        );
      }
    }
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
    const outsideOffset =
      Math.floor(RtsEngine.CORE_STRUCTURE_TEMPLATE.buildRadius) + 1;

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
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
      delayTicks: 1.5,
    });
    expect(invalidDelay.accepted).toBe(false);
    expect(invalidDelay.error).toBe('delayTicks must be an integer');
    const timelineEvents = RtsEngine.getTimelineEvents(room);
    const invalidDelayEvent = timelineEvents[timelineEvents.length - 1];
    expect(invalidDelayEvent?.metadata?.reason).toBe('invalid-delay');

    const defaultDelay = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
    });
    expect(defaultDelay.accepted).toBe(true);
    expect(defaultDelay.executeTick).toBe(DEFAULT_QUEUE_DELAY_TICKS);

    const delayLow = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 10,
      y: team.baseTopLeft.y + 10,
      delayTicks: 0,
    });
    expect(delayLow.accepted).toBe(true);
    expect(delayLow.executeTick).toBe(1);

    const delayHigh = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 14,
      y: team.baseTopLeft.y + 14,
      delayTicks: 999,
    });
    expect(delayHigh.accepted).toBe(true);
    expect(delayHigh.executeTick).toBe(MAX_DELAY_TICKS);

    const queuedRows = requireTeamPayload(room, team.id).pendingBuilds;
    expect(queuedRows.map(({ executeTick }) => executeTick)).toEqual([
      1,
      DEFAULT_QUEUE_DELAY_TICKS,
      MAX_DELAY_TICKS,
    ]);
  });

  test('[BUILD-02] uses contributor template build radius for union-zone checks', () => {
    const probeTemplate = new StructureTemplate({
      id: 'probe',
      name: 'Probe',
      grid: createTemplateGrid(1, 1, [1]),
      activationCost: 0,
      income: 0,
      buildRadius: 0,
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
    const insideOffset = Math.floor(
      RtsEngine.CORE_STRUCTURE_TEMPLATE.buildRadius,
    );
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
      buildRadius: 0,
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

  test('matches room preview results with snapshot preview evaluator', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 80,
      height: 80,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const baseCenter = getBaseCenter(team.baseTopLeft);
    const payload = {
      templateId: 'block',
      x:
        baseCenter.x +
        Math.floor(RtsEngine.CORE_STRUCTURE_TEMPLATE.buildRadius),
      y: baseCenter.y,
      transform: {
        operations: ['rotate' as const],
      },
    };

    const roomPreview = RtsEngine.previewBuildPlacement(room, 'p1', payload);
    const snapshotPreview = RtsEngine.previewBuildPlacementFromSnapshot(
      toPreviewSnapshotInput(room, team.id, payload),
    );

    expect(snapshotPreview).toEqual(roomPreview);
  });

  test('matches room preview rejection reasons with snapshot preview evaluator', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 80,
      height: 80,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    const outsidePayload = {
      templateId: 'block',
      x: 79,
      y: 79,
    };
    const outsideRoomPreview = RtsEngine.previewBuildPlacement(
      room,
      'p1',
      outsidePayload,
    );
    const outsideSnapshotPreview = RtsEngine.previewBuildPlacementFromSnapshot(
      toPreviewSnapshotInput(room, team.id, outsidePayload),
    );
    expect(outsideSnapshotPreview).toEqual(outsideRoomPreview);

    team.resources = 0;
    const insufficientPayload = {
      templateId: 'block',
      x: team.baseTopLeft.x,
      y: team.baseTopLeft.y,
    };
    const insufficientRoomPreview = RtsEngine.previewBuildPlacement(
      room,
      'p1',
      insufficientPayload,
    );
    const insufficientSnapshotPreview =
      RtsEngine.previewBuildPlacementFromSnapshot(
        toPreviewSnapshotInput(room, team.id, insufficientPayload),
      );
    expect(insufficientSnapshotPreview).toEqual(insufficientRoomPreview);

    const unknownTemplatePayload = {
      templateId: 'missing-template',
      x: 0,
      y: 0,
    };
    const unknownRoomPreview = RtsEngine.previewBuildPlacement(
      room,
      'p1',
      unknownTemplatePayload,
    );
    const unknownSnapshotPreview = RtsEngine.previewBuildPlacementFromSnapshot(
      toPreviewSnapshotInput(room, team.id, unknownTemplatePayload),
    );

    expect(unknownSnapshotPreview).toEqual(unknownRoomPreview);
  });

  test('rejects overlapping existing structure footprints in room and snapshot previews', () => {
    const probeTemplate = new StructureTemplate({
      id: 'probe',
      name: 'Probe',
      grid: createTemplateGrid(1, 1, [1]),
      activationCost: 0,
      income: 0,
      buildRadius: 0,
      startingHp: 2,
      checks: [],
    });

    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 40,
      height: 40,
      templates: [...RtsEngine.createDefaultTemplates(), probeTemplate],
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const core = getCoreStructure(room, team.id);

    expect(core).not.toBeNull();
    if (core === null) {
      throw new Error('Expected core structure to exist');
    }

    const occupiedCell = core.footprint[0];
    expect(occupiedCell).toBeDefined();
    if (!occupiedCell) {
      throw new Error('Expected core footprint to include at least one cell');
    }

    const payload = {
      templateId: 'probe',
      x: occupiedCell.x,
      y: occupiedCell.y,
    };

    const roomPreview = RtsEngine.previewBuildPlacement(room, 'p1', payload);
    const snapshotPreview = RtsEngine.previewBuildPlacementFromSnapshot(
      toPreviewSnapshotInput(room, team.id, payload),
    );
    const queued = RtsEngine.queueBuildEvent(room, 'p1', payload);

    expect(roomPreview).toMatchObject({
      accepted: false,
      reason: 'occupied-site',
    });
    expect(snapshotPreview).toEqual(roomPreview);
    expect(queued).toMatchObject({
      accepted: false,
      reason: 'occupied-site',
    });
  });

  test('normalizes wrapped-equivalent anchors to one occupied site key', () => {
    const probeTemplate = new StructureTemplate({
      id: 'probe',
      name: 'Probe',
      grid: createTemplateGrid(1, 1, [1]),
      activationCost: 0,
      income: 0,
      buildRadius: 0,
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
    const insideOffset = Math.floor(
      RtsEngine.CORE_STRUCTURE_TEMPLATE.buildRadius,
    );

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

  test('refunds queued build cost when a later duplicate rejects as occupied-site', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 40,
      height: 40,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const initialResources = team.resources;
    const x = team.baseTopLeft.x + 8;
    const y = team.baseTopLeft.y + 8;

    const first = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x,
      y,
      delayTicks: 1,
    });
    const duplicate = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x,
      y,
      delayTicks: 1,
    });

    expect(first.accepted).toBe(true);
    expect(duplicate.accepted).toBe(true);

    const firstCost = first.needed ?? 0;
    const duplicateCost = duplicate.needed ?? 0;
    expect(team.resources).toBe(initialResources - firstCost - duplicateCost);

    RtsEngine.tickRoom(room);
    const result = RtsEngine.tickRoom(room);
    const duplicateOutcome = result.buildOutcomes.find(
      ({ eventId }) => eventId === duplicate.eventId,
    );

    expect(result.appliedBuilds).toBe(1);
    expect(duplicateOutcome).toMatchObject({
      eventId: duplicate.eventId,
      teamId: team.id,
      outcome: 'rejected',
      reason: 'occupied-site',
    });
    expect(team.resources).toBe(initialResources - firstCost);
  });

  test('rejects same-tick builds whose footprints overlap different structure bounds', () => {
    const probeTemplate = new StructureTemplate({
      id: 'probe',
      name: 'Probe',
      grid: createTemplateGrid(1, 1, [1]),
      activationCost: 0,
      income: 0,
      buildRadius: 0,
      startingHp: 2,
      checks: [],
    });

    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 40,
      height: 40,
      templates: [...RtsEngine.createDefaultTemplates(), probeTemplate],
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const initialResources = team.resources;
    const x = team.baseTopLeft.x + 8;
    const y = team.baseTopLeft.y + 8;

    const block = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x,
      y,
      delayTicks: 1,
    });
    const overlappingProbe = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'probe',
      x: x + 1,
      y: y + 1,
      delayTicks: 1,
    });

    expect(block.accepted).toBe(true);
    expect(overlappingProbe.accepted).toBe(true);

    const blockCost = block.needed ?? 0;
    const probeCost = overlappingProbe.needed ?? 0;
    expect(team.resources).toBe(initialResources - blockCost - probeCost);

    RtsEngine.tickRoom(room);
    const result = RtsEngine.tickRoom(room);
    const probeOutcome = result.buildOutcomes.find(
      ({ eventId }) => eventId === overlappingProbe.eventId,
    );

    expect(result.appliedBuilds).toBe(1);
    expect(probeOutcome).toMatchObject({
      eventId: overlappingProbe.eventId,
      teamId: team.id,
      outcome: 'rejected',
      reason: 'occupied-site',
    });
    expect(countStructuresByTemplateId(room, team.id, 'block')).toBe(1);
    expect(countStructuresByTemplateId(room, team.id, 'probe')).toBe(0);
    expect(team.resources).toBe(initialResources - blockCost);
  });

  test('[BUILD-01] updates union-zone eligibility after build completion and structure destruction', () => {
    const probeTemplate = new StructureTemplate({
      id: 'probe',
      name: 'Probe',
      grid: createTemplateGrid(1, 1, [1]),
      activationCost: 0,
      income: 0,
      buildRadius: 0,
      startingHp: 2,
      checks: [],
    });
    const relayTemplate = new StructureTemplate({
      id: 'relay',
      name: 'Relay',
      grid: createTemplateGrid(2, 2, [1, 1, 1, 1]),
      activationCost: 0,
      income: 0,
      buildRadius: 6,
      startingHp: 2,
      checks: [],
    });

    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 120,
      height: 120,
      templates: [
        ...RtsEngine.createDefaultTemplates(),
        probeTemplate,
        relayTemplate,
      ],
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const baseCenter = getBaseCenter(team.baseTopLeft);
    const remoteOffset = Math.floor(relayTemplate.buildRadius);

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
      templateId: 'relay',
      x: setup.contributorX,
      y: setup.contributorY,
      delayTicks: 1,
    });
    expect(contributor.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    const whileInactive = probeQueueBuild(room, 'p1', {
      templateId: 'probe',
      x: setup.remoteX,
      y: setup.remoteY,
      delayTicks: 1,
    });
    expect(whileInactive.accepted).toBe(false);
    expect(whileInactive.reason).toBe('outside-territory');

    const builtContributor = getStructureByTemplateId(room, team.id, 'relay');
    expect(builtContributor).not.toBeNull();
    if (!builtContributor) {
      throw new Error('Expected contributor structure to exist before destroy');
    }
    expect(builtContributor.active).toBe(false);

    RtsEngine.tickRoom(room);

    const afterActivation = probeQueueBuild(room, 'p1', {
      templateId: 'probe',
      x: setup.remoteX,
      y: setup.remoteY,
      delayTicks: 1,
    });
    expect(afterActivation.accepted).toBe(true);

    const queuedDestroy = RtsEngine.queueDestroyEvent(room, 'p1', {
      structureKey: builtContributor.key,
      delayTicks: 1,
    });
    expect(queuedDestroy.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    const destroyedContributor = getStructureByTemplateId(
      room,
      team.id,
      'relay',
    );

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
    });
    expect(first.accepted).toBe(true);
    expect(first.idempotent).toBe(false);
    expect(first.executeTick).toBe(room.tick + DEFAULT_QUEUE_DELAY_TICKS);

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

  test('[QUAL-01] applies default destroy delay when delayTicks is omitted', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 90,
      height: 90,
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

    const ownStructure = getStructureByTemplateId(room, team.id, 'block');
    expect(ownStructure).not.toBeNull();
    if (!ownStructure) {
      throw new Error('Expected own block structure to exist');
    }

    const currentTick = room.tick;
    const queuedDestroy = RtsEngine.queueDestroyEvent(room, 'p1', {
      structureKey: ownStructure.key,
    });
    expect(queuedDestroy.accepted).toBe(true);
    expect(queuedDestroy.executeTick).toBe(
      currentTick + DEFAULT_QUEUE_DELAY_TICKS,
    );
  });

  test('[STRUCT-02] applies queued destroy outcomes and removes contributor build zone', () => {
    const probeTemplate = new StructureTemplate({
      id: 'probe',
      name: 'Probe',
      grid: createTemplateGrid(1, 1, [1]),
      activationCost: 0,
      income: 0,
      buildRadius: 0,
      startingHp: 2,
      checks: [],
    });
    const relayTemplate = new StructureTemplate({
      id: 'relay',
      name: 'Relay',
      grid: createTemplateGrid(2, 2, [1, 1, 1, 1]),
      activationCost: 0,
      income: 0,
      buildRadius: 6,
      startingHp: 2,
      checks: [],
    });

    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 120,
      height: 120,
      templates: [
        ...RtsEngine.createDefaultTemplates(),
        probeTemplate,
        relayTemplate,
      ],
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const baseCenter = getBaseCenter(team.baseTopLeft);
    const remoteOffset = Math.floor(relayTemplate.buildRadius);

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
      templateId: 'relay',
      x: setup.contributorX,
      y: setup.contributorY,
      delayTicks: 1,
    });
    expect(contributor.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);
    expect(
      probeQueueBuild(room, 'p1', {
        templateId: 'probe',
        x: setup.remoteX,
        y: setup.remoteY,
        delayTicks: 1,
      }).accepted,
    ).toBe(false);

    RtsEngine.tickRoom(room);

    const expanded = probeQueueBuild(room, 'p1', {
      templateId: 'probe',
      x: setup.remoteX,
      y: setup.remoteY,
      delayTicks: 1,
    });
    expect(expanded.accepted).toBe(true);

    const builtContributor = getStructureByTemplateId(room, team.id, 'relay');
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
        templateId: 'relay',
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
      checkpoint: ReturnType<typeof RtsEngine.createDeterminismCheckpoint>;
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
      const checkpoint = RtsEngine.createDeterminismCheckpoint(room);
      expect(RtsRoom.fromState(room).createDeterminismCheckpoint()).toEqual(
        checkpoint,
      );

      return {
        destroyOutcomes: resolved.destroyOutcomes,
        payload: RtsEngine.createRoomStatePayload(room),
        checkpoint,
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
    expect(firstRun.checkpoint).toEqual(secondRun.checkpoint);
    expect(firstRun.checkpoint.hashAlgorithm).toBe('fnv1a-32');
    expect(firstRun.checkpoint.hashHex).toMatch(/^[0-9a-f]{8}$/);
  });

  test('[QUAL-04] includes queued structures and economy state in determinism checkpoints', () => {
    const room = RtsEngine.createRoomState({
      id: 'checkpoint-room',
      name: 'Checkpoint Coverage',
      width: 80,
      height: 80,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    const initialCheckpoint = RtsEngine.createDeterminismCheckpoint(room);
    const initialStateHashes = RtsEngine.createStateHashes(room);

    const queuedBuild = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
      delayTicks: 5,
    });
    expect(queuedBuild.accepted).toBe(true);

    const afterQueuedBuildCheckpoint =
      RtsEngine.createDeterminismCheckpoint(room);
    const afterQueuedBuildHashes = RtsEngine.createStateHashes(room);

    expect(afterQueuedBuildHashes.gridHash).toBe(initialStateHashes.gridHash);
    expect(afterQueuedBuildHashes.structuresHash).not.toBe(
      initialStateHashes.structuresHash,
    );
    expect(afterQueuedBuildHashes.economyHash).not.toBe(
      initialStateHashes.economyHash,
    );
    expect(afterQueuedBuildCheckpoint.hashHex).not.toBe(
      initialCheckpoint.hashHex,
    );
  });

  test('[QUAL-04] isolates authoritative grid and structures hashes', () => {
    const room = RtsEngine.createRoomState({
      id: 'state-hash-room',
      name: 'State Hashes',
      width: 80,
      height: 80,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    const initial = RtsEngine.createStateHashes(room);
    expect(RtsRoom.fromState(room).createStateHashes()).toEqual(initial);

    RtsEngine.renamePlayerInRoom(room, 'p1', 'Alicia');
    expect(RtsEngine.createStateHashes(room)).toEqual(initial);

    const queuedBuild = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
      delayTicks: 5,
    });
    expect(queuedBuild.accepted).toBe(true);

    const afterQueuedBuild = RtsEngine.createStateHashes(room);
    expect(afterQueuedBuild.gridHash).toBe(initial.gridHash);
    expect(afterQueuedBuild.structuresHash).not.toBe(initial.structuresHash);
    expect(afterQueuedBuild.economyHash).not.toBe(initial.economyHash);

    room.grid.setCell(0, 0, true);
    const afterGridMutation = RtsEngine.createStateHashes(room);
    expect(afterGridMutation.gridHash).not.toBe(afterQueuedBuild.gridHash);
    expect(afterGridMutation.structuresHash).toBe(
      afterQueuedBuild.structuresHash,
    );
    expect(afterGridMutation.economyHash).toBe(afterQueuedBuild.economyHash);
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
      x: team.baseTopLeft.x + 10,
      y: team.baseTopLeft.y + 10,
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
      x: teamA.baseTopLeft.x + 8,
      y: teamA.baseTopLeft.y + 8,
      delayTicks: 1,
    });
    const queueB = RtsEngine.queueBuildEvent(roomB, 'p1', {
      templateId: 'block',
      x: teamB.baseTopLeft.x + 8,
      y: teamB.baseTopLeft.y + 8,
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

  test('[QUAL-04] preserves authoritative queue payload parity in room state snapshots', () => {
    const room = RtsEngine.createRoomState({
      id: 'snapshot-room',
      name: 'Snapshot Room',
      width: 60,
      height: 60,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const transform = normalizePlacementTransform({ operations: ['rotate'] });

    const buildX = team.baseTopLeft.x + 8;
    const buildY = team.baseTopLeft.y + 8;
    const buildResult = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: buildX,
      y: buildY,
      transform,
      delayTicks: 3,
    });
    if (!buildResult.accepted) {
      throw new Error(`Expected build to queue, got ${buildResult.reason}`);
    }

    const core = getCoreStructure(room, team.id);
    if (!core) {
      throw new Error('Expected team core structure');
    }

    const destroyResult = RtsEngine.queueDestroyEvent(room, 'p1', {
      structureKey: core.key,
      delayTicks: 4,
    });
    if (!destroyResult.accepted) {
      throw new Error(`Expected destroy to queue, got ${destroyResult.reason}`);
    }

    const payload = RtsEngine.createRoomStatePayload(room);
    const teamPayload = payload.teams.find(({ id }) => id === team.id);

    expect(teamPayload).toBeDefined();
    expect(teamPayload?.resources).toBe(team.resources);
    expect(teamPayload?.pendingBuilds).toContainEqual({
      eventId: buildResult.eventId,
      executeTick: buildResult.executeTick,
      playerId: 'p1',
      templateId: 'block',
      templateName: 'Block 2x2',
      x: buildX,
      y: buildY,
      transform,
    });
    expect(teamPayload?.pendingDestroys).toContainEqual({
      eventId: destroyResult.eventId,
      executeTick: destroyResult.executeTick,
      playerId: 'p1',
      structureKey: core.key,
      templateId: core.templateId,
      templateName: core.templateName,
      x: core.x,
      y: core.y,
      requiresDestroyConfirm: core.requiresDestroyConfirm,
    });
  });

  test('[QUAL-04] preserves structure transforms in room state snapshots', () => {
    const room = RtsEngine.createRoomState({
      id: 'transform-room',
      name: 'Transform Room',
      width: 60,
      height: 60,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const transform = normalizePlacementTransform({ operations: ['rotate'] });
    let buildPlacement: { x: number; y: number } | null = null;
    for (let y = 0; y < room.height && !buildPlacement; y += 1) {
      for (let x = 0; x < room.width; x += 1) {
        const preview = probeQueueBuild(room, 'p1', {
          templateId: 'block',
          x,
          y,
          transform,
        });
        if (!preview.accepted) {
          continue;
        }

        buildPlacement = { x, y };
        break;
      }
    }
    if (!buildPlacement) {
      throw new Error('Expected valid block placement');
    }

    const buildResult = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: buildPlacement.x,
      y: buildPlacement.y,
      transform,
      delayTicks: 1,
    });
    if (!buildResult.accepted) {
      throw new Error(`Expected build to queue, got ${buildResult.reason}`);
    }

    RtsEngine.tickRoom(room);
    RtsEngine.tickRoom(room);

    const payload = RtsEngine.createRoomStatePayload(room);
    const teamPayload = payload.teams.find(({ id }) => id === team.id);
    const block = teamPayload?.structures.find(
      (structure) => !structure.isCore,
    );

    expect(block).toBeDefined();
    expect(block?.transform).toEqual(transform);
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
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
      delayTicks: 5,
    });
    const second = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'glider',
      x: team.baseTopLeft.x + 12,
      y: team.baseTopLeft.y + 8,
      delayTicks: 3,
    });
    const third = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'generator',
      x: team.baseTopLeft.x + 12,
      y: team.baseTopLeft.y + 12,
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
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
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
      structures: 1,
      total: 1,
      activeStructureCount: 1,
    });

    for (let index = 0; index < 8; index += 1) {
      clearCells(room, generatorCells);
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
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
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
      x: teamTwo.baseTopLeft.x + 8,
      y: teamTwo.baseTopLeft.y + 8,
      delayTicks: 1,
    });
    const teamOneQueued = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: teamOne.baseTopLeft.x + 8,
      y: teamOne.baseTopLeft.y + 8,
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

    for (let index = 0; index < 4; index += 1) {
      result = RtsEngine.tickRoom(room);
      if (result.defeatedTeams.includes(teamOne.id)) {
        break;
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

  test('keeps a three-team match active until only one team remains', () => {
    const room = RtsEngine.createRoomState({
      id: 'multi-outcome-room',
      name: 'Multi Outcome Room',
      width: 56,
      height: 56,
    });
    const teamOne = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const teamTwo = RtsEngine.addPlayerToRoom(room, 'p2', 'Bob');
    const teamThree = RtsEngine.addPlayerToRoom(room, 'p3', 'Cara');

    const teamOneCore = getCoreStructure(room, teamOne.id);
    expect(teamOneCore).not.toBeNull();
    if (!teamOneCore) {
      throw new Error('Expected team one core structure in room payload');
    }

    expect(
      RtsEngine.queueDestroyEvent(room, 'p1', {
        structureKey: teamOneCore.key,
        delayTicks: 0,
      }).accepted,
    ).toBe(true);

    let result = RtsEngine.tickRoom(room);
    for (let index = 0; index < 4; index += 1) {
      if (result.defeatedTeams.includes(teamOne.id)) {
        break;
      }
      result = RtsEngine.tickRoom(room);
    }

    expect(result.defeatedTeams).toEqual([teamOne.id]);
    expect(result.outcome).toBeNull();

    const teamTwoCore = getCoreStructure(room, teamTwo.id);
    expect(teamTwoCore).not.toBeNull();
    if (!teamTwoCore) {
      throw new Error('Expected team two core structure in room payload');
    }

    expect(
      RtsEngine.queueDestroyEvent(room, 'p2', {
        structureKey: teamTwoCore.key,
        delayTicks: 0,
      }).accepted,
    ).toBe(true);

    for (let index = 0; index < 4; index += 1) {
      result = RtsEngine.tickRoom(room);
      if (result.defeatedTeams.includes(teamTwo.id)) {
        break;
      }
    }

    expect(result.defeatedTeams).toEqual([teamTwo.id]);
    expect(result.outcome?.winner.teamId).toBe(teamThree.id);
  });

  test('lets multiple commanders issue commands against shared team resources', () => {
    const room = RtsEngine.createRoomState({
      id: 'shared-team-room',
      name: 'Shared Team Room',
      width: 52,
      height: 52,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice', {
      teamName: 'Team 1',
    });
    const teammate = RtsEngine.addPlayerToRoom(room, 'p2', 'Bob', {
      teamId: team.id,
    });

    expect(teammate.id).toBe(team.id);

    const queued = RtsEngine.queueBuildEvent(room, 'p2', {
      templateId: 'block',
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);

    RtsEngine.tickRoom(room);
    const resolved = RtsEngine.tickRoom(room);

    expect(getBuildOutcomes(resolved)).toContainEqual({
      eventId: queued.eventId,
      teamId: team.id,
      outcome: 'applied',
      executeTick: queued.executeTick,
      resolvedTick: queued.executeTick,
    });
    expect(room.players.get('p2')?.teamId).toBe(team.id);
    expect(room.teams.get(team.id)?.playerIds).toEqual(new Set(['p1', 'p2']));
  });

  test('charges build costs when queued and does not charge again on apply', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 50,
      height: 50,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');
    const initialResources = team.resources;

    const buildPosition = {
      x: team.baseTopLeft.x + 10,
      y: team.baseTopLeft.y + 10,
    };
    const queued = RtsEngine.queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: buildPosition.x,
      y: buildPosition.y,
      delayTicks: 1,
    });
    expect(queued.accepted).toBe(true);
    const expectedCost = queued.needed ?? 0;
    expect(team.resources).toBe(initialResources - expectedCost);

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
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
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

    expect(team.income).toBeGreaterThanOrEqual(0);
    expect(team.resources).toBe(postBuildResources + team.income);

    for (let index = 0; index < 8; index += 1) {
      clearCells(room, generatorCells);
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

  test('removes generators after unresolved integrity breaches', () => {
    const room = RtsEngine.createRoomState({
      id: '1',
      name: 'Alpha',
      width: 60,
      height: 60,
    });
    const team = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice');

    const position = {
      x: team.baseTopLeft.x + 8,
      y: team.baseTopLeft.y + 8,
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

    // make sure the generator is dead by then
    for (let i = 0; i < 20; ++i) {
      clearCells(room, generatorCells);

      RtsEngine.tickRoom(room);
      RtsEngine.tickRoom(room);
    }

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
      buildRadius: 0,
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

    clearCells(room, [placement]);
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

    clearCells(room, [placement]);
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
      grid: createTemplateGrid(2, 2, [1, 1, 1, 1]),
      activationCost: 0,
      income: 0,
      buildRadius: 0,
      startingHp: 2,
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

    let durablePlacement: { x: number; y: number } | null = null;
    for (let y = 0; y <= getRoomHeight(room) - 2 && !durablePlacement; y += 1) {
      for (let x = 0; x <= getRoomWidth(room) - 2; x += 1) {
        if (
          !probeQueueBuild(room, 'p1', {
            templateId: 'durable',
            x,
            y,
            delayTicks: 1,
          }).accepted
        ) {
          continue;
        }

        durablePlacement = { x, y };
        break;
      }
    }
    expect(durablePlacement).not.toBeNull();
    if (!durablePlacement) {
      throw new Error('Expected a legal placement for durable structure');
    }

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
    expect(durable?.hp).toBe(2);

    const durableCells = [
      { x: durablePlacement.x, y: durablePlacement.y },
      { x: durablePlacement.x + 1, y: durablePlacement.y },
      { x: durablePlacement.x, y: durablePlacement.y + 1 },
      { x: durablePlacement.x + 1, y: durablePlacement.y + 1 },
    ];
    clearCells(room, durableCells);

    let destroyed = getStructureByTemplateId(room, team.id, 'durable');
    for (let index = 0; index < 8 && destroyed; index += 1) {
      clearCells(room, durableCells);
      RtsEngine.tickRoom(room);
      destroyed = getStructureByTemplateId(room, team.id, 'durable');
    }

    expect(destroyed).toBeNull();

    const payload = RtsEngine.createRoomStatePayload(room);
    for (const cell of durableCells) {
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
      clearCells(room, baseCells);
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
    const initialResources = team.resources;
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
    expect(team.resources).toBe(initialResources - (queued.needed ?? 0));

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
    expect(team.resources).toBe(initialResources);
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

describe('RtsRoom.fromPayload', () => {
  test('reconstructs room with matching hash at same tick', () => {
    const source = RtsRoom.create({
      id: 'test-room',
      name: 'Test',
      width: 80,
      height: 80,
    });
    source.addPlayer('p1', 'Alice');

    // Tick a few times to establish non-trivial state
    for (let i = 0; i < 5; i++) {
      source.tick();
    }

    const payload = source.createStatePayload();
    const reconstructed = RtsRoom.fromPayload(
      payload,
      source.state.templates,
    );

    expect(reconstructed.createDeterminismCheckpoint().hashHex).toBe(
      source.createDeterminismCheckpoint().hashHex,
    );
  });

  test('reconstructed room matches after additional ticks', () => {
    const source = RtsRoom.create({
      id: 'test-room',
      name: 'Test',
      width: 80,
      height: 80,
    });
    source.addPlayer('p1', 'Alice');

    for (let i = 0; i < 5; i++) {
      source.tick();
    }

    const payload = source.createStatePayload();
    const reconstructed = RtsRoom.fromPayload(
      payload,
      source.state.templates,
    );

    // Tick both rooms 10 more times
    for (let i = 0; i < 10; i++) {
      source.tick();
      reconstructed.tick();
    }

    expect(reconstructed.createDeterminismCheckpoint().hashHex).toBe(
      source.createDeterminismCheckpoint().hashHex,
    );
  });

  test('reconstructs pending build events that execute correctly', () => {
    const source = RtsRoom.create({
      id: 'test-room',
      name: 'Test',
      width: 80,
      height: 80,
    });
    source.addPlayer('p1', 'Alice');

    // Tick once to initialize economy
    source.tick();

    // Queue a build that won't execute for a few ticks
    const base = source.state.teams.get(1)!.baseTopLeft;
    source.queueBuildEvent('p1', {
      templateId: 'block',
      x: base.x + 14,
      y: base.y,
      delayTicks: 5,
    });

    const payload = source.createStatePayload();
    const reconstructed = RtsRoom.fromPayload(
      payload,
      source.state.templates,
    );

    // At reconstruction time, hashes must match
    expect(reconstructed.createDeterminismCheckpoint().hashHex).toBe(
      source.createDeterminismCheckpoint().hashHex,
    );

    // Tick past the build execution tick
    for (let i = 0; i < 10; i++) {
      source.tick();
      reconstructed.tick();
    }

    expect(reconstructed.createDeterminismCheckpoint().hashHex).toBe(
      source.createDeterminismCheckpoint().hashHex,
    );
  });

  test('reconstructs pending destroy events that execute correctly', () => {
    const source = RtsRoom.create({
      id: 'test-room',
      name: 'Test',
      width: 80,
      height: 80,
    });
    source.addPlayer('p1', 'Alice');

    // Tick to initialize
    source.tick();

    // Build a structure first
    const base = source.state.teams.get(1)!.baseTopLeft;
    source.queueBuildEvent('p1', {
      templateId: 'block',
      x: base.x + 14,
      y: base.y,
    });

    // Tick past the build
    for (let i = 0; i < 15; i++) {
      source.tick();
    }

    // Find a non-core structure to destroy
    const team = source.state.teams.get(1)!;
    const nonCoreStructure = [...team.structures.values()].find(
      (s) => !s.isCore,
    );
    if (nonCoreStructure) {
      source.queueDestroyEvent('p1', {
        structureKey: nonCoreStructure.key,
        delayTicks: 5,
      });
    }

    const payload = source.createStatePayload();
    const reconstructed = RtsRoom.fromPayload(
      payload,
      source.state.templates,
    );

    expect(reconstructed.createDeterminismCheckpoint().hashHex).toBe(
      source.createDeterminismCheckpoint().hashHex,
    );

    // Tick past destroy execution
    for (let i = 0; i < 10; i++) {
      source.tick();
      reconstructed.tick();
    }

    expect(reconstructed.createDeterminismCheckpoint().hashHex).toBe(
      source.createDeterminismCheckpoint().hashHex,
    );
  });

  test('reconstructs multi-team room with canonical Map order', () => {
    const source = RtsRoom.create({
      id: 'test-room',
      name: 'Test',
      width: 80,
      height: 80,
    });
    source.addPlayer('p1', 'Alice');
    source.addPlayer('p2', 'Bob');

    // Tick to establish state
    for (let i = 0; i < 5; i++) {
      source.tick();
    }

    // Build structures for both teams
    const team1 = source.state.teams.get(1)!;
    const team2 = source.state.teams.get(2)!;
    source.queueBuildEvent('p1', {
      templateId: 'block',
      x: team1.baseTopLeft.x + 14,
      y: team1.baseTopLeft.y,
    });
    source.queueBuildEvent('p2', {
      templateId: 'block',
      x: team2.baseTopLeft.x + 14,
      y: team2.baseTopLeft.y,
    });

    for (let i = 0; i < 15; i++) {
      source.tick();
    }

    const payload = source.createStatePayload();
    const reconstructed = RtsRoom.fromPayload(
      payload,
      source.state.templates,
    );

    expect(reconstructed.createDeterminismCheckpoint().hashHex).toBe(
      source.createDeterminismCheckpoint().hashHex,
    );

    // Tick both and verify continued determinism
    for (let i = 0; i < 10; i++) {
      source.tick();
      reconstructed.tick();
    }

    expect(reconstructed.createDeterminismCheckpoint().hashHex).toBe(
      source.createDeterminismCheckpoint().hashHex,
    );
  });

  test('preserves damaged structure hp', () => {
    const source = RtsRoom.create({
      id: 'test-room',
      name: 'Test',
      width: 80,
      height: 80,
    });
    source.addPlayer('p1', 'Alice');

    // Manually damage a structure
    const team = source.state.teams.get(1)!;
    const core = [...team.structures.values()].find((s) => s.isCore)!;
    core.hp = 250; // damage from 500 to 250

    const payload = source.createStatePayload();
    const reconstructed = RtsRoom.fromPayload(
      payload,
      source.state.templates,
    );

    expect(reconstructed.createDeterminismCheckpoint().hashHex).toBe(
      source.createDeterminismCheckpoint().hashHex,
    );

    // Check that the core hp is preserved
    const reconstructedTeam = reconstructed.state.teams.get(1)!;
    const reconstructedCore = [...reconstructedTeam.structures.values()].find(
      (s) => s.isCore,
    )!;
    expect(reconstructedCore.hp).toBe(250);
  });

  test('preserves defeated team flag', () => {
    const source = RtsRoom.create({
      id: 'test-room',
      name: 'Test',
      width: 80,
      height: 80,
    });
    source.addPlayer('p1', 'Alice');

    // Manually defeat the team
    const team = source.state.teams.get(1)!;
    team.defeated = true;

    const payload = source.createStatePayload();
    const reconstructed = RtsRoom.fromPayload(
      payload,
      source.state.templates,
    );

    const reconstructedTeam = reconstructed.state.teams.get(1)!;
    expect(reconstructedTeam.defeated).toBe(true);

    expect(reconstructed.createDeterminismCheckpoint().hashHex).toBe(
      source.createDeterminismCheckpoint().hashHex,
    );
  });

  test('sets tick and generation from payload, not zero', () => {
    const source = RtsRoom.create({
      id: 'test-room',
      name: 'Test',
      width: 80,
      height: 80,
    });
    source.addPlayer('p1', 'Alice');

    // Tick to a non-zero state
    for (let i = 0; i < 20; i++) {
      source.tick();
    }

    const payload = source.createStatePayload();
    const reconstructed = RtsRoom.fromPayload(
      payload,
      source.state.templates,
    );

    expect(reconstructed.state.tick).toBe(payload.tick);
    expect(reconstructed.state.generation).toBe(payload.generation);
    expect(reconstructed.state.tick).toBeGreaterThan(0);
    expect(reconstructed.state.generation).toBeGreaterThan(0);
  });
});
