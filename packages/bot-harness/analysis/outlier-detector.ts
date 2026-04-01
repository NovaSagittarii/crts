/**
 * Statistical deviation and usage-matrix outlier detection for rated entities.
 *
 * Two independent detection methods producing additive flags per entity:
 *
 * Method A (D-10a): Statistical deviation
 *   - Entities with rating >2 SD above/below mean are flagged
 *   - Provisional entities (RD > 150) are excluded from SD calculation
 *
 * Method B (D-10b): Rating + usage matrix
 *   - dominant: high rating + high pick rate
 *   - niche-strong: high rating + low pick rate
 *   - trap: low rating + high pick rate
 *
 * Flags are additive per D-12: an entity can carry multiple flags.
 */

import type { OutlierFlag, RatedEntity } from './types.js';
import { mean, stddev } from './stats.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute median of a sorted array of numbers.
 */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

/**
 * Detect outliers in a set of rated entities using statistical deviation
 * and usage-matrix methods.
 *
 * Does NOT mutate input -- creates new RatedEntity objects with updated outlierFlags.
 *
 * @param entities    Rated entities to analyze
 * @param options     Configuration (sdThreshold defaults to 2.0)
 * @returns           New array of entities with outlierFlags populated
 */
export function detectOutliers(
  entities: RatedEntity[],
  options?: { sdThreshold?: number },
): RatedEntity[] {
  const sdThreshold = options?.sdThreshold ?? 2.0;

  // Build flag map: entityId -> Set<OutlierFlag>
  const flagMap = new Map<string, Set<OutlierFlag>>();
  for (const entity of entities) {
    flagMap.set(entity.id, new Set());
  }

  // -------------------------------------------------------------------------
  // Method A: Statistical deviation (D-10a)
  // -------------------------------------------------------------------------
  // Filter to non-provisional entities for SD calculation
  const nonProvisional = entities.filter((e) => !e.provisional);

  if (nonProvisional.length >= 2) {
    const ratings = nonProvisional.map((e) => e.rating.rating);
    const m = mean(ratings);
    const sd = stddev(ratings);

    if (sd > 0) {
      for (const entity of nonProvisional) {
        const flags = flagMap.get(entity.id)!;
        if (entity.rating.rating > m + sdThreshold * sd) {
          flags.add('statistical-outlier-high');
        }
        if (entity.rating.rating < m - sdThreshold * sd) {
          flags.add('statistical-outlier-low');
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Method B: Rating + usage matrix (D-10b)
  // -------------------------------------------------------------------------
  // Compute medians across non-provisional entities for categorization
  const matrixEntities = nonProvisional.length > 0 ? nonProvisional : entities;

  if (matrixEntities.length >= 2) {
    const ratingValues = matrixEntities.map((e) => e.rating.rating);
    const pickRates = matrixEntities.map((e) => e.pickRate);

    const medianRating = median(ratingValues);
    const medianPickRate = median(pickRates);

    for (const entity of entities) {
      const flags = flagMap.get(entity.id)!;
      const highRating = entity.rating.rating > medianRating;
      const highPickRate = entity.pickRate > medianPickRate;

      if (highRating && highPickRate) {
        flags.add('dominant');
      } else if (highRating && !highPickRate) {
        flags.add('niche-strong');
      } else if (!highRating && highPickRate) {
        flags.add('trap');
      }
      // low rating + low pick rate = no flag (weak and unused)
    }
  }

  // -------------------------------------------------------------------------
  // Build result: new entities with updated flags
  // -------------------------------------------------------------------------
  return entities.map((entity) => ({
    ...entity,
    rating: { ...entity.rating },
    outlierFlags: Array.from(flagMap.get(entity.id) ?? []),
  }));
}
