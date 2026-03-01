import { describe, expect, test } from 'vitest';

import type { PendingBuildStatePayload } from '#rts-engine';

import {
  aggregateIncomeDelta,
  formatRelativeEta,
  groupPendingByExecuteTick,
  type IncomeDeltaSample,
} from '../../apps/web/src/economy-view-model.js';

describe('economy-view-model helpers', () => {
  test('groups pending builds by execute tick with deterministic event ordering', () => {
    const pending: PendingBuildStatePayload[] = [
      {
        eventId: 9,
        executeTick: 18,
        templateId: 'block',
        templateName: 'Block',
        x: 8,
        y: 6,
      },
      {
        eventId: 2,
        executeTick: 16,
        templateId: 'beacon',
        templateName: 'Beacon',
        x: 3,
        y: 3,
      },
      {
        eventId: 4,
        executeTick: 18,
        templateId: 'boat',
        templateName: 'Boat',
        x: 5,
        y: 7,
      },
      {
        eventId: 1,
        executeTick: 16,
        templateId: 'blinker',
        templateName: 'Blinker',
        x: 1,
        y: 2,
      },
    ];

    const grouped = groupPendingByExecuteTick(pending, 16);

    expect(grouped.map(({ executeTick }) => executeTick)).toEqual([16, 18]);
    expect(grouped[0]?.items.map(({ eventId }) => eventId)).toEqual([1, 2]);
    expect(grouped[1]?.items.map(({ eventId }) => eventId)).toEqual([4, 9]);
    expect(grouped[0]?.etaLabel).toBe('due now');
    expect(grouped[1]?.etaLabel).toBe('in 2 ticks');
  });

  test('formats relative ETA labels without absolute-only tick copy', () => {
    expect(formatRelativeEta(10, 12)).toBe('due now');
    expect(formatRelativeEta(12, 12)).toBe('due now');
    expect(formatRelativeEta(13, 12)).toBe('in 1 tick');
    expect(formatRelativeEta(15, 12)).toBe('in 3 ticks');
    expect(formatRelativeEta(18, 12)).not.toContain('tick 18');
  });

  test('aggregates one income delta cue per tick with short causes', () => {
    const samples: IncomeDeltaSample[] = [
      { tick: 33, netDelta: -2, cause: 'upkeep' },
      { tick: 32, netDelta: 2, cause: 'structures' },
      { tick: 32, netDelta: -1, cause: 'territory' },
      { tick: 32, netDelta: 0, resourceDelta: -5, cause: 'queue' },
      { tick: 33, netDelta: -1, cause: 'upkeep' },
    ];

    expect(aggregateIncomeDelta(samples)).toEqual([
      {
        tick: 32,
        netDelta: 1,
        resourceDelta: -5,
        causes: ['structures', 'territory', 'queue'],
        causeLabel: 'structures +2',
        isNegativeNet: false,
      },
      {
        tick: 33,
        netDelta: -3,
        resourceDelta: 0,
        causes: ['upkeep'],
        causeLabel: 'upkeep',
        isNegativeNet: true,
      },
    ]);
  });
});
