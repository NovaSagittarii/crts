import { describe, expect, it } from 'vitest';

import { RtsRoom } from '#rts-engine';

import { ObservationEncoder } from './observation-encoder.js';
import { PayloadObservationEncoder } from './payload-observation-encoder.js';

const W = 52;
const H = 52;
const MAX_TICKS = 2000;

function createTestRoom(): RtsRoom {
  const room = RtsRoom.create({
    id: 'payload-enc-test',
    name: 'payload-enc-test',
    width: W,
    height: H,
  });
  room.addPlayer('p1', 'Team1');
  room.addPlayer('p2', 'Team2');
  return room;
}

describe('PayloadObservationEncoder', () => {
  it('encode() returns correct shape: 5*H*W planes, 7 scalars, shape metadata', () => {
    const room = createTestRoom();
    const payload = room.createStatePayload();
    const encoder = new PayloadObservationEncoder(W, H);
    const result = encoder.encode(payload, 1, MAX_TICKS);

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

  it('channel 0 (alive cells) encodes from bit-packed grid via Grid.fromPacked', () => {
    const room = createTestRoom();
    room.state.grid.setCell(3, 4, true);
    room.state.grid.setCell(7, 2, true);
    const payload = room.createStatePayload();

    const encoder = new PayloadObservationEncoder(W, H);
    const result = encoder.encode(payload, 1, MAX_TICKS);

    // Channel 0, y=4, x=3
    expect(result.planes[0 * H * W + 4 * W + 3]).toBe(1.0);
    // Channel 0, y=2, x=7
    expect(result.planes[0 * H * W + 2 * W + 7]).toBe(1.0);
  });

  it('channel 1 (own structure footprint) marks own structures', () => {
    const room = createTestRoom();
    const payload = room.createStatePayload();
    const ownTeam = payload.teams.find((t) => t.id === 1)!;

    const encoder = new PayloadObservationEncoder(W, H);
    const result = encoder.encode(payload, 1, MAX_TICKS);

    let foundAny = false;
    for (const s of ownTeam.structures) {
      for (const cell of s.footprint) {
        if (cell.x >= 0 && cell.x < W && cell.y >= 0 && cell.y < H) {
          expect(result.planes[1 * H * W + cell.y * W + cell.x]).toBe(1.0);
          foundAny = true;
        }
      }
    }
    expect(foundAny).toBe(true);
  });

  it('channel 2 (enemy structure footprint) marks enemy structures', () => {
    const room = createTestRoom();
    const payload = room.createStatePayload();
    const enemyTeam = payload.teams.find((t) => t.id !== 1)!;

    const encoder = new PayloadObservationEncoder(W, H);
    const result = encoder.encode(payload, 1, MAX_TICKS);

    let foundAny = false;
    for (const s of enemyTeam.structures) {
      for (const cell of s.footprint) {
        if (cell.x >= 0 && cell.x < W && cell.y >= 0 && cell.y < H) {
          expect(result.planes[2 * H * W + cell.y * W + cell.x]).toBe(1.0);
          foundAny = true;
        }
      }
    }
    expect(foundAny).toBe(true);
  });

  it('channel 4 (own core position) marks core footprint', () => {
    const room = createTestRoom();
    const payload = room.createStatePayload();
    const ownTeam = payload.teams.find((t) => t.id === 1)!;
    const coreStructure = ownTeam.structures.find((s) => s.isCore);
    expect(coreStructure).toBeDefined();

    const encoder = new PayloadObservationEncoder(W, H);
    const result = encoder.encode(payload, 1, MAX_TICKS);

    for (const cell of coreStructure!.footprint) {
      if (cell.x >= 0 && cell.x < W && cell.y >= 0 && cell.y < H) {
        expect(result.planes[4 * H * W + cell.y * W + cell.x]).toBe(1.0);
      }
    }
  });

  it('scalars are correctly normalized', () => {
    const room = createTestRoom();
    const teamState = room.state.teams.get(1)!;
    teamState.resources = 250;
    const payload = room.createStatePayload();

    const encoder = new PayloadObservationEncoder(W, H);
    const result = encoder.encode(payload, 1, MAX_TICKS);

    // scalar[0]: resources/500 = 250/500 = 0.5
    expect(result.scalars[0]).toBeCloseTo(0.5, 5);
  });

  it('throws when teamId not found in payload', () => {
    const room = createTestRoom();
    const payload = room.createStatePayload();

    const encoder = new PayloadObservationEncoder(W, H);
    expect(() => encoder.encode(payload, 999, MAX_TICKS)).toThrow(
      /team.*999.*not found/i,
    );
  });

  it(
    'produces identical output to ObservationEncoder for the same room state',
    { timeout: 30_000 },
    () => {
      const room = createTestRoom();
      // Set some specific grid cells alive for a non-trivial comparison
      room.state.grid.setCell(10, 10, true);
      room.state.grid.setCell(20, 5, true);

      const payload = room.createStatePayload();
      const tick = payload.tick;

      // Encode with the original ObservationEncoder (uses RtsRoom)
      const origEncoder = new ObservationEncoder(W, H);
      const origResult = origEncoder.encode(room, 1, tick, MAX_TICKS);

      // Encode with PayloadObservationEncoder (uses RoomStatePayload only)
      const payloadEncoder = new PayloadObservationEncoder(W, H);
      const payloadResult = payloadEncoder.encode(payload, 1, MAX_TICKS);

      // Planes should be identical
      expect(payloadResult.planes.length).toBe(origResult.planes.length);
      for (let i = 0; i < origResult.planes.length; i++) {
        expect(payloadResult.planes[i]).toBe(origResult.planes[i]);
      }

      // Scalars should be identical (except scalar[6] which uses different sources)
      // Scalars 0-5 should match exactly
      for (let i = 0; i < 6; i++) {
        expect(payloadResult.scalars[i]).toBeCloseTo(origResult.scalars[i], 5);
      }

      // Scalar 6 (territoryRadius): both should produce the same value
      // since it's computed the same way
      expect(payloadResult.scalars[6]).toBeCloseTo(origResult.scalars[6], 5);
    },
  );

  it('scalar[6] (territoryRadius) computed from structure buildRadius', () => {
    const room = createTestRoom();
    const payload = room.createStatePayload();

    const encoder = new PayloadObservationEncoder(W, H);
    const result = encoder.encode(payload, 1, MAX_TICKS);

    // At start, only core exists (which has buildRadius > 0)
    // DEFAULT_TEAM_TERRITORY_RADIUS=12, plus sum of non-core buildRadius
    // With only core, non-core sum = 0, so radius = 12
    // 12 / 100 = 0.12
    expect(result.scalars[6]).toBeCloseTo(0.12, 2);
  });

  it('determinism: two calls produce byte-identical output', () => {
    const room = createTestRoom();
    const payload = room.createStatePayload();

    const encoder = new PayloadObservationEncoder(W, H);
    const result1 = encoder.encode(payload, 1, MAX_TICKS);
    const result2 = encoder.encode(payload, 1, MAX_TICKS);

    expect(
      Buffer.from(result1.planes.buffer).equals(
        Buffer.from(result2.planes.buffer),
      ),
    ).toBe(true);
    expect(
      Buffer.from(result1.scalars.buffer).equals(
        Buffer.from(result2.scalars.buffer),
      ),
    ).toBe(true);
  });
});
