/**
 * PPO (Proximal Policy Optimization) trainer with clipped surrogate loss.
 *
 * Implements the core PPO update logic:
 * - Clipped surrogate policy loss
 * - Value function MSE loss
 * - Entropy bonus for exploration
 * - KL-based early stopping
 * - Action masking with -1e9 penalty for invalid actions
 *
 * All tensor operations wrapped in tf.tidy() to prevent memory leaks.
 */

import * as tf from '@tensorflow/tfjs';

import type { TrajectoryBatch } from './trajectory-buffer.js';
import type { TrajectoryBuffer } from './trajectory-buffer.js';
import type { TrainingConfig } from './training-config.js';

/**
 * Result from a single PPO gradient update step.
 */
export interface TrainStepResult {
  policyLoss: number;
  valueLoss: number;
  entropy: number;
  totalLoss: number;
  approxKl: number;
}

/**
 * Result from a full PPO update (multiple epochs over the buffer).
 */
export interface PPOUpdateResult {
  epochsRun: number;
  meanPolicyLoss: number;
  meanValueLoss: number;
  meanEntropy: number;
  meanKl: number;
  earlyStopped: boolean;
}

/**
 * PPO trainer that runs clipped surrogate loss updates on a neural network model.
 */
export class PPOTrainer {
  private readonly model: tf.LayersModel;
  private readonly optimizer: tf.AdamOptimizer;
  private readonly clipEpsilon: number;
  private readonly entropyCoeff: number;
  private readonly valueLossCoeff: number;
  private readonly targetKl: number;
  private readonly ppoEpochs: number;
  private readonly miniBatchSize: number;
  private readonly height: number;
  private readonly width: number;
  private readonly channels: number;

  constructor(model: tf.LayersModel, config: TrainingConfig) {
    this.model = model;
    this.optimizer = tf.train.adam(config.learningRate);
    this.clipEpsilon = config.clipEpsilon;
    this.entropyCoeff = config.entropyCoeff;
    this.valueLossCoeff = config.valueLossCoeff;
    this.targetKl = config.targetKl;
    this.ppoEpochs = config.ppoEpochs;
    this.miniBatchSize = config.miniBatchSize;

    // Extract spatial dimensions from model input shape [H, W, C]
    const planeInputShape = this.model.inputs[0].shape;
    this.height = planeInputShape[1] as number;
    this.width = planeInputShape[2] as number;
    this.channels = planeInputShape[3] as number;
  }

  /**
   * Run a single PPO gradient update on a mini-batch.
   *
   * All tensor operations are wrapped in tf.tidy() to prevent memory leaks.
   */
  public trainOnBatch(batch: TrajectoryBatch): TrainStepResult {
    const batchSize = batch.size;

    // Build input tensors outside the gradient tape but inside tidy
    const planesTensor = this.buildPlanesTensor(batch.planes, batchSize);
    const scalarsTensor = tf.tensor2d(
      this.flattenScalars(batch.scalars, batchSize),
      [batchSize, batch.scalars[0].length],
    );
    const actionsTensor = tf.tensor1d(Array.from(batch.actions), 'int32');
    const oldLogProbsTensor = tf.tensor1d(Array.from(batch.oldLogProbs));
    const advantagesTensor = tf.tensor1d(Array.from(batch.advantages));
    const returnsTensor = tf.tensor1d(Array.from(batch.returns));
    const maskTensor = this.buildMaskTensor(batch.actionMasks, batchSize);

    let policyLoss = 0;
    let valueLoss = 0;
    let entropy = 0;
    let totalLoss = 0;
    let approxKl = 0;

    // Run gradient update
    const grads = this.optimizer.minimize(
      () => {
        return tf.tidy(() => {
          // Forward pass
          const outputs = this.model.predict([
            planesTensor,
            scalarsTensor,
          ]) as tf.Tensor[];
          const logits = outputs[0]; // [batch, actionCount]
          const values = outputs[1].squeeze([1]); // [batch]

          // Apply action mask: add -1e9 to invalid action logits
          const maskFloat = maskTensor.toFloat();
          const maskedLogits = logits.add(
            tf.sub(tf.scalar(1), maskFloat).mul(tf.scalar(-1e9)),
          );

          // Log softmax for numerical stability
          const logProbs = tf.logSoftmax(maskedLogits);

          // Gather new log probs for taken actions using one-hot
          const actionOneHot = tf.oneHot(actionsTensor, logits.shape[1]!);
          const newLogProbs = logProbs.mul(actionOneHot).sum(1); // [batch]

          // Ratio = exp(newLogProb - oldLogProb)
          const ratio = tf.exp(newLogProbs.sub(oldLogProbsTensor));

          // Clipped ratio
          const clippedRatio = tf.clipByValue(
            ratio,
            1 - this.clipEpsilon,
            1 + this.clipEpsilon,
          );

          // Policy loss = -mean(min(ratio * adv, clippedRatio * adv))
          const surr1 = ratio.mul(advantagesTensor);
          const surr2 = clippedRatio.mul(advantagesTensor);
          const pLoss = tf.neg(tf.mean(tf.minimum(surr1, surr2)));

          // Value loss = mean((values - returns)^2)
          const vLoss = tf.mean(values.sub(returnsTensor).square());

          // Entropy = -mean(sum(probs * logProbs, axis=-1))
          const probs = tf.softmax(maskedLogits);
          const ent = tf.neg(
            tf.mean(probs.mul(logProbs).sum(1)),
          );

          // Approximate KL divergence: mean((ratio - 1) - log(ratio))
          const kl = tf.mean(
            ratio.sub(tf.scalar(1)).sub(tf.log(ratio.add(tf.scalar(1e-10)))),
          );

          // Extract scalar values for reporting
          policyLoss = pLoss.dataSync()[0];
          valueLoss = vLoss.dataSync()[0];
          entropy = ent.dataSync()[0];
          approxKl = kl.dataSync()[0];

          // Total loss = policyLoss + valueLossCoeff * valueLoss - entropyCoeff * entropy
          const total = pLoss
            .add(vLoss.mul(tf.scalar(this.valueLossCoeff)))
            .sub(ent.mul(tf.scalar(this.entropyCoeff)));

          totalLoss = total.dataSync()[0];

          return total as tf.Scalar;
        });
      },
      true, // return cost
      this.model.trainableWeights.map((w) => (w as unknown as { val: tf.Variable }).val),
    );

    // Dispose intermediate tensors
    planesTensor.dispose();
    scalarsTensor.dispose();
    actionsTensor.dispose();
    oldLogProbsTensor.dispose();
    advantagesTensor.dispose();
    returnsTensor.dispose();
    maskTensor.dispose();
    if (grads) grads.dispose();

    return { policyLoss, valueLoss, entropy, totalLoss, approxKl };
  }

  /**
   * Run multiple PPO epochs over the full trajectory buffer.
   *
   * Stops early if mean approxKl for an epoch exceeds targetKl.
   */
  public update(buffer: TrajectoryBuffer): PPOUpdateResult {
    let totalPolicyLoss = 0;
    let totalValueLoss = 0;
    let totalEntropy = 0;
    let totalKl = 0;
    let totalBatches = 0;
    let epochsRun = 0;
    let earlyStopped = false;

    for (let epoch = 0; epoch < this.ppoEpochs; epoch++) {
      const batches = buffer.getBatches(this.miniBatchSize);

      let epochKl = 0;
      let epochBatches = 0;

      for (const batch of batches) {
        const result = this.trainOnBatch(batch);
        totalPolicyLoss += result.policyLoss;
        totalValueLoss += result.valueLoss;
        totalEntropy += result.entropy;
        totalKl += result.approxKl;
        epochKl += result.approxKl;
        totalBatches++;
        epochBatches++;
      }

      epochsRun++;

      // Early stopping based on KL divergence
      const meanEpochKl = epochBatches > 0 ? epochKl / epochBatches : 0;
      if (meanEpochKl > this.targetKl) {
        earlyStopped = true;
        break;
      }
    }

    return {
      epochsRun,
      meanPolicyLoss: totalBatches > 0 ? totalPolicyLoss / totalBatches : 0,
      meanValueLoss: totalBatches > 0 ? totalValueLoss / totalBatches : 0,
      meanEntropy: totalBatches > 0 ? totalEntropy / totalBatches : 0,
      meanKl: totalBatches > 0 ? totalKl / totalBatches : 0,
      earlyStopped,
    };
  }

  /**
   * Sample an action from the policy, respecting the action mask.
   *
   * Invalid actions receive -1e9 penalty before softmax sampling.
   */
  public sampleAction(
    logits: tf.Tensor1D,
    actionMask: Uint8Array,
  ): { action: number; logProb: number } {
    const result = tf.tidy(() => {
      // Apply mask: add -1e9 to invalid action logits
      const mask = tf.tensor1d(Array.from(actionMask), 'float32');
      const maskedLogits = logits.add(
        tf.sub(tf.scalar(1), mask).mul(tf.scalar(-1e9)),
      );

      // Sample from categorical distribution
      const sampled = tf.multinomial(maskedLogits.expandDims(0) as tf.Tensor2D, 1);
      const action = sampled.dataSync()[0];

      // Compute log probability
      const logProbs = tf.logSoftmax(maskedLogits);
      const logProb = logProbs.dataSync()[action];

      return { action, logProb };
    });

    return result;
  }

  /**
   * Compute the value function estimate for a single observation.
   */
  public computeValue(planes: Float32Array, scalars: Float32Array): number {
    const result = tf.tidy(() => {
      // Reshape planes from flat [C*H*W] channel-first to [1, H, W, C] channel-last
      const chw = tf.tensor3d(
        Array.from(planes),
        [this.channels, this.height, this.width],
      );
      const hwc = chw.transpose([1, 2, 0]); // [H, W, C]
      const planesTensor = hwc.expandDims(0); // [1, H, W, C]
      const scalarsTensor = tf.tensor2d(
        Array.from(scalars),
        [1, scalars.length],
      );

      const outputs = this.model.predict([
        planesTensor,
        scalarsTensor,
      ]) as tf.Tensor[];
      return outputs[1].dataSync()[0]; // value head output
    });

    return result;
  }

  /**
   * Get optimizer weights for checkpoint resume support (D-11).
   */
  public async getOptimizerWeights(): Promise<{ name: string; tensor: tf.Tensor }[]> {
    return this.optimizer.getWeights();
  }

  /**
   * Set optimizer weights for checkpoint resume support (D-11).
   */
  public async setOptimizerWeights(weights: { name: string; tensor: tf.Tensor }[]): Promise<void> {
    await this.optimizer.setWeights(weights as Parameters<typeof this.optimizer.setWeights>[0]);
  }

  /**
   * Build a 4D tensor from per-step flat plane arrays.
   *
   * Each step has flat [C*H*W] in channel-first order.
   * Output is [batchSize, H, W, C] in channel-last order for tf.layers.conv2d.
   */
  private buildPlanesTensor(
    planes: Float32Array[],
    batchSize: number,
  ): tf.Tensor4D {
    // Concatenate all flat planes into one big buffer
    const totalSize = batchSize * this.channels * this.height * this.width;
    const flatBuffer = new Float32Array(totalSize);
    for (let i = 0; i < batchSize; i++) {
      flatBuffer.set(planes[i], i * planes[i].length);
    }

    // Reshape [batch, C, H, W] then transpose to [batch, H, W, C]
    const bchw = tf.tensor4d(
      flatBuffer,
      [batchSize, this.channels, this.height, this.width],
    );
    const bhwc: tf.Tensor4D = bchw.transpose([0, 2, 3, 1]);
    bchw.dispose();
    return bhwc;
  }

  /**
   * Flatten per-step scalar arrays into a single flat buffer.
   */
  private flattenScalars(
    scalars: Float32Array[],
    batchSize: number,
  ): Float32Array {
    const scalarCount = scalars[0].length;
    const buffer = new Float32Array(batchSize * scalarCount);
    for (let i = 0; i < batchSize; i++) {
      buffer.set(scalars[i], i * scalarCount);
    }
    return buffer;
  }

  /**
   * Build a 2D mask tensor from per-step action masks.
   */
  private buildMaskTensor(
    masks: Uint8Array[],
    batchSize: number,
  ): tf.Tensor2D {
    const actionCount = masks[0].length;
    const buffer = new Float32Array(batchSize * actionCount);
    for (let i = 0; i < batchSize; i++) {
      for (let j = 0; j < actionCount; j++) {
        buffer[i * actionCount + j] = masks[i][j];
      }
    }
    return tf.tensor2d(buffer, [batchSize, actionCount]);
  }
}
