import type { BalanceReport, RatedEntity } from './types.js';

/**
 * Format a balance report as a plain-text console summary.
 *
 * Sections:
 * 1. Header with match count and confidence level
 * 2. Top 5 templates by presence-based win rate
 * 3. Strategy distribution overview
 * 4. Top 5 sequence patterns by support
 * 5. Generational convergence summary (if generations present)
 *
 * Uses plain text formatting without ANSI colors for portability.
 */
export function formatConsoleSummary(report: BalanceReport): string {
  const lines: string[] = [];

  // ── Section 1: Header ─────────────────────────────────────────────
  lines.push('=== Balance Analysis Summary ===');
  lines.push('');
  lines.push(`  Matches analyzed:  ${String(report.metadata.matchCount)}`);
  lines.push(`  Confidence level:  ${(report.metadata.confidence * 100).toFixed(0)}%`);
  lines.push(`  Generated at:      ${report.metadata.generatedAt}`);
  lines.push('');

  // ── Section 2: Top 5 Templates by Presence Win Rate ───────────────
  lines.push('--- Top Templates (Presence Win Rate) ---');
  lines.push('');

  const sorted = [...report.templateWinRates]
    .filter((t) => t.presence.total > 0)
    .sort((a, b) => b.presence.winRate - a.presence.winRate)
    .slice(0, 5);

  if (sorted.length === 0) {
    lines.push('  (no template data)');
  } else {
    const nameWidth = Math.max(
      ...sorted.map((t) => t.templateName.length),
      8,
    );

    for (const t of sorted) {
      const name = t.templateName.padEnd(nameWidth);
      const wr = (t.presence.winRate * 100).toFixed(1).padStart(5);
      const ciLow = (t.presence.ci.lower * 100).toFixed(1);
      const ciHigh = (t.presence.ci.upper * 100).toFixed(1);
      const n = String(t.presence.total);
      const lowConf = t.presence.total < 10 ? ' (low confidence)' : '';
      lines.push(
        `  ${name}  ${wr}%  (CI: ${ciLow}%-${ciHigh}%, n=${n})${lowConf}`,
      );
    }
  }
  lines.push('');

  // ── Section 3: Strategy Distribution ──────────────────────────────
  lines.push('--- Strategy Distribution ---');
  lines.push('');

  const strategyCounts = new Map<string, number>();
  for (const a of report.strategyAssignments) {
    strategyCounts.set(
      a.ruleLabel,
      (strategyCounts.get(a.ruleLabel) ?? 0) + 1,
    );
  }

  const totalAssignments = report.strategyAssignments.length;
  const strategyEntries = [...strategyCounts.entries()].sort(
    (a, b) => b[1] - a[1],
  );

  if (strategyEntries.length === 0) {
    lines.push('  (no strategy data)');
  } else {
    const labelWidth = Math.max(
      ...strategyEntries.map(([label]) => label.length),
      8,
    );

    for (const [label, count] of strategyEntries) {
      const pct =
        totalAssignments > 0
          ? ((count / totalAssignments) * 100).toFixed(1)
          : '0.0';
      lines.push(
        `  ${label.padEnd(labelWidth)}  ${String(count).padStart(4)} (${pct.padStart(5)}%)`,
      );
    }
  }
  lines.push('');

  // ── Section 4: Top 5 Sequence Patterns ────────────────────────────
  lines.push('--- Top Build Sequences ---');
  lines.push('');

  const topPatterns = report.sequencePatterns.slice(0, 5);

  if (topPatterns.length === 0) {
    lines.push('  (no sequence patterns)');
  } else {
    for (const sp of topPatterns) {
      const pattern = `[${sp.pattern.join(' -> ')}]`;
      const freq = (sp.frequency * 100).toFixed(1);
      lines.push(
        `  ${pattern}  (support: ${String(sp.support)}, freq: ${freq}%)`,
      );
    }
  }
  lines.push('');

  // ── Section 5: Generational Convergence ───────────────────────────
  if (report.generations.length > 0) {
    lines.push('--- Generational Trends ---');
    lines.push('');

    const dominantStrategies: string[] = [];
    for (const gen of report.generations) {
      const entries = Object.entries(gen.strategyDistribution);
      if (entries.length > 0) {
        entries.sort((a, b) => b[1] - a[1]);
        dominantStrategies.push(entries[0][0]);
      } else {
        dominantStrategies.push('(none)');
      }
    }

    for (let i = 0; i < report.generations.length; i++) {
      const gen = report.generations[i];
      lines.push(
        `  Gen ${String(gen.generation)} (ep ${String(gen.episode)}): ${String(gen.matchCount)} matches, dominant: ${dominantStrategies[i]}`,
      );
    }
    lines.push('');

    // Convergence detection
    const uniqueStrategies = new Set(dominantStrategies);
    if (dominantStrategies.length >= 2) {
      if (uniqueStrategies.size === 1) {
        lines.push(
          `  Convergence detected: strategy "${dominantStrategies[0]}" stable across all generations`,
        );
      } else {
        const last = dominantStrategies[dominantStrategies.length - 1];
        const secondLast = dominantStrategies[dominantStrategies.length - 2];
        if (last !== secondLast) {
          lines.push(
            `  Strategy shift detected: "${secondLast}" -> "${last}" in latest generation`,
          );
        } else {
          lines.push(
            `  Strategy stabilizing: "${last}" dominant in recent generations`,
          );
        }
      }
      lines.push('');
    }
  }

  // ── Section 6: Structure Ratings (Glicko-2) ─────────────────────────
  if (report.ratings) {
    lines.push('--- Structure Ratings (Glicko-2) ---');
    lines.push('');

    const phases = [
      { label: 'Early Game Tier List', entities: report.ratings.individual.early },
      { label: 'Mid Game Tier List', entities: report.ratings.individual.mid },
      { label: 'Late Game Tier List', entities: report.ratings.individual.late },
    ] as const;

    for (const { label, entities } of phases) {
      if (entities.length === 0) continue;
      lines.push(`  ${label}:`);

      for (const entity of entities) {
        const name = entity.name.padEnd(14);
        const rating = entity.rating.rating.toFixed(0).padStart(5);
        const rd = entity.rating.rd.toFixed(0);
        const n = String(entity.matchCount);
        const prov = entity.provisional ? ', provisional' : '';
        lines.push(`    ${name}  ${rating} +/- ${rd}  (n=${n}${prov})`);
      }
      lines.push('');
    }

    // Top 5 pairwise combinations
    if (report.ratings.pairwise.length > 0) {
      lines.push('  Top Pairwise Combinations:');
      const topPairs = report.ratings.pairwise.slice(0, 5);
      for (const entity of topPairs) {
        const name = entity.name.padEnd(24);
        const rating = entity.rating.rating.toFixed(0).padStart(5);
        const n = String(entity.matchCount);
        lines.push(`    ${name}  ${rating}  (n=${n})`);
      }
      lines.push('');
    }

    // Top 5 frequent-set combinations
    if (report.ratings.frequentSets.length > 0) {
      lines.push('  Top Frequent Sets:');
      const topSets = report.ratings.frequentSets.slice(0, 5);
      for (const entity of topSets) {
        const name = entity.name.padEnd(30);
        const rating = entity.rating.rating.toFixed(0).padStart(5);
        const n = String(entity.matchCount);
        lines.push(`    ${name}  ${rating}  (n=${n})`);
      }
      lines.push('');
    }
  }

  // ── Section 7: Balance Outliers ────────────────────────────────────
  if (report.ratings?.outliers) {
    const allOutliers: RatedEntity[] = [
      ...report.ratings.outliers.perPhase.early,
      ...report.ratings.outliers.perPhase.mid,
      ...report.ratings.outliers.perPhase.late,
      ...report.ratings.outliers.overall,
    ];

    // Deduplicate by id+phase
    const seen = new Set<string>();
    const uniqueOutliers: RatedEntity[] = [];
    for (const e of allOutliers) {
      const key = `${e.id}-${e.phase}`;
      if (!seen.has(key) && e.outlierFlags.length > 0) {
        seen.add(key);
        uniqueOutliers.push(e);
      }
    }

    if (uniqueOutliers.length > 0) {
      lines.push('--- Balance Outliers ---');
      lines.push('');

      for (const entity of uniqueOutliers) {
        const flags = entity.outlierFlags.map((f) => f.toUpperCase()).join(', ');
        const name = entity.name.padEnd(14);
        const rating = entity.rating.rating.toFixed(0);
        const pickRate = (entity.pickRate * 100).toFixed(0);
        lines.push(`  [${flags}] ${name}  rating: ${rating}, pick rate: ${pickRate}%`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}
