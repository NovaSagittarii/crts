import { describe, expect, it } from 'vitest';

import type { TeamIncomeBreakdown } from '#rts-engine';

import {
  type TeamEconomySnapshot,
  advanceEconomyDeltaTrackerState,
  createEconomyDeltaTrackerState,
} from '../../apps/web/src/economy-hud-controller.js';

function createBreakdown(
  overrides: Partial<TeamIncomeBreakdown> = {},
): TeamIncomeBreakdown {
  return {
    base: 5,
    structures: 2,
    total: 7,
    activeStructureCount: 3,
    ...overrides,
  };
}

function createSnapshot(
  overrides: Partial<TeamEconomySnapshot> = {},
): TeamEconomySnapshot {
  return {
    tick: 10,
    resources: 30,
    income: 7,
    incomeBreakdown: createBreakdown(),
    ...overrides,
  };
}

describe('economy hud controller delta tracker', () => {
  it('initializes with empty tracker state', () => {
    expect(createEconomyDeltaTrackerState()).toEqual({
      lastSnapshot: null,
      latestCue: null,
      latestTick: null,
      samples: [],
    });
  });

  it('derives a cue when resources or income change', () => {
    const previous = createSnapshot({
      tick: 10,
      resources: 30,
      income: 7,
      incomeBreakdown: createBreakdown({
        structures: 2,
        total: 7,
      }),
    });
    const next = createSnapshot({
      tick: 11,
      resources: 36,
      income: 9,
      incomeBreakdown: createBreakdown({
        structures: 4,
        total: 9,
      }),
    });

    const nextState = advanceEconomyDeltaTrackerState(
      {
        lastSnapshot: previous,
        latestCue: null,
        latestTick: previous.tick,
        samples: [],
      },
      next,
    );

    expect(nextState.latestTick).toBe(11);
    expect(nextState.latestCue).toMatchObject({
      tick: 11,
      resourceDelta: 6,
    });
    expect(nextState.samples.length).toBeGreaterThan(0);
  });

  it('clears stale cue when tick advances without economy change', () => {
    const previous = createSnapshot({ tick: 14 });
    const next = createSnapshot({ tick: 15 });

    const nextState = advanceEconomyDeltaTrackerState(
      {
        lastSnapshot: previous,
        latestCue: {
          tick: 14,
          netDelta: -2,
          resourceDelta: -2,
          isNegativeNet: true,
          causes: ['mixed'],
          causeLabel: 'Mixed changes',
        },
        latestTick: 14,
        samples: [],
      },
      next,
    );

    expect(nextState.latestTick).toBe(14);
    expect(nextState.latestCue).toBeNull();
  });
});
