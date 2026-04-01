/**
 * Trajectory storage and GAE computation for PPO training.
 *
 * All data is stored as plain JS typed arrays (Float32Array, Uint8Array, etc.)
 * -- NO tf.Tensor objects. This avoids memory leaks from uncollected tensors
 * and keeps trajectory data safe for cross-thread transfer.
 */

/**
 * A single step of experience collected during an episode.
 *
 * All fields use plain JS typed arrays, NOT tf.Tensor objects.
 */
export interface TrajectoryStep {
  /** Flat channel-first observation planes [C*H*W] */
  planes: Float32Array;
  /** Scalar observation features */
  scalars: Float32Array;
  /** Discrete action index taken */
  action: number;
  /** Reward received after this step */
  reward: number;
  /** Value function estimate at this state */
  value: number;
  /** Log probability of the action under the policy at collection time */
  logProb: number;
  /** Whether this step ended the episode */
  done: boolean;
  /** Valid action mask at this state */
  actionMask: Uint8Array;
}

/**
 * A mini-batch of trajectory data for PPO updates.
 */
export interface TrajectoryBatch {
  /** Per-step flat plane arrays */
  planes: Float32Array[];
  /** Per-step scalar arrays */
  scalars: Float32Array[];
  /** Actions taken */
  actions: Int32Array;
  /** Log probabilities under old policy */
  oldLogProbs: Float32Array;
  /** GAE advantages (normalized) */
  advantages: Float32Array;
  /** Discounted returns (advantages + values) */
  returns: Float32Array;
  /** Per-step action masks */
  actionMasks: Uint8Array[];
  /** Number of steps in this batch */
  size: number;
}

/**
 * Compute Generalized Advantage Estimation (GAE) using a backward pass.
 *
 * Standard GAE-Lambda: for t from T-1 to 0:
 *   delta_t = r_t + gamma * V(s_{t+1}) * (1 - done_t) - V(s_t)
 *   A_t = delta_t + gamma * lambda * (1 - done_t) * A_{t+1}
 *   R_t = A_t + V(s_t)
 *
 * @param rewards - Per-step rewards
 * @param values - Per-step value estimates
 * @param dones - Per-step terminal flags
 * @param lastValue - Value estimate for the state after the last step
 * @param gamma - Discount factor
 * @param lambda - GAE lambda (bias-variance tradeoff)
 * @returns advantages and returns as Float32Arrays
 */
export function computeGAE(
  rewards: number[],
  values: number[],
  dones: boolean[],
  lastValue: number,
  gamma: number,
  lambda: number,
): { advantages: Float32Array; returns: Float32Array } {
  const T = rewards.length;
  const advantages = new Float32Array(T);
  const returns = new Float32Array(T);

  let lastGAE = 0;
  for (let t = T - 1; t >= 0; t--) {
    const nextValue = t === T - 1 ? lastValue : values[t + 1];
    const nextNonTerminal = dones[t] ? 0 : 1;
    const delta = rewards[t] + gamma * nextValue * nextNonTerminal - values[t];
    lastGAE = delta + gamma * lambda * nextNonTerminal * lastGAE;
    advantages[t] = lastGAE;
    returns[t] = advantages[t] + values[t];
  }

  return { advantages, returns };
}

/**
 * Buffer for collecting trajectory steps during episode collection.
 *
 * After all steps are added, call `finalize()` to compute GAE advantages
 * and returns, then use `getBatches()` to produce mini-batches for PPO updates.
 */
export class TrajectoryBuffer {
  private steps: TrajectoryStep[] = [];
  public advantages: Float32Array | null = null;
  public returns: Float32Array | null = null;

  /**
   * Add a step to the trajectory.
   */
  public add(step: TrajectoryStep): void {
    this.steps.push(step);
  }

  /**
   * Number of steps stored.
   */
  public size(): number {
    return this.steps.length;
  }

  /**
   * Compute GAE advantages and returns for all stored steps.
   *
   * @param lastValue - Value estimate for the state after the last step
   * @param gamma - Discount factor
   * @param lambda - GAE lambda
   */
  public finalize(lastValue: number, gamma: number, lambda: number): void {
    const rewards = this.steps.map((s) => s.reward);
    const values = this.steps.map((s) => s.value);
    const dones = this.steps.map((s) => s.done);

    const result = computeGAE(rewards, values, dones, lastValue, gamma, lambda);
    this.advantages = result.advantages;
    this.returns = result.returns;
  }

  /**
   * Produce shuffled mini-batches from the finalized buffer.
   *
   * Advantages are normalized (mean=0, std=1) across the full buffer
   * before splitting into batches.
   *
   * @param batchSize - Maximum number of steps per batch
   * @returns Array of TrajectoryBatch objects
   */
  public getBatches(batchSize: number): TrajectoryBatch[] {
    if (this.advantages === null || this.returns === null) {
      throw new Error('Buffer must be finalized before getBatches');
    }

    const T = this.steps.length;

    // Normalize advantages: mean=0, std=1
    const normalizedAdvantages = this.normalizeAdvantages(this.advantages);

    // Shuffle indices
    const indices = Array.from({ length: T }, (_, i) => i);
    for (let i = T - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    // Split into batches
    const batches: TrajectoryBatch[] = [];
    for (let start = 0; start < T; start += batchSize) {
      const end = Math.min(start + batchSize, T);
      const batchIndices = indices.slice(start, end);
      const size = batchIndices.length;

      const planes: Float32Array[] = new Array<Float32Array>(size);
      const scalars: Float32Array[] = new Array<Float32Array>(size);
      const actions = new Int32Array(size);
      const oldLogProbs = new Float32Array(size);
      const advantages = new Float32Array(size);
      const returns = new Float32Array(size);
      const actionMasks: Uint8Array[] = new Array<Uint8Array>(size);

      for (let b = 0; b < size; b++) {
        const idx = batchIndices[b];
        const step = this.steps[idx];
        planes[b] = step.planes;
        scalars[b] = step.scalars;
        actions[b] = step.action;
        oldLogProbs[b] = step.logProb;
        advantages[b] = normalizedAdvantages[idx];
        returns[b] = this.returns[idx];
        actionMasks[b] = step.actionMask;
      }

      batches.push({
        planes,
        scalars,
        actions,
        oldLogProbs,
        advantages,
        returns,
        actionMasks,
        size,
      });
    }

    return batches;
  }

  /**
   * Reset the buffer for reuse.
   */
  public clear(): void {
    this.steps = [];
    this.advantages = null;
    this.returns = null;
  }

  /**
   * Normalize advantages to mean=0, std=1.
   */
  private normalizeAdvantages(advantages: Float32Array): Float32Array {
    const T = advantages.length;
    if (T === 0) return new Float32Array(0);

    let sum = 0;
    for (let i = 0; i < T; i++) sum += advantages[i];
    const mean = sum / T;

    let sumSq = 0;
    for (let i = 0; i < T; i++) {
      const diff = advantages[i] - mean;
      sumSq += diff * diff;
    }
    const std = Math.sqrt(sumSq / T) + 1e-8;

    const normalized = new Float32Array(T);
    for (let i = 0; i < T; i++) {
      normalized[i] = (advantages[i] - mean) / std;
    }
    return normalized;
  }
}
