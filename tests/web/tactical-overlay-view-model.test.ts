import { describe, expect, test } from 'vitest';

import type {
  PendingBuildPayload,
  PendingDestroyPayload,
  StructureTemplateSummary,
} from '#rts-engine';

import {
  createTacticalOverlayState,
  deriveTacticalOverlayState,
} from '../../apps/web/src/tactical-overlay-view-model.js';

const identityTransform = {
  operations: [],
  matrix: { xx: 1, xy: 0, yx: 0, yy: 1 },
};

function buildTemplate(id: string, name: string): StructureTemplateSummary {
  return {
    id,
    name,
    width: 2,
    height: 2,
    activationCost: 4,
    income: 1,
    buildArea: 25,
  };
}

describe('tactical-overlay-view-model helpers', () => {
  test('maps authoritative economy, build, and team snapshots to stable sections', () => {
    const pendingBuilds: PendingBuildPayload[] = [
      {
        eventId: 17,
        executeTick: 55,
        playerId: 'p-build',
        templateId: 'beacon',
        templateName: 'Beacon',
        x: 8,
        y: 8,
        transform: identityTransform,
      },
    ];
    const pendingDestroys: PendingDestroyPayload[] = [
      {
        eventId: 91,
        executeTick: 60,
        playerId: 'p-destroy',
        structureKey: 'tower-1',
        templateId: 'tower',
        templateName: 'Tower',
        x: 6,
        y: 4,
        requiresDestroyConfirm: false,
      },
    ];

    const derived = deriveTacticalOverlayState(createTacticalOverlayState(), {
      nowMs: 1_000,
      team: {
        id: 2,
        name: 'Team B',
        defeated: false,
        baseIntact: true,
        resources: 42,
        income: 5,
        incomeBreakdown: {
          base: 3,
          structures: 2,
          total: 5,
          activeStructureCount: 4,
        },
        pendingBuilds,
        pendingDestroys,
        structures: [
          { key: 'core', active: true },
          { key: 'tower-1', active: true },
          { key: 'tower-2', active: false },
        ],
      },
      templates: [buildTemplate('beacon', 'Beacon')],
      selectedTemplateId: 'beacon',
      previewReasonCopy: 'Affordable: need 4, current 42.',
      latestActionCopy: 'Destroy queued for Tower (#91).',
      sync: {
        reconnectPending: false,
        lastAuthoritativeUpdateAtMs: 950,
      },
    });

    expect(derived.sections.map((section) => section.id)).toEqual([
      'economy',
      'build',
      'team',
    ]);

    const economy = derived.sections[0];
    expect(economy?.summaryItems.map((item) => item.value)).toEqual([
      '42',
      '+5/tick',
    ]);

    const build = derived.sections[1];
    expect(build?.pendingBadgeCount).toBe(1);
    expect(build?.hasPendingBadge).toBe(true);
    expect(
      build?.detailRows.some((row) => row.key === 'build-preview-copy'),
    ).toBe(false);

    const team = derived.sections[2];
    expect(team?.pendingBadgeCount).toBe(1);
    expect(
      team?.detailRows.find((row) => row.key === 'team-latest-action')?.value,
    ).toBe('Destroy queued for Tower (#91).');
  });

  test('projects one-second delta highlight metadata and expires it deterministically', () => {
    const templates = [buildTemplate('beacon', 'Beacon')];

    const initial = deriveTacticalOverlayState(createTacticalOverlayState(), {
      nowMs: 2_000,
      team: {
        id: 1,
        name: 'Team A',
        defeated: false,
        baseIntact: true,
        resources: 10,
        income: 2,
        incomeBreakdown: {
          base: 2,
          structures: 0,
          total: 2,
          activeStructureCount: 1,
        },
        pendingBuilds: [],
        pendingDestroys: [],
        structures: [{ key: 'core', active: true }],
      },
      templates,
      selectedTemplateId: 'beacon',
      sync: {
        reconnectPending: false,
        lastAuthoritativeUpdateAtMs: 1_999,
      },
    });

    const changed = deriveTacticalOverlayState(initial, {
      nowMs: 2_500,
      team: {
        id: 1,
        name: 'Team A',
        defeated: false,
        baseIntact: true,
        resources: 12,
        income: 3,
        incomeBreakdown: {
          base: 2,
          structures: 1,
          total: 3,
          activeStructureCount: 2,
        },
        pendingBuilds: [],
        pendingDestroys: [],
        structures: [
          { key: 'core', active: true },
          { key: 'beacon-1', active: true },
        ],
      },
      templates,
      sync: {
        reconnectPending: false,
        lastAuthoritativeUpdateAtMs: 2_500,
      },
    });

    const highlightedResources = changed.sections[0]?.summaryItems.find(
      (item) => item.key === 'economy:resources',
    );
    expect(highlightedResources?.highlighted).toBe(true);
    expect(highlightedResources?.highlightedUntilMs).toBe(3_500);

    const expired = deriveTacticalOverlayState(changed, {
      nowMs: 3_600,
      team: {
        id: 1,
        name: 'Team A',
        defeated: false,
        baseIntact: true,
        resources: 12,
        income: 3,
        incomeBreakdown: {
          base: 2,
          structures: 1,
          total: 3,
          activeStructureCount: 2,
        },
        pendingBuilds: [],
        pendingDestroys: [],
        structures: [
          { key: 'core', active: true },
          { key: 'beacon-1', active: true },
        ],
      },
      templates,
      sync: {
        reconnectPending: false,
        lastAuthoritativeUpdateAtMs: 3_600,
      },
    });

    const expiredResources = expired.sections[0]?.summaryItems.find(
      (item) => item.key === 'economy:resources',
    );
    expect(expiredResources?.highlighted).toBe(false);
    expect(expiredResources?.highlightedUntilMs).toBeNull();
  });

  test('gates syncing hint visibility on stale updates and reconnect state', () => {
    const fresh = deriveTacticalOverlayState(createTacticalOverlayState(), {
      nowMs: 5_000,
      team: null,
      templates: [],
      sync: {
        reconnectPending: false,
        lastAuthoritativeUpdateAtMs: 4_500,
        staleThresholdMs: 1_000,
      },
    });
    expect(fresh.syncHint).toEqual({ visible: false, copy: null });

    const stale = deriveTacticalOverlayState(fresh, {
      nowMs: 5_600,
      team: null,
      templates: [],
      sync: {
        reconnectPending: false,
        lastAuthoritativeUpdateAtMs: 4_500,
        staleThresholdMs: 1_000,
        hintCopy: 'Syncing…',
      },
    });
    expect(stale.syncHint).toEqual({ visible: true, copy: 'Syncing…' });

    const reconnect = deriveTacticalOverlayState(stale, {
      nowMs: 5_700,
      team: null,
      templates: [],
      sync: {
        reconnectPending: true,
        lastAuthoritativeUpdateAtMs: 5_690,
      },
    });
    expect(reconnect.syncHint.visible).toBe(true);
    expect(reconnect.syncHint.copy).toBe('Syncing latest tactical data…');
  });
});
