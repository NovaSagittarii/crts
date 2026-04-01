import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as tf from '@tensorflow/tfjs';

import { OpponentPool } from './opponent-pool.js';
import type { SelfPlayConfig } from './training-config.js';
import type { PPOModelConfig } from './ppo-network.js';
import { buildPPOModel } from './ppo-network.js';

function makeSelfPlayConfig(overrides?: Partial<SelfPlayConfig>): SelfPlayConfig {
  return {
    latestRatio: 0.5,
    historicalRatio: 0.3,
    randomRatio: 0.2,
    checkpointInterval: 50,
    maxPoolSize: 30,
    ...overrides,
  };
}

/** Build a tiny model for testing. */
function buildTinyModel(): tf.LayersModel {
  const config: PPOModelConfig = {
    planeShape: [2, 4, 4],
    scalarCount: 3,
    actionCount: 8,
    convFilters: [4],
    convKernelSize: 3,
    mlpUnits: [8],
    activation: 'relu',
  };
  return buildPPOModel(config);
}

describe('OpponentPool', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'opp-pool-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('seeds with RandomBot and NoOpBot entries', () => {
    const config = makeSelfPlayConfig();
    const pool = new OpponentPool(config, join(tmpDir, 'checkpoints'));

    // Should have 2 built-in bots
    const builtIns = pool.getBuiltInBots();
    expect(builtIns).toHaveLength(2);
    const names = builtIns.map((e) => e.name);
    expect(names).toContain('RandomBot');
    expect(names).toContain('NoOpBot');
    // All built-in bots have type 'random'
    for (const entry of builtIns) {
      expect(entry.type).toBe('random');
      expect(entry.path).toBeNull();
      expect(entry.episode).toBe(-1);
      expect(entry.strategy).not.toBeNull();
    }
  });

  it('sampleOpponent returns entries following the configured ratio (statistical)', () => {
    const config = makeSelfPlayConfig({
      latestRatio: 0.5,
      historicalRatio: 0.3,
      randomRatio: 0.2,
    });
    const pool = new OpponentPool(config, join(tmpDir, 'checkpoints'));

    // Add some historical checkpoints so all categories are available
    pool.addCheckpoint(join(tmpDir, 'cp1'), 50);
    pool.addCheckpoint(join(tmpDir, 'cp2'), 100);

    const counts = { latest: 0, historical: 0, random: 0 };
    const totalSamples = 1000;

    for (let i = 0; i < totalSamples; i++) {
      const entry = pool.sampleOpponent();
      counts[entry.type]++;
    }

    // Check within 10% tolerance
    expect(counts.latest / totalSamples).toBeGreaterThanOrEqual(0.40);
    expect(counts.latest / totalSamples).toBeLessThanOrEqual(0.60);
    expect(counts.historical / totalSamples).toBeGreaterThanOrEqual(0.20);
    expect(counts.historical / totalSamples).toBeLessThanOrEqual(0.40);
    expect(counts.random / totalSamples).toBeGreaterThanOrEqual(0.10);
    expect(counts.random / totalSamples).toBeLessThanOrEqual(0.30);
  });

  it('sampleOpponent with no historical checkpoints falls back correctly', () => {
    const config = makeSelfPlayConfig({
      latestRatio: 0.5,
      historicalRatio: 0.3,
      randomRatio: 0.2,
    });
    const pool = new OpponentPool(config, join(tmpDir, 'checkpoints'));

    // No checkpoints at all -- should only return random (built-in) bots
    const totalSamples = 100;
    for (let i = 0; i < totalSamples; i++) {
      const entry = pool.sampleOpponent();
      expect(entry.type).toBe('random');
      expect(entry.strategy).not.toBeNull();
    }
  });

  it('addCheckpoint stores a new checkpoint entry', () => {
    const config = makeSelfPlayConfig();
    const pool = new OpponentPool(config, join(tmpDir, 'checkpoints'));

    expect(pool.getPoolSize()).toBe(0);
    pool.addCheckpoint(join(tmpDir, 'cp1'), 50);
    expect(pool.getPoolSize()).toBe(1);
    pool.addCheckpoint(join(tmpDir, 'cp2'), 100);
    expect(pool.getPoolSize()).toBe(2);
  });

  it('addCheckpoint evicts oldest checkpoint via FIFO when exceeding maxPoolSize', () => {
    const config = makeSelfPlayConfig({ maxPoolSize: 3 });
    const pool = new OpponentPool(config, join(tmpDir, 'checkpoints'));

    pool.addCheckpoint(join(tmpDir, 'cp1'), 50);
    pool.addCheckpoint(join(tmpDir, 'cp2'), 100);
    pool.addCheckpoint(join(tmpDir, 'cp3'), 150);
    expect(pool.getPoolSize()).toBe(3);

    // Adding a 4th should evict cp1 (oldest)
    pool.addCheckpoint(join(tmpDir, 'cp4'), 200);
    expect(pool.getPoolSize()).toBe(3);

    // Adding a 5th should evict cp2
    pool.addCheckpoint(join(tmpDir, 'cp5'), 250);
    expect(pool.getPoolSize()).toBe(3);

    // The latest checkpoint path should be cp5
    expect(pool.getLatestCheckpointPath()).toBe(join(tmpDir, 'cp5'));
  });

  it('addCheckpoint does NOT evict the built-in RandomBot/NoOpBot entries', () => {
    const config = makeSelfPlayConfig({ maxPoolSize: 2 });
    const pool = new OpponentPool(config, join(tmpDir, 'checkpoints'));

    // Add enough to trigger eviction
    pool.addCheckpoint(join(tmpDir, 'cp1'), 50);
    pool.addCheckpoint(join(tmpDir, 'cp2'), 100);
    pool.addCheckpoint(join(tmpDir, 'cp3'), 150);

    // Built-in bots should still be there
    const builtIns = pool.getBuiltInBots();
    expect(builtIns).toHaveLength(2);
    expect(builtIns.map((e) => e.name)).toContain('RandomBot');
    expect(builtIns.map((e) => e.name)).toContain('NoOpBot');
  });

  it('getLatestCheckpointPath returns the most recently added checkpoint path', () => {
    const config = makeSelfPlayConfig();
    const pool = new OpponentPool(config, join(tmpDir, 'checkpoints'));

    expect(pool.getLatestCheckpointPath()).toBeNull();

    pool.addCheckpoint(join(tmpDir, 'cp1'), 50);
    expect(pool.getLatestCheckpointPath()).toBe(join(tmpDir, 'cp1'));

    pool.addCheckpoint(join(tmpDir, 'cp2'), 100);
    expect(pool.getLatestCheckpointPath()).toBe(join(tmpDir, 'cp2'));
  });

  it('shouldCheckpoint returns true every checkpointInterval episodes', () => {
    const config = makeSelfPlayConfig({ checkpointInterval: 50 });
    const pool = new OpponentPool(config, join(tmpDir, 'checkpoints'));

    expect(pool.shouldCheckpoint(0)).toBe(false);
    expect(pool.shouldCheckpoint(1)).toBe(false);
    expect(pool.shouldCheckpoint(49)).toBe(false);
    expect(pool.shouldCheckpoint(50)).toBe(true);
    expect(pool.shouldCheckpoint(51)).toBe(false);
    expect(pool.shouldCheckpoint(100)).toBe(true);
    expect(pool.shouldCheckpoint(150)).toBe(true);
  });

  it('saveCheckpoint writes model to disk and adds to pool', async () => {
    const config = makeSelfPlayConfig();
    const checkpointDir = join(tmpDir, 'checkpoints');
    const pool = new OpponentPool(config, checkpointDir);
    const model = buildTinyModel();

    try {
      const savedPath = await pool.saveCheckpoint(model, 50);

      expect(savedPath).toBe(join(checkpointDir, 'checkpoint-50'));
      expect(pool.getPoolSize()).toBe(1);
      expect(pool.getLatestCheckpointPath()).toBe(savedPath);
    } finally {
      model.dispose();
    }
  });

  it('loadOpponentWeights returns null for built-in bots', async () => {
    const config = makeSelfPlayConfig();
    const pool = new OpponentPool(config, join(tmpDir, 'checkpoints'));
    const builtIns = pool.getBuiltInBots();

    const weights = await pool.loadOpponentWeights(builtIns[0]);
    expect(weights).toBeNull();
  });

  it('loadOpponentWeights loads weights from a saved checkpoint', async () => {
    const config = makeSelfPlayConfig();
    const checkpointDir = join(tmpDir, 'checkpoints');
    const pool = new OpponentPool(config, checkpointDir);
    const model = buildTinyModel();

    try {
      const savedPath = await pool.saveCheckpoint(model, 50);

      // Create entry to load
      const entry = {
        type: 'historical' as const,
        name: 'checkpoint-50',
        path: savedPath,
        episode: 50,
        strategy: null,
      };

      const weights = await pool.loadOpponentWeights(entry);
      expect(weights).not.toBeNull();
      expect(weights!.length).toBeGreaterThan(0);
      // Each weight should have shape and buffer
      for (const w of weights!) {
        expect(w.shape).toBeDefined();
        expect(w.buffer).toBeInstanceOf(ArrayBuffer);
      }
    } finally {
      model.dispose();
    }
  });
});
