---
phase: 25-training-tui-dashboard
plan: 01
subsystem: training
tags: [ink, react, asciichart, tui, tsx, ppo, training]

# Dependency graph
requires:
  - phase: 20-ppo-training-pipeline
    provides: TrainingCoordinator, TrainingConfig, PPO training loop
  - phase: 24-tf-js-native-backend-with-dynamic-fallback
    provides: getTf() lazy TF.js initialization
provides:
  - Ink/React/asciichart npm dependencies installed
  - TSX compilation support (jsx: react-jsx in both tsconfig files)
  - Vitest .test.tsx file discovery
  - TrainingProgressData and DashboardState type contracts
  - TrainingCoordinator.onProgress callback for per-episode metric streaming
  - TrainingCoordinator.togglePause()/isPaused()/requestStop() control API
  - TrainingConfig.noTui boolean flag with --no-tui CLI parsing
affects: [25-02-PLAN, 25-03-PLAN]

# Tech tracking
tech-stack:
  added: [ink@6, react@19, asciichart@1.5, ink-testing-library@4, @types/react@19, @types/asciichart]
  patterns: [TrainingProgressCallback for event-driven metric emission, pause/resume loop pattern with polling]

key-files:
  created:
    - packages/bot-harness/training/tui/types.ts
  modified:
    - package.json
    - package-lock.json
    - tsconfig.json
    - tsconfig.server.json
    - vitest.config.ts
    - packages/bot-harness/training/training-coordinator.ts
    - packages/bot-harness/training/training-coordinator.test.ts
    - packages/bot-harness/training/training-config.ts
    - packages/bot-harness/training/training-config.test.ts

key-decisions:
  - "Ink 6 + React 19 for TUI rendering framework"
  - "onProgress callback pattern (not EventEmitter) for simple coordinator-to-TUI data flow"
  - "Pause implemented via polling loop (100ms interval) to avoid blocking event loop"

patterns-established:
  - "TrainingProgressCallback: coordinator fires onProgress per-episode with full TrainingProgressData"
  - "Pause/resume: while(paused && !stopRequested) poll pattern in async training loop"

requirements-completed: [TUI-03, TUI-04, TUI-07]

# Metrics
duration: 16min
completed: 2026-04-02
---

# Phase 25 Plan 01: Infrastructure + Coordinator Callback Summary

**Ink/React/asciichart dependencies with TSX compilation, coordinator onProgress/pause/stop callbacks, --no-tui flag, and TUI type contracts**

## Performance

- **Duration:** 16 min
- **Started:** 2026-04-02T09:10:36Z
- **Completed:** 2026-04-02T09:26:59Z
- **Tasks:** 3
- **Files modified:** 9

## Accomplishments
- Installed Ink 6, React 19, and asciichart as production dependencies with full TypeScript type support
- Configured JSX compilation (react-jsx) in both tsconfig.json and tsconfig.server.json, plus .test.tsx discovery in vitest
- Added TrainingProgressData, TrainingProgressCallback, and DashboardState type contracts for TUI rendering
- Extended TrainingCoordinator with onProgress callback (fired per-episode), togglePause/isPaused/requestStop control API, and generation tracking
- Added --no-tui boolean flag to TrainingConfig with CLI parsing via parseTrainingArgs

## Task Commits

Each task was committed atomically:

1. **Task 1: Install dependencies and configure TSX compilation** - `ef6430d` (chore)
2. **Task 2: Add TUI type contracts and coordinator callback + pause/resume** - `7d8eeef` (feat)
3. **Task 3: Add --no-tui flag to parseTrainingArgs** - `8f5eb66` (feat)

## Files Created/Modified
- `packages/bot-harness/training/tui/types.ts` - TrainingProgressData, TrainingProgressCallback, DashboardState interfaces
- `packages/bot-harness/training/training-coordinator.ts` - onProgress callback, togglePause/isPaused/requestStop, generation tracking, pause loop
- `packages/bot-harness/training/training-coordinator.test.ts` - 3 new tests for onProgress, togglePause, requestStop
- `packages/bot-harness/training/training-config.ts` - noTui field, --no-tui parseArgs option, help text Display section
- `packages/bot-harness/training/training-config.test.ts` - 3 new tests for noTui default/flag/absent
- `package.json` - ink, react, asciichart, @types/react, @types/asciichart, ink-testing-library deps
- `package-lock.json` - lockfile update for new deps
- `tsconfig.json` - jsx: react-jsx compiler option
- `tsconfig.server.json` - jsx: react-jsx compiler option, packages/**/*.tsx include
- `vitest.config.ts` - .test.tsx file pattern in test.include

## Decisions Made
- Used Ink 6 + React 19 as TUI rendering framework (Ink 6 requires React 19 as peer)
- Used callback pattern (onProgress) instead of EventEmitter for simple, type-safe coordinator-to-TUI data flow
- Pause implemented via 100ms polling loop to avoid blocking the event loop while keeping responsiveness
- getLatestCheckpointEpisode() parses checkpoint directory name (checkpoint-N pattern) rather than tracking episode number separately

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All dependencies installed and importable for Plan 02 TUI component development
- TSX compilation works in both tsconfig files, ready for .tsx component files
- Vitest discovers .test.tsx files, ready for component test files
- TrainingProgressData and DashboardState types exported for Plan 02 component props
- TrainingCoordinator.onProgress ready for Plan 03 wiring to TUI dashboard
- TrainingConfig.noTui ready for Plan 03 conditional TUI/plain-log dispatch

## Self-Check: PASSED

All 9 files verified present. All 3 commit hashes verified in git log.

---
*Phase: 25-training-tui-dashboard*
*Completed: 2026-04-02*
