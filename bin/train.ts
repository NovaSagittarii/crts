#!/usr/bin/env tsx
import {
  TrainingCoordinator,
  attachPlainLogger,
  parseTrainingArgs,
} from '#bot-harness';

// ---------------------------------------------------------------------------
// Parse CLI arguments
// ---------------------------------------------------------------------------

const config = parseTrainingArgs();

// ---------------------------------------------------------------------------
// Coordinator lifecycle
// ---------------------------------------------------------------------------

const coordinator = new TrainingCoordinator(config);

let shuttingDown = false;
let inkInstance: {
  unmount: () => void;
  waitUntilExit: () => Promise<unknown>;
} | null = null;

function handleShutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n${signal} received -- shutting down gracefully...`);
  coordinator.requestStop();

  if (inkInstance != null) {
    inkInstance.unmount();
    inkInstance = null;
  }

  void coordinator.cleanup().then(() => {
    console.log('Cleanup complete.');
    process.exit(0);
  });
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

(async () => {
  const startTime = Date.now();

  // -------------------------------------------------------------------------
  // Initialization
  // -------------------------------------------------------------------------

  console.log('Initializing training coordinator...');
  await coordinator.init();
  console.log('Coordinator initialized.');

  // -------------------------------------------------------------------------
  // Determine rendering mode: TUI vs plain
  // -------------------------------------------------------------------------

  const useTui = process.stdout.isTTY === true && !config.noTui;

  if (useTui) {
    // ----- TUI mode (Ink dashboard) -----
    const { render } = await import('ink');
    const React = await import('react');
    const { Dashboard } = await import('#bot-harness');

    const app = render(
      React.createElement(Dashboard, {
        onPause: () => coordinator.togglePause(),
        onStop: () => coordinator.requestStop(),
        isPaused: () => coordinator.isPaused(),
        runId: coordinator.getRunId(),
        onReady: (handler) => {
          coordinator.onProgress = handler;
        },
      }),
      { patchConsole: true, exitOnCtrlC: false },
    );
    inkInstance = app;

    await coordinator.run();

    // Clean up Ink after training completes
    if (inkInstance != null) {
      inkInstance.unmount();
      inkInstance = null;
    }
  } else {
    // ----- Plain mode (log lines) -----
    console.log('');
    console.log('=== PPO Training with Self-Play ===');
    console.log('');
    console.log(`  Run ID:         ${coordinator.getRunId()}`);
    console.log(`  Episodes:       ${String(config.totalEpisodes)}`);
    console.log(
      `  Workers:        ${config.workers === 0 ? 'auto' : String(config.workers)}`,
    );
    console.log(`  Learning Rate:  ${String(config.learningRate)}`);
    console.log(
      `  Grid:           ${String(config.gridWidth)}x${String(config.gridHeight)}`,
    );
    console.log(`  Max Ticks:      ${String(config.maxTicks)}`);
    console.log(`  Output Dir:     ${config.outputDir}`);
    if (config.resumeRunId !== null) {
      console.log(`  Resuming from:  ${config.resumeRunId}`);
    }
    console.log('');

    attachPlainLogger(coordinator, config.totalEpisodes);

    console.log('Starting training...');
    console.log('');

    await coordinator.run();
  }

  // -------------------------------------------------------------------------
  // Completion summary
  // -------------------------------------------------------------------------

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

  if (inkInstance != null) {
    inkInstance.unmount();
    inkInstance = null;
  }

  void coordinator.cleanup().then(() => {
    process.exit(1);
  });
});
