#!/usr/bin/env tsx
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  DEFAULT_ANALYSIS_CONFIG,
  assembleBalanceReport,
  assembleRatingsReport,
  discoverMatchFiles,
  formatConsoleSummary,
  formatMarkdownReport,
  readMatchFile,
} from '#bot-harness';
import type { AnalysisConfig, ParsedMatch, RatingsReport } from '#bot-harness';
import type { RatingComputeOptions } from '#bot-harness';

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

const { values, positionals } = parseArgs({
  options: {
    'match-dir': { type: 'string' },
    'run-dir': { type: 'string' },
    output: { type: 'string', short: 'o' },
    format: { type: 'string', short: 'f', default: 'console' },
    confidence: {
      type: 'string',
      default: String(DEFAULT_ANALYSIS_CONFIG.confidence),
    },
    'min-matches': {
      type: 'string',
      default: String(DEFAULT_ANALYSIS_CONFIG.minMatches),
    },
    'max-pattern-length': {
      type: 'string',
      default: String(DEFAULT_ANALYSIS_CONFIG.maxPatternLength),
    },
    k: { type: 'string', default: String(DEFAULT_ANALYSIS_CONFIG.k) },
    'first-n-builds': {
      type: 'string',
      default: String(DEFAULT_ANALYSIS_CONFIG.firstNBuilds),
    },
    // Phase 22: Rating-specific options
    'early-end': { type: 'string', default: '200' },
    'mid-end': { type: 'string', default: '600' },
    tau: { type: 'string', default: '0.5' },
    'min-support': { type: 'string', default: '5' },
    'max-set-size': { type: 'string', default: '4' },
    'per-phase-combos': { type: 'boolean', default: false },
    workers: { type: 'string' },
    'sd-threshold': { type: 'string', default: '2.0' },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: false,
  allowPositionals: true,
});

const subcommand = positionals[0] as 'ratings' | 'report' | 'all' | undefined;

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

if (values.help) {
  console.log(`Usage: tsx bin/analyze-balance.ts [subcommand] [options]

Subcommands:
  (none)     Run Phase 21 win rate / strategy analysis (backward compatible)
  ratings    Compute Glicko-2 structure strength ratings only
  report     Full pipeline: Phase 21 analysis + Phase 22 ratings
  all        Same as 'report' but outputs JSON + console + markdown

Options:
  --match-dir <path>          Directory containing match-*.ndjson files (required)
  --run-dir <path>            Training run directory for generational tracking
  --output <path>, -o         Output file path for JSON/markdown report
  --format <type>, -f         Output format: json | console | markdown | all (default: console)
  --confidence <float>        Confidence level (default: ${String(DEFAULT_ANALYSIS_CONFIG.confidence)})
  --min-matches <int>         Minimum matches for confidence (default: ${String(DEFAULT_ANALYSIS_CONFIG.minMatches)})
  --max-pattern-length <int>  Max sequence pattern length (default: ${String(DEFAULT_ANALYSIS_CONFIG.maxPatternLength)})
  --k <int>                   Number of clusters (default: ${String(DEFAULT_ANALYSIS_CONFIG.k)})
  --first-n-builds <int>      First N builds for first-build analysis (default: ${String(DEFAULT_ANALYSIS_CONFIG.firstNBuilds)})

Rating options (for ratings/report/all subcommands):
  --early-end <tick>          End of early phase (default: 200)
  --mid-end <tick>            End of mid phase (default: 600)
  --tau <float>               Glicko-2 tau parameter (default: 0.5)
  --min-support <int>         Frequent-set min support (default: 5)
  --max-set-size <int>        Frequent-set max size (default: 4)
  --per-phase-combos          Enable per-phase combination ratings
  --workers <int>             Worker thread count (default: auto)
  --sd-threshold <float>      Outlier SD threshold (default: 2.0)
  --help, -h                  Show this help message`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Validate required args
// ---------------------------------------------------------------------------

const matchDir = values['match-dir'] as string | undefined;
if (!matchDir) {
  console.error('Error: --match-dir is required');
  process.exit(1);
}

if (!existsSync(matchDir)) {
  console.error(`Error: match directory does not exist: ${matchDir}`);
  process.exit(1);
}

const format = (
  subcommand === 'all' ? 'all' : (values.format ?? 'console')
) as string;
const validFormats = ['json', 'console', 'markdown', 'all'];
if (!validFormats.includes(format)) {
  console.error(
    `Error: invalid format "${format}". Valid options: ${validFormats.join(', ')}`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build configs
// ---------------------------------------------------------------------------

const config: AnalysisConfig = {
  confidence: parseFloat(values.confidence as string),
  minMatches: parseInt(values['min-matches'] as string, 10),
  maxPatternLength: parseInt(values['max-pattern-length'] as string, 10),
  k: parseInt(values.k as string, 10),
  firstNBuilds: parseInt(values['first-n-builds'] as string, 10),
};

const ratingOptions: RatingComputeOptions & {
  workers?: number;
  parallel?: boolean;
} = {
  tau: parseFloat(values.tau as string),
  perPhaseCombos: values['per-phase-combos'] as boolean,
  sdThreshold: parseFloat(values['sd-threshold'] as string),
  minSupport: parseInt(values['min-support'] as string, 10),
  maxSetSize: parseInt(values['max-set-size'] as string, 10),
  workers: values.workers ? parseInt(values.workers as string, 10) : undefined,
  parallel: true,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

(async () => {
  // 1. Discover match files
  const filePaths = await discoverMatchFiles(matchDir);
  if (filePaths.length === 0) {
    console.error(`Error: no match files found in ${matchDir}`);
    process.exit(1);
  }

  console.error(
    `Found ${String(filePaths.length)} match file(s) in ${matchDir}`,
  );

  // 2. Read matches one at a time to avoid memory issues
  const matches: ParsedMatch[] = [];
  for (const fp of filePaths) {
    matches.push(await readMatchFile(fp));
  }

  // 3. Route based on subcommand
  const outputPath = values.output as string | undefined;

  if (subcommand === 'ratings') {
    // Ratings-only mode: compute Glicko-2 ratings
    console.error('Computing Glicko-2 ratings...');
    const ratingsReport: RatingsReport = await assembleRatingsReport(
      matches,
      ratingOptions,
    );

    if (format === 'json' || format === 'all') {
      const json = JSON.stringify(ratingsReport, null, 2);
      if (outputPath) {
        await writeFile(outputPath, json, 'utf-8');
        console.error(`Ratings JSON written to: ${outputPath}`);
      } else {
        console.log(json);
      }
    } else if (format === 'console') {
      // Quick console summary of ratings
      const summary = formatRatingsConsole(ratingsReport);
      console.log(summary);
    } else if (format === 'markdown') {
      const json = JSON.stringify(ratingsReport, null, 2);
      if (outputPath) {
        await writeFile(outputPath, json, 'utf-8');
        console.error(`Ratings JSON written to: ${outputPath}`);
      } else {
        console.log(json);
      }
    }

    const entityCount =
      ratingsReport.individual.early.length +
      ratingsReport.individual.mid.length +
      ratingsReport.individual.late.length +
      ratingsReport.pairwise.length +
      ratingsReport.frequentSets.length;
    console.error(
      `Ratings complete: ${String(matches.length)} matches, ${String(entityCount)} rated entities`,
    );
  } else if (subcommand === 'report' || subcommand === 'all') {
    // Full pipeline: Phase 21 analysis + Phase 22 ratings
    console.error('Running full analysis pipeline...');

    const runDir = values['run-dir'] as string | undefined;
    const checkpointDir = runDir ? join(runDir, 'checkpoints') : undefined;

    const report = await assembleBalanceReport(matches, config, {
      matchDir,
      checkpointDir,
      ratingsOptions: ratingOptions,
    });

    if (format === 'json' || format === 'all') {
      const json = JSON.stringify(report, null, 2);
      const jsonPath =
        format === 'all' ? (outputPath ?? 'balance-report.json') : outputPath;
      if (jsonPath) {
        await writeFile(jsonPath, json, 'utf-8');
        console.error(`JSON report written to: ${jsonPath}`);
      } else {
        console.log(json);
      }
    }

    if (format === 'markdown' || format === 'all') {
      const md = formatMarkdownReport(report);
      const mdPath = format === 'all' ? 'balance-report.md' : outputPath;
      if (mdPath) {
        await writeFile(mdPath, md, 'utf-8');
        console.error(`Markdown report written to: ${mdPath}`);
      } else {
        console.log(md);
      }
    }

    if (format === 'console' || format === 'all') {
      console.log(formatConsoleSummary(report));
    }

    const templateCount = report.templateWinRates.filter(
      (t) => t.presence.total > 0,
    ).length;
    const strategyCount = report.strategyWinRates.length;
    console.error(
      `Analysis complete: ${String(matches.length)} matches, ${String(templateCount)} templates, ${String(strategyCount)} strategies`,
    );
  } else {
    // Default: Phase 21 analysis only (backward compatible)
    const runDir = values['run-dir'] as string | undefined;
    const checkpointDir = runDir ? join(runDir, 'checkpoints') : undefined;

    const report = await assembleBalanceReport(matches, config, {
      matchDir,
      checkpointDir,
    });

    if (format === 'json' || format === 'all') {
      const json = JSON.stringify(report, null, 2);
      const jsonPath =
        format === 'all' ? (outputPath ?? 'balance-report.json') : outputPath;
      if (jsonPath) {
        await writeFile(jsonPath, json, 'utf-8');
        console.error(`JSON report written to: ${jsonPath}`);
      } else {
        console.log(json);
      }
    }

    if (format === 'markdown' || format === 'all') {
      const md = formatMarkdownReport(report);
      const mdPath = format === 'all' ? 'balance-report.md' : outputPath;
      if (mdPath) {
        await writeFile(mdPath, md, 'utf-8');
        console.error(`Markdown report written to: ${mdPath}`);
      } else {
        console.log(md);
      }
    }

    if (format === 'console' || format === 'all') {
      console.log(formatConsoleSummary(report));
    }

    const templateCount = report.templateWinRates.filter(
      (t) => t.presence.total > 0,
    ).length;
    const strategyCount = report.strategyWinRates.length;
    console.error(
      `Analysis complete: ${String(matches.length)} matches, ${String(templateCount)} templates, ${String(strategyCount)} strategies`,
    );
  }

  process.exit(0);
})().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Helper for ratings-only console output
// ---------------------------------------------------------------------------

function formatRatingsConsole(report: RatingsReport): string {
  const lines: string[] = [];
  lines.push('=== Structure Ratings (Glicko-2) ===');
  lines.push('');

  const phases = [
    { label: 'Early Game', entities: report.individual.early },
    { label: 'Mid Game', entities: report.individual.mid },
    { label: 'Late Game', entities: report.individual.late },
  ] as const;

  for (const { label, entities } of phases) {
    if (entities.length === 0) continue;
    lines.push(`  ${label}:`);

    for (const entity of entities) {
      const name = entity.name.padEnd(14);
      const rating = entity.rating.rating.toFixed(0).padStart(5);
      const rd = entity.rating.rd.toFixed(0);
      const prov = entity.provisional ? ', provisional' : '';
      lines.push(
        `    ${name}  ${rating} +/- ${rd}  (n=${String(entity.matchCount)}${prov})`,
      );
    }
    lines.push('');
  }

  if (report.pairwise.length > 0) {
    lines.push('  Top Pairwise Combinations:');
    for (const entity of report.pairwise.slice(0, 5)) {
      const name = entity.name.padEnd(24);
      const rating = entity.rating.rating.toFixed(0).padStart(5);
      lines.push(`    ${name}  ${rating}  (n=${String(entity.matchCount)})`);
    }
    lines.push('');
  }

  if (report.outliers.overall.length > 0) {
    lines.push('  Outliers:');
    for (const entity of report.outliers.overall) {
      if (entity.outlierFlags.length > 0) {
        const flags = entity.outlierFlags.join(', ');
        lines.push(
          `    [${flags}] ${entity.name} (${entity.phase}): ${entity.rating.rating.toFixed(0)}`,
        );
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}
