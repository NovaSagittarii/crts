import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { attachPlainLogger } from './plain-logger.js';
import type { TrainingProgressData, TrainingProgressCallback } from './types.js';
import type { TrainingLogEntry } from '../training-logger.js';

// ---------------------------------------------------------------------------
// Minimal mock types matching the coordinator surface used by plain-logger
// ---------------------------------------------------------------------------

interface MockCoordinator {
  onProgress: TrainingProgressCallback | null;
  getLogger: () => { formatLiveMetrics: (entry: TrainingLogEntry, total: number, start: number) => string } | null;
}

function createMockEntry(overrides: Partial<TrainingLogEntry> = {}): TrainingLogEntry {
  return {
    episode: 1,
    timestamp: '2026-04-01T00:00:00Z',
    reward: 0.5,
    cumulativeReward: 0.5,
    winRate: 0.6,
    opponent: 'RandomBot',
    policyLoss: 0.1,
    valueLoss: 0.2,
    entropy: 0.3,
    approxKl: 0.01,
    episodeTicks: 100,
    elapsedMs: 5000,
    ...overrides,
  };
}

function createMockProgressData(overrides: Partial<TrainingProgressData> = {}): TrainingProgressData {
  return {
    entry: createMockEntry(),
    generation: 0,
    totalEpisodes: 100,
    completedEpisodes: 1,
    poolSize: 1,
    latestCheckpointEpisode: null,
    selfPlayConfig: {
      latestRatio: 0.5,
      historicalRatio: 0.3,
      randomRatio: 0.2,
      checkpointInterval: 50,
      maxPoolSize: 30,
    },
    startTime: Date.now() - 5000,
    paused: false,
    generationStartTime: Date.now() - 1000,
    generationEpisodeCount: 4,
    ...overrides,
  };
}

describe('attachPlainLogger', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn<typeof console, 'log'>>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('sets the onProgress callback on the coordinator', () => {
    const coordinator: MockCoordinator = {
      onProgress: null,
      getLogger: () => ({
        formatLiveMetrics: () => 'metrics line',
      }),
    };

    // Cast is safe: we only use the onProgress and getLogger surface
    attachPlainLogger(coordinator as never, 100);

    expect(coordinator.onProgress).not.toBeNull();
    expect(typeof coordinator.onProgress).toBe('function');
  });

  it('calls formatLiveMetrics and writes to console.log when callback fires', () => {
    const formatSpy = vi.fn().mockReturnValue('[Episode 1/100] reward=0.5 winRate=0.6');

    const coordinator: MockCoordinator = {
      onProgress: null,
      getLogger: () => ({
        formatLiveMetrics: formatSpy,
      }),
    };

    attachPlainLogger(coordinator as never, 100);

    const data = createMockProgressData();
    coordinator.onProgress!(data);

    expect(formatSpy).toHaveBeenCalledOnce();
    expect(formatSpy).toHaveBeenCalledWith(data.entry, 100, data.startTime);
    expect(consoleSpy).toHaveBeenCalledWith('[Episode 1/100] reward=0.5 winRate=0.6');
  });

  it('does nothing if getLogger returns null', () => {
    const coordinator: MockCoordinator = {
      onProgress: null,
      getLogger: () => null,
    };

    attachPlainLogger(coordinator as never, 100);

    const data = createMockProgressData();
    coordinator.onProgress!(data);

    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('passes the correct totalEpisodes value to formatLiveMetrics', () => {
    const formatSpy = vi.fn().mockReturnValue('line');

    const coordinator: MockCoordinator = {
      onProgress: null,
      getLogger: () => ({
        formatLiveMetrics: formatSpy,
      }),
    };

    attachPlainLogger(coordinator as never, 500);

    const data = createMockProgressData({ totalEpisodes: 500 });
    coordinator.onProgress!(data);

    expect(formatSpy).toHaveBeenCalledWith(data.entry, 500, data.startTime);
  });
});
