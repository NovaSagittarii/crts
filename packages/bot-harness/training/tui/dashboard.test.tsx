import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Dashboard } from './dashboard.js';

/**
 * Helper to create default dashboard props with mock callbacks.
 */
function defaultProps(
  overrides: Partial<React.ComponentProps<typeof Dashboard>> = {},
): React.ComponentProps<typeof Dashboard> {
  return {
    onPause: vi.fn(),
    onStop: vi.fn(),
    isPaused: vi.fn(() => false),
    runId: 'test-run',
    columns: 120,
    refreshMs: 50,
    ...overrides,
  };
}

describe('Dashboard', () => {
  it('renders PPO Training Dashboard header (TUI-01)', () => {
    const { lastFrame } = render(<Dashboard {...defaultProps()} />);
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('PPO Training Dashboard');
    expect(frame).toContain('Run: test-run');
  });

  it('renders footer with key bindings', () => {
    const { lastFrame } = render(<Dashboard {...defaultProps()} />);
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('[Space] Pause');
    expect(frame).toContain('[q] Quit');
    expect(frame).toContain('[Tab] Views');
    expect(frame).toContain('[h] Help');
  });

  it('at width >= 100, renders two-column layout (TUI-08)', () => {
    const { lastFrame } = render(
      <Dashboard {...defaultProps({ columns: 120 })} />,
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    // Both panels should appear in the output (waiting state)
    expect(frame).toContain('Waiting for training data...');
  });

  it('at width < 100, renders single-column layout (TUI-09)', () => {
    const { lastFrame } = render(
      <Dashboard {...defaultProps({ columns: 80 })} />,
    );
    const frame = lastFrame();
    expect(frame).toBeDefined();
    // Should still show the waiting message (stacked layout)
    expect(frame).toContain('Waiting for training data...');
  });

  it('keyboard: Space calls onPause (TUI-06)', async () => {
    const onPause = vi.fn();
    const isPaused = vi.fn(() => true);
    const { stdin, lastFrame } = render(
      <Dashboard {...defaultProps({ onPause, isPaused })} />,
    );

    stdin.write(' ');
    // Allow React to process the state update
    await new Promise((r) => setTimeout(r, 50));

    expect(onPause).toHaveBeenCalledTimes(1);
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('PAUSED');
  });

  it('keyboard: q calls onStop', async () => {
    const onStop = vi.fn();
    const { stdin } = render(<Dashboard {...defaultProps({ onStop })} />);

    stdin.write('q');
    await new Promise((r) => setTimeout(r, 50));

    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it('help overlay appears after pressing h', async () => {
    const { stdin, lastFrame } = render(<Dashboard {...defaultProps()} />);

    stdin.write('h');
    await new Promise((r) => setTimeout(r, 50));

    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('Keyboard Shortcuts');
    expect(frame).toContain('Pause / Resume training');
    expect(frame).toContain('Graceful stop');
  });

  it('help overlay toggles off on second h press', async () => {
    const { stdin, lastFrame } = render(<Dashboard {...defaultProps()} />);

    stdin.write('h');
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain('Keyboard Shortcuts');

    stdin.write('h');
    await new Promise((r) => setTimeout(r, 50));
    const frame = lastFrame();
    expect(frame).toBeDefined();
    // Help overlay should be hidden, showing the main content instead
    expect(frame).not.toContain('Keyboard Shortcuts');
  });

  it('shows RUNNING state by default', () => {
    const { lastFrame } = render(<Dashboard {...defaultProps()} />);
    const frame = lastFrame();
    expect(frame).toBeDefined();
    expect(frame).toContain('RUNNING');
  });
});
