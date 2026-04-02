/**
 * LiveBotStrategy wraps TF.js model inference for the live bot client.
 *
 * This module is runtime-agnostic (no Socket.IO). It takes a
 * RoomStatePayload, encodes observations, runs the model, and returns
 * an action index. Tensor lifecycle is managed with tf.tidy().
 */
import type * as tf from '@tensorflow/tfjs';

import type { BuildQueuePayload, RoomStatePayload } from '#rts-engine';

import { ActionDecoder } from './action-decoder.js';
import { PayloadObservationEncoder } from './payload-observation-encoder.js';
import { getTf } from './tf-backend.js';
import type { TfModule } from './tf-backend.js';

let _tf: TfModule;

/** Initialize the TF.js backend for live bot inference. Must be called before infer/warmUp. */
export async function initLiveBotTf(): Promise<void> {
  _tf = await getTf();
}

/** Minimum resource cost to attempt any build (cheapest template). */
const MIN_BUILD_COST = 5;

export class LiveBotStrategy {
  private readonly model: tf.LayersModel | null;
  private readonly encoder: PayloadObservationEncoder;
  private readonly decoder: ActionDecoder;
  private readonly width: number;
  private readonly height: number;
  private lastActionIndex: number | null = null;

  constructor(model: tf.LayersModel | null, width: number, height: number) {
    this.model = model;
    this.width = width;
    this.height = height;
    this.encoder = new PayloadObservationEncoder(width, height);
    this.decoder = new ActionDecoder(width, height);
  }

  /**
   * Run inference on the given state payload and return an action index.
   *
   * If the model is null, returns a random action index.
   */
  public infer(
    payload: RoomStatePayload,
    teamId: number,
    maxTicks: number,
  ): number {
    const numTemplates = 5; // block, eater-1, generator, glider, gosper
    const numPositions = this.width * this.height;
    const totalActions = numTemplates * numPositions + 1;

    if (!this.model) {
      const action = Math.floor(Math.random() * totalActions);
      this.lastActionIndex = action;
      return action;
    }

    const obs = this.encoder.encode(payload, teamId, maxTicks);
    const { channels, height, width } = obs.shape;

    // Use _tf.tidy to automatically dispose intermediate tensors
    const actionIndex = _tf.tidy(() => {
      // Transpose planes from [C, H, W] to [H, W, C] for model input
      const planesRaw = _tf
        .tensor3d(obs.planes, [channels, height, width])
        .transpose([1, 2, 0]);
      const planesBatched = planesRaw.expandDims(0); // [1, H, W, C]

      const scalarsBatched = _tf.tensor2d(obs.scalars, [
        1,
        obs.shape.scalarCount,
      ]);

      // Model predict returns [policy_logits, value]
      const outputs = this.model!.predict([
        planesBatched,
        scalarsBatched,
      ]) as tf.Tensor[];
      const logits = outputs[0]; // [1, actionCount]

      // Simplified action mask: check if team can afford builds
      const ownTeam = payload.teams.find((t) => t.id === teamId);
      const canAfford = ownTeam ? ownTeam.resources >= MIN_BUILD_COST : false;

      if (!canAfford) {
        // Force no-op (action 0)
        return 0;
      }

      // Sample action from softmax of logits
      const probs = _tf.softmax(logits);
      const sampled = _tf.multinomial(probs as tf.Tensor2D, 1);
      return sampled.dataSync()[0];
    });

    this.lastActionIndex = actionIndex;
    return actionIndex;
  }

  /**
   * Returns the last action index from inference, or null if no inference
   * has been run yet. Used for the 'cached' fallback strategy.
   */
  public getLastAction(): number | null {
    return this.lastActionIndex;
  }

  /**
   * Warm up the model with a dummy inference to avoid cold-start latency
   * on the first real tick.
   */
  public warmUp(): void {
    if (!this.model) {
      console.error('No model loaded, skipping warm-up');
      return;
    }

    _tf.tidy(() => {
      const dummyPlanes = _tf.zeros([
        1,
        this.height,
        this.width,
        5, // NUM_CHANNELS
      ]);
      const dummyScalars = _tf.zeros([1, 7]); // NUM_SCALARS

      this.model!.predict([dummyPlanes, dummyScalars]);
    });

    console.error('Model warmed up');
  }

  /**
   * Decode an action index to a BuildQueuePayload.
   * Returns null for action 0 (no-op).
   */
  public decode(actionIndex: number): BuildQueuePayload | null {
    return this.decoder.decode(actionIndex);
  }
}
