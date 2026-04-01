import type {
  AnalysisConfig,
  BalanceReport,
  ParsedMatch,
  RatingsReport,
} from './types.js';
import { classifyAll } from './strategy-classifier.js';
import { normalizeFeatures, kMeans } from './clustering.js';
import { computeTemplateWinRates, computeStrategyWinRates } from './win-rate-analyzer.js';
import { extractBuildSequence, mineSequencePatterns } from './sequence-miner.js';
import {
  discoverGenerations,
  splitMatchesByGeneration,
  computeGenerationData,
} from './generation-tracker.js';
import {
  computeRatingsParallel,
  computeRatingsSequential,
} from './rating-coordinator.js';
import type { RatingComputeOptions } from './rating-coordinator.js';

/** Default analysis configuration */
export const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  confidence: 0.95,
  minMatches: 10,
  maxPatternLength: 8,
  k: 4,
  firstNBuilds: 3,
};

/** Options for assembleBalanceReport */
export interface AssembleOptions {
  /** Directory containing match files (for metadata) */
  matchDir?: string;
  /** Directory containing checkpoint subdirectories for generational tracking */
  checkpointDir?: string;
  /** Checkpoint interval in episodes (used for splitMatchesByGeneration) */
  checkpointInterval?: number;
  /** Glicko-2 rating options. If provided, ratings are computed and included. */
  ratingsOptions?: RatingComputeOptions & { workers?: number; parallel?: boolean };
}

/**
 * Assemble a complete balance analysis report from parsed matches.
 *
 * Orchestrates all analysis modules into a single BalanceReport JSON:
 *   1. Strategy classification (classifyAll)
 *   2. Feature normalization and k-means clustering
 *   3. Template win rates (presence, usage-weighted, first-build)
 *   4. Strategy win rates
 *   5. Sequence pattern mining
 *   6. Generational tracking (if checkpointDir provided)
 *
 * This function does NOT import from training modules, keeping analysis
 * decoupled from the training runtime.
 *
 * @param matches - Parsed match data
 * @param config - Analysis configuration
 * @param options - Optional match directory and checkpoint directory paths
 * @returns Complete BalanceReport
 */
export async function assembleBalanceReport(
  matches: ParsedMatch[],
  config: AnalysisConfig,
  options?: AssembleOptions,
): Promise<BalanceReport> {
  // 1. Classify all teams across all matches
  const assignments = classifyAll(matches);

  // 2. Normalize features and run k-means clustering
  const featureVectors = assignments.map((a) => a.features);
  const normalizedData = normalizeFeatures(featureVectors);

  if (normalizedData.length > 0) {
    const effectiveK = Math.min(config.k, normalizedData.length);
    const clusterResult = kMeans(normalizedData, effectiveK, { seed: 42 });

    // Assign cluster IDs back to assignments
    for (let i = 0; i < assignments.length; i++) {
      assignments[i].clusterId = clusterResult.assignments[i] ?? -1;
    }
  }

  // 3. Compute template win rates
  const templateWinRates = computeTemplateWinRates(matches, config);

  // 4. Compute strategy win rates
  const strategyWinRates = computeStrategyWinRates(matches, assignments, config);

  // 5. Extract build sequences and mine patterns
  const sequences: string[][] = [];
  for (const match of matches) {
    const teamIds = match.outcome.ranked.map((r) => r.teamId);
    for (const teamId of teamIds) {
      const seq = extractBuildSequence(match, teamId);
      if (seq.length > 0) {
        sequences.push(seq);
      }
    }
  }

  const minSupport = Math.max(2, Math.floor(sequences.length * 0.05));
  const sequencePatterns = mineSequencePatterns(sequences, {
    minSupport,
    maxPatternLength: config.maxPatternLength,
  });

  // 6. Generational tracking (if checkpointDir provided)
  const generations = [];
  if (options?.checkpointDir) {
    const genBoundaries = await discoverGenerations(options.checkpointDir);

    if (genBoundaries.length > 0) {
      const checkpointInterval = options.checkpointInterval ?? 50;
      const matchFiles = matches.map((_, i) => `match-${String(i)}.ndjson`);
      const genMap = splitMatchesByGeneration(
        matches,
        matchFiles,
        genBoundaries,
        checkpointInterval,
      );

      for (const [genNum, genMatches] of genMap) {
        const boundary = genBoundaries.find((b) => b.generation === genNum);
        const episode = boundary?.episode ?? 0;

        // Filter assignments for matches in this generation
        const matchIndices = new Set<number>();
        for (const m of genMatches) {
          const idx = matches.indexOf(m);
          if (idx >= 0) matchIndices.add(idx);
        }
        const genAssignments = assignments.filter((a) =>
          matchIndices.has(a.matchIndex),
        );

        generations.push(
          computeGenerationData(
            genMatches,
            genNum,
            episode,
            genAssignments,
            config,
          ),
        );
      }

      // Sort generations by generation number
      generations.sort((a, b) => a.generation - b.generation);
    }
  }

  // 7. Get cluster result for the report
  const effectiveK = Math.min(config.k, normalizedData.length);
  const clusters =
    normalizedData.length > 0
      ? kMeans(normalizedData, effectiveK, { seed: 42 })
      : { centroids: [], assignments: [], k: 0, wcss: 0, iterations: 0 };

  // 8. Compute Glicko-2 ratings (if ratingsOptions provided)
  let ratings: RatingsReport | undefined;
  if (options?.ratingsOptions) {
    const rOpts = options.ratingsOptions;
    if (rOpts.parallel !== false) {
      ratings = await computeRatingsParallel(matches, rOpts);
    } else {
      ratings = await computeRatingsSequential(matches, rOpts);
    }
  }

  // Assemble the final report
  const report: BalanceReport = {
    metadata: {
      matchDir: options?.matchDir ?? 'unknown',
      matchCount: matches.length,
      generatedAt: new Date().toISOString(),
      confidence: config.confidence,
    },
    templateWinRates,
    strategyWinRates,
    strategyAssignments: assignments,
    clusters,
    sequencePatterns,
    generations,
  };

  if (ratings) {
    report.ratings = ratings;
  }

  return report;
}

/**
 * Compute only Glicko-2 ratings from match data (standalone function).
 *
 * Used by the `analyze ratings` CLI subcommand. Calls computeRatingsParallel
 * or computeRatingsSequential based on the parallel flag.
 *
 * @param matches - Parsed match data
 * @param options - Rating computation options
 * @returns RatingsReport with individual/pairwise/frequentSets/outliers
 */
export async function assembleRatingsReport(
  matches: ParsedMatch[],
  options: RatingComputeOptions & { workers?: number; parallel?: boolean },
): Promise<RatingsReport> {
  if (options.parallel !== false) {
    return computeRatingsParallel(matches, options);
  }
  return computeRatingsSequential(matches, options);
}
