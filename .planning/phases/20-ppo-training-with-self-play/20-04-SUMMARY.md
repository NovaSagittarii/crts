---
phase: 20-ppo-training-with-self-play
plan: 04
subsystem: training
tags: [worker-threads, actor-learner, ppo, tfjs, parallel-training, self-play]

# Dependency graph
requires:
  - phase: 20-ppo-training-with-self-play
    plan: 01
    provides: buildPPOModel, extractWeights, applyWeights, PPOModelConfig, WeightData
  - phase: 20-ppo-training-with-self-play
    plan: 02
    provides: PPOTrainer, TrajectoryBuffer, TrajectoryStep, computeGAE
  - phase: 20-ppo-training-with-self-play
    plan: 03
    provides: OpponentPool, TrainingLogger, saveModelToDir, loadWeightsFromDir
provides:
  - Training worker for autonomous episode collection in worker threads
  - TrainingCoordinator class orchestrating actor-learner split (D-14)
  - Worker shim for tsx tsImport() in Node 24 worker threads
  - Queue-based episode dispatch to avoid message listener races
  - Resume support with model weights + optimizer state + episode counter (D-11)
affects: [20-05]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'tsx tsImport() shim for worker_threads TypeScript loading on Node 24'
    - 'Queue-based sequential episode dispatch per worker to avoid message listener race conditions'
    - 'Serialized optimizer state as JSON alongside model checkpoints for resume'
    - 'Cloned ArrayBuffers for postMessage weight transfer (buffers can only be transferred once)'

key-files:
  created:
    - packages/bot-harness/training/training-worker.ts
    - packages/bot-harness/training/training-coordinator.ts
    - packages/bot-harness/training/training-coordinator.test.ts
    - packages/bot-harness/training/_worker-shim.mjs
  modified: []

key-decisions:
  - 'Worker shim using tsx tsImport() instead of --import tsx: tsx v4.21.0 on Node 24 does not resolve .js -> .ts extensions in worker_threads'
  - 'Queue-based sequential episode dispatch per worker: avoids race condition where multiple message listeners for episode-result fire on same message'
  - 'Minimum grid size 15x15 for BotEnvironment: 10x10 too small for RtsRoom spawn footprint with two teams'
  - 'CheckpointBot uses simplified tick-based action selection rather than full model inference: sufficient for opponent variety without importing ObservationEncoder/ActionDecoder'
  - 'Optimizer state serialized as JSON (name + shape + data arrays) alongside model checkpoint for resume support'

patterns-established:
  - 'Worker thread pattern: _worker-shim.mjs -> tsImport(workerData._workerTsPath) for TypeScript worker loading'
  - 'Actor-learner split: workers collect episodes autonomously with frozen weights, main thread runs PPO gradient updates'
  - 'Episode dispatch: sequential per-worker queue with Promise-based awaiting to prevent message listener races'

requirements-completed: [TRAIN-01, TRAIN-02, TRAIN-04]

# Metrics
duration: 45min
completed: 2026-04-01
---

# Phase 20 Plan 04: Worker Thread Episode Collection & Training Coordinator Summary

**Parallel episode collection via worker threads with actor-learner split: workers run autonomous episodes with pure JS TF.js, coordinator orchestrates weight distribution, trajectory collection, and PPO updates on main thread**

## Performance

- **Duration:** 45 min
- **Started:** 2026-04-01T12:48:39Z
- **Completed:** 2026-04-01T13:33:39Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Training worker collects complete episodes autonomously using BotEnvironment with pure JS @tensorflow/tfjs (safe in worker threads)
- TrainingCoordinator orchestrates the full training loop: spawn workers, distribute weights, collect episodes in parallel, run PPO updates, manage checkpoints
- Resume support loads model weights, optimizer state, and episode counter from checkpoints (D-11)
- Integration tests verify full cycle, clean termination, opponent type variety (TRAIN-02), and resume from checkpoint
- All 78 training tests pass, lint clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Training worker for autonomous episode collection** - `ec11c26` (feat)
2. **Task 2: Training coordinator with actor-learner orchestration** - `36f2add` (feat)
3. **Lint fixes** - `4307d4c` (fix)

## Files Created/Modified

- `packages/bot-harness/training/training-worker.ts` - Worker thread entry point: builds local model with pure JS tfjs, receives weights, collects episodes via BotEnvironment, returns serialized trajectories
- `packages/bot-harness/training/training-coordinator.ts` - Main thread orchestrator: spawns workers, broadcasts weights, collects episode batches, runs PPO updates, manages checkpoints and resume
- `packages/bot-harness/training/training-coordinator.test.ts` - Integration tests: full cycle, clean termination, win rate, opponent variety, resume support
- `packages/bot-harness/training/_worker-shim.mjs` - JavaScript shim that uses tsx tsImport() to load TypeScript worker in Node 24 worker threads

## Decisions Made

- **tsx tsImport() shim for workers:** tsx v4.21.0 on Node 24 does not resolve `.js` -> `.ts` extensions inside `worker_threads` even with `--import tsx`. Created a `.mjs` shim that uses tsx's programmatic `tsImport()` API which handles TypeScript resolution correctly.
- **Queue-based episode dispatch:** Sending multiple episodes to the same worker simultaneously causes message listener race conditions (both listeners fire on the first `episode-result`). Fixed by dispatching episodes sequentially per worker, awaiting each result before sending the next.
- **Minimum grid size 15x15:** RtsRoom requires at least 15x15 for the spawn footprint of two teams. Tests use 15x15 grid with 5 max ticks for fast execution.
- **CheckpointBot simplified strategy:** Uses tick-modulo action selection rather than full model inference, avoiding the need to import ObservationEncoder/ActionDecoder in the worker while still providing diverse opponent behavior.
- **Optimizer state as JSON:** Serialized optimizer weights to JSON alongside model checkpoint for full resume support (D-11).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tsx .js -> .ts resolution broken in Node 24 worker_threads**

- **Found during:** Task 1/2 (training worker + coordinator)
- **Issue:** tsx v4.21.0 with `--import tsx` in `execArgv` does not resolve `.js` extension imports to `.ts` files inside worker threads on Node 24
- **Fix:** Created `_worker-shim.mjs` that uses tsx's programmatic `tsImport()` API which correctly handles TypeScript module resolution in workers
- **Files modified:** `packages/bot-harness/training/_worker-shim.mjs`, `packages/bot-harness/training/training-coordinator.ts`
- **Verification:** Worker initializes, receives weights, and collects episodes successfully
- **Committed in:** `36f2add`

**2. [Rule 1 - Bug] Message listener race condition in collectBatch**

- **Found during:** Task 2 (coordinator implementation)
- **Issue:** Sending multiple `collect-episode` messages to the same worker with separate `worker.on('message')` listeners causes both listeners to fire on the first response
- **Fix:** Replaced parallel dispatch with sequential per-worker queue where each episode awaits its response before dispatching the next
- **Files modified:** `packages/bot-harness/training/training-coordinator.ts`
- **Verification:** Full cycle test passes with 2 episodes on 1 worker
- **Committed in:** `36f2add`

**3. [Rule 1 - Bug] Grid size too small for spawn footprint**

- **Found during:** Task 2 (coordinator test)
- **Issue:** 10x10 grid causes "Spawn footprint does not fit in room bounds" error when BotEnvironment creates an RtsRoom with two teams
- **Fix:** Increased minimum test grid size from 10x10 to 15x15
- **Files modified:** `packages/bot-harness/training/training-coordinator.test.ts`
- **Verification:** All tests pass with 15x15 grid
- **Committed in:** `36f2add`

---

**Total deviations:** 3 auto-fixed (2 bugs, 1 blocking)
**Impact on plan:** All fixes necessary for correct operation. Worker shim approach is robust and reusable. No scope creep.

## Issues Encountered

- Pure JS TF.js forward pass takes ~40ms per inference (vs ~1ms with native backend), making each 5-tick episode take ~5 seconds. Integration tests use minimal model (convFilters=[4], mlpUnits=[8]) and 5 max ticks for acceptable test duration (~25s per full cycle test).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All training infrastructure complete: network, trainer, buffer, pool, logger, worker, coordinator
- Plan 20-05 (training CLI entry point) can now wire the coordinator to CLI args
- The coordinator's `run()` method is the single entry point for the full training loop
- Resume support verified: `--resume <run-id>` can load checkpoint and continue training

## Known Stubs

None - all functionality is wired end-to-end.

## Self-Check: PASSED

All 4 created files verified on disk. All 3 commits verified in git history.

---

_Phase: 20-ppo-training-with-self-play_
_Completed: 2026-04-01_
