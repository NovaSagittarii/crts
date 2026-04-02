import { describe, expect, it } from 'vitest';

import type { MatchHeader, MatchOutcomeRecord, TickRecord } from '../types.js';
import {
  GAME_PHASE_DEFAULTS,
  extractCombinationEncounters,
  extractTemplateEncounters,
} from './encounter-extractor.js';
import type { ParsedMatch } from './types.js';

// ---------------------------------------------------------------------------
// Test fixture helpers
// ---------------------------------------------------------------------------

function makeHeader(overrides?: Partial<MatchHeader>): MatchHeader {
  return {
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
    ...overrides,
  };
}

function makeBuildAction(
  teamId: number,
  templateId: string,
  tick: number,
): {
  teamId: number;
  actionType: 'build';
  templateId: string;
  result: string;
  x: number;
  y: number;
} {
  return {
    teamId,
    actionType: 'build',
    templateId,
    result: 'applied',
    x: tick,
    y: 0,
  };
}

function makeTick(
  tick: number,
  actions: ReturnType<typeof makeBuildAction>[],
): TickRecord {
  return {
    type: 'tick',
    tick,
    actions,
    economy: [],
    buildOutcomes: actions.length,
    destroyOutcomes: 0,
  };
}

function makeOutcome(
  winnerId: number | null,
  totalTicks: number = 500,
): MatchOutcomeRecord {
  if (winnerId === null) {
    // Draw
    return {
      type: 'outcome',
      totalTicks,
      winner: null,
      isDraw: true,
      ranked: [
        {
          rank: 1,
          teamId: 0,
          outcome: 'defeated',
          finalCoreHp: 50,
          coreState: 'intact',
          territoryCellCount: 100,
          queuedBuildCount: 0,
          appliedBuildCount: 0,
          rejectedBuildCount: 0,
        },
        {
          rank: 1,
          teamId: 1,
          outcome: 'defeated',
          finalCoreHp: 50,
          coreState: 'intact',
          territoryCellCount: 100,
          queuedBuildCount: 0,
          appliedBuildCount: 0,
          rejectedBuildCount: 0,
        },
      ],
    };
  }

  const loserId = winnerId === 0 ? 1 : 0;
  return {
    type: 'outcome',
    totalTicks,
    winner: {
      rank: 1,
      teamId: winnerId,
      outcome: 'winner',
      finalCoreHp: 100,
      coreState: 'intact',
      territoryCellCount: 200,
      queuedBuildCount: 0,
      appliedBuildCount: 0,
      rejectedBuildCount: 0,
    },
    isDraw: false,
    ranked: [
      {
        rank: 1,
        teamId: winnerId,
        outcome: 'winner',
        finalCoreHp: 100,
        coreState: 'intact',
        territoryCellCount: 200,
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
        territoryCellCount: 50,
        queuedBuildCount: 0,
        appliedBuildCount: 0,
        rejectedBuildCount: 0,
      },
    ],
  };
}

function makeMatch(
  ticks: TickRecord[],
  outcome: MatchOutcomeRecord,
): ParsedMatch {
  return {
    header: makeHeader(),
    ticks,
    outcome,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('encounter-extractor', () => {
  describe('GAME_PHASE_DEFAULTS', () => {
    it('exports early/mid/late phase boundaries', () => {
      expect(GAME_PHASE_DEFAULTS).toHaveLength(3);

      const early = GAME_PHASE_DEFAULTS.find((p) => p.phase === 'early');
      expect(early).toBeDefined();
      expect(early!.start).toBe(0);
      expect(early!.end).toBe(200);

      const mid = GAME_PHASE_DEFAULTS.find((p) => p.phase === 'mid');
      expect(mid).toBeDefined();
      expect(mid!.start).toBe(200);
      expect(mid!.end).toBe(600);

      const late = GAME_PHASE_DEFAULTS.find((p) => p.phase === 'late');
      expect(late).toBeDefined();
      expect(late!.start).toBe(600);
      expect(late!.end).toBe(Infinity);
    });
  });

  describe('extractTemplateEncounters', () => {
    it('produces cross-product encounters from a 2-team match', () => {
      // Team 0 wins with {block: 3, glider: 1}, team 1 loses with {generator: 2}
      const ticks = [
        makeTick(10, [
          makeBuildAction(0, 'block', 10),
          makeBuildAction(0, 'block', 10),
          makeBuildAction(1, 'generator', 10),
        ]),
        makeTick(50, [
          makeBuildAction(0, 'block', 50),
          makeBuildAction(0, 'glider', 50),
          makeBuildAction(1, 'generator', 50),
        ]),
      ];

      const match = makeMatch(ticks, makeOutcome(0));
      const encounters = extractTemplateEncounters(match);

      // Cross-product: 2 winner templates x 1 loser template x 2 directions = 4 encounters
      expect(encounters).toHaveLength(4);

      // block (team 0, winner) vs generator (team 1, loser)
      const blockVsGen = encounters.find(
        (e) => e.entityA === 'block' && e.entityB === 'generator',
      );
      expect(blockVsGen).toBeDefined();
      expect(blockVsGen!.scoreA).toBe(1.0);
      expect(blockVsGen!.scoreB).toBe(0.0);
      // block built 3 times: weight = log(1 + 3) = log(4) ~ 1.386
      expect(blockVsGen!.weightA).toBeCloseTo(Math.log(4), 5);
      // generator built 2 times: weight = log(1 + 2) = log(3) ~ 1.099
      expect(blockVsGen!.weightB).toBeCloseTo(Math.log(3), 5);

      // glider (team 0, winner) vs generator (team 1, loser)
      const gliderVsGen = encounters.find(
        (e) => e.entityA === 'glider' && e.entityB === 'generator',
      );
      expect(gliderVsGen).toBeDefined();
      expect(gliderVsGen!.scoreA).toBe(1.0);
      expect(gliderVsGen!.scoreB).toBe(0.0);
      // glider built 1 time: weight = log(1 + 1) = log(2) ~ 0.693
      expect(gliderVsGen!.weightA).toBeCloseTo(Math.log(2), 5);

      // generator (team 1, loser) vs block (team 0, winner) -- reverse direction
      const genVsBlock = encounters.find(
        (e) => e.entityA === 'generator' && e.entityB === 'block',
      );
      expect(genVsBlock).toBeDefined();
      expect(genVsBlock!.scoreA).toBe(0.0);
      expect(genVsBlock!.scoreB).toBe(1.0);

      // generator vs glider (reverse)
      const genVsGlider = encounters.find(
        (e) => e.entityA === 'generator' && e.entityB === 'glider',
      );
      expect(genVsGlider).toBeDefined();
      expect(genVsGlider!.scoreA).toBe(0.0);
      expect(genVsGlider!.scoreB).toBe(1.0);
    });

    it('filters builds by tick range', () => {
      // Builds at tick 10 (within range) and tick 300 (outside range)
      const ticks = [
        makeTick(10, [
          makeBuildAction(0, 'block', 10),
          makeBuildAction(1, 'generator', 10),
        ]),
        makeTick(300, [
          makeBuildAction(0, 'glider', 300),
          makeBuildAction(1, 'eater-1', 300),
        ]),
      ];

      const match = makeMatch(ticks, makeOutcome(0));
      // Only ticks 0-199
      const encounters = extractTemplateEncounters(match, {
        start: 0,
        end: 200,
      });

      // Only block vs generator (builds at tick 10), 2 directions
      expect(encounters).toHaveLength(2);

      const templates = encounters
        .map((e) => `${e.entityA}-${e.entityB}`)
        .sort();
      expect(templates).toEqual(['block-generator', 'generator-block']);
    });

    it('produces 0.5 scores for draw matches', () => {
      const ticks = [
        makeTick(10, [
          makeBuildAction(0, 'block', 10),
          makeBuildAction(1, 'generator', 10),
        ]),
      ];

      const match = makeMatch(ticks, makeOutcome(null));
      const encounters = extractTemplateEncounters(match);

      // All encounters should have score 0.5
      for (const enc of encounters) {
        expect(enc.scoreA).toBe(0.5);
        expect(enc.scoreB).toBe(0.5);
      }
    });

    it('preserves self-encounters when same template on both teams', () => {
      const ticks = [
        makeTick(10, [
          makeBuildAction(0, 'block', 10),
          makeBuildAction(1, 'block', 10),
        ]),
      ];

      const match = makeMatch(ticks, makeOutcome(0));
      const encounters = extractTemplateEncounters(match);

      // block vs block -- both directions
      expect(encounters).toHaveLength(2);
      expect(encounters[0].entityA).toBe('block');
      expect(encounters[0].entityB).toBe('block');
    });

    it('returns zero encounters when tick range has no builds', () => {
      const ticks = [
        makeTick(300, [
          makeBuildAction(0, 'block', 300),
          makeBuildAction(1, 'generator', 300),
        ]),
      ];

      const match = makeMatch(ticks, makeOutcome(0));
      const encounters = extractTemplateEncounters(match, {
        start: 0,
        end: 200,
      });

      expect(encounters).toHaveLength(0);
    });

    it('ignores non-build and non-applied actions', () => {
      const ticks: TickRecord[] = [
        {
          type: 'tick',
          tick: 10,
          actions: [
            {
              teamId: 0,
              actionType: 'destroy',
              result: 'applied',
              structureKey: 'key1',
            },
            {
              teamId: 0,
              actionType: 'build',
              templateId: 'block',
              result: 'rejected',
              x: 0,
              y: 0,
            },
            makeBuildAction(0, 'glider', 10),
            makeBuildAction(1, 'generator', 10),
          ],
          economy: [],
          buildOutcomes: 1,
          destroyOutcomes: 1,
        },
      ];

      const match = makeMatch(ticks, makeOutcome(0));
      const encounters = extractTemplateEncounters(match);

      // Only glider vs generator (2 directions) -- destroy and rejected build are ignored
      expect(encounters).toHaveLength(2);
      const templates = encounters.map((e) => e.entityA).sort();
      expect(templates).toEqual(['generator', 'glider']);
    });
  });

  describe('extractCombinationEncounters', () => {
    it('produces pairwise combo encounters with min-member-count weighting', () => {
      // Team 0 wins with {block: 3, glider: 1}, team 1 loses with {generator: 2, eater-1: 1}
      const ticks = [
        makeTick(10, [
          makeBuildAction(0, 'block', 10),
          makeBuildAction(0, 'block', 10),
          makeBuildAction(0, 'block', 10),
          makeBuildAction(0, 'glider', 10),
          makeBuildAction(1, 'generator', 10),
          makeBuildAction(1, 'generator', 10),
          makeBuildAction(1, 'eater-1', 10),
        ]),
      ];

      const match = makeMatch(ticks, makeOutcome(0));

      // Pre-computed combination sets
      const combinations = new Map<number, Set<string>>();
      combinations.set(0, new Set(['block+glider']));
      combinations.set(1, new Set(['eater-1+generator']));

      const encounters = extractCombinationEncounters(match, combinations);

      // 1 combo per team, 2 directions = 2 encounters
      expect(encounters).toHaveLength(2);

      const winnerVsLoser = encounters.find(
        (e) => e.entityA === 'block+glider',
      );
      expect(winnerVsLoser).toBeDefined();
      expect(winnerVsLoser!.scoreA).toBe(1.0);
      // block+glider: min(3, 1) = 1 => weight = log(1 + 1) = log(2)
      expect(winnerVsLoser!.weightA).toBeCloseTo(Math.log(2), 5);
      // eater-1+generator: min(1, 2) = 1 => weight = log(1 + 1) = log(2)
      expect(winnerVsLoser!.weightB).toBeCloseTo(Math.log(2), 5);
    });

    it('respects tick-range filtering for combination encounters', () => {
      const ticks = [
        makeTick(10, [
          makeBuildAction(0, 'block', 10),
          makeBuildAction(0, 'glider', 10),
          makeBuildAction(1, 'generator', 10),
          makeBuildAction(1, 'eater-1', 10),
        ]),
        makeTick(500, [
          makeBuildAction(0, 'block', 500),
          makeBuildAction(1, 'generator', 500),
        ]),
      ];

      const match = makeMatch(ticks, makeOutcome(0));
      const combinations = new Map<number, Set<string>>();
      combinations.set(0, new Set(['block+glider']));
      combinations.set(1, new Set(['eater-1+generator']));

      // Only ticks 0-199
      const encounters = extractCombinationEncounters(match, combinations, {
        start: 0,
        end: 200,
      });

      // block+glider: block=1 (at tick 10 only), glider=1 => min=1 => weight=log(2)
      const enc = encounters.find((e) => e.entityA === 'block+glider');
      expect(enc).toBeDefined();
      expect(enc!.weightA).toBeCloseTo(Math.log(2), 5);
    });
  });
});
