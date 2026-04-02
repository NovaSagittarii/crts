import type { SelfPlayConfig } from '../training-config.js';
import type { TrainingLogEntry } from '../training-logger.js';

/**
 * Progress data emitted by TrainingCoordinator after each episode.
 *
 * Contains the current episode metrics, generation info, and overall
 * training state for the TUI dashboard to render.
 */
export interface TrainingProgressData {
  /** The log entry for the most recent episode. */
  entry: TrainingLogEntry;
  /** Batch/generation number (increments per PPO update). */
  generation: number;
  /** Total episodes configured for this training run. */
  totalEpisodes: number;
  /** Number of episodes completed so far. */
  completedEpisodes: number;
  /** Number of historical checkpoints in the opponent pool. */
  poolSize: number;
  /** Episode number of the latest checkpoint, or null if none. */
  latestCheckpointEpisode: number | null;
  /** Current self-play configuration. */
  selfPlayConfig: SelfPlayConfig;
  /** Date.now() at training start. */
  startTime: number;
  /** Whether training is currently paused. */
  paused: boolean;
  /** Date.now() at start of current generation. */
  generationStartTime: number;
  /** Number of episodes in the current generation/batch. */
  generationEpisodeCount: number;
}

/**
 * Callback signature for receiving training progress updates.
 */
export type TrainingProgressCallback = (data: TrainingProgressData) => void;

/**
 * State model for the TUI dashboard rendering.
 *
 * Accumulates metric histories and manages view state for the
 * terminal dashboard components.
 */
export interface DashboardState {
  /** Most recent progress data, or null before first episode. */
  currentData: TrainingProgressData | null;
  /** Reward values over time for charting. */
  rewardHistory: number[];
  /** Policy loss values over time for charting. */
  policyLossHistory: number[];
  /** Value loss values over time for charting. */
  valueLossHistory: number[];
  /** Win rate values over time for charting. */
  winRateHistory: number[];
  /** Entropy values over time for charting. */
  entropyHistory: number[];
  /** Recent episode log entries for the detail table. */
  recentEpisodes: TrainingLogEntry[];
  /** Whether the help overlay is visible. */
  showHelp: boolean;
  /** Index of the current detail view (for Tab cycling). */
  activeView: number;
}
