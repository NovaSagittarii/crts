import { describe, expect, it } from 'vitest';

import {
  bootstrapPercentileCI,
  mean,
  shannonEntropy,
  stddev,
  wilsonScoreInterval,
} from './stats.js';

describe('wilsonScoreInterval', () => {
  it('returns center ~0.5 for 50/100 at 95% confidence', () => {
    const result = wilsonScoreInterval(50, 100, 0.95);
    expect(result.center).toBeCloseTo(0.5, 1);
    expect(result.lower).toBeGreaterThan(0.39);
    expect(result.lower).toBeLessThan(0.42);
    expect(result.upper).toBeGreaterThan(0.58);
    expect(result.upper).toBeLessThan(0.61);
    expect(result.n).toBe(100);
  });

  it('returns { lower: 0, upper: 1, center: 0, n: 0 } for 0/0', () => {
    const result = wilsonScoreInterval(0, 0);
    expect(result.lower).toBe(0);
    expect(result.upper).toBe(1);
    expect(result.center).toBe(0);
    expect(result.n).toBe(0);
  });

  it('returns center ~1.0 with wide CI for 10/10 (small n)', () => {
    const result = wilsonScoreInterval(10, 10, 0.95);
    expect(result.center).toBeGreaterThan(0.7);
    expect(result.n).toBe(10);
    // CI should be wide due to small sample
    expect(result.upper - result.lower).toBeGreaterThan(0.1);
  });

  it('returns center ~0.0 and lower ~0.0 for 0/100', () => {
    const result = wilsonScoreInterval(0, 100, 0.95);
    expect(result.center).toBeLessThan(0.02);
    expect(result.lower).toBe(0);
    expect(result.n).toBe(100);
  });

  it('defaults to 0.95 confidence when not specified', () => {
    const result = wilsonScoreInterval(50, 100);
    const explicit = wilsonScoreInterval(50, 100, 0.95);
    expect(result.lower).toBeCloseTo(explicit.lower, 5);
    expect(result.upper).toBeCloseTo(explicit.upper, 5);
  });

  it('uses correct z-scores for 0.90 confidence', () => {
    const result = wilsonScoreInterval(50, 100, 0.90);
    // Narrower CI than 0.95
    const result95 = wilsonScoreInterval(50, 100, 0.95);
    expect(result.upper - result.lower).toBeLessThan(
      result95.upper - result95.lower,
    );
  });

  it('uses correct z-scores for 0.99 confidence', () => {
    const result = wilsonScoreInterval(50, 100, 0.99);
    // Wider CI than 0.95
    const result95 = wilsonScoreInterval(50, 100, 0.95);
    expect(result.upper - result.lower).toBeGreaterThan(
      result95.upper - result95.lower,
    );
  });
});

describe('bootstrapPercentileCI', () => {
  it('returns interval containing 0.5 for 50/100', () => {
    const result = bootstrapPercentileCI(50, 100, 0.95, 10000, 42);
    expect(result.lower).toBeLessThan(0.5);
    expect(result.upper).toBeGreaterThan(0.5);
    expect(result.center).toBeCloseTo(0.5, 1);
    expect(result.n).toBe(100);
  });

  it('returns { lower: 0, upper: 1, center: 0, n: 0 } for 0/0', () => {
    const result = bootstrapPercentileCI(0, 0);
    expect(result.lower).toBe(0);
    expect(result.upper).toBe(1);
    expect(result.center).toBe(0);
    expect(result.n).toBe(0);
  });

  it('produces deterministic results with same seed', () => {
    const a = bootstrapPercentileCI(30, 100, 0.95, 5000, 123);
    const b = bootstrapPercentileCI(30, 100, 0.95, 5000, 123);
    expect(a.lower).toBe(b.lower);
    expect(a.upper).toBe(b.upper);
  });

  it('interval width is reasonable for given sample size', () => {
    const result = bootstrapPercentileCI(30, 100, 0.95, 10000, 42);
    // Width should be non-trivial for n=100
    expect(result.upper - result.lower).toBeGreaterThan(0.05);
    expect(result.upper - result.lower).toBeLessThan(0.30);
    // CI should contain the true proportion
    expect(result.lower).toBeLessThanOrEqual(0.30);
    expect(result.upper).toBeGreaterThanOrEqual(0.30);
  });
});

describe('shannonEntropy', () => {
  it('returns 0 for empty array', () => {
    expect(shannonEntropy([])).toBe(0);
  });

  it('returns 0 for all-zero array', () => {
    expect(shannonEntropy([0, 0, 0])).toBe(0);
  });

  it('returns 0 for single non-zero element', () => {
    expect(shannonEntropy([5])).toBe(0);
  });

  it('returns 1.0 for two equal counts (base-2 entropy)', () => {
    expect(shannonEntropy([50, 50])).toBeCloseTo(1.0, 5);
  });

  it('returns ~1.585 for three equal counts', () => {
    // log2(3) = 1.58496...
    expect(shannonEntropy([10, 10, 10])).toBeCloseTo(Math.log2(3), 3);
  });
});

describe('mean', () => {
  it('returns 0 for empty array', () => {
    expect(mean([])).toBe(0);
  });

  it('computes mean correctly', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });
});

describe('stddev', () => {
  it('returns 0 for empty array', () => {
    expect(stddev([])).toBe(0);
  });

  it('returns 0 for single element', () => {
    expect(stddev([5])).toBe(0);
  });

  it('computes standard deviation correctly', () => {
    // stddev of [2, 4, 4, 4, 5, 5, 7, 9] = 2.0
    expect(stddev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.0, 5);
  });
});
