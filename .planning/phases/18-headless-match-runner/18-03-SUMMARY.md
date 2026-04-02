---
phase: 18-headless-match-runner
plan: 03
subsystem: testing
tags: [cli, ndjson, determinism, headless, bot-harness, parseArgs]

# Dependency graph
requires:
  - phase: 18-01
    provides: match-runner, seed utilities, bot strategies, types
  - phase: 18-02
    provides: MatchLogger, NDJSON serialization, createMatchHeader, createMatchOutcomeRecord
provides:
  - CLI entry point for running headless matches (bin/run-matches.ts)
  - Determinism integration test (same-seed bitwise-identical output)
  - End-to-end NDJSON pipeline test (runMatch -> MatchLogger -> valid file)
  - Resource management test (20 sequential matches without leak)
affects: [19-ppo-training, 20-balance-analysis]

# Tech tracking
tech-stack:
  added: [node:util/parseArgs]
  patterns: [CLI-via-tsx, sequential-match-loop, async-IIFE-entrypoint]

key-files:
  created:
    - bin/run-matches.ts
  modified:
    - packages/bot-harness/match-runner.test.ts
    - tsconfig.json
    - eslint.config.mjs

key-decisions:
  - 'Used node:util parseArgs for zero-dependency CLI argument parsing'
  - 'Added bin/ to tsconfig.json include and eslint node globals for full type-checking coverage'

patterns-established:
  - 'CLI entry points live in bin/ directory, run via npx tsx'
  - 'Long-running bot-harness tests use explicit vitest timeout (30s)'

requirements-completed: [HARN-01, BAL-01]

# Metrics
duration: 22min
completed: 2026-04-01
---

# Phase 18 Plan 03: CLI Entry Point & Determinism Tests Summary

**CLI entry point for headless match runner with parseArgs flags plus determinism/e2e/resource-leak integration tests**

## Performance

- **Duration:** 22 min
- **Started:** 2026-04-01T09:11:33Z
- **Completed:** 2026-04-01T09:33:30Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- CLI entry point (`bin/run-matches.ts`) runs headless matches via `npx tsx bin/run-matches.ts` with 7 flags: --count, --seed, --max-ticks, --output-dir, --grid-size, --dry-run, --help
- Determinism test verifies same seed produces bitwise-identical tick records and hashes across runs
- End-to-end pipeline test validates full flow: runMatch -> MatchLogger.writeMatch -> NDJSON file with valid header/tick/outcome lines
- Resource management test confirms 20 sequential matches run without throwing (no resource leak)
- Sequential seed control verified: --seed 42 --count 3 produces seeds 42, 43, 44

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement CLI entry point for headless match runner** - `27c8894` (feat)
2. **Task 2: Add determinism and end-to-end integration tests** - `f4b81b6` (test)
3. **Fix: Add timeout to long-running bot-harness tests** - `528149c` (fix)

## Files Created/Modified

- `bin/run-matches.ts` - CLI entry point using node:util parseArgs with all 7 flags
- `packages/bot-harness/match-runner.test.ts` - Added 6 new tests: determinism (2), resource management (1), e2e pipeline (2), RandomBot completion (1)
- `tsconfig.json` - Added `bin/**/*` to include array for type-checking
- `eslint.config.mjs` - Added `bin/**/*.{ts,tsx}` to node globals section

## Decisions Made

- Used `node:util` `parseArgs` for CLI argument parsing (zero external dependencies, per research recommendation)
- Added `bin/` directory to tsconfig.json and eslint.config.mjs to ensure full type-checking and linting coverage on CLI files
- RandomBot vs RandomBot is the default matchup for CLI runs

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added explicit timeout to long-running bot-harness tests**

- **Found during:** Task 2 (integration tests)
- **Issue:** The 20-sequential-matches test and RandomBot-vs-RandomBot test exceeded the default 5000ms vitest timeout when running in parallel via `test:fast`
- **Fix:** Added `{ timeout: 30_000 }` to both test cases
- **Files modified:** packages/bot-harness/match-runner.test.ts
- **Verification:** `npm run test:fast` passes all 182 tests across 32 test files
- **Committed in:** `528149c`

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Test timeout fix necessary for correctness in CI/parallel test runs. No scope creep.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Known Stubs

None - all functionality is fully wired.

## Next Phase Readiness

- Phase 18 (headless-match-runner) is complete: match runner, logger, and CLI are all delivered
- Ready for Phase 19 (PPO training loop) which will use `runMatch` and `MatchLogger` for training data generation
- CLI can be used immediately for manual balance testing: `npx tsx bin/run-matches.ts --count 100 --seed 1 --max-ticks 2000`

---

## Self-Check: PASSED

All 5 files verified present. All 3 commit hashes verified in git log.

---

_Phase: 18-headless-match-runner_
_Completed: 2026-04-01_
