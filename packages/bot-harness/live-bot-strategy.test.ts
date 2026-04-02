import { describe, expect, test } from 'vitest';

import type { RoomStatePayload } from '#rts-engine';

import { LiveBotStrategy } from './live-bot-strategy.js';

describe('LiveBotStrategy', () => {
  const width = 52;
  const height = 52;

  test('null model returns a number (random action)', () => {
    const strategy = new LiveBotStrategy(null, width, height);
    // Create a minimal RoomStatePayload-like object
    const payload = createMinimalPayload(width, height);
    const action = strategy.infer(payload, 1, 2000);
    expect(typeof action).toBe('number');
    expect(action).toBeGreaterThanOrEqual(0);
  });

  test('decode(0) returns null (no-op)', () => {
    const strategy = new LiveBotStrategy(null, width, height);
    const result = strategy.decode(0);
    expect(result).toBeNull();
  });

  test('decode(non-zero) returns a BuildQueuePayload', () => {
    const strategy = new LiveBotStrategy(null, width, height);
    const result = strategy.decode(1);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty('templateId');
    expect(result).toHaveProperty('x');
    expect(result).toHaveProperty('y');
  });

  test('getLastAction returns null before any inference', () => {
    const strategy = new LiveBotStrategy(null, width, height);
    expect(strategy.getLastAction()).toBeNull();
  });

  test('getLastAction returns last action after inference', () => {
    const strategy = new LiveBotStrategy(null, width, height);
    const payload = createMinimalPayload(width, height);
    const action = strategy.infer(payload, 1, 2000);
    expect(strategy.getLastAction()).toBe(action);
  });

  test('warmUp does not throw with null model', () => {
    const strategy = new LiveBotStrategy(null, width, height);
    expect(() => strategy.warmUp()).not.toThrow();
  });
});

/**
 * Creates a minimal RoomStatePayload for testing without a real server.
 */
function createMinimalPayload(width: number, height: number): RoomStatePayload {
  // Create an empty grid buffer (all zeros = all dead cells)
  const gridBytes = Math.ceil((width * height) / 8);
  const gridBuffer = new ArrayBuffer(gridBytes);

  return {
    grid: gridBuffer,
    tick: 0,
    roomId: 'test-room',
    roomName: 'test',
    generation: 0,
    width,
    height,
    teams: [
      {
        id: 1,
        name: 'Team 1',
        resources: 100,
        income: 5,
        incomeBreakdown: {
          base: 5,
          structures: 0,
          total: 5,
          activeStructureCount: 0,
        },
        pendingBuilds: [],
        pendingDestroys: [],
        structures: [
          {
            key: 'core-1',
            templateId: '__core__',
            templateName: 'Core',
            x: 5,
            y: 5,
            width: 7,
            height: 7,
            hp: 500,
            active: true,
            buildRadius: 8,
            isCore: true,
            requiresDestroyConfirm: false,
            transform: {
              operations: [],
              matrix: { xx: 1, xy: 0, yx: 0, yy: 1 },
            },
            footprint: [{ x: 5, y: 5 }],
          },
        ],
        playerIds: ['player-1'],
        defeated: false,
        baseTopLeft: { x: 5, y: 5 },
        baseIntact: true,
      },
      {
        id: 2,
        name: 'Team 2',
        resources: 100,
        income: 5,
        incomeBreakdown: {
          base: 5,
          structures: 0,
          total: 5,
          activeStructureCount: 0,
        },
        pendingBuilds: [],
        pendingDestroys: [],
        structures: [
          {
            key: 'core-2',
            templateId: '__core__',
            templateName: 'Core',
            x: 40,
            y: 40,
            width: 7,
            height: 7,
            hp: 500,
            active: true,
            buildRadius: 8,
            isCore: true,
            requiresDestroyConfirm: false,
            transform: {
              operations: [],
              matrix: { xx: 1, xy: 0, yx: 0, yy: 1 },
            },
            footprint: [{ x: 40, y: 40 }],
          },
        ],
        playerIds: ['player-2'],
        defeated: false,
        baseTopLeft: { x: 40, y: 40 },
        baseIntact: true,
      },
    ],
  };
}
