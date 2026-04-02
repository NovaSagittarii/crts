---
phase: 22-structure-strength-ratings
plan: 02
subsystem: analysis
tags:
  [
    glicko-2,
    rating-pool,
    combination-mining,
    outlier-detection,
    balance-analysis,
  ]

# Dependency graph
requires:
  - phase: 22-structure-strength-ratings (plan 01)
    provides: Glicko-2 engine (updateRating), encounter extractor, stats functions, types
provides:
  - RatingPool class with batch Glicko-2 updates and game-phase separation
  - createRatingPools factory for standard 5-pool or 9-pool configurations
  - minePairwiseCombinations for 2-template pair discovery from match data
  - mineFrequentSets for k-template set discovery with min-support filtering
  - detectOutliers for statistical deviation and usage-matrix outlier classification
affects:
  [22-structure-strength-ratings plan 03, balance-report, CLI integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      batch-update-with-snapshot,
      brute-force-enumeration-for-small-vocabulary,
      dual-method-outlier-detection,
    ]

key-files:
  created:
    - packages/bot-harness/analysis/rating-pool.ts
    - packages/bot-harness/analysis/rating-pool.test.ts
    - packages/bot-harness/analysis/combination-miner.ts
    - packages/bot-harness/analysis/combination-miner.test.ts
    - packages/bot-harness/analysis/outlier-detector.ts
    - packages/bot-harness/analysis/outlier-detector.test.ts
  modified: []

key-decisions:
  - 'Batch update snapshots all entity ratings before update loop to prevent cross-entity contamination'
  - 'Direct enumeration (brute-force) for frequent-set mining since vocabulary is only 5 templates (31 subsets max)'
  - 'Usage-matrix outlier detection uses median rather than mean for rating/pickRate thresholds'

patterns-established:
  - 'Rating pool pattern: pool encapsulates entity registration, encounter collection, batch update cycle'
  - "Canonical pair/set IDs: alphabetically sorted members joined with '+' (e.g. block+glider)"
  - 'Dual-method outlier detection with additive flags per entity'

requirements-completed: [BAL-04]

# Metrics
duration: 13min
completed: 2026-04-01
---

# Phase 22 Plan 02: Rating Pool, Combination Mining, and Outlier Detection Summary

**Rating pool management with batch Glicko-2 updates, pairwise/frequent-set combination mining, and dual-method outlier detection (statistical deviation + usage-matrix)**

## Performance

- **Duration:** 13 min
- **Started:** 2026-04-01T20:15:38Z
- **Completed:** 2026-04-01T20:28:40Z
- **Tasks:** 2
- **Files created:** 6

## Accomplishments

- RatingPool class managing entity ratings with batch Glicko-2 updates using pre-update snapshots for opponent lookups (no cross-entity contamination)
- Game-phase pool factory creating 5 pools (3 individual phases + 2 combo full) or 9 pools (with perPhaseCombos) per D-02/D-09
- Pairwise combination mining discovering all 2-template pairs with canonical alphabetically-sorted IDs per D-06
- Frequent-set mining discovering k-template sets (k=2..4) meeting configurable min-support threshold per D-07
- Outlier detection via statistical deviation (>2 SD from mean, D-10a) and rating+usage matrix (dominant/niche-strong/trap, D-10b) with additive flags per D-12
- 21 tests passing across 3 test files

## Task Commits

Each task was committed atomically:

1. **Task 1: Rating pool management with game-phase separation** - `b6a97b3` (feat)
2. **Task 2: Combination miner and outlier detector** - `f5bc565` (feat)

## Files Created/Modified

- `packages/bot-harness/analysis/rating-pool.ts` - RatingPool class and createRatingPools factory
- `packages/bot-harness/analysis/rating-pool.test.ts` - Pool construction, batch update, game-phase separation tests (8 tests)
- `packages/bot-harness/analysis/combination-miner.ts` - minePairwiseCombinations and mineFrequentSets functions
- `packages/bot-harness/analysis/combination-miner.test.ts` - Pairwise discovery, naming, tick filtering, frequent-set tests (6 tests)
- `packages/bot-harness/analysis/outlier-detector.ts` - detectOutliers function with dual-method detection
- `packages/bot-harness/analysis/outlier-detector.test.ts` - Statistical outlier, usage-matrix, provisional exclusion, multi-flag tests (7 tests)

## Decisions Made

- Batch update snapshots all entity ratings before the update loop to prevent cross-entity contamination within a rating period (per Glicko-2 batch semantics and research anti-pattern guidance)
- Direct enumeration (brute-force) chosen for frequent-set mining since the vocabulary is only 5 templates, yielding at most 31 possible subsets
- Usage-matrix outlier detection uses median of non-provisional entity ratings/pickRates as thresholds for dominant/niche-strong/trap categorization

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Test data for statistical outlier tests (Tests 7, 8, 13) initially used too few entities (4), causing the outlier itself to inflate the mean and SD so much that it could not exceed 2 SD. Fixed by using 10 entities (9 at baseline + 1 outlier) so the outlier's influence on the population statistics was reduced.

## Known Stubs

None - all functions are fully implemented with real logic.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Rating pool, combination mining, and outlier detection are complete and ready for Plan 03 integration
- Plan 03 will wire these modules into the balance report assembler and CLI subcommands
- All exported functions match the interfaces specified in the plan

## Self-Check: PASSED

- All 7 created files exist on disk
- Both task commits (b6a97b3, f5bc565) found in git log
- 21 tests passing across 3 test files
- Lint clean on all plan files

---

_Phase: 22-structure-strength-ratings_
_Completed: 2026-04-01_
