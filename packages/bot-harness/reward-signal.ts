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

export function computeReward(
  _prev: RewardStateSnapshot,
  _curr: RewardStateSnapshot,
  _terminated: boolean,
  _truncated: boolean,
  _isWinner: boolean | null,
  _config: RewardConfig,
  _episodeNumber: number,
): number {
  throw new Error('Not implemented');
}
