#!/usr/bin/env tsx
import { parseArgs } from 'node:util';

import {
  DEFAULT_GRID_WIDTH,
  DEFAULT_HASH_CHECKPOINT_INTERVAL,
  DEFAULT_MAX_TICKS,
  MatchLogger,
  RandomBot,
  createMatchHeader,
  createMatchOutcomeRecord,
  generateRunId,
  generateSeeds,
  runMatch,
} from '#bot-harness';
import type { MatchConfig, TickRecord } from '#bot-harness';

const { values } = parseArgs({
  options: {
    count: { type: 'string', default: '1' },
    seed: { type: 'string', default: '1' },
    'max-ticks': { type: 'string', default: String(DEFAULT_MAX_TICKS) },
    'output-dir': { type: 'string', default: 'matches' },
    'grid-size': { type: 'string', default: String(DEFAULT_GRID_WIDTH) },
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
});

if (values.help) {
  console.log(`Usage: tsx bin/run-matches.ts [options]

Options:
  --count <n>       Number of matches to run (default: 1)
  --seed <n>        Base seed for deterministic runs (default: 1)
  --max-ticks <n>   Max tick limit per match (default: ${String(DEFAULT_MAX_TICKS)})
  --output-dir <d>  Output directory for NDJSON logs (default: matches)
  --grid-size <n>   Grid width and height (default: ${String(DEFAULT_GRID_WIDTH)})
  --dry-run         Run matches without writing log files
  --help, -h        Show this help message`);
  process.exit(0);
}

const count = parseInt(values.count, 10);
const baseSeed = parseInt(values.seed, 10);
const maxTicks = parseInt(values['max-ticks'], 10);
const outputDir = values['output-dir'];
const gridSize = parseInt(values['grid-size'], 10);
const dryRun = values['dry-run'];

(async () => {
  const startTime = Date.now();
  const seeds = generateSeeds(baseSeed, count);
  const botA = new RandomBot();
  const botB = new RandomBot();
  const runId = generateRunId(baseSeed);
  const logger = new MatchLogger(outputDir, runId);

  let wins = 0;
  let draws = 0;

  for (let i = 0; i < seeds.length; i++) {
    const seed = seeds[i];
    const config: MatchConfig = {
      seed,
      gridWidth: gridSize,
      gridHeight: gridSize,
      maxTicks,
      hashCheckpointInterval: DEFAULT_HASH_CHECKPOINT_INTERVAL,
    };

    const tickRecords: TickRecord[] = [];
    const result = runMatch(config, botA, botB, {
      onTickComplete: (_tick, record) => {
        tickRecords.push(record);
      },
    });

    if (!dryRun) {
      const header = createMatchHeader(config, [botA.name, botB.name]);
      const outcomeRecord = createMatchOutcomeRecord(result);
      await logger.writeMatch(i, header, tickRecords, outcomeRecord);
    }

    const outcomeLabel = result.isDraw ? 'draw' : 'winner';
    console.log(
      `Match ${String(i + 1)}/${String(count)}: seed=${String(seed)}, ticks=${String(result.totalTicks)}, outcome=${outcomeLabel}`,
    );

    if (result.isDraw) {
      draws++;
    } else {
      wins++;
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(
    `\nCompleted ${String(count)} match(es) in ${elapsed}s | wins=${String(wins)} draws=${String(draws)}`,
  );

  if (!dryRun) {
    console.log(`Logs written to: ${outputDir}/${runId}/`);
  }

  process.exit(0);
})().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
