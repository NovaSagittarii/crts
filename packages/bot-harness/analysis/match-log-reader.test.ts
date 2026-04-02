import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { MatchHeader, MatchOutcomeRecord, TickRecord } from '../types.js';
import { discoverMatchFiles, readMatchFile } from './match-log-reader.js';

function createTestHeader(): MatchHeader {
  return {
    type: 'header',
    seed: 42,
    config: {
      seed: 42,
      gridWidth: 52,
      gridHeight: 52,
      maxTicks: 100,
      hashCheckpointInterval: 10,
    },
    bots: ['BotA', 'BotB'],
    startedAt: '2026-04-01T00:00:00.000Z',
  };
}

function createTestTick(tick: number): TickRecord {
  return {
    type: 'tick',
    tick,
    actions: [
      {
        teamId: 1,
        actionType: 'build',
        templateId: 'block',
        x: 10,
        y: 10,
        result: 'applied',
      },
    ],
    economy: [
      { teamId: 1, resources: 100, income: 10 },
      { teamId: 2, resources: 100, income: 10 },
    ],
    buildOutcomes: 1,
    destroyOutcomes: 0,
  };
}

function createTestOutcome(): MatchOutcomeRecord {
  return {
    type: 'outcome',
    totalTicks: 5,
    winner: null,
    ranked: [],
    isDraw: true,
  };
}

function buildNdjsonContent(
  header: MatchHeader,
  ticks: TickRecord[],
  outcome: MatchOutcomeRecord,
): string {
  const lines = [header, ...ticks, outcome];
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = path.join(
    os.tmpdir(),
    `analysis-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fs.mkdir(tmpDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('readMatchFile', () => {
  it('parses a valid NDJSON file into { header, ticks, outcome }', async () => {
    const header = createTestHeader();
    const ticks = [createTestTick(0), createTestTick(1), createTestTick(2)];
    const outcome = createTestOutcome();

    const filePath = path.join(tmpDir, 'match-0.ndjson');
    await fs.writeFile(filePath, buildNdjsonContent(header, ticks, outcome));

    const parsed = await readMatchFile(filePath);
    expect(parsed.header.type).toBe('header');
    expect(parsed.header.seed).toBe(42);
    expect(parsed.ticks).toHaveLength(3);
    expect(parsed.ticks[0].tick).toBe(0);
    expect(parsed.ticks[1].tick).toBe(1);
    expect(parsed.ticks[2].tick).toBe(2);
    expect(parsed.outcome.type).toBe('outcome');
    expect(parsed.outcome.isDraw).toBe(true);
  });

  it('handles empty lines gracefully', async () => {
    const header = createTestHeader();
    const tick = createTestTick(0);
    const outcome = createTestOutcome();

    const content =
      JSON.stringify(header) +
      '\n\n' +
      JSON.stringify(tick) +
      '\n\n' +
      JSON.stringify(outcome) +
      '\n';

    const filePath = path.join(tmpDir, 'match-with-blanks.ndjson');
    await fs.writeFile(filePath, content);

    const parsed = await readMatchFile(filePath);
    expect(parsed.header.type).toBe('header');
    expect(parsed.ticks).toHaveLength(1);
    expect(parsed.outcome.type).toBe('outcome');
  });

  it('preserves templateId in tick action records when present', async () => {
    const header = createTestHeader();
    const tick = createTestTick(0);
    const outcome = createTestOutcome();

    const filePath = path.join(tmpDir, 'match-templateid.ndjson');
    await fs.writeFile(filePath, buildNdjsonContent(header, [tick], outcome));

    const parsed = await readMatchFile(filePath);
    expect(parsed.ticks[0].actions[0].templateId).toBe('block');
  });

  it('handles missing templateId gracefully (old logs)', async () => {
    const header = createTestHeader();
    const tick: TickRecord = {
      type: 'tick',
      tick: 0,
      actions: [
        {
          teamId: 1,
          actionType: 'build',
          result: 'applied',
          // no templateId — old log format
        },
      ],
      economy: [
        { teamId: 1, resources: 100, income: 10 },
        { teamId: 2, resources: 100, income: 10 },
      ],
      buildOutcomes: 1,
      destroyOutcomes: 0,
    };
    const outcome = createTestOutcome();

    const filePath = path.join(tmpDir, 'match-old.ndjson');
    await fs.writeFile(filePath, buildNdjsonContent(header, [tick], outcome));

    const parsed = await readMatchFile(filePath);
    expect(parsed.ticks[0].actions[0].templateId).toBeUndefined();
  });
});

describe('discoverMatchFiles', () => {
  it('finds match-*.ndjson files sorted by index', async () => {
    // Create files in non-sorted order
    await fs.writeFile(path.join(tmpDir, 'match-2.ndjson'), '{}');
    await fs.writeFile(path.join(tmpDir, 'match-0.ndjson'), '{}');
    await fs.writeFile(path.join(tmpDir, 'match-10.ndjson'), '{}');
    await fs.writeFile(path.join(tmpDir, 'match-1.ndjson'), '{}');

    const files = await discoverMatchFiles(tmpDir);
    expect(files).toHaveLength(4);
    expect(files[0]).toContain('match-0.ndjson');
    expect(files[1]).toContain('match-1.ndjson');
    expect(files[2]).toContain('match-2.ndjson');
    expect(files[3]).toContain('match-10.ndjson');
  });

  it('returns empty array for directory with no match files', async () => {
    await fs.writeFile(path.join(tmpDir, 'other.txt'), 'hello');

    const files = await discoverMatchFiles(tmpDir);
    expect(files).toHaveLength(0);
  });

  it('ignores non-match ndjson files', async () => {
    await fs.writeFile(path.join(tmpDir, 'match-0.ndjson'), '{}');
    await fs.writeFile(path.join(tmpDir, 'summary.ndjson'), '{}');
    await fs.writeFile(path.join(tmpDir, 'match-notes.txt'), '');

    const files = await discoverMatchFiles(tmpDir);
    expect(files).toHaveLength(1);
    expect(files[0]).toContain('match-0.ndjson');
  });
});
