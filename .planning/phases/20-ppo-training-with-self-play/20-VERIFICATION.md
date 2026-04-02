---
phase: 20-ppo-training-with-self-play
verified: 2026-04-01T15:10:00Z
status: gaps_found
score: 4/5 success criteria verified
re_verification: false
gaps:
  - truth: 'A policy trained for N episodes achieves a measurably higher win rate against random play than an untrained policy (SC#5)'
    status: partial
    reason: 'Convergence test validates gradient flow (weights change, losses finite, entropy positive) but does NOT assert a win-rate improvement or 55% threshold. The plan explicitly deferred the absolute win-rate check to manual CLI runs. Per the accepted deviation, this is documented and expected -- but the automated gate for SC#5 is weaker than the ROADMAP success criterion.'
    artifacts:
      - path: 'packages/bot-harness/training/convergence.test.ts'
        issue: 'Assertions check weights change and losses are finite, not that trained win rate > untrained baseline. The 55% threshold assertion from the PLAN was removed during implementation due to pure JS TF.js speed constraints.'
    missing:
      - 'No programmatic assertion that trained policy beats untrained baseline or meets 55% threshold'
  - truth: 'Match simulations parallelize across worker threads, utilizing multiple CPU cores (SC#4, TRAIN-04)'
    status: partial
    reason: 'Infrastructure supports multiple workers (confirmed in coordinator code), but all integration tests run with workers=1. No test verifies that 2+ workers actually run in parallel and produce combined results faster than sequential. TRAIN-04 requires parallelism to be demonstrated.'
    artifacts:
      - path: 'packages/bot-harness/training/training-coordinator.test.ts'
        issue: 'makeTestConfig sets workers:1 for all tests. No test exercises workers:2 or workers:4 to verify parallel episode collection works end-to-end.'
    missing:
      - 'At least one coordinator test should use workers >= 2 and verify that episodes are distributed across workers'
  - truth: 'Lint passes with no TypeScript errors'
    status: failed
    reason: 'npm run lint reports 9 TypeScript errors across ppo-network.ts, ppo-trainer.ts, and training-worker.ts'
    artifacts:
      - path: 'packages/bot-harness/training/ppo-network.ts'
        issue: "TS2322: Type 'ArrayBuffer | SharedArrayBuffer' not assignable to 'ArrayBuffer' (line 141)"
      - path: 'packages/bot-harness/training/ppo-trainer.ts'
        issue: "TS2445: Property 'val' is protected (line 173); TS2345: Tensor<Rank> not assignable to Tensor1D (line 257); TS2724: 'NamedTensor' not exported, did you mean 'NamedTensorMap' (lines 300, 307)"
      - path: 'packages/bot-harness/training/training-worker.ts'
        issue: 'TS2345: Tensor<Rank> not assignable to parameter type (line 346); TS2345: ArrayBuffer | SharedArrayBuffer not assignable to ArrayBuffer (lines 434, 435, 439)'
    missing:
      - 'Fix SharedArrayBuffer -> ArrayBuffer type assertions or use Buffer.from() conversion'
      - 'Fix NamedTensor -> NamedTensorMap references in ppo-trainer.ts'
      - 'Fix Tensor<Rank> -> Tensor1D narrowing in ppo-trainer.ts and training-worker.ts'
      - "Fix protected property 'val' access in ppo-trainer.ts"
human_verification:
  - test: 'Verify training actually utilizes multiple CPU cores simultaneously'
    expected: 'When running bin/train.ts with --workers 4, system CPU usage should spike to >100% (multiple cores active) during episode collection phases'
    why_human: 'Cannot measure wall-clock parallelism or CPU utilization programmatically in tests; requires observing process behavior during execution'
  - test: 'Run full training session and verify trained policy beats random play'
    expected: 'NODE_OPTIONS=--conditions=development npx tsx bin/train.ts --episodes 200 --workers 2 --grid-width 15 --grid-height 15 --max-ticks 100 --conv-filters 4,8 --mlp-units 16 --checkpoint-interval 20 --output-dir /tmp/phase20-verify produces a final-model that achieves >55% win rate against RandomBot over 50 evaluation episodes'
    why_human: 'Pure JS TF.js is too slow (2-3 min per episode) to validate the 55% threshold in automated CI. The convergence test only checks gradient flow, not learning outcome.'
---

# Phase 20: PPO Training with Self-Play Verification Report

**Phase Goal:** A PPO training pipeline produces policies that demonstrably improve over random play, using self-play with a historical opponent pool across parallel worker threads
**Verified:** 2026-04-01T15:10:00Z
**Status:** gaps_found
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| #   | Truth                                                                                                      | Status   | Evidence                                                                                                                                                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | PPO training loop runs gradient updates using TF.js and produces loadable checkpoint files                 | VERIFIED | ppo-trainer.ts uses optimizer.minimize with clipByValue; opponent-pool.ts saves model.json + weights.bin via tfjs-file-io; all 11 PPO trainer tests pass                                                                |
| 2   | Self-play opponent pool maintains historical checkpoints and samples opponents with configurable ratios    | VERIFIED | opponent-pool.ts seeds with RandomBot/NoOpBot, FIFO eviction at maxPoolSize, three-way ratio sampling; all 11 opponent pool tests pass                                                                                  |
| 3   | Training CLI launches configurable runs from command line (episodes, LR, opponent pool size, worker count) | VERIFIED | bin/train.ts parses all flags via parseTrainingArgs(); `--help` prints full flag list and exits 0; all flags exercised in tests                                                                                         |
| 4   | Match simulations parallelize across worker threads using multiple CPU cores                               | PARTIAL  | training-coordinator.ts spawns N workers via worker_threads and distributes episodes via workerPromises.map(); however all tests use workers=1, no test verifies multi-worker parallel operation end-to-end             |
| 5   | A policy trained for N episodes achieves measurably higher win rate vs untrained policy                    | PARTIAL  | convergence.test.ts verifies: episodes complete, losses finite, weights change, entropy positive -- but no assertion that trained win rate > untrained baseline or meets 55% threshold (accepted deviation per context) |

**Score:** 3/5 fully verified, 2/5 partial

### Required Artifacts

| Artifact                                                     | Status   | Evidence                                                                                                                             |
| ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/bot-harness/training/training-config.ts`           | VERIFIED | 267 lines; exports TrainingConfig, NetworkConfig, SelfPlayConfig, DEFAULT\_\*, parseTrainingArgs, generateTrainingRunId              |
| `packages/bot-harness/training/ppo-network.ts`               | VERIFIED | 202 lines; exports buildPPOModel, extractWeights, applyWeights, PPOModelConfig, buildModelConfigFromEnv; links to bot-environment.ts |
| `packages/bot-harness/training/trajectory-buffer.ts`         | VERIFIED | 239 lines; exports TrajectoryStep, TrajectoryBatch, computeGAE, TrajectoryBuffer; stores plain Float32Arrays                         |
| `packages/bot-harness/training/ppo-trainer.ts`               | VERIFIED | 369 lines; exports PPOTrainer, TrainStepResult, PPOUpdateResult; uses optimizer.minimize, clipByValue, tf.tidy                       |
| `packages/bot-harness/training/opponent-pool.ts`             | VERIFIED | 229 lines; exports OpponentPool, OpponentEntry, OpponentType; seeds RandomBot/NoOpBot, FIFO eviction                                 |
| `packages/bot-harness/training/training-logger.ts`           | VERIFIED | 154 lines; exports TrainingLogger, TrainingLogEntry; appendFile for NDJSON, formatLiveMetrics with ETA                               |
| `packages/bot-harness/training/training-worker.ts`           | VERIFIED | 556 lines; imports @tensorflow/tfjs (NOT tfjs-node); uses parentPort, BotEnvironment, tf.tidy                                        |
| `packages/bot-harness/training/training-coordinator.ts`      | VERIFIED | 647 lines; exports TrainingCoordinator; spawns Worker, PPOTrainer, OpponentPool integration; resume support                          |
| `packages/bot-harness/training/training-coordinator.test.ts` | VERIFIED | 214 lines; integration tests: full cycle, clean termination, opponent variety, resume                                                |
| `packages/bot-harness/training/convergence.test.ts`          | VERIFIED | 284 lines; validates gradient flow: weights change, losses finite, entropy positive                                                  |
| `packages/bot-harness/training/index.ts`                     | VERIFIED | 7 lines; barrel export for all training modules                                                                                      |
| `packages/bot-harness/index.ts`                              | VERIFIED | re-exports `./training/index.js` on line 12                                                                                          |
| `bin/train.ts`                                               | VERIFIED | 90 lines; shebang, parseTrainingArgs, coordinator lifecycle, SIGINT/SIGTERM graceful shutdown                                        |

### Key Link Verification

| From                    | To                          | Via                                                            | Status | Details                                                                                      |
| ----------------------- | --------------------------- | -------------------------------------------------------------- | ------ | -------------------------------------------------------------------------------------------- |
| ppo-network.ts          | bot-environment.ts          | buildModelConfigFromEnv reads observationSpace/actionSpace     | WIRED  | Lines 176-196 confirmed; observationSpace.planes.shape, actionSpace.n                        |
| ppo-trainer.ts          | ppo-network.ts              | model.predict for forward pass, optimizer.minimize for updates | WIRED  | Lines 103, 107 confirmed; clipByValue for ratio clipping                                     |
| ppo-trainer.ts          | trajectory-buffer.ts        | Reads TrajectoryBuffer in update()                             | WIRED  | Import line 17; update() takes TrajectoryBuffer parameter                                    |
| opponent-pool.ts        | random-bot.ts / noop-bot.ts | Seeds pool with RandomBot and NoOpBot                          | WIRED  | Lines 4-5 imports; lines 56, 63 construct instances                                          |
| training-worker.ts      | @tensorflow/tfjs (pure JS)  | tf import for local inference                                  | WIRED  | Line 13: `import * as tf from '@tensorflow/tfjs'`; grep confirms 0 occurrences of tfjs-node  |
| training-worker.ts      | BotEnvironment              | reset()/step() for episode collection                          | WIRED  | Line 15 import; line 374 construction; message protocol at lines 504-542                     |
| training-coordinator.ts | training-worker.ts          | Spawns workers, sends weights, receives trajectories           | WIRED  | new Worker with shim (line 283); postMessage 'set-weights'/'collect-episode' (lines 325-405) |
| training-coordinator.ts | ppo-trainer.ts              | Runs PPO updates on collected trajectories                     | WIRED  | Line 22 import; line 113 construction; update() called in run loop                           |
| training-coordinator.ts | opponent-pool.ts            | Samples opponents for episodes                                 | WIRED  | Line 19 import; line 71 field; sampleOpponent() called at line 372                           |
| bin/train.ts            | training-coordinator.ts     | Creates coordinator, calls init()/run()/cleanup()              | WIRED  | Lines 43, 64, 68, 83 confirmed                                                               |
| bin/train.ts            | training-config.ts          | Parses CLI args via parseTrainingArgs()                        | WIRED  | Lines 3, 12 confirmed                                                                        |

### Data-Flow Trace (Level 4)

Not applicable -- this is a training pipeline, not a rendering/display system. The data flow is: BotEnvironment.step() -> TrajectoryBuffer -> computeGAE -> PPOTrainer.update() -> model weight update. All steps are verified substantive and wired.

### Behavioral Spot-Checks

| Behavior                           | Command                                                                                                | Result                                                                    | Status |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------ |
| CLI --help prints usage and exits  | `NODE_OPTIONS=--conditions=development npx tsx bin/train.ts --help`                                    | Printed full flag list, exited 0                                          | PASS   |
| All unit tests pass                | `npx vitest run packages/bot-harness/training/{config,network,trajectory,trainer,pool,logger}.test.ts` | 73/73 tests passed                                                        | PASS   |
| Convergence test passes            | `npx vitest run packages/bot-harness/training/convergence.test.ts`                                     | 1/1 passed (164s); weights changed, losses finite, entropy positive       | PASS   |
| Coordinator integration tests pass | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts`                            | 5/5 passed (148s); full cycle, resume, termination verified               | PASS   |
| Lint clean                         | `npm run lint`                                                                                         | 9 TypeScript errors in ppo-network.ts, ppo-trainer.ts, training-worker.ts | FAIL   |

### Requirements Coverage

| Requirement | Plans Claiming It   | Description                                                                      | Status    | Evidence                                                                                                                                                                            |
| ----------- | ------------------- | -------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TRAIN-01    | 20-01, 20-02, 20-05 | PPO training loop runs policy gradient updates using TF.js, produces checkpoints | SATISFIED | optimizer.minimize with clipped surrogate loss; checkpoints saved as model.json + weights.bin; convergence test verifies gradient flow                                              |
| TRAIN-02    | 20-03, 20-04        | Self-play opponent pool maintains historical checkpoints, configurable ratios    | SATISFIED | OpponentPool with RandomBot/NoOpBot seeding, three-way ratio sampling, FIFO eviction; opponent-pool tests verify all behaviors; coordinator dispatches sampled opponents to workers |
| TRAIN-03    | 20-01, 20-05        | Training CLI launches configurable runs from command line                        | SATISFIED | bin/train.ts parses all flags (episodes, lr, workers, pool size, etc.); --help works; coordinator lifecycle wired                                                                   |
| TRAIN-04    | 20-04, 20-05        | Training step parallelizes across worker threads for multiple CPU cores          | PARTIAL   | Worker spawning and parallel collectBatch infrastructure exists and works; but tests only use workers=1, no test verifies multi-worker parallel execution                           |

### Anti-Patterns Found

| File                                             | Line(s)       | Pattern                                                            | Severity | Impact                                                                                                                                          |
| ------------------------------------------------ | ------------- | ------------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/bot-harness/training/ppo-network.ts     | 141           | `ArrayBuffer \| SharedArrayBuffer` not assignable to `ArrayBuffer` | Warning  | TypeScript error; does not affect runtime since ArrayBuffer.slice returns the correct type in practice                                          |
| packages/bot-harness/training/ppo-trainer.ts     | 173           | Access to protected property `val` on LayerVariable                | Warning  | TypeScript error; may break with TF.js version upgrades                                                                                         |
| packages/bot-harness/training/ppo-trainer.ts     | 257           | Tensor<Rank> not assignable to Tensor1D                            | Warning  | TypeScript error; rank narrowing missing                                                                                                        |
| packages/bot-harness/training/ppo-trainer.ts     | 300, 307      | `NamedTensor` not exported from @tensorflow/tfjs                   | Warning  | TypeScript error; optimizer weight get/set methods use wrong type name -- actual resume support may fail at runtime if these methods are called |
| packages/bot-harness/training/training-worker.ts | 346           | Tensor<Rank> not assignable to Tensor1D/Tensor2D                   | Warning  | TypeScript error; rank narrowing missing                                                                                                        |
| packages/bot-harness/training/training-worker.ts | 434, 435, 439 | `ArrayBuffer \| SharedArrayBuffer` not assignable to `ArrayBuffer` | Warning  | TypeScript errors; affect weight serialization in worker -- may cause runtime errors in strict environments                                     |

**Note on NamedTensor (ppo-trainer.ts lines 300, 307):** The `getOptimizerWeights` and `setOptimizerWeights` methods reference `tf.NamedTensor` which does not exist in the pure JS TF.js export. These methods are used by the coordinator for checkpoint resume support. If the TypeScript errors indicate an actual API mismatch, the optimizer state save/load may fail silently or at runtime.

### Human Verification Required

#### 1. Multi-Worker Parallel Execution

**Test:** Run `NODE_OPTIONS=--conditions=development npx tsx bin/train.ts --episodes 20 --workers 4 --grid-width 15 --grid-height 15 --max-ticks 50 --conv-filters 2 --mlp-units 8 --checkpoint-interval 10 --output-dir /tmp/verify-parallel`
**Expected:** 4 worker threads are active during episode collection; system reports >100% CPU during collection phases; training completes with 20 episodes in the log
**Why human:** Cannot programmatically verify that workers run simultaneously vs. sequentially with workers=1; requires observing CPU utilization during execution

#### 2. Trained Policy Win Rate vs Untrained Baseline

**Test:** Run a full training session with `bin/train.ts --episodes 200 --workers 2 --grid-width 15 --grid-height 15 --max-ticks 100 --conv-filters 4,8 --mlp-units 16 --checkpoint-interval 20 --output-dir /tmp/phase20-convergence`, then evaluate the saved final-model against RandomBot for 50 episodes
**Expected:** Trained policy win rate >= 55% (demonstrably higher than ~30-40% random baseline)
**Why human:** Pure JS TF.js is too slow (~1s/forward-pass) for this validation in automated CI. The convergence.test.ts only validates gradient flow mechanics, not learning outcome. This is the core ROADMAP SC#5 requirement.

#### 3. Optimizer Resume Correctness

**Test:** Verify that `--resume <run-id>` actually restores optimizer state correctly given the NamedTensor type errors in ppo-trainer.ts. Run a training session, then resume it and verify losses continue smoothly rather than resetting
**Expected:** Resumed training continues from similar loss levels to where the previous run ended; no sudden loss spike after resume
**Why human:** The TypeScript error at ppo-trainer.ts:300,307 (`NamedTensor` not exported) may indicate the optimizer save/load has a type mismatch that causes silent failure at runtime. The coordinator resume test passes (model + episode counter restored) but optimizer weights may not be restored correctly.

### Gaps Summary

Three gaps prevent a clean pass:

**Gap 1 -- Lint failures (9 TypeScript errors):** The codebase has 9 TypeScript type errors in ppo-network.ts, ppo-trainer.ts, and training-worker.ts. The most concerning is `NamedTensor` not being a valid export in @tensorflow/tfjs -- this affects optimizer state save/load in ppo-trainer.ts, which is exercised by the coordinator resume test. The test passes (suggesting runtime behavior is acceptable), but the type errors indicate API misuse that could fail with TF.js version changes or in strict runtime environments.

**Gap 2 -- TRAIN-04 parallelism not verified at >1 worker:** The coordinator infrastructure correctly supports multiple workers (spawns N workers, distributes episodes via `workerPromises.map()`), but all integration tests use `workers: 1`. No test verifies that 2 or more workers run simultaneously and combine their results. The ROADMAP SC#4 requires "utilizing multiple CPU cores" -- the code has the machinery but parallelism is not programmatically demonstrated.

**Gap 3 -- SC#5 convergence assertion deferred to manual runs:** The convergence.test.ts validates that the PPO pipeline executes correctly (gradient flow, finite losses, weight changes, positive entropy) but does not assert that a trained policy beats an untrained baseline. This is an accepted and documented deviation due to pure JS TF.js performance constraints on Alpine Linux musl -- full convergence validation requires manual CLI runs. The ROADMAP SC#5 ("measurably higher win rate") remains unverified by automated tests.

---

_Verified: 2026-04-01T15:10:00Z_
_Verifier: Claude (gsd-verifier)_
