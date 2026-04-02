import React from 'react';
import { Box, Text } from 'ink';
import asciichart from 'asciichart';

/**
 * Props for the AsciiChart component.
 */
export interface AsciiChartProps {
  /** Data points to plot. */
  data: number[];
  /** Chart height in rows (default 8). */
  height?: number;
  /** Label displayed above the chart. */
  label?: string;
  /** Number of most-recent points to display (default 50 per D-09). */
  windowSize?: number;
}

/**
 * Single-series ASCII line chart using asciichart.
 *
 * Renders an ASCII chart from the given data, slicing to the last
 * `windowSize` data points. Shows a waiting message when data is empty.
 */
export function AsciiChart({
  data,
  height = 8,
  label,
  windowSize = 50,
}: AsciiChartProps): React.ReactElement {
  if (data.length === 0) {
    return (
      <Box flexDirection="column">
        {label != null && <Text bold>{label}</Text>}
        <Text dimColor>Waiting for data...</Text>
      </Box>
    );
  }

  const sliced = data.slice(-windowSize);
  const chartString = asciichart.plot(sliced, { height });

  return (
    <Box flexDirection="column">
      {label != null && <Text bold>{label}</Text>}
      <Text>{chartString}</Text>
    </Box>
  );
}

/**
 * Props for the MultiSeriesChart component.
 */
export interface MultiSeriesChartProps {
  /** Array of data series to plot together. */
  series: number[][];
  /** ANSI color codes for each series (from asciichart.blue, etc.). */
  colors?: asciichart.Color[];
  /** Chart height in rows (default 6). */
  height?: number;
  /** Label displayed above the chart. */
  label?: string;
  /** Number of most-recent points to display (default 50). */
  windowSize?: number;
}

/**
 * Multi-series ASCII line chart using asciichart.
 *
 * Renders overlaid series with distinct colors. Shows a waiting
 * message when all series are empty.
 */
export function MultiSeriesChart({
  series,
  colors,
  height = 6,
  label,
  windowSize = 50,
}: MultiSeriesChartProps): React.ReactElement {
  const nonEmpty = series.filter((s) => s.length > 0);

  if (nonEmpty.length === 0) {
    return (
      <Box flexDirection="column">
        {label != null && <Text bold>{label}</Text>}
        <Text dimColor>Waiting for data...</Text>
      </Box>
    );
  }

  const sliced = nonEmpty.map((s) => s.slice(-windowSize));
  const cfg: asciichart.PlotConfig = { height };
  if (colors != null && colors.length > 0) {
    cfg.colors = colors;
  }
  const chartString = asciichart.plot(sliced, cfg);

  return (
    <Box flexDirection="column">
      {label != null && <Text bold>{label}</Text>}
      <Text>{chartString}</Text>
    </Box>
  );
}
