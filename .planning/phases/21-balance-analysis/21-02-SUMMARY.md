---
phase: 21-balance-analysis
plan: 02
subsystem: analysis
tags:
  [
    win-rate,
    attribution,
    wilson-score,
    presence-based,
    usage-weighted,
    first-build,
    bot-harness,
  ]

# Dependency graph
requires:
  - phase: 21-balance-analysis
    provides: analysis/types.ts (ParsedMatch, TemplateWinRate, StrategyWinRate, WinRateWithCI, AnalysisConfig), analysis/stats.ts (wilsonScoreInterval)
provides:
  - computeTemplateWinRates with three attribution methods (presence, usage-weighted, first-build)
  - computeStrategyWinRates with same three methods for strategy assignments
  - Wilson score CIs on all win rate calculations
affects: [21-03, 21-04, balance-report]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      three-attribution-method-win-rate-analysis,
      team-match-pair-accumulation,
      graceful-missing-templateId-handling,
    ]

key-files:
  created:
    - packages/bot-harness/analysis/win-rate-analyzer.ts
    - packages/bot-harness/analysis/win-rate-analyzer.test.ts
  modified: []

key-decisions:
  - 'Presence-based counts each (match, team) pair where template appears as 1 observation'
  - 'Usage-weighted weights by build count per (match, team) pair'
  - 'First-build uses presence logic on subset of first N builds per team per match'
  - 'Strategy win rates treat no-build teams as 1 observation for usage-weighted/first-build'
  - 'Unknown templates (not in defaults) dynamically added with id as name'

patterns-established:
  - 'Three-method accumulator pattern: presenceWins/Total, usageWins/Total, firstBuildWins/Total per entity'
  - 'Team-match pair iteration: extract builds by team, compute win credit per team, accumulate per template/strategy'

requirements-completed: [BAL-02]

# Metrics
duration: 8min
completed: 2026-04-01
---

# Phase 21 Plan 02: Win Rate Analysis Summary

**Win rate analyzer with three attribution methods (presence-based, usage-weighted, first-build) for per-template and per-strategy breakdowns with Wilson score confidence intervals**

## Performance

- **Duration:** 8 min
- **Started:** 2026-04-01T18:21:50Z
- **Completed:** 2026-04-01T18:30:09Z
- **Tasks:** 1 (TDD: test + feat commits)
- **Files modified:** 2

## Accomplishments

- Implemented computeTemplateWinRates with three attribution methods giving complementary views: presence for broad trends, usage-weighted for spam-to-win detection, first-build for opening meta analysis
- Implemented computeStrategyWinRates applying the same three methods to strategy assignments
- All win rates include Wilson score confidence intervals for statistical rigor
- Draws correctly treated as 0.5 wins, missing templateId gracefully skipped, rejected builds excluded
- 15 tests passing covering all three methods, edge cases, and strategy analysis

## Task Commits

Each task was committed atomically (TDD: test then feat):

1. **Task 1 (RED): Add failing tests for win rate analyzer** - `2388110` (test)
2. **Task 1 (GREEN): Implement win rate analyzer with three attribution methods** - `fd1f35a` (feat)

## Files Created/Modified

- `packages/bot-harness/analysis/win-rate-analyzer.ts` - computeTemplateWinRates and computeStrategyWinRates with three attribution methods and Wilson score CIs
- `packages/bot-harness/analysis/win-rate-analyzer.test.ts` - 15 tests: presence-based (4), usage-weighted (2), first-build (2), per-strategy (3), edge cases (4)

## Decisions Made

- Presence-based counts each (match, team) pair where template appears as 1 observation, regardless of build count
- Usage-weighted weights by build count: building block 3 times in a win contributes 3.0 wins and 3 total
- First-build applies presence logic on the subset of first N builds (configurable via config.firstNBuilds)
- For strategy win rates with teams that had no builds, usage-weighted/first-build fall back to 1 observation (preserving the strategy presence signal)
- Unknown template IDs dynamically tracked with id used as display name

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all implementations are complete with no placeholder data.

## Next Phase Readiness

- win-rate-analyzer.ts exports are ready for 21-04 (report generation) to aggregate into BalanceReport
- Three attribution methods provide the three perspectives needed by the balance report
- Strategy win rates ready for 21-03 (clustering) to feed strategy assignments into

## Self-Check: PASSED

All 2 files verified present. Both task commit hashes (2388110, fd1f35a) found in git log.

---

_Phase: 21-balance-analysis_
_Completed: 2026-04-01_
