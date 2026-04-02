import type { TrainingCoordinator } from '../training-coordinator.js';

/**
 * Attach a plain-text progress logger to the coordinator (D-06 non-TTY fallback).
 *
 * Sets `coordinator.onProgress` to a callback that formats each episode's
 * metrics via the coordinator's logger and writes the result to stdout.
 * This is the fallback rendering path for non-TTY environments or when
 * `--no-tui` is specified.
 */
export function attachPlainLogger(
  coordinator: TrainingCoordinator,
  totalEpisodes: number,
): void {
  coordinator.onProgress = (data): void => {
    const logger = coordinator.getLogger();
    if (logger == null) return;

    const line = logger.formatLiveMetrics(data.entry, totalEpisodes, data.startTime);
    console.log(line);
  };
}
