#!/usr/bin/env tsx
import {
  parseTrainingArgs,
  generateTrainingRunId,
  TrainingCoordinator,
} from '#bot-harness';

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

const config = parseTrainingArgs();

// ---------------------------------------------------------------------------
// Run ID
// ---------------------------------------------------------------------------

const runId = config.resumeRunId ?? generateTrainingRunId();

// ---------------------------------------------------------------------------
// Startup banner
// ---------------------------------------------------------------------------

console.log('');
console.log('=== PPO Training with Self-Play ===');
console.log('');
console.log(`  Run ID:         ${runId}`);
console.log(`  Episodes:       ${String(config.totalEpisodes)}`);
console.log(`  Workers:        ${config.workers === 0 ? 'auto' : String(config.workers)}`);
console.log(`  Learning Rate:  ${String(config.learningRate)}`);
console.log(`  Grid:           ${String(config.gridWidth)}x${String(config.gridHeight)}`);
console.log(`  Max Ticks:      ${String(config.maxTicks)}`);
console.log(`  Output Dir:     ${config.outputDir}`);
if (config.resumeRunId !== null) {
  console.log(`  Resuming from:  ${config.resumeRunId}`);
}
console.log('');

// ---------------------------------------------------------------------------
// Coordinator lifecycle
// ---------------------------------------------------------------------------

const coordinator = new TrainingCoordinator(config);

let shuttingDown = false;

function handleShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received -- shutting down gracefully...`);
  void coordinator.cleanup().then(() => {
    console.log('Cleanup complete.');
    process.exit(0);
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

(async () => {
  const startTime = Date.now();

  console.log('Initializing training coordinator...');
  await coordinator.init();
  console.log('Coordinator initialized. Starting training...');
  console.log('');

  await coordinator.run();

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const winRate = coordinator.getWinRate();
  const episodes = coordinator.getEpisodeCounter();

  console.log('');
  console.log('=== Training Complete ===');
  console.log('');
  console.log(`  Episodes:    ${String(episodes)}`);
  console.log(`  Win Rate:    ${(winRate * 100).toFixed(1)}%`);
  console.log(`  Duration:    ${elapsed}s`);
  console.log(`  Run Dir:     ${config.outputDir}/${coordinator.getRunId()}/`);
  console.log('');

  await coordinator.cleanup();
  process.exit(0);
})().catch((err: unknown) => {
  console.error('Training failed:', err);
  void coordinator.cleanup().then(() => {
    process.exit(1);
  });
});
