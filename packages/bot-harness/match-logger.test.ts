import { existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NoOpBot } from './noop-bot.js';
import {
  MatchLogger,
  createMatchHeader,
  createMatchOutcomeRecord,
  generateRunId,
} from './match-logger.js';
import { runMatch } from './match-runner.js';
import type {
  MatchConfig,
  MatchResult,
  TickRecord,
  MatchHeader,
  MatchOutcomeRecord,
} from './types.js';

function createSmallConfig(overrides: Partial<MatchConfig> = {}): MatchConfig {
  return {
    seed: 42,
    gridWidth: 52,
    gridHeight: 52,
    maxTicks: 20,
    hashCheckpointInterval: 5,
    ...overrides,
  };
}

function runCollectingRecords(config: MatchConfig): {
  result: MatchResult;
  tickRecords: TickRecord[];
} {
  const tickRecords: TickRecord[] = [];
  const result = runMatch(config, new NoOpBot(), new NoOpBot(), {
    onTickComplete: (_tick: number, record: TickRecord) => {
      tickRecords.push(record);
    },
  });
  return { result, tickRecords };
}

describe('MatchLogger', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `match-logger-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('writeMatch creates an NDJSON file with first line containing type header and seed and bot names', async () => {
    const config = createSmallConfig();
    const { result, tickRecords } = runCollectingRecords(config);
    const header = createMatchHeader(config, [new NoOpBot().name, new NoOpBot().name]);
    const outcomeRecord = createMatchOutcomeRecord(result);

    const logger = new MatchLogger(testDir, 'test-run');
    const filePath = await logger.writeMatch(0, header, tickRecords, outcomeRecord);

    expect(existsSync(filePath)).toBe(true);
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const firstLine = JSON.parse(lines[0]) as MatchHeader;
    expect(firstLine.type).toBe('header');
    expect(firstLine.seed).toBe(42);
    expect(firstLine.bots).toEqual(['NoOpBot', 'NoOpBot']);
  });

  it('writeMatch NDJSON file has one tick line per tick containing type tick', async () => {
    const config = createSmallConfig({ maxTicks: 10 });
    const { result, tickRecords } = runCollectingRecords(config);
    const header = createMatchHeader(config, result.bots);
    const outcomeRecord = createMatchOutcomeRecord(result);

    const logger = new MatchLogger(testDir, 'test-run');
    const filePath = await logger.writeMatch(0, header, tickRecords, outcomeRecord);

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    // First line is header, last line is outcome, middle lines are ticks
    const tickLines = lines.slice(1, -1);
    expect(tickLines).toHaveLength(10);
    for (const line of tickLines) {
      const parsed = JSON.parse(line) as TickRecord;
      expect(parsed.type).toBe('tick');
    }
  });

  it('writeMatch NDJSON file has final line containing type outcome', async () => {
    const config = createSmallConfig({ maxTicks: 5 });
    const { result, tickRecords } = runCollectingRecords(config);
    const header = createMatchHeader(config, result.bots);
    const outcomeRecord = createMatchOutcomeRecord(result);

    const logger = new MatchLogger(testDir, 'test-run');
    const filePath = await logger.writeMatch(0, header, tickRecords, outcomeRecord);

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const lastLine = JSON.parse(lines[lines.length - 1]) as MatchOutcomeRecord;
    expect(lastLine.type).toBe('outcome');
    expect(lastLine.totalTicks).toBe(5);
    expect(lastLine.isDraw).toBe(true);
  });

  it('tick lines with hash checkpoint interval contain a hash field (string, non-empty)', async () => {
    const config = createSmallConfig({ maxTicks: 20, hashCheckpointInterval: 5 });
    const { result, tickRecords } = runCollectingRecords(config);
    const header = createMatchHeader(config, result.bots);
    const outcomeRecord = createMatchOutcomeRecord(result);

    const logger = new MatchLogger(testDir, 'test-run');
    const filePath = await logger.writeMatch(0, header, tickRecords, outcomeRecord);

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const tickLines = lines.slice(1, -1);

    // Ticks 0, 5, 10, 15 should have hash (multiples of 5)
    for (const line of tickLines) {
      const parsed = JSON.parse(line) as TickRecord;
      if (parsed.tick % 5 === 0) {
        expect(parsed.hash).toBeDefined();
        expect(typeof parsed.hash).toBe('string');
        expect(parsed.hash!.length).toBeGreaterThan(0);
      }
    }
  });

  it('tick lines without hash checkpoint interval do NOT contain a hash field', async () => {
    const config = createSmallConfig({ maxTicks: 20, hashCheckpointInterval: 5 });
    const { result, tickRecords } = runCollectingRecords(config);
    const header = createMatchHeader(config, result.bots);
    const outcomeRecord = createMatchOutcomeRecord(result);

    const logger = new MatchLogger(testDir, 'test-run');
    const filePath = await logger.writeMatch(0, header, tickRecords, outcomeRecord);

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    const tickLines = lines.slice(1, -1);

    for (const line of tickLines) {
      const parsed = JSON.parse(line) as TickRecord;
      if (parsed.tick % 5 !== 0) {
        expect(parsed.hash).toBeUndefined();
      }
    }
  });

  it('file path follows outputDir/runId/match-N.ndjson pattern', async () => {
    const config = createSmallConfig({ maxTicks: 5 });
    const { result, tickRecords } = runCollectingRecords(config);
    const header = createMatchHeader(config, result.bots);
    const outcomeRecord = createMatchOutcomeRecord(result);

    const logger = new MatchLogger(testDir, 'my-run-id');
    const filePath = await logger.writeMatch(3, header, tickRecords, outcomeRecord);

    expect(filePath).toBe(join(testDir, 'my-run-id', 'match-3.ndjson'));
    expect(existsSync(filePath)).toBe(true);
  });

  it('directory is created if it does not exist (mkdir -p equivalent)', async () => {
    const config = createSmallConfig({ maxTicks: 5 });
    const { result, tickRecords } = runCollectingRecords(config);
    const header = createMatchHeader(config, result.bots);
    const outcomeRecord = createMatchOutcomeRecord(result);

    const nestedDir = join(testDir, 'nested', 'deep');
    const logger = new MatchLogger(nestedDir, 'nested-run');
    const filePath = await logger.writeMatch(0, header, tickRecords, outcomeRecord);

    expect(existsSync(filePath)).toBe(true);
    expect(filePath).toContain('nested-run');
  });

  it('each line of the NDJSON file is valid JSON (JSON.parse does not throw)', async () => {
    const config = createSmallConfig({ maxTicks: 10 });
    const { result, tickRecords } = runCollectingRecords(config);
    const header = createMatchHeader(config, result.bots);
    const outcomeRecord = createMatchOutcomeRecord(result);

    const logger = new MatchLogger(testDir, 'json-test');
    const filePath = await logger.writeMatch(0, header, tickRecords, outcomeRecord);

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});

describe('createMatchHeader', () => {
  it('creates a header with type, seed, config, bots, and startedAt', () => {
    const config = createSmallConfig({ seed: 99 });
    const header = createMatchHeader(config, ['BotA', 'BotB']);
    expect(header.type).toBe('header');
    expect(header.seed).toBe(99);
    expect(header.config).toEqual(config);
    expect(header.bots).toEqual(['BotA', 'BotB']);
    expect(typeof header.startedAt).toBe('string');
  });
});

describe('createMatchOutcomeRecord', () => {
  it('creates outcome record for a draw', () => {
    const config = createSmallConfig();
    const result: MatchResult = {
      seed: 42,
      config,
      outcome: null,
      totalTicks: 20,
      bots: ['BotA', 'BotB'],
      isDraw: true,
    };
    const record = createMatchOutcomeRecord(result);
    expect(record.type).toBe('outcome');
    expect(record.totalTicks).toBe(20);
    expect(record.winner).toBeNull();
    expect(record.ranked).toEqual([]);
    expect(record.isDraw).toBe(true);
  });
});

describe('generateRunId', () => {
  it('returns a run ID with timestamp and seed', () => {
    const runId = generateRunId(42);
    expect(runId).toContain('seed-42');
    // Should contain date-like prefix
    expect(runId).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
