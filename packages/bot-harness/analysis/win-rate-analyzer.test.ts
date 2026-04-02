import { describe, expect, it } from 'vitest';

import type {
  AnalysisConfig,
  StrategyAssignment,
  StrategyFeatureVector,
} from './types.js';
import type { ParsedMatch } from './types.js';
import type {
  MatchHeader,
  MatchOutcomeRecord,
  TickActionRecord,
  TickRecord,
} from '../types.js';

import {
  computeTemplateWinRates,
  computeStrategyWinRates,
} from './win-rate-analyzer.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const defaultConfig: AnalysisConfig = {
  confidence: 0.95,
  minMatches: 1,
  maxPatternLength: 3,
  k: 3,
  firstNBuilds: 2,
};

function makeAction(
  teamId: number,
  templateId: string,
  result: string = 'applied',
): TickActionRecord {
  return {
    teamId,
    actionType: 'build',
    templateId,
    x: 10,
    y: 10,
    result,
  };
}

function makeHeader(seed: number = 1): MatchHeader {
  return {
    type: 'header',
    seed,
    config: {
      seed,
      gridWidth: 52,
      gridHeight: 52,
      maxTicks: 2000,
      hashCheckpointInterval: 50,
    },
    bots: ['bot-a', 'bot-b'],
    startedAt: '2026-01-01T00:00:00Z',
  };
}

function makeTick(tick: number, actions: TickActionRecord[]): TickRecord {
  return {
    type: 'tick',
    tick,
    actions,
    economy: [],
    buildOutcomes: actions.filter((a) => a.actionType === 'build').length,
    destroyOutcomes: 0,
  };
}

function makeOutcome(
  winnerId: number | null,
  isDraw: boolean = false,
  totalTicks: number = 100,
): MatchOutcomeRecord {
  if (isDraw) {
    return {
      type: 'outcome',
      totalTicks,
      winner: null,
      ranked: [
        {
          rank: 1,
          teamId: 1,
          outcome: 'defeated',
          finalCoreHp: 100,
          coreState: 'intact',
          territoryCellCount: 50,
          queuedBuildCount: 0,
          appliedBuildCount: 0,
          rejectedBuildCount: 0,
        },
        {
          rank: 1,
          teamId: 2,
          outcome: 'defeated',
          finalCoreHp: 100,
          coreState: 'intact',
          territoryCellCount: 50,
          queuedBuildCount: 0,
          appliedBuildCount: 0,
          rejectedBuildCount: 0,
        },
      ],
      isDraw: true,
    };
  }

  const loserId = winnerId === 1 ? 2 : 1;
  return {
    type: 'outcome',
    totalTicks,
    winner: {
      rank: 1,
      teamId: winnerId!,
      outcome: 'winner',
      finalCoreHp: 200,
      coreState: 'intact',
      territoryCellCount: 80,
      queuedBuildCount: 0,
      appliedBuildCount: 0,
      rejectedBuildCount: 0,
    },
    ranked: [
      {
        rank: 1,
        teamId: winnerId!,
        outcome: 'winner',
        finalCoreHp: 200,
        coreState: 'intact',
        territoryCellCount: 80,
        queuedBuildCount: 0,
        appliedBuildCount: 0,
        rejectedBuildCount: 0,
      },
      {
        rank: 2,
        teamId: loserId,
        outcome: 'defeated',
        finalCoreHp: 0,
        coreState: 'destroyed',
        territoryCellCount: 20,
        queuedBuildCount: 0,
        appliedBuildCount: 0,
        rejectedBuildCount: 0,
      },
    ],
    isDraw: false,
  };
}

function makeMatch(
  team1Builds: string[],
  team2Builds: string[],
  winnerId: number | null,
  isDraw: boolean = false,
): ParsedMatch {
  const actions: TickActionRecord[] = [];
  // Interleave builds across ticks for realism, but all in one tick is fine for test
  for (const templateId of team1Builds) {
    actions.push(makeAction(1, templateId));
  }
  for (const templateId of team2Builds) {
    actions.push(makeAction(2, templateId));
  }

  return {
    header: makeHeader(),
    ticks: [makeTick(1, actions)],
    outcome: makeOutcome(winnerId, isDraw),
  };
}

// ---------------------------------------------------------------------------
// Test fixtures: 4 matches per plan spec
// ---------------------------------------------------------------------------

// Match 1: Team 1 wins, team 1 built [block, generator, glider], team 2 built [block, eater-1]
const match1 = makeMatch(
  ['block', 'generator', 'glider'],
  ['block', 'eater-1'],
  1,
);

// Match 2: Team 2 wins, team 1 built [generator], team 2 built [block, glider, glider]
const match2 = makeMatch(
  ['generator'],
  ['block', 'glider', 'glider'],
  2,
);

// Match 3: Draw, team 1 built [block, block], team 2 built [generator]
const match3 = makeMatch(['block', 'block'], ['generator'], null, true);

// Match 4: Team 1 wins, team 1 built [gosper], team 2 built [block]
const match4 = makeMatch(['gosper'], ['block'], 1);

const allMatches = [match1, match2, match3, match4];

// ---------------------------------------------------------------------------
// Presence-based tests
// ---------------------------------------------------------------------------

describe('computeTemplateWinRates — presence-based', () => {
  it('computes block presence win rate correctly', () => {
    // Block usage per team per match:
    //   M1: T1=block(win), T2=block(lose) -> T1 contributes 1 win/1 total, T2 contributes 0 win/1 total
    //   M2: T1=no block(lose), T2=block(win) -> T2 contributes 1 win/1 total
    //   M3: T1=block(draw), T2=no block(draw) -> T1 contributes 0.5 win/1 total
    //   M4: T1=no gosper(win), T2=block(lose) -> T2 contributes 0 win/1 total
    // Total: wins = 1 + 0 + 1 + 0.5 + 0 = 2.5, total = 1 + 1 + 1 + 1 + 1 = 5
    // Win rate = 2.5 / 5 = 0.5
    const results = computeTemplateWinRates(allMatches, defaultConfig);
    const block = results.find((r) => r.templateId === 'block');
    expect(block).toBeDefined();
    expect(block!.presence.winRate).toBeCloseTo(0.5, 5);
    expect(block!.presence.wins).toBeCloseTo(2.5, 5);
    expect(block!.presence.total).toBe(5);
  });

  it('computes gosper presence win rate = 1.0 (only in match 4, team 1 won)', () => {
    const results = computeTemplateWinRates(allMatches, defaultConfig);
    const gosper = results.find((r) => r.templateId === 'gosper');
    expect(gosper).toBeDefined();
    expect(gosper!.presence.winRate).toBeCloseTo(1.0, 5);
    expect(gosper!.presence.wins).toBeCloseTo(1.0, 5);
    expect(gosper!.presence.total).toBe(1);
  });

  it('returns CI with n > 0 for templates that appear', () => {
    const results = computeTemplateWinRates(allMatches, defaultConfig);
    for (const wr of results) {
      if (wr.presence.total > 0) {
        expect(wr.presence.ci.n).toBeGreaterThan(0);
        expect(wr.presence.ci.lower).toBeLessThanOrEqual(wr.presence.ci.upper);
      }
    }
  });

  it('includes template names from createDefaultStructureTemplates', () => {
    const results = computeTemplateWinRates(allMatches, defaultConfig);
    const block = results.find((r) => r.templateId === 'block');
    expect(block).toBeDefined();
    expect(block!.templateName).toBe('Block 2x2');
  });
});

// ---------------------------------------------------------------------------
// Usage-weighted tests
// ---------------------------------------------------------------------------

describe('computeTemplateWinRates — usage-weighted', () => {
  it('weights by build count within each match-team pair', () => {
    // Glider usage-weighted:
    //   M1: T1 builds glider once (win) -> wins += 1, total += 1
    //   M2: T2 builds glider twice (win) -> wins += 2, total += 2
    //   Others: no glider builds
    // Win rate = 3 / 3 = 1.0
    const results = computeTemplateWinRates(allMatches, defaultConfig);
    const glider = results.find((r) => r.templateId === 'glider');
    expect(glider).toBeDefined();
    expect(glider!.usageWeighted.winRate).toBeCloseTo(1.0, 5);
    expect(glider!.usageWeighted.wins).toBeCloseTo(3.0, 5);
    expect(glider!.usageWeighted.total).toBe(3);
  });

  it('treats draws as 0.5 * build_count contribution', () => {
    // Block usage-weighted:
    //   M1: T1 builds block 1 time (win) -> wins += 1, total += 1
    //   M1: T2 builds block 1 time (lose) -> wins += 0, total += 1
    //   M2: T2 builds block 1 time (win) -> wins += 1, total += 1
    //   M3: T1 builds block 2 times (draw) -> wins += 1.0, total += 2
    //   M4: T2 builds block 1 time (lose) -> wins += 0, total += 1
    // Total: wins = 1 + 0 + 1 + 1.0 + 0 = 3.0, total = 1 + 1 + 1 + 2 + 1 = 6
    // Win rate = 3.0 / 6 = 0.5
    const results = computeTemplateWinRates(allMatches, defaultConfig);
    const block = results.find((r) => r.templateId === 'block');
    expect(block).toBeDefined();
    expect(block!.usageWeighted.winRate).toBeCloseTo(0.5, 5);
    expect(block!.usageWeighted.wins).toBeCloseTo(3.0, 5);
    expect(block!.usageWeighted.total).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// First-build tests (firstNBuilds = 2)
// ---------------------------------------------------------------------------

describe('computeTemplateWinRates — first-build', () => {
  it('only considers first N builds per team per match', () => {
    // With firstNBuilds=2:
    //   M1 T1: first 2 builds = [block, generator] (win). glider excluded.
    //   M1 T2: first 2 builds = [block, eater-1] (lose)
    //   M2 T1: first 2 builds = [generator] (only 1 build, lose)
    //   M2 T2: first 2 builds = [block, glider] (win). 2nd glider excluded.
    //   M3 T1: first 2 builds = [block, block] (draw)
    //   M3 T2: first 2 builds = [generator] (draw)
    //   M4 T1: first 2 builds = [gosper] (win)
    //   M4 T2: first 2 builds = [block] (lose)

    // Glider first-build:
    //   M1: T1 doesn't have glider in first 2. T2 doesn't have glider.
    //   M2: T2 has glider in first 2 (win) -> wins += 1, total += 1
    //   Others: no glider in first 2
    // Win rate = 1/1 = 1.0
    const results = computeTemplateWinRates(allMatches, defaultConfig);
    const glider = results.find((r) => r.templateId === 'glider');
    expect(glider).toBeDefined();
    expect(glider!.firstBuild.winRate).toBeCloseTo(1.0, 5);
    expect(glider!.firstBuild.total).toBe(1);
  });

  it('template built only as 3rd+ build is excluded', () => {
    // In M1, glider is T1's 3rd build. With firstNBuilds=2, it's excluded from first-build.
    // But glider appears in M2 T2's first 2 builds.
    // If we made a match where glider is ONLY a 3rd+ build, it would have total=0.
    const matchOnlyLateGlider = makeMatch(
      ['block', 'generator', 'glider'],
      ['block', 'eater-1'],
      1,
    );
    const results = computeTemplateWinRates(
      [matchOnlyLateGlider],
      defaultConfig,
    );
    const glider = results.find((r) => r.templateId === 'glider');
    expect(glider).toBeDefined();
    expect(glider!.firstBuild.total).toBe(0);
    // CI should be the zero-total default
    expect(glider!.firstBuild.ci.n).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Per-strategy tests
// ---------------------------------------------------------------------------

describe('computeStrategyWinRates', () => {
  const dummyFeatures: StrategyFeatureVector = {
    firstBuildTick: 5,
    buildDensity: 0.1,
    buildBurstiness: 0.5,
    avgResourcesAtBuild: 50,
    resourceEfficiency: 0.8,
    territoryGrowthRate: 0.05,
    finalTerritoryRatio: 0.4,
    uniqueTemplatesUsed: 3,
    templateEntropy: 1.2,
    avgDistanceToEnemy: 20,
    structureSpread: 10,
  };

  const assignments: StrategyAssignment[] = [
    // M1 T1: strategy "rush"
    {
      matchIndex: 0,
      teamId: 1,
      features: dummyFeatures,
      ruleLabel: 'rush',
      clusterId: 0,
    },
    // M1 T2: strategy "turtle"
    {
      matchIndex: 0,
      teamId: 2,
      features: dummyFeatures,
      ruleLabel: 'turtle',
      clusterId: 1,
    },
    // M2 T1: strategy "rush"
    {
      matchIndex: 1,
      teamId: 1,
      features: dummyFeatures,
      ruleLabel: 'rush',
      clusterId: 0,
    },
    // M2 T2: strategy "rush"
    {
      matchIndex: 1,
      teamId: 2,
      features: dummyFeatures,
      ruleLabel: 'rush',
      clusterId: 0,
    },
    // M3 T1: strategy "turtle"
    {
      matchIndex: 2,
      teamId: 1,
      features: dummyFeatures,
      ruleLabel: 'turtle',
      clusterId: 1,
    },
    // M3 T2: strategy "rush"
    {
      matchIndex: 2,
      teamId: 2,
      features: dummyFeatures,
      ruleLabel: 'rush',
      clusterId: 0,
    },
  ];

  it('computes strategy win rates with three attribution methods', () => {
    const threeMatches = [match1, match2, match3];
    const results = computeStrategyWinRates(
      threeMatches,
      assignments,
      defaultConfig,
    );

    expect(results.length).toBeGreaterThan(0);
    for (const sr of results) {
      expect(sr).toHaveProperty('presence');
      expect(sr).toHaveProperty('usageWeighted');
      expect(sr).toHaveProperty('firstBuild');
      expect(sr.presence).toHaveProperty('winRate');
      expect(sr.presence).toHaveProperty('ci');
    }
  });

  it('groups by strategy label for presence-based', () => {
    // rush appearances:
    //   M1 T1: rush (win) -> 1 win
    //   M2 T1: rush (lose) -> 0 wins
    //   M2 T2: rush (win) -> 1 win
    //   M3 T2: rush (draw) -> 0.5 wins
    // Total presence: wins = 2.5, total = 4
    // Win rate = 2.5 / 4 = 0.625
    const threeMatches = [match1, match2, match3];
    const results = computeStrategyWinRates(
      threeMatches,
      assignments,
      defaultConfig,
    );
    const rush = results.find((r) => r.strategyId === 'rush');
    expect(rush).toBeDefined();
    expect(rush!.presence.winRate).toBeCloseTo(0.625, 5);
    expect(rush!.presence.total).toBe(4);
  });

  it('computes turtle strategy win rates correctly', () => {
    // turtle appearances:
    //   M1 T2: turtle (lose) -> 0 wins
    //   M3 T1: turtle (draw) -> 0.5 wins
    // Total presence: wins = 0.5, total = 2
    // Win rate = 0.5 / 2 = 0.25
    const threeMatches = [match1, match2, match3];
    const results = computeStrategyWinRates(
      threeMatches,
      assignments,
      defaultConfig,
    );
    const turtle = results.find((r) => r.strategyId === 'turtle');
    expect(turtle).toBeDefined();
    expect(turtle!.presence.winRate).toBeCloseTo(0.25, 5);
    expect(turtle!.presence.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('computeTemplateWinRates — edge cases', () => {
  it('returns empty array for empty matches', () => {
    const results = computeTemplateWinRates([], defaultConfig);
    expect(results).toEqual([]);
  });

  it('handles matches with no build actions', () => {
    const noBuildsMatch: ParsedMatch = {
      header: makeHeader(),
      ticks: [makeTick(1, [])],
      outcome: makeOutcome(1),
    };
    const results = computeTemplateWinRates([noBuildsMatch], defaultConfig);
    // All templates should have zero totals
    for (const wr of results) {
      expect(wr.presence.total).toBe(0);
      expect(wr.usageWeighted.total).toBe(0);
      expect(wr.firstBuild.total).toBe(0);
    }
  });

  it('skips actions with missing templateId', () => {
    const actionsWithMissing: TickActionRecord[] = [
      makeAction(1, 'block'),
      {
        teamId: 1,
        actionType: 'build',
        // no templateId
        result: 'applied',
      },
      makeAction(2, 'glider'),
    ];

    const matchWithMissing: ParsedMatch = {
      header: makeHeader(),
      ticks: [makeTick(1, actionsWithMissing)],
      outcome: makeOutcome(1),
    };

    // Should not throw
    const results = computeTemplateWinRates([matchWithMissing], defaultConfig);
    const block = results.find((r) => r.templateId === 'block');
    expect(block).toBeDefined();
    expect(block!.presence.total).toBe(1);
  });

  it('skips non-applied build actions', () => {
    const actionsWithRejected: TickActionRecord[] = [
      makeAction(1, 'block', 'applied'),
      makeAction(1, 'glider', 'rejected'), // should be ignored
      makeAction(2, 'block', 'applied'),
    ];

    const matchWithRejected: ParsedMatch = {
      header: makeHeader(),
      ticks: [makeTick(1, actionsWithRejected)],
      outcome: makeOutcome(1),
    };

    const results = computeTemplateWinRates([matchWithRejected], defaultConfig);
    const glider = results.find((r) => r.templateId === 'glider');
    expect(glider).toBeDefined();
    // Glider was rejected, so it should not count
    expect(glider!.presence.total).toBe(0);
  });
});
