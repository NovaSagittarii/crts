import { describe, expect, it } from 'vitest';

import { RtsRoom } from '#rts-engine';

import { ObservationEncoder, type ObservationResult } from './observation-encoder.js';

const W = 52;
const H = 52;

function createTestRoom(): RtsRoom {
  const room = RtsRoom.create({
    id: 'obs-test',
    name: 'obs-test',
    width: W,
    height: H,
  });
  room.addPlayer('p1', 'Team1');
  room.addPlayer('p2', 'Team2');
  return room;
}

describe('ObservationEncoder', () => {
  it('encode() returns correct shape: 5*H*W planes, 7 scalars, shape metadata', () => {
    const room = createTestRoom();
    const encoder = new ObservationEncoder(W, H);
    const result: ObservationResult = encoder.encode(room, 1, 0, 2000);

    expect(result.planes).toBeInstanceOf(Float32Array);
    expect(result.planes.length).toBe(5 * H * W);
    expect(result.scalars).toBeInstanceOf(Float32Array);
    expect(result.scalars.length).toBe(7);
    expect(result.shape).toEqual({
      channels: 5,
      height: H,
      width: W,
      scalarCount: 7,
    });
  });

  it('plane 0 (alive cells) is all-zero on a fresh room with no alive cells', () => {
    const room = createTestRoom();
    const encoder = new ObservationEncoder(W, H);
    const result = encoder.encode(room, 1, 0, 2000);

    const planeSize = H * W;
    // Check plane 0 only (alive cells)
    // Core footprint might have alive cells set by room setup, but
    // the initial grid should have no alive cells on a fresh room
    // (structures write cells alive only during tick processing)
    let allZero = true;
    for (let i = 0; i < planeSize; i++) {
      if (result.planes[i] !== 0.0) {
        allZero = false;
        break;
      }
    }
    expect(allZero).toBe(true);
  });

  it('plane 0 (alive cells) has 1.0 at positions where cells are alive', () => {
    const room = createTestRoom();
    // Set specific cells alive
    room.state.grid.set(3, 4, true);
    room.state.grid.set(7, 2, true);

    const encoder = new ObservationEncoder(W, H);
    const result = encoder.encode(room, 1, 0, 2000);

    // Channel 0, y=4, x=3
    expect(result.planes[0 * H * W + 4 * W + 3]).toBe(1.0);
    // Channel 0, y=2, x=7
    expect(result.planes[0 * H * W + 2 * W + 7]).toBe(1.0);
    // A cell that's not alive should be 0
    expect(result.planes[0 * H * W + 0 * W + 0]).toBe(0.0);
  });

  it('plane 1 (own structure footprint) has 1.0 at own core footprint cells', () => {
    const room = createTestRoom();
    const encoder = new ObservationEncoder(W, H);
    const payload = room.createStatePayload();
    const ownTeam = payload.teams.find((t) => t.id === 1)!;
    const ownStructures = ownTeam.structures;

    const result = encoder.encode(room, 1, 0, 2000);

    // Verify at least one structure cell is marked
    let foundAny = false;
    for (const s of ownStructures) {
      for (const cell of s.footprint) {
        if (cell.x >= 0 && cell.x < W && cell.y >= 0 && cell.y < H) {
          expect(result.planes[1 * H * W + cell.y * W + cell.x]).toBe(1.0);
          foundAny = true;
        }
      }
    }
    expect(foundAny).toBe(true);
  });

  it('plane 2 (enemy structure footprint) has 1.0 at enemy core footprint cells', () => {
    const room = createTestRoom();
    const encoder = new ObservationEncoder(W, H);
    const payload = room.createStatePayload();
    const enemyTeam = payload.teams.find((t) => t.id !== 1)!;
    const enemyStructures = enemyTeam.structures;

    const result = encoder.encode(room, 1, 0, 2000);

    let foundAny = false;
    for (const s of enemyStructures) {
      for (const cell of s.footprint) {
        if (cell.x >= 0 && cell.x < W && cell.y >= 0 && cell.y < H) {
          expect(result.planes[2 * H * W + cell.y * W + cell.x]).toBe(1.0);
          foundAny = true;
        }
      }
    }
    expect(foundAny).toBe(true);
  });

  it('plane 4 (own core position) has 1.0 at own core footprint cells', () => {
    const room = createTestRoom();
    const encoder = new ObservationEncoder(W, H);
    const payload = room.createStatePayload();
    const ownTeam = payload.teams.find((t) => t.id === 1)!;
    const coreStructure = ownTeam.structures.find((s) => s.isCore);

    expect(coreStructure).toBeDefined();

    const result = encoder.encode(room, 1, 0, 2000);

    for (const cell of coreStructure!.footprint) {
      if (cell.x >= 0 && cell.x < W && cell.y >= 0 && cell.y < H) {
        expect(result.planes[4 * H * W + cell.y * W + cell.x]).toBe(1.0);
      }
    }
  });

  it('scalar[0] (resources) normalizes correctly: 250 / 500 = 0.5', () => {
    const room = createTestRoom();
    // Set resources to 250
    const teamState = room.state.teams.get(1)!;
    teamState.resources = 250;

    const encoder = new ObservationEncoder(W, H);
    const result = encoder.encode(room, 1, 0, 2000);

    expect(result.scalars[0]).toBeCloseTo(0.5, 5);
  });

  it('scalar[4] (core HP) normalizes correctly and clamps at 1.0', () => {
    const room = createTestRoom();
    const encoder = new ObservationEncoder(W, H);
    const result = encoder.encode(room, 1, 0, 2000);

    // Core HP should be <= 1.0 (clamped)
    expect(result.scalars[4]).toBeGreaterThanOrEqual(0);
    expect(result.scalars[4]).toBeLessThanOrEqual(1.0);
  });

  it('scalars clamp at 1.0 when value exceeds normalization max', () => {
    const room = createTestRoom();
    const teamState = room.state.teams.get(1)!;
    teamState.resources = 1000; // 1000 / 500 = 2.0, should clamp to 1.0

    const encoder = new ObservationEncoder(W, H);
    const result = encoder.encode(room, 1, 0, 2000);

    expect(result.scalars[0]).toBe(1.0);
  });

  it('determinism: two calls with same RoomState + teamId produce byte-identical Float32Arrays', () => {
    const room = createTestRoom();
    room.state.grid.set(5, 5, true);

    const encoder = new ObservationEncoder(W, H);
    const result1 = encoder.encode(room, 1, 0, 2000);
    const result2 = encoder.encode(room, 1, 0, 2000);

    expect(
      Buffer.from(result1.planes.buffer).equals(Buffer.from(result2.planes.buffer)),
    ).toBe(true);
    expect(
      Buffer.from(result1.scalars.buffer).equals(Buffer.from(result2.scalars.buffer)),
    ).toBe(true);
  });

  it('shape metadata matches actual array dimensions', () => {
    const room = createTestRoom();
    const encoder = new ObservationEncoder(W, H);
    const result = encoder.encode(room, 1, 0, 2000);

    expect(result.planes.length).toBe(
      result.shape.channels * result.shape.height * result.shape.width,
    );
    expect(result.scalars.length).toBe(result.shape.scalarCount);
  });
});
