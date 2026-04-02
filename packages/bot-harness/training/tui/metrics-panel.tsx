import React from 'react';
import { Box, Text } from 'ink';

import type { TrainingLogEntry } from '../../training-logger.js';
import type { TrainingProgressData } from './types.js';

/**
 * Props for the MetricsPanel component (right column, D-01).
 */
export interface MetricsPanelProps {
  /** Current training progress data, or null before first episode. */
  data: TrainingProgressData | null;
  /** Accumulated win rate values for trend detection. */
  winRateHistory: number[];
  /** Accumulated entropy values for trend detection. */
  entropyHistory: number[];
  /** Recent episode log entries (newest first). */
  recentEpisodes: TrainingLogEntry[];
}

/**
 * Trend arrow: compare the last two values in a history array.
 *
 * For metrics where higher is better, green arrow up means improvement.
 * For loss metrics where lower is better, pass `lowerIsBetter=true`.
 */
function trendArrow(
  history: number[],
  lowerIsBetter: boolean = false,
): React.ReactElement {
  if (history.length < 2) {
    return <Text dimColor> -</Text>;
  }
  const prev = history[history.length - 2]!;
  const curr = history[history.length - 1]!;
  const diff = curr - prev;

  if (Math.abs(diff) < 1e-9) {
    return <Text dimColor> ={'\u2192'}</Text>;
  }

  const improving = lowerIsBetter ? diff < 0 : diff > 0;
  return improving
    ? <Text color="green"> {'\u2191'}</Text>
    : <Text color="red"> {'\u2193'}</Text>;
}

/**
 * Extract a metric trend from recent episodes.
 *
 * Returns a two-element array [previous, current] for trend comparison,
 * or an empty array if insufficient data.
 */
function recentTrend(
  episodes: TrainingLogEntry[],
  extractor: (e: TrainingLogEntry) => number,
): number[] {
  if (episodes.length < 2) return [];
  // recentEpisodes are ordered newest-first, so [0] is current, [1] is previous
  return [extractor(episodes[1]!), extractor(episodes[0]!)];
}

/**
 * Format a numeric value for display, rounding to a fixed precision.
 */
function fmt(value: number, decimals: number = 4): string {
  return value.toFixed(decimals);
}

/**
 * Compute estimated time remaining as a formatted string.
 */
function computeEta(
  completedEpisodes: number,
  totalEpisodes: number,
  startTime: number,
): string {
  if (completedEpisodes <= 0) return 'N/A';
  const elapsed = Date.now() - startTime;
  const msPerEpisode = elapsed / completedEpisodes;
  const remaining = totalEpisodes - completedEpisodes;
  const remainingMs = msPerEpisode * remaining;
  return formatDuration(remainingMs);
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
 * Right-column panel showing metrics table with colored trend indicators,
 * opponent pool status, and recent episode log (D-01, D-03, D-08).
 */
export function MetricsPanel({
  data,
  winRateHistory,
  entropyHistory,
  recentEpisodes,
}: MetricsPanelProps): React.ReactElement {
  if (data == null) {
    return (
      <Box flexDirection="column" paddingLeft={1}>
        <Text dimColor>Waiting for training data...</Text>
      </Box>
    );
  }

  const {
    entry,
    completedEpisodes,
    totalEpisodes,
    startTime,
    poolSize,
    selfPlayConfig,
    latestCheckpointEpisode,
    generationStartTime,
  } = data;
  const { winRate, entropy, approxKl, policyLoss, valueLoss } = entry;

  const eta = computeEta(completedEpisodes, totalEpisodes, startTime);
  const elapsed = Date.now() - startTime;
  const episodesPerSec = elapsed > 0 ? completedEpisodes / (elapsed / 1000) : 0;
  const genTime = Date.now() - generationStartTime;

  const winRateColor = winRate > 0.5 ? 'green' : 'red';

  // Derive policy/value loss trends from recent episodes
  const policyLossTrend = recentTrend(recentEpisodes, (e) => e.policyLoss);
  const valueLossTrend = recentTrend(recentEpisodes, (e) => e.valueLoss);

  return (
    <Box flexDirection="column" paddingLeft={1}>
      <Text bold>Metrics</Text>

      {/* Metrics table */}
      <Box flexDirection="column">
        <Text>
          Win Rate:     <Text color={winRateColor}>{fmt(winRate * 100, 1)}%</Text>
          {trendArrow(winRateHistory)}
        </Text>
        <Text>
          Policy Loss:  <Text>{fmt(policyLoss)}</Text>
          {trendArrow(policyLossTrend, true)}
        </Text>
        <Text>
          Value Loss:   <Text>{fmt(valueLoss)}</Text>
          {trendArrow(valueLossTrend, true)}
        </Text>
        <Text>
          Entropy:      <Text>{fmt(entropy)}</Text>
          {trendArrow(entropyHistory)}
        </Text>
        <Text>
          Approx KL:    <Text>{fmt(approxKl)}</Text>
        </Text>
        <Text>
          ETA:          <Text color="cyan">{eta}</Text>
        </Text>
        <Text>
          Time/Gen:     <Text>{formatDuration(genTime)}</Text>
        </Text>
        <Text>
          Episodes/sec: <Text>{fmt(episodesPerSec, 2)}</Text>
        </Text>
      </Box>

      {/* Opponent Pool Status (D-03) */}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Opponent Pool</Text>
        <Text>Pool Size:    {String(poolSize)} checkpoints</Text>
        <Text>
          Sampling:     latest {String(Math.round(selfPlayConfig.latestRatio * 100))}%
          {' | '}historical {String(Math.round(selfPlayConfig.historicalRatio * 100))}%
          {' | '}random {String(Math.round(selfPlayConfig.randomRatio * 100))}%
        </Text>
        <Text>
          Latest Ckpt:  {latestCheckpointEpisode != null
            ? `episode ${String(latestCheckpointEpisode)}`
            : '(none)'}
        </Text>
      </Box>

      {/* Recent Episode Log */}
      <Box marginTop={1} flexDirection="column">
        <Text bold>Recent Episodes</Text>
        {recentEpisodes.length === 0 ? (
          <Text dimColor>No episodes yet</Text>
        ) : (
          recentEpisodes.slice(0, 5).map((ep) => (
            <Text key={ep.episode}>
              ep#{String(ep.episode)} reward={fmt(ep.reward, 2)} vs {ep.opponent}{' '}
              <Text color={ep.reward > 0 ? 'green' : 'yellow'}>
                {ep.reward > 0 ? 'W' : 'L'}
              </Text>
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}
