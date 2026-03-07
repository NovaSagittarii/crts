import { describe, expect, test } from 'vitest';
import { Grid } from '#conway-core';

import type { RoomState, TimelineEvent } from './rts.js';
import {
  INVALID_ROOM_STATE_ERROR_MESSAGE,
  allocateBuildEventId,
  allocateTeamId,
  appendTimelineEvent,
  attachRoomRuntime,
  createRoomRuntime,
  defineRoomRuntimeProperties,
  getRoomRuntime,
  getTimelineEvents,
  hasRoomRuntime,
  reserveTeamId,
} from './room-runtime.js';

function createBareRoomState(tick = 0): RoomState {
  return {
    generation: 0,
    tick,
    grid: new Grid(16, 16),
    templates: [],
    teams: new Map(),
    players: new Map(),
  } as unknown as RoomState;
}

describe('room runtime', () => {
  test('binds runtime metadata and tracks room-local counters', () => {
    const room = createBareRoomState(7);
    const runtime = createRoomRuntime({
      id: 'runtime-room',
      name: 'Runtime Room',
      width: 16,
      height: 16,
      templateMap: new Map(),
      spawnOrientationSeed: 1234,
    });

    defineRoomRuntimeProperties(room, runtime);
    attachRoomRuntime(room, runtime);

    expect(hasRoomRuntime(room)).toBe(true);
    expect(getRoomRuntime(room)).toBe(runtime);
    expect(room.id).toBe('runtime-room');
    expect(room.name).toBe('Runtime Room');
    expect(room.width).toBe(16);
    expect(room.height).toBe(16);
    expect(room.templateMap).toBe(runtime.templateMap);
    expect(room.spawnOrientationSeed).toBe(1234);

    expect(allocateTeamId(room)).toBe(1);
    reserveTeamId(room, 3);
    expect(allocateTeamId(room)).toBe(4);
    expect(allocateBuildEventId(room)).toBe(1);
    expect(allocateBuildEventId(room)).toBe(2);

    const timelineEvent: Omit<TimelineEvent, 'tick'> = {
      teamId: 4,
      type: 'build-queued',
      metadata: { eventId: 2 },
    };
    appendTimelineEvent(room, timelineEvent);

    expect(getTimelineEvents(room)).toEqual([
      {
        ...timelineEvent,
        tick: 7,
      },
    ]);
  });

  test('rejects detached room states', () => {
    const room = createBareRoomState();

    expect(hasRoomRuntime(room)).toBe(false);
    expect(() => getRoomRuntime(room)).toThrow(
      INVALID_ROOM_STATE_ERROR_MESSAGE,
    );
  });
});
