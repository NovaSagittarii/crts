/**
 * Tick budget tracker for bot inference timing management.
 *
 * Tracks inference duration against a per-tick budget, provides fallback
 * strategy signals, and accumulates performance metrics for logging.
 */

/**
 * Strategy applied when inference exceeds the tick budget.
 * - 'noop': skip this tick's action entirely
 * - 'cached': use the last computed action (caller manages cache)
 * - 'deadline': allow the action but log the overage
 */
export type FallbackStrategy = 'noop' | 'cached' | 'deadline';

/**
 * Per-tick inference timing metrics.
 */
export interface TickMetrics {
  /** Wall-clock inference duration in milliseconds */
  inferenceMs: number;
  /** Ratio of inferenceMs to budgetMs (>1 means over budget) */
  budgetUtilization: number;
  /** True if inference exceeded the budget */
  fallbackTriggered: boolean;
  /** Human-readable reason when fallback is triggered */
  fallbackReason?: string;
}

/**
 * Configuration for the tick budget tracker.
 */
export interface TickBudgetConfig {
  /** Maximum allowed inference time per tick in milliseconds */
  budgetMs: number;
  /** Strategy to apply when budget is exceeded */
  fallback: FallbackStrategy;
}

/**
 * Cumulative performance statistics across all tracked ticks.
 */
export interface TickBudgetStats {
  /** Total number of ticks tracked */
  totalTicks: number;
  /** Number of ticks where fallback was triggered */
  fallbackCount: number;
  /** Average inference time across all ticks in ms */
  avgInferenceMs: number;
  /** Maximum inference time observed in ms */
  maxInferenceMs: number;
}

const DEFAULT_CONFIG: TickBudgetConfig = {
  budgetMs: 80,
  fallback: 'noop',
};

/**
 * Tracks per-tick inference timing against a configurable budget,
 * provides fallback strategy signals, and accumulates stats.
 */
export class TickBudgetTracker {
  private readonly config: TickBudgetConfig;
  private tickStartMs: number = 0;

  // Cumulative stats
  private totalTicks: number = 0;
  private fallbackCount: number = 0;
  private totalInferenceMs: number = 0;
  private maxInferenceMs: number = 0;

  constructor(config?: TickBudgetConfig) {
    this.config = config ?? { ...DEFAULT_CONFIG };
  }

  /**
   * Record the start of a tick's inference phase.
   */
  public startTick(): void {
    this.tickStartMs = performance.now();
  }

  /**
   * Record the end of a tick's inference phase and compute metrics.
   *
   * @returns Metrics for this tick including timing and fallback status.
   */
  public endTick(): TickMetrics {
    const endMs = performance.now();
    const inferenceMs = endMs - this.tickStartMs;
    const budgetUtilization = inferenceMs / this.config.budgetMs;
    const fallbackTriggered = inferenceMs > this.config.budgetMs;

    // Update cumulative stats
    this.totalTicks++;
    this.totalInferenceMs += inferenceMs;
    if (inferenceMs > this.maxInferenceMs) {
      this.maxInferenceMs = inferenceMs;
    }
    if (fallbackTriggered) {
      this.fallbackCount++;
    }

    const metrics: TickMetrics = {
      inferenceMs,
      budgetUtilization,
      fallbackTriggered,
    };

    if (fallbackTriggered) {
      metrics.fallbackReason = `budget exceeded (${inferenceMs.toFixed(1)}ms > ${String(this.config.budgetMs)}ms)`;
    }

    return metrics;
  }

  /**
   * Determine whether the bot should act on this tick's inference result.
   *
   * For 'noop' and 'cached' fallback strategies, returns false when the
   * budget was exceeded. For 'cached', the caller should use the previous
   * action. For 'deadline', always returns true (action allowed despite overage).
   */
  public shouldAct(metrics: TickMetrics): boolean {
    if (!metrics.fallbackTriggered) {
      return true;
    }

    if (this.config.fallback === 'deadline') {
      return true;
    }

    // 'noop' and 'cached' both return false -- caller differentiates behavior
    return false;
  }

  /**
   * Returns cumulative performance statistics across all tracked ticks.
   */
  public getStats(): TickBudgetStats {
    return {
      totalTicks: this.totalTicks,
      fallbackCount: this.fallbackCount,
      avgInferenceMs:
        this.totalTicks > 0 ? this.totalInferenceMs / this.totalTicks : 0,
      maxInferenceMs: this.maxInferenceMs,
    };
  }

  /**
   * Format a single-line log string for debugging tick performance.
   */
  public formatMetricsLog(metrics: TickMetrics, tick: number): string {
    const ms = metrics.inferenceMs.toFixed(1);
    const util = (metrics.budgetUtilization * 100).toFixed(0);
    let line = `[tick ${String(tick)}] inference=${ms}ms budget=${util}%`;

    if (metrics.fallbackTriggered) {
      line += ` fallback=${this.config.fallback}`;
    }

    return line;
  }
}
