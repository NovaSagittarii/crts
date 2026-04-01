import { describe, expect, it } from 'vitest';

import {
  computeReward,
  DEFAULT_REWARD_CONFIG,
  type RewardConfig,
  type RewardStateSnapshot,
} from './reward-signal.js';

function snap(overrides: Partial<RewardStateSnapshot> = {}): RewardStateSnapshot {
  return {
    resources: 100,
    income: 5,
    coreHp: 500,
    enemyCoreHp: 500,
    ...overrides,
  };
}

describe('computeReward', () => {
  it('terminal win returns +1.0 * weights.terminal', () => {
    const reward = computeReward(
      snap(),
      snap(),
      true,
      false,
      true,
      DEFAULT_REWARD_CONFIG,
      0,
    );
    expect(reward).toBe(1.0);
  });

  it('terminal loss returns -1.0 * weights.terminal', () => {
    const reward = computeReward(
      snap(),
      snap(),
      true,
      false,
      false,
      DEFAULT_REWARD_CONFIG,
      0,
    );
    expect(reward).toBe(-1.0);
  });

  it('terminal draw (truncated, no winner) returns 0.0', () => {
    const reward = computeReward(
      snap(),
      snap(),
      false,
      true,
      null,
      DEFAULT_REWARD_CONFIG,
      0,
    );
    expect(reward).toBe(0.0);
  });

  it('economy delta is computed correctly when shapedWeight > 0', () => {
    // prev: resources=10, income=1 => total=11
    // curr: resources=20, income=2 => total=22
    // economyDelta = (22 - 11) / 100 = 0.11
    // reward = 1.0 * (0.1 * 0.11 + 0.5 * 0) = 0.011
    const prev = snap({ resources: 10, income: 1, coreHp: 500, enemyCoreHp: 500 });
    const curr = snap({ resources: 20, income: 2, coreHp: 500, enemyCoreHp: 500 });

    const reward = computeReward(prev, curr, false, false, null, DEFAULT_REWARD_CONFIG, 0);
    expect(reward).toBeCloseTo(0.011, 6);
  });

  it('core damage is computed correctly when shapedWeight > 0', () => {
    // prev enemyCoreHp=500, curr enemyCoreHp=490 => coreDamage = 10/500 = 0.02
    // reward = 1.0 * (0.1 * 0 + 0.5 * 0.02) = 0.01
    const prev = snap({ resources: 100, income: 5, coreHp: 500, enemyCoreHp: 500 });
    const curr = snap({ resources: 100, income: 5, coreHp: 500, enemyCoreHp: 490 });

    const reward = computeReward(prev, curr, false, false, null, DEFAULT_REWARD_CONFIG, 0);
    expect(reward).toBeCloseTo(0.01, 6);
  });

  it('annealing at episode 0 has shapedWeight = 1.0', () => {
    const prev = snap({ resources: 0, income: 0, coreHp: 500, enemyCoreHp: 500 });
    const curr = snap({ resources: 100, income: 0, coreHp: 500, enemyCoreHp: 500 });
    // economyDelta = (100 - 0) / 100 = 1.0
    // reward = 1.0 * 0.1 * 1.0 = 0.1
    const reward = computeReward(prev, curr, false, false, null, DEFAULT_REWARD_CONFIG, 0);
    expect(reward).toBeCloseTo(0.1, 6);
  });

  it('annealing at episode >= annealEpisodes has shapedWeight = 0.0', () => {
    const prev = snap({ resources: 0, income: 0, coreHp: 500, enemyCoreHp: 500 });
    const curr = snap({ resources: 100, income: 0, coreHp: 500, enemyCoreHp: 500 });
    // shapedWeight = max(0, 1.0 - 10000/10000) = 0
    // reward = 0 (no terminal, no shaped reward)
    const reward = computeReward(prev, curr, false, false, null, DEFAULT_REWARD_CONFIG, 10000);
    expect(reward).toBe(0.0);
  });

  it('annealing at episode = annealEpisodes / 2 has shapedWeight = 0.5', () => {
    const prev = snap({ resources: 0, income: 0, coreHp: 500, enemyCoreHp: 500 });
    const curr = snap({ resources: 100, income: 0, coreHp: 500, enemyCoreHp: 500 });
    // shapedWeight = max(0, 1.0 - 5000/10000) = 0.5
    // economyDelta = 100/100 = 1.0
    // reward = 0.5 * 0.1 * 1.0 = 0.05
    const reward = computeReward(prev, curr, false, false, null, DEFAULT_REWARD_CONFIG, 5000);
    expect(reward).toBeCloseTo(0.05, 6);
  });

  it('custom weights scale individual components independently', () => {
    const customConfig: RewardConfig = {
      weights: { terminal: 1.0, economy_delta: 0.2, core_damage: 0.5 },
      annealEpisodes: 10000,
    };
    const prev = snap({ resources: 0, income: 0, coreHp: 500, enemyCoreHp: 500 });
    const curr = snap({ resources: 100, income: 0, coreHp: 500, enemyCoreHp: 500 });
    // economyDelta = 100/100 = 1.0
    // reward = 1.0 * 0.2 * 1.0 = 0.2 (doubled from DEFAULT 0.1)
    const reward = computeReward(prev, curr, false, false, null, customConfig, 0);
    expect(reward).toBeCloseTo(0.2, 6);
  });

  it('non-terminal tick with no changes returns 0.0 reward', () => {
    const s = snap();
    const reward = computeReward(s, s, false, false, null, DEFAULT_REWARD_CONFIG, 0);
    expect(reward).toBe(0.0);
  });
});
