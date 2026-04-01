import type { BalanceReport, GenerationData, RatedEntity, TemplateWinRate } from './types.js';

/**
 * Format a balance report as a Markdown document.
 *
 * Produces a human-readable, shareable report with tables for:
 * - Template win rates
 * - Strategy distribution
 * - Strategy win rates
 * - Common build sequences
 * - Cluster summary
 * - Generational trends (if present)
 */
export function formatMarkdownReport(report: BalanceReport): string {
  const lines: string[] = [];

  // ── Title ─────────────────────────────────────────────────────────
  lines.push('# Balance Analysis Report');
  lines.push('');

  // ── Metadata ──────────────────────────────────────────────────────
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(`| Matches | ${String(report.metadata.matchCount)} |`);
  lines.push(`| Generated | ${report.metadata.generatedAt} |`);
  lines.push(
    `| Confidence | ${(report.metadata.confidence * 100).toFixed(0)}% |`,
  );
  lines.push('');

  // ── Template Win Rates ────────────────────────────────────────────
  lines.push('## Template Win Rates');
  lines.push('');
  lines.push(
    '| Template | Presence WR | Usage WR | First-Build WR | Sample Size |',
  );
  lines.push('| --- | --- | --- | --- | --- |');

  const sortedTemplates = [...report.templateWinRates]
    .filter((t) => t.presence.total > 0)
    .sort((a, b) => b.presence.winRate - a.presence.winRate);

  for (const t of sortedTemplates) {
    lines.push(
      `| ${t.templateName} | ${formatPct(t.presence.winRate)} | ${formatPct(t.usageWeighted.winRate)} | ${formatPct(t.firstBuild.winRate)} | ${String(t.presence.total)} |`,
    );
  }

  if (sortedTemplates.length === 0) {
    lines.push('| (no data) | - | - | - | - |');
  }
  lines.push('');

  // ── Strategy Distribution ─────────────────────────────────────────
  lines.push('## Strategy Distribution');
  lines.push('');
  lines.push('| Strategy | Count | Percentage |');
  lines.push('| --- | --- | --- |');

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

  for (const [label, count] of strategyEntries) {
    const pct =
      totalAssignments > 0 ? ((count / totalAssignments) * 100).toFixed(1) : '0.0';
    lines.push(`| ${label} | ${String(count)} | ${pct}% |`);
  }

  if (strategyEntries.length === 0) {
    lines.push('| (no data) | - | - |');
  }
  lines.push('');

  // ── Strategy Win Rates ────────────────────────────────────────────
  lines.push('## Strategy Win Rates');
  lines.push('');
  lines.push(
    '| Strategy | Presence WR | Usage WR | First-Build WR | Sample Size |',
  );
  lines.push('| --- | --- | --- | --- | --- |');

  const sortedStrategies = [...report.strategyWinRates].sort(
    (a, b) => b.presence.winRate - a.presence.winRate,
  );

  for (const s of sortedStrategies) {
    lines.push(
      `| ${s.strategyLabel} | ${formatPct(s.presence.winRate)} | ${formatPct(s.usageWeighted.winRate)} | ${formatPct(s.firstBuild.winRate)} | ${String(s.presence.total)} |`,
    );
  }

  if (sortedStrategies.length === 0) {
    lines.push('| (no data) | - | - | - | - |');
  }
  lines.push('');

  // ── Common Build Sequences ────────────────────────────────────────
  lines.push('## Common Build Sequences');
  lines.push('');
  lines.push('| Pattern | Support | Frequency |');
  lines.push('| --- | --- | --- |');

  for (const sp of report.sequencePatterns) {
    const pattern = sp.pattern.join(' -> ');
    lines.push(
      `| ${pattern} | ${String(sp.support)} | ${formatPct(sp.frequency)} |`,
    );
  }

  if (report.sequencePatterns.length === 0) {
    lines.push('| (no patterns) | - | - |');
  }
  lines.push('');

  // ── Cluster Summary ───────────────────────────────────────────────
  lines.push('## Cluster Summary');
  lines.push('');
  lines.push(`- **Number of clusters:** ${String(report.clusters.k)}`);
  lines.push(`- **WCSS:** ${report.clusters.wcss.toFixed(2)}`);
  lines.push(
    `- **Iterations:** ${String(report.clusters.iterations)}`,
  );
  lines.push('');

  if (report.clusters.centroids.length > 0) {
    lines.push('### Centroid Feature Summary');
    lines.push('');
    lines.push('| Cluster | Features (first 5 dims) |');
    lines.push('| --- | --- |');

    for (let i = 0; i < report.clusters.centroids.length; i++) {
      const c = report.clusters.centroids[i];
      const features = c
        .slice(0, 5)
        .map((v) => v.toFixed(2))
        .join(', ');
      lines.push(`| ${String(i)} | [${features}] |`);
    }
    lines.push('');
  }

  // ── Generational Trends ───────────────────────────────────────────
  if (report.generations.length > 0) {
    lines.push('## Generational Trends');
    lines.push('');
    lines.push(
      '| Generation | Episode | Matches | Dominant Strategy | Top Template |',
    );
    lines.push('| --- | --- | --- | --- | --- |');

    const dominantStrategies: string[] = [];

    for (const gen of report.generations) {
      const dominant = getDominantStrategy(gen);
      dominantStrategies.push(dominant);
      const topTemplate = getTopTemplate(gen);

      lines.push(
        `| ${String(gen.generation)} | ${String(gen.episode)} | ${String(gen.matchCount)} | ${dominant} | ${topTemplate} |`,
      );
    }
    lines.push('');

    // Convergence/cycling detection notes
    if (report.generations.length >= 2) {
      const uniqueStrategies = new Set(dominantStrategies);

      if (uniqueStrategies.size === 1) {
        lines.push(
          `> **Convergence detected:** Strategy "${dominantStrategies[0]}" is dominant across all generations.`,
        );
      } else {
        // Check for cycling (A -> B -> A pattern)
        let cycling = false;
        if (dominantStrategies.length >= 3) {
          for (let i = 2; i < dominantStrategies.length; i++) {
            if (
              dominantStrategies[i] === dominantStrategies[i - 2] &&
              dominantStrategies[i] !== dominantStrategies[i - 1]
            ) {
              cycling = true;
              break;
            }
          }
        }

        if (cycling) {
          lines.push(
            '> **Cycling detected:** Dominant strategy oscillates between generations, indicating a potential rock-paper-scissors dynamic.',
          );
        } else {
          lines.push(
            '> **Strategy shift:** Dominant strategy varies across generations. Further investigation recommended.',
          );
        }
      }
      lines.push('');
    }
  }

  // ── Structure Ratings (Glicko-2) ───────────────────────────────────
  if (report.ratings) {
    lines.push('## Structure Ratings (Glicko-2)');
    lines.push('');

    const phases = [
      { label: 'Early Game', entities: report.ratings.individual.early },
      { label: 'Mid Game', entities: report.ratings.individual.mid },
      { label: 'Late Game', entities: report.ratings.individual.late },
    ] as const;

    for (const { label, entities } of phases) {
      if (entities.length === 0) continue;
      lines.push(`### ${label}`);
      lines.push('');
      lines.push('| Template | Rating | RD | Volatility | Matches | Status |');
      lines.push('| --- | --- | --- | --- | --- | --- |');

      for (const entity of entities) {
        const status = entity.provisional ? 'Provisional' : 'Established';
        lines.push(
          `| ${entity.name} | ${entity.rating.rating.toFixed(0)} | ${entity.rating.rd.toFixed(1)} | ${entity.rating.volatility.toFixed(4)} | ${String(entity.matchCount)} | ${status} |`,
        );
      }
      lines.push('');
    }

    // Pairwise Combination Ratings
    if (report.ratings.pairwise.length > 0) {
      lines.push('## Pairwise Combination Ratings');
      lines.push('');
      lines.push('| Combination | Rating | RD | Matches | Status |');
      lines.push('| --- | --- | --- | --- | --- |');

      for (const entity of report.ratings.pairwise) {
        const status = entity.provisional ? 'Provisional' : 'Established';
        lines.push(
          `| ${entity.name} | ${entity.rating.rating.toFixed(0)} | ${entity.rating.rd.toFixed(1)} | ${String(entity.matchCount)} | ${status} |`,
        );
      }
      lines.push('');
    }

    // Frequent Set Ratings
    if (report.ratings.frequentSets.length > 0) {
      lines.push('## Frequent Set Ratings');
      lines.push('');
      lines.push('| Set | Rating | RD | Matches | Status |');
      lines.push('| --- | --- | --- | --- | --- |');

      for (const entity of report.ratings.frequentSets) {
        const status = entity.provisional ? 'Provisional' : 'Established';
        lines.push(
          `| ${entity.name} | ${entity.rating.rating.toFixed(0)} | ${entity.rating.rd.toFixed(1)} | ${String(entity.matchCount)} | ${status} |`,
        );
      }
      lines.push('');
    }

    // Balance Outliers
    const allOutliers: RatedEntity[] = [
      ...(report.ratings.outliers?.perPhase.early ?? []),
      ...(report.ratings.outliers?.perPhase.mid ?? []),
      ...(report.ratings.outliers?.perPhase.late ?? []),
      ...(report.ratings.outliers?.overall ?? []),
    ];

    // Deduplicate
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
      lines.push('## Balance Outliers');
      lines.push('');
      lines.push('| Entity | Phase | Flags | Rating | Pick Rate |');
      lines.push('| --- | --- | --- | --- | --- |');

      for (const entity of uniqueOutliers) {
        const flags = entity.outlierFlags.join(', ');
        const pickRate = formatPct(entity.pickRate);
        lines.push(
          `| ${entity.name} | ${entity.phase} | ${flags} | ${entity.rating.rating.toFixed(0)} | ${pickRate} |`,
        );
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** Format a decimal value as a percentage string with one decimal place */
function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/** Get the dominant strategy label from a GenerationData */
function getDominantStrategy(gen: GenerationData): string {
  const entries = Object.entries(gen.strategyDistribution);
  if (entries.length === 0) return '(none)';
  entries.sort((a, b) => b[1] - a[1]);
  return entries[0][0];
}

/** Get the top template name from a GenerationData */
function getTopTemplate(gen: GenerationData): string {
  const rates: TemplateWinRate[] = [...gen.templateWinRates]
    .filter((t) => t.presence.total > 0)
    .sort((a, b) => b.presence.winRate - a.presence.winRate);
  if (rates.length === 0) return '(none)';
  return rates[0].templateName;
}
