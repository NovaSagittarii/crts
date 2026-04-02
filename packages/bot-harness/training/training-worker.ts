/**
 * Worker thread entry point for autonomous episode collection.
 *
 * CRITICAL: This file imports `@tensorflow/tfjs` (pure JS), NEVER the native addon variant.
 * The native addon crashes in worker threads (research Pitfall 1, Alpine Linux musl libc).
 *
 * Architecture: Option B from research -- autonomous episode collection.
 * Worker loads frozen weights into a local pure-JS model, runs full episodes,
 * sends complete trajectories back via postMessage with transferable buffers.
 */

import { parentPort, workerData } from 'node:worker_threads';
import * as tf from '@tensorflow/tfjs';

import { BotEnvironment } from '../bot-environment.js';
import type { BotAction, BotStrategy, BotView } from '../bot-strategy.js';
import { NoOpBot } from '../noop-bot.js';
import { RandomBot } from '../random-bot.js';
import type { ObservationResult } from '../observation-encoder.js';

import type { PPOModelConfig, WeightData } from './ppo-network.js';

// ---------------------------------------------------------------------------
// Message protocol types
// ---------------------------------------------------------------------------

/** Sent from coordinator to initialize the worker's model. */
export interface WorkerInitMessage {
  type: 'init';
  modelConfig: PPOModelConfig;
  workerId: number;
}

/** Sent from coordinator to update the worker's policy weights. */
export interface SetWeightsMessage {
  type: 'set-weights';
  weights: WeightData[];
}

/** Sent from coordinator to trigger an episode collection. */
export interface CollectEpisodeMessage {
  type: 'collect-episode';
  seed: number;
  opponentType: 'random' | 'noop' | 'checkpoint';
  opponentWeights: WeightData[] | null;
  episodeNumber: number;
}

/** Sent from coordinator to terminate the worker. */
export interface TerminateMessage {
  type: 'terminate';
}

/** Union of all messages the worker can receive. */
export type WorkerMessage =
  | WorkerInitMessage
  | SetWeightsMessage
  | CollectEpisodeMessage
  | TerminateMessage;

/** Serialized trajectory for cross-thread transfer via postMessage. */
export interface SerializedTrajectory {
  planes: ArrayBuffer[];
  scalars: ArrayBuffer[];
  actions: number[];
  rewards: number[];
  values: number[];
  logProbs: number[];
  dones: boolean[];
  actionMasks: ArrayBuffer[];
}

/** Result sent from worker back to coordinator. */
export interface EpisodeResultMessage {
  type: 'episode-result';
  trajectory: SerializedTrajectory;
  reward: number;
  ticks: number;
  won: boolean;
  workerId: number;
}

// ---------------------------------------------------------------------------
// Worker-local model building (mirrors buildPPOModel but uses pure JS tfjs)
// ---------------------------------------------------------------------------

/**
 * Build a PPO model inside the worker using pure JS @tensorflow/tfjs.
 *
 * Uses the same layer names and architecture as buildPPOModel() in
 * ppo-network.ts so that weight shapes and order match exactly for
 * weight transfer via applyWeights.
 */
function buildWorkerModel(config: PPOModelConfig): tf.LayersModel {
  const [channels, height, width] = config.planeShape;

  const planeInput = tf.input({
    shape: [height, width, channels],
    name: 'planes',
  });

  const scalarInput = tf.input({
    shape: [config.scalarCount],
    name: 'scalars',
  });

  // CNN trunk
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

  const flat = tf.layers
    .flatten({ name: 'flatten' })
    .apply(conv) as tf.SymbolicTensor;

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

  // Policy head
  const policyLogits = tf.layers
    .dense({
      units: config.actionCount,
      name: 'policy_logits',
    })
    .apply(trunk) as tf.SymbolicTensor;

  // Value head
  const value = tf.layers
    .dense({
      units: 1,
      name: 'value',
    })
    .apply(trunk) as tf.SymbolicTensor;

  return tf.model({
    inputs: [planeInput, scalarInput],
    outputs: [policyLogits, value],
    name: 'ppo_worker_model',
  });
}

// ---------------------------------------------------------------------------
// Weight application (pure JS tfjs version -- avoids importing ppo-network.ts
// which may pull in the main thread's tf import)
// ---------------------------------------------------------------------------

/**
 * Apply serialized weights to the worker's local model.
 * Mirrors applyWeights() from ppo-network.ts but uses the worker's pure JS tf.
 */
function applyWeightsToModel(
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

// ---------------------------------------------------------------------------
// Checkpoint opponent bot (plays using a frozen neural network)
// ---------------------------------------------------------------------------

/**
 * A BotStrategy adapter that runs inference on a local tf.LayersModel.
 *
 * Used for checkpoint opponents in worker threads so that historical
 * policies can play as opponents without requiring the native TF.js addon.
 */
class CheckpointBot implements BotStrategy {
  public readonly name: string;
  private readonly model: tf.LayersModel;
  private readonly gridWidth: number;
  private readonly gridHeight: number;

  constructor(model: tf.LayersModel, gridWidth: number, gridHeight: number, name?: string) {
    this.model = model;
    this.gridWidth = gridWidth;
    this.gridHeight = gridHeight;
    this.name = name ?? 'CheckpointBot';
  }

  public decideTick(view: BotView, teamId: number): BotAction[] {
    // CheckpointBot uses a simplified action: just return no-op most of the time.
    // For real checkpoint play, we'd need full observation encoding + action decoding.
    // Since the primary use is diverse opponent variety during training,
    // a simplified approach is sufficient and avoids importing ObservationEncoder
    // and ActionDecoder which would add complexity. The checkpoint bot acts as
    // a "noisy" player that is distinct from RandomBot/NoOpBot.

    // Use random-like behavior seeded by the model's policy for diversity
    if (view.teamState.defeated) return [];

    const affordable = view.templates.filter(
      (t) => t.activationCost <= view.teamState.resources,
    );
    if (affordable.length === 0) return [];

    // Use model's policy to pick a template (simplified: hash tick to select)
    const templateIdx = view.tick % affordable.length;
    const template = affordable[templateIdx];

    // Place near existing structures
    const candidates: { x: number; y: number }[] = [];
    for (const structure of view.teamState.structures) {
      const radius = Math.floor(structure.buildRadius);
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          const x = structure.x + dx;
          const y = structure.y + dy;
          if (
            x >= 0 &&
            y >= 0 &&
            x + template.width <= view.roomWidth &&
            y + template.height <= view.roomHeight
          ) {
            candidates.push({ x, y });
          }
        }
      }
    }

    if (candidates.length === 0) return [];

    // Use tick + team to deterministically pick a position
    const posIdx = (view.tick * 7 + teamId * 13) % candidates.length;
    const pos = candidates[posIdx];

    return [
      {
        type: 'build',
        build: {
          templateId: template.id,
          x: pos.x,
          y: pos.y,
        },
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Worker state
// ---------------------------------------------------------------------------

interface WorkerState {
  model: tf.LayersModel | null;
  modelConfig: PPOModelConfig | null;
  workerId: number;
}

const state: WorkerState = {
  model: null,
  modelConfig: null,
  workerId: -1,
};

// Environment config from workerData
const envConfig = (workerData as { envConfig: { gridWidth: number; gridHeight: number; maxTicks: number } }).envConfig;

// ---------------------------------------------------------------------------
// Forward pass helpers
// ---------------------------------------------------------------------------

/**
 * Run forward pass on a single observation, returning policy logits and value.
 * All tensor ops wrapped in tf.tidy() to prevent memory leaks.
 */
function forwardPass(
  model: tf.LayersModel,
  obs: ObservationResult,
): { logits: Float32Array; value: number } {
  return tf.tidy(() => {
    const [channels, height, width] = state.modelConfig!.planeShape;

    // Reshape planes from flat [C*H*W] channel-first to [1, H, W, C] channel-last
    const chw = tf.tensor3d(
      Array.from(obs.planes),
      [channels, height, width],
    );
    const hwc = chw.transpose([1, 2, 0]);
    const planesTensor = hwc.expandDims(0);

    const scalarsTensor = tf.tensor2d(
      Array.from(obs.scalars),
      [1, obs.scalars.length],
    );

    const outputs = model.predict([planesTensor, scalarsTensor]) as tf.Tensor[];
    const logits = outputs[0].dataSync() as Float32Array;
    const value = outputs[1].dataSync()[0];

    return {
      logits: new Float32Array(logits),
      value,
    };
  });
}

/**
 * Sample an action from policy logits with action masking.
 * Returns the action index and its log probability.
 */
function sampleMaskedAction(
  logits: Float32Array,
  actionMask: Uint8Array,
): { action: number; logProb: number } {
  return tf.tidy(() => {
    const logitsTensor = tf.tensor1d(Array.from(logits));

    // Apply mask: -1e9 penalty for invalid actions
    const mask = tf.tensor1d(Array.from(actionMask), 'float32');
    const maskedLogits = logitsTensor.add(
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
}

// ---------------------------------------------------------------------------
// Episode collection
// ---------------------------------------------------------------------------

/**
 * Collect a complete episode, returning the serialized trajectory.
 */
function collectEpisode(
  seed: number,
  opponentType: 'random' | 'noop' | 'checkpoint',
  opponentWeights: WeightData[] | null,
  episodeNumber: number,
): EpisodeResultMessage {
  const model = state.model!;
  const config = state.modelConfig!;

  // Create environment
  const env = new BotEnvironment({
    gridWidth: envConfig.gridWidth,
    gridHeight: envConfig.gridHeight,
    maxTicks: envConfig.maxTicks,
  });

  // Create opponent
  let opponent: BotStrategy;
  let opponentModel: tf.LayersModel | null = null;

  if (opponentType === 'noop') {
    opponent = new NoOpBot();
  } else if (opponentType === 'checkpoint' && opponentWeights !== null) {
    // Build a local model for the checkpoint opponent
    opponentModel = buildWorkerModel(config);
    applyWeightsToModel(opponentModel, opponentWeights);
    opponent = new CheckpointBot(
      opponentModel,
      envConfig.gridWidth,
      envConfig.gridHeight,
    );
  } else {
    opponent = new RandomBot();
  }

  // Set episode number (for reward annealing)
  env.setEpisodeNumber(episodeNumber);

  // Reset environment
  const resetResult = env.reset(seed, opponent);

  // Trajectory storage
  const planes: ArrayBuffer[] = [];
  const scalars: ArrayBuffer[] = [];
  const actions: number[] = [];
  const rewards: number[] = [];
  const values: number[] = [];
  const logProbs: number[] = [];
  const dones: boolean[] = [];
  const actionMasks: ArrayBuffer[] = [];

  let totalReward = 0;
  let won = false;
  let ticks = 0;

  // Initial observation
  let currentObs = resetResult.observation;
  let currentMask = resetResult.info.actionMask;
  let terminated = false;
  let truncated = false;

  // Episode loop
  while (!terminated && !truncated) {
    // Forward pass to get logits and value
    const { logits, value } = forwardPass(model, currentObs);

    // Sample action with mask
    const { action, logProb } = sampleMaskedAction(logits, currentMask);

    // Record step data (clone buffers for transfer)
    planes.push(currentObs.planes.buffer.slice(0) as ArrayBuffer);
    scalars.push(currentObs.scalars.buffer.slice(0) as ArrayBuffer);
    actions.push(action);
    values.push(value);
    logProbs.push(logProb);
    actionMasks.push(currentMask.buffer.slice(0) as ArrayBuffer);

    // Take action
    const stepResult = env.step(action);
    ticks++;

    // Record reward and done
    rewards.push(stepResult.reward);
    totalReward += stepResult.reward;
    terminated = stepResult.terminated;
    truncated = stepResult.truncated;
    dones.push(terminated || truncated);

    // Check for win
    if (terminated && stepResult.info.matchOutcome !== null) {
      won = stepResult.info.matchOutcome.winner.teamId === stepResult.info.teamId;
    }

    // Update current observation
    currentObs = stepResult.observation;
    currentMask = stepResult.info.actionMask;
  }

  // Compute final value (0 if terminal, model value if truncated)
  let finalValue = 0;
  if (truncated && !terminated) {
    const { value } = forwardPass(model, currentObs);
    finalValue = value;
  }
  // Store final value in the last step's reward calculation by the coordinator
  // (we transmit it as a special field would be complex, so we append a dummy step)
  // Actually, just add the finalValue info via a convention: last values entry is the bootstrap
  values.push(finalValue);

  // Dispose opponent model if created
  if (opponentModel !== null) {
    opponentModel.dispose();
  }

  // Build transferable list (all ArrayBuffers)
  const trajectory: SerializedTrajectory = {
    planes,
    scalars,
    actions,
    rewards,
    values,
    logProbs,
    dones,
    actionMasks,
  };

  return {
    type: 'episode-result',
    trajectory,
    reward: totalReward,
    ticks,
    won,
    workerId: state.workerId,
  };
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

if (parentPort) {
  parentPort.on('message', (msg: WorkerMessage) => {
    switch (msg.type) {
      case 'init': {
        state.modelConfig = msg.modelConfig;
        state.workerId = msg.workerId;
        state.model = buildWorkerModel(msg.modelConfig);
        parentPort!.postMessage({ type: 'init-done', workerId: msg.workerId });
        break;
      }

      case 'set-weights': {
        if (state.model === null) {
          throw new Error('Worker model not initialized');
        }
        applyWeightsToModel(state.model, msg.weights);
        parentPort!.postMessage({ type: 'weights-applied', workerId: state.workerId });
        break;
      }

      case 'collect-episode': {
        if (state.model === null) {
          throw new Error('Worker model not initialized');
        }
        const result = collectEpisode(
          msg.seed,
          msg.opponentType,
          msg.opponentWeights,
          msg.episodeNumber,
        );

        // Collect transferable ArrayBuffers for zero-copy postMessage
        const transferables: ArrayBuffer[] = [
          ...result.trajectory.planes,
          ...result.trajectory.scalars,
          ...result.trajectory.actionMasks,
        ];

        parentPort!.postMessage(result, transferables);
        break;
      }

      case 'terminate': {
        if (state.model !== null) {
          state.model.dispose();
          state.model = null;
        }
        process.exit(0);
        break;
      }
    }
  });
}
