---
phase: 20-ppo-training-with-self-play
plan: 01
subsystem: training
tags: [tensorflow, tfjs, ppo, cnn, neural-network, reinforcement-learning]

# Dependency graph
requires:
  - phase: 19-observation-action-and-reward-interface
    provides: BotEnvironment with observationSpace/actionSpace metadata
provides:
  - TrainingConfig interface with all PPO hyperparameters and CLI parsing
  - NetworkConfig and SelfPlayConfig sub-configurations
  - CNN+MLP PPO network builder (buildPPOModel)
  - Weight serialization/deserialization for cross-thread transfer
  - PPOModelConfig from BotEnvironment metadata (buildModelConfigFromEnv)
  - TF.js verified working on Alpine Linux / Node 24
affects: [20-02, 20-03, 20-04, 20-05]

# Tech tracking
tech-stack:
  added: ["@tensorflow/tfjs (pure JS CPU backend)"]
  patterns: ["CNN+MLP dual-head architecture", "weight transfer via ArrayBuffer serialization", "CLI config parsing with parseArgs"]

key-files:
  created:
    - packages/bot-harness/training/training-config.ts
    - packages/bot-harness/training/training-config.test.ts
    - packages/bot-harness/training/ppo-network.ts
    - packages/bot-harness/training/ppo-network.test.ts
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Used @tensorflow/tfjs pure JS backend instead of tfjs-node -- native addon fails on Alpine Linux (musl libc) with symbol relocation error"
  - "Network accepts channels-last [H,W,C] input; callers transpose from ObservationEncoder channels-first [C,H,W]"
  - "Weight transfer uses cloned ArrayBuffer per tensor for safe cross-thread postMessage"

patterns-established:
  - "PPO model builder pattern: buildPPOModel(config) -> tf.LayersModel with functional API"
  - "Config parsing pattern: parseTrainingArgs(argv?) merges CLI flags with DEFAULT_TRAINING_CONFIG"
  - "Weight serialization pattern: extractWeights/applyWeights with WeightData[] for D-17 cross-thread transfer"

requirements-completed: [TRAIN-01, TRAIN-03]

# Metrics
duration: 14min
completed: 2026-04-01
---

# Phase 20 Plan 01: TF.js + PPO Network Foundation Summary

**TF.js pure JS backend verified on Alpine/Node 24, CNN+MLP PPO network builder with dual policy/value heads, and TrainingConfig with full CLI parsing for all hyperparameters**

## Performance

- **Duration:** 14 min
- **Started:** 2026-04-01T12:08:24Z
- **Completed:** 2026-04-01T12:22:27Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Verified TF.js works on Alpine Linux + Node 24 (pure JS CPU backend; native tfjs-node fails on musl libc)
- Built CNN+MLP PPO network with configurable conv layers, shared MLP trunk, separate policy logits and value heads
- Created comprehensive TrainingConfig covering all PPO, self-play, parallelism, I/O, and environment parameters
- Implemented weight extraction/application for cross-thread model transfer (D-17)
- 31 tests passing (22 config + 9 network)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install TF.js and create training config types** - `38abab5` (feat)
2. **Task 2: Build CNN+MLP PPO network** - TDD cycle:
   - `0618d42` (test: add failing tests for PPO network builder)
   - `1a68371` (feat: implement CNN+MLP PPO network with weight transfer)

## Files Created/Modified
- `packages/bot-harness/training/training-config.ts` - TrainingConfig, NetworkConfig, SelfPlayConfig interfaces; parseTrainingArgs CLI parser; generateRunId
- `packages/bot-harness/training/training-config.test.ts` - 22 tests for config defaults, CLI parsing, run ID generation
- `packages/bot-harness/training/ppo-network.ts` - buildPPOModel, extractWeights, applyWeights, buildModelConfigFromEnv, PPOModelConfig
- `packages/bot-harness/training/ppo-network.test.ts` - 9 tests for model shape, forward pass, weight transfer, env config
- `package.json` - Added @tensorflow/tfjs dependency
- `package-lock.json` - Lock file updated

## Decisions Made
- **tfjs-node -> tfjs fallback:** `@tensorflow/tfjs-node@4.23.0-rc.0` installs but fails at runtime on Alpine Linux due to musl libc `__memcpy_chk` symbol not found in native TensorFlow C library. Switched to `@tensorflow/tfjs` (pure JS CPU backend) per plan's D-12 fallback instruction. This affects training throughput (pure JS is slower) but is functional. Workers will also use pure JS backend per D-14/D-17.
- **Channels-last convention:** Network accepts channels-last `[H, W, C]` input per tf.layers.conv2d default. ObservationEncoder outputs channels-first `[C, H, W]`, so callers must transpose. This is documented in PPOModelConfig.
- **Weight cloning:** extractWeights clones each tensor's underlying buffer (`buffer.slice(0)`) to produce independent ArrayBuffers safe for postMessage transfer.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tfjs-node native addon fails on Alpine Linux**
- **Found during:** Task 1
- **Issue:** `@tensorflow/tfjs-node@4.23.0-rc.0` installed successfully but fails at runtime with "Error relocating libtensorflow.so.2: __memcpy_chk: symbol not found" -- Alpine uses musl libc, not glibc
- **Fix:** Uninstalled tfjs-node, used `@tensorflow/tfjs` (pure JS CPU backend) as the plan instructed for this fallback scenario
- **Files modified:** package.json, package-lock.json
- **Verification:** `node -e "require('@tensorflow/tfjs')"` succeeds; all model tests pass
- **Committed in:** 38abab5

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Expected fallback per D-12. Pure JS backend is slower for training but functional. No scope creep.

## Issues Encountered
None beyond the expected tfjs-node compatibility issue.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- TrainingConfig and PPO network builder ready for Plan 02 (trajectory buffer + GAE)
- buildModelConfigFromEnv bridges BotEnvironment metadata to PPOModelConfig
- Weight transfer utilities ready for Plan 04 (worker parallelism)
- Pure JS TF.js backend may require throughput benchmarking per D-12 decision gate

## Self-Check: PASSED

All 5 created files verified present. All 3 task commits verified in git log.

---
*Phase: 20-ppo-training-with-self-play*
*Completed: 2026-04-01*
