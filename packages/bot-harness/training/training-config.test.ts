import { describe, expect, it } from 'vitest';

import {
  DEFAULT_GRID_HEIGHT,
  DEFAULT_GRID_WIDTH,
  DEFAULT_MAX_TICKS,
} from '../types.js';

import {
  DEFAULT_NETWORK_CONFIG,
  DEFAULT_SELF_PLAY_CONFIG,
  DEFAULT_TRAINING_CONFIG,
  generateTrainingRunId,
  parseTrainingArgs,
} from './training-config.js';

describe('DEFAULT_TRAINING_CONFIG', () => {
  it('has all required PPO hyperparameter fields with correct types', () => {
    expect(typeof DEFAULT_TRAINING_CONFIG.totalEpisodes).toBe('number');
    expect(typeof DEFAULT_TRAINING_CONFIG.learningRate).toBe('number');
    expect(typeof DEFAULT_TRAINING_CONFIG.clipEpsilon).toBe('number');
    expect(typeof DEFAULT_TRAINING_CONFIG.gamma).toBe('number');
    expect(typeof DEFAULT_TRAINING_CONFIG.gaeLambda).toBe('number');
    expect(typeof DEFAULT_TRAINING_CONFIG.ppoEpochs).toBe('number');
    expect(typeof DEFAULT_TRAINING_CONFIG.miniBatchSize).toBe('number');
    expect(typeof DEFAULT_TRAINING_CONFIG.entropyCoeff).toBe('number');
    expect(typeof DEFAULT_TRAINING_CONFIG.valueLossCoeff).toBe('number');
    expect(typeof DEFAULT_TRAINING_CONFIG.maxGradNorm).toBe('number');
    expect(typeof DEFAULT_TRAINING_CONFIG.targetKl).toBe('number');
  });

  it('has parallelism and I/O fields', () => {
    expect(typeof DEFAULT_TRAINING_CONFIG.workers).toBe('number');
    expect(typeof DEFAULT_TRAINING_CONFIG.batchEpisodes).toBe('number');
    expect(typeof DEFAULT_TRAINING_CONFIG.outputDir).toBe('string');
    expect(DEFAULT_TRAINING_CONFIG.resumeRunId).toBeNull();
  });

  it('has nested network config with correct defaults', () => {
    expect(DEFAULT_TRAINING_CONFIG.network).toBeDefined();
    expect(DEFAULT_TRAINING_CONFIG.network.convFilters).toEqual([32, 64, 64]);
    expect(DEFAULT_TRAINING_CONFIG.network.convKernelSize).toBe(3);
    expect(DEFAULT_TRAINING_CONFIG.network.mlpUnits).toEqual([256, 128]);
    expect(DEFAULT_TRAINING_CONFIG.network.activation).toBe('relu');
  });

  it('has nested self-play config with correct defaults', () => {
    expect(DEFAULT_TRAINING_CONFIG.selfPlay).toBeDefined();
    expect(DEFAULT_TRAINING_CONFIG.selfPlay.latestRatio).toBe(0.5);
    expect(DEFAULT_TRAINING_CONFIG.selfPlay.historicalRatio).toBe(0.3);
    expect(DEFAULT_TRAINING_CONFIG.selfPlay.randomRatio).toBe(0.2);
    expect(DEFAULT_TRAINING_CONFIG.selfPlay.checkpointInterval).toBe(50);
    expect(DEFAULT_TRAINING_CONFIG.selfPlay.maxPoolSize).toBe(30);
  });

  it('has grid and environment defaults matching bot-harness constants', () => {
    expect(DEFAULT_TRAINING_CONFIG.gridWidth).toBe(DEFAULT_GRID_WIDTH);
    expect(DEFAULT_TRAINING_CONFIG.gridHeight).toBe(DEFAULT_GRID_HEIGHT);
    expect(DEFAULT_TRAINING_CONFIG.maxTicks).toBe(DEFAULT_MAX_TICKS);
  });

  it('has correct PPO default values', () => {
    expect(DEFAULT_TRAINING_CONFIG.totalEpisodes).toBe(1000);
    expect(DEFAULT_TRAINING_CONFIG.learningRate).toBeCloseTo(3e-4);
    expect(DEFAULT_TRAINING_CONFIG.clipEpsilon).toBe(0.2);
    expect(DEFAULT_TRAINING_CONFIG.gamma).toBe(0.99);
    expect(DEFAULT_TRAINING_CONFIG.gaeLambda).toBe(0.95);
    expect(DEFAULT_TRAINING_CONFIG.ppoEpochs).toBe(4);
    expect(DEFAULT_TRAINING_CONFIG.miniBatchSize).toBe(64);
    expect(DEFAULT_TRAINING_CONFIG.entropyCoeff).toBe(0.01);
    expect(DEFAULT_TRAINING_CONFIG.valueLossCoeff).toBe(0.5);
    expect(DEFAULT_TRAINING_CONFIG.maxGradNorm).toBe(0.5);
    expect(DEFAULT_TRAINING_CONFIG.targetKl).toBe(0.015);
  });
});

describe('DEFAULT_NETWORK_CONFIG', () => {
  it('matches the network sub-config in DEFAULT_TRAINING_CONFIG', () => {
    expect(DEFAULT_NETWORK_CONFIG.convFilters).toEqual(
      DEFAULT_TRAINING_CONFIG.network.convFilters,
    );
    expect(DEFAULT_NETWORK_CONFIG.convKernelSize).toBe(
      DEFAULT_TRAINING_CONFIG.network.convKernelSize,
    );
    expect(DEFAULT_NETWORK_CONFIG.mlpUnits).toEqual(
      DEFAULT_TRAINING_CONFIG.network.mlpUnits,
    );
    expect(DEFAULT_NETWORK_CONFIG.activation).toBe(
      DEFAULT_TRAINING_CONFIG.network.activation,
    );
  });
});

describe('DEFAULT_SELF_PLAY_CONFIG', () => {
  it('matches the selfPlay sub-config in DEFAULT_TRAINING_CONFIG', () => {
    expect(DEFAULT_SELF_PLAY_CONFIG.latestRatio).toBe(
      DEFAULT_TRAINING_CONFIG.selfPlay.latestRatio,
    );
    expect(DEFAULT_SELF_PLAY_CONFIG.historicalRatio).toBe(
      DEFAULT_TRAINING_CONFIG.selfPlay.historicalRatio,
    );
    expect(DEFAULT_SELF_PLAY_CONFIG.randomRatio).toBe(
      DEFAULT_TRAINING_CONFIG.selfPlay.randomRatio,
    );
    expect(DEFAULT_SELF_PLAY_CONFIG.checkpointInterval).toBe(
      DEFAULT_TRAINING_CONFIG.selfPlay.checkpointInterval,
    );
    expect(DEFAULT_SELF_PLAY_CONFIG.maxPoolSize).toBe(
      DEFAULT_TRAINING_CONFIG.selfPlay.maxPoolSize,
    );
  });
});

describe('parseTrainingArgs', () => {
  it('returns defaults when called with no args', () => {
    const config = parseTrainingArgs([]);
    expect(config.totalEpisodes).toBe(DEFAULT_TRAINING_CONFIG.totalEpisodes);
    expect(config.learningRate).toBe(DEFAULT_TRAINING_CONFIG.learningRate);
    expect(config.clipEpsilon).toBe(DEFAULT_TRAINING_CONFIG.clipEpsilon);
    expect(config.gamma).toBe(DEFAULT_TRAINING_CONFIG.gamma);
    expect(config.gaeLambda).toBe(DEFAULT_TRAINING_CONFIG.gaeLambda);
    expect(config.ppoEpochs).toBe(DEFAULT_TRAINING_CONFIG.ppoEpochs);
    expect(config.miniBatchSize).toBe(DEFAULT_TRAINING_CONFIG.miniBatchSize);
    expect(config.entropyCoeff).toBe(DEFAULT_TRAINING_CONFIG.entropyCoeff);
    expect(config.valueLossCoeff).toBe(DEFAULT_TRAINING_CONFIG.valueLossCoeff);
    expect(config.maxGradNorm).toBe(DEFAULT_TRAINING_CONFIG.maxGradNorm);
    expect(config.targetKl).toBe(DEFAULT_TRAINING_CONFIG.targetKl);
    expect(config.workers).toBe(0);
    expect(config.batchEpisodes).toBe(0);
    expect(config.outputDir).toBe('runs');
    expect(config.resumeRunId).toBeNull();
    expect(config.gridWidth).toBe(DEFAULT_GRID_WIDTH);
    expect(config.gridHeight).toBe(DEFAULT_GRID_HEIGHT);
    expect(config.maxTicks).toBe(DEFAULT_MAX_TICKS);
  });

  it('overrides episodes and lr from CLI flags', () => {
    const config = parseTrainingArgs(['--episodes', '500', '--lr', '1e-3']);
    expect(config.totalEpisodes).toBe(500);
    expect(config.learningRate).toBeCloseTo(0.001);
  });

  it('parses --conv-filters as comma-separated integer array', () => {
    const config = parseTrainingArgs(['--conv-filters', '16,32']);
    expect(config.network.convFilters).toEqual([16, 32]);
  });

  it('parses --mlp-units as comma-separated integer array', () => {
    const config = parseTrainingArgs(['--mlp-units', '64,32,16']);
    expect(config.network.mlpUnits).toEqual([64, 32, 16]);
  });

  it('sets resumeRunId from --resume flag', () => {
    const config = parseTrainingArgs(['--resume', 'my-run-id']);
    expect(config.resumeRunId).toBe('my-run-id');
  });

  it('parses self-play ratios', () => {
    const config = parseTrainingArgs([
      '--latest-ratio', '0.7',
      '--historical-ratio', '0.2',
      '--random-ratio', '0.1',
    ]);
    expect(config.selfPlay.latestRatio).toBeCloseTo(0.7);
    expect(config.selfPlay.historicalRatio).toBeCloseTo(0.2);
    expect(config.selfPlay.randomRatio).toBeCloseTo(0.1);
  });

  it('parses all PPO hyperparameter flags', () => {
    const config = parseTrainingArgs([
      '--clip-epsilon', '0.1',
      '--gamma', '0.95',
      '--gae-lambda', '0.9',
      '--ppo-epochs', '8',
      '--mini-batch-size', '128',
      '--entropy-coeff', '0.02',
      '--value-loss-coeff', '1.0',
      '--max-grad-norm', '1.0',
      '--target-kl', '0.02',
    ]);
    expect(config.clipEpsilon).toBeCloseTo(0.1);
    expect(config.gamma).toBeCloseTo(0.95);
    expect(config.gaeLambda).toBeCloseTo(0.9);
    expect(config.ppoEpochs).toBe(8);
    expect(config.miniBatchSize).toBe(128);
    expect(config.entropyCoeff).toBeCloseTo(0.02);
    expect(config.valueLossCoeff).toBeCloseTo(1.0);
    expect(config.maxGradNorm).toBeCloseTo(1.0);
    expect(config.targetKl).toBeCloseTo(0.02);
  });

  it('parses grid and environment flags', () => {
    const config = parseTrainingArgs([
      '--grid-width', '20',
      '--grid-height', '30',
      '--max-ticks', '500',
    ]);
    expect(config.gridWidth).toBe(20);
    expect(config.gridHeight).toBe(30);
    expect(config.maxTicks).toBe(500);
  });

  it('parses parallelism flags', () => {
    const config = parseTrainingArgs([
      '--workers', '4',
      '--batch-episodes', '16',
    ]);
    expect(config.workers).toBe(4);
    expect(config.batchEpisodes).toBe(16);
  });

  it('parses checkpoint-interval and max-pool-size', () => {
    const config = parseTrainingArgs([
      '--checkpoint-interval', '25',
      '--max-pool-size', '50',
    ]);
    expect(config.selfPlay.checkpointInterval).toBe(25);
    expect(config.selfPlay.maxPoolSize).toBe(50);
  });

  it('parses output-dir flag', () => {
    const config = parseTrainingArgs(['--output-dir', '/tmp/training']);
    expect(config.outputDir).toBe('/tmp/training');
  });

  it('default config has noTui set to false', () => {
    const config = parseTrainingArgs([]);
    expect(config.noTui).toBe(false);
  });

  it('parses --no-tui flag to set noTui to true', () => {
    const config = parseTrainingArgs(['--no-tui']);
    expect(config.noTui).toBe(true);
  });

  it('keeps noTui false when --no-tui is not provided', () => {
    const config = parseTrainingArgs(['--episodes', '100']);
    expect(config.noTui).toBe(false);
  });
});

describe('generateTrainingRunId', () => {
  it('returns a string matching the run-YYYYMMDD-HHMMSS pattern', () => {
    const id = generateTrainingRunId();
    expect(id).toMatch(/^run-\d{8}-\d{6}$/);
  });

  it('starts with "run-"', () => {
    const id = generateTrainingRunId();
    expect(id.startsWith('run-')).toBe(true);
  });

  it('has 19 characters total (run- + 8 date + - + 6 time)', () => {
    const id = generateTrainingRunId();
    // "run-" (4) + "YYYYMMDD" (8) + "-" (1) + "HHMMSS" (6) = 19
    expect(id).toHaveLength(19);
  });
});
