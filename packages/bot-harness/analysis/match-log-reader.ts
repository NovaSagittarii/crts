import { createReadStream } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

import type {
  MatchHeader,
  MatchOutcomeRecord,
  NdjsonLine,
  TickRecord,
} from '../types.js';
import type { ParsedMatch } from './types.js';

/**
 * Reads a single NDJSON match file and parses it into a ParsedMatch.
 * First line is the header, last line is the outcome, middle lines are ticks.
 * Empty lines are skipped.
 */
export async function readMatchFile(filePath: string): Promise<ParsedMatch> {
  const lines: NdjsonLine[] = [];

  const rl = createInterface({
    input: createReadStream(filePath, 'utf-8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    lines.push(JSON.parse(trimmed) as NdjsonLine);
  }

  if (lines.length < 2) {
    throw new Error(
      `Invalid match file: expected at least header + outcome, got ${String(lines.length)} lines in ${filePath}`,
    );
  }

  const header = lines[0] as MatchHeader;
  const outcome = lines[lines.length - 1] as MatchOutcomeRecord;
  const ticks: TickRecord[] = [];

  for (let i = 1; i < lines.length - 1; i++) {
    ticks.push(lines[i] as TickRecord);
  }

  return { header, ticks, outcome };
}

/** Pattern for match NDJSON filenames: match-{index}.ndjson */
const MATCH_FILE_PATTERN = /^match-(\d+)\.ndjson$/;

/**
 * Discovers match NDJSON files in a directory.
 * Filters for `match-*.ndjson` pattern and sorts by numeric index.
 * Returns full absolute paths.
 */
export async function discoverMatchFiles(matchDir: string): Promise<string[]> {
  const entries = await readdir(matchDir);

  const matchFiles: Array<{ index: number; name: string }> = [];

  for (const entry of entries) {
    const match = MATCH_FILE_PATTERN.exec(entry);
    if (match) {
      matchFiles.push({ index: parseInt(match[1], 10), name: entry });
    }
  }

  matchFiles.sort((a, b) => a.index - b.index);

  return matchFiles.map((f) => join(matchDir, f.name));
}
