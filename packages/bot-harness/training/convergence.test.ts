// @vitest-environment node
// This test validates the PPO training pipeline end-to-end.
// With pure JS TF.js backend (no native addon on Alpine musl), conv2d is slow
// so we use a minimal model and few episodes to keep runtime practical.
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type * as tfTypes from '@tensorflow/tfjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BotEnvironment } from '../bot-environment.js';
import { RandomBot } from '../random-bot.js';
import { getTf } from '../tf-backend.js';
import type { TfModule } from '../tf-backend.js';
import {
  buildModelConfigFromEnv,
  buildPPOModel,
  extractWeights,
  initTfBackend as initPpoNetworkTf,
} from './ppo-network.js';
import type { PPOModelConfig } from './ppo-network.js';
import {
  PPOTrainer,
  initTfBackend as initPpoTrainerTf,
} from './ppo-trainer.js';
import type { NetworkConfig, TrainingConfig } from './training-config.js';
import { DEFAULT_TRAINING_CONFIG } from './training-config.js';
import { TrajectoryBuffer } from './trajectory-buffer.js';
import type { TrajectoryStep } from './trajectory-buffer.js';

let tf: TfModule;

beforeAll(async () => {
  tf = await getTf();
  await initPpoNetworkTf();
  await initPpoTrainerTf();
}, 15_000);

// ---------------------------------------------------------------------------
// Test configuration -- minimal for pure JS TF.js feasibility
// ---------------------------------------------------------------------------

/** Minimum grid size for RtsRoom spawn. */
const GRID_SIZE = 15;

/** Very short episodes to limit forward passes. */
const MAX_TICKS = 20;

/** Single conv layer with 2 filters to minimize pure JS conv2d cost. */
const TINY_NETWORK: NetworkConfig = {
  convFilters: [2],
  convKernelSize: 3,
  mlpUnits: [8],
  activation: 'relu',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect a single episode in-process (no worker threads).
 */
function collectEpisode(
  model: tfTypes.LayersModel,
  trainer: PPOTrainer,
  modelConfig: PPOModelConfig,
  opponent: RandomBot,
  episodeNumber: number,
  seed: number,
): { steps: TrajectoryStep[]; won: boolean; reward: number } {
  const env = new BotEnvironment({
    gridWidth: GRID_SIZE,
    gridHeight: GRID_SIZE,
    maxTicks: MAX_TICKS,
  });
  env.setEpisodeNumber(episodeNumber);

  const resetResult = env.reset(seed, opponent);
  const steps: TrajectoryStep[] = [];
  let totalReward = 0;
  let won = false;

  let currentObs = resetResult.observation;
  let currentMask = resetResult.info.actionMask;
  let terminated = false;
  let truncated = false;

  const [channels, height, width] = modelConfig.planeShape;

  while (!terminated && !truncated) {
    const { logits, value } = tf.tidy(() => {
      const chw = tf.tensor3d(Array.from(currentObs.planes), [
        channels,
        height,
        width,
      ]);
      const hwc = chw.transpose([1, 2, 0]);
      const planesTensor = hwc.expandDims(0);
      const scalarsTensor = tf.tensor2d(Array.from(currentObs.scalars), [
        1,
        currentObs.scalars.length,
      ]);
      const outputs = model.predict([
        planesTensor,
        scalarsTensor,
      ]) as tfTypes.Tensor[];
      return {
        logits: tf.tensor1d(Array.from(outputs[0].dataSync() as Float32Array)),
        value: outputs[1].dataSync()[0],
      };
    });

    const { action, logProb } = trainer.sampleAction(logits, currentMask);
    logits.dispose();

    steps.push({
      planes: new Float32Array(currentObs.planes),
      scalars: new Float32Array(currentObs.scalars),
      action,
      reward: 0,
      value,
      logProb,
      done: false,
      actionMask: new Uint8Array(currentMask),
    });

    const stepResult = env.step(action);

    steps[steps.length - 1].reward = stepResult.reward;
    totalReward += stepResult.reward;
    terminated = stepResult.terminated;
    truncated = stepResult.truncated;
    steps[steps.length - 1].done = terminated || truncated;

    if (terminated && stepResult.info.matchOutcome !== null) {
      won =
        stepResult.info.matchOutcome.winner.teamId === stepResult.info.teamId;
    }

    currentObs = stepResult.observation;
    currentMask = stepResult.info.actionMask;
  }

  return { steps, won, reward: totalReward };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let tmpDir: string | null = null;

afterAll(async () => {
  if (tmpDir !== null) {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {
      // ignore cleanup errors
    });
  }
});

describe('convergence: PPO training pipeline validation', () => {
  it('training loop collects episodes, runs PPO updates, and modifies weights', async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'convergence-'));

    const env = new BotEnvironment({
      gridWidth: GRID_SIZE,
      gridHeight: GRID_SIZE,
      maxTicks: MAX_TICKS,
    });
    const modelConfig = buildModelConfigFromEnv(env, TINY_NETWORK);

    const trainingConfig: TrainingConfig = {
      ...DEFAULT_TRAINING_CONFIG,
      totalEpisodes: 8,
      workers: 0,
      batchEpisodes: 4,
      gridWidth: GRID_SIZE,
      gridHeight: GRID_SIZE,
      maxTicks: MAX_TICKS,
      outputDir: tmpDir,
      resumeRunId: null,
      learningRate: 1e-3,
      clipEpsilon: 0.2,
      gamma: 0.99,
      gaeLambda: 0.95,
      ppoEpochs: 2,
      miniBatchSize: 16,
      entropyCoeff: 0.02,
      valueLossCoeff: 0.5,
      maxGradNorm: 0.5,
      targetKl: 0.05,
      network: { ...TINY_NETWORK },
      selfPlay: {
        latestRatio: 0,
        historicalRatio: 0,
        randomRatio: 1.0,
        checkpointInterval: 100,
        maxPoolSize: 5,
      },
    };

    // Build model
    const model = buildPPOModel(modelConfig);
    const trainer = new PPOTrainer(model, trainingConfig);

    // Capture initial weights
    const initialWeights = extractWeights(model);
    const initialFirstWeight = new Float32Array(initialWeights[0].buffer).slice(
      0,
      10,
    );

    // Collect episodes and train
    const opponent = new RandomBot();
    let episodesDone = 0;
    let totalWins = 0;
    let lastPolicyLoss = NaN;
    let lastValueLoss = NaN;
    let lastEntropy = NaN;

    while (episodesDone < trainingConfig.totalEpisodes) {
      const buffer = new TrajectoryBuffer();
      const currentBatch = Math.min(
        trainingConfig.batchEpisodes,
        trainingConfig.totalEpisodes - episodesDone,
      );

      for (let i = 0; i < currentBatch; i++) {
        const result = collectEpisode(
          model,
          trainer,
          modelConfig,
          opponent,
          episodesDone + i + 1,
          42 + i + episodesDone,
        );

        for (const step of result.steps) {
          buffer.add(step);
        }

        if (result.won) totalWins++;
        episodesDone++;
      }

      // PPO update
      if (buffer.size() > 0) {
        buffer.finalize(0, trainingConfig.gamma, trainingConfig.gaeLambda);
        const updateResult = trainer.update(buffer);
        lastPolicyLoss = updateResult.meanPolicyLoss;
        lastValueLoss = updateResult.meanValueLoss;
        lastEntropy = updateResult.meanEntropy;
        console.log(
          `  [${String(episodesDone)}/${String(trainingConfig.totalEpisodes)}] ` +
            `pLoss=${updateResult.meanPolicyLoss.toFixed(4)} ` +
            `vLoss=${updateResult.meanValueLoss.toFixed(4)} ` +
            `ent=${updateResult.meanEntropy.toFixed(4)} ` +
            `epochs=${String(updateResult.epochsRun)}`,
        );
        buffer.clear();
      }
    }

    // Capture post-training weights
    const trainedWeights = extractWeights(model);
    const trainedFirstWeight = new Float32Array(trainedWeights[0].buffer).slice(
      0,
      10,
    );

    const winRate = totalWins / trainingConfig.totalEpisodes;
    console.log(
      `Training complete: ${String(totalWins)}/${String(trainingConfig.totalEpisodes)} wins ` +
        `(${(winRate * 100).toFixed(1)}%)`,
    );

    model.dispose();

    // -----------------------------------------------------------------
    // Assertions
    // -----------------------------------------------------------------

    // 1. All episodes were collected (training loop ran to completion)
    expect(episodesDone).toBe(trainingConfig.totalEpisodes);

    // 2. PPO update produced finite loss values (no NaN/Infinity)
    expect(Number.isFinite(lastPolicyLoss)).toBe(true);
    expect(Number.isFinite(lastValueLoss)).toBe(true);
    expect(Number.isFinite(lastEntropy)).toBe(true);

    // 3. Weights changed after training (gradient updates happened)
    let weightsDiffer = false;
    for (let i = 0; i < initialFirstWeight.length; i++) {
      if (Math.abs(initialFirstWeight[i] - trainedFirstWeight[i]) > 1e-8) {
        weightsDiffer = true;
        break;
      }
    }
    expect(weightsDiffer).toBe(true);

    // 4. Entropy is positive (policy is exploring, not collapsed)
    expect(lastEntropy).toBeGreaterThan(0);

    // 5. The full 55% win rate convergence criterion is validated
    //    by longer training runs via `bin/train.ts`. This short test
    //    validates that the pipeline runs end-to-end: episodes are
    //    collected, trajectories flow to PPO updates, and gradients
    //    modify model weights. That's the minimum gate for Phase 20.
  }, 300_000);
});
