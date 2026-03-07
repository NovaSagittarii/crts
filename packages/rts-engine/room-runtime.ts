import type { RoomState, TimelineEvent } from './rts.js';
import type { StructureTemplate } from './structure.js';

export const INVALID_ROOM_STATE_ERROR_MESSAGE =
  'RoomState must come from RtsEngine.createRoomState or RtsEngine.createRoom';

export interface RoomRuntime {
  readonly id: string;
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly templateMap: ReadonlyMap<string, StructureTemplate>;
  readonly spawnOrientationSeed: number;
  nextTeamId: number;
  nextBuildEventId: number;
  timelineEvents: TimelineEvent[];
}

export interface CreateRoomRuntimeOptions {
  id: string;
  name: string;
  width: number;
  height: number;
  templateMap: Map<string, StructureTemplate>;
  spawnOrientationSeed: number;
}

const roomRuntimeByState = new WeakMap<RoomState, RoomRuntime>();

export function createRoomRuntime(
  options: CreateRoomRuntimeOptions,
): RoomRuntime {
  return {
    id: options.id,
    name: options.name,
    width: options.width,
    height: options.height,
    templateMap: options.templateMap,
    spawnOrientationSeed: options.spawnOrientationSeed,
    nextTeamId: 1,
    nextBuildEventId: 1,
    timelineEvents: [],
  };
}

export function defineRoomRuntimeProperties(
  room: RoomState,
  runtime: RoomRuntime,
): void {
  Object.defineProperties(room, {
    id: {
      enumerable: true,
      get: () => runtime.id,
    },
    name: {
      enumerable: true,
      get: () => runtime.name,
    },
    width: {
      enumerable: true,
      get: () => runtime.width,
    },
    height: {
      enumerable: true,
      get: () => runtime.height,
    },
    templateMap: {
      enumerable: true,
      get: () => runtime.templateMap,
    },
    spawnOrientationSeed: {
      enumerable: true,
      get: () => runtime.spawnOrientationSeed,
    },
  });
}

export function attachRoomRuntime(room: RoomState, runtime: RoomRuntime): void {
  roomRuntimeByState.set(room, runtime);
}

export function hasRoomRuntime(room: RoomState): boolean {
  return roomRuntimeByState.has(room);
}

export function getRoomRuntime(room: RoomState): RoomRuntime {
  const runtime = roomRuntimeByState.get(room);
  if (!runtime) {
    throw new Error(INVALID_ROOM_STATE_ERROR_MESSAGE);
  }
  return runtime;
}

export function allocateTeamId(room: RoomState): number {
  const runtime = getRoomRuntime(room);
  while (room.teams.has(runtime.nextTeamId)) {
    runtime.nextTeamId += 1;
  }
  const teamId = runtime.nextTeamId;
  runtime.nextTeamId += 1;
  return teamId;
}

export function reserveTeamId(room: RoomState, teamId: number): void {
  const runtime = getRoomRuntime(room);
  if (teamId >= runtime.nextTeamId) {
    runtime.nextTeamId = teamId + 1;
  }
}

export function allocateBuildEventId(room: RoomState): number {
  const runtime = getRoomRuntime(room);
  const eventId = runtime.nextBuildEventId;
  runtime.nextBuildEventId += 1;
  return eventId;
}

export function appendTimelineEvent(
  room: RoomState,
  event: Omit<TimelineEvent, 'tick'>,
): void {
  getRoomRuntime(room).timelineEvents.push({
    ...event,
    tick: room.tick,
  });
}

export function getTimelineEvents(
  room: RoomState,
): ReadonlyArray<TimelineEvent> {
  return [...getRoomRuntime(room).timelineEvents];
}
