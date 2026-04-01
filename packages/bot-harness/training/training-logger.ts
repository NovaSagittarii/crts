import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { TrainingConfig } from './training-config.js';

/**
 * A single training episode log entry for NDJSON output (D-09).
 */
export interface TrainingLogEntry {
  /** Episode number. */
  episode: number;
  /** ISO timestamp when the episode completed. */
  timestamp: string;
  /** Episode reward. */
  reward: number;
  /** Cumulative reward across all episodes. */
  cumulativeReward: number;
  /** Running win rate against the opponent pool. */
  winRate: number;
  /** Name of the opponent used in this episode. */
  opponent: string;
  /** PPO policy loss for this update. */
  policyLoss: number;
  /** PPO value loss for this update. */
  valueLoss: number;
  /** Entropy of the policy distribution. */
  entropy: number;
  /** Approximate KL divergence from the old policy. */
  approxKl: number;
  /** Number of game ticks in this episode. */
  episodeTicks: number;
  /** Wall-clock time for this episode in milliseconds. */
  elapsedMs: number;
}

/**
 * Structured training logger with NDJSON file output and live stdout metrics (D-09, D-10).
 *
 * Creates a run directory structure per D-10:
 *   runs/<run-id>/config.json
 *   runs/<run-id>/training-log.ndjson
 *   runs/<run-id>/checkpoints/
 *   runs/<run-id>/final-model/
 */
export class TrainingLogger {
  private readonly runDir: string;

  public constructor(outputDir: string, runId: string) {
    this.runDir = join(outputDir, runId);
  }

  /**
   * Initialize the run directory structure.
   *
   * Creates the run directory, checkpoints/, and final-model/ subdirectories.
   */
  public async init(): Promise<void> {
    await mkdir(this.runDir, { recursive: true });
    await mkdir(join(this.runDir, 'checkpoints'), { recursive: true });
    await mkdir(join(this.runDir, 'final-model'), { recursive: true });
  }

  /**
   * Write the full training configuration to config.json.
   */
  public async logConfig(config: TrainingConfig): Promise<void> {
    const configPath = join(this.runDir, 'config.json');
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8');
  }

  /**
   * Append an episode log entry as an NDJSON line to training-log.ndjson (D-09).
   */
  public async logEpisode(entry: TrainingLogEntry): Promise<void> {
    const logPath = join(this.runDir, 'training-log.ndjson');
    const line = JSON.stringify(entry) + '\n';
    await appendFile(logPath, line, 'utf-8');
  }

  /**
   * Format a live metrics string for stdout display (D-09).
   *
   * Includes episode count, reward, win rate, loss values, ticks, and ETA.
   */
  public formatLiveMetrics(
    entry: TrainingLogEntry,
    totalEpisodes: number,
    startTime: number,
  ): string {
    const elapsed = Date.now() - startTime;
    const episodesCompleted = entry.episode;
    const remaining = totalEpisodes - episodesCompleted;

    let eta = 'N/A';
    if (episodesCompleted > 0) {
      const msPerEpisode = elapsed / episodesCompleted;
      const remainingMs = msPerEpisode * remaining;
      eta = formatDuration(remainingMs);
    }

    return (
      `[Episode ${String(entry.episode)}/${String(totalEpisodes)}] ` +
      `reward=${String(entry.reward)} ` +
      `winRate=${String(entry.winRate)} ` +
      `pLoss=${String(entry.policyLoss)} ` +
      `vLoss=${String(entry.valueLoss)} ` +
      `ent=${String(entry.entropy)} ` +
      `kl=${String(entry.approxKl)} ` +
      `ticks=${String(entry.episodeTicks)} ` +
      `ETA=${eta}`
    );
  }

  /**
   * Get the run directory path.
   */
  public getRunDir(): string {
    return this.runDir;
  }

  /**
   * Get the checkpoints directory path.
   */
  public getCheckpointDir(): string {
    return join(this.runDir, 'checkpoints');
  }

  /**
   * Get the final model directory path.
   */
  public getFinalModelDir(): string {
    return join(this.runDir, 'final-model');
  }
}

/**
 * Format a duration in milliseconds to a human-readable string.
 *
 * Examples: "1h23m", "12m30s", "45s"
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours)}h${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${String(minutes)}m${String(seconds).padStart(2, '0')}s`;
  }
  return `${String(seconds)}s`;
}
