/**
 * Training coordinator: main thread orchestrator for the actor-learner split (D-14).
 *
 * Spawns worker threads for parallel episode collection, distributes frozen
 * policy weights, collects trajectories, and triggers PPO updates on the
 * main thread.
 */

import { cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { readdir } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { writeFile, readFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
import { getTf } from '../tf-backend.js';
import type { TfModule } from '../tf-backend.js';
import type * as tf from '@tensorflow/tfjs';

import { BotEnvironment } from '../bot-environment.js';

import { OpponentPool } from './opponent-pool.js';
import type { WeightData, PPOModelConfig } from './ppo-network.js';
import { buildPPOModel, extractWeights, buildModelConfigFromEnv, initTfBackend as initPpoNetworkTf } from './ppo-network.js';
import { PPOTrainer } from './ppo-trainer.js';
import type { PPOUpdateResult } from './ppo-trainer.js';
import { initTfBackend as initPpoTrainerTf } from './ppo-trainer.js';

let _tf: TfModule;

/** Initialize the TF.js backend for this module. Must be called before any TF.js operations. */
export async function initTfBackend(): Promise<void> {
  _tf = await getTf();
}
import { TrajectoryBuffer } from './trajectory-buffer.js';
import type { TrajectoryStep } from './trajectory-buffer.js';
import type { TrainingConfig } from './training-config.js';
import { generateTrainingRunId } from './training-config.js';
import { TrainingLogger } from './training-logger.js';
import type { SerializedTrajectory, EpisodeResultMessage } from './training-worker.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Result from a single collected episode.
 */
export interface EpisodeResult {
  reward: number;
  ticks: number;
  won: boolean;
  opponentName: string;
  opponentType: string;
  trajectory: TrajectoryStep[];
  finalValue: number;
}

// ---------------------------------------------------------------------------
// TrainingCoordinator
// ---------------------------------------------------------------------------

/**
 * Main thread orchestrator implementing the actor-learner split (D-14).
 *
 * - Spawns worker threads for parallel episode collection
 * - Distributes frozen policy weights after each PPO update (D-17)
 * - Collects trajectories from workers
 * - Runs PPO gradient updates on the main thread
 * - Manages checkpoint lifecycle via OpponentPool
 * - Supports resume from previous run (D-11)
 */
export class TrainingCoordinator {
  private readonly config: TrainingConfig;
  private readonly workerCount: number;
  private readonly batchEpisodes: number;

  private model: tf.LayersModel | null = null;
  private trainer: PPOTrainer | null = null;
  private modelConfig: PPOModelConfig | null = null;
  private workers: Worker[] = [];
  private opponentPool: OpponentPool | null = null;
  private logger: TrainingLogger | null = null;
  private episodeCounter: number = 0;
  private runId: string;
  private wins: number = 0;
  private totalGames: number = 0;

  constructor(config: TrainingConfig) {
    this.config = config;

    // D-15: auto-detect worker count
    this.workerCount = config.workers > 0
      ? config.workers
      : Math.max(1, cpus().length - 2);

    // D-16: configurable batch episodes
    this.batchEpisodes = config.batchEpisodes > 0
      ? config.batchEpisodes
      : this.workerCount * 4;

    // Generate or reuse run ID
    this.runId = config.resumeRunId ?? generateTrainingRunId();
  }

  /**
   * Initialize the coordinator: build model, create trainer, spawn workers.
   */
  public async init(): Promise<void> {
    // Initialize TF.js backend for all modules
    _tf = await getTf();
    await initPpoNetworkTf();
    await initPpoTrainerTf();

    // Create BotEnvironment for metadata only (observationSpace, actionSpace)
    const env = new BotEnvironment({
      gridWidth: this.config.gridWidth,
      gridHeight: this.config.gridHeight,
      maxTicks: this.config.maxTicks,
    });

    // Build model config from env metadata
    this.modelConfig = buildModelConfigFromEnv(env, this.config.network);

    // Build main thread model
    this.model = buildPPOModel(this.modelConfig);

    // Create PPO trainer
    this.trainer = new PPOTrainer(this.model, this.config);

    // Create logger and init directory structure
    this.logger = new TrainingLogger(this.config.outputDir, this.runId);
    await this.logger.init();
    await this.logger.logConfig(this.config);

    // Create opponent pool
    this.opponentPool = new OpponentPool(
      this.config.selfPlay,
      this.logger.getCheckpointDir(),
    );

    // Resume support (D-11)
    if (this.config.resumeRunId !== null) {
      await this.loadResume();
    }

    // Spawn worker threads
    this.workers = await this.spawnWorkers(this.workerCount);
  }

  /**
   * Main training loop: collect episodes -> PPO update -> checkpoint -> repeat.
   */
  public async run(): Promise<void> {
    if (!this.model || !this.trainer || !this.logger || !this.opponentPool) {
      throw new Error('Coordinator not initialized');
    }

    const startTime = Date.now();
    const totalEpisodes = this.config.totalEpisodes;

    while (this.episodeCounter < totalEpisodes) {
      // (a) Extract current weights from model
      const weights = extractWeights(this.model);

      // (b) Send weights to all workers (D-17)
      await this.broadcastWeights(weights);

      // (c) Collect a batch of episodes
      const batchSize = Math.min(
        this.batchEpisodes,
        totalEpisodes - this.episodeCounter,
      );
      const episodeResults = await this.collectBatch(batchSize);

      // (d) Deserialize trajectories into TrajectoryBuffer
      const buffer = new TrajectoryBuffer();
      for (const result of episodeResults) {
        for (const step of result.trajectory) {
          buffer.add(step);
        }
      }

      // (e) Finalize buffer (compute GAE)
      // Use the average final value across episodes as the bootstrap
      const avgFinalValue =
        episodeResults.reduce((sum, r) => sum + r.finalValue, 0) /
        episodeResults.length;
      buffer.finalize(avgFinalValue, this.config.gamma, this.config.gaeLambda);

      // (f) Run PPO update
      let updateResult: PPOUpdateResult | null = null;
      if (buffer.size() > 0) {
        updateResult = this.trainer.update(buffer);
      }

      // (g) Log metrics for each episode in the batch
      for (const result of episodeResults) {
        this.episodeCounter++;
        this.totalGames++;
        if (result.won) this.wins++;

        const winRate = this.totalGames > 0 ? this.wins / this.totalGames : 0;

        const entry = {
          episode: this.episodeCounter,
          timestamp: new Date().toISOString(),
          reward: result.reward,
          cumulativeReward: result.reward,
          winRate,
          opponent: result.opponentName,
          policyLoss: updateResult?.meanPolicyLoss ?? 0,
          valueLoss: updateResult?.meanValueLoss ?? 0,
          entropy: updateResult?.meanEntropy ?? 0,
          approxKl: updateResult?.meanKl ?? 0,
          episodeTicks: result.ticks,
          elapsedMs: Date.now() - startTime,
        };

        await this.logger.logEpisode(entry);
      }

      // (h) Checkpoint if needed
      if (this.opponentPool.shouldCheckpoint(this.episodeCounter)) {
        await this.opponentPool.saveCheckpoint(this.model, this.episodeCounter);
        await this.saveOptimizerState(
          join(this.logger.getCheckpointDir(), `checkpoint-${String(this.episodeCounter)}`),
        );
      }

      // Buffer is consumed, clear for next round
      buffer.clear();
    }

    // Save final model
    const { saveModelToDir } = await import('./tfjs-file-io.js');
    await saveModelToDir(this.model, this.logger.getFinalModelDir());
  }

  /**
   * Get current episode count.
   */
  public getEpisodeCounter(): number {
    return this.episodeCounter;
  }

  /**
   * Get the run ID.
   */
  public getRunId(): string {
    return this.runId;
  }

  /**
   * Get the logger instance.
   */
  public getLogger(): TrainingLogger | null {
    return this.logger;
  }

  /**
   * Get the win rate.
   */
  public getWinRate(): number {
    return this.totalGames > 0 ? this.wins / this.totalGames : 0;
  }

  /**
   * Clean up: terminate workers, dispose model.
   */
  public async cleanup(): Promise<void> {
    await this.terminateWorkers();
    if (this.model) {
      this.model.dispose();
      this.model = null;
    }
  }

  // -------------------------------------------------------------------------
  // Worker management
  // -------------------------------------------------------------------------

  /**
   * Spawn worker threads pointing to training-worker.ts.
   *
   * Uses a .mjs shim that calls tsx's tsImport() to load the TS worker file.
   * Direct `--import tsx` with worker_threads does not resolve `.js` -> `.ts`
   * on Node 24 (known tsx/Node 24 incompatibility).
   */
  private async spawnWorkers(count: number): Promise<Worker[]> {
    const baseDir = import.meta.dirname ?? new URL('.', import.meta.url).pathname;
    const shimPath = resolve(baseDir, '_worker-shim.mjs');
    const workerTsPath = resolve(baseDir, 'training-worker.ts');

    const workers: Worker[] = [];
    const initPromises: Promise<void>[] = [];

    for (let i = 0; i < count; i++) {
      const worker = new Worker(shimPath, {
        workerData: {
          _workerTsPath: workerTsPath,
          envConfig: {
            gridWidth: this.config.gridWidth,
            gridHeight: this.config.gridHeight,
            maxTicks: this.config.maxTicks,
          },
        },
      });

      // Wait for init-done
      const initPromise = new Promise<void>((resolveInit, reject) => {
        const onMessage = (msg: { type: string; workerId: number }): void => {
          if (msg.type === 'init-done') {
            worker.removeListener('message', onMessage);
            resolveInit();
          }
        };
        worker.on('message', onMessage);
        worker.on('error', reject);

        // Send init message
        worker.postMessage({
          type: 'init',
          modelConfig: this.modelConfig,
          workerId: i,
        });
      });

      workers.push(worker);
      initPromises.push(initPromise);
    }

    await Promise.all(initPromises);
    return workers;
  }

  /**
   * Broadcast weights to all workers (D-17).
   * Clones buffers for each worker since buffers can only be transferred once.
   */
  private async broadcastWeights(weights: WeightData[]): Promise<void> {
    const setPromises = this.workers.map((worker) => {
      return new Promise<void>((resolveSet) => {
        const onMessage = (msg: { type: string }): void => {
          if (msg.type === 'weights-applied') {
            worker.removeListener('message', onMessage);
            resolveSet();
          }
        };
        worker.on('message', onMessage);

        // Clone buffers for this worker (buffer can only be transferred once)
        const clonedWeights: WeightData[] = weights.map((w) => ({
          shape: w.shape.slice(),
          buffer: w.buffer.slice(0),
        }));

        worker.postMessage({ type: 'set-weights', weights: clonedWeights });
      });
    });

    await Promise.all(setPromises);
  }

  /**
   * Collect a batch of episodes from workers.
   *
   * Uses a per-worker queue to avoid message listener races: each worker
   * has at most one active episode at a time. When a worker finishes, the
   * next episode from the queue is dispatched to it.
   */
  private async collectBatch(batchSize: number): Promise<EpisodeResult[]> {
    const pool = this.opponentPool;
    if (!pool) throw new Error('OpponentPool not initialized');

    // Pre-build all episode descriptors
    interface EpisodeDesc {
      seed: number;
      opponentType: 'random' | 'noop' | 'checkpoint';
      opponentWeights: WeightData[] | null;
      opponentName: string;
      opponentPoolType: string;
      episodeNumber: number;
    }

    const episodes: EpisodeDesc[] = [];
    for (let i = 0; i < batchSize; i++) {
      const opponent = pool.sampleOpponent();
      const seed = Date.now() + i + this.episodeCounter;
      const episodeNumber = this.episodeCounter + i + 1;

      let opponentType: 'random' | 'noop' | 'checkpoint';
      let opponentWeights: WeightData[] | null = null;

      if (opponent.strategy !== null) {
        opponentType = opponent.name === 'NoOpBot' ? 'noop' : 'random';
      } else {
        opponentType = 'checkpoint';
        opponentWeights = await pool.loadOpponentWeights(opponent);
      }

      episodes.push({
        seed,
        opponentType,
        opponentWeights,
        opponentName: opponent.name,
        opponentPoolType: opponent.type,
        episodeNumber,
      });
    }

    const results: EpisodeResult[] = [];
    let nextEpisodeIdx = 0;

    // Dispatch one episode to each worker to start
    const workerPromises = this.workers.map((worker) => {
      return this.runWorkerQueue(worker, episodes, results, () => nextEpisodeIdx++);
    });

    await Promise.all(workerPromises);
    return results;
  }

  /**
   * Run episodes on a single worker sequentially, pulling from the shared
   * episode list. Avoids message listener races by awaiting each episode
   * before sending the next.
   */
  private async runWorkerQueue(
    worker: Worker,
    episodes: Array<{
      seed: number;
      opponentType: 'random' | 'noop' | 'checkpoint';
      opponentWeights: WeightData[] | null;
      opponentName: string;
      opponentPoolType: string;
      episodeNumber: number;
    }>,
    results: EpisodeResult[],
    claimNext: () => number,
  ): Promise<void> {
    while (true) {
      const idx = claimNext();
      if (idx >= episodes.length) break;

      const ep = episodes[idx];

      const result = await new Promise<EpisodeResult>((resolveEp, reject) => {
        const onMessage = (msg: EpisodeResultMessage): void => {
          if (msg.type === 'episode-result') {
            worker.removeListener('message', onMessage);
            worker.removeListener('error', onError);

            const trajectory = this.deserializeTrajectory(msg.trajectory);
            const finalValue = msg.trajectory.values.length > msg.trajectory.actions.length
              ? msg.trajectory.values[msg.trajectory.values.length - 1]
              : 0;

            resolveEp({
              reward: msg.reward,
              ticks: msg.ticks,
              won: msg.won,
              opponentName: ep.opponentName,
              opponentType: ep.opponentPoolType,
              trajectory,
              finalValue,
            });
          }
        };

        const onError = (err: Error): void => {
          worker.removeListener('message', onMessage);
          reject(err);
        };

        worker.on('message', onMessage);
        worker.on('error', onError);

        const weightsToSend = ep.opponentWeights
          ? ep.opponentWeights.map((w) => ({
              shape: w.shape.slice(),
              buffer: w.buffer.slice(0),
            }))
          : null;

        worker.postMessage({
          type: 'collect-episode',
          seed: ep.seed,
          opponentType: ep.opponentType,
          opponentWeights: weightsToSend,
          episodeNumber: ep.episodeNumber,
        });
      });

      results.push(result);
    }
  }

  /**
   * Terminate all workers cleanly.
   */
  private async terminateWorkers(): Promise<void> {
    const termPromises = this.workers.map((worker) => {
      return new Promise<void>((resolveTerminate) => {
        worker.postMessage({ type: 'terminate' });
        worker.on('exit', () => {
          resolveTerminate();
        });
        // Safety timeout
        setTimeout(() => {
          void worker.terminate().then(() => resolveTerminate());
        }, 5000);
      });
    });

    await Promise.all(termPromises);
    this.workers = [];
  }

  // -------------------------------------------------------------------------
  // Resume support (D-11)
  // -------------------------------------------------------------------------

  /**
   * Save optimizer weights alongside a model checkpoint.
   */
  public async saveOptimizerState(dir: string): Promise<void> {
    if (!this.trainer) return;

    const optimizerWeights = await this.trainer.getOptimizerWeights() as Array<{
      name: string;
      tensor: tf.Tensor;
    }>;
    const serialized: Array<{ name: string; shape: number[]; data: number[] }> = [];

    for (const nw of optimizerWeights) {
      const data = nw.tensor.dataSync();
      serialized.push({
        name: nw.name,
        shape: nw.tensor.shape as number[],
        data: Array.from(data),
      });
    }

    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, 'optimizer-state.json'),
      JSON.stringify({
        episodeCounter: this.episodeCounter,
        wins: this.wins,
        totalGames: this.totalGames,
        optimizerWeights: serialized,
      }),
      'utf-8',
    );
  }

  /**
   * Load optimizer state from a checkpoint directory.
   */
  public async loadOptimizerState(dir: string): Promise<void> {
    if (!this.trainer) return;

    const statePath = join(dir, 'optimizer-state.json');
    const raw = await readFile(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      episodeCounter: number;
      wins: number;
      totalGames: number;
      optimizerWeights: Array<{ name: string; shape: number[]; data: number[] }>;
    };

    this.episodeCounter = parsed.episodeCounter;
    this.wins = parsed.wins;
    this.totalGames = parsed.totalGames;

    // Restore optimizer weights as {name, tensor} pairs
    const namedTensors = parsed.optimizerWeights.map((w) => ({
      name: w.name,
      tensor: _tf.tensor(w.data, w.shape),
    }));

    await this.trainer.setOptimizerWeights(namedTensors);

    // Dispose temporary tensors
    for (const nt of namedTensors) {
      nt.tensor.dispose();
    }
  }

  /**
   * Load the latest checkpoint from a previous run for resume (D-11).
   */
  private async loadResume(): Promise<void> {
    if (!this.logger || !this.model || !this.trainer) return;

    const checkpointDir = this.logger.getCheckpointDir();

    try {
      const entries = await readdir(checkpointDir);
      const checkpointDirs = entries
        .filter((e) => e.startsWith('checkpoint-'))
        .sort((a, b) => {
          const numA = parseInt(a.replace('checkpoint-', ''), 10);
          const numB = parseInt(b.replace('checkpoint-', ''), 10);
          return numB - numA; // Sort descending to get latest first
        });

      if (checkpointDirs.length === 0) return;

      const latestDir = join(checkpointDir, checkpointDirs[0]);

      // Load model weights
      const { loadWeightsFromDir } = await import('./tfjs-file-io.js');
      const weights = await loadWeightsFromDir(latestDir);
      const { applyWeights } = await import('./ppo-network.js');
      applyWeights(this.model, weights);

      // Load optimizer state
      await this.loadOptimizerState(latestDir);

      // Add checkpoints to pool
      for (const cpDir of checkpointDirs) {
        const episode = parseInt(cpDir.replace('checkpoint-', ''), 10);
        this.opponentPool?.addCheckpoint(
          join(checkpointDir, cpDir),
          episode,
        );
      }
    } catch {
      // No checkpoints to resume from -- start fresh
    }
  }

  // -------------------------------------------------------------------------
  // Trajectory deserialization
  // -------------------------------------------------------------------------

  /**
   * Convert a serialized trajectory from a worker back into TrajectoryStep[].
   */
  private deserializeTrajectory(
    serialized: SerializedTrajectory,
  ): TrajectoryStep[] {
    const steps: TrajectoryStep[] = [];
    const stepCount = serialized.actions.length;

    for (let i = 0; i < stepCount; i++) {
      steps.push({
        planes: new Float32Array(serialized.planes[i]),
        scalars: new Float32Array(serialized.scalars[i]),
        action: serialized.actions[i],
        reward: serialized.rewards[i],
        value: serialized.values[i],
        logProb: serialized.logProbs[i],
        done: serialized.dones[i],
        actionMask: new Uint8Array(serialized.actionMasks[i]),
      });
    }

    return steps;
  }
}
