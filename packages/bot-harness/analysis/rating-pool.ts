/**
 * Rating pool management with game-phase separation for Glicko-2 ratings.
 *
 * Organizes entities into independent rating pools per game phase and entity
 * type. Each pool maintains its own entity state, processes encounters, and
 * runs batch Glicko-2 updates using pre-update snapshots for opponent ratings
 * (no cross-entity contamination within a batch).
 *
 * Per D-02: Individual templates get 3 pools (early/mid/late).
 * Per D-09: Combination ratings default to 1 pool (full match).
 */

import type {
  GamePhaseRange,
  Glicko2Rating,
  ParsedMatch,
  RatedEntity,
  RatingEntityType,
  RatingPoolConfig,
  TemplateEncounter,
} from './types.js';
import { GLICKO2_DEFAULTS, updateRating } from './glicko2-engine.js';
import {
  extractTemplateEncounters,
  GAME_PHASE_DEFAULTS,
} from './encounter-extractor.js';
import type { MatchResult } from './types.js';

// ---------------------------------------------------------------------------
// RatingPool class
// ---------------------------------------------------------------------------

/**
 * Manages a single Glicko-2 rating pool: entity registration, encounter
 * collection, batch updates, and rated entity retrieval.
 */
export class RatingPool {
  readonly config: RatingPoolConfig;
  private readonly tau: number;

  private entities: Map<string, Glicko2Rating> = new Map();
  private entityMatchCounts: Map<string, number> = new Map();
  private totalMatchesProcessed: number = 0;
  private pendingEncounters: TemplateEncounter[] = [];

  constructor(config: RatingPoolConfig, tau: number = GLICKO2_DEFAULTS.tau) {
    this.config = config;
    this.tau = tau;
  }

  /**
   * Initialize entity with default Glicko-2 rating if not already registered.
   */
  registerEntity(id: string): void {
    if (!this.entities.has(id)) {
      this.entities.set(id, {
        rating: GLICKO2_DEFAULTS.initialRating,
        rd: GLICKO2_DEFAULTS.initialRd,
        volatility: GLICKO2_DEFAULTS.initialVolatility,
      });
      this.entityMatchCounts.set(id, 0);
    }
  }

  /**
   * Collect encounters for the current period. Registers entities as discovered.
   */
  addEncounters(encounters: TemplateEncounter[]): void {
    for (const enc of encounters) {
      this.registerEntity(enc.entityA);
      this.registerEntity(enc.entityB);
      this.pendingEncounters.push(enc);
    }
  }

  /**
   * Batch Glicko-2 update using pre-update rating snapshot for opponent lookups.
   *
   * CRITICAL: Before running updates, snapshot ALL entity ratings. During the
   * update loop, use the SNAPSHOT for opponent ratings, not the updated values.
   */
  runUpdate(): void {
    const encounters = this.pendingEncounters;
    this.pendingEncounters = [];

    if (encounters.length === 0 && this.entities.size === 0) {
      return;
    }

    // Snapshot pre-update ratings for batch semantics
    const preUpdateSnapshot = new Map<string, Glicko2Rating>();
    for (const [id, rating] of this.entities) {
      preUpdateSnapshot.set(id, { ...rating });
    }

    // Build per-entity encounter lists
    const entityEncounters = new Map<string, TemplateEncounter[]>();
    for (const id of this.entities.keys()) {
      entityEncounters.set(id, []);
    }

    for (const enc of encounters) {
      entityEncounters.get(enc.entityA)?.push(enc);
      entityEncounters.get(enc.entityB)?.push(enc);
    }

    // Update total matches processed (count unique encounters)
    this.totalMatchesProcessed += encounters.length;

    // Batch update: compute new ratings using pre-update snapshot for opponents
    const newRatings = new Map<string, Glicko2Rating>();

    for (const [entityId, currentRating] of this.entities) {
      const encs = entityEncounters.get(entityId) ?? [];
      const matchCount = encs.length;

      // Increment entity match count
      this.entityMatchCounts.set(
        entityId,
        (this.entityMatchCounts.get(entityId) ?? 0) + matchCount,
      );

      // Build MatchResult[] from pre-update snapshot
      const matchResults: MatchResult[] = [];
      for (const enc of encs) {
        const isEntityA = enc.entityA === entityId;
        const opponentId = isEntityA ? enc.entityB : enc.entityA;
        const opponentRating = preUpdateSnapshot.get(opponentId);

        if (opponentRating) {
          matchResults.push({
            opponentRating: opponentRating.rating,
            opponentRd: opponentRating.rd,
            score: isEntityA ? enc.scoreA : enc.scoreB,
          });
        }
      }

      // Call updateRating with current entity rating and accumulated matches
      const updatedRating = updateRating(currentRating, matchResults, this.tau);
      newRatings.set(entityId, updatedRating);
    }

    // Replace entity map with new ratings (batch complete)
    this.entities = newRatings;
  }

  /**
   * Returns sorted array of RatedEntity objects with provisional flag,
   * pickRate, and empty outlierFlags.
   */
  getRatedEntities(): RatedEntity[] {
    const result: RatedEntity[] = [];
    const totalMatches = this.totalMatchesProcessed;

    for (const [id, rating] of this.entities) {
      const matchCount = this.entityMatchCounts.get(id) ?? 0;

      result.push({
        id,
        name: id,
        entityType: this.config.entityType,
        phase: this.config.phase,
        rating: { ...rating },
        provisional: rating.rd > 150,
        matchCount,
        pickRate: totalMatches > 0 ? matchCount / totalMatches : 0,
        outlierFlags: [],
      });
    }

    // Sort by rating descending
    result.sort((a, b) => b.rating.rating - a.rating.rating);
    return result;
  }

  /**
   * Convenience method: extract encounters for this pool's game phase,
   * register entities, run update, and return rated entities.
   */
  processMatches(matches: ParsedMatch[]): RatedEntity[] {
    const tickRange = this.config.tickRange ?? undefined;

    for (const match of matches) {
      const encounters = extractTemplateEncounters(
        match,
        tickRange
          ? { start: tickRange.start, end: tickRange.end }
          : undefined,
      );
      this.addEncounters(encounters);
    }

    this.runUpdate();
    return this.getRatedEntities();
  }
}

// ---------------------------------------------------------------------------
// Pool factory
// ---------------------------------------------------------------------------

/**
 * Create the standard set of rating pools per D-02 and D-09.
 *
 * Default (5 pools):
 * - 3 individual pools: individual-early, individual-mid, individual-late
 * - 1 pairwise pool: pairwise-full
 * - 1 frequent-set pool: frequent-set-full
 *
 * With perPhaseCombos (9 pools):
 * - 3 individual pools + 3 pairwise pools + 3 frequent-set pools
 */
export function createRatingPools(
  options?: { perPhaseCombos?: boolean; tau?: number },
): RatingPool[] {
  const perPhaseCombos = options?.perPhaseCombos ?? false;
  const tau = options?.tau ?? GLICKO2_DEFAULTS.tau;

  const pools: RatingPool[] = [];

  // Create phase configs from GAME_PHASE_DEFAULTS
  const phases = GAME_PHASE_DEFAULTS;

  // 3 individual pools (always per-phase)
  for (const phase of phases) {
    pools.push(
      new RatingPool(
        {
          name: `individual-${phase.phase}`,
          entityType: 'individual',
          phase: phase.phase,
          tickRange: phase,
        },
        tau,
      ),
    );
  }

  if (perPhaseCombos) {
    // 3 pairwise pools (per-phase)
    for (const phase of phases) {
      pools.push(
        new RatingPool(
          {
            name: `pairwise-${phase.phase}`,
            entityType: 'pairwise',
            phase: phase.phase,
            tickRange: phase,
          },
          tau,
        ),
      );
    }

    // 3 frequent-set pools (per-phase)
    for (const phase of phases) {
      pools.push(
        new RatingPool(
          {
            name: `frequent-set-${phase.phase}`,
            entityType: 'frequent-set',
            phase: phase.phase,
            tickRange: phase,
          },
          tau,
        ),
      );
    }
  } else {
    // 1 pairwise pool (full match)
    pools.push(
      new RatingPool(
        {
          name: 'pairwise-full',
          entityType: 'pairwise',
          phase: 'full',
          tickRange: null,
        },
        tau,
      ),
    );

    // 1 frequent-set pool (full match)
    pools.push(
      new RatingPool(
        {
          name: 'frequent-set-full',
          entityType: 'frequent-set',
          phase: 'full',
          tickRange: null,
        },
        tau,
      ),
    );
  }

  return pools;
}
