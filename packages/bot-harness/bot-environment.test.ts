import { describe, expect, it, vi } from 'vitest';

import type { BotAction, BotStrategy, BotView } from './bot-strategy.js';
import { BotEnvironment } from './bot-environment.js';
import { NoOpBot } from './noop-bot.js';

describe('BotEnvironment', () => {
  // Use a small grid and NoOpBot default opponent for fast tests.
  // Action mask computation iterates all territory positions * templates,
  // so 20x20 with 5 templates is 2000 previews per mask.
  const smallConfig = { gridWidth: 20, gridHeight: 20, maxTicks: 50 };
  const noopOpponent = new NoOpBot();

  it('reset returns observation with valid shapes', { timeout: 15_000 }, () => {
    const env = new BotEnvironment(smallConfig);
    const result = env.reset(42, noopOpponent);

    // planes: 5 channels * 20 * 20 = 2000
    expect(result.observation.planes.length).toBe(5 * 20 * 20);
    expect(result.observation.scalars.length).toBe(7);
    expect(result.info.actionMask[0]).toBe(1); // no-op always valid
    expect(result.info.tick).toBe(0);
  });

  it('step noop advances tick and returns valid result', { timeout: 15_000 }, () => {
    const env = new BotEnvironment(smallConfig);
    env.reset(42, noopOpponent);
    const result = env.step(0);

    expect(result.terminated).toBe(false);
    expect(result.truncated).toBe(false);
    expect(result.info.tick).toBe(1);
    expect(typeof result.reward).toBe('number');
  });

  it('step build with valid action returns valid result', { timeout: 15_000 }, () => {
    const env = new BotEnvironment(smallConfig);
    const resetResult = env.reset(42, noopOpponent);

    // Find a valid build action (first index > 0 where mask is 1)
    let validAction = -1;
    for (let i = 1; i < resetResult.info.actionMask.length; i++) {
      if (resetResult.info.actionMask[i] === 1) {
        validAction = i;
        break;
      }
    }

    // If a valid action exists, step with it
    if (validAction > 0) {
      const result = env.step(validAction);
      expect(result.observation.planes.length).toBe(5 * 20 * 20);
      expect(result.observation.scalars.length).toBe(7);
      expect(typeof result.reward).toBe('number');
    } else {
      // At minimum, no-op should work
      const result = env.step(0);
      expect(result.observation.planes.length).toBe(5 * 20 * 20);
    }
  });

  it('observationSpace has correct shape', () => {
    const env = new BotEnvironment(smallConfig);

    expect(env.observationSpace.planes.shape).toEqual([5, 20, 20]);
    expect(env.observationSpace.scalars.shape).toEqual([7]);
    expect(env.observationSpace.planes.dtype).toBe('float32');
    expect(env.observationSpace.scalars.dtype).toBe('float32');
  });

  it('actionSpace has Discrete type and n > 0', () => {
    const env = new BotEnvironment(smallConfig);

    expect(env.actionSpace.type).toBe('Discrete');
    // 5 templates * 20 * 20 positions + 1 no-op = 2001
    expect(env.actionSpace.n).toBe(5 * 20 * 20 + 1);
  });

  it('episode truncates when tick limit is hit', { timeout: 300_000 }, () => {
    // Use very small maxTicks to keep this test feasible
    const truncConfig = { gridWidth: 20, gridHeight: 20, maxTicks: 10 };
    const env = new BotEnvironment(truncConfig);
    env.reset(42, noopOpponent);

    let lastResult;
    for (let i = 0; i < 10; i++) {
      lastResult = env.step(0);
      if (lastResult.terminated) break;
    }

    // Either terminated naturally or truncated at tick limit
    expect(
      lastResult!.terminated || lastResult!.truncated,
    ).toBe(true);

    if (!lastResult!.terminated) {
      expect(lastResult!.truncated).toBe(true);
    }
  });

  it('opponent BotStrategy executes each tick', { timeout: 15_000 }, () => {
    const mockBot: BotStrategy = {
      name: 'MockBot',
      decideTick: vi.fn((_view: BotView, _teamId: number): BotAction[] => []),
    };

    const env = new BotEnvironment(smallConfig);
    env.reset(42, mockBot);
    env.step(0);

    expect(mockBot.decideTick).toHaveBeenCalledOnce();
  });

  it('reward is a finite number on each step', { timeout: 15_000 }, () => {
    const env = new BotEnvironment(smallConfig);
    env.reset(42, noopOpponent);
    const result = env.step(0);

    expect(Number.isFinite(result.reward)).toBe(true);
  });

  it('step info contains tick, actionMask, actionSpaceSize, teamId, matchOutcome', { timeout: 15_000 }, () => {
    const env = new BotEnvironment(smallConfig);
    env.reset(42, noopOpponent);
    const result = env.step(0);

    expect(typeof result.info.tick).toBe('number');
    expect(result.info.actionMask).toBeInstanceOf(Uint8Array);
    expect(typeof result.info.actionSpaceSize).toBe('number');
    expect(typeof result.info.teamId).toBe('number');
    expect('matchOutcome' in result.info).toBe(true);
  });
});
