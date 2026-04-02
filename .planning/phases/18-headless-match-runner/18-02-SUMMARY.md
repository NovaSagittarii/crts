---
phase: 18-headless-match-runner
plan: 02
subsystem: bot-harness
tags: [headless-match, ndjson, determinism, rts-room, tick-loop]

# Dependency graph
requires:
  - phase: 18-headless-match-runner/01
    provides: BotStrategy interface, MatchConfig, TickRecord types, seedToRoomId, NoOpBot, RandomBot
provides:
  - runMatch function: synchronous tick loop driving two bots against RtsRoom
  - createBotView: own-team-only fog-of-war view extraction
  - applyBotActions: queue bot decisions through RtsRoom API
  - createTickRecord: outcome + economy + determinism hash aggregation per tick
  - MatchLogger class: NDJSON file writer with header/tick/outcome lines
  - createMatchHeader, createMatchOutcomeRecord, generateRunId helper functions
affects: [18-headless-match-runner/03, ppo-training, balance-analysis]

# Tech tracking
tech-stack:
  added: []
  patterns: [headless-tick-loop, ndjson-match-logging, fog-of-war-bot-view]

key-files:
  created:
    - packages/bot-harness/match-runner.ts
    - packages/bot-harness/match-logger.ts
    - packages/bot-harness/match-runner.test.ts
    - packages/bot-harness/match-logger.test.ts
  modified:
    - packages/bot-harness/index.ts

key-decisions:
  - 'BuildOutcome from RtsRoom lacks templateId/x/y/transform fields; TickActionRecord maps from outcome.teamId + outcome.outcome only for builds'
  - 'DestroyOutcome includes structureKey and templateId, mapped directly to TickActionRecord'
  - 'Hash checkpoint at tick 0 (first tick) to establish baseline determinism anchor'

patterns-established:
  - 'Headless match pattern: RtsRoom.create -> addPlayer x2 -> tick loop with bot decisions -> outcome or draw'
  - 'NDJSON log format: header line + N tick lines + outcome line, one JSON object per line'
  - 'Fog-of-war BotView: own team data only from RoomStatePayload, no opponent structures/economy'

requirements-completed: [HARN-01, BAL-01]

# Metrics
duration: 10min
completed: 2026-04-01
---

# Phase 18 Plan 02: Match Runner & Logger Summary

**Headless match runner with deterministic tick loop and NDJSON match logger for build-order/economy/hash tracking**

## Performance

- **Duration:** 10 min
- **Started:** 2026-04-01T08:56:16Z
- **Completed:** 2026-04-01T09:06:45Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- `runMatch()` drives two bots through a complete match lifecycle using only RtsRoom API (no Socket.IO)
- NoOpBot vs NoOpBot produces isDraw=true at configurable maxTicks, same seed yields identical results
- NDJSON log files with header (seed/config/bots), per-tick (actions/economy/hash), and outcome lines
- 10+ sequential matches run in a single process without resource leaks

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement HeadlessMatchRunner with deterministic tick loop** - `5c60bc1` (test: failing), `a76b7d9` (feat: implementation)
2. **Task 2: Implement MatchLogger for NDJSON file output** - `080f5f3` (test: failing), `2756faa` (feat: implementation)

_TDD tasks have two commits each (test -> feat)_

## Files Created/Modified

- `packages/bot-harness/match-runner.ts` - runMatch, createBotView, applyBotActions, createTickRecord
- `packages/bot-harness/match-logger.ts` - MatchLogger class, createMatchHeader, createMatchOutcomeRecord, generateRunId
- `packages/bot-harness/match-runner.test.ts` - 9 tests: lifecycle, determinism, draw, callbacks, leak safety
- `packages/bot-harness/match-logger.test.ts` - 11 tests: NDJSON format, hash checkpoints, file path, JSON validity
- `packages/bot-harness/index.ts` - Added match-runner and match-logger re-exports

## Decisions Made

- BuildOutcome from RtsRoom does not carry templateId/x/y/transform fields; TickActionRecord for builds maps only teamId and outcome status. DestroyOutcome includes structureKey and templateId natively.
- Hash checkpoint fires at tick % interval === 0, including tick 0, establishing a baseline anchor for determinism verification.
- MatchResult contains only serializable data (no Grid or RoomState references) to prevent resource leaks across multiple matches.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Adapted TickActionRecord mapping to actual BuildOutcome interface**

- **Found during:** Task 1 (createTickRecord implementation)
- **Issue:** Plan assumed BuildOutcome has templateId, x, y, transform, structureKey fields, but actual interface only has eventId, teamId, outcome, reason
- **Fix:** Mapped build outcomes using available fields (teamId, outcome/reason); destroy outcomes have structureKey and templateId natively
- **Files modified:** packages/bot-harness/match-runner.ts
- **Verification:** All 9 match-runner tests pass
- **Committed in:** a76b7d9

---

**Total deviations:** 1 auto-fixed (1 bug adaptation)
**Impact on plan:** Necessary adaptation to actual RtsRoom API shape. No scope creep.

## Issues Encountered

- Pre-existing type errors in tests/integration/ and tests/web/ directories (unrelated to bot-harness) -- logged but not fixed per scope boundary rules.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all functions fully implemented with real data flows.

## Next Phase Readiness

- Match runner and logger are ready for Plan 03 (batch runner / CLI integration)
- runMatch is fully deterministic and can be called in loops for self-play training
- NDJSON logs enable post-match analysis for balance metrics

## Self-Check: PASSED

All 5 created files verified present. All 4 commit hashes verified in git log.

---

_Phase: 18-headless-match-runner_
_Completed: 2026-04-01_
