import type * as tfTypes from '@tensorflow/tfjs';
import { beforeAll, describe, expect, it } from 'vitest';

import { getTf } from '../tf-backend.js';
import type { TfModule } from '../tf-backend.js';
import {
  applyWeights,
  buildModelConfigFromEnv,
  buildPPOModel,
  extractWeights,
  initTfBackend,
} from './ppo-network.js';
import type { PPOModelConfig } from './ppo-network.js';
import { DEFAULT_NETWORK_CONFIG } from './training-config.js';

let tf: TfModule;

beforeAll(async () => {
  tf = await getTf();
  await initTfBackend();
}, 15_000);

// Small config to keep tests fast
const SMALL_CONFIG: PPOModelConfig = {
  planeShape: [5, 10, 10], // [C, H, W] -- observation space format
  scalarCount: 7,
  actionCount: 51, // 5 templates * 10 positions + 1 no-op
  convFilters: [4, 8],
  convKernelSize: 3,
  mlpUnits: [16],
  activation: 'relu',
};

describe('buildPPOModel', () => {
  it('produces a model with 2 inputs (planes, scalars)', () => {
    const model = buildPPOModel(SMALL_CONFIG);
    expect(model.inputs).toHaveLength(2);
    expect(model.inputs[0].name).toContain('planes');
    expect(model.inputs[1].name).toContain('scalars');
    model.dispose();
  });

  it('policy logits output has shape [null, actionCount]', () => {
    const model = buildPPOModel(SMALL_CONFIG);
    // Output 0 is policy logits
    const policyShape = model.outputs[0].shape;
    expect(policyShape).toEqual([null, SMALL_CONFIG.actionCount]);
    model.dispose();
  });

  it('value output has shape [null, 1]', () => {
    const model = buildPPOModel(SMALL_CONFIG);
    // Output 1 is value
    const valueShape = model.outputs[1].shape;
    expect(valueShape).toEqual([null, 1]);
    model.dispose();
  });

  it('forward pass with random input produces tensors of expected shapes', () => {
    const model = buildPPOModel(SMALL_CONFIG);
    const batchSize = 2;

    // channels-last: [batch, H, W, C]
    const planeInput = tf.randomNormal([
      batchSize,
      SMALL_CONFIG.planeShape[1], // H
      SMALL_CONFIG.planeShape[2], // W
      SMALL_CONFIG.planeShape[0], // C
    ]);
    const scalarInput = tf.randomNormal([batchSize, SMALL_CONFIG.scalarCount]);

    const outputs = model.predict([
      planeInput,
      scalarInput,
    ]) as tfTypes.Tensor[];
    expect(outputs).toHaveLength(2);

    // Policy logits: [batch, actionCount]
    expect(outputs[0].shape).toEqual([batchSize, SMALL_CONFIG.actionCount]);
    // Value: [batch, 1]
    expect(outputs[1].shape).toEqual([batchSize, 1]);

    planeInput.dispose();
    scalarInput.dispose();
    outputs[0].dispose();
    outputs[1].dispose();
    model.dispose();
  });

  it('accepts channels-last input [batch, H, W, C] matching transposed observation planes', () => {
    const model = buildPPOModel(SMALL_CONFIG);

    // Simulate what training code does: observation planes are [C, H, W],
    // we transpose to [H, W, C] for the network
    const C = SMALL_CONFIG.planeShape[0];
    const H = SMALL_CONFIG.planeShape[1];
    const W = SMALL_CONFIG.planeShape[2];

    const channelsFirst = tf.randomNormal([1, C, H, W]);
    // Transpose [batch, C, H, W] -> [batch, H, W, C]
    const channelsLast = channelsFirst.transpose([0, 2, 3, 1]);
    const scalarInput = tf.randomNormal([1, SMALL_CONFIG.scalarCount]);

    const outputs = model.predict([
      channelsLast,
      scalarInput,
    ]) as tfTypes.Tensor[];
    expect(outputs[0].shape).toEqual([1, SMALL_CONFIG.actionCount]);
    expect(outputs[1].shape).toEqual([1, 1]);

    channelsFirst.dispose();
    channelsLast.dispose();
    scalarInput.dispose();
    outputs[0].dispose();
    outputs[1].dispose();
    model.dispose();
  });

  it('builds successfully with custom convFilters=[16,32] and mlpUnits=[64]', () => {
    const customConfig: PPOModelConfig = {
      ...SMALL_CONFIG,
      convFilters: [16, 32],
      mlpUnits: [64],
    };
    const model = buildPPOModel(customConfig);
    expect(model.inputs).toHaveLength(2);
    expect(model.outputs[0].shape).toEqual([null, customConfig.actionCount]);
    expect(model.outputs[1].shape).toEqual([null, 1]);
    model.dispose();
  });
});

describe('extractWeights', () => {
  it('returns array of WeightData with shape and buffer', () => {
    const model = buildPPOModel(SMALL_CONFIG);
    const weights = extractWeights(model);

    expect(weights.length).toBeGreaterThan(0);
    for (const w of weights) {
      expect(Array.isArray(w.shape)).toBe(true);
      expect(w.buffer).toBeInstanceOf(ArrayBuffer);
      // Buffer size matches shape product * 4 (float32)
      const expectedSize = w.shape.reduce((a, b) => a * b, 1) * 4;
      expect(w.buffer.byteLength).toBe(expectedSize);
    }

    model.dispose();
  });
});

describe('applyWeights', () => {
  it('makes two models produce identical outputs for the same input', () => {
    const modelA = buildPPOModel(SMALL_CONFIG);
    const modelB = buildPPOModel(SMALL_CONFIG);

    const weightsFromA = extractWeights(modelA);
    applyWeights(modelB, weightsFromA);

    const batchSize = 1;
    const planeInput = tf.randomNormal([
      batchSize,
      SMALL_CONFIG.planeShape[1],
      SMALL_CONFIG.planeShape[2],
      SMALL_CONFIG.planeShape[0],
    ]);
    const scalarInput = tf.randomNormal([batchSize, SMALL_CONFIG.scalarCount]);

    const outputsA = modelA.predict([
      planeInput,
      scalarInput,
    ]) as tfTypes.Tensor[];
    const outputsB = modelB.predict([
      planeInput,
      scalarInput,
    ]) as tfTypes.Tensor[];

    const policyA = outputsA[0].dataSync();
    const policyB = outputsB[0].dataSync();
    const valueA = outputsA[1].dataSync();
    const valueB = outputsB[1].dataSync();

    // Both models should produce identical outputs
    for (let i = 0; i < policyA.length; i++) {
      expect(policyA[i]).toBeCloseTo(policyB[i], 6);
    }
    expect(valueA[0]).toBeCloseTo(valueB[0], 6);

    planeInput.dispose();
    scalarInput.dispose();
    outputsA[0].dispose();
    outputsA[1].dispose();
    outputsB[0].dispose();
    outputsB[1].dispose();
    modelA.dispose();
    modelB.dispose();
  });
});

describe('buildModelConfigFromEnv', () => {
  it('creates PPOModelConfig from BotEnvironment-like object', () => {
    // Minimal mock of BotEnvironment interface
    const fakeEnv = {
      observationSpace: {
        planes: {
          shape: [5, 52, 52] as [number, number, number],
          dtype: 'float32' as const,
        },
        scalars: { shape: [7] as [number], dtype: 'float32' as const },
      },
      actionSpace: {
        type: 'Discrete' as const,
        n: 13521,
        numTemplates: 5,
        numPositions: 2704,
        templateIds: [
          'block',
          'eater-1',
          'generator',
          'glider',
          'gosper',
        ] as readonly string[],
      },
    };

    const config = buildModelConfigFromEnv(fakeEnv, DEFAULT_NETWORK_CONFIG);

    expect(config.planeShape).toEqual([5, 52, 52]);
    expect(config.scalarCount).toBe(7);
    expect(config.actionCount).toBe(13521);
    expect(config.convFilters).toEqual(DEFAULT_NETWORK_CONFIG.convFilters);
    expect(config.convKernelSize).toBe(DEFAULT_NETWORK_CONFIG.convKernelSize);
    expect(config.mlpUnits).toEqual(DEFAULT_NETWORK_CONFIG.mlpUnits);
    expect(config.activation).toBe(DEFAULT_NETWORK_CONFIG.activation);
  });
});
