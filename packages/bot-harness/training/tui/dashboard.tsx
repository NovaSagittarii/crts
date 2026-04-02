import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Box, Text, useInput, useApp, useStdin, useStdout } from 'ink';

import type {
  DashboardState,
  TrainingProgressCallback,
  TrainingProgressData,
} from './types.js';
import { ProgressPanel } from './progress-panel.js';
import { MetricsPanel } from './metrics-panel.js';
import { HelpOverlay } from './help-overlay.js';

/**
 * Number of detail views available for Tab cycling.
 */
const VIEW_COUNT = 2;

/**
 * Maximum number of recent episodes to keep in state.
 */
const MAX_RECENT_EPISODES = 5;

/**
 * Default refresh interval in milliseconds (D-05 dual refresh).
 */
const DEFAULT_REFRESH_MS = 500;

/**
 * Column threshold for two-column layout (D-02).
 */
const TWO_COLUMN_MIN_WIDTH = 100;

/**
 * Props for the Dashboard component.
 */
export interface DashboardProps {
  /** Callback invoked when user presses Space to pause/resume. */
  onPause: () => void;
  /** Callback invoked when user presses 'q' to gracefully stop. */
  onStop: () => void;
  /** Function that returns current pause state. */
  isPaused: () => boolean;
  /** Optional run identifier for the header. */
  runId?: string;
  /** Override terminal columns (for testing). */
  columns?: number;
  /** Override refresh interval in ms (for testing). */
  refreshMs?: number;
  /**
   * Called once when the Dashboard mounts with the progress handler callback.
   * The caller should wire this to `coordinator.onProgress` to feed training
   * data into the dashboard.
   */
  onReady?: (handler: TrainingProgressCallback) => void;
}

/**
 * Create initial empty dashboard state.
 */
function createInitialState(): DashboardState {
  return {
    currentData: null,
    rewardHistory: [],
    policyLossHistory: [],
    valueLossHistory: [],
    winRateHistory: [],
    entropyHistory: [],
    recentEpisodes: [],
    showHelp: false,
    activeView: 0,
  };
}

/**
 * Create a TrainingProgressCallback that accumulates data into
 * dashboard state via a ref for batched rendering (D-05).
 *
 * The callback stores data in a ref (fast, no re-render). A setInterval
 * periodically flushes the ref to React state for controlled re-renders.
 */
export function createProgressHandler(
  setState: React.Dispatch<React.SetStateAction<DashboardState>>,
): TrainingProgressCallback {
  return (data: TrainingProgressData): void => {
    setState((prev) => {
      const recentEpisodes = [data.entry, ...prev.recentEpisodes].slice(
        0,
        MAX_RECENT_EPISODES,
      );

      return {
        ...prev,
        currentData: data,
        rewardHistory: [...prev.rewardHistory, data.entry.reward],
        policyLossHistory: [...prev.policyLossHistory, data.entry.policyLoss],
        valueLossHistory: [...prev.valueLossHistory, data.entry.valueLoss],
        winRateHistory: [...prev.winRateHistory, data.entry.winRate],
        entropyHistory: [...prev.entropyHistory, data.entry.entropy],
        recentEpisodes,
      };
    });
  };
}

/**
 * Root Dashboard component with keyboard handling and responsive layout.
 *
 * Renders a two-column layout at terminal width >= 100 columns (D-02),
 * falling back to a single-column stacked layout at narrower widths.
 *
 * Keyboard bindings (D-10, D-11):
 * - Space: pause/resume training
 * - q: graceful stop
 * - Tab: cycle detail views
 * - h: toggle help overlay
 */
export function Dashboard({
  onPause,
  onStop,
  isPaused,
  runId = 'default',
  columns: columnsProp,
  refreshMs = DEFAULT_REFRESH_MS,
  onReady,
}: DashboardProps): React.ReactElement {
  const [state, setState] = useState<DashboardState>(createInitialState);
  const [paused, setPaused] = useState(false);
  const app = useApp();
  const { isRawModeSupported } = useStdin();
  const { stdout } = useStdout();

  // Ref for batched data updates (D-05 dual refresh)
  const pendingDataRef = useRef<TrainingProgressData | null>(null);
  const handlerRef = useRef<TrainingProgressCallback | null>(null);

  // Create the progress handler once and expose it via ref
  if (handlerRef.current == null) {
    const directHandler = createProgressHandler(setState);
    // Wrap with ref-based batching for controlled re-render rate
    handlerRef.current = (data: TrainingProgressData): void => {
      pendingDataRef.current = data;
    };
    // Also store the direct handler for interval flushing
    (handlerRef as React.MutableRefObject<TrainingProgressCallback & { _direct?: TrainingProgressCallback }>).current._direct = directHandler;
  }

  // Notify the caller that the progress handler is ready (for wiring to coordinator)
  useEffect(() => {
    if (onReady != null && handlerRef.current != null) {
      onReady(handlerRef.current);
    }
  }, [onReady]);

  // Set up interval-based flush of pending data (D-05)
  useEffect(() => {
    const interval = setInterval(() => {
      const pending = pendingDataRef.current;
      if (pending != null) {
        pendingDataRef.current = null;
        const directHandler = (handlerRef.current as unknown as { _direct?: TrainingProgressCallback })?._direct;
        if (directHandler != null) {
          directHandler(pending);
        }
      }
    }, refreshMs);

    return (): void => {
      clearInterval(interval);
    };
  }, [refreshMs]);

  // Keyboard input handling (D-10, D-11)
  const handleInput = useCallback(
    (input: string, key: { tab?: boolean }) => {
      if (input === ' ') {
        onPause();
        setPaused(isPaused());
      } else if (input === 'q') {
        onStop();
        app.exit();
      } else if (input === 'h') {
        setState((prev) => ({ ...prev, showHelp: !prev.showHelp }));
      } else if (key.tab) {
        setState((prev) => ({
          ...prev,
          activeView: (prev.activeView + 1) % VIEW_COUNT,
        }));
      }
    },
    [onPause, onStop, isPaused, app],
  );

  useInput(handleInput, { isActive: isRawModeSupported });

  // Determine terminal width for responsive layout (D-02)
  const termColumns = columnsProp ?? stdout.columns ?? 80;
  const isTwoColumn = termColumns >= TWO_COLUMN_MIN_WIDTH;

  const pauseLabel = paused ? 'PAUSED' : 'RUNNING';
  const pauseColor = paused ? 'yellow' : 'green';

  const content = isTwoColumn ? (
    <Box flexDirection="row">
      <Box flexDirection="column" width="50%">
        <ProgressPanel
          data={state.currentData}
          rewardHistory={state.rewardHistory}
          policyLossHistory={state.policyLossHistory}
          valueLossHistory={state.valueLossHistory}
        />
      </Box>
      <Box flexDirection="column" width="50%">
        <MetricsPanel
          data={state.currentData}
          winRateHistory={state.winRateHistory}
          entropyHistory={state.entropyHistory}
          recentEpisodes={state.recentEpisodes}
        />
      </Box>
    </Box>
  ) : (
    <Box flexDirection="column">
      <ProgressPanel
        data={state.currentData}
        rewardHistory={state.rewardHistory}
        policyLossHistory={state.policyLossHistory}
        valueLossHistory={state.valueLossHistory}
      />
      <MetricsPanel
        data={state.currentData}
        winRateHistory={state.winRateHistory}
        entropyHistory={state.entropyHistory}
        recentEpisodes={state.recentEpisodes}
      />
    </Box>
  );

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Text bold>
        PPO Training Dashboard  |  Run: {runId}  |{' '}
        <Text color={pauseColor}>{pauseLabel}</Text>
      </Text>

      {/* Main content or help overlay */}
      {state.showHelp ? <HelpOverlay /> : content}

      {/* Footer */}
      <Text dimColor>
        [Space] Pause  [q] Quit  [Tab] Views  [h] Help
      </Text>
    </Box>
  );
}
