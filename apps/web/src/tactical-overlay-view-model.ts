import type {
  PendingBuildStatePayload,
  PendingDestroyStatePayload,
  StructureTemplateSummary,
  TeamIncomeBreakdownPayload,
} from '#rts-engine';

export const TACTICAL_DELTA_HIGHLIGHT_MS = 1_000;
export const DEFAULT_SYNC_STALE_THRESHOLD_MS = 1_000;

export interface TacticalOverlayStructureSnapshot {
  key: string;
  active: boolean;
}

export interface TacticalOverlayTeamSnapshot {
  id: number;
  name: string;
  defeated: boolean;
  baseIntact: boolean;
  resources: number;
  income: number;
  incomeBreakdown: TeamIncomeBreakdownPayload;
  pendingBuilds: readonly PendingBuildStatePayload[];
  pendingDestroys: readonly PendingDestroyStatePayload[];
  structures: readonly TacticalOverlayStructureSnapshot[];
}

export interface TacticalOverlaySyncInput {
  reconnectPending: boolean;
  lastAuthoritativeUpdateAtMs: number | null;
  staleThresholdMs?: number;
  hintCopy?: string | null;
}

export interface TacticalOverlayProjectionInput {
  nowMs: number;
  team: TacticalOverlayTeamSnapshot | null;
  templates: readonly StructureTemplateSummary[];
  selectedTemplateId?: string | null;
  previewReasonCopy?: string | null;
  latestActionCopy?: string | null;
  sync: TacticalOverlaySyncInput;
}

export interface TacticalOverlaySummaryItem {
  key: string;
  label: string;
  value: string;
  metricValue: number | null;
  highlightedUntilMs: number | null;
  highlighted: boolean;
}

export interface TacticalOverlayDetailRow {
  key: string;
  label: string;
  value: string;
}

export interface TacticalOverlaySection {
  id: 'economy' | 'build' | 'team';
  title: string;
  summaryItems: TacticalOverlaySummaryItem[];
  detailRows: TacticalOverlayDetailRow[];
  pendingBadgeCount: number;
  hasPendingBadge: boolean;
}

export interface TacticalOverlaySyncHint {
  visible: boolean;
  copy: string | null;
}

export interface TacticalOverlayState {
  sections: TacticalOverlaySection[];
  syncHint: TacticalOverlaySyncHint;
  metricValues: Record<string, number>;
  highlightUntilByMetric: Record<string, number>;
}

interface MetricDraft {
  key: string;
  label: string;
  value: string;
  metricValue: number | null;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function normalizeOptionalCopy(
  value: string | null | undefined,
): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeStaleThreshold(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SYNC_STALE_THRESHOLD_MS;
  }
  return Math.max(0, Math.trunc(value));
}

function withHighlightMetadata(
  metrics: readonly MetricDraft[],
  nowMs: number,
  previousMetricValues: Record<string, number>,
  previousHighlightUntil: Record<string, number>,
): {
  summaryItems: TacticalOverlaySummaryItem[];
  metricValues: Record<string, number>;
  highlightUntilByMetric: Record<string, number>;
} {
  const metricValues: Record<string, number> = {};
  const highlightUntilByMetric: Record<string, number> = {};

  const summaryItems = metrics.map((metric) => {
    if (metric.metricValue === null) {
      return {
        key: metric.key,
        label: metric.label,
        value: metric.value,
        metricValue: null,
        highlightedUntilMs: null,
        highlighted: false,
      };
    }

    const previousMetricValue = previousMetricValues[metric.key];
    const hadPrevious = Object.prototype.hasOwnProperty.call(
      previousMetricValues,
      metric.key,
    );
    let highlightedUntilMs: number | null = null;

    if (hadPrevious && previousMetricValue !== metric.metricValue) {
      highlightedUntilMs = nowMs + TACTICAL_DELTA_HIGHLIGHT_MS;
    } else {
      const previousHighlight = previousHighlightUntil[metric.key];
      if (typeof previousHighlight === 'number' && nowMs < previousHighlight) {
        highlightedUntilMs = previousHighlight;
      }
    }

    metricValues[metric.key] = metric.metricValue;
    if (highlightedUntilMs !== null) {
      highlightUntilByMetric[metric.key] = highlightedUntilMs;
    }

    return {
      key: metric.key,
      label: metric.label,
      value: metric.value,
      metricValue: metric.metricValue,
      highlightedUntilMs,
      highlighted:
        highlightedUntilMs !== null && Number.isFinite(highlightedUntilMs),
    };
  });

  return {
    summaryItems,
    metricValues,
    highlightUntilByMetric,
  };
}

function selectSyncHint(
  nowMs: number,
  input: TacticalOverlaySyncInput,
): TacticalOverlaySyncHint {
  const staleThresholdMs = normalizeStaleThreshold(input.staleThresholdMs);
  const staleByAge =
    input.lastAuthoritativeUpdateAtMs !== null &&
    nowMs - input.lastAuthoritativeUpdateAtMs > staleThresholdMs;
  const visible = input.reconnectPending || staleByAge;

  if (!visible) {
    return {
      visible: false,
      copy: null,
    };
  }

  return {
    visible: true,
    copy:
      normalizeOptionalCopy(input.hintCopy) ?? 'Syncing latest tactical data…',
  };
}

export function createTacticalOverlayState(): TacticalOverlayState {
  return {
    sections: [],
    syncHint: {
      visible: false,
      copy: null,
    },
    metricValues: {},
    highlightUntilByMetric: {},
  };
}

export function deriveTacticalOverlayState(
  previousState: TacticalOverlayState,
  input: TacticalOverlayProjectionInput,
): TacticalOverlayState {
  const syncHint = selectSyncHint(input.nowMs, input.sync);
  const team = input.team;

  if (!team && syncHint.visible && previousState.sections.length > 0) {
    return {
      ...previousState,
      syncHint,
    };
  }

  const resources = team?.resources ?? 0;
  const income = team?.income ?? 0;
  const pendingBuildCount = team?.pendingBuilds.length ?? 0;
  const pendingDestroyCount = team?.pendingDestroys.length ?? 0;
  const totalStructures = team?.structures.length ?? 0;
  const activeStructures = team
    ? team.structures.filter((structure) => structure.active).length
    : 0;

  const selectedTemplateName =
    input.selectedTemplateId &&
    input.templates.find((template) => template.id === input.selectedTemplateId)
      ?.name;

  const nextMetricDrafts: MetricDraft[] = [
    {
      key: 'economy:resources',
      label: 'Resources',
      value: `${resources}`,
      metricValue: team ? resources : null,
    },
    {
      key: 'economy:income',
      label: 'Income',
      value: `${formatSigned(income)}/tick`,
      metricValue: team ? income : null,
    },
    {
      key: 'build:pending',
      label: 'Pending Builds',
      value: `${pendingBuildCount}`,
      metricValue: team ? pendingBuildCount : null,
    },
    {
      key: 'team:structures',
      label: 'Structures',
      value: `${totalStructures}`,
      metricValue: team ? totalStructures : null,
    },
    {
      key: 'team:active',
      label: 'Active',
      value: `${activeStructures}`,
      metricValue: team ? activeStructures : null,
    },
    {
      key: 'team:pending-destroys',
      label: 'Pending Destroys',
      value: `${pendingDestroyCount}`,
      metricValue: team ? pendingDestroyCount : null,
    },
  ];

  const highlightedMetrics = withHighlightMetadata(
    nextMetricDrafts,
    input.nowMs,
    previousState.metricValues,
    previousState.highlightUntilByMetric,
  );
  const summaryByKey = new Map(
    highlightedMetrics.summaryItems.map((item) => [item.key, item]),
  );

  const economySection: TacticalOverlaySection = {
    id: 'economy',
    title: 'Economy',
    summaryItems: [
      summaryByKey.get('economy:resources'),
      summaryByKey.get('economy:income'),
    ].filter((item): item is TacticalOverlaySummaryItem => item !== undefined),
    detailRows: team
      ? [
          {
            key: 'economy-base',
            label: 'Base Income',
            value: `${formatSigned(team.incomeBreakdown.base)}/tick`,
          },
          {
            key: 'economy-structures',
            label: 'Structure Income',
            value: `${formatSigned(team.incomeBreakdown.structures)}/tick`,
          },
          {
            key: 'economy-active',
            label: 'Active Structures',
            value: `${team.incomeBreakdown.activeStructureCount}`,
          },
        ]
      : [
          {
            key: 'economy-placeholder',
            label: 'Status',
            value: 'Awaiting authoritative team economy payload.',
          },
        ],
    pendingBadgeCount: 0,
    hasPendingBadge: false,
  };

  const buildSection: TacticalOverlaySection = {
    id: 'build',
    title: 'Build',
    summaryItems: [summaryByKey.get('build:pending')].filter(
      (item): item is TacticalOverlaySummaryItem => item !== undefined,
    ),
    detailRows: [
      {
        key: 'build-template',
        label: 'Selected Template',
        value: selectedTemplateName ?? 'None selected',
      },
      {
        key: 'build-template-count',
        label: 'Available Templates',
        value: `${input.templates.length}`,
      },
      // {
      //   key: 'build-preview-copy',
      //   label: 'Preview',
      //   value:
      //     normalizeOptionalCopy(input.previewReasonCopy) ??
      //     'Awaiting latest authoritative preview.',
      // },
    ],
    pendingBadgeCount: pendingBuildCount,
    hasPendingBadge: pendingBuildCount > 0,
  };

  const teamSection: TacticalOverlaySection = {
    id: 'team',
    title: 'Team',
    summaryItems: [
      summaryByKey.get('team:structures'),
      summaryByKey.get('team:active'),
      summaryByKey.get('team:pending-destroys'),
    ].filter((item): item is TacticalOverlaySummaryItem => item !== undefined),
    detailRows: [
      {
        key: 'team-name',
        label: 'Team',
        value: team ? `${team.name} (#${team.id})` : 'No team assigned',
      },
      {
        key: 'team-base',
        label: 'Base',
        value: team ? (team.baseIntact ? 'Intact' : 'Breached') : 'Unknown',
      },
      {
        key: 'team-state',
        label: 'State',
        value: team ? (team.defeated ? 'Defeated' : 'Active') : 'Spectating',
      },
      {
        key: 'team-latest-action',
        label: 'Latest Action',
        value:
          normalizeOptionalCopy(input.latestActionCopy) ??
          'No recent action feedback.',
      },
    ],
    pendingBadgeCount: pendingDestroyCount,
    hasPendingBadge: pendingDestroyCount > 0,
  };

  return {
    sections: [economySection, buildSection, teamSection],
    syncHint,
    metricValues: highlightedMetrics.metricValues,
    highlightUntilByMetric: highlightedMetrics.highlightUntilByMetric,
  };
}
