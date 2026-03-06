import { describe, expect, test } from 'vitest';

import { RtsEngine, RtsRoom } from './rts.js';
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

    RtsEngine.removePlayerFromRoom(room, 'p1');
    expect(room.players.has('p1')).toBe(false);
    expect(room.teams.has(team.id)).toBe(false);
  });
});
