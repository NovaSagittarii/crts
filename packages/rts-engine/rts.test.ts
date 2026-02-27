import { describe, expect, test } from 'vitest';

import { decodeGridBase64 } from '#conway-core';
import {
  addPlayerToRoom,
  createCanonicalMatchOutcome,
  createDefaultTemplates,
  createRoomState,
  createRoomStatePayload,
  createTeamOutcomeSnapshots,
  createTemplateSummaries,
  listRooms,
  queueBuildEvent,
  queueLegacyCellUpdate,
  removePlayerFromRoom,
  renamePlayerInRoom,
  tickRoom,
} from './rts.js';

interface Cell {
  x: number;
  y: number;
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
  encodedGrid: string,
  width: number,
  height: number,
  cell: Cell,
): boolean {
  const grid = decodeGridBase64(encodedGrid, width * height);
  return grid[cell.y * width + cell.x] === 1;
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
    expect(getCellAlive(payload.grid, room.width, room.height, base)).toBe(
      true,
    );
    expect(
      getCellAlive(payload.grid, room.width, room.height, {
        x: base.x + 1,
        y: base.y,
      }),
    ).toBe(true);
    expect(
      getCellAlive(payload.grid, room.width, room.height, {
        x: base.x,
        y: base.y + 1,
      }),
    ).toBe(true);
    expect(
      getCellAlive(payload.grid, room.width, room.height, {
        x: base.x + 1,
        y: base.y + 1,
      }),
    ).toBe(true);

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

  test('validates build queue payloads and delay clamping', () => {
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

    const outsideTerritory = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + team.territoryRadius + 20,
      y: team.baseTopLeft.y + team.territoryRadius + 20,
    });
    expect(outsideTerritory.accepted).toBe(false);

    const invalidDelay = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 2,
      y: team.baseTopLeft.y + 2,
      delayTicks: 1.5,
    });
    expect(invalidDelay.accepted).toBe(false);
    expect(invalidDelay.error).toBe('delayTicks must be an integer');
    const invalidDelayEvent =
      room.timelineEvents[room.timelineEvents.length - 1];
    expect(invalidDelayEvent?.metadata?.reason).toBe('invalid-delay');

    const delayLow = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 2,
      y: team.baseTopLeft.y + 2,
      delayTicks: 0,
    });
    expect(delayLow.accepted).toBe(true);
    expect(delayLow.executeTick).toBe(1);

    const delayHigh = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: team.baseTopLeft.x + 4,
      y: team.baseTopLeft.y + 4,
      delayTicks: 999,
    });
    expect(delayHigh.accepted).toBe(true);
    expect(delayHigh.executeTick).toBe(20);

    const queued = room.teams.get(team.id)?.pendingBuildEvents ?? [];
    expect(queued.map(({ executeTick }) => executeTick)).toEqual([1, 20]);
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

    const baseCells = [
      { x: base.x, y: base.y },
      { x: base.x + 1, y: base.y },
      { x: base.x, y: base.y + 1 },
      { x: base.x + 1, y: base.y + 1 },
    ];
    const initialHp = getCoreStructure(teamOne).hp;

    let result = tickRoom(room);
    expect(result.outcome).toBeNull();

    for (let cycle = 0; cycle < initialHp; cycle += 1) {
      for (const cell of baseCells) {
        queueLegacyCellUpdate(room, {
          x: cell.x,
          y: cell.y,
          alive: 0,
        });
      }

      result = tickRoom(room);
    }

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

  test('consumes core hp on breach checks and defeats team when hp reaches zero', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 30,
      height: 30,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');
    const core = getCoreStructure(team);
    const base = team.baseTopLeft;

    expect(core.hp).toBeGreaterThan(1);
    const initialHp = core.hp;

    const baseCells = [
      { x: base.x, y: base.y },
      { x: base.x + 1, y: base.y },
      { x: base.x, y: base.y + 1 },
      { x: base.x + 1, y: base.y + 1 },
    ];

    for (let cycle = 0; cycle < initialHp - 1; cycle += 1) {
      for (const cell of baseCells) {
        queueLegacyCellUpdate(room, {
          x: cell.x,
          y: cell.y,
          alive: 0,
        });
      }

      const tickResult = tickRoom(room);
      const updatedCore = getCoreStructure(team);

      expect(tickResult.defeatedTeams).toHaveLength(0);
      expect(updatedCore.hp).toBe(initialHp - (cycle + 1));
      expect(updatedCore.active).toBe(true);
      expect(team.defeated).toBe(false);
    }

    for (const cell of baseCells) {
      queueLegacyCellUpdate(room, {
        x: cell.x,
        y: cell.y,
        alive: 0,
      });
    }

    const finalTick = tickRoom(room);
    const finalCore = getCoreStructure(team);

    expect(finalTick.defeatedTeams).toEqual([team.id]);
    expect(finalCore.hp).toBe(0);
    expect(finalCore.active).toBe(false);
    expect(team.defeated).toBe(true);
  });

  test('marks team defeated when core hp is exhausted by repeated breaches', () => {
    const room = createRoomState({
      id: '1',
      name: 'Alpha',
      width: 30,
      height: 30,
    });
    const team = addPlayerToRoom(room, 'p1', 'Alice');
    const base = team.baseTopLeft;

    const queued = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: base.x + 2,
      y: base.y + 2,
      delayTicks: 20,
    });
    expect(queued.accepted).toBe(true);

    const baseCells = [
      { x: base.x, y: base.y },
      { x: base.x + 1, y: base.y },
      { x: base.x, y: base.y + 1 },
      { x: base.x + 1, y: base.y + 1 },
    ];
    const initialHp = getCoreStructure(team).hp;
    let result = tickRoom(room);

    for (let cycle = 0; cycle < initialHp; cycle += 1) {
      for (const cell of baseCells) {
        queueLegacyCellUpdate(room, {
          x: cell.x,
          y: cell.y,
          alive: 0,
        });
      }

      result = tickRoom(room);
    }

    expect(result.defeatedTeams).toEqual([team.id]);
    expect(team.defeated).toBe(true);
    expect(team.pendingBuildEvents).toHaveLength(0);

    const afterDefeat = queueBuildEvent(room, 'p1', {
      templateId: 'block',
      x: base.x + 4,
      y: base.y + 4,
    });
    expect(afterDefeat.accepted).toBe(false);
    expect(afterDefeat.error).toMatch(/defeated/i);
  });
});
