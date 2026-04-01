import { readdir } from 'node:fs/promises';

import type {
  AnalysisConfig,
  GenerationData,
  ParsedMatch,
  StrategyAssignment,
} from './types.js';
import { computeTemplateWinRates } from './win-rate-analyzer.js';

/** Checkpoint boundary mapping a generation index to its episode number */
export interface GenerationBoundary {
  generation: number;
  episode: number;
}

/** Pattern for checkpoint directory names: checkpoint-<episode> */
const CHECKPOINT_PATTERN = /^checkpoint-(\d+)$/;

/**
 * Discover generation boundaries from a checkpoints directory.
 *
 * Reads the directory for subdirectories matching `checkpoint-<N>` and
 * returns sorted boundaries with 1-based generation numbers.
 *
 * @param checkpointDir - Path to the checkpoints directory
 * @returns Sorted array of generation boundaries
 */
export async function discoverGenerations(
  checkpointDir: string,
): Promise<GenerationBoundary[]> {
  const entries = await readdir(checkpointDir, { withFileTypes: true });

  const boundaries: GenerationBoundary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = CHECKPOINT_PATTERN.exec(entry.name);
    if (match) {
      const episode = parseInt(match[1], 10);
      boundaries.push({ generation: 0, episode }); // generation assigned after sort
    }
  }

  // Sort by episode ascending
  boundaries.sort((a, b) => a.episode - b.episode);

  // Assign 1-based generation numbers
  for (let i = 0; i < boundaries.length; i++) {
    boundaries[i].generation = i + 1;
  }

  return boundaries;
}

/**
 * Split matches into generations based on match index and checkpoint interval.
 *
 * Match index i corresponds to virtual episode `i * checkpointInterval`.
 * It belongs to the last generation whose episode <= that virtual episode,
 * or generation 0 for matches before the first checkpoint.
 *
 * @param matches - Array of parsed matches
 * @param _matchFiles - Array of match file paths (unused but kept for API consistency)
 * @param generations - Sorted generation boundaries from discoverGenerations
 * @param checkpointInterval - Episode interval between checkpoints
 * @returns Map from generation number to its matches
 */
export function splitMatchesByGeneration(
  matches: ParsedMatch[],
  _matchFiles: string[],
  generations: GenerationBoundary[],
  checkpointInterval: number,
): Map<number, ParsedMatch[]> {
  const result = new Map<number, ParsedMatch[]>();

  for (let i = 0; i < matches.length; i++) {
    const virtualEpisode = i * checkpointInterval;
    let assignedGeneration = 0;

    // Find the last generation whose episode <= virtualEpisode
    for (const gen of generations) {
      if (gen.episode <= virtualEpisode) {
        assignedGeneration = gen.generation;
      } else {
        break; // Sorted, so no need to continue
      }
    }

    let bucket = result.get(assignedGeneration);
    if (!bucket) {
      bucket = [];
      result.set(assignedGeneration, bucket);
    }
    bucket.push(matches[i]);
  }

  return result;
}

/**
 * Compute generation-level analysis data for a set of matches.
 *
 * Computes template win rates and strategy frequency distribution
 * for the matches belonging to a single generation.
 *
 * @param generationMatches - Matches in this generation
 * @param generationNumber - 1-based generation number
 * @param episode - Episode number at this generation boundary
 * @param assignments - Strategy assignments for these matches
 * @param config - Analysis configuration
 * @returns GenerationData snapshot
 */
export function computeGenerationData(
  generationMatches: ParsedMatch[],
  generationNumber: number,
  episode: number,
  assignments: StrategyAssignment[],
  config: AnalysisConfig,
): GenerationData {
  // Compute template win rates for this generation's matches
  const templateWinRates = computeTemplateWinRates(generationMatches, config);

  // Compute strategy frequency distribution from assignments
  const strategyDistribution: Record<string, number> = {};
  for (const assignment of assignments) {
    const label = assignment.ruleLabel;
    strategyDistribution[label] = (strategyDistribution[label] ?? 0) + 1;
  }

  return {
    generation: generationNumber,
    episode,
    matchCount: generationMatches.length,
    strategyDistribution,
    templateWinRates,
  };
}
