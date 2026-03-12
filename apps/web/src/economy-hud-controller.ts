import type { TeamIncomeBreakdown, TeamPayload } from '#rts-engine';

import {
  type AggregatedIncomeDelta,
  type IncomeDeltaSample,
  aggregateIncomeDelta,
  deriveIncomeDeltaSamples,
} from './economy-view-model.js';
import { PendingTimelineElement } from './pending-timeline-element.js';

export type TeamEconomySnapshot = Pick<
  TeamPayload,
  'resources' | 'income' | 'incomeBreakdown'
> & {
  tick: number;
};

export interface EconomyDeltaTrackerState {
  lastSnapshot: TeamEconomySnapshot | null;
  latestCue: AggregatedIncomeDelta | null;
  latestTick: number | null;
  samples: IncomeDeltaSample[];
}

export interface EconomyHudElements {
  resourcesEl: HTMLElement;
  incomeEl: HTMLElement;
  hudResourcesEl: HTMLElement;
  hudIncomeEl: HTMLElement;
  hudDeltaChipEl: HTMLElement;
  incomeBreakdownBaseEl: HTMLElement;
  incomeBreakdownStructuresEl: HTMLElement;
  incomeBreakdownActiveEl: HTMLElement;
  pendingTimelineEl: HTMLElement;
}

export function createEconomyDeltaTrackerState(): EconomyDeltaTrackerState {
  return {
    lastSnapshot: null,
    latestCue: null,
    latestTick: null,
    samples: [],
  };
}

export function advanceEconomyDeltaTrackerState(
  state: EconomyDeltaTrackerState,
  nextSnapshot: TeamEconomySnapshot,
): EconomyDeltaTrackerState {
  const previousSnapshot = state.lastSnapshot;
  if (!previousSnapshot) {
    return {
      ...state,
      lastSnapshot: nextSnapshot,
    };
  }

  const resourceDelta = nextSnapshot.resources - previousSnapshot.resources;
  const incomeDelta = nextSnapshot.income - previousSnapshot.income;
  const resourceChanged = resourceDelta !== 0;
  const incomeChanged = incomeDelta !== 0;

  if (!resourceChanged && !incomeChanged) {
    return {
      ...state,
      lastSnapshot: nextSnapshot,
      latestCue:
        state.latestTick !== nextSnapshot.tick ? null : state.latestCue,
    };
  }

  let latestTick = state.latestTick;
  let samples = [...state.samples];
  if (latestTick !== nextSnapshot.tick) {
    latestTick = nextSnapshot.tick;
    samples = [];
  }

  samples.push(
    ...deriveIncomeDeltaSamples(
      nextSnapshot.tick,
      previousSnapshot.incomeBreakdown,
      nextSnapshot.incomeBreakdown,
    ),
  );
  if (resourceDelta !== 0) {
    samples.push({
      tick: nextSnapshot.tick,
      netDelta: 0,
      resourceDelta,
      cause: resourceDelta > 0 ? 'income tick' : 'queue spend',
    });
  }

  const cue =
    aggregateIncomeDelta(samples).find(
      ({ tick: cueTick }) => cueTick === nextSnapshot.tick,
    ) ?? null;

  return {
    lastSnapshot: nextSnapshot,
    latestCue: cue,
    latestTick,
    samples,
  };
}

export class EconomyHudController {
  readonly #elements: EconomyHudElements;
  readonly #pendingTimeline: PendingTimelineElement;
  #deltaTrackerState: EconomyDeltaTrackerState =
    createEconomyDeltaTrackerState();

  public constructor(elements: EconomyHudElements) {
    this.#elements = elements;
    this.#pendingTimeline = new PendingTimelineElement(
      elements.pendingTimelineEl,
    );
  }

  public reset(): void {
    this.#deltaTrackerState = createEconomyDeltaTrackerState();

    this.#elements.resourcesEl.textContent = '-';
    this.#elements.incomeEl.textContent = '-';
    this.#elements.hudResourcesEl.textContent = '-';
    this.#elements.hudIncomeEl.textContent = '-';

    this.#elements.resourcesEl.classList.remove(
      'economy-value--negative',
      'economy-value--pulse',
    );
    this.#elements.incomeEl.classList.remove(
      'economy-value--negative',
      'economy-value--pulse',
    );
    this.#elements.hudResourcesEl.classList.remove(
      'economy-value--negative',
      'economy-value--pulse',
    );
    this.#elements.hudIncomeEl.classList.remove(
      'economy-value--negative',
      'economy-value--pulse',
    );

    this.#renderEconomyDeltaChip(null);
    this.#renderIncomeBreakdown(null);
    this.#pendingTimeline.update({
      pendingBuilds: [],
      currentTick: 0,
    });
  }

  public sync(team: TeamPayload | null, tick: number): void {
    if (!team) {
      this.reset();
      this.#pendingTimeline.update({
        pendingBuilds: [],
        currentTick: tick,
      });
      return;
    }

    this.#elements.resourcesEl.textContent = `${team.resources}`;
    this.#elements.incomeEl.textContent = `${team.income}/tick`;
    this.#elements.hudResourcesEl.textContent = `${team.resources}`;
    this.#elements.hudIncomeEl.textContent = `${team.income}/tick`;

    const netNegative = team.income < 0;
    this.#elements.incomeEl.classList.toggle(
      'economy-value--negative',
      netNegative,
    );
    this.#elements.hudIncomeEl.classList.toggle(
      'economy-value--negative',
      netNegative,
    );

    this.#renderIncomeBreakdown(team);
    this.#pendingTimeline.update({
      pendingBuilds: team.pendingBuilds,
      currentTick: tick,
    });

    const nextSnapshot: TeamEconomySnapshot = {
      tick,
      resources: team.resources,
      income: team.income,
      incomeBreakdown: cloneIncomeBreakdown(team.incomeBreakdown),
    };

    const previousSnapshot = this.#deltaTrackerState.lastSnapshot;
    this.#deltaTrackerState = advanceEconomyDeltaTrackerState(
      this.#deltaTrackerState,
      nextSnapshot,
    );

    if (previousSnapshot) {
      const resourceChanged =
        nextSnapshot.resources !== previousSnapshot.resources;
      const incomeChanged = nextSnapshot.income !== previousSnapshot.income;
      if (resourceChanged) {
        this.#triggerValuePulse(
          this.#elements.resourcesEl,
          this.#elements.hudResourcesEl,
        );
      }
      if (incomeChanged) {
        this.#triggerValuePulse(
          this.#elements.incomeEl,
          this.#elements.hudIncomeEl,
        );
      }
    }

    this.#renderEconomyDeltaChip(team);
  }

  #triggerValuePulse(...elements: HTMLElement[]): void {
    for (const element of elements) {
      element.classList.remove('economy-value--pulse');
      void element.offsetWidth;
      element.classList.add('economy-value--pulse');
    }
  }

  #renderIncomeBreakdown(team: TeamPayload | null): void {
    if (!team) {
      this.#elements.incomeBreakdownBaseEl.textContent = '-';
      this.#elements.incomeBreakdownStructuresEl.textContent = '-';
      this.#elements.incomeBreakdownActiveEl.textContent = '-';
      return;
    }

    this.#elements.incomeBreakdownBaseEl.textContent = formatSigned(
      team.incomeBreakdown.base,
    );
    this.#elements.incomeBreakdownStructuresEl.textContent = formatSigned(
      team.incomeBreakdown.structures,
    );
    this.#elements.incomeBreakdownActiveEl.textContent = `${team.incomeBreakdown.activeStructureCount}`;
  }

  #renderEconomyDeltaChip(team: TeamPayload | null): void {
    if (!team || !this.#deltaTrackerState.latestCue) {
      this.#elements.hudDeltaChipEl.classList.add('is-hidden');
      return;
    }

    const parts: string[] = [];
    if (this.#deltaTrackerState.latestCue.netDelta !== 0) {
      parts.push(
        `net ${formatSigned(this.#deltaTrackerState.latestCue.netDelta)}/tick`,
      );
    }
    if (this.#deltaTrackerState.latestCue.resourceDelta !== 0) {
      parts.push(
        `res ${formatSigned(this.#deltaTrackerState.latestCue.resourceDelta)}`,
      );
    }

    if (parts.length === 0) {
      this.#elements.hudDeltaChipEl.classList.add('is-hidden');
      return;
    }

    this.#elements.hudDeltaChipEl.classList.remove('is-hidden');
    this.#elements.hudDeltaChipEl.classList.toggle(
      'economy-delta-chip--negative',
      team.income < 0 || this.#deltaTrackerState.latestCue.isNegativeNet,
    );
    this.#elements.hudDeltaChipEl.textContent = `${parts.join(' | ')} • ${this.#deltaTrackerState.latestCue.causeLabel}`;
  }
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function cloneIncomeBreakdown(
  breakdown: TeamIncomeBreakdown,
): TeamIncomeBreakdown {
  return {
    base: breakdown.base,
    structures: breakdown.structures,
    total: breakdown.total,
    activeStructureCount: breakdown.activeStructureCount,
  };
}
