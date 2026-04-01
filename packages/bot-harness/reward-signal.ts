/**
 * Reward signal module for the RL training pipeline.
 *
 * Computes shaped + terminal rewards with linear annealing as a pure function.
 * No internal state, no side effects. Annealing state (episodeNumber) is
 * passed in by the caller.
 */

export interface RewardConfig {
  weights: {
    terminal: number;
    economy_delta: number;
    core_damage: number;
  };
  annealEpisodes: number;
}

export const DEFAULT_REWARD_CONFIG: RewardConfig = {
  weights: { terminal: 1.0, economy_delta: 0.1, core_damage: 0.5 },
  annealEpisodes: 10000,
};

export interface RewardStateSnapshot {
  resources: number;
  income: number;
  coreHp: number;
  enemyCoreHp: number;
}

/**
 * Compute the reward for a single step.
 *
 * @param prev - State snapshot at the previous tick
 * @param curr - State snapshot at the current tick
 * @param terminated - Whether the match ended naturally (e.g., core destroyed)
 * @param truncated - Whether the match was truncated (tick limit reached)
 * @param isWinner - true if this team won, false if lost, null if draw or not finished
 * @param config - Reward configuration with weights and annealing schedule
 * @param episodeNumber - Current episode number for annealing computation
 * @returns Total reward for this step
 */
export function computeReward(
  prev: RewardStateSnapshot,
  curr: RewardStateSnapshot,
  terminated: boolean,
  truncated: boolean,
  isWinner: boolean | null,
  config: RewardConfig,
  episodeNumber: number,
): number {
  let reward = 0;

  // 1. Terminal reward
  if (terminated || truncated) {
    if (isWinner === true) {
      reward += 1.0 * config.weights.terminal;
    } else if (isWinner === false) {
      reward += -1.0 * config.weights.terminal;
    }
    // isWinner === null (draw) adds 0.0
  }

  // 2. Shaped rewards with linear annealing
  const shapedWeight = Math.max(0, 1.0 - episodeNumber / config.annealEpisodes);

  if (shapedWeight > 0) {
    const economyDelta =
      (curr.resources + curr.income - (prev.resources + prev.income)) / 100;

    const coreDamage = (prev.enemyCoreHp - curr.enemyCoreHp) / 500;

    reward +=
      shapedWeight *
      (config.weights.economy_delta * economyDelta +
        config.weights.core_damage * coreDamage);
  }

  return reward;
}
