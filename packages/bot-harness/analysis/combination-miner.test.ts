import { describe, expect, it } from 'vitest';

import {
  mineFrequentSets,
  minePairwiseCombinations,
} from './combination-miner.js';
import type { ParsedMatch } from './types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeParsedMatch(
  builds: Array<{ teamId: number; templateId: string; tick: number }>,
  winnerId: number | null,
): ParsedMatch {
  const tickMap = new Map<
    number,
    Array<{ teamId: number; templateId: string }>
  >();
  for (const b of builds) {
    if (!tickMap.has(b.tick)) tickMap.set(b.tick, []);
    tickMap.get(b.tick)!.push({ teamId: b.teamId, templateId: b.templateId });
  }

  const ticks = Array.from(tickMap.entries())
    .sort(([a], [b]) => a - b)
    .map(([tick, actions]) => ({
      type: 'tick' as const,
      tick,
      actions: actions.map((a) => ({
        teamId: a.teamId,
        actionType: 'build' as const,
        templateId: a.templateId,
        result: 'applied',
      })),
      economy: [],
      buildOutcomes: actions.length,
      destroyOutcomes: 0,
    }));

  return {
    header: {
      type: 'header',
      seed: 42,
      config: {
        seed: 42,
        gridWidth: 52,
        gridHeight: 52,
        maxTicks: 2000,
        hashCheckpointInterval: 50,
      },
      bots: ['bot-a', 'bot-b'],
      startedAt: '2026-01-01T00:00:00Z',
    },
    ticks,
    outcome: {
      type: 'outcome',
      totalTicks: 500,
      winner:
        winnerId !== null
          ? {
              rank: 1,
              teamId: winnerId,
              outcome: 'winner',
              finalCoreHp: 100,
              coreState: 'intact',
              territoryCellCount: 0,
              queuedBuildCount: 0,
              appliedBuildCount: 0,
              rejectedBuildCount: 0,
            }
          : null,
      ranked: [
        {
          rank: 1,
          teamId: 0,
          outcome: winnerId === 0 ? 'winner' : 'defeated',
          finalCoreHp: winnerId === 0 ? 100 : 0,
          coreState: winnerId === 0 ? 'intact' : 'destroyed',
          territoryCellCount: 0,
          queuedBuildCount: 0,
          appliedBuildCount: 0,
          rejectedBuildCount: 0,
        },
        {
          rank: 2,
          teamId: 1,
          outcome: winnerId === 1 ? 'winner' : 'defeated',
          finalCoreHp: winnerId === 1 ? 100 : 0,
          coreState: winnerId === 1 ? 'intact' : 'destroyed',
          territoryCellCount: 0,
          queuedBuildCount: 0,
          appliedBuildCount: 0,
          rejectedBuildCount: 0,
        },
      ],
      isDraw: winnerId === null,
    },
  };
}

// ---------------------------------------------------------------------------
// Combination miner tests
// ---------------------------------------------------------------------------

describe('minePairwiseCombinations', () => {
  it('Test 1: discovers all pairs from team templates', () => {
    const match = makeParsedMatch(
      [
        { teamId: 0, templateId: 'block', tick: 10 },
        { teamId: 0, templateId: 'glider', tick: 20 },
        { teamId: 0, templateId: 'generator', tick: 30 },
        { teamId: 1, templateId: 'eater-1', tick: 15 },
      ],
      0,
    );

    const result = minePairwiseCombinations([match]);

    // Team 0 has 3 templates, producing C(3,2) = 3 pairs
    // Team 1 has 1 template, producing 0 pairs
    // We need to find the pairs for team 0
    // Pairs: block+generator, block+glider, generator+glider (alphabetically sorted)

    // Result is Map<matchIndex, Map<teamId, Map<pairId, minBuildCount>>>
    expect(result.has(0)).toBe(true);
    const matchResult = result.get(0)!;
    expect(matchResult.has(0)).toBe(true);

    const team0Pairs = matchResult.get(0)!;
    expect(team0Pairs.size).toBe(3);
    expect(team0Pairs.has('block+generator')).toBe(true);
    expect(team0Pairs.has('block+glider')).toBe(true);
    expect(team0Pairs.has('generator+glider')).toBe(true);
  });

  it('Test 2: pair IDs are canonically sorted alphabetically', () => {
    const match = makeParsedMatch(
      [
        { teamId: 0, templateId: 'glider', tick: 10 },
        { teamId: 0, templateId: 'block', tick: 20 },
      ],
      0,
    );

    const result = minePairwiseCombinations([match]);
    const team0Pairs = result.get(0)!.get(0)!;

    // Should be "block+glider" not "glider+block"
    expect(team0Pairs.has('block+glider')).toBe(true);
    expect(team0Pairs.has('glider+block')).toBe(false);
  });

  it('Test 3: tick range filtering — only templates within range considered', () => {
    const match = makeParsedMatch(
      [
        { teamId: 0, templateId: 'block', tick: 50 },
        { teamId: 0, templateId: 'glider', tick: 100 },
        { teamId: 0, templateId: 'generator', tick: 300 }, // Outside early range
      ],
      0,
    );

    const result = minePairwiseCombinations([match], { start: 0, end: 200 });
    const team0Pairs = result.get(0)!.get(0)!;

    // Only block and glider are within range → 1 pair
    expect(team0Pairs.size).toBe(1);
    expect(team0Pairs.has('block+glider')).toBe(true);
    expect(team0Pairs.has('block+generator')).toBe(false);
  });
});

describe('mineFrequentSets', () => {
  it('Test 4: discovers frequent 3-template set above minSupport', () => {
    // Create 10 matches, 8 of which have {block, glider, generator} on team 0
    const matches: ParsedMatch[] = [];
    for (let i = 0; i < 10; i++) {
      const builds =
        i < 8
          ? [
              { teamId: 0, templateId: 'block', tick: 10 },
              { teamId: 0, templateId: 'glider', tick: 20 },
              { teamId: 0, templateId: 'generator', tick: 30 },
              { teamId: 1, templateId: 'eater-1', tick: 15 },
            ]
          : [
              { teamId: 0, templateId: 'block', tick: 10 },
              { teamId: 1, templateId: 'eater-1', tick: 15 },
            ];
      matches.push(makeParsedMatch(builds, 0));
    }

    const result = mineFrequentSets(matches, { minSupport: 5 });

    // The set {block, glider, generator} appears in 8 (match, team) pairs → support = 8
    const tripleSet = result.find((s) => s.setId === 'block+generator+glider');
    expect(tripleSet).toBeDefined();
    expect(tripleSet!.support).toBe(8);
    expect(tripleSet!.members).toEqual(['block', 'generator', 'glider']);
  });

  it('Test 5: maxSetSize=2 prevents 3+ template sets', () => {
    const matches: ParsedMatch[] = [];
    for (let i = 0; i < 10; i++) {
      matches.push(
        makeParsedMatch(
          [
            { teamId: 0, templateId: 'block', tick: 10 },
            { teamId: 0, templateId: 'glider', tick: 20 },
            { teamId: 0, templateId: 'generator', tick: 30 },
            { teamId: 1, templateId: 'eater-1', tick: 15 },
          ],
          0,
        ),
      );
    }

    const result = mineFrequentSets(matches, { minSupport: 5, maxSetSize: 2 });

    // No sets of size 3 should exist
    const tripleSets = result.filter((s) => s.members.length >= 3);
    expect(tripleSets).toHaveLength(0);

    // But pairs should exist
    const pairSets = result.filter((s) => s.members.length === 2);
    expect(pairSets.length).toBeGreaterThan(0);
  });

  it('Test 6: sets below minSupport are excluded', () => {
    const matches: ParsedMatch[] = [];
    // 3 matches with block+glider (below minSupport=5)
    for (let i = 0; i < 3; i++) {
      matches.push(
        makeParsedMatch(
          [
            { teamId: 0, templateId: 'block', tick: 10 },
            { teamId: 0, templateId: 'glider', tick: 20 },
            { teamId: 1, templateId: 'eater-1', tick: 15 },
          ],
          0,
        ),
      );
    }

    const result = mineFrequentSets(matches, { minSupport: 5 });

    // block+glider appears only in 3 (match, team) pairs → below minSupport=5
    expect(result).toHaveLength(0);
  });
});
