---
phase: 24-tf-js-native-backend-with-dynamic-fallback
plan: 02
subsystem: training
tags: [tensorflow, tfjs, dynamic-import, ppo, bot-harness, backend-loader]

# Dependency graph
requires:
  - phase: 24-tf-js-native-backend-with-dynamic-fallback (plan 01)
    provides: getTf() backend loader, TfModule type, tf-backend.ts
provides:
  - All bot-harness files use getTf() from tf-backend.ts instead of direct @tensorflow/tfjs imports
  - Zero non-type direct imports of @tensorflow/tfjs remain in packages/bot-harness/
  - initTfBackend() exports for each module requiring pre-initialization
  - Barrel re-exports with unique names (initPpoNetworkTf, initPpoTrainerTf, initTrainingCoordinatorTf)
affects: [bot-harness, training-pipeline, live-bot]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level _tf: TfModule with initTfBackend() export pattern for lazy TF.js initialization"
    - "Test files use beforeAll(async () => { tf = await getTf(); }) with 15s timeout for TF.js init"
    - "Barrel re-exports use aliased names to avoid initTfBackend collisions across modules"

key-files:
  created: []
  modified:
    - packages/bot-harness/training/ppo-network.ts
    - packages/bot-harness/training/ppo-trainer.ts
    - packages/bot-harness/training/training-coordinator.ts
    - packages/bot-harness/training/tfjs-file-io.ts
    - packages/bot-harness/training/training-worker.ts
    - packages/bot-harness/model-loader.ts
    - packages/bot-harness/live-bot-strategy.ts
    - packages/bot-harness/training/index.ts
    - packages/bot-harness/training/ppo-network.test.ts
    - packages/bot-harness/training/ppo-trainer.test.ts
    - packages/bot-harness/training/convergence.test.ts
    - packages/bot-harness/training/opponent-pool.test.ts

key-decisions:
  - "Module-level _tf variable with exported initTfBackend() rather than per-function getTf() calls for performance"
  - "Test files shadow type import with runtime tf variable from getTf() to minimize test code diffs"
  - "Barrel index.ts uses aliased re-exports to resolve initTfBackend name collisions"
  - "model-loader.ts needs only type import since loadModelFromDir handles its own TF.js init"
  - "tfjs-file-io.ts loadModelFromDir has inline _tf initialization guard for standalone usage"
  - "Worker message handler wrapped in async IIFE to support await getTf() in init case"

patterns-established:
  - "Module init pattern: let _tf: TfModule + export async function initTfBackend()"
  - "Coordinator init chains: await initPpoNetworkTf(); await initPpoTrainerTf(); at start of init()"
  - "eslint-disable for false-positive unnecessary-type-assertion on tf.Tensor2D casts with _tf.multinomial"

requirements-completed: [PERF-02, PERF-03]

# Metrics
duration: 30min
completed: 2026-04-02
---

# Phase 24 Plan 02: Consumer Migration Summary

**Migrated all 7 production files and 4 test files from direct @tensorflow/tfjs imports to centralized getTf() backend loader with zero non-type imports remaining**

## Performance

- **Duration:** 30 min
- **Started:** 2026-04-02T07:39:10Z
- **Completed:** 2026-04-02T08:09:34Z
- **Tasks:** 2
- **Files modified:** 12

## Accomplishments
- Eliminated all direct value imports of @tensorflow/tfjs across packages/bot-harness/ (7 production files + 4 test files)
- Every TF.js consumer now goes through getTf() from tf-backend.ts, enabling automatic native backend when available
- All existing unit tests pass unchanged (ppo-network: 9, ppo-trainer: 11, opponent-pool: 11, convergence: 1, tf-backend: 4)
- Worker thread correctly initializes its own TF.js backend via getTf() in async init handler
- Resolved barrel re-export name collisions with aliased initTfBackend exports

## Task Commits

Each task was committed atomically:

1. **Task 1: Migrate training subsystem files** - `ace6481` (feat)
2. **Task 2: Migrate inference files and test files** - `e6c9d62` (feat)

## Files Created/Modified
- `packages/bot-harness/training/ppo-network.ts` - PPO model builder using _tf from getTf()
- `packages/bot-harness/training/ppo-trainer.ts` - PPO trainer using _tf from getTf()
- `packages/bot-harness/training/training-coordinator.ts` - Coordinator with chained initTfBackend calls in init()
- `packages/bot-harness/training/tfjs-file-io.ts` - File IO using _tf from getTf() with inline init guard
- `packages/bot-harness/training/training-worker.ts` - Worker with async getTf() in init message handler
- `packages/bot-harness/training/index.ts` - Barrel with aliased re-exports for initTfBackend functions
- `packages/bot-harness/model-loader.ts` - Changed to type-only import (no runtime tf usage)
- `packages/bot-harness/live-bot-strategy.ts` - Live bot inference using _tf from getTf()
- `packages/bot-harness/training/ppo-network.test.ts` - Added beforeAll with getTf() + initTfBackend()
- `packages/bot-harness/training/ppo-trainer.test.ts` - Added beforeAll with getTf() + init calls
- `packages/bot-harness/training/convergence.test.ts` - Added beforeAll with getTf() + init calls
- `packages/bot-harness/training/opponent-pool.test.ts` - Added beforeAll with getTf() + init calls

## Decisions Made
- Used module-level `_tf` variable with exported `initTfBackend()` function rather than calling `getTf()` in every function. Since getTf() is promise-cached, the init pattern is just as safe but avoids await overhead on every call.
- Test files name their local variable `tf` (not `_tf`) to shadow the type import and avoid changing every `tf.` reference in test bodies. This keeps diffs minimal while still routing through getTf().
- model-loader.ts only needs `import type` since its only tf usage is the return type annotation `tf.LayersModel`, and the actual model loading is delegated to tfjs-file-io.ts.
- Added eslint-disable comments for `@typescript-eslint/no-unnecessary-type-assertion` on `as tf.Tensor2D` casts that TypeScript actually needs but ESLint incorrectly flags.
- Worker message handler wrapped in `void (async () => { ... })()` IIFE to support `await getTf()` in the init case without changing the parentPort.on callback signature.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed barrel re-export name collision for initTfBackend**
- **Found during:** Task 2 (lint verification)
- **Issue:** Multiple modules (ppo-network, ppo-trainer, training-coordinator) all export `initTfBackend`, causing TS2308 ambiguity errors when barrel `export *` re-exports them all
- **Fix:** Changed training/index.ts from `export *` to explicit named re-exports with aliases (initPpoNetworkTf, initPpoTrainerTf, initTrainingCoordinatorTf)
- **Files modified:** packages/bot-harness/training/index.ts
- **Verification:** `npx tsc -p tsconfig.server.json --noEmit` passes clean
- **Committed in:** e6c9d62 (Task 2 commit)

**2. [Rule 1 - Bug] Added eslint-disable for false-positive unnecessary type assertion**
- **Found during:** Task 2 (lint verification)
- **Issue:** ESLint flags `as tf.Tensor2D` on `_tf.multinomial(maskedLogits.expandDims(0) as tf.Tensor2D, 1)` as unnecessary, but removing it causes TS2345 type error since `expandDims(0)` returns `Tensor<Rank>` not `Tensor2D`
- **Fix:** Added eslint-disable-next-line comments in ppo-trainer.ts and training-worker.ts
- **Files modified:** packages/bot-harness/training/ppo-trainer.ts, packages/bot-harness/training/training-worker.ts
- **Verification:** Both lint and TypeScript type-check pass
- **Committed in:** e6c9d62 (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 bug)
**Impact on plan:** Both auto-fixes necessary for build correctness. No scope creep.

## Issues Encountered
None - migration was straightforward mechanical replacement.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 24 (TF.js Native Backend with Dynamic Fallback) is complete
- All bot-harness files route through getTf() from tf-backend.ts
- Native TF.js backend will be used automatically when @tensorflow/tfjs-node loads successfully
- Falls back to pure JS CPU backend on systems where native addon fails (Alpine Linux musl)
- Ready for Phase 25 (Training TUI Dashboard)

## Self-Check: PASSED

- All 12 modified files exist on disk
- Commit ace6481 (Task 1) verified in git log
- Commit e6c9d62 (Task 2) verified in git log
- SUMMARY.md exists at expected path
- Zero non-type @tensorflow/tfjs imports confirmed across packages/bot-harness/
- All unit tests pass: ppo-network (9), ppo-trainer (11), opponent-pool (11), convergence (1), tf-backend (4)

---
*Phase: 24-tf-js-native-backend-with-dynamic-fallback*
*Completed: 2026-04-02*
