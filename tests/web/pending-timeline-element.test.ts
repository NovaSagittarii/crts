import { describe, expect, it } from 'vitest';

import type { PendingBuildPayload } from '#rts-engine';

import { PendingTimelineElement } from '../../apps/web/src/pending-timeline-element.js';

const pendingRows: readonly PendingBuildPayload[] = [
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

describe('pending timeline element', () => {
  it('derives deterministic grouped snapshot for pending builds', () => {
    const snapshot = PendingTimelineElement.deriveSnapshot({
      pendingBuilds: pendingRows,
      currentTick: 16,
    });

    expect(snapshot.emptyCopy).toBeNull();
    expect(snapshot.groups.map((group) => group.executeTick)).toEqual([16, 18]);
    expect(snapshot.groups[0]?.title).toBe('Execute tick 16 (due now)');
    expect(snapshot.groups[1]?.title).toBe('Execute tick 18 (in 2 ticks)');
    expect(snapshot.groups[0]?.items.map((item) => item.eventId)).toEqual([
      1, 2,
    ]);
    expect(snapshot.groups[1]?.items.map((item) => item.eventId)).toEqual([
      4, 9,
    ]);
  });

  it('returns title-only patch operations when only current tick changes', () => {
    const previous = PendingTimelineElement.deriveSnapshot({
      pendingBuilds: pendingRows,
      currentTick: 16,
    });
    const next = PendingTimelineElement.deriveSnapshot({
      pendingBuilds: pendingRows,
      currentTick: 17,
    });

    expect(PendingTimelineElement.diffSnapshots(previous, next)).toEqual([
      {
        type: 'update-group-title',
        groupKey: 'tick:18',
        title: 'Execute tick 18 (in 1 tick)',
      },
    ]);
  });

  it('returns structural patch operations when pending queue changes', () => {
    const previous = PendingTimelineElement.deriveSnapshot({
      pendingBuilds: pendingRows,
      currentTick: 16,
    });
    const next = PendingTimelineElement.deriveSnapshot({
      pendingBuilds: pendingRows.filter((row) => row.eventId !== 4),
      currentTick: 16,
    });

    expect(PendingTimelineElement.diffSnapshots(previous, next)).toEqual([
      {
        type: 'remove-item',
        groupKey: 'tick:18',
        itemKey: 'event:4',
      },
    ]);
  });

  it('preserves insertion index metadata for new groups and items', () => {
    const previous = PendingTimelineElement.deriveSnapshot({
      pendingBuilds: [pendingRows[0]],
      currentTick: 16,
    });
    const next = PendingTimelineElement.deriveSnapshot({
      pendingBuilds: pendingRows,
      currentTick: 16,
    });
    const insertedItem = next.groups[1]?.items[0];
    if (!insertedItem) {
      throw new Error('Expected inserted item for tick:18 group.');
    }

    expect(PendingTimelineElement.diffSnapshots(previous, next)).toEqual([
      {
        type: 'insert-group',
        groupKey: 'tick:16',
        at: 0,
        group: next.groups[0],
      },
      {
        type: 'insert-item',
        groupKey: 'tick:18',
        itemKey: 'event:4',
        at: 0,
        item: insertedItem,
      },
    ]);
  });
});
