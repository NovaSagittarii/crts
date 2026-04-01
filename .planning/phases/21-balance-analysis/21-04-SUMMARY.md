---
phase: 21-balance-analysis
plan: 04
subsystem: analysis
tags: [balance-analysis, ndjson, cli, generation-tracking, report-generation]

# Dependency graph
requires:
  - phase: 21-balance-analysis (plans 01-03)
    provides: "Win rate analyzer, strategy classifier, clustering, sequence miner, match log reader"
provides:
  - "Generation tracker for checkpoint-based generational analysis"
  - "Balance report assembler combining all analysis modules into single JSON"
  - "Console formatter for quick human-readable summaries"
  - "Markdown formatter for shareable reports"
  - "CLI entry point for offline balance analysis of any NDJSON match directory"
  - "Barrel exports exposing all analysis modules"
affects: [22-structure-strength, bot-harness, training-workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "PrefixSpan generation boundary discovery from checkpoint directory naming"
    - "Pipeline orchestration pattern: assembleBalanceReport calls all analysis modules"
    - "CLI pattern: node:util parseArgs with multi-format output (json/console/markdown/all)"

key-files:
  created:
    - packages/bot-harness/analysis/generation-tracker.ts
    - packages/bot-harness/analysis/generation-tracker.test.ts
    - packages/bot-harness/analysis/balance-report.ts
    - packages/bot-harness/analysis/balance-report.test.ts
    - packages/bot-harness/analysis/console-formatter.ts
    - packages/bot-harness/analysis/markdown-formatter.ts
    - packages/bot-harness/analysis/index.ts
    - bin/analyze-balance.ts
  modified:
    - packages/bot-harness/index.ts

key-decisions:
  - "Generation boundary discovery reads checkpoint-<N> directory names directly (no training module coupling)"
  - "splitMatchesByGeneration uses virtual episode = matchIndex * checkpointInterval for generation assignment"
  - "Console formatter uses plain text (no ANSI colors) for portability"
  - "CLI uses stderr for status messages and stdout for report output"

patterns-established:
  - "Analysis pipeline pattern: individual analyzers -> assembleBalanceReport -> formatters"
  - "Generational analysis decoupled from training runtime (reads checkpoint directories only)"

requirements-completed: [BAL-02, BAL-03]

# Metrics
duration: 31min
completed: 2026-04-01
---

# Phase 21 Plan 04: Analysis Pipeline & CLI Summary

**End-to-end balance analysis pipeline with generational tracking, JSON/console/markdown output, and CLI entry point for any NDJSON match directory**

## Performance

- **Duration:** 31 min
- **Started:** 2026-04-01T18:40:07Z
- **Completed:** 2026-04-01T19:11:06Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Generation tracker discovers checkpoint boundaries from directory names and splits matches into generations with strategy frequency distribution
- Balance report assembler orchestrates all analysis modules (win rates, strategy classification, clustering, sequence mining, generational tracking) into a single BalanceReport JSON
- Console formatter provides quick summary with top templates, strategy distribution, sequence patterns, and convergence detection
- Markdown formatter produces shareable report with tables for all analysis sections and cycling/convergence trend notes
- CLI entry point reads any NDJSON match directory with configurable output (json, console, markdown, all)
- All analysis fully decoupled from training runtime (no imports from training modules)

## Task Commits

Each task was committed atomically:

1. **Task 1: Generation tracker and balance report assembler** - `3ec928a` (feat, TDD)
2. **Task 2: Console/markdown formatters, barrel exports, and CLI entry point** - `1f80681` (feat)

## Files Created/Modified
- `packages/bot-harness/analysis/generation-tracker.ts` - Checkpoint boundary discovery and match-to-generation assignment
- `packages/bot-harness/analysis/generation-tracker.test.ts` - 6 tests for generation tracking
- `packages/bot-harness/analysis/balance-report.ts` - Pipeline orchestrator assembling all analysis into BalanceReport
- `packages/bot-harness/analysis/balance-report.test.ts` - 3 tests for report assembly
- `packages/bot-harness/analysis/console-formatter.ts` - Plain-text summary with top templates, strategies, sequences, trends
- `packages/bot-harness/analysis/markdown-formatter.ts` - Shareable report with tables and convergence detection
- `packages/bot-harness/analysis/index.ts` - Barrel export for all analysis modules
- `packages/bot-harness/index.ts` - Added analysis re-export
- `bin/analyze-balance.ts` - CLI entry point with parseArgs, multi-format output

## Decisions Made
- Generation boundary discovery reads checkpoint-<N> directory names directly without importing training modules, maintaining full decoupling (D-15 pitfall 7)
- splitMatchesByGeneration uses virtual episode calculation (matchIndex * checkpointInterval) to assign matches to the last generation whose episode boundary they exceed
- Console formatter avoids ANSI color codes for portability across environments
- CLI writes status messages to stderr and report output to stdout, enabling piping and redirection
- Markdown formatter includes convergence/cycling/shift detection notes in generational trends section

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TeamStandingOutcome type in test helpers**
- **Found during:** Task 1 (generation-tracker and balance-report tests)
- **Issue:** Test helpers used 'won'/'lost' string literals but TypeScript type requires 'winner'/'defeated'
- **Fix:** Changed outcome strings to match TeamStandingOutcome type ('winner' | 'defeated' | 'eliminated')
- **Files modified:** generation-tracker.test.ts, balance-report.test.ts
- **Verification:** TypeScript type checking passes for these files
- **Committed in:** 1f80681

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Minor type correction in test helpers. No scope creep.

## Issues Encountered
- Pre-existing TypeScript errors in training modules (TF.js type incompatibilities) cause `npm run lint` prelint step to fail. These are out of scope for this plan and exist in prior phase code.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Complete balance analysis pipeline ready for Phase 22 (structure strength ratings)
- CLI can be pointed at any NDJSON match directory for offline analysis
- Barrel exports provide clean API surface for consuming analysis results
- All 82 analysis tests pass, 925 total unit tests pass with no regressions

## Self-Check: PASSED

All 8 created files verified present. Both task commits (3ec928a, 1f80681) verified in git log.

---
*Phase: 21-balance-analysis*
*Completed: 2026-04-01*
