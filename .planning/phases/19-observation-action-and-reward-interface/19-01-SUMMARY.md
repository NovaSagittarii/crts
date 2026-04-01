---
phase: 19-observation-action-and-reward-interface
plan: 01
subsystem: bot-harness
tags: [observation-encoder, reward-signal, float32array, channel-first, annealing, rl]

# Dependency graph
requires:
  - phase: 18-headless-match-runner
    provides: BotStrategy interface, RtsRoom headless execution, bot-harness package structure
provides:
  - ObservationEncoder class producing 5-channel feature planes + 7 scalar features
  - computeReward pure function with terminal, shaped, and annealed rewards
  - RewardConfig and RewardStateSnapshot types for training pipeline configuration
affects: [19-03-bot-environment, 20-ppo-training-loop]

# Tech tracking
tech-stack:
  added: []
  patterns: [channel-first Float32Array encoding, linear reward annealing, pure reward function]

key-files:
  created:
    - packages/bot-harness/observation-encoder.ts
    - packages/bot-harness/observation-encoder.test.ts
    - packages/bot-harness/reward-signal.ts
    - packages/bot-harness/reward-signal.test.ts
  modified:
    - packages/bot-harness/index.ts

key-decisions:
  - "Use createStatePayload() for both own and enemy team data to ensure observation completeness"
  - "Read territoryRadius directly from RoomState.teams since TeamPayload does not expose it"
  - "Pure function design for computeReward -- annealing state passed in externally, no hidden state"

patterns-established:
  - "Channel-first feature plane encoding: index = c * H * W + y * W + x"
  - "Scalar normalization: Math.min(value / maxValue, 1.0) for all 7 features"
  - "Linear annealing formula: shapedWeight = Math.max(0, 1.0 - episodeNumber / annealEpisodes)"

requirements-completed: [HARN-02, HARN-04]

# Metrics
duration: 12min
completed: 2026-04-01
---

# Phase 19 Plan 01: Observation and Reward Interface Summary

**ObservationEncoder produces deterministic 5-channel feature planes (alive cells, own/enemy structures, territory, core) and 7 clamped scalars; computeReward delivers shaped terminal/economy/core-damage rewards with linear annealing**

## Performance

- **Duration:** 12 min
- **Started:** 2026-04-01T10:13:38Z
- **Completed:** 2026-04-01T10:25:12Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- ObservationEncoder encodes RtsRoom state into 5 channel-first Float32Array feature planes and 7 normalized scalar features, fully deterministic for identical inputs
- computeReward implements terminal (+1/-1/0), shaped (economy delta + core damage), and linearly annealed reward signals as a pure function with configurable per-component weights
- 21 passing tests covering shape validation, channel content, scalar normalization, determinism, terminal/shaped/annealed rewards, and custom weights

## Task Commits

Each task was committed atomically:

1. **Task 1: ObservationEncoder (TDD RED)** - `6e7b8a7` (test)
2. **Task 1: ObservationEncoder (TDD GREEN)** - `40156b3` (feat)
3. **Task 2: RewardSignal (TDD RED)** - `3567020` (test)
4. **Task 2: RewardSignal (TDD GREEN)** - `368cd61` (feat)
5. **Index exports** - `552d112` (chore)

## Files Created/Modified
- `packages/bot-harness/observation-encoder.ts` - ObservationEncoder class with encode() producing 5 feature planes + 7 scalars
- `packages/bot-harness/observation-encoder.test.ts` - 11 tests: shape, alive cells, structure footprints, core position, scalar normalization, clamping, determinism
- `packages/bot-harness/reward-signal.ts` - computeReward pure function, RewardConfig, RewardStateSnapshot, DEFAULT_REWARD_CONFIG
- `packages/bot-harness/reward-signal.test.ts` - 10 tests: terminal win/loss/draw, economy delta, core damage, annealing at 0/half/full, custom weights, no-change tick
- `packages/bot-harness/index.ts` - Added barrel exports for observation-encoder and reward-signal modules

## Decisions Made
- Used `room.createStatePayload()` for both own and enemy team data rather than BotView (which only exposes own team), ensuring the observation encoder can see enemy structures for plane 2
- Read `territoryRadius` directly from `room.state.teams.get(teamId)` since `TeamPayload` does not expose this field
- Kept computeReward as a pure function with no internal state -- episodeNumber passed in by caller (BotEnvironment or training loop)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed grid size too small for room setup**
- **Found during:** Task 1 (ObservationEncoder tests)
- **Issue:** Plan suggested 10x10 grid but base footprint spawn requires minimum ~26x26 (SPAWN_MIN_WRAPPED_DISTANCE=25 + core 5x5)
- **Fix:** Changed test grid to 52x52 (default game size)
- **Files modified:** packages/bot-harness/observation-encoder.test.ts
- **Verification:** All tests pass with 52x52 grid
- **Committed in:** 40156b3 (part of Task 1 GREEN commit)

**2. [Rule 1 - Bug] Fixed Grid.set() -> Grid.setCell() method name**
- **Found during:** Task 1 (ObservationEncoder tests)
- **Issue:** Tests used `grid.set()` but the actual Grid API method is `grid.setCell()`
- **Fix:** Updated test calls to use `setCell(x, y, alive)` 
- **Files modified:** packages/bot-harness/observation-encoder.test.ts
- **Verification:** Tests compile and pass correctly
- **Committed in:** 40156b3 (part of Task 1 GREEN commit)

**3. [Rule 1 - Bug] Fixed alive cells test for fresh room with core structures**
- **Found during:** Task 1 (ObservationEncoder tests)
- **Issue:** Plan assumed fresh room has no alive cells, but core structure setup writes alive cells to the grid
- **Fix:** Changed test to verify plane 0 matches the actual grid state exactly (comparing isCellAlive vs plane values) instead of expecting all zeros
- **Files modified:** packages/bot-harness/observation-encoder.test.ts
- **Verification:** Test correctly validates plane 0 reflects grid state
- **Committed in:** 40156b3 (part of Task 1 GREEN commit)

---

**Total deviations:** 3 auto-fixed (3 bugs in test setup)
**Impact on plan:** All auto-fixes were necessary to handle actual API behavior. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ObservationEncoder and RewardSignal are ready for consumption by BotEnvironment (Plan 19-03)
- Both modules are exported from the bot-harness package index
- No blockers for the next plan

## Self-Check: PASSED

All 6 files verified present. All 5 commits verified in git log.

---
*Phase: 19-observation-action-and-reward-interface*
*Completed: 2026-04-01*
