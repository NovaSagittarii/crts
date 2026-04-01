import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type {
  MatchConfig,
  MatchHeader,
  MatchOutcomeRecord,
  MatchResult,
  NdjsonLine,
  TickRecord,
} from './types.js';

export class MatchLogger {
  private readonly outputDir: string;
  private readonly runId: string;

  public constructor(outputDir: string, runId: string) {
    this.outputDir = outputDir;
    this.runId = runId;
  }

  public async writeMatch(
    matchIndex: number,
    header: MatchHeader,
    tickRecords: TickRecord[],
    outcomeRecord: MatchOutcomeRecord,
  ): Promise<string> {
    const dirPath = join(this.outputDir, this.runId);
    const filePath = join(dirPath, `match-${matchIndex}.ndjson`);

    await mkdir(dirPath, { recursive: true });

    const lines: NdjsonLine[] = [header, ...tickRecords, outcomeRecord];
    const content = lines.map((line) => JSON.stringify(line)).join('\n') + '\n';

    await writeFile(filePath, content, 'utf-8');

    return filePath;
  }
}

export function createMatchHeader(
  config: MatchConfig,
  bots: [string, string],
): MatchHeader {
  return {
    type: 'header',
    seed: config.seed,
    config,
    bots,
    startedAt: new Date().toISOString(),
  };
}

export function createMatchOutcomeRecord(
  result: MatchResult,
): MatchOutcomeRecord {
  return {
    type: 'outcome',
    totalTicks: result.totalTicks,
    winner: result.outcome?.winner ?? null,
    ranked: result.outcome?.ranked ?? [],
    isDraw: result.isDraw,
  };
}

export function generateRunId(seed: number): string {
  return `${new Date().toISOString().replace(/[:.]/g, '-')}_seed-${seed}`;
}
