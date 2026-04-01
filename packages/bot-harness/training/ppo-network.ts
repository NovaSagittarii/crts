import * as tf from '@tensorflow/tfjs';

import type { ActionSpaceInfo } from '../action-decoder.js';
import type { NetworkConfig } from './training-config.js';

/**
 * Serialized weight data for cross-thread transfer (D-17).
 * Each entry captures the shape and raw float32 buffer of a model weight tensor.
 */
export interface WeightData {
  shape: number[];
  buffer: ArrayBuffer;
}

/**
 * Configuration for building the PPO model.
 *
 * planeShape is [C, H, W] (channel-first, matching ObservationEncoder output).
 * The network internally transposes to [H, W, C] for tf.layers.conv2d.
 */
export interface PPOModelConfig {
  /** Observation plane shape [channels, height, width] */
  planeShape: [number, number, number];
  /** Number of scalar features */
  scalarCount: number;
  /** Total discrete action count */
  actionCount: number;
  /** Number of filters per conv2d layer */
  convFilters: number[];
  /** Kernel size for all conv2d layers */
  convKernelSize: number;
  /** Units per dense layer in the shared MLP trunk */
  mlpUnits: number[];
  /** Activation function for conv and dense layers */
  activation: string;
}

/**
 * Build a PPO model with CNN trunk for spatial features, concatenated with
 * scalar features, through a shared MLP trunk, into separate policy and
 * value heads (D-01, D-02).
 *
 * Inputs:
 *   - 'planes': [batch, H, W, C] (channels-last for tf.layers.conv2d)
 *   - 'scalars': [batch, scalarCount]
 *
 * Outputs:
 *   - policy_logits: [batch, actionCount] (raw logits, no activation)
 *   - value: [batch, 1] (raw scalar, no activation)
 */
export function buildPPOModel(config: PPOModelConfig): tf.LayersModel {
  const [channels, height, width] = config.planeShape;

  // Input: spatial feature planes [batch, H, W, C] (channels-last)
  const planeInput = tf.input({
    shape: [height, width, channels],
    name: 'planes',
  });

  // Input: scalar features [batch, scalarCount]
  const scalarInput = tf.input({
    shape: [config.scalarCount],
    name: 'scalars',
  });

  // CNN trunk: iterate convFilters
  let conv: tf.SymbolicTensor = planeInput;
  for (let i = 0; i < config.convFilters.length; i++) {
    conv = tf.layers
      .conv2d({
        filters: config.convFilters[i],
        kernelSize: config.convKernelSize,
        padding: 'same',
        activation: config.activation as 'relu',
        name: `conv_${String(i)}`,
      })
      .apply(conv) as tf.SymbolicTensor;
  }

  // Flatten conv output
  const flat = tf.layers
    .flatten({ name: 'flatten' })
    .apply(conv) as tf.SymbolicTensor;

  // Concatenate flattened conv output with scalar features
  const merged = tf.layers
    .concatenate({ name: 'merge' })
    .apply([flat, scalarInput]) as tf.SymbolicTensor;

  // Shared MLP trunk
  let trunk: tf.SymbolicTensor = merged;
  for (let i = 0; i < config.mlpUnits.length; i++) {
    trunk = tf.layers
      .dense({
        units: config.mlpUnits[i],
        activation: config.activation as 'relu',
        name: `trunk_${String(i)}`,
      })
      .apply(trunk) as tf.SymbolicTensor;
  }

  // Policy head: raw logits, NO activation
  const policyLogits = tf.layers
    .dense({
      units: config.actionCount,
      name: 'policy_logits',
    })
    .apply(trunk) as tf.SymbolicTensor;

  // Value head: raw scalar, NO activation
  const value = tf.layers
    .dense({
      units: 1,
      name: 'value',
    })
    .apply(trunk) as tf.SymbolicTensor;

  return tf.model({
    inputs: [planeInput, scalarInput],
    outputs: [policyLogits, value],
    name: 'ppo_model',
  });
}

/**
 * Extract model weights as transferable WeightData array (D-17).
 *
 * Each weight tensor is cloned into a standalone ArrayBuffer so it can
 * be sent via postMessage with transferable semantics.
 */
export function extractWeights(model: tf.LayersModel): WeightData[] {
  const tensors = model.getWeights();
  const result: WeightData[] = [];

  for (const tensor of tensors) {
    const data = tensor.dataSync() as Float32Array;
    // Clone the buffer so it is independent of the tensor's memory
    const cloned = data.buffer.slice(0);
    result.push({
      shape: tensor.shape.slice(),
      buffer: cloned,
    });
  }

  return result;
}

/**
 * Apply serialized weights to a model (D-17).
 *
 * Creates tensors from the WeightData buffers, sets them on the model,
 * and disposes the temporary tensors.
 */
export function applyWeights(
  model: tf.LayersModel,
  weightData: WeightData[],
): void {
  const tensors: tf.Tensor[] = [];
  for (const wd of weightData) {
    const values = new Float32Array(wd.buffer);
    tensors.push(tf.tensor(values, wd.shape));
  }

  model.setWeights(tensors);

  for (const t of tensors) {
    t.dispose();
  }
}

/**
 * Interface matching the observation/action space descriptors on BotEnvironment.
 * Kept minimal to avoid importing the full BotEnvironment class.
 */
interface BotEnvironmentLike {
  readonly observationSpace: {
    planes: { shape: [number, number, number]; dtype: string };
    scalars: { shape: [number]; dtype: string };
  };
  readonly actionSpace: ActionSpaceInfo;
}

/**
 * Build a PPOModelConfig from a BotEnvironment's observation and action space.
 *
 * Reads env.observationSpace.planes.shape for plane dimensions and
 * env.actionSpace.n for the action count.
 */
export function buildModelConfigFromEnv(
  env: BotEnvironmentLike,
  networkConfig: NetworkConfig,
): PPOModelConfig {
  return {
    planeShape: env.observationSpace.planes.shape,
    scalarCount: env.observationSpace.scalars.shape[0],
    actionCount: env.actionSpace.n,
    convFilters: networkConfig.convFilters,
    convKernelSize: networkConfig.convKernelSize,
    mlpUnits: networkConfig.mlpUnits,
    activation: networkConfig.activation,
  };
}
