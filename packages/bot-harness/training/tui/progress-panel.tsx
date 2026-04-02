import asciichart from 'asciichart';
import { Box, Text } from 'ink';
import React from 'react';

import { AsciiChart, MultiSeriesChart } from './chart.js';
import type { TrainingProgressData } from './types.js';

/**
 * Props for the ProgressPanel component (left column, D-01).
 */
export interface ProgressPanelProps {
  /** Current training progress data, or null before first episode. */
  data: TrainingProgressData | null;
  /** Accumulated reward values for charting. */
  rewardHistory: number[];
  /** Accumulated policy loss values for charting. */
  policyLossHistory: number[];
  /** Accumulated value loss values for charting. */
  valueLossHistory: number[];
}

/**
 * Build a visual progress bar string.
 *
 * Uses Unicode block characters for a filled/empty bar.
 * Example: `[████████░░░░] 67%`
 */
function progressBar(
  completed: number,
  total: number,
  width: number = 30,
): string {
  const ratio = total > 0 ? Math.min(completed / total, 1) : 0;
  const filled = Math.round(ratio * width);
  const empty = width - filled;
  const pct = Math.round(ratio * 100);
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${String(pct)}%`;
}

/**
 * Format a duration in milliseconds to a compact human-readable string.
 */
function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${String(hours)}h${String(minutes).padStart(2, '0')}m`;
  }
  if (minutes > 0) {
    return `${String(minutes)}m${String(seconds).padStart(2, '0')}s`;
  }
  return `${String(seconds)}s`;
}

/**
 * Left-column panel showing progress bar, generation info,
 * reward trend chart, and loss chart (D-01, D-07).
 */
export function ProgressPanel({
  data,
  rewardHistory,
  policyLossHistory,
  valueLossHistory,
}: ProgressPanelProps): React.ReactElement {
  if (data == null) {
    return (
      <Box flexDirection='column' paddingRight={1}>
        <Text dimColor>Waiting for training data...</Text>
      </Box>
    );
  }

  const {
    completedEpisodes,
    totalEpisodes,
    generation,
    generationEpisodeCount,
    generationStartTime,
  } = data;

  const genElapsed = Date.now() - generationStartTime;
  const bar = progressBar(completedEpisodes, totalEpisodes);

  return (
    <Box flexDirection='column' paddingRight={1}>
      <Text bold>Progress</Text>
      <Text>
        <Text color='green'>{bar}</Text>
        <Text>
          {' '}
          {String(completedEpisodes)}/{String(totalEpisodes)} episodes
        </Text>
      </Text>

      <Text>
        Gen {String(generation)} | {String(generationEpisodeCount)}/batch |{' '}
        {formatDuration(genElapsed)}/gen
      </Text>

      <Box marginTop={1} flexDirection='column'>
        <AsciiChart data={rewardHistory} label='Reward Trend' height={8} />
      </Box>

      <Box marginTop={1} flexDirection='column'>
        <MultiSeriesChart
          series={[policyLossHistory, valueLossHistory]}
          label='Loss (blue=policy, red=value)'
          height={6}
          colors={[asciichart.blue, asciichart.red]}
        />
      </Box>
    </Box>
  );
}
