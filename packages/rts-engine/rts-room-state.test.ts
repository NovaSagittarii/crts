import { describe, expect, test } from 'vitest';

import {
  BASE_FOOTPRINT_HEIGHT,
  BASE_FOOTPRINT_WIDTH,
  getCanonicalBaseCells,
  isCanonicalBaseCell,
} from './geometry.js';
import {
  getCellAlive,
  getRoomHeight,
  getRoomId,
  getRoomWidth,
} from './rts-test-support.js';
import { RtsEngine, RtsRoom } from './rts.js';

describe('rts room state', () => {
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

    const teammate = RtsEngine.addPlayerToRoom(room, 'p2', 'Bob', {
      teamId: team.id,
    });
    expect(teammate.id).toBe(team.id);
    expect(room.players.get('p2')?.teamId).toBe(team.id);
    expect(room.teams.get(team.id)?.playerIds).toEqual(new Set(['p1', 'p2']));

    RtsEngine.renamePlayerInRoom(room, 'p1', 'Alice Prime');
    expect(room.teams.get(team.id)?.name).toBe(`Alicia's Team`);

    RtsEngine.removePlayerFromRoom(room, 'p1');
    expect(room.players.has('p1')).toBe(false);
    expect(room.teams.has(team.id)).toBe(true);

    RtsEngine.removePlayerFromRoom(room, 'p2');
    expect(room.teams.has(team.id)).toBe(false);
  });

  test('adds commanders to an existing team through the instance API', () => {
    const room = RtsEngine.createRoom({
      id: 'existing-team-room',
      name: 'Existing Team Room',
      width: 40,
      height: 40,
    });

    const team = room.addPlayer('p1', 'Alice', { teamName: 'Team 1' });
    const teammate = room.addPlayer('p2', 'Bob', { teamId: team.id });

    expect(teammate.id).toBe(team.id);
    expect(room.state.players.get('p2')?.teamId).toBe(team.id);
    expect(room.state.teams.get(team.id)?.name).toBe('Team 1');
    expect(room.state.teams.get(team.id)?.playerIds).toEqual(
      new Set(['p1', 'p2']),
    );
  });

  test('advances automatic team ids past explicitly assigned team ids', () => {
    const room = RtsEngine.createRoomState({
      id: 'explicit-team-room',
      name: 'Explicit Team Room',
      width: 48,
      height: 48,
    });

    const explicitTeam = RtsEngine.addPlayerToRoom(room, 'p1', 'Alice', {
      teamId: 3,
      teamName: 'Team 3',
    });
    const automaticOne = RtsEngine.addPlayerToRoom(room, 'p2', 'Bob');
    const automaticTwo = RtsEngine.addPlayerToRoom(room, 'p3', 'Cara');
    const automaticThree = RtsEngine.addPlayerToRoom(room, 'p4', 'Drew');

    expect(explicitTeam.id).toBe(3);
    expect(automaticOne.id).toBe(4);
    expect(automaticTwo.id).toBe(5);
    expect(automaticThree.id).toBe(6);
    expect(room.players.get('p1')?.teamId).toBe(3);
    expect(room.teams.get(3)?.playerIds).toEqual(new Set(['p1']));
  });
});
