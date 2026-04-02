---
phase: 18-headless-match-runner
plan: 01
subsystem: bot-harness
tags: [bot, strategy, rts-engine, conway-core, headless]

# Dependency graph
requires: []
provides:
  - BotStrategy interface with decideTick(view, teamId) contract
  - BotView type exposing grid + own-team state (per D-02)
  - MatchConfig, MatchResult, TickRecord, MatchOutcomeRecord shared types
  - NoOpBot and RandomBot strategy implementations
  - seedToRoomId and generateSeeds utilities
  - "#bot-harness" import alias registered across package.json, tsconfig, vitest
affects: [18-02-PLAN, 18-03-PLAN, 19-ppo-observation-action, 23-playable-in-game-bot]

# Tech tracking
tech-stack:
  added: []
  patterns: [bot-strategy-interface, build-zone-constrained-placement]

key-files:
  created:
    - packages/bot-harness/bot-strategy.ts
    - packages/bot-harness/types.ts
    - packages/bot-harness/seed.ts
    - packages/bot-harness/noop-bot.ts
    - packages/bot-harness/random-bot.ts
    - packages/bot-harness/index.ts
    - packages/bot-harness/random-bot.test.ts
  modified:
    - package.json
    - tsconfig.base.json
    - vitest.config.ts

key-decisions:
  - "BotView exposes full Grid + own-team-only TeamStateView (per D-02 fog-of-war constraint)"
  - "RandomBot uses build-zone scanning around existing structures with Math.floor(buildRadius) to generate integer coordinates"

patterns-established:
  - "BotStrategy interface: decideTick(view, teamId) returns BotAction[] -- extension point for all future bots"
  - "BotView composition: construct from RtsRoom.createStatePayload() + room.state.templates.map(t.toSummary())"

requirements-completed: [HARN-01]

# Metrics
duration: 19min
completed: 2026-04-01
---

# Phase 18 Plan 01: Bot Harness Foundation Summary

**BotStrategy interface with NoOpBot and RandomBot, shared match types, and #bot-harness package alias**

## Performance

- **Duration:** 19 min
- **Started:** 2026-04-01T08:31:38Z
- **Completed:** 2026-04-01T08:50:41Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- Scaffolded packages/bot-harness with BotStrategy interface as the extension point for all future bot work
- Implemented NoOpBot (always returns empty) and RandomBot (build-zone-constrained random placement) strategies
- Registered #bot-harness import alias across package.json, tsconfig.base.json, and vitest.config.ts
- Created comprehensive test suite (11 tests) including RtsRoom integration validation

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold bot-harness package and register import alias** - `2ab73f6` (feat)
2. **Task 2: Implement NoOpBot and RandomBot strategies** - `ee6c166` (test)

## Files Created/Modified

- `packages/bot-harness/bot-strategy.ts` - BotStrategy interface, BotView, BotAction, TeamStateView types
- `packages/bot-harness/types.ts` - MatchConfig, MatchResult, TickRecord, NDJSON line types, defaults
- `packages/bot-harness/seed.ts` - seedToRoomId and generateSeeds utilities
- `packages/bot-harness/noop-bot.ts` - NoOpBot strategy (always returns empty actions)
- `packages/bot-harness/random-bot.ts` - RandomBot strategy (build-zone-constrained random placement)
- `packages/bot-harness/index.ts` - Barrel export for all bot-harness public API
- `packages/bot-harness/random-bot.test.ts` - 11 tests covering NoOpBot, RandomBot, and RtsRoom integration
- `package.json` - Added #bot-harness import alias
- `tsconfig.base.json` - Added #bot-harness path mapping
- `vitest.config.ts` - Added #bot-harness alias for test resolution

## Decisions Made

- BotView exposes full Grid + own-team-only TeamStateView (per D-02 fog-of-war constraint) -- other team state is not visible to bots
- RandomBot uses Math.floor(buildRadius) to ensure integer coordinates when scanning candidate positions, since buildRadius can be a float (e.g., 14.9)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed non-integer coordinate generation in RandomBot**

- **Found during:** Task 2 (RandomBot integration test)
- **Issue:** buildRadius is a float (14.9 for core), causing RandomBot to generate non-integer x,y coordinates which are rejected by previewBuildPlacement
- **Fix:** Applied Math.floor(buildRadius) before using it as loop bounds for candidate position scanning
- **Files modified:** packages/bot-harness/random-bot.ts
- **Verification:** All 11 tests pass including RtsRoom.previewBuildPlacement integration test
- **Committed in:** ee6c166 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Bug fix was necessary for RandomBot to produce valid placements. No scope creep.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- BotStrategy interface and both bot implementations are ready for the match runner (Plan 02)
- #bot-harness alias resolves correctly in TypeScript, vitest, and Node.js
- RandomBot produces placements that pass RtsRoom.previewBuildPlacement validation

---

_Phase: 18-headless-match-runner_
_Completed: 2026-04-01_
