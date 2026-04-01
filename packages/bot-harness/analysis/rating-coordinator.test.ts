import { describe, expect, it } from 'vitest';

import { computeRatingsSequential, computeRatingsParallel } from './rating-coordinator.js';
import type { RatingComputeOptions } from './rating-coordinator.js';
import type { ParsedMatch, RatingsReport } from './types.js';
import type {
  MatchHeader,
  MatchOutcomeRecord,
  TickActionRecord,
  TickEconomyRecord,
  TickRecord,
} from '../types.js';

// ── helpers ────────────────────────────────────────────────────────────

function makeTick(
  tick: number,
  actions: TickActionRecord[] = [],
  economy: TickEconomyRecord[] = [],
): TickRecord {
  return {
    type: 'tick',
    tick,
    actions,
    economy,
    buildOutcomes: actions.filter((a) => a.actionType === 'build').length,
    destroyOutcomes: actions.filter((a) => a.actionType === 'destroy').length,
  };
}

function makeHeader(seed = 1): MatchHeader {
  return {
    type: 'header',
    seed,
    config: {
      seed,
      gridWidth: 52,
      gridHeight: 52,
      maxTicks: 200,
      hashCheckpointInterval: 50,
    },
    bots: ['bot-a', 'bot-b'],
    startedAt: '2026-01-01T00:00:00Z',
  };
}

function makeOutcome(
  totalTicks: number,
  ranked: MatchOutcomeRecord['ranked'] = [],
): MatchOutcomeRecord {
  return {
    type: 'outcome',
    totalTicks,
    winner: ranked.length > 0 ? ranked[0] : null,
    ranked,
    isDraw: ranked.length === 0,
  };
}

function makeRanked(
  teamId: number,
  rank: number,
  territoryCellCount: number,
): MatchOutcomeRecord['ranked'][number] {
  return {
    rank,
    teamId,
    outcome: rank === 1 ? 'winner' : 'defeated',
    finalCoreHp: rank === 1 ? 100 : 0,
    coreState: rank === 1 ? 'intact' : 'destroyed',
    territoryCellCount,
    queuedBuildCount: 10,
    appliedBuildCount: 8,
    rejectedBuildCount: 2,
  };
}

function buildAction(
  teamId: number,
  templateId: string,
  result: string = 'applied',
): TickActionRecord {
  return { teamId, actionType: 'build', templateId, result };
}

function economyEntry(
  teamId: number,
  resources: number,
  income: number,
): TickEconomyRecord {
  return { teamId, resources, income };
}

/**
 * Create synthetic matches where team 0 (using 'block') consistently wins
 * and team 1 (using 'glider') consistently loses, producing a clear
 * rating separation.
 */
function makeSyntheticMatches(count: number): ParsedMatch[] {
  const matches: ParsedMatch[] = [];
  for (let m = 0; m < count; m++) {
    const ticks: TickRecord[] = [];
    for (let t = 0; t < 100; t++) {
      const actions: TickActionRecord[] = [];
      const economy = [
        economyEntry(0, 100 + t, 10 + t),
        economyEntry(1, 100 + t, 10 + t),
      ];
      // Team 0 builds block (early + mid phases)
      if (t === 5 || t === 10 || t === 50 || t === 80) {
        actions.push(buildAction(0, 'block'));
      }
      // Team 1 builds glider (early + mid phases)
      if (t === 5 || t === 10 || t === 50 || t === 80) {
        actions.push(buildAction(1, 'glider'));
      }
      // Both teams build generator mid-game
      if (t === 30) {
        actions.push(buildAction(0, 'generator'));
        actions.push(buildAction(1, 'generator'));
      }
      ticks.push(makeTick(t, actions, economy));
    }
    // Team 0 always wins
    matches.push({
      header: makeHeader(m + 1),
      ticks,
      outcome: makeOutcome(100, [
        makeRanked(0, 1, 500),
        makeRanked(1, 2, 200),
      ]),
    });
  }
  return matches;
}

/**
 * Create diverse matches with pairwise template co-occurrences for combination pools.
 */
function makeDiverseMatches(count: number): ParsedMatch[] {
  const matches: ParsedMatch[] = [];
  for (let m = 0; m < count; m++) {
    const ticks: TickRecord[] = [];
    for (let t = 0; t < 100; t++) {
      const actions: TickActionRecord[] = [];
      const economy = [
        economyEntry(0, 100 + t, 10 + t),
        economyEntry(1, 100 + t, 10 + t),
      ];
      // Team 0 uses block + generator
      if (t === 5) {
        actions.push(buildAction(0, 'block'));
        actions.push(buildAction(0, 'generator'));
      }
      // Team 1 uses glider + eater-1
      if (t === 10) {
        actions.push(buildAction(1, 'glider'));
        actions.push(buildAction(1, 'eater-1'));
      }
      ticks.push(makeTick(t, actions, economy));
    }
    const winner = m % 2 === 0 ? 0 : 1;
    matches.push({
      header: makeHeader(m + 1),
      ticks,
      outcome: makeOutcome(100, [
        makeRanked(winner, 1, 500),
        makeRanked(winner === 0 ? 1 : 0, 2, 200),
      ]),
    });
  }
  return matches;
}

// ── Tests ─────────────────────────────────────────────────────────────

describe('computeRatingsSequential', () => {
  it('processes all pools in single thread and returns a RatingsReport', async () => {
    const matches = makeSyntheticMatches(10);
    const options: RatingComputeOptions = {};

    const report = await computeRatingsSequential(matches, options);

    // Verify structure
    expect(report.hyperparameters).toBeDefined();
    expect(report.hyperparameters.initialRating).toBe(1500);
    expect(report.hyperparameters.tau).toBe(0.5);
    expect(report.hyperparameters.phaseBoundaries).toBeDefined();
    expect(report.hyperparameters.phaseBoundaries.earlyEnd).toBe(200);
    expect(report.hyperparameters.phaseBoundaries.midEnd).toBe(600);

    // Individual per-phase ratings
    expect(report.individual.early.length).toBeGreaterThan(0);
    expect(report.individual.mid).toBeDefined();
    expect(report.individual.late).toBeDefined();

    // Pairwise and frequent-set arrays exist
    expect(report.pairwise).toBeDefined();
    expect(report.frequentSets).toBeDefined();

    // Outlier sections exist
    expect(report.outliers).toBeDefined();
    expect(report.outliers.perPhase.early).toBeDefined();
    expect(report.outliers.perPhase.mid).toBeDefined();
    expect(report.outliers.perPhase.late).toBeDefined();
    expect(report.outliers.overall).toBeDefined();
  });

  it('assigns higher rating to consistently winning template and lower to losing template', async () => {
    const matches = makeSyntheticMatches(20);
    const options: RatingComputeOptions = {};

    const report = await computeRatingsSequential(matches, options);

    // In early phase, block should have rating > 1500 and glider < 1500
    const earlyEntities = report.individual.early;
    const blockEarly = earlyEntities.find((e) => e.id === 'block');
    const gliderEarly = earlyEntities.find((e) => e.id === 'glider');

    expect(blockEarly).toBeDefined();
    expect(gliderEarly).toBeDefined();

    if (blockEarly && gliderEarly) {
      expect(blockEarly.rating.rating).toBeGreaterThan(1500);
      expect(gliderEarly.rating.rating).toBeLessThan(1500);
    }
  });

  it('populates pairwise and frequent-set combination pools', async () => {
    const matches = makeDiverseMatches(10);
    const options: RatingComputeOptions = { minSupport: 2 };

    const report = await computeRatingsSequential(matches, options);

    // Pairwise combinations should exist
    expect(report.pairwise.length).toBeGreaterThan(0);

    // Each pairwise entity should have the expected format
    for (const entity of report.pairwise) {
      expect(entity.entityType).toBe('pairwise');
      expect(entity.id).toContain('+');
      expect(entity.rating).toBeDefined();
      expect(typeof entity.rating.rating).toBe('number');
    }
  });

  it('runs outlier detection and populates outlierFlags', async () => {
    const matches = makeSyntheticMatches(20);
    const options: RatingComputeOptions = {};

    const report = await computeRatingsSequential(matches, options);

    // Outlier detection should have run on per-phase entities
    const allEntities = [
      ...report.individual.early,
      ...report.individual.mid,
      ...report.individual.late,
    ];

    // At least some entities should exist
    expect(allEntities.length).toBeGreaterThan(0);

    // All entities should have outlierFlags array (even if empty)
    for (const entity of allEntities) {
      expect(Array.isArray(entity.outlierFlags)).toBe(true);
    }

    // Overall outliers should have run too
    expect(Array.isArray(report.outliers.overall)).toBe(true);
  });
});

describe('computeRatingsParallel', () => {
  it('produces same results as sequential for identical input', async () => {
    const matches = makeSyntheticMatches(10);
    const options: RatingComputeOptions = {};

    const seqReport = await computeRatingsSequential(matches, options);
    const parReport = await computeRatingsParallel(matches, { ...options, workers: 2 });

    // Compare individual early ratings -- same entities, same order
    expect(parReport.individual.early.length).toBe(seqReport.individual.early.length);

    for (let i = 0; i < seqReport.individual.early.length; i++) {
      const seqEntity = seqReport.individual.early[i];
      const parEntity = parReport.individual.early.find((e) => e.id === seqEntity.id);
      expect(parEntity).toBeDefined();
      if (parEntity) {
        expect(parEntity.rating.rating).toBeCloseTo(seqEntity.rating.rating, 2);
        expect(parEntity.rating.rd).toBeCloseTo(seqEntity.rating.rd, 2);
        expect(parEntity.matchCount).toBe(seqEntity.matchCount);
      }
    }

    // Compare pairwise ratings count
    expect(parReport.pairwise.length).toBe(seqReport.pairwise.length);

    // Compare hyperparameters
    expect(parReport.hyperparameters).toEqual(seqReport.hyperparameters);
  }, 30000);
});
