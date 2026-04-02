---
phase: 25-training-tui-dashboard
plan: 02
subsystem: ui
tags: [ink, react, asciichart, tui, terminal-dashboard]

# Dependency graph
requires:
  - phase: 25-training-tui-dashboard (plan 01)
    provides: types.ts (DashboardState, TrainingProgressData), vitest tsx config, ink/react/asciichart deps
provides:
  - AsciiChart and MultiSeriesChart components for ASCII line charts
  - ProgressPanel component (left column with progress bar, reward/loss charts)
  - MetricsPanel component (right column with metrics table, opponent pool, recent log)
  - HelpOverlay component with key binding documentation
  - Dashboard root component with responsive layout and keyboard handling
  - createProgressHandler for batched state updates
affects: [25-training-tui-dashboard plan 03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      ink-testing-library render/lastFrame for component testing,
      useStdout for terminal width,
      useInput for keyboard handling,
      ref-based batched rendering,
    ]

key-files:
  created:
    - packages/bot-harness/training/tui/chart.tsx
    - packages/bot-harness/training/tui/progress-panel.tsx
    - packages/bot-harness/training/tui/metrics-panel.tsx
    - packages/bot-harness/training/tui/help-overlay.tsx
    - packages/bot-harness/training/tui/dashboard.tsx
    - packages/bot-harness/training/tui/chart.test.tsx
    - packages/bot-harness/training/tui/metrics-panel.test.tsx
    - packages/bot-harness/training/tui/dashboard.test.tsx
  modified: []

key-decisions:
  - 'useStdout().stdout.columns for terminal width detection with prop override for testing'
  - 'Ref-based batched rendering pattern: callback sets ref, setInterval flushes to React state at controlled rate'
  - 'Recent episodes ordered newest-first for MetricsPanel display'
  - 'Policy/value loss trend arrows derived from recentEpisodes array in MetricsPanel'

patterns-established:
  - 'Ink component testing: render() + lastFrame() + stdin.write() for keyboard simulation'
  - 'Responsive layout: columns prop override for deterministic test widths'
  - 'createProgressHandler factory pattern: returns callback that accumulates into DashboardState'

requirements-completed: [TUI-01, TUI-02, TUI-05, TUI-06, TUI-08, TUI-09]

# Metrics
duration: 19min
completed: 2026-04-02
---

# Phase 25 Plan 02: TUI Components Summary

**Ink TUI dashboard with ASCII charts, responsive two-column layout, metrics table with trend arrows, and keyboard-driven pause/stop/help controls**

## Performance

- **Duration:** 19 min
- **Started:** 2026-04-02T09:31:02Z
- **Completed:** 2026-04-02T09:49:36Z
- **Tasks:** 2
- **Files modified:** 8

## Accomplishments

- Built 5 Ink TUI components: AsciiChart, MultiSeriesChart, ProgressPanel, MetricsPanel, HelpOverlay, and Dashboard root
- Dashboard renders responsive two-column layout (>= 100 cols) or stacked single-column (< 100 cols)
- Keyboard handling: Space pauses, q stops, Tab cycles views, h toggles help overlay
- MetricsPanel shows colored win rate, loss trends, entropy, KL, ETA, episodes/sec, opponent pool status
- 23 component tests passing via ink-testing-library

## Task Commits

Each task was committed atomically:

1. **Task 1: Chart wrapper, progress panel, and metrics panel** - `76732be` (feat)
2. **Task 2: Dashboard root, help overlay, and keyboard handling** - `a8b2afd` (feat)

## Files Created/Modified

- `packages/bot-harness/training/tui/chart.tsx` - AsciiChart and MultiSeriesChart wrappers around asciichart.plot()
- `packages/bot-harness/training/tui/progress-panel.tsx` - Left column: progress bar, generation info, reward/loss ASCII charts
- `packages/bot-harness/training/tui/metrics-panel.tsx` - Right column: metrics table with colored trends, opponent pool, recent episode log
- `packages/bot-harness/training/tui/help-overlay.tsx` - Bordered overlay showing keyboard shortcuts
- `packages/bot-harness/training/tui/dashboard.tsx` - Root component: responsive layout, keyboard input, createProgressHandler
- `packages/bot-harness/training/tui/chart.test.tsx` - 7 tests for chart rendering and edge cases
- `packages/bot-harness/training/tui/metrics-panel.test.tsx` - 7 tests for metrics display and opponent pool
- `packages/bot-harness/training/tui/dashboard.test.tsx` - 9 tests for layout, keyboard, and help overlay

## Decisions Made

- Used `useStdout().stdout.columns` for terminal width detection with a `columns` prop override for deterministic testing
- Implemented ref-based batched rendering (D-05): progress callback writes to ref, setInterval flushes to React state at controlled rate
- Policy/value loss trend arrows derived from recentEpisodes in MetricsPanel (dashboard tracks full history arrays separately for ProgressPanel charts)
- Recent episodes stored newest-first for natural display order in MetricsPanel

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed incorrect import paths for training-logger.js**

- **Found during:** Task 2 (type checking)
- **Issue:** Import path `../../training-logger.js` was incorrect; file is at `../training-logger.js` relative to the tui/ directory
- **Fix:** Changed all imports from `../../training-logger.js` to `../training-logger.js` in dashboard.tsx, metrics-panel.tsx, and metrics-panel.test.tsx
- **Files modified:** dashboard.tsx, metrics-panel.tsx, metrics-panel.test.tsx
- **Verification:** `npx tsc --noEmit` passes with no TUI-related errors
- **Committed in:** a8b2afd (Task 2 commit)

**2. [Rule 1 - Bug] Removed unused import and fixed unnecessary type assertions**

- **Found during:** Task 2 (lint check)
- **Issue:** dashboard.tsx imported TrainingLogEntry but didn't use it; metrics-panel.tsx had unnecessary `!` non-null assertions flagged by eslint
- **Fix:** Removed unused import; removed `!` assertions after length guards
- **Files modified:** dashboard.tsx, metrics-panel.tsx
- **Verification:** `npx eslint` passes clean for all TUI files
- **Committed in:** a8b2afd (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both auto-fixes necessary for correctness and lint compliance. No scope creep.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All 5 TUI components ready for Plan 03 (coordinator integration)
- Dashboard exports `createProgressHandler` for wiring into TrainingCoordinator's onProgress callback
- Dashboard accepts `onPause`, `onStop`, `isPaused` callbacks for coordinator control flow

## Self-Check: PASSED

- All 8 created files exist on disk
- Both task commits (76732be, a8b2afd) found in git history
- 23 tests passing across 3 test files
- No type errors in TUI files
- No lint errors in TUI files

---

_Phase: 25-training-tui-dashboard_
_Completed: 2026-04-02_
