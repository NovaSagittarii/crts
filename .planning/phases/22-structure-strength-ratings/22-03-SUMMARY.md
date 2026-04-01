---
phase: 22-structure-strength-ratings
plan: 03
subsystem: analysis
tags: [glicko2, worker-threads, cli, balance-report, ratings, outlier-detection]

# Dependency graph
requires:
  - phase: 22-01
    provides: Glicko-2 engine, encounter extractor, rating pool, types
  - phase: 22-02
    provides: combination miner, outlier detector
  - phase: 21
    provides: balance report, console/markdown formatters, CLI, analysis types
provides:
  - Rating worker thread for parallel Glicko-2 pool computation
  - Rating coordinator with sequential and parallel computation modes
  - Extended assembleBalanceReport with optional Glicko-2 ratings
  - assembleRatingsReport standalone function for ratings-only CLI
  - Console formatter with tier list and outlier sections
  - Markdown formatter with rating tables, pairwise combos, frequent sets, outliers
  - CLI subcommands (ratings, report, all) with rating-specific flags
  - Barrel exports for all Phase 22 analysis modules
affects: [23-bot-socket-adapter, balance-analysis, cli]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - Worker thread pool computation via _worker-shim.mjs pattern (matches Phase 20)
    - Concurrency-limited parallel dispatch for CPU-bound rating pools
    - CLI subcommand routing via parseArgs with allowPositionals

key-files:
  created:
    - packages/bot-harness/analysis/rating-worker.ts
    - packages/bot-harness/analysis/rating-coordinator.ts
    - packages/bot-harness/analysis/rating-coordinator.test.ts
    - packages/bot-harness/analysis/_worker-shim.mjs
  modified:
    - packages/bot-harness/analysis/balance-report.ts
    - packages/bot-harness/analysis/balance-report.test.ts
    - packages/bot-harness/analysis/console-formatter.ts
    - packages/bot-harness/analysis/markdown-formatter.ts
    - packages/bot-harness/analysis/index.ts
    - bin/analyze-balance.ts

key-decisions:
  - "computeRatingsSequential returns Promise.resolve() instead of async to avoid require-await lint"
  - "Worker threads spawn per-pool with one worker per pool for simplicity (no intra-pool D-05b)"
  - "_worker-shim.mjs copied to analysis/ dir matching training/ pattern for locality"
  - "CLI subcommand routing uses strict:false with allowPositionals for backward compatibility"
  - "Outlier detection runs in main thread after all workers complete (needs full result set for SD)"

patterns-established:
  - "Rating pipeline: matches -> encounters -> pools -> batch update -> outlier detection -> report"
  - "CLI subcommand routing: positionals[0] determines mode, undefined = backward compatible default"

requirements-completed: [BAL-04, BAL-05]

# Metrics
duration: 31min
completed: 2026-04-01
---

# Phase 22 Plan 03: Rating Pipeline Integration Summary

**Worker-parallelized Glicko-2 rating pipeline with CLI subcommands, extended formatters, and full balance report integration**

## Performance

- **Duration:** 31 min
- **Started:** 2026-04-01T20:32:14Z
- **Completed:** 2026-04-01T21:02:50Z
- **Tasks:** 2
- **Files modified:** 11

## Accomplishments
- Complete Glicko-2 rating pipeline from match data through formatted reports
- Worker thread parallelism for multi-pool computation (matching Phase 20 pattern)
- CLI subcommands (ratings, report, all) with 8 new flags for rating configuration
- Console and markdown formatters extended with tier lists, combination ratings, and outlier sections
- Backward compatible: existing CLI invocation without subcommand works identically

## Task Commits

Each task was committed atomically:

1. **Task 1: Worker thread parallelism and rating coordinator** - `587292d` (test: RED), `32cca7a` (feat: GREEN)
2. **Task 2: Balance report assembly, CLI subcommands, and formatter extensions** - `33f1a36` (feat)

## Files Created/Modified
- `packages/bot-harness/analysis/rating-worker.ts` - Worker thread entry point for parallel Glicko-2 pool computation
- `packages/bot-harness/analysis/rating-coordinator.ts` - Coordinates sequential/parallel pool computation, builds encounters, runs outlier detection
- `packages/bot-harness/analysis/rating-coordinator.test.ts` - Tests for sequential computation, rating accuracy, parallel equivalence, combination pools, outlier integration
- `packages/bot-harness/analysis/_worker-shim.mjs` - tsx TypeScript loading shim for worker threads
- `packages/bot-harness/analysis/balance-report.ts` - Extended with ratingsOptions in AssembleOptions, new assembleRatingsReport export
- `packages/bot-harness/analysis/balance-report.test.ts` - Added tests for ratings integration and assembleRatingsReport
- `packages/bot-harness/analysis/console-formatter.ts` - Added tier list and balance outlier sections
- `packages/bot-harness/analysis/markdown-formatter.ts` - Added rating tables, pairwise combination ratings, frequent set ratings, and outlier tables
- `packages/bot-harness/analysis/index.ts` - Added exports for glicko2-engine, encounter-extractor, rating-pool, combination-miner, outlier-detector, rating-coordinator
- `bin/analyze-balance.ts` - Added ratings/report/all subcommands with --early-end, --mid-end, --tau, --min-support, --max-set-size, --per-phase-combos, --workers, --sd-threshold flags

## Decisions Made
- Worker threads spawn one worker per pool rather than implementing intra-pool parallelism (D-05b). With only 5-9 pools the overhead of finer granularity is not justified.
- `computeRatingsSequential` uses `Promise.resolve()` wrapper instead of `async` to satisfy `@typescript-eslint/require-await` lint rule while maintaining the Promise return type for API consistency.
- Copied `_worker-shim.mjs` to analysis/ directory rather than importing from training/ to maintain locality (same as Phase 20 pattern where each subsystem has its own shim).
- Parallel mode falls back to sequential when pool count <= 2 or workers=1 (overhead not justified).
- CLI uses `strict: false` with `allowPositionals: true` in parseArgs to support both subcommand and no-subcommand invocations without breaking backward compatibility.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- Pre-existing `MatchResult` barrel export collision (TS2308) in `packages/bot-harness/index.ts` -- both `./types.js` and `./analysis/types.js` export `MatchResult`. This existed since Phase 22-01 added `MatchResult` to analysis types. Out of scope for this plan; does not affect runtime behavior.
- Pre-existing TF.js type errors in training/ modules (SharedArrayBuffer, NamedTensor) -- unrelated to Phase 22 changes.
- Pre-existing bot-environment.test.ts timeout failures on CI -- slow test environment, not related to analysis changes.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 22 is complete: all three plans (Glicko-2 engine, combination/outlier detection, rating pipeline integration) delivered
- BAL-04 (Glicko-2 ratings) and BAL-05 (balance report CLI) requirements fulfilled
- 127 analysis tests passing across 14 test files
- Ready for Phase 23 (bot socket adapter) or milestone completion

## Self-Check: PASSED

All 10 created/modified files verified on disk. All 3 task commits verified in git history.

---
*Phase: 22-structure-strength-ratings*
*Completed: 2026-04-01*
