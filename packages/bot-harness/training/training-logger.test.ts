import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_TRAINING_CONFIG } from './training-config.js';
import type { TrainingConfig } from './training-config.js';
import { TrainingLogger } from './training-logger.js';
import type { TrainingLogEntry } from './training-logger.js';

function makeSampleEntry(
  overrides?: Partial<TrainingLogEntry>,
): TrainingLogEntry {
  return {
    episode: 42,
    timestamp: '2026-04-01T12:00:00.000Z',
    reward: 1.23,
    cumulativeReward: 45.67,
    winRate: 0.65,
    opponent: 'RandomBot',
    policyLoss: 0.12,
    valueLoss: 0.34,
    entropy: 0.45,
    approxKl: 0.008,
    episodeTicks: 150,
    elapsedMs: 3200,
    ...overrides,
  };
}

describe('TrainingLogger', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'train-log-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('creates run directory structure on init', async () => {
    const logger = new TrainingLogger(tmpDir, 'run-test-001');
    await logger.init();

    const runDir = logger.getRunDir();
    const entries = await readdir(runDir);
    expect(entries).toContain('checkpoints');
    expect(entries).toContain('final-model');
  });

  it('logConfig writes config.json with the full TrainingConfig', async () => {
    const logger = new TrainingLogger(tmpDir, 'run-test-002');
    await logger.init();

    const config: TrainingConfig = { ...DEFAULT_TRAINING_CONFIG };
    await logger.logConfig(config);

    const configPath = join(logger.getRunDir(), 'config.json');
    const content = await readFile(configPath, 'utf-8');
    const parsed = JSON.parse(content) as TrainingConfig;

    expect(parsed.totalEpisodes).toBe(config.totalEpisodes);
    expect(parsed.learningRate).toBe(config.learningRate);
    expect(parsed.selfPlay.latestRatio).toBe(config.selfPlay.latestRatio);
    expect(parsed.network.convFilters).toEqual(config.network.convFilters);
  });

  it('logEpisode writes valid NDJSON line', async () => {
    const logger = new TrainingLogger(tmpDir, 'run-test-003');
    await logger.init();

    const entry = makeSampleEntry();
    await logger.logEpisode(entry);

    const logPath = join(logger.getRunDir(), 'training-log.ndjson');
    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(1);

    const parsed = JSON.parse(lines[0]) as TrainingLogEntry;
    expect(parsed.episode).toBe(42);
    expect(parsed.reward).toBe(1.23);
    expect(parsed.winRate).toBe(0.65);
    expect(parsed.opponent).toBe('RandomBot');
    expect(parsed.policyLoss).toBe(0.12);
    expect(parsed.valueLoss).toBe(0.34);
    expect(parsed.entropy).toBe(0.45);
    expect(parsed.approxKl).toBe(0.008);
  });

  it('logEpisode appends multiple NDJSON lines', async () => {
    const logger = new TrainingLogger(tmpDir, 'run-test-004');
    await logger.init();

    await logger.logEpisode(makeSampleEntry({ episode: 1 }));
    await logger.logEpisode(makeSampleEntry({ episode: 2 }));
    await logger.logEpisode(makeSampleEntry({ episode: 3 }));

    const logPath = join(logger.getRunDir(), 'training-log.ndjson');
    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(3);

    // Each line should be valid JSON
    for (const line of lines) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      expect(() => JSON.parse(line)).not.toThrow();
    }

    // Verify episode numbers
    const episodes = lines.map(
      (l) => (JSON.parse(l) as TrainingLogEntry).episode,
    );
    expect(episodes).toEqual([1, 2, 3]);
  });

  it('NDJSON lines are parseable with JSON.parse', async () => {
    const logger = new TrainingLogger(tmpDir, 'run-test-005');
    await logger.init();

    const entry = makeSampleEntry();
    await logger.logEpisode(entry);

    const logPath = join(logger.getRunDir(), 'training-log.ndjson');
    const content = await readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n');

    for (const line of lines) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(parsed).toBeDefined();
      expect(typeof parsed).toBe('object');
    }
  });

  it('getRunDir returns the correct path', () => {
    const logger = new TrainingLogger(tmpDir, 'run-test-006');
    expect(logger.getRunDir()).toBe(join(tmpDir, 'run-test-006'));
  });

  it('getCheckpointDir returns the correct path', () => {
    const logger = new TrainingLogger(tmpDir, 'run-test-007');
    expect(logger.getCheckpointDir()).toBe(
      join(tmpDir, 'run-test-007', 'checkpoints'),
    );
  });

  it('getFinalModelDir returns the correct path', () => {
    const logger = new TrainingLogger(tmpDir, 'run-test-008');
    expect(logger.getFinalModelDir()).toBe(
      join(tmpDir, 'run-test-008', 'final-model'),
    );
  });

  it('formatLiveMetrics returns a human-readable string with key fields', () => {
    const logger = new TrainingLogger(tmpDir, 'run-test-009');

    const entry = makeSampleEntry({
      episode: 42,
      reward: 1.23,
      winRate: 0.65,
      policyLoss: 0.12,
      valueLoss: 0.34,
      entropy: 0.45,
      approxKl: 0.008,
      episodeTicks: 150,
    });

    const startTime = Date.now() - 60000; // 1 minute ago
    const result = logger.formatLiveMetrics(entry, 1000, startTime);

    expect(result).toContain('42'); // episode
    expect(result).toContain('1000'); // total
    expect(result).toContain('1.23'); // reward
    expect(result).toContain('0.65'); // winRate
    expect(result).toContain('0.12'); // policyLoss
    expect(result).toContain('0.34'); // valueLoss
    expect(result).toContain('0.45'); // entropy
    expect(result).toContain('0.008'); // approxKl
    expect(result).toContain('150'); // episodeTicks
  });

  it('formatLiveMetrics includes ETA', () => {
    const logger = new TrainingLogger(tmpDir, 'run-test-010');

    const entry = makeSampleEntry({ episode: 100 });
    const startTime = Date.now() - 120000; // 2 minutes ago
    const result = logger.formatLiveMetrics(entry, 1000, startTime);

    // ETA should be present in some form (minutes/seconds)
    expect(result).toMatch(/ETA/i);
  });
});
