import { describe, expect, it } from 'vitest';

import { assembleBalanceReport, DEFAULT_ANALYSIS_CONFIG } from './balance-report.js';
import type { AnalysisConfig, ParsedMatch } from './types.js';
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
    outcome: rank === 1 ? 'won' : 'lost',
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
      if (t === 5) {
        actions.push(buildAction(0, 'generator'));
        actions.push(buildAction(1, 'block'));
      }
      if (t === 10) {
        actions.push(buildAction(0, 'block'));
        actions.push(buildAction(1, 'generator'));
      }
      if (t === 20) {
        actions.push(buildAction(0, 'glider'));
        actions.push(buildAction(1, 'wall'));
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

// ── assembleBalanceReport ─────────────────────────────────────────────

describe('assembleBalanceReport', () => {
  it('produces a BalanceReport with all sections populated from synthetic matches', async () => {
    const matches = makeSyntheticMatches(10);
    const config: AnalysisConfig = { ...DEFAULT_ANALYSIS_CONFIG };

    const report = await assembleBalanceReport(matches, config, {
      matchDir: '/tmp/test-matches',
    });

    expect(report.metadata.matchDir).toBe('/tmp/test-matches');
    expect(report.metadata.matchCount).toBe(10);
    expect(report.metadata.generatedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
    expect(report.metadata.confidence).toBe(0.95);

    expect(report.templateWinRates.length).toBeGreaterThan(0);
    expect(report.strategyWinRates.length).toBeGreaterThan(0);
    expect(report.strategyAssignments.length).toBe(20); // 10 matches * 2 teams
    expect(report.clusters.k).toBeGreaterThan(0);
    expect(report.sequencePatterns).toBeDefined();
    expect(report.generations).toEqual([]); // No checkpointDir provided
  });

  it('produces a valid report when matches lack templateId (degraded but not crashed)', async () => {
    const ticks: TickRecord[] = [];
    for (let t = 0; t < 50; t++) {
      const economy = [economyEntry(0, 100, 10), economyEntry(1, 100, 10)];
      // Actions with no templateId
      const actions: TickActionRecord[] =
        t === 5 ? [{ teamId: 0, actionType: 'build', result: 'applied' }] : [];
      ticks.push(makeTick(t, actions, economy));
    }
    const match: ParsedMatch = {
      header: makeHeader(),
      ticks,
      outcome: makeOutcome(50, [makeRanked(0, 1, 500), makeRanked(1, 2, 200)]),
    };

    const report = await assembleBalanceReport([match], DEFAULT_ANALYSIS_CONFIG);

    expect(report.metadata.matchCount).toBe(1);
    // Should not throw; report is valid even if degraded
    expect(report.templateWinRates).toBeDefined();
    expect(report.strategyAssignments).toBeDefined();
  });

  it('includes correct metadata fields', async () => {
    const matches = makeSyntheticMatches(5);
    const before = new Date().toISOString();

    const report = await assembleBalanceReport(matches, DEFAULT_ANALYSIS_CONFIG, {
      matchDir: '/my/matches',
    });

    expect(report.metadata.matchDir).toBe('/my/matches');
    expect(report.metadata.matchCount).toBe(5);
    expect(report.metadata.confidence).toBe(0.95);
    // generatedAt should be a recent ISO timestamp
    const generatedAt = new Date(report.metadata.generatedAt);
    expect(generatedAt.getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime() - 1000,
    );
  });
});
