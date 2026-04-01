import { describe, expect, test, vi } from 'vitest';

import { TickBudgetTracker } from './tick-budget.js';
import type { TickMetrics } from './tick-budget.js';

describe('TickBudgetTracker', () => {
  test('startTick and endTick records timing and computes metrics', () => {
    const tracker = new TickBudgetTracker({ budgetMs: 100, fallback: 'noop' });

    // Mock performance.now
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    tracker.startTick();
    now = 1050; // 50ms elapsed
    const metrics = tracker.endTick();

    expect(metrics.inferenceMs).toBeCloseTo(50, 1);
    expect(metrics.budgetUtilization).toBeCloseTo(0.5, 2);
    expect(metrics.fallbackTriggered).toBe(false);

    vi.restoreAllMocks();
  });

  test('fallbackTriggered is true when inference exceeds budget', () => {
    const tracker = new TickBudgetTracker({ budgetMs: 80, fallback: 'noop' });

    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    tracker.startTick();
    now = 1100; // 100ms > 80ms budget
    const metrics = tracker.endTick();

    expect(metrics.inferenceMs).toBeCloseTo(100, 1);
    expect(metrics.budgetUtilization).toBeCloseTo(1.25, 2);
    expect(metrics.fallbackTriggered).toBe(true);

    vi.restoreAllMocks();
  });

  test('shouldAct returns true when within budget', () => {
    const tracker = new TickBudgetTracker({ budgetMs: 100, fallback: 'noop' });
    const metrics: TickMetrics = {
      inferenceMs: 50,
      budgetUtilization: 0.5,
      fallbackTriggered: false,
    };
    expect(tracker.shouldAct(metrics)).toBe(true);
  });

  test('shouldAct returns false with noop fallback when over budget', () => {
    const tracker = new TickBudgetTracker({ budgetMs: 80, fallback: 'noop' });
    const metrics: TickMetrics = {
      inferenceMs: 100,
      budgetUtilization: 1.25,
      fallbackTriggered: true,
    };
    expect(tracker.shouldAct(metrics)).toBe(false);
  });

  test('shouldAct returns false with cached fallback when over budget', () => {
    const tracker = new TickBudgetTracker({ budgetMs: 80, fallback: 'cached' });
    const metrics: TickMetrics = {
      inferenceMs: 100,
      budgetUtilization: 1.25,
      fallbackTriggered: true,
    };
    expect(tracker.shouldAct(metrics)).toBe(false);
  });

  test('getStats tracks cumulative statistics', () => {
    const tracker = new TickBudgetTracker({ budgetMs: 100, fallback: 'noop' });

    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    // Tick 1: 50ms (within budget)
    tracker.startTick();
    now = 50;
    tracker.endTick();

    // Tick 2: 150ms (over budget)
    tracker.startTick();
    now = 200;
    tracker.endTick();

    // Tick 3: 100ms (exactly at budget -- not over)
    tracker.startTick();
    now = 300;
    tracker.endTick();

    const stats = tracker.getStats();
    expect(stats.totalTicks).toBe(3);
    expect(stats.fallbackCount).toBe(1); // only tick 2 exceeded
    expect(stats.avgInferenceMs).toBeCloseTo(100, 1); // (50+150+100)/3
    expect(stats.maxInferenceMs).toBeCloseTo(150, 1);

    vi.restoreAllMocks();
  });

  test('formatMetricsLog produces single-line debug string', () => {
    const tracker = new TickBudgetTracker({ budgetMs: 80, fallback: 'noop' });
    const metrics: TickMetrics = {
      inferenceMs: 45.678,
      budgetUtilization: 0.571,
      fallbackTriggered: false,
    };

    const log = tracker.formatMetricsLog(metrics, 42);
    expect(typeof log).toBe('string');
    expect(log).toContain('42');
    expect(log).toContain('45.7');
    expect(log).not.toContain('\n');
  });

  test('formatMetricsLog includes fallback info when triggered', () => {
    const tracker = new TickBudgetTracker({ budgetMs: 80, fallback: 'cached' });
    const metrics: TickMetrics = {
      inferenceMs: 100,
      budgetUtilization: 1.25,
      fallbackTriggered: true,
      fallbackReason: 'budget exceeded',
    };

    const log = tracker.formatMetricsLog(metrics, 10);
    expect(log).toContain('fallback');
    expect(log).toContain('cached');
  });

  test('uses default config when no config provided', () => {
    const tracker = new TickBudgetTracker();
    // Default is budgetMs: 80, fallback: 'noop'
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);

    tracker.startTick();
    now = 50; // 50ms < 80ms default
    const metrics = tracker.endTick();

    expect(metrics.fallbackTriggered).toBe(false);
    expect(metrics.budgetUtilization).toBeCloseTo(50 / 80, 2);

    vi.restoreAllMocks();
  });
});
