import type { ParsedMatch, SequencePattern } from './types.js';

/**
 * PrefixSpan-style sequential pattern mining.
 *
 * Discovers frequent subsequence patterns from a collection of sequences.
 * Uses projected database approach for efficient pruning.
 */
export function mineSequencePatterns(
  sequences: string[][],
  config: { minSupport: number; maxPatternLength: number },
): SequencePattern[] {
  const { minSupport, maxPatternLength } = config;
  const totalSequences = sequences.length;

  if (totalSequences === 0 || minSupport <= 0 || maxPatternLength <= 0) {
    return [];
  }

  const results: SequencePattern[] = [];

  // Build initial projected databases: for each item, find all sequences
  // containing it and the positions after its occurrence
  type ProjectedEntry = { seqIdx: number; startPos: number };
  type ProjectedDB = ProjectedEntry[];

  /**
   * Recursively mine patterns using PrefixSpan.
   * @param prefix Current pattern prefix
   * @param projectedDB Projected database of (seqIdx, position-after-prefix) pairs
   */
  function prefixSpan(prefix: string[], projectedDB: ProjectedDB): void {
    if (prefix.length >= maxPatternLength) return;

    // Count support for each possible extension item
    const itemSupport = new Map<string, Set<number>>();
    const itemPositions = new Map<string, ProjectedEntry[]>();

    for (const entry of projectedDB) {
      const seq = sequences[entry.seqIdx];
      const seen = new Set<string>();

      for (let pos = entry.startPos; pos < seq.length; pos++) {
        const item = seq[pos];
        if (!seen.has(item)) {
          seen.add(item);

          if (!itemSupport.has(item)) {
            itemSupport.set(item, new Set<number>());
            itemPositions.set(item, []);
          }
          itemSupport.get(item)!.add(entry.seqIdx);
        }
        // Record position for projected DB (use first occurrence per sequence per item)
        if (seen.has(item) && itemPositions.has(item)) {
          const entries = itemPositions.get(item)!;
          // Only add if this sequence hasn't been added yet for this item
          if (
            entries.length === 0 ||
            entries[entries.length - 1].seqIdx !== entry.seqIdx
          ) {
            entries.push({ seqIdx: entry.seqIdx, startPos: pos + 1 });
          }
        }
      }
    }

    // For each frequent item, extend the prefix and recurse
    for (const [item, supportSet] of itemSupport.entries()) {
      if (supportSet.size >= minSupport) {
        const newPrefix = [...prefix, item];
        const newProjectedDB = itemPositions.get(item)!;

        results.push({
          pattern: newPrefix,
          support: supportSet.size,
          frequency: supportSet.size / totalSequences,
        });

        prefixSpan(newPrefix, newProjectedDB);
      }
    }
  }

  // Start: create initial projected DB with all sequences starting at position 0
  const initialDB: ProjectedDB = sequences.map((_, idx) => ({
    seqIdx: idx,
    startPos: 0,
  }));

  prefixSpan([], initialDB);

  // Sort: by support descending, then pattern length descending
  results.sort((a, b) => {
    if (b.support !== a.support) return b.support - a.support;
    return b.pattern.length - a.pattern.length;
  });

  return results;
}

/**
 * Extract the ordered build sequence for a team from a match.
 *
 * Returns the ordered list of templateIds from applied build actions.
 * Skips actions without templateId.
 */
export function extractBuildSequence(
  match: ParsedMatch,
  teamId: number,
): string[] {
  const sequence: string[] = [];

  for (const tick of match.ticks) {
    for (const action of tick.actions) {
      if (
        action.teamId === teamId &&
        action.actionType === 'build' &&
        action.result === 'applied' &&
        action.templateId
      ) {
        sequence.push(action.templateId);
      }
    }
  }

  return sequence;
}
