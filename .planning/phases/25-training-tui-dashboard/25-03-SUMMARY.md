---
phase: 25-training-tui-dashboard
plan: 03
subsystem: training
tags: [ink, react, tui, cli, plain-logger, barrel-exports]

# Dependency graph
requires:
  - phase: 25-01
    provides: coordinator onProgress/togglePause/requestStop, TUI type contracts, --no-tui flag
  - phase: 25-02
    provides: Dashboard component, createProgressHandler, ProgressPanel, MetricsPanel, HelpOverlay, Chart
provides:
  - Plain-text non-TTY fallback logger using formatLiveMetrics
  - TUI barrel exports accessible from #bot-harness
  - bin/train.ts conditional TUI/plain rendering via isTTY and --no-tui
  - Dashboard onReady prop for coordinator-to-dashboard progress handler wiring
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "onReady callback prop pattern for exposing internal React handler refs to external callers"
    - "Dynamic import for Ink/React in CLI to keep plain mode dependency-free"
    - "TTY detection gate (process.stdout.isTTY && !config.noTui) for rendering mode selection"

key-files:
  created:
    - packages/bot-harness/training/tui/plain-logger.ts
    - packages/bot-harness/training/tui/plain-logger.test.ts
    - packages/bot-harness/training/tui/index.ts
  modified:
    - packages/bot-harness/training/index.ts
    - packages/bot-harness/training/tui/dashboard.tsx
    - bin/train.ts

key-decisions:
  - "onReady prop added to Dashboard to bridge coordinator.onProgress to internal React handler ref without coupling"
  - "Dynamic import for ink/react in TUI mode to keep plain mode lightweight and avoid loading React when not needed"

patterns-established:
  - "onReady callback: expose React component internal handlers to imperative callers"
  - "Rendering mode gate: isTTY + noTui config for CLI output strategy selection"

requirements-completed: [TUI-03, TUI-04]

# Metrics
duration: 30min
completed: 2026-04-02
---

# Phase 25 Plan 03: TUI/Plain Mode Wiring Summary

**Plain-logger fallback, TUI barrel exports, and bin/train.ts conditional rendering gate for Ink dashboard vs formatLiveMetrics log lines**

## Performance

- **Duration:** 30 min
- **Started:** 2026-04-02T09:53:58Z
- **Completed:** 2026-04-02T10:24:00Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Created attachPlainLogger for non-TTY fallback using existing formatLiveMetrics
- Created TUI barrel exports making Dashboard, createProgressHandler, attachPlainLogger, HelpOverlay available from #bot-harness
- Rewrote bin/train.ts with TTY/noTui gate: TUI mode renders Ink Dashboard with onReady wiring, plain mode prints startup banner and uses attachPlainLogger
- All 27 TUI tests passing (4 test files)

## Task Commits

Each task was committed atomically:

1. **Task 1: Plain logger, barrel exports, and bin/train.ts wiring** - `7b39755` (feat)
2. **Task 2: Verify TUI dashboard renders correctly** - auto-approved (checkpoint:human-verify, all 27 tests pass)

## Files Created/Modified
- `packages/bot-harness/training/tui/plain-logger.ts` - Non-TTY fallback logger using formatLiveMetrics
- `packages/bot-harness/training/tui/plain-logger.test.ts` - 4 tests covering callback wiring and console output
- `packages/bot-harness/training/tui/index.ts` - TUI barrel re-exporting Dashboard, createProgressHandler, attachPlainLogger, HelpOverlay, types
- `packages/bot-harness/training/index.ts` - Added tui/index.js re-export
- `packages/bot-harness/training/tui/dashboard.tsx` - Added onReady prop for progress handler exposure
- `bin/train.ts` - Conditional TUI/plain rendering with signal handler updates

## Decisions Made
- Added onReady prop to Dashboard component to bridge coordinator.onProgress to the Dashboard's internal batched rendering ref -- this avoids coupling the Dashboard to the TrainingCoordinator type while allowing imperative callers to wire the data pipeline
- Used dynamic import for ink and react in TUI mode branch to keep the plain mode path lightweight and avoid requiring React when --no-tui is set

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added onReady prop to Dashboard for progress handler exposure**
- **Found during:** Task 1 (bin/train.ts wiring)
- **Issue:** Dashboard's internal handlerRef was not exposed to the caller, making it impossible to wire coordinator.onProgress to the dashboard's batched rendering pipeline
- **Fix:** Added optional onReady prop to DashboardProps that is called with the progress handler during useEffect mount
- **Files modified:** packages/bot-harness/training/tui/dashboard.tsx
- **Verification:** All 27 TUI tests still pass, lint clean
- **Committed in:** 7b39755 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 missing critical)
**Impact on plan:** Essential for connecting coordinator data flow to dashboard rendering. Non-breaking addition (optional prop).

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 25 (Training TUI Dashboard) is complete
- TUI dashboard is fully wired and available via `#bot-harness` barrel exports
- Ready for milestone validation or next phase

## Self-Check: PASSED

All created files verified present. Commit 7b39755 verified in git log.

---
*Phase: 25-training-tui-dashboard*
*Completed: 2026-04-02*
