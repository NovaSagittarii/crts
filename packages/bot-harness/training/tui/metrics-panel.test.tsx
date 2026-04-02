import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';

import type { TrainingLogEntry } from '../training-logger.js';
import { MetricsPanel } from './metrics-panel.js';
import type { TrainingProgressData } from './types.js';

/**
 * Create a mock TrainingLogEntry for testing.
 */
function mockEntry(
  overrides: Partial<TrainingLogEntry> = {},
): TrainingLogEntry {
  return {
    episode: 42,
    timestamp: '2026-04-01T12:00:00Z',
    reward: 1.5,
    cumulativeReward: 63.0,
    winRate: 0.65,
    opponent: 'checkpoint-5',
    policyLoss: 0.1234,
    valueLoss: 0.5678,
    entropy: 1.2345,
    approxKl: 0.0089,
    episodeTicks: 150,
    elapsedMs: 2500,
    ...overrides,
  };
}

/**
 * Create a mock TrainingProgressData for testing.
 */
function mockProgressData(
  overrides: Partial<TrainingProgressData> = {},
): TrainingProgressData {
  return {
    entry: mockEntry(),
    generation: 3,
    totalEpisodes: 1000,
    completedEpisodes: 42,
    poolSize: 5,
    latestCheckpointEpisode: 40,
    selfPlayConfig: {
      latestRatio: 0.5,
      historicalRatio: 0.3,
      randomRatio: 0.2,
      checkpointInterval: 50,
      maxPoolSize: 30,
    },
    startTime: Date.now() - 60000,
    paused: false,
    generationStartTime: Date.now() - 5000,
    generationEpisodeCount: 10,
    ...overrides,
  };
}

describe('MetricsPanel', () => {
  it('renders win rate, entropy, KL, ETA fields (TUI-02)', () => {
    const data = mockProgressData();
    const { lastFrame } = render(
      <MetricsPanel
        data={data}
        winRateHistory={[0.5, 0.6, 0.65]}
        entropyHistory={[1.5, 1.3, 1.2345]}
        recentEpisodes={[mockEntry()]}
      />,
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('Win Rate');
    expect(frame).toContain('65.0%');
    expect(frame).toContain('Entropy');
    expect(frame).toContain('1.2345');
    expect(frame).toContain('Approx KL');
    expect(frame).toContain('0.0089');
    expect(frame).toContain('ETA');
  });

  it('renders opponent pool size and sampling ratios (D-03)', () => {
    const data = mockProgressData({
      poolSize: 8,
      latestCheckpointEpisode: 100,
    });
    const { lastFrame } = render(
      <MetricsPanel
        data={data}
        winRateHistory={[0.5]}
        entropyHistory={[1.0]}
        recentEpisodes={[]}
      />,
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('Opponent Pool');
    expect(frame).toContain('8 checkpoints');
    expect(frame).toContain('latest 50%');
    expect(frame).toContain('historical 30%');
    expect(frame).toContain('random 20%');
    expect(frame).toContain('episode 100');
  });

  it('shows "(none)" when no latest checkpoint', () => {
    const data = mockProgressData({ latestCheckpointEpisode: null });
    const { lastFrame } = render(
      <MetricsPanel
        data={data}
        winRateHistory={[]}
        entropyHistory={[]}
        recentEpisodes={[]}
      />,
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('(none)');
  });

  it('shows "Waiting..." when data is null', () => {
    const { lastFrame } = render(
      <MetricsPanel
        data={null}
        winRateHistory={[]}
        entropyHistory={[]}
        recentEpisodes={[]}
      />,
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('Waiting for training data...');
  });

  it('renders recent episode log entries', () => {
    const episodes: TrainingLogEntry[] = [
      mockEntry({ episode: 42, reward: 1.5, opponent: 'ckpt-5' }),
      mockEntry({ episode: 41, reward: -0.5, opponent: 'random' }),
    ];
    const data = mockProgressData();
    const { lastFrame } = render(
      <MetricsPanel
        data={data}
        winRateHistory={[0.5, 0.65]}
        entropyHistory={[1.5, 1.2]}
        recentEpisodes={episodes}
      />,
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('Recent Episodes');
    expect(frame).toContain('ep#42');
    expect(frame).toContain('ep#41');
  });

  it('shows trend arrows for win rate improvement', () => {
    const data = mockProgressData();
    const { lastFrame } = render(
      <MetricsPanel
        data={data}
        winRateHistory={[0.4, 0.5, 0.65]}
        entropyHistory={[1.5, 1.3, 1.2]}
        recentEpisodes={[mockEntry()]}
      />,
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    // Should contain an up-arrow for improving win rate
    expect(frame).toContain('\u2191');
  });

  it('renders episodes/sec metric', () => {
    const data = mockProgressData();
    const { lastFrame } = render(
      <MetricsPanel
        data={data}
        winRateHistory={[]}
        entropyHistory={[]}
        recentEpisodes={[]}
      />,
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('Episodes/sec');
  });
});
