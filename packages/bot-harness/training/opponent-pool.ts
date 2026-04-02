import { join } from 'node:path';
import type * as tf from '@tensorflow/tfjs';

import type { BotStrategy } from '../bot-strategy.js';
import { NoOpBot } from '../noop-bot.js';
import { RandomBot } from '../random-bot.js';
import type { WeightData } from './ppo-network.js';
import { loadWeightsFromDir, saveModelToDir } from './tfjs-file-io.js';
import type { SelfPlayConfig } from './training-config.js';

/**
 * The category of an opponent in the self-play pool.
 */
export type OpponentType = 'latest' | 'historical' | 'random';

/**
 * An entry in the opponent pool representing one opponent option.
 */
export interface OpponentEntry {
  /** Category of the opponent. */
  type: OpponentType;
  /** Human-readable name for logging. */
  name: string;
  /** File path to the saved checkpoint (null for built-in bots). */
  path: string | null;
  /** Episode when checkpoint was created (-1 for built-in bots). */
  episode: number;
  /** Cached BotStrategy instance (non-null for built-in bots). */
  strategy: BotStrategy | null;
}

/**
 * Self-play opponent pool with checkpoint management (D-05, D-06, D-07, D-08).
 *
 * Manages a pool of historical checkpoints and built-in bots for diverse
 * opponent sampling during PPO training. Prevents mode collapse by mixing
 * the latest policy, historical checkpoints, and random/noop bots.
 */
export class OpponentPool {
  private readonly config: SelfPlayConfig;
  private readonly checkpointBaseDir: string;
  private readonly builtInBots: OpponentEntry[];
  private readonly checkpoints: OpponentEntry[];
  private latestCheckpointPathValue: string | null;

  public constructor(config: SelfPlayConfig, checkpointBaseDir: string) {
    this.config = config;
    this.checkpointBaseDir = checkpointBaseDir;
    this.latestCheckpointPathValue = null;
    this.checkpoints = [];

    // Seed with built-in bots per D-08
    this.builtInBots = [
      {
        type: 'random',
        name: 'RandomBot',
        path: null,
        episode: -1,
        strategy: new RandomBot(),
      },
      {
        type: 'random',
        name: 'NoOpBot',
        path: null,
        episode: -1,
        strategy: new NoOpBot(),
      },
    ];
  }

  /**
   * Sample an opponent from the pool using the three-way ratio (D-05).
   *
   * Ratio categories: latest checkpoint, random historical, random built-in bot.
   * Falls back to the next available category if the selected one is empty.
   */
  public sampleOpponent(): OpponentEntry {
    const roll = Math.random();
    const { latestRatio, historicalRatio } = this.config;

    // Try categories in priority order based on roll
    if (roll < latestRatio) {
      // Try latest
      if (this.latestCheckpointPathValue !== null) {
        return this.makeLatestEntry();
      }
      // Fall back to historical
      if (this.checkpoints.length > 0) {
        return this.sampleHistorical();
      }
      // Fall back to random
      return this.sampleBuiltIn();
    }

    if (roll < latestRatio + historicalRatio) {
      // Try historical
      if (this.checkpoints.length > 0) {
        return this.sampleHistorical();
      }
      // Fall back to latest
      if (this.latestCheckpointPathValue !== null) {
        return this.makeLatestEntry();
      }
      // Fall back to random
      return this.sampleBuiltIn();
    }

    // Random category
    return this.sampleBuiltIn();
  }

  /**
   * Check if a checkpoint should be saved at the given episode (D-06).
   */
  public shouldCheckpoint(episode: number): boolean {
    return episode > 0 && episode % this.config.checkpointInterval === 0;
  }

  /**
   * Add a checkpoint entry to the pool (synchronous, no disk I/O).
   *
   * Applies FIFO eviction when pool exceeds maxPoolSize (D-07).
   * Does NOT evict built-in bots.
   */
  public addCheckpoint(path: string, episode: number): void {
    const entry: OpponentEntry = {
      type: 'historical',
      name: `checkpoint-${String(episode)}`,
      path,
      episode,
      strategy: null,
    };

    this.checkpoints.push(entry);
    this.latestCheckpointPathValue = path;

    // FIFO eviction of oldest checkpoint (D-07)
    while (this.checkpoints.length > this.config.maxPoolSize) {
      this.checkpoints.shift();
    }
  }

  /**
   * Save a TF.js model checkpoint to disk and add to pool (D-04).
   *
   * @returns The directory path where the checkpoint was saved.
   */
  public async saveCheckpoint(
    model: tf.LayersModel,
    episode: number,
  ): Promise<string> {
    const dir = join(this.checkpointBaseDir, `checkpoint-${String(episode)}`);
    await saveModelToDir(model, dir);
    this.addCheckpoint(dir, episode);
    return dir;
  }

  /**
   * Load weights from a checkpoint entry's saved model.
   *
   * @returns WeightData array for applying to a model, or null for built-in bots.
   */
  public async loadOpponentWeights(
    entry: OpponentEntry,
  ): Promise<WeightData[] | null> {
    if (entry.path === null) {
      return null;
    }

    return loadWeightsFromDir(entry.path);
  }

  /**
   * Get the path of the most recently added checkpoint.
   */
  public getLatestCheckpointPath(): string | null {
    return this.latestCheckpointPathValue;
  }

  /**
   * Get the number of historical checkpoints in the pool.
   */
  public getPoolSize(): number {
    return this.checkpoints.length;
  }

  /**
   * Get all built-in bot entries.
   */
  public getBuiltInBots(): OpponentEntry[] {
    return [...this.builtInBots];
  }

  /**
   * Get the cached BotStrategy for a built-in bot entry.
   *
   * @throws If the entry does not have a cached strategy.
   */
  public getBuiltInBot(entry: OpponentEntry): BotStrategy {
    if (entry.strategy === null) {
      throw new Error(
        `Entry "${entry.name}" is not a built-in bot with a cached strategy`,
      );
    }
    return entry.strategy;
  }

  // --- Private helpers ---

  private makeLatestEntry(): OpponentEntry {
    return {
      type: 'latest',
      name: 'latest',
      path: this.latestCheckpointPathValue,
      episode: -1,
      strategy: null,
    };
  }

  private sampleHistorical(): OpponentEntry {
    const idx = Math.floor(Math.random() * this.checkpoints.length);
    return this.checkpoints[idx];
  }

  private sampleBuiltIn(): OpponentEntry {
    const idx = Math.floor(Math.random() * this.builtInBots.length);
    return this.builtInBots[idx];
  }
}
