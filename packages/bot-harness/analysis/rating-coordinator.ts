/**
 * Rating coordinator: orchestrates parallel and sequential Glicko-2
 * pool computation for the structure strength rating pipeline.
 *
 * Creates rating pools (individual per-phase, pairwise, frequent-set),
 * extracts encounters from match data, processes each pool, runs outlier
 * detection, and assembles the final RatingsReport.
 *
 * Supports two execution modes:
 * - Sequential: all pools processed in the main thread (testing/fallback)
 * - Parallel: pools dispatched to worker threads via _worker-shim.mjs
 */

import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { GLICKO2_DEFAULTS } from './glicko2-engine.js';
import {
  extractTemplateEncounters,
  extractCombinationEncounters,
  GAME_PHASE_DEFAULTS,
} from './encounter-extractor.js';
import { createRatingPools, RatingPool } from './rating-pool.js';
import { minePairwiseCombinations, mineFrequentSets } from './combination-miner.js';
import { detectOutliers } from './outlier-detector.js';
import type {
  ParsedMatch,
  RatedEntity,
  RatingsReport,
  TemplateEncounter,
} from './types.js';
import type { PoolResultMessage } from './rating-worker.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Options for rating computation */
export interface RatingComputeOptions {
  /** Glicko-2 tau parameter (default: 0.5) */
  tau?: number;
  /** Enable per-phase combination ratings (default: false) */
  perPhaseCombos?: boolean;
  /** Outlier SD threshold (default: 2.0) */
  sdThreshold?: number;
  /** Frequent-set minimum support (default: 5) */
  minSupport?: number;
  /** Frequent-set maximum size (default: 4) */
  maxSetSize?: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build encounters for each pool from match data.
 * Returns a Map of pool name -> TemplateEncounter[].
 */
function buildPoolEncounters(
  pools: RatingPool[],
  matches: ParsedMatch[],
  options: RatingComputeOptions,
): Map<string, TemplateEncounter[]> {
  const encounterMap = new Map<string, TemplateEncounter[]>();

  for (const pool of pools) {
    encounterMap.set(pool.config.name, []);
  }

  // Build encounters for individual pools
  const individualPools = pools.filter((p) => p.config.entityType === 'individual');
  for (const pool of individualPools) {
    const tickRange = pool.config.tickRange ?? undefined;
    const allEncounters: TemplateEncounter[] = [];

    for (const match of matches) {
      const encounters = extractTemplateEncounters(
        match,
        tickRange
          ? { start: tickRange.start, end: tickRange.end }
          : undefined,
      );
      allEncounters.push(...encounters);
    }

    encounterMap.set(pool.config.name, allEncounters);
  }

  // Build encounters for pairwise pools
  const pairwisePools = pools.filter((p) => p.config.entityType === 'pairwise');
  for (const pool of pairwisePools) {
    const tickRange = pool.config.tickRange ?? undefined;
    const pairData = minePairwiseCombinations(
      matches,
      tickRange ? { start: tickRange.start, end: tickRange.end } : undefined,
    );

    const allEncounters: TemplateEncounter[] = [];

    for (let matchIdx = 0; matchIdx < matches.length; matchIdx++) {
      const match = matches[matchIdx];
      const matchPairs = pairData.get(matchIdx);
      if (!matchPairs) continue;

      // Build combinations map: Map<teamId, Set<comboId>>
      const combinations = new Map<number, Set<string>>();
      for (const [teamId, pairMap] of matchPairs) {
        combinations.set(teamId, new Set(pairMap.keys()));
      }

      const encounters = extractCombinationEncounters(
        match,
        combinations,
        tickRange ? { start: tickRange.start, end: tickRange.end } : undefined,
      );
      allEncounters.push(...encounters);
    }

    encounterMap.set(pool.config.name, allEncounters);
  }

  // Build encounters for frequent-set pools
  const frequentSetPools = pools.filter((p) => p.config.entityType === 'frequent-set');
  for (const pool of frequentSetPools) {
    const tickRange = pool.config.tickRange ?? undefined;
    const frequentSets = mineFrequentSets(matches, {
      minSupport: options.minSupport ?? 5,
      maxSetSize: options.maxSetSize ?? 4,
      tickRange: tickRange ? { start: tickRange.start, end: tickRange.end } : undefined,
    });

    if (frequentSets.length === 0) {
      continue;
    }

    const allEncounters: TemplateEncounter[] = [];

    for (const match of matches) {
      // Build combinations map from frequent sets
      const combinations = new Map<number, Set<string>>();
      const teamIds = match.outcome.ranked.map((r) => r.teamId);

      for (const teamId of teamIds) {
        const teamCombos = new Set<string>();
        // Check which frequent sets are present for this team
        for (const tick of match.ticks) {
          if (tickRange && (tick.tick < tickRange.start || tick.tick >= tickRange.end)) {
            continue;
          }
          for (const action of tick.actions) {
            if (
              action.actionType === 'build' &&
              action.result === 'applied' &&
              action.templateId !== undefined &&
              action.teamId === teamId
            ) {
              // This template is used by this team
            }
          }
        }

        // Collect distinct templates for this team
        const teamTemplates = new Set<string>();
        for (const tick of match.ticks) {
          if (tickRange && (tick.tick < tickRange.start || tick.tick >= tickRange.end)) {
            continue;
          }
          for (const action of tick.actions) {
            if (
              action.actionType === 'build' &&
              action.result === 'applied' &&
              action.templateId !== undefined &&
              action.teamId === teamId
            ) {
              teamTemplates.add(action.templateId);
            }
          }
        }

        // Check which frequent sets are present
        for (const fs of frequentSets) {
          if (fs.members.every((m) => teamTemplates.has(m))) {
            teamCombos.add(fs.setId);
          }
        }

        if (teamCombos.size > 0) {
          combinations.set(teamId, teamCombos);
        }
      }

      if (combinations.size > 0) {
        const encounters = extractCombinationEncounters(
          match,
          combinations,
          tickRange ? { start: tickRange.start, end: tickRange.end } : undefined,
        );
        allEncounters.push(...encounters);
      }
    }

    encounterMap.set(pool.config.name, allEncounters);
  }

  return encounterMap;
}

/**
 * Assemble the RatingsReport from processed pools.
 */
function assembleReport(
  pools: RatingPool[],
  poolResults: Map<string, RatedEntity[]>,
  tau: number,
  sdThreshold: number,
): RatingsReport {
  // Get individual per-phase results
  const earlyEntities = poolResults.get('individual-early') ?? [];
  const midEntities = poolResults.get('individual-mid') ?? [];
  const lateEntities = poolResults.get('individual-late') ?? [];

  // Get pairwise and frequent-set results (may be from -full or per-phase)
  const pairwiseEntities: RatedEntity[] = [];
  const frequentSetEntities: RatedEntity[] = [];

  for (const [name, entities] of poolResults) {
    if (name.startsWith('pairwise-')) {
      pairwiseEntities.push(...entities);
    }
    if (name.startsWith('frequent-set-')) {
      frequentSetEntities.push(...entities);
    }
  }

  // Sort by rating descending
  pairwiseEntities.sort((a, b) => b.rating.rating - a.rating.rating);
  frequentSetEntities.sort((a, b) => b.rating.rating - a.rating.rating);

  // Run outlier detection per phase
  const earlyOutliers = detectOutliers(earlyEntities, { sdThreshold });
  const midOutliers = detectOutliers(midEntities, { sdThreshold });
  const lateOutliers = detectOutliers(lateEntities, { sdThreshold });

  // Run outlier detection on overall combined individual entities
  const allIndividual = [...earlyEntities, ...midEntities, ...lateEntities];
  const overallOutliers = detectOutliers(allIndividual, { sdThreshold });

  // Apply outlier flags back to the per-phase entities
  const earlyWithFlags = earlyOutliers;
  const midWithFlags = midOutliers;
  const lateWithFlags = lateOutliers;

  // Filter outlier results to only those with flags
  const earlyFlagged = earlyWithFlags.filter((e) => e.outlierFlags.length > 0);
  const midFlagged = midWithFlags.filter((e) => e.outlierFlags.length > 0);
  const lateFlagged = lateWithFlags.filter((e) => e.outlierFlags.length > 0);
  const overallFlagged = overallOutliers.filter((e) => e.outlierFlags.length > 0);

  return {
    hyperparameters: {
      initialRating: GLICKO2_DEFAULTS.initialRating,
      initialRd: GLICKO2_DEFAULTS.initialRd,
      initialVolatility: GLICKO2_DEFAULTS.initialVolatility,
      tau,
      phaseBoundaries: {
        earlyEnd: GAME_PHASE_DEFAULTS[0].end,
        midEnd: GAME_PHASE_DEFAULTS[1].end,
      },
    },
    individual: {
      early: earlyWithFlags,
      mid: midWithFlags,
      late: lateWithFlags,
    },
    pairwise: pairwiseEntities,
    frequentSets: frequentSetEntities,
    outliers: {
      perPhase: {
        early: earlyFlagged,
        mid: midFlagged,
        late: lateFlagged,
      },
      overall: overallFlagged,
    },
  };
}

// ---------------------------------------------------------------------------
// Sequential computation
// ---------------------------------------------------------------------------

/**
 * Compute Glicko-2 ratings sequentially (single-threaded).
 *
 * Creates rating pools, extracts encounters from match data,
 * processes each pool, runs outlier detection, and assembles
 * the final RatingsReport.
 *
 * Useful for testing and as fallback when worker overhead is not justified.
 */
export function computeRatingsSequential(
  matches: ParsedMatch[],
  options: RatingComputeOptions,
): Promise<RatingsReport> {
  const tau = options.tau ?? GLICKO2_DEFAULTS.tau;
  const sdThreshold = options.sdThreshold ?? 2.0;

  // Create pools
  const pools = createRatingPools({
    perPhaseCombos: options.perPhaseCombos,
    tau,
  });

  // Build encounters for each pool
  const encounterMap = buildPoolEncounters(pools, matches, options);

  // Process each pool sequentially
  const poolResults = new Map<string, RatedEntity[]>();

  for (const pool of pools) {
    const encounters = encounterMap.get(pool.config.name) ?? [];
    pool.addEncounters(encounters);
    pool.runUpdate();
    poolResults.set(pool.config.name, pool.getRatedEntities());
  }

  return Promise.resolve(assembleReport(pools, poolResults, tau, sdThreshold));
}

// ---------------------------------------------------------------------------
// Parallel computation
// ---------------------------------------------------------------------------

/**
 * Compute Glicko-2 ratings in parallel using worker threads.
 *
 * Dispatches pool computation to worker threads per D-05a. Falls back
 * to sequential computation if workers=1 or pool count <= 2.
 *
 * Worker count defaults to min(poolCount, os.cpus().length - 1, 4).
 */
export async function computeRatingsParallel(
  matches: ParsedMatch[],
  options: RatingComputeOptions & { workers?: number },
): Promise<RatingsReport> {
  const tau = options.tau ?? GLICKO2_DEFAULTS.tau;
  const sdThreshold = options.sdThreshold ?? 2.0;

  // Create pools
  const pools = createRatingPools({
    perPhaseCombos: options.perPhaseCombos,
    tau,
  });

  // Build encounters for each pool
  const encounterMap = buildPoolEncounters(pools, matches, options);

  // Determine worker count
  const poolCount = pools.length;
  const maxWorkers = options.workers ?? Math.min(poolCount, Math.max(1, cpus().length - 1), 4);

  // Fall back to sequential if not worth parallelizing
  if (maxWorkers <= 1 || poolCount <= 2) {
    return computeRatingsSequential(matches, options);
  }

  // Resolve worker paths
  const baseDir = typeof import.meta.dirname === 'string'
    ? import.meta.dirname
    : fileURLToPath(new URL('.', import.meta.url));
  const shimPath = resolve(baseDir, '_worker-shim.mjs');
  const workerTsPath = resolve(baseDir, 'rating-worker.ts');

  // Spawn workers and dispatch pools
  const poolResults = new Map<string, RatedEntity[]>();
  const poolQueue = [...pools];
  const activeWorkers: Worker[] = [];

  const processPool = (pool: RatingPool): Promise<{ name: string; entities: RatedEntity[] }> => {
    return new Promise((resolvePool, reject) => {
      const worker = new Worker(shimPath, {
        workerData: {
          _workerTsPath: workerTsPath,
        },
      });

      activeWorkers.push(worker);

      const encounters = encounterMap.get(pool.config.name) ?? [];

      const onMessage = (msg: PoolResultMessage): void => {
        if (msg.type === 'pool-result') {
          worker.removeListener('message', onMessage);
          worker.removeListener('error', onError);

          // Convert worker results back to RatedEntity[]
          const entities: RatedEntity[] = msg.entities.map((e) => ({
            id: e.id,
            name: e.id,
            entityType: pool.config.entityType,
            phase: pool.config.phase,
            rating: { ...e.rating },
            provisional: e.rating.rd > 150,
            matchCount: e.matchCount,
            pickRate: e.pickRate,
            outlierFlags: [],
          }));

          // Terminate worker after use
          worker.postMessage({ type: 'terminate' });

          resolvePool({ name: pool.config.name, entities });
        }
      };

      const onError = (err: Error): void => {
        worker.removeListener('message', onMessage);
        reject(err);
      };

      worker.on('message', onMessage);
      worker.on('error', onError);

      // Send pool data to worker
      worker.postMessage({
        type: 'compute-pool',
        poolConfig: {
          name: pool.config.name,
          entityType: pool.config.entityType,
          phase: pool.config.phase,
          tickRange: pool.config.tickRange,
        },
        entities: [],
        encounters: encounters.map((enc) => ({
          entityA: enc.entityA,
          entityB: enc.entityB,
          scoreA: enc.scoreA,
          scoreB: enc.scoreB,
          weightA: enc.weightA,
          weightB: enc.weightB,
        })),
        tau,
      });
    });
  };

  // Process pools with limited concurrency
  const concurrency = Math.min(maxWorkers, poolCount);
  const results: Array<{ name: string; entities: RatedEntity[] }> = [];

  // Simple concurrency-limited dispatch
  let nextPoolIdx = 0;

  const runNext = async (): Promise<void> => {
    while (nextPoolIdx < poolQueue.length) {
      const idx = nextPoolIdx++;
      const pool = poolQueue[idx];
      const result = await processPool(pool);
      results.push(result);
    }
  };

  const workers: Promise<void>[] = [];
  for (let i = 0; i < concurrency; i++) {
    workers.push(runNext());
  }

  await Promise.all(workers);

  // Collect results
  for (const result of results) {
    poolResults.set(result.name, result.entities);
  }

  // Run outlier detection in main thread (needs full result set)
  return assembleReport(pools, poolResults, tau, sdThreshold);
}
