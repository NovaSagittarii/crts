import { describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  discoverGenerations,
  splitMatchesByGeneration,
  computeGenerationData,
} from './generation-tracker.js';
import type { GenerationBoundary } from './generation-tracker.js';
import type {
  AnalysisConfig,
  ParsedMatch,
  StrategyAssignment,
  StrategyFeatureVector,
} from './types.js';
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

function makeMatch(tickCount: number = 50): ParsedMatch {
  const ticks: TickRecord[] = [];
  for (let t = 0; t < tickCount; t++) {
    const actions: TickActionRecord[] = [];
    const economy = [economyEntry(0, 100, 10), economyEntry(1, 100, 10)];
    if (t === 5) {
      actions.push(buildAction(0, 'generator'));
      actions.push(buildAction(1, 'block'));
    }
    if (t === 15) {
      actions.push(buildAction(0, 'block'));
      actions.push(buildAction(1, 'generator'));
    }
    ticks.push(makeTick(t, actions, economy));
  }
  return {
    header: makeHeader(),
    ticks,
    outcome: makeOutcome(tickCount, [
      makeRanked(0, 1, 500),
      makeRanked(1, 2, 200),
    ]),
  };
}

function makeFeatureVector(): StrategyFeatureVector {
  return {
    firstBuildTick: 5,
    buildDensity: 4.0,
    buildBurstiness: 10,
    avgResourcesAtBuild: 100,
    resourceEfficiency: 0.8,
    territoryGrowthRate: 1.0,
    finalTerritoryRatio: 0.7,
    uniqueTemplatesUsed: 2,
    templateEntropy: 1.0,
    avgDistanceToEnemy: 20,
    structureSpread: 5,
  };
}

const defaultConfig: AnalysisConfig = {
  confidence: 0.95,
  minMatches: 10,
  maxPatternLength: 8,
  k: 4,
  firstNBuilds: 3,
};

// ── discoverGenerations ───────────────────────────────────────────────

describe('discoverGenerations', () => {
  it('reads checkpoint-50/, checkpoint-100/, checkpoint-150/ and returns sorted boundaries', async () => {
    const dir = join(tmpdir(), `gen-test-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
    await mkdir(join(dir, 'checkpoint-100'), { recursive: true });
    await mkdir(join(dir, 'checkpoint-50'), { recursive: true });
    await mkdir(join(dir, 'checkpoint-150'), { recursive: true });

    const result = await discoverGenerations(dir);
    expect(result).toEqual([
      { generation: 1, episode: 50 },
      { generation: 2, episode: 100 },
      { generation: 3, episode: 150 },
    ]);
  });

  it('returns empty array when no checkpoint directories exist', async () => {
    const dir = join(tmpdir(), `gen-test-empty-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
    await mkdir(dir, { recursive: true });
    // Create a non-checkpoint file
    await writeFile(join(dir, 'config.json'), '{}');

    const result = await discoverGenerations(dir);
    expect(result).toEqual([]);
  });

  it('parses episode number from directory name "checkpoint-<N>"', async () => {
    const dir = join(tmpdir(), `gen-test-parse-${String(Date.now())}-${String(Math.random()).slice(2, 8)}`);
    await mkdir(join(dir, 'checkpoint-999'), { recursive: true });
    await mkdir(join(dir, 'checkpoint-1'), { recursive: true });

    const result = await discoverGenerations(dir);
    expect(result).toEqual([
      { generation: 1, episode: 1 },
      { generation: 2, episode: 999 },
    ]);
  });
});

// ── splitMatchesByGeneration ─────────────────────────────────────────

describe('splitMatchesByGeneration', () => {
  it('assigns matches to generations based on match index and checkpoint interval', () => {
    const matches = [makeMatch(), makeMatch(), makeMatch(), makeMatch()];
    const matchFiles = ['match-0.ndjson', 'match-1.ndjson', 'match-2.ndjson', 'match-3.ndjson'];
    const generations: GenerationBoundary[] = [
      { generation: 1, episode: 50 },
      { generation: 2, episode: 100 },
    ];

    // With checkpointInterval=50:
    // match 0 => matchIndex 0 * 50 = episode 0 => before gen 1 (episode 50) => generation 0
    // match 1 => matchIndex 1 * 50 = episode 50 => gen 1 (episode 50) => generation 1
    // match 2 => matchIndex 2 * 50 = episode 100 => gen 2 (episode 100) => generation 2
    // match 3 => matchIndex 3 * 50 = episode 150 => after gen 2 (episode 100) => generation 2
    const result = splitMatchesByGeneration(matches, matchFiles, generations, 50);

    expect(result.get(0)?.length).toBe(1);
    expect(result.get(1)?.length).toBe(1);
    expect(result.get(2)?.length).toBe(2);
  });

  it('assigns all matches to generation 0 when no generations provided', () => {
    const matches = [makeMatch(), makeMatch()];
    const matchFiles = ['match-0.ndjson', 'match-1.ndjson'];

    const result = splitMatchesByGeneration(matches, matchFiles, [], 50);

    expect(result.get(0)?.length).toBe(2);
  });
});

// ── computeGenerationData ────────────────────────────────────────────

describe('computeGenerationData', () => {
  it('computes strategy distribution counts per generation', () => {
    const matches = [makeMatch(), makeMatch()];
    const assignments: StrategyAssignment[] = [
      { matchIndex: 0, teamId: 0, features: makeFeatureVector(), ruleLabel: 'early-builder', clusterId: 0 },
      { matchIndex: 0, teamId: 1, features: makeFeatureVector(), ruleLabel: 'balanced', clusterId: 1 },
      { matchIndex: 1, teamId: 0, features: makeFeatureVector(), ruleLabel: 'early-builder', clusterId: 0 },
      { matchIndex: 1, teamId: 1, features: makeFeatureVector(), ruleLabel: 'early-builder', clusterId: 0 },
    ];

    const result = computeGenerationData(matches, 1, 50, assignments, defaultConfig);

    expect(result.generation).toBe(1);
    expect(result.episode).toBe(50);
    expect(result.matchCount).toBe(2);
    expect(result.strategyDistribution).toEqual({
      'early-builder': 3,
      'balanced': 1,
    });
    expect(result.templateWinRates.length).toBeGreaterThan(0);
  });
});
