---
phase: 20-ppo-training-with-self-play
plan: 03
subsystem: training
tags: [self-play, opponent-pool, checkpoint, ndjson, training-logger, tfjs]

# Dependency graph
requires:
  - phase: 20-ppo-training-with-self-play
    plan: 01
    provides: TrainingConfig, PPOModelConfig, buildPPOModel, extractWeights, WeightData
provides:
  - OpponentPool with FIFO eviction and ratio-based sampling (D-05, D-06, D-07, D-08)
  - TrainingLogger with NDJSON file output and live stdout metrics (D-09, D-10)
  - Custom TF.js file IO (saveModelToDir/loadWeightsFromDir) for pure JS backend
  - OpponentEntry and OpponentType types
  - TrainingLogEntry interface for structured episode logging
affects: [20-04, 20-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      'Custom file IO for TF.js pure JS backend (save model.json + weights.bin)',
      'NDJSON append-only logging with appendFile',
      'FIFO opponent pool eviction with configurable ratio sampling',
    ]

key-files:
  created:
    - packages/bot-harness/training/opponent-pool.ts
    - packages/bot-harness/training/opponent-pool.test.ts
    - packages/bot-harness/training/training-logger.ts
    - packages/bot-harness/training/training-logger.test.ts
    - packages/bot-harness/training/tfjs-file-io.ts
  modified: []

key-decisions:
  - 'Custom TF.js file IO instead of file:// handler -- pure JS @tensorflow/tfjs lacks file:// IOHandler (only in tfjs-node)'
  - 'loadWeightsFromDir reads raw weight data without creating a TF.js model -- avoids variable name collisions when another model with same topology exists'
  - 'Weight save uses Float32Array clone into standalone ArrayBuffer to avoid SharedArrayBuffer type mismatch'

patterns-established:
  - 'Checkpoint save/load pattern: saveModelToDir writes model.json + weights.bin, loadWeightsFromDir returns WeightData[] directly'
  - 'Opponent pool pattern: built-in bots (RandomBot/NoOpBot) are permanent entries, historical checkpoints have FIFO eviction'
  - 'Training logger pattern: NDJSON append for structured logs, formatLiveMetrics for stdout display with ETA'

requirements-completed: [TRAIN-02, TRAIN-03]

# Metrics
duration: 14min
completed: 2026-04-01
---

# Phase 20 Plan 03: Self-Play Opponent Pool & Training Logger Summary

**Self-play opponent pool with three-way ratio sampling and FIFO eviction, plus NDJSON training logger with live stdout metrics and ETA display**

## Performance

- **Duration:** 14 min
- **Started:** 2026-04-01T12:26:19Z
- **Completed:** 2026-04-01T12:40:26Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Built OpponentPool that seeds with RandomBot and NoOpBot, samples opponents via configurable latest/historical/random ratio, and evicts oldest checkpoints via FIFO when pool exceeds max size
- Implemented custom TF.js file IO (saveModelToDir/loadWeightsFromDir) to work around pure JS backend lacking file:// handler
- Created TrainingLogger that writes NDJSON episode logs, config.json, and formats live stdout metrics with ETA calculation
- 21 tests passing across both test files (11 opponent pool + 10 training logger)

## Task Commits

Each task was committed atomically:

1. **Task 1: Self-play opponent pool with checkpoint management** - TDD cycle:
   - `1c457ca` (test: add failing tests for opponent pool)
   - `238e21c` (feat: implement self-play opponent pool with checkpoint management)
   - `9adfef3` (fix: fix SharedArrayBuffer type error in tfjs-file-io)

2. **Task 2: Structured training logger with NDJSON and live metrics** - TDD cycle:
   - `b63ead2` (test: add failing tests for training logger)
   - `84cd3cc` (feat: implement structured training logger with NDJSON and live metrics)

## Files Created/Modified

- `packages/bot-harness/training/opponent-pool.ts` - OpponentPool class with FIFO eviction, ratio-based sampling, checkpoint save/load
- `packages/bot-harness/training/opponent-pool.test.ts` - 11 tests for seeding, sampling, eviction, checkpoint persistence
- `packages/bot-harness/training/training-logger.ts` - TrainingLogger class with NDJSON output, config.json writer, live metrics formatter
- `packages/bot-harness/training/training-logger.test.ts` - 10 tests for directory structure, NDJSON format, config writing, metrics formatting
- `packages/bot-harness/training/tfjs-file-io.ts` - Custom file IO for TF.js pure JS backend (saveModelToDir, loadModelFromDir, loadWeightsFromDir)

## Decisions Made

- **Custom file IO for pure JS TF.js:** The `file://` IO handler is only available in `@tensorflow/tfjs-node`. Since we use the pure JS backend (Alpine Linux musl blocks native addon), implemented manual save/load writing `model.json` + `weights.bin` files directly.
- **Direct weight loading (loadWeightsFromDir):** Loading a full model via `tf.loadLayersModel` causes TF.js variable name collisions when another model with the same topology already exists (suffixes names with `_1`). Instead, `loadWeightsFromDir` reads raw weight binary data and returns `WeightData[]` without creating a TF.js model.
- **Float32Array clone for weights:** Used `new ArrayBuffer` + `Float32Array.set()` instead of `buffer.slice()` to avoid TypeScript `SharedArrayBuffer` type incompatibility in strict mode.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] TF.js pure JS backend lacks file:// IO handler**

- **Found during:** Task 1 (opponent pool implementation)
- **Issue:** `model.save('file://...')` throws "Cannot find any save handlers for URL 'file://...'" in pure JS @tensorflow/tfjs (only available in tfjs-node)
- **Fix:** Created `packages/bot-harness/training/tfjs-file-io.ts` with `saveModelToDir` that manually writes `model.json` + `weights.bin`, and `loadWeightsFromDir` that reads weight data directly
- **Files modified:** packages/bot-harness/training/tfjs-file-io.ts, packages/bot-harness/training/opponent-pool.ts
- **Verification:** All 11 opponent pool tests pass including save/load checkpoint tests
- **Committed in:** 238e21c, 9adfef3

**2. [Rule 1 - Bug] Variable name collision when loading models**

- **Found during:** Task 1 (loadOpponentWeights test)
- **Issue:** `tf.loadLayersModel` creates new model with weight names suffixed `_1` when another model with same topology exists in TF.js scope, causing "no target variable" errors
- **Fix:** Replaced model-based loading with direct `loadWeightsFromDir` that reads raw binary weight data as `WeightData[]` without creating a TF.js model
- **Files modified:** packages/bot-harness/training/tfjs-file-io.ts, packages/bot-harness/training/opponent-pool.ts
- **Verification:** loadOpponentWeights test passes
- **Committed in:** 238e21c

**3. [Rule 1 - Bug] SharedArrayBuffer type incompatibility**

- **Found during:** Task 1 (lint check)
- **Issue:** `data.buffer.slice()` returns `ArrayBuffer | SharedArrayBuffer` but WeightData expects `ArrayBuffer`, failing TypeScript strict checks
- **Fix:** Clone weight data using `new ArrayBuffer(byteLength)` + `new Float32Array(cloned).set(data)` instead of `buffer.slice()`
- **Files modified:** packages/bot-harness/training/tfjs-file-io.ts
- **Verification:** `tsc --noEmit` passes for all new files
- **Committed in:** 9adfef3

---

**Total deviations:** 3 auto-fixed (2 bug fixes, 1 blocking)
**Impact on plan:** All auto-fixes necessary for compatibility with pure JS TF.js backend. No scope creep. The custom file IO is a clean abstraction that will be reusable by downstream plans.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- OpponentPool ready for Plan 04 (training loop) and Plan 05 (training CLI)
- TrainingLogger ready for Plan 04 (episode logging) and Plan 05 (CLI output)
- tfjs-file-io utilities available for any checkpoint save/load needs
- Custom file IO pattern documented for future reference

## Self-Check: PASSED

All 5 created files verified present. All 5 task commits verified in git log.

---

_Phase: 20-ppo-training-with-self-play_
_Completed: 2026-04-01_
