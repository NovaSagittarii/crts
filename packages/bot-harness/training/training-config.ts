import { parseArgs } from 'node:util';

import {
  DEFAULT_GRID_HEIGHT,
  DEFAULT_GRID_WIDTH,
  DEFAULT_MAX_TICKS,
} from '../types.js';

/**
 * CNN + MLP network architecture configuration (D-01, D-02, D-03).
 */
export interface NetworkConfig {
  /** Number of filters per conv2d layer */
  convFilters: number[];
  /** Kernel size for all conv2d layers */
  convKernelSize: number;
  /** Units per dense layer in the shared MLP trunk */
  mlpUnits: number[];
  /** Activation function for conv and dense layers */
  activation: string;
}

/**
 * Self-play opponent pool configuration (D-05, D-06, D-07).
 */
export interface SelfPlayConfig {
  /** Fraction of episodes against the latest checkpoint */
  latestRatio: number;
  /** Fraction of episodes against a random historical checkpoint */
  historicalRatio: number;
  /** Fraction of episodes against a pure random bot */
  randomRatio: number;
  /** Save a new checkpoint to the pool every N episodes */
  checkpointInterval: number;
  /** Maximum number of checkpoints in the pool (FIFO eviction) */
  maxPoolSize: number;
}

/**
 * Full PPO training configuration (D-09, D-10, D-11, D-15, D-16).
 */
export interface TrainingConfig {
  // PPO hyperparameters
  totalEpisodes: number;
  learningRate: number;
  clipEpsilon: number;
  gamma: number;
  gaeLambda: number;
  ppoEpochs: number;
  miniBatchSize: number;
  entropyCoeff: number;
  valueLossCoeff: number;
  maxGradNorm: number;
  targetKl: number;

  // Parallelism
  /** Number of worker threads (0 = auto-detect) */
  workers: number;
  /** Episodes collected per batch (0 = workers * 4) */
  batchEpisodes: number;

  // I/O
  /** Output directory root for run artifacts */
  outputDir: string;
  /** Run ID to resume from (null = new run) */
  resumeRunId: string | null;

  // Sub-configs
  network: NetworkConfig;
  selfPlay: SelfPlayConfig;

  // Grid / environment
  gridWidth: number;
  gridHeight: number;
  maxTicks: number;

  // Display
  /** Disable TUI dashboard, use plain log output. */
  noTui: boolean;
}

export const DEFAULT_NETWORK_CONFIG: NetworkConfig = {
  convFilters: [32, 64, 64],
  convKernelSize: 3,
  mlpUnits: [256, 128],
  activation: 'relu',
};

export const DEFAULT_SELF_PLAY_CONFIG: SelfPlayConfig = {
  latestRatio: 0.5,
  historicalRatio: 0.3,
  randomRatio: 0.2,
  checkpointInterval: 50,
  maxPoolSize: 30,
};

export const DEFAULT_TRAINING_CONFIG: TrainingConfig = {
  totalEpisodes: 1000,
  learningRate: 3e-4,
  clipEpsilon: 0.2,
  gamma: 0.99,
  gaeLambda: 0.95,
  ppoEpochs: 4,
  miniBatchSize: 64,
  entropyCoeff: 0.01,
  valueLossCoeff: 0.5,
  maxGradNorm: 0.5,
  targetKl: 0.015,
  workers: 0,
  batchEpisodes: 0,
  outputDir: 'runs',
  resumeRunId: null,
  network: { ...DEFAULT_NETWORK_CONFIG },
  selfPlay: { ...DEFAULT_SELF_PLAY_CONFIG },
  gridWidth: DEFAULT_GRID_WIDTH,
  gridHeight: DEFAULT_GRID_HEIGHT,
  maxTicks: DEFAULT_MAX_TICKS,
  noTui: false,
};

/**
 * Generate a timestamp-based run ID matching the `run-YYYYMMDD-HHMMSS` pattern.
 */
export function generateTrainingRunId(): string {
  const now = new Date();
  const y = String(now.getFullYear());
  const mo = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const h = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  return `run-${y}${mo}${d}-${h}${mi}${s}`;
}

/**
 * Parse CLI flags into a TrainingConfig, merging with defaults.
 *
 * Follows the same `node:util parseArgs` pattern as `bin/run-matches.ts`.
 */
export function parseTrainingArgs(argv?: string[]): TrainingConfig {
  const { values } = parseArgs({
    args: argv,
    options: {
      episodes: { type: 'string' },
      lr: { type: 'string' },
      'clip-epsilon': { type: 'string' },
      gamma: { type: 'string' },
      'gae-lambda': { type: 'string' },
      'ppo-epochs': { type: 'string' },
      'mini-batch-size': { type: 'string' },
      'entropy-coeff': { type: 'string' },
      'value-loss-coeff': { type: 'string' },
      'max-grad-norm': { type: 'string' },
      'target-kl': { type: 'string' },
      workers: { type: 'string' },
      'batch-episodes': { type: 'string' },
      'output-dir': { type: 'string' },
      resume: { type: 'string' },
      'conv-filters': { type: 'string' },
      'mlp-units': { type: 'string' },
      'latest-ratio': { type: 'string' },
      'historical-ratio': { type: 'string' },
      'random-ratio': { type: 'string' },
      'checkpoint-interval': { type: 'string' },
      'max-pool-size': { type: 'string' },
      'grid-width': { type: 'string' },
      'grid-height': { type: 'string' },
      'max-ticks': { type: 'string' },
      'no-tui': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const config: TrainingConfig = {
    ...DEFAULT_TRAINING_CONFIG,
    network: { ...DEFAULT_NETWORK_CONFIG },
    selfPlay: { ...DEFAULT_SELF_PLAY_CONFIG },
  };

  // PPO hyperparameters
  if (values.episodes !== undefined)
    config.totalEpisodes = parseInt(values.episodes, 10);
  if (values.lr !== undefined) config.learningRate = parseFloat(values.lr);
  if (values['clip-epsilon'] !== undefined)
    config.clipEpsilon = parseFloat(values['clip-epsilon']);
  if (values.gamma !== undefined) config.gamma = parseFloat(values.gamma);
  if (values['gae-lambda'] !== undefined)
    config.gaeLambda = parseFloat(values['gae-lambda']);
  if (values['ppo-epochs'] !== undefined)
    config.ppoEpochs = parseInt(values['ppo-epochs'], 10);
  if (values['mini-batch-size'] !== undefined)
    config.miniBatchSize = parseInt(values['mini-batch-size'], 10);
  if (values['entropy-coeff'] !== undefined)
    config.entropyCoeff = parseFloat(values['entropy-coeff']);
  if (values['value-loss-coeff'] !== undefined)
    config.valueLossCoeff = parseFloat(values['value-loss-coeff']);
  if (values['max-grad-norm'] !== undefined)
    config.maxGradNorm = parseFloat(values['max-grad-norm']);
  if (values['target-kl'] !== undefined)
    config.targetKl = parseFloat(values['target-kl']);

  // Parallelism
  if (values.workers !== undefined)
    config.workers = parseInt(values.workers, 10);
  if (values['batch-episodes'] !== undefined)
    config.batchEpisodes = parseInt(values['batch-episodes'], 10);

  // I/O
  if (values['output-dir'] !== undefined)
    config.outputDir = values['output-dir'];
  if (values.resume !== undefined) config.resumeRunId = values.resume;

  // Network config
  if (values['conv-filters'] !== undefined) {
    config.network.convFilters = values['conv-filters']
      .split(',')
      .map((s) => parseInt(s.trim(), 10));
  }
  if (values['mlp-units'] !== undefined) {
    config.network.mlpUnits = values['mlp-units']
      .split(',')
      .map((s) => parseInt(s.trim(), 10));
  }

  // Self-play config
  if (values['latest-ratio'] !== undefined)
    config.selfPlay.latestRatio = parseFloat(values['latest-ratio']);
  if (values['historical-ratio'] !== undefined)
    config.selfPlay.historicalRatio = parseFloat(values['historical-ratio']);
  if (values['random-ratio'] !== undefined)
    config.selfPlay.randomRatio = parseFloat(values['random-ratio']);
  if (values['checkpoint-interval'] !== undefined)
    config.selfPlay.checkpointInterval = parseInt(
      values['checkpoint-interval'],
      10,
    );
  if (values['max-pool-size'] !== undefined)
    config.selfPlay.maxPoolSize = parseInt(values['max-pool-size'], 10);

  // Grid / environment
  if (values['grid-width'] !== undefined)
    config.gridWidth = parseInt(values['grid-width'], 10);
  if (values['grid-height'] !== undefined)
    config.gridHeight = parseInt(values['grid-height'], 10);
  if (values['max-ticks'] !== undefined)
    config.maxTicks = parseInt(values['max-ticks'], 10);

  // Display
  if (values['no-tui'] !== undefined) config.noTui = values['no-tui'];

  return config;
}

function printHelp(): void {
  console.log(`Usage: tsx bin/train.ts [options]

PPO Hyperparameters:
  --episodes <n>          Total training episodes (default: 1000)
  --lr <f>                Learning rate (default: 3e-4)
  --clip-epsilon <f>      PPO clip epsilon (default: 0.2)
  --gamma <f>             Discount factor (default: 0.99)
  --gae-lambda <f>        GAE lambda (default: 0.95)
  --ppo-epochs <n>        PPO update epochs per batch (default: 4)
  --mini-batch-size <n>   Mini-batch size for PPO updates (default: 64)
  --entropy-coeff <f>     Entropy bonus coefficient (default: 0.01)
  --value-loss-coeff <f>  Value loss coefficient (default: 0.5)
  --max-grad-norm <f>     Max gradient norm for clipping (default: 0.5)
  --target-kl <f>         Target KL for early stopping (default: 0.015)

Parallelism:
  --workers <n>           Worker threads (0 = auto-detect, default: 0)
  --batch-episodes <n>    Episodes per collection batch (0 = workers*4, default: 0)

I/O:
  --output-dir <d>        Output directory root (default: runs)
  --resume <id>           Resume from run ID

Network Architecture:
  --conv-filters <list>   Comma-separated conv filter counts (default: 32,64,64)
  --mlp-units <list>      Comma-separated MLP layer sizes (default: 256,128)

Self-Play:
  --latest-ratio <f>      Opponent sampling: latest checkpoint ratio (default: 0.5)
  --historical-ratio <f>  Opponent sampling: historical ratio (default: 0.3)
  --random-ratio <f>      Opponent sampling: random bot ratio (default: 0.2)
  --checkpoint-interval <n>  Episodes between pool checkpoints (default: 50)
  --max-pool-size <n>     Max checkpoints in pool (default: 30)

Environment:
  --grid-width <n>        Grid width (default: ${String(DEFAULT_GRID_WIDTH)})
  --grid-height <n>       Grid height (default: ${String(DEFAULT_GRID_HEIGHT)})
  --max-ticks <n>         Max ticks per episode (default: ${String(DEFAULT_MAX_TICKS)})

Display:
  --no-tui                Disable TUI dashboard, use plain log output

  --help, -h              Show this help message`);
}
