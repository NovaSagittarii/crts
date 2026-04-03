---
phase: 26-training-pipeline-cpu-utilization-optimization
plan: 01
subsystem: training
tags: [ppo, pipeline, double-buffer, perf_hooks, async, worker-threads]

# Dependency graph
requires:
  - phase: 20-ppo-training-pipeline
    provides: TrainingCoordinator, PPOTrainer, TrajectoryBuffer, worker-thread episode collection
  - phase: 25-training-tui-dashboard
    provides: TrainingProgressData, TrainingProgressCallback, onProgress pattern
provides:
  - Pipelined double-buffered run() loop overlapping episode collection with PPO updates
  - PipelineMetrics type with episodes/sec, overlap, and pipeline efficiency
  - episodesPerSec field on TrainingProgressData for TUI dashboard
  - Fire-and-forget I/O pattern for checkpoint saves and log writes
  - computePipelineMetrics helper for per-generation performance measurement
affects: [26-02, training-tui-dashboard, bot-harness]

# Tech tracking
tech-stack:
  added: [node:perf_hooks performance API]
  patterns: [double-buffer async pipeline, fire-and-forget I/O with pendingIO array, background error capture via .catch()]

key-files:
  created: []
  modified:
    - packages/bot-harness/training/training-coordinator.ts
    - packages/bot-harness/training/tui/types.ts
    - packages/bot-harness/training/tui/metrics-panel.test.tsx
    - packages/bot-harness/training/tui/plain-logger.test.ts

key-decisions:
  - "Preliminary episodesPerSec passed to onProgress uses process-time denominator; final pipeline metrics computed after full generation cycle"
  - "Bootstrap generation collected synchronously to prime the pipeline before entering steady-state loop"
  - "Background error capture uses explicit Error type narrowing via const assignment for @typescript-eslint/only-throw-error compliance"

patterns-established:
  - "Double-buffer pipeline: collectBatch(N+1) runs as detached Promise while processCurrentBatch(N) on main thread"
  - "Fire-and-forget I/O: push async ops into pendingIO array, await Promise.all at safe sync point"
  - "Background error capture: .catch() on detached Promise stores Error, re-thrown after await"

requirements-completed: [PIPE-01, PIPE-02, PIPE-03, PIPE-04]

# Metrics
duration: 21min
completed: 2026-04-03
---

# Phase 26 Plan 01: Pipelined Training Loop Summary

**Double-buffered run() loop overlapping worker episode collection with main-thread PPO updates, fire-and-forget I/O, and per-generation pipeline metrics**

## Performance

- **Duration:** 21 min
- **Started:** 2026-04-03T08:21:11Z
- **Completed:** 2026-04-03T08:43:10Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments
- Restructured TrainingCoordinator.run() from synchronous to pipelined double-buffered loop where workers collect next batch concurrently with PPO gradient updates
- Added PipelineMetrics interface with generationWallMs, collectWallMs, processWallMs, overlapMs, episodesPerSec, and pipelineEfficiency
- Fire-and-forget checkpoint/log I/O prevents blocking the PPO update critical path
- All 112 training package tests pass (including 8 coordinator tests and convergence test)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add PipelineMetrics type and episodesPerSec to TrainingProgressData** - `9a3fc1f` (feat)
2. **Task 2: Restructure run() into pipelined double-buffered loop** - `f339468` (feat)

## Files Created/Modified
- `packages/bot-harness/training/tui/types.ts` - Added PipelineMetrics interface and episodesPerSec field to TrainingProgressData
- `packages/bot-harness/training/training-coordinator.ts` - Restructured run() into pipelined loop with computePipelineMetrics helper
- `packages/bot-harness/training/tui/metrics-panel.test.tsx` - Added episodesPerSec to test fixture
- `packages/bot-harness/training/tui/plain-logger.test.ts` - Added episodesPerSec to test fixture

## Decisions Made
- **Bootstrap-then-pipeline:** First generation collected synchronously to prime the pipeline. Steady-state loop then overlaps collection with processing.
- **Preliminary episodesPerSec for onProgress:** onProgress callback receives episodesPerSec computed from process time (available during callback). Final wall-clock-based metrics computed after full generation cycle.
- **Error narrowing for lint:** Background error captured as `Error | null`, re-thrown via `const err: Error = backgroundError` to satisfy `@typescript-eslint/only-throw-error` rule.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added episodesPerSec to existing test fixtures**
- **Found during:** Task 1
- **Issue:** Adding required `episodesPerSec` field to TrainingProgressData made existing test fixtures incomplete
- **Fix:** Added `episodesPerSec` values to mock data in metrics-panel.test.tsx and plain-logger.test.ts
- **Files modified:** packages/bot-harness/training/tui/metrics-panel.test.tsx, packages/bot-harness/training/tui/plain-logger.test.ts
- **Verification:** All TUI tests pass
- **Committed in:** 9a3fc1f (Task 1 commit)

**2. [Rule 1 - Bug] Fixed @typescript-eslint/only-throw-error lint violation**
- **Found during:** Task 2
- **Issue:** `throw backgroundError` where backgroundError is `let Error | null` fails lint because mutable variable narrowing doesn't persist through throw
- **Fix:** Used `const err: Error = backgroundError; throw err;` pattern inside null check
- **Files modified:** packages/bot-harness/training/training-coordinator.ts
- **Verification:** `npx eslint` passes clean
- **Committed in:** f339468 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug)
**Impact on plan:** Both auto-fixes necessary for correctness. No scope creep.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pipelined loop is ready for Plan 02 (TUI integration of pipeline metrics display)
- PipelineMetrics type exported and available for dashboard rendering
- episodesPerSec flowing through onProgress callback

## Self-Check: PASSED

All files exist, all commits verified, all key patterns present in target files.

---
*Phase: 26-training-pipeline-cpu-utilization-optimization*
*Completed: 2026-04-03*
