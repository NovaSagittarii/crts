export * from './training-config.js';
export {
  buildPPOModel,
  extractWeights,
  applyWeights,
  buildModelConfigFromEnv,
  initTfBackend as initPpoNetworkTf,
} from './ppo-network.js';
export type { WeightData, PPOModelConfig } from './ppo-network.js';
export {
  PPOTrainer,
  initTfBackend as initPpoTrainerTf,
} from './ppo-trainer.js';
export type { TrainStepResult, PPOUpdateResult } from './ppo-trainer.js';
export * from './trajectory-buffer.js';
export * from './opponent-pool.js';
export * from './training-logger.js';
export {
  TrainingCoordinator,
  initTfBackend as initTrainingCoordinatorTf,
} from './training-coordinator.js';
export type { EpisodeResult } from './training-coordinator.js';
export * from './tui/index.js';
