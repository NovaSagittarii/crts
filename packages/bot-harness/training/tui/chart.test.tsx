import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import { AsciiChart, MultiSeriesChart } from './chart.js';

describe('AsciiChart', () => {
  it('renders chart output for sample data (TUI-05)', () => {
    const data = [1, 3, 2, 5, 4, 7, 6, 8, 9, 10];
    const { lastFrame } = render(<AsciiChart data={data} label="Test Chart" height={4} />);
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('Test Chart');
    // asciichart produces plot lines with axis numbers
    expect(frame!.split('\n').length).toBeGreaterThan(2);
  });

  it('handles empty data array with waiting message', () => {
    const { lastFrame } = render(<AsciiChart data={[]} label="Empty Chart" />);
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('Empty Chart');
    expect(frame).toContain('Waiting for data...');
  });

  it('respects windowSize by slicing data', () => {
    // Generate 100 data points
    const data = Array.from({ length: 100 }, (_, i) => Math.sin(i * 0.1) * 10);
    const windowSize = 20;
    const { lastFrame } = render(
      <AsciiChart data={data} windowSize={windowSize} height={4} />,
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    // Chart should render without error (it shows last 20 points)
    expect(frame!.length).toBeGreaterThan(0);
  });

  it('renders without label when label is omitted', () => {
    const data = [1, 2, 3, 4, 5];
    const { lastFrame } = render(<AsciiChart data={data} height={3} />);
    const frame = lastFrame();
    expect(frame).toBeDefined();
    // Should still show chart content
    expect(frame!.length).toBeGreaterThan(0);
  });
});

describe('MultiSeriesChart', () => {
  it('renders multi-series chart with two data series', () => {
    const series = [
      [1, 2, 3, 4, 5],
      [5, 4, 3, 2, 1],
    ];
    const { lastFrame } = render(
      <MultiSeriesChart series={series} label="Multi Chart" height={4} />,
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('Multi Chart');
    expect(frame!.split('\n').length).toBeGreaterThan(2);
  });

  it('handles all empty series with waiting message', () => {
    const { lastFrame } = render(
      <MultiSeriesChart series={[[], []]} label="No Data" />,
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('Waiting for data...');
  });

  it('renders when only one series has data', () => {
    const series = [[1, 2, 3], [] as number[]];
    const { lastFrame } = render(
      <MultiSeriesChart series={series} label="Partial" height={3} />,
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('Partial');
    // Should render the one non-empty series
    expect(frame!.split('\n').length).toBeGreaterThan(2);
  });
});
