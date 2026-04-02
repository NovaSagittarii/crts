---
phase: 24-tf-js-native-backend-with-dynamic-fallback
plan: 01
subsystem: training
tags: [tensorflow, tfjs, native-backend, dynamic-import, fallback]

# Dependency graph
requires:
  - phase: 20-ppo-training-pipeline
    provides: TF.js pure JS backend usage across training/inference modules
provides:
  - Centralized TF.js backend loader (getTf, getBackendName, TfModule)
  - optionalDependency for @tensorflow/tfjs-node native acceleration
  - Barrel re-export from packages/bot-harness/index.ts
affects: [24-02, training, live-bot-strategy, model-loader]

# Tech tracking
tech-stack:
  added: ['@tensorflow/tfjs-node@4.22.0 (optionalDependency)']
  patterns:
    [
      'Dynamic import fallback with promise-based caching for singleton async module loading',
    ]

key-files:
  created:
    - packages/bot-harness/tf-backend.ts
    - packages/bot-harness/tf-backend.test.ts
  modified:
    - package.json
    - package-lock.json
    - packages/bot-harness/index.ts

key-decisions:
  - 'Promise-based caching (_promise variable) rather than result-based caching to prevent duplicate imports during concurrent getTf() calls'
  - '15s test timeout for first getTf() invocation to accommodate native addon failure latency on Alpine musl'
  - '@tensorflow/tfjs-node pinned to 4.22.0 (latest stable) as optionalDependency; @tensorflow/tfjs remains at ^4.23.0-rc.0 in dependencies'

patterns-established:
  - 'Dynamic import fallback: try native -> catch -> fallback to pure JS, with promise-based singleton caching'
  - 'TfModule type alias as canonical type for the TF.js module across all consumers'

requirements-completed: [PERF-01]

# Metrics
duration: 18min
completed: 2026-04-02
---

# Phase 24 Plan 01: TF.js Backend Loader Summary

**Centralized getTf() loader with dynamic import fallback from @tensorflow/tfjs-node to pure JS, promise-cached singleton, and optionalDependency configuration**

## Performance

- **Duration:** 18 min
- **Started:** 2026-04-02T07:16:36Z
- **Completed:** 2026-04-02T07:35:20Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Created tf-backend.ts with getTf() async loader that tries @tensorflow/tfjs-node first, falls back to @tensorflow/tfjs on failure
- Promise-based caching ensures concurrent callers share a single import attempt (no duplicate loads)
- getBackendName() returns 'native' or 'cpu' reflecting which backend loaded (returns 'cpu' on Alpine musl as expected)
- 4 unit tests verify API surface (tensor/layers/model/train/tidy), referential caching, backend name, and concurrent safety
- @tensorflow/tfjs-node added as optionalDependency -- npm install succeeds even when native addon build fails

## Task Commits

Each task was committed atomically:

1. **Task 1: Create tf-backend.ts backend loader and unit test** - `5d46f3e` (feat)
2. **Task 2: Add optionalDependency and barrel export** - `609a84e` (chore)
3. **Fix: Increase test timeout for native addon failure delay** - `4c719ed` (fix)

## Files Created/Modified

- `packages/bot-harness/tf-backend.ts` - Centralized TF.js backend loader with dynamic import fallback and promise caching
- `packages/bot-harness/tf-backend.test.ts` - Unit tests for API surface, caching, backend name, and concurrency
- `package.json` - Added optionalDependencies section with @tensorflow/tfjs-node@4.22.0
- `package-lock.json` - Updated with optional dependency resolution
- `packages/bot-harness/index.ts` - Added barrel re-export for tf-backend module

## Decisions Made

- **Promise-based caching over result-based caching:** Storing the pending promise (not the resolved value) in `_promise` ensures that concurrent `getTf()` calls during startup share a single `loadBackend()` execution rather than each triggering their own import attempts.
- **15s test timeout:** The first `getTf()` call attempts to load @tensorflow/tfjs-node, which takes ~8s to fail on Alpine musl (native addon load + error propagation). Default 5s vitest timeout is insufficient.
- **Pin tfjs-node to 4.22.0 (not caret):** Latest stable release; no newer version exists. Pinning avoids surprise native addon regressions from hypothetical future releases.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed tf.train type assertion in test**

- **Found during:** Task 1 (unit test creation)
- **Issue:** Plan specified `typeof tf.train === 'object'` but TF.js exports `train` as a function (callable namespace)
- **Fix:** Changed assertion to `typeof tf.train === 'function'`
- **Files modified:** packages/bot-harness/tf-backend.test.ts
- **Verification:** All 4 tests pass
- **Committed in:** 5d46f3e (Task 1 commit)

**2. [Rule 1 - Bug] Increased test timeout for native addon failure latency**

- **Found during:** Verification after Task 2
- **Issue:** Installing @tensorflow/tfjs-node as optionalDependency caused first getTf() to attempt native load, taking ~8s to fail on Alpine musl -- exceeding default 5s vitest timeout
- **Fix:** Added 15_000ms timeout to the first test case
- **Files modified:** packages/bot-harness/tf-backend.test.ts
- **Verification:** All 4 tests pass consistently
- **Committed in:** 4c719ed (separate fix commit)

---

**Total deviations:** 2 auto-fixed (2 bug fixes)
**Impact on plan:** Both fixes necessary for test correctness. No scope creep.

## Issues Encountered

- `npm install` fails when run normally due to `prepare` script (`pre-commit install`) conflicting with `core.hooksPath` git config. Resolved by using `npm install --ignore-scripts` -- the dependency resolution and lockfile update still complete correctly.

## Known Stubs

None - all functionality is fully wired.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- tf-backend.ts is ready for Plan 02 to migrate all 12 consumer files from direct `import * as tf from '@tensorflow/tfjs'` to the centralized `getTf()` loader
- The TfModule type alias is exported for consumer type annotations
- On Alpine musl (this system), getBackendName() returns 'cpu' as expected -- native acceleration will activate automatically on glibc systems without code changes

## Self-Check: PASSED

All files created exist on disk. All commit hashes found in git log.

---

_Phase: 24-tf-js-native-backend-with-dynamic-fallback_
_Completed: 2026-04-02_
