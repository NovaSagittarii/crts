import type * as tfTypes from '@tensorflow/tfjs';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { getTf } from '../tf-backend.js';
import type { TfModule } from '../tf-backend.js';
import type { PPOModelConfig } from './ppo-network.js';
import {
  buildPPOModel,
  initTfBackend as initPpoNetworkTf,
} from './ppo-network.js';
import type { TrainStepResult } from './ppo-trainer.js';
import {
  PPOTrainer,
  initTfBackend as initPpoTrainerTf,
} from './ppo-trainer.js';
import type { TrainingConfig } from './training-config.js';
import { DEFAULT_TRAINING_CONFIG } from './training-config.js';
import type { TrajectoryBatch } from './trajectory-buffer.js';
import { TrajectoryBuffer } from './trajectory-buffer.js';

let tf: TfModule;

beforeAll(async () => {
  tf = await getTf();
  await initPpoNetworkTf();
  await initPpoTrainerTf();
}, 15_000);

// Small test model: 4x4 grid, 2 channels, 2 conv filters, 8 MLP units
const TEST_MODEL_CONFIG: PPOModelConfig = {
  planeShape: [2, 4, 4], // [C, H, W] channel-first
  scalarCount: 3,
  actionCount: 5,
  convFilters: [2],
  convKernelSize: 3,
  mlpUnits: [8],
  activation: 'relu',
};

const TEST_TRAINING_CONFIG: TrainingConfig = {
  ...DEFAULT_TRAINING_CONFIG,
  learningRate: 1e-3,
  clipEpsilon: 0.2,
  entropyCoeff: 0.01,
  valueLossCoeff: 0.5,
  maxGradNorm: 0.5,
  targetKl: 0.015,
  ppoEpochs: 4,
  miniBatchSize: 4,
};

function makeSyntheticBatch(
  actionCount: number,
  size: number,
): TrajectoryBatch {
  // 4x4 grid, 2 channels -> planes have 2*4*4 = 32 elements
  const planes: Float32Array[] = [];
  const scalars: Float32Array[] = [];
  const actionMasks: Uint8Array[] = [];
  const actions = new Int32Array(size);
  const oldLogProbs = new Float32Array(size);
  const advantages = new Float32Array(size);
  const returns = new Float32Array(size);

  for (let i = 0; i < size; i++) {
    const p = new Float32Array(32);
    for (let j = 0; j < 32; j++) p[j] = Math.random();
    planes.push(p);

    const s = new Float32Array(3);
    for (let j = 0; j < 3; j++) s[j] = Math.random();
    scalars.push(s);

    const mask = new Uint8Array(actionCount);
    for (let j = 0; j < actionCount; j++) mask[j] = 1; // all valid
    actionMasks.push(mask);

    actions[i] = Math.floor(Math.random() * actionCount);
    oldLogProbs[i] = -Math.log(actionCount); // uniform log prob
    advantages[i] = (Math.random() - 0.5) * 2; // [-1, 1]
    returns[i] = Math.random() * 2;
  }

  return {
    planes,
    scalars,
    actions,
    oldLogProbs,
    advantages,
    returns,
    actionMasks,
    size,
  };
}

describe('PPOTrainer', () => {
  let model: tfTypes.LayersModel;
  let trainer: PPOTrainer;

  beforeEach(() => {
    model = buildPPOModel(TEST_MODEL_CONFIG);
    trainer = new PPOTrainer(model, TEST_TRAINING_CONFIG);
  });

  afterEach(() => {
    model.dispose();
  });

  it('constructs with model and config without error', () => {
    expect(trainer).toBeDefined();
  });

  it('trainOnBatch reduces total loss over 3 consecutive calls on same fixed batch', () => {
    const batch = makeSyntheticBatch(5, 8);
    const losses: number[] = [];

    for (let i = 0; i < 3; i++) {
      const result: TrainStepResult = trainer.trainOnBatch(batch);
      losses.push(result.totalLoss);
    }

    // Total loss should decrease (or at least not increase significantly)
    // over consecutive updates on the same data
    expect(losses[2]).toBeLessThan(losses[0]);
  });

  it('trainOnBatch returns TrainStepResult with required fields', () => {
    const batch = makeSyntheticBatch(5, 4);
    const result = trainer.trainOnBatch(batch);

    expect(typeof result.policyLoss).toBe('number');
    expect(typeof result.valueLoss).toBe('number');
    expect(typeof result.entropy).toBe('number');
    expect(typeof result.totalLoss).toBe('number');
    expect(typeof result.approxKl).toBe('number');

    // Loss values should be finite numbers
    expect(Number.isFinite(result.policyLoss)).toBe(true);
    expect(Number.isFinite(result.valueLoss)).toBe(true);
    expect(Number.isFinite(result.entropy)).toBe(true);
    expect(Number.isFinite(result.totalLoss)).toBe(true);
    expect(Number.isFinite(result.approxKl)).toBe(true);
  });

  it('value loss decreases when training on batch with known returns', () => {
    const batch = makeSyntheticBatch(5, 8);
    const results: TrainStepResult[] = [];

    for (let i = 0; i < 5; i++) {
      results.push(trainer.trainOnBatch(batch));
    }

    // Value loss should generally decrease over repeated updates on same data
    expect(results[4].valueLoss).toBeLessThan(results[0].valueLoss);
  });

  it('entropy bonus is computed and positive', () => {
    const batch = makeSyntheticBatch(5, 4);
    const result = trainer.trainOnBatch(batch);

    // Entropy for a non-degenerate policy should be positive
    expect(result.entropy).toBeGreaterThan(0);
  });

  it('update method runs multiple epochs and returns PPOUpdateResult', () => {
    const buffer = new TrajectoryBuffer();
    for (let i = 0; i < 16; i++) {
      buffer.add({
        planes: new Float32Array(32).fill(Math.random()),
        scalars: new Float32Array(3).fill(Math.random()),
        action: Math.floor(Math.random() * 5),
        reward: Math.random(),
        value: Math.random(),
        logProb: -Math.log(5),
        done: false,
        actionMask: new Uint8Array(5).fill(1),
      });
    }
    buffer.finalize(0.5, 0.99, 0.95);

    const result = trainer.update(buffer);

    expect(result.epochsRun).toBeGreaterThanOrEqual(1);
    expect(result.epochsRun).toBeLessThanOrEqual(
      TEST_TRAINING_CONFIG.ppoEpochs,
    );
    expect(typeof result.meanPolicyLoss).toBe('number');
    expect(typeof result.meanValueLoss).toBe('number');
    expect(typeof result.meanEntropy).toBe('number');
    expect(typeof result.meanKl).toBe('number');
    expect(typeof result.earlyStopped).toBe('boolean');
  });

  it('update stops early if approxKl exceeds targetKl', () => {
    // Use a very low targetKl to force early stopping
    const strictConfig: TrainingConfig = {
      ...TEST_TRAINING_CONFIG,
      targetKl: 0.00001,
      ppoEpochs: 10,
      learningRate: 0.1, // high LR to create large KL divergence
    };
    const strictModel = buildPPOModel(TEST_MODEL_CONFIG);
    const strictTrainer = new PPOTrainer(strictModel, strictConfig);

    const buffer = new TrajectoryBuffer();
    for (let i = 0; i < 16; i++) {
      buffer.add({
        planes: new Float32Array(32).fill(Math.random()),
        scalars: new Float32Array(3).fill(Math.random()),
        action: Math.floor(Math.random() * 5),
        reward: Math.random(),
        value: Math.random(),
        logProb: -Math.log(5),
        done: false,
        actionMask: new Uint8Array(5).fill(1),
      });
    }
    buffer.finalize(0.5, 0.99, 0.95);

    const result = strictTrainer.update(buffer);

    expect(result.earlyStopped).toBe(true);
    expect(result.epochsRun).toBeLessThan(10);

    strictModel.dispose();
  });

  it('sampleAction with mask applies -1e9 to invalid logits', () => {
    // Create logits favoring action 0
    const logits = tf.tensor1d([10, 10, 10, 10, 10]);
    const mask = new Uint8Array([0, 0, 0, 0, 1]); // only action 4 is valid

    const { action, logProb } = trainer.sampleAction(logits, mask);

    // Only action 4 should be sampled since others are masked
    expect(action).toBe(4);
    expect(typeof logProb).toBe('number');
    expect(Number.isFinite(logProb)).toBe(true);

    logits.dispose();
  });

  it('computeLogProb returns correct log probability', () => {
    // Uniform logits -> log(1/5) = -log(5)
    const logits = tf.tensor1d([0, 0, 0, 0, 0]);
    const mask = new Uint8Array([1, 1, 1, 1, 1]);

    const { logProb } = trainer.sampleAction(logits, mask);

    // For uniform distribution with 5 actions: logProb = -ln(5) ~ -1.609
    expect(logProb).toBeCloseTo(-Math.log(5), 1);

    logits.dispose();
  });

  it('no tensor leak -- numTensors stable before and after trainOnBatch', () => {
    const batch = makeSyntheticBatch(5, 4);

    // Warm up to allocate any one-time tensors
    trainer.trainOnBatch(batch);
    trainer.trainOnBatch(batch);

    const before = tf.memory().numTensors;
    for (let i = 0; i < 5; i++) {
      trainer.trainOnBatch(batch);
    }
    const after = tf.memory().numTensors;

    // Allow small tolerance (optimizer state may grow slightly)
    expect(Math.abs(after - before)).toBeLessThanOrEqual(5);
  });

  it('computeValue returns a finite number', () => {
    const planes = new Float32Array(32);
    for (let i = 0; i < 32; i++) planes[i] = Math.random();
    const scalars = new Float32Array(3);
    for (let i = 0; i < 3; i++) scalars[i] = Math.random();

    const value = trainer.computeValue(planes, scalars);

    expect(typeof value).toBe('number');
    expect(Number.isFinite(value)).toBe(true);
  });
});
