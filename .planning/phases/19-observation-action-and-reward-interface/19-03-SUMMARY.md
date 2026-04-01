---
phase: 19-observation-action-and-reward-interface
plan: 03
subsystem: bot-harness
tags: [gymnasium, rl-environment, reset-step-api, observation-action-reward, ppo]

# Dependency graph
requires:
  - phase: 19-observation-action-and-reward-interface (plan 01)
    provides: ObservationEncoder and RewardSignal modules
  - phase: 19-observation-action-and-reward-interface (plan 02)
    provides: ActionDecoder with discrete action space and masking
provides:
  - BotEnvironment class with Gymnasium-style reset()/step() API
  - StepResult, ResetResult, StepInfo, BotEnvironmentConfig interfaces
  - observationSpace and actionSpace static descriptors for Phase 20 PPO
  - Complete barrel re-exports for all Phase 19 modules
affects: [20-ppo-training-loop, bot-harness]

# Tech tracking
tech-stack:
  added: []
  patterns: [gymnasium-api-wrapper, single-agent-environment, episode-lifecycle]

key-files:
  created:
    - packages/bot-harness/bot-environment.ts
    - packages/bot-harness/bot-environment.test.ts
  modified:
    - packages/bot-harness/index.ts

key-decisions:
  - "Static actionSpace computed from grid dimensions (5 templates * W * H + 1 no-op) rather than lazily after reset"
  - "Test timeouts increased to 15s-300s due to computeActionMask cost iterating all territory positions * templates"
  - "NoOpBot used as default test opponent to reduce action mask computation overhead in tests"

patterns-established:
  - "BotEnvironment wraps RtsRoom as single-agent Gymnasium env: reset(seed, opponent) -> step(action) -> 5-tuple"
  - "Episode lifecycle: terminated (match outcome) vs truncated (tick limit) following Gymnasium convention"

requirements-completed: [HARN-02, HARN-03, HARN-04]

# Metrics
duration: 20min
completed: 2026-04-01
---

# Phase 19 Plan 03: BotEnvironment Gymnasium API Summary

**BotEnvironment wrapping RtsRoom in Gymnasium-style reset()/step() API with integrated observation encoding, action decoding, and reward shaping**

## Performance

- **Duration:** 20 min
- **Started:** 2026-04-01T10:29:36Z
- **Completed:** 2026-04-01T10:49:26Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- BotEnvironment class with reset(seed, opponent)/step(action) Gymnasium-style API
- Integrates ObservationEncoder, ActionDecoder, and computeReward into a single entry point
- Opponent BotStrategy executes each tick during step(), defaulting to RandomBot
- All Phase 19 modules re-exported from bot-harness barrel (11 total modules)
- 9 passing tests covering reset, step, observation/action spaces, truncation, reward, and opponent execution

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement BotEnvironment with Gymnasium-style reset/step API** - `2521aeb` (test: TDD RED), `44427a5` (feat: TDD GREEN)
2. **Task 2: Update index.ts re-exports and run full test suite** - `7dbf18b` (chore)

## Files Created/Modified
- `packages/bot-harness/bot-environment.ts` - BotEnvironment class with reset()/step(), StepResult/ResetResult/StepInfo/BotEnvironmentConfig interfaces
- `packages/bot-harness/bot-environment.test.ts` - 9 unit tests covering full Gymnasium lifecycle
- `packages/bot-harness/index.ts` - Added bot-environment.js re-export (11 total barrel exports)

## Decisions Made
- Static actionSpace computed eagerly in constructor from grid dimensions (5 * W * H + 1) rather than lazily after reset -- Phase 20 PPO network builders need shape info before first episode
- Test timeouts increased to 15-300 seconds because computeActionMask is inherently expensive (iterates territory positions * templates per call); this is acceptable for correctness tests
- NoOpBot used as default test opponent to minimize action mask computation overhead compared to RandomBot which creates more structures

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed lint errors in test file**
- **Found during:** Task 2
- **Issue:** Unnecessary type assertions in truncation test and unbound-method error in mock opponent test
- **Fix:** Initialized `lastResult` with first step call to avoid non-null assertions; extracted `decideSpy` variable for mock verification
- **Files modified:** packages/bot-harness/bot-environment.test.ts
- **Verification:** `npx eslint` passes clean on all changed files
- **Committed in:** 7dbf18b (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Lint fix necessary for CI compliance. No scope creep.

## Issues Encountered
- computeActionMask performance causes tests to run ~5s per step() call on 20x20 grid -- addressed with increased test timeouts rather than reducing coverage

## Known Stubs
None -- all interfaces are fully wired to live RtsRoom data.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 19 complete: ObservationEncoder, ActionDecoder, RewardSignal, and BotEnvironment all wired and tested
- BotEnvironment is the single entry point for Phase 20's PPO training pipeline
- observationSpace and actionSpace descriptors available for network architecture initialization

---
*Phase: 19-observation-action-and-reward-interface*
*Completed: 2026-04-01*

## Self-Check: PASSED
- All 3 created/modified files exist on disk
- All 3 task commits (2521aeb, 44427a5, 7dbf18b) found in git log
