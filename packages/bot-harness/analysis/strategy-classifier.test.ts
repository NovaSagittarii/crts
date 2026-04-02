import { describe, expect, it } from 'vitest';

import type {
  ParsedMatch,
  StrategyFeatureVector,
} from './types.js';
import type {
  MatchHeader,
  MatchOutcomeRecord,
  TickActionRecord,
  TickEconomyRecord,
  TickRecord,
} from '../types.js';
import {
  extractFeatures,
  classifyStrategy,
  classifyAll,
} from './strategy-classifier.js';

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
  x?: number,
  y?: number,
): TickActionRecord {
  return {
    teamId,
    actionType: 'build',
    templateId,
    x,
    y,
    result,
  };
}

function economyEntry(
  teamId: number,
  resources: number,
  income: number,
): TickEconomyRecord {
  return { teamId, resources, income };
}

// ── Feature extraction tests ───────────────────────────────────────────

describe('extractFeatures', () => {
  it('extracts correct firstBuildTick and buildDensity from 3 applied builds', () => {
    const ticks: TickRecord[] = [];
    for (let t = 0; t < 200; t++) {
      const actions: TickActionRecord[] = [];
      const economy = [economyEntry(0, 100, 10), economyEntry(1, 100, 10)];
      if (t === 10) actions.push(buildAction(0, 'generator'));
      if (t === 50) actions.push(buildAction(0, 'block'));
      if (t === 100) actions.push(buildAction(0, 'glider'));
      ticks.push(makeTick(t, actions, economy));
    }
    const match: ParsedMatch = {
      header: makeHeader(),
      ticks,
      outcome: makeOutcome(200, [makeRanked(0, 1, 500), makeRanked(1, 2, 200)]),
    };

    const features = extractFeatures(match, 0);
    expect(features.firstBuildTick).toBe(10);
    expect(features.buildDensity).toBeCloseTo((3 / 200) * 100, 3);
  });

  it('computes buildBurstiness as stddev of inter-build intervals', () => {
    // Builds at ticks 10, 50, 100 -> intervals [40, 50] -> stddev ~5.0
    const ticks: TickRecord[] = [];
    for (let t = 0; t < 200; t++) {
      const actions: TickActionRecord[] = [];
      if (t === 10) actions.push(buildAction(0, 'generator'));
      if (t === 50) actions.push(buildAction(0, 'block'));
      if (t === 100) actions.push(buildAction(0, 'glider'));
      ticks.push(makeTick(t, actions, [economyEntry(0, 100, 10)]));
    }
    const match: ParsedMatch = {
      header: makeHeader(),
      ticks,
      outcome: makeOutcome(200, [makeRanked(0, 1, 500), makeRanked(1, 2, 200)]),
    };

    const features = extractFeatures(match, 0);
    expect(features.buildBurstiness).toBeCloseTo(5.0, 1);
  });

  it('computes resourceEfficiency = applied/(applied+rejected)', () => {
    const ticks: TickRecord[] = [];
    for (let t = 0; t < 100; t++) {
      const actions: TickActionRecord[] = [];
      if (t === 10) actions.push(buildAction(0, 'generator', 'applied'));
      if (t === 20) actions.push(buildAction(0, 'block', 'applied'));
      if (t === 30) actions.push(buildAction(0, 'glider', 'rejected'));
      ticks.push(makeTick(t, actions, [economyEntry(0, 100, 10)]));
    }
    const match: ParsedMatch = {
      header: makeHeader(),
      ticks,
      outcome: makeOutcome(100, [makeRanked(0, 1, 500), makeRanked(1, 2, 200)]),
    };

    const features = extractFeatures(match, 0);
    // 2 applied / (2 applied + 1 rejected) = 2/3
    expect(features.resourceEfficiency).toBeCloseTo(2 / 3, 3);
  });

  it('counts uniqueTemplatesUsed from distinct templateIds in applied builds', () => {
    const ticks: TickRecord[] = [];
    for (let t = 0; t < 100; t++) {
      const actions: TickActionRecord[] = [];
      if (t === 10) actions.push(buildAction(0, 'generator'));
      if (t === 20) actions.push(buildAction(0, 'generator'));
      if (t === 30) actions.push(buildAction(0, 'block'));
      if (t === 40) actions.push(buildAction(0, 'glider'));
      ticks.push(makeTick(t, actions, [economyEntry(0, 100, 10)]));
    }
    const match: ParsedMatch = {
      header: makeHeader(),
      ticks,
      outcome: makeOutcome(100, [makeRanked(0, 1, 500), makeRanked(1, 2, 200)]),
    };

    const features = extractFeatures(match, 0);
    expect(features.uniqueTemplatesUsed).toBe(3);
  });

  it('computes templateEntropy using Shannon entropy over template build counts', () => {
    // 2 generators, 1 block, 1 glider -> counts [2, 1, 1] -> entropy = -2/4*log2(2/4) - 1/4*log2(1/4) - 1/4*log2(1/4)
    const ticks: TickRecord[] = [];
    for (let t = 0; t < 100; t++) {
      const actions: TickActionRecord[] = [];
      if (t === 10) actions.push(buildAction(0, 'generator'));
      if (t === 20) actions.push(buildAction(0, 'generator'));
      if (t === 30) actions.push(buildAction(0, 'block'));
      if (t === 40) actions.push(buildAction(0, 'glider'));
      ticks.push(makeTick(t, actions, [economyEntry(0, 100, 10)]));
    }
    const match: ParsedMatch = {
      header: makeHeader(),
      ticks,
      outcome: makeOutcome(100, [makeRanked(0, 1, 500), makeRanked(1, 2, 200)]),
    };

    const features = extractFeatures(match, 0);
    // Shannon entropy of [2, 1, 1]: -(0.5*log2(0.5) + 0.25*log2(0.25) + 0.25*log2(0.25)) = 1.5
    expect(features.templateEntropy).toBeCloseTo(1.5, 3);
  });

  it('defaults avgDistanceToEnemy and structureSpread to 0 when no x/y data', () => {
    const ticks: TickRecord[] = [];
    for (let t = 0; t < 50; t++) {
      const actions: TickActionRecord[] = [];
      if (t === 10) actions.push(buildAction(0, 'generator'));
      ticks.push(makeTick(t, actions, [economyEntry(0, 100, 10)]));
    }
    const match: ParsedMatch = {
      header: makeHeader(),
      ticks,
      outcome: makeOutcome(50, [makeRanked(0, 1, 500), makeRanked(1, 2, 200)]),
    };

    const features = extractFeatures(match, 0);
    expect(features.avgDistanceToEnemy).toBe(0);
    expect(features.structureSpread).toBe(0);
  });

  it('computes avgDistanceToEnemy and structureSpread when x/y present', () => {
    const ticks: TickRecord[] = [];
    for (let t = 0; t < 50; t++) {
      const actions: TickActionRecord[] = [];
      // Team 0 builds at (5, 5), (10, 10), and (20, 5) -- 3 spread-out positions
      if (t === 10) actions.push(buildAction(0, 'generator', 'applied', 5, 5));
      if (t === 20) actions.push(buildAction(0, 'block', 'applied', 10, 10));
      if (t === 25) actions.push(buildAction(0, 'glider', 'applied', 20, 5));
      // Team 1 builds at (40, 40) - for opponent reference
      if (t === 15) actions.push(buildAction(1, 'generator', 'applied', 40, 40));
      ticks.push(makeTick(t, actions, [economyEntry(0, 100, 10), economyEntry(1, 100, 10)]));
    }
    const match: ParsedMatch = {
      header: makeHeader(),
      ticks,
      outcome: makeOutcome(50, [makeRanked(0, 1, 500), makeRanked(1, 2, 200)]),
    };

    const features = extractFeatures(match, 0);
    // With x/y data present and 3 non-collinear positions, spread should be non-zero
    expect(features.structureSpread).toBeGreaterThan(0);
    // avgDistanceToEnemy should be non-zero since opponent builds at (40, 40)
    expect(features.avgDistanceToEnemy).toBeGreaterThan(0);
  });

  it('produces a zero/default feature vector for empty tick records', () => {
    const match: ParsedMatch = {
      header: makeHeader(),
      ticks: [],
      outcome: makeOutcome(0, [makeRanked(0, 1, 0), makeRanked(1, 2, 0)]),
    };

    const features = extractFeatures(match, 0);
    expect(features.firstBuildTick).toBe(0);
    expect(features.buildDensity).toBe(0);
    expect(features.buildBurstiness).toBe(0);
    expect(features.avgResourcesAtBuild).toBe(0);
    expect(features.resourceEfficiency).toBe(0);
    expect(features.uniqueTemplatesUsed).toBe(0);
    expect(features.templateEntropy).toBe(0);
    expect(features.avgDistanceToEnemy).toBe(0);
    expect(features.structureSpread).toBe(0);
  });
});

// ── Rule-based classification tests ────────────────────────────────────

describe('classifyStrategy', () => {
  function featuresWith(
    overrides: Partial<StrategyFeatureVector>,
  ): StrategyFeatureVector {
    return {
      firstBuildTick: 50,
      buildDensity: 1.0,
      buildBurstiness: 5,
      avgResourcesAtBuild: 100,
      resourceEfficiency: 0.7,
      territoryGrowthRate: 0.5,
      finalTerritoryRatio: 0.5,
      uniqueTemplatesUsed: 2,
      templateEntropy: 1.0,
      avgDistanceToEnemy: 0,
      structureSpread: 0,
      ...overrides,
    };
  }

  it('classifies team with firstBuildTick < 5% of total and high buildDensity as "early-builder"', () => {
    const features = featuresWith({
      firstBuildTick: 5,
      buildDensity: 3.0,
    });
    // No dominant template -> not template-heavy
    const buildCounts: Record<string, number> = { generator: 3, block: 3, glider: 3 };
    const label = classifyStrategy(features, buildCounts, 200);
    expect(label).toBe('early-builder');
  });

  it('classifies team with high templateEntropy and uniqueTemplatesUsed >= 4 as "diverse-placer"', () => {
    const features = featuresWith({
      templateEntropy: 2.0,
      uniqueTemplatesUsed: 5,
      firstBuildTick: 50,
      buildDensity: 1.0,
    });
    const buildCounts: Record<string, number> = { a: 2, b: 2, c: 2, d: 2, e: 2 };
    const label = classifyStrategy(features, buildCounts, 200);
    expect(label).toBe('diverse-placer');
  });

  it('classifies team with >60% builds of one template as "{templateId}-heavy"', () => {
    const features = featuresWith({
      firstBuildTick: 50,
      buildDensity: 1.0,
    });
    // generator is 7/10 = 70% > 60%
    const buildCounts: Record<string, number> = { generator: 7, block: 2, glider: 1 };
    const label = classifyStrategy(features, buildCounts, 200);
    expect(label).toBe('generator-heavy');
  });

  it('classifies team with low buildDensity and high avgResourcesAtBuild as "economy-saver"', () => {
    const features = featuresWith({
      buildDensity: 0.3,
      resourceEfficiency: 0.9,
      firstBuildTick: 50,
    });
    const buildCounts: Record<string, number> = { generator: 1, block: 1 };
    const label = classifyStrategy(features, buildCounts, 200);
    expect(label).toBe('economy-saver');
  });

  it('defaults to "balanced" for teams not matching specific rules', () => {
    const features = featuresWith({
      firstBuildTick: 50,
      buildDensity: 1.0,
      templateEntropy: 1.0,
      uniqueTemplatesUsed: 2,
      resourceEfficiency: 0.7,
    });
    const buildCounts: Record<string, number> = { generator: 5, block: 5 };
    const label = classifyStrategy(features, buildCounts, 200);
    expect(label).toBe('balanced');
  });
});

// ── classifyAll test ───────────────────────────────────────────────────

describe('classifyAll', () => {
  it('returns a StrategyAssignment[] with one entry per team per match', () => {
    const ticks: TickRecord[] = [];
    for (let t = 0; t < 100; t++) {
      const actions: TickActionRecord[] = [];
      if (t === 10) actions.push(buildAction(0, 'generator'));
      if (t === 20) actions.push(buildAction(1, 'block'));
      ticks.push(
        makeTick(t, actions, [
          economyEntry(0, 100, 10),
          economyEntry(1, 100, 10),
        ]),
      );
    }
    const matches: ParsedMatch[] = [
      {
        header: makeHeader(),
        ticks,
        outcome: makeOutcome(100, [
          makeRanked(0, 1, 500),
          makeRanked(1, 2, 200),
        ]),
      },
    ];

    const assignments = classifyAll(matches);
    expect(assignments).toHaveLength(2);
    expect(assignments[0].matchIndex).toBe(0);
    expect(assignments[0].teamId).toBe(0);
    expect(assignments[0].ruleLabel).toBeTruthy();
    expect(assignments[0].clusterId).toBe(-1);
    expect(assignments[1].matchIndex).toBe(0);
    expect(assignments[1].teamId).toBe(1);
    expect(assignments[1].ruleLabel).toBeTruthy();
    expect(assignments[1].clusterId).toBe(-1);
  });
});
