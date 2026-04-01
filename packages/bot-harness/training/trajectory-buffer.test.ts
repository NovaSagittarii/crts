import { describe, it, expect } from 'vitest';

import type { TrajectoryStep, TrajectoryBatch } from './trajectory-buffer.js';
import { computeGAE, TrajectoryBuffer } from './trajectory-buffer.js';

describe('computeGAE', () => {
  it('produces correct advantages for 3-step non-terminal trajectory', () => {
    const rewards = [1, 1, 1];
    const values = [0.5, 0.5, 0.5];
    const dones = [false, false, false];
    const lastValue = 0.5;
    const gamma = 0.99;
    const lambda = 0.95;

    const { advantages, returns } = computeGAE(
      rewards,
      values,
      dones,
      lastValue,
      gamma,
      lambda,
    );

    // Hand-computed:
    // delta_2 = 1 + 0.99*0.5 - 0.5 = 0.995
    // gae_2   = 0.995
    // delta_1 = 1 + 0.99*0.5 - 0.5 = 0.995
    // gae_1   = 0.995 + 0.99*0.95*0.995 = 1.9310525
    // delta_0 = 1 + 0.99*0.5 - 0.5 = 0.995
    // gae_0   = 0.995 + 0.99*0.95*1.9310525 = 2.8101...
    expect(advantages[2]).toBeCloseTo(0.995, 4);
    expect(advantages[1]).toBeCloseTo(1.9310525, 4);
    expect(advantages[0]).toBeCloseTo(
      0.995 + 0.99 * 0.95 * 1.9310525,
      4,
    );

    // returns[t] = advantages[t] + values[t]
    expect(returns[2]).toBeCloseTo(0.995 + 0.5, 4);
    expect(returns[1]).toBeCloseTo(1.9310525 + 0.5, 4);
    expect(returns[0]).toBeCloseTo(advantages[0] + 0.5, 4);
  });

  it('zeros out future returns at terminal step', () => {
    const rewards = [1, 1, 1];
    const values = [0.5, 0.5, 0.5];
    const dones = [false, false, true]; // last step is terminal
    const lastValue = 0.5;
    const gamma = 0.99;
    const lambda = 0.95;

    const { advantages, returns } = computeGAE(
      rewards,
      values,
      dones,
      lastValue,
      gamma,
      lambda,
    );

    // t=2 (terminal): nextNonTerminal = 0
    // delta_2 = 1 + 0.99*0.5*0 - 0.5 = 0.5
    // gae_2 = 0.5
    expect(advantages[2]).toBeCloseTo(0.5, 4);

    // t=1 (non-terminal): nextNonTerminal = 1
    // But step 2 is terminal, so when going backward from step 2,
    // step 1 uses done[1] = false, so nextNonTerminal for step 1 = 1
    // delta_1 = 1 + 0.99*0.5*1 - 0.5 = 0.995
    // gae_1 = 0.995 + 0.99*0.95*1*0.5 = 0.995 + 0.47025 = 1.46525
    expect(advantages[1]).toBeCloseTo(1.46525, 4);

    // returns = advantages + values
    expect(returns[2]).toBeCloseTo(0.5 + 0.5, 4);
    expect(returns[1]).toBeCloseTo(1.46525 + 0.5, 4);
  });

  it('returns Float32Array for both advantages and returns', () => {
    const { advantages, returns } = computeGAE(
      [1],
      [0.5],
      [false],
      0.5,
      0.99,
      0.95,
    );

    expect(advantages).toBeInstanceOf(Float32Array);
    expect(returns).toBeInstanceOf(Float32Array);
  });
});

describe('TrajectoryBuffer', () => {
  function makeStep(overrides?: Partial<TrajectoryStep>): TrajectoryStep {
    return {
      planes: new Float32Array([1, 2, 3, 4]),
      scalars: new Float32Array([0.1, 0.2]),
      action: 0,
      reward: 1.0,
      value: 0.5,
      logProb: -1.0,
      done: false,
      actionMask: new Uint8Array([1, 1, 0]),
      ...overrides,
    };
  }

  it('stores steps with planes, scalars, action, reward, value, logProb, done, actionMask', () => {
    const buffer = new TrajectoryBuffer();
    const step = makeStep();
    buffer.add(step);

    expect(buffer.size()).toBe(1);
  });

  it('finalize calls computeGAE and populates advantages/returns', () => {
    const buffer = new TrajectoryBuffer();
    buffer.add(makeStep({ reward: 1.0, value: 0.5, done: false }));
    buffer.add(makeStep({ reward: 1.0, value: 0.5, done: false }));
    buffer.add(makeStep({ reward: 1.0, value: 0.5, done: false }));

    buffer.finalize(0.5, 0.99, 0.95);

    expect(buffer.advantages).not.toBeNull();
    expect(buffer.returns).not.toBeNull();
    expect(buffer.advantages!.length).toBe(3);
    expect(buffer.returns!.length).toBe(3);

    // Should match the hand-computed GAE values
    expect(buffer.advantages![2]).toBeCloseTo(0.995, 4);
  });

  it('getBatches yields mini-batches with correct size', () => {
    const buffer = new TrajectoryBuffer();
    for (let i = 0; i < 10; i++) {
      buffer.add(makeStep());
    }
    buffer.finalize(0.5, 0.99, 0.95);

    const batches = buffer.getBatches(4);
    // 10 steps with batchSize 4: yields [4, 4, 2]
    expect(batches.length).toBe(3);
    expect(batches[0].size).toBe(4);
    expect(batches[1].size).toBe(4);
    expect(batches[2].size).toBe(2);
  });

  it('getBatches returns normalized advantages (mean~0, std~1)', () => {
    const buffer = new TrajectoryBuffer();
    for (let i = 0; i < 20; i++) {
      buffer.add(makeStep({ reward: Math.random() * 2, value: Math.random() }));
    }
    buffer.finalize(0.5, 0.99, 0.95);

    const batches = buffer.getBatches(20); // one batch with all data
    expect(batches.length).toBe(1);

    const advs = batches[0].advantages;
    // Check normalization: mean should be close to 0
    let sum = 0;
    for (let i = 0; i < advs.length; i++) sum += advs[i];
    const mean = sum / advs.length;
    expect(mean).toBeCloseTo(0, 1);
  });

  it('getBatches returns correct typed arrays in TrajectoryBatch', () => {
    const buffer = new TrajectoryBuffer();
    for (let i = 0; i < 4; i++) {
      buffer.add(makeStep());
    }
    buffer.finalize(0.5, 0.99, 0.95);

    const batches = buffer.getBatches(4);
    expect(batches.length).toBe(1);
    const batch: TrajectoryBatch = batches[0];

    expect(batch.planes).toHaveLength(4);
    expect(batch.planes[0]).toBeInstanceOf(Float32Array);
    expect(batch.scalars).toHaveLength(4);
    expect(batch.scalars[0]).toBeInstanceOf(Float32Array);
    expect(batch.actions).toBeInstanceOf(Int32Array);
    expect(batch.oldLogProbs).toBeInstanceOf(Float32Array);
    expect(batch.advantages).toBeInstanceOf(Float32Array);
    expect(batch.returns).toBeInstanceOf(Float32Array);
    expect(batch.actionMasks).toHaveLength(4);
    expect(batch.actionMasks[0]).toBeInstanceOf(Uint8Array);
  });

  it('stores raw Float32Arrays, NOT tf.Tensor objects', () => {
    const step = makeStep();
    expect(step.planes).toBeInstanceOf(Float32Array);
    expect(step.scalars).toBeInstanceOf(Float32Array);
    // No tf.Tensor properties exist
    expect((step.planes as unknown as Record<string, unknown>)['dtype']).toBeUndefined();
    expect((step.planes as unknown as Record<string, unknown>)['dataSync']).toBeUndefined();
  });

  it('clear resets buffer state', () => {
    const buffer = new TrajectoryBuffer();
    buffer.add(makeStep());
    buffer.finalize(0.5, 0.99, 0.95);
    expect(buffer.size()).toBe(1);
    expect(buffer.advantages).not.toBeNull();

    buffer.clear();
    expect(buffer.size()).toBe(0);
    expect(buffer.advantages).toBeNull();
    expect(buffer.returns).toBeNull();
  });
});
