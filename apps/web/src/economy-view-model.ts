import type {
  PendingBuildStatePayload,
  TeamIncomeBreakdownPayload,
} from '#rts-engine';

export interface PendingBuildTickGroup {
  executeTick: number;
  etaLabel: string;
  items: PendingBuildStatePayload[];
}

export interface IncomeDeltaSample {
  tick: number;
  netDelta: number;
  resourceDelta?: number;
  cause: string;
}

export interface AggregatedIncomeDelta {
  tick: number;
  netDelta: number;
  resourceDelta: number;
  causes: string[];
  causeLabel: string;
  isNegativeNet: boolean;
}

const SHORT_CAUSE_FALLBACK = 'income';

function comparePendingBuildRows(
  a: PendingBuildStatePayload,
  b: PendingBuildStatePayload,
): number {
  return a.executeTick - b.executeTick || a.eventId - b.eventId;
}

function normalizeCauseLabel(label: string): string {
  const normalized = label.trim().toLowerCase();
  if (!normalized) {
    return '';
  }

  if (normalized.length <= 16) {
    return normalized;
  }

  return normalized.slice(0, 16).trimEnd();
}

function buildCauseLabel(causes: readonly string[]): string {
  if (causes.length === 0) {
    return SHORT_CAUSE_FALLBACK;
  }

  if (causes.length === 1) {
    return causes[0];
  }

  return `${causes[0]} +${causes.length - 1}`;
}

export function formatRelativeEta(
  executeTick: number,
  currentTick: number,
): string {
  const remaining = executeTick - currentTick;
  if (remaining <= 0) {
    return 'due now';
  }

  return remaining === 1 ? 'in 1 tick' : `in ${remaining} ticks`;
}

export function groupPendingByExecuteTick(
  pendingRows: readonly PendingBuildStatePayload[],
  currentTick: number,
): PendingBuildTickGroup[] {
  const sortedRows = [...pendingRows].sort(comparePendingBuildRows);
  const groups: PendingBuildTickGroup[] = [];

  for (const row of sortedRows) {
    const currentGroup = groups.at(-1);
    if (!currentGroup || currentGroup.executeTick !== row.executeTick) {
      groups.push({
        executeTick: row.executeTick,
        etaLabel: formatRelativeEta(row.executeTick, currentTick),
        items: [row],
      });
      continue;
    }

    currentGroup.items.push(row);
  }

  return groups;
}

export function deriveIncomeDeltaSamples(
  tick: number,
  previous: TeamIncomeBreakdownPayload,
  current: TeamIncomeBreakdownPayload,
): IncomeDeltaSample[] {
  const samples: IncomeDeltaSample[] = [];

  const baseDelta = current.base - previous.base;
  if (baseDelta !== 0) {
    samples.push({ tick, netDelta: baseDelta, cause: 'base' });
  }

  const structureDelta = current.structures - previous.structures;
  if (structureDelta !== 0) {
    samples.push({ tick, netDelta: structureDelta, cause: 'structures' });
  }

  const totalDelta = current.total - previous.total;
  if (totalDelta !== 0 && samples.length === 0) {
    samples.push({ tick, netDelta: totalDelta, cause: 'income' });
  }

  return samples;
}

export function aggregateIncomeDelta(
  samples: readonly IncomeDeltaSample[],
): AggregatedIncomeDelta[] {
  if (samples.length === 0) {
    return [];
  }

  const sortedSamples = [...samples].sort((a, b) => a.tick - b.tick);
  const grouped = new Map<
    number,
    {
      netDelta: number;
      resourceDelta: number;
      causes: string[];
    }
  >();

  for (const sample of sortedSamples) {
    if (!Number.isFinite(sample.tick)) {
      continue;
    }

    const tick = Math.trunc(sample.tick);
    const current = grouped.get(tick) ?? {
      netDelta: 0,
      resourceDelta: 0,
      causes: [],
    };
    current.netDelta += sample.netDelta;
    current.resourceDelta += sample.resourceDelta ?? 0;

    const cause = normalizeCauseLabel(sample.cause);
    if (cause && !current.causes.includes(cause)) {
      current.causes.push(cause);
    }

    grouped.set(tick, current);
  }

  return [...grouped.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tick, item]) => {
      const causes = item.causes.length > 0 ? item.causes : ['income'];

      return {
        tick,
        netDelta: item.netDelta,
        resourceDelta: item.resourceDelta,
        causes,
        causeLabel: buildCauseLabel(causes),
        isNegativeNet: item.netDelta < 0,
      };
    });
}
