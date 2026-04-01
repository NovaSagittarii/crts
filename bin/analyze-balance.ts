#!/usr/bin/env tsx
import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  discoverMatchFiles,
  readMatchFile,
  assembleBalanceReport,
  formatConsoleSummary,
  formatMarkdownReport,
  DEFAULT_ANALYSIS_CONFIG,
} from '#bot-harness';
import type { AnalysisConfig, ParsedMatch } from '#bot-harness';

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    'match-dir': { type: 'string' },
    'run-dir': { type: 'string' },
    output: { type: 'string', short: 'o' },
    format: { type: 'string', short: 'f', default: 'console' },
    confidence: { type: 'string', default: String(DEFAULT_ANALYSIS_CONFIG.confidence) },
    'min-matches': { type: 'string', default: String(DEFAULT_ANALYSIS_CONFIG.minMatches) },
    'max-pattern-length': { type: 'string', default: String(DEFAULT_ANALYSIS_CONFIG.maxPatternLength) },
    k: { type: 'string', default: String(DEFAULT_ANALYSIS_CONFIG.k) },
    'first-n-builds': { type: 'string', default: String(DEFAULT_ANALYSIS_CONFIG.firstNBuilds) },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

// ---------------------------------------------------------------------------
// Help
// ---------------------------------------------------------------------------

if (values.help) {
  console.log(`Usage: tsx bin/analyze-balance.ts [options]

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
  --help, -h                  Show this help message`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Validate required args
// ---------------------------------------------------------------------------

const matchDir = values['match-dir'];
if (!matchDir) {
  console.error('Error: --match-dir is required');
  process.exit(1);
}

if (!existsSync(matchDir)) {
  console.error(`Error: match directory does not exist: ${matchDir}`);
  process.exit(1);
}

const format = values.format ?? 'console';
const validFormats = ['json', 'console', 'markdown', 'all'];
if (!validFormats.includes(format)) {
  console.error(
    `Error: invalid format "${format}". Valid options: ${validFormats.join(', ')}`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Build config
// ---------------------------------------------------------------------------

const config: AnalysisConfig = {
  confidence: parseFloat(values.confidence!),
  minMatches: parseInt(values['min-matches']!, 10),
  maxPatternLength: parseInt(values['max-pattern-length']!, 10),
  k: parseInt(values.k!, 10),
  firstNBuilds: parseInt(values['first-n-builds']!, 10),
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

  console.error(`Found ${String(filePaths.length)} match file(s) in ${matchDir}`);

  // 2. Read matches one at a time to avoid memory issues
  const matches: ParsedMatch[] = [];
  for (const fp of filePaths) {
    matches.push(await readMatchFile(fp));
  }

  // 3. Determine checkpoint directory
  const runDir = values['run-dir'];
  const checkpointDir = runDir ? join(runDir, 'checkpoints') : undefined;

  // 4. Assemble report
  const report = await assembleBalanceReport(matches, config, {
    matchDir,
    checkpointDir,
  });

  // 5. Output based on format
  const outputPath = values.output;

  if (format === 'json' || format === 'all') {
    const json = JSON.stringify(report, null, 2);
    const jsonPath = format === 'all' ? (outputPath ?? 'balance-report.json') : outputPath;
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

  // 6. Summary line
  const templateCount = report.templateWinRates.filter(
    (t) => t.presence.total > 0,
  ).length;
  const strategyCount = report.strategyWinRates.length;
  console.error(
    `Analysis complete: ${String(matches.length)} matches, ${String(templateCount)} templates, ${String(strategyCount)} strategies`,
  );

  process.exit(0);
})().catch((err: unknown) => {
  console.error('Error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
