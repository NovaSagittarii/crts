import { describe, expect, it } from 'vitest';
import type {
  GamePhaseRange,
  Glicko2Rating,
  ParsedMatch,
  RatedEntity,
  RatingPoolConfig,
  TemplateEncounter,
} from './types.js';
import { GLICKO2_DEFAULTS } from './glicko2-engine.js';
import { RatingPool, createRatingPools } from './rating-pool.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeEncounter(
  entityA: string,
  entityB: string,
  scoreA: number,
): TemplateEncounter {
  return {
    entityA,
    entityB,
    scoreA,
    scoreB: 1 - scoreA,
    weightA: Math.log(1 + 3),
    weightB: Math.log(1 + 2),
  };
}

function makePoolConfig(overrides?: Partial<RatingPoolConfig>): RatingPoolConfig {
  return {
    name: 'test-pool',
    entityType: 'individual',
    phase: 'full',
    tickRange: null,
    ...overrides,
  };
}

function makeParsedMatch(
  builds: Array<{ teamId: number; templateId: string; tick: number }>,
  winnerId: number | null,
): ParsedMatch {
  // Build tick records from the list of builds
  const tickMap = new Map<number, Array<{ teamId: number; templateId: string }>>();
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
      totalTicks: 200,
      winner: winnerId !== null ? { teamId: winnerId, coreHealth: 100 } : null,
      ranked: [
        { teamId: 0, coreHealth: winnerId === 0 ? 100 : 0 },
        { teamId: 1, coreHealth: winnerId === 1 ? 100 : 0 },
      ],
      isDraw: winnerId === null,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('RatingPool', () => {
  it('Test 1: single pool, single period — winners rate up, losers rate down', () => {
    const config = makePoolConfig();
    const pool = new RatingPool(config);

    // Entity A beats B and C; B beats C
    pool.addEncounters([
      makeEncounter('A', 'B', 1.0), // A wins vs B
      makeEncounter('A', 'C', 1.0), // A wins vs C
      makeEncounter('B', 'C', 1.0), // B wins vs C
    ]);
    pool.runUpdate();

    const entities = pool.getRatedEntities();
    const entityA = entities.find((e) => e.id === 'A')!;
    const entityB = entities.find((e) => e.id === 'B')!;
    const entityC = entities.find((e) => e.id === 'C')!;

    expect(entityA).toBeDefined();
    expect(entityB).toBeDefined();
    expect(entityC).toBeDefined();

    // A won everything: rating should go up
    expect(entityA.rating.rating).toBeGreaterThan(1500);
    // C lost everything: rating should go down
    expect(entityC.rating.rating).toBeLessThan(1500);
    // B has mixed results (1 win, 1 loss), rating near 1500 but ordering should be A > B > C
    expect(entityA.rating.rating).toBeGreaterThan(entityB.rating.rating);
    expect(entityB.rating.rating).toBeGreaterThan(entityC.rating.rating);
  });

  it('Test 2: entity with no encounters — RD increases, rating stays', () => {
    const config = makePoolConfig();
    const pool = new RatingPool(config);

    pool.registerEntity('solo');
    pool.addEncounters([
      makeEncounter('A', 'B', 1.0),
    ]);
    pool.runUpdate();

    const entities = pool.getRatedEntities();
    const solo = entities.find((e) => e.id === 'solo')!;

    expect(solo).toBeDefined();
    expect(solo.rating.rating).toBe(GLICKO2_DEFAULTS.initialRating);
    // RD should increase when no matches played
    expect(solo.rating.rd).toBeGreaterThan(GLICKO2_DEFAULTS.initialRd);
  });

  it('Test 3: provisional flagging — entities with RD > 150 are provisional', () => {
    const config = makePoolConfig();
    const pool = new RatingPool(config);

    // Fresh entities should have RD = 350 (initial) > 150 → provisional
    pool.addEncounters([makeEncounter('A', 'B', 1.0)]);
    pool.runUpdate();

    const entities = pool.getRatedEntities();
    // After one encounter, RD is still likely > 150 per Glicko-2 with initial RD = 350
    for (const entity of entities) {
      if (entity.rating.rd > 150) {
        expect(entity.provisional).toBe(true);
      } else {
        expect(entity.provisional).toBe(false);
      }
    }
    // With initial RD=350 and single match, all should be provisional
    expect(entities.every((e) => e.provisional)).toBe(true);
  });

  it('Test 4: createRatingPools default — creates 5 pools per D-02/D-09', () => {
    const pools = createRatingPools();

    expect(pools).toHaveLength(5);

    const names = pools.map((p) => p.config.name);
    expect(names).toContain('individual-early');
    expect(names).toContain('individual-mid');
    expect(names).toContain('individual-late');
    expect(names).toContain('pairwise-full');
    expect(names).toContain('frequent-set-full');

    // Check entity types
    const individual = pools.filter((p) => p.config.entityType === 'individual');
    expect(individual).toHaveLength(3);
    const pairwise = pools.filter((p) => p.config.entityType === 'pairwise');
    expect(pairwise).toHaveLength(1);
    const frequentSet = pools.filter((p) => p.config.entityType === 'frequent-set');
    expect(frequentSet).toHaveLength(1);
  });

  it('Test 5: createRatingPools with perPhaseCombos — creates 9 pools', () => {
    const pools = createRatingPools({ perPhaseCombos: true });

    expect(pools).toHaveLength(9);

    const names = pools.map((p) => p.config.name);
    // 3 individual phase pools
    expect(names).toContain('individual-early');
    expect(names).toContain('individual-mid');
    expect(names).toContain('individual-late');
    // 3 pairwise phase pools
    expect(names).toContain('pairwise-early');
    expect(names).toContain('pairwise-mid');
    expect(names).toContain('pairwise-late');
    // 3 frequent-set phase pools
    expect(names).toContain('frequent-set-early');
    expect(names).toContain('frequent-set-mid');
    expect(names).toContain('frequent-set-late');
  });

  it('Test 6: processMatches — extracts encounters, registers entities, runs update, returns RatedEntity[]', () => {
    const config = makePoolConfig({
      name: 'individual-early',
      entityType: 'individual',
      phase: 'early',
      tickRange: { phase: 'early', start: 0, end: 200 },
    });
    const pool = new RatingPool(config);

    const match = makeParsedMatch(
      [
        { teamId: 0, templateId: 'block', tick: 50 },
        { teamId: 0, templateId: 'glider', tick: 100 },
        { teamId: 1, templateId: 'generator', tick: 80 },
      ],
      0, // team 0 wins
    );

    const rated = pool.processMatches([match]);

    expect(rated.length).toBeGreaterThan(0);
    const ids = rated.map((r) => r.id);
    expect(ids).toContain('block');
    expect(ids).toContain('glider');
    expect(ids).toContain('generator');

    // Winner templates should rate higher
    const block = rated.find((r) => r.id === 'block')!;
    const generator = rated.find((r) => r.id === 'generator')!;
    expect(block.rating.rating).toBeGreaterThan(1500);
    expect(generator.rating.rating).toBeLessThan(1500);

    // All should have entityType and phase set
    for (const entity of rated) {
      expect(entity.entityType).toBe('individual');
      expect(entity.phase).toBe('early');
    }
  });

  it('Test 7: batch semantics — all entities use pre-update opponent ratings', () => {
    const config = makePoolConfig();
    const pool = new RatingPool(config);

    // If A->B->C->A chain: A beats B, B beats C, C beats A
    // With batch semantics, all should use 1500 as opponent rating
    pool.addEncounters([
      makeEncounter('A', 'B', 1.0),
      makeEncounter('B', 'C', 1.0),
      makeEncounter('C', 'A', 1.0),
    ]);
    pool.runUpdate();

    const entities = pool.getRatedEntities();
    const rA = entities.find((e) => e.id === 'A')!;
    const rB = entities.find((e) => e.id === 'B')!;
    const rC = entities.find((e) => e.id === 'C')!;

    // With batch update: each entity has 1 win + 1 loss against opponents with
    // the SAME pre-update rating (1500). So they should all end up at similar ratings.
    // If sequential (non-batch), B's opponent rating for C would differ.
    const ratings = [rA.rating.rating, rB.rating.rating, rC.rating.rating];
    const maxDiff = Math.max(...ratings) - Math.min(...ratings);

    // In batch update with symmetric matchups, ratings should be nearly identical
    expect(maxDiff).toBeLessThan(1); // very close (all should be at 1500)
  });

  it('Test 8: pickRate — equals matchCount / totalMatches', () => {
    const config = makePoolConfig();
    const pool = new RatingPool(config);

    // A participates in 3 encounters, B in 2, C in 1 (out of 3 total)
    pool.addEncounters([
      makeEncounter('A', 'B', 1.0),
      makeEncounter('A', 'C', 0.5),
      makeEncounter('A', 'B', 1.0),
    ]);
    pool.runUpdate();

    const entities = pool.getRatedEntities();
    const entityA = entities.find((e) => e.id === 'A')!;
    const entityB = entities.find((e) => e.id === 'B')!;
    const entityC = entities.find((e) => e.id === 'C')!;

    // A appears in all 3 encounters
    expect(entityA.matchCount).toBe(3);
    expect(entityA.pickRate).toBeCloseTo(3 / 3);

    // B appears in 2 encounters
    expect(entityB.matchCount).toBe(2);
    expect(entityB.pickRate).toBeCloseTo(2 / 3);

    // C appears in 1 encounter
    expect(entityC.matchCount).toBe(1);
    expect(entityC.pickRate).toBeCloseTo(1 / 3);
  });
});
