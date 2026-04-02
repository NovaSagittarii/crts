---
phase: 22-structure-strength-ratings
verified: 2026-04-01T21:15:26Z
status: gaps_found
score: 14/15 must-haves verified
gaps:
  - truth: "Lint clean: all phase 22 files pass TypeScript type-checking"
    status: failed
    reason: "Phase 22-01 added MatchResult to analysis/types.ts, creating a re-export collision with the top-level packages/bot-harness/index.ts which already re-exports MatchResult from ./types.js. The barrel export at line 13 of packages/bot-harness/index.ts triggers TS2308."
    artifacts:
      - path: "packages/bot-harness/index.ts"
        issue: "Line 13: `export * from './analysis/index.js'` clashes with `export * from './types.js'` (both export MatchResult). TS2308: Module has already exported a member named 'MatchResult'."
      - path: "packages/bot-harness/analysis/types.ts"
        issue: "Introduced MatchResult interface in Phase 22-01 without resolving barrel collision with packages/bot-harness/types.ts MatchResult."
    missing:
      - "Rename MatchResult in packages/bot-harness/analysis/types.ts to Glicko2MatchResult (or similar), or use an explicit named re-export in packages/bot-harness/index.ts to resolve the TS2308 ambiguity."
human_verification:
  - test: "Run `tsx bin/analyze-balance.ts ratings --match-dir <dir>` against a real match directory"
    expected: "Outputs tier list of rated templates with Glicko-2 ratings in console format"
    why_human: "No match data available in the test environment; behavioral validation of the full CLI pipeline requires real match files."
  - test: "Run `tsx bin/analyze-balance.ts all --match-dir <dir> --output balance-report`"
    expected: "Produces balance-report.json, balance-report.md, and console output including Structure Ratings and Balance Outliers sections"
    why_human: "Multi-file output requires real match data and filesystem validation of all three output formats."
---

# Phase 22: Structure Strength Ratings Verification Report

**Phase Goal:** Individual structure templates and template combinations have quantified strength ratings derived from match outcomes, with a CLI report summarizing the competitive meta
**Verified:** 2026-04-01T21:15:26Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1  | Glicko-2 updateRating produces correct rating, RD, and volatility values matching Glickman's paper example | VERIFIED | Test "matches Glickman paper example (Section 4)" passes; result.rating toBeCloseTo(1464.06, 0), glicko2-engine.test.ts:37 |
| 2  | Match-to-encounter extraction generates cross-product template encounters weighted by log(1 + buildCount) | VERIFIED | encounter-extractor.ts lines 121-131 implement cross-product with Math.log(1 + countA/B); 9 tests pass |
| 3  | Encounters can be filtered by tick range for game-phase separation | VERIFIED | countBuildsByTeam() at encounter-extractor.ts:46-50 filters by tickRange; tick-range test passes |
| 4  | Entities with no matches in a period have RD increase but rating unchanged | VERIFIED | glicko2-engine.ts:99-106 handles empty matches; no-match test passes |
| 5  | Rating pool computes Glicko-2 ratings for all entities in a pool using batch update semantics | VERIFIED | RatingPool.runUpdate() takes pre-update snapshot (lines 91-145); batch semantics test passes |
| 6  | Per-game-phase pools produce independent tier lists for early, mid, and late game | VERIFIED | createRatingPools() creates 5 pools (3 individual phases); Test 4 and 5 pass |
| 7  | Pairwise combination mining discovers all 2-template pairs that co-occur in matches | VERIFIED | minePairwiseCombinations() with kSubsets; canonical alphabetical sorting (block+glider); 6 tests pass |
| 8  | Frequent-set mining discovers 3+ template sets meeting min-support threshold | VERIFIED | mineFrequentSets() with brute-force k-subset enumeration; minSupport=5 test passes |
| 9  | Outlier detection flags templates as statistical-outlier-high/low, dominant, niche-strong, or trap | VERIFIED | detectOutliers() applies both Method A (SD) and Method B (usage matrix); 7 tests pass including multi-flag |
| 10 | Entities with RD > 150 are marked provisional | VERIFIED | getRatedEntities() sets provisional: rating.rd > 150 (line 165); provisional test passes |
| 11 | Worker threads compute rating pools in parallel across game phases | VERIFIED | computeRatingsParallel() spawns Worker via _worker-shim.mjs; parallel==sequential test passes (18s) |
| 12 | assembleBalanceReport includes Glicko-2 ratings, combinations, and outliers in the output | VERIFIED | balance-report.ts lines 162-167 call computeRatingsParallel/Sequential when ratingsOptions provided; 2 tests pass |
| 13 | CLI subcommands ratings/report/all are operational with per-subcommand routing | VERIFIED | bin/analyze-balance.ts:49 captures subcommand; routing at lines 157, 193, 239; all flags present |
| 14 | Console and markdown formatters include tier lists, outlier sections, and pairwise/frequent-set tables | VERIFIED | console-formatter.ts sections 6+7 (Structure Ratings, Balance Outliers); markdown-formatter.ts Structure Ratings, Pairwise Combination Ratings, Balance Outliers sections |
| 15 | Lint clean: all phase 22 analysis files pass TypeScript type-checking | FAILED | TS2308 at packages/bot-harness/index.ts:13 — MatchResult re-export collision introduced in Phase 22-01 |

**Score:** 14/15 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/bot-harness/analysis/types.ts` | Glicko2Rating, TemplateEncounter, RatedEntity, RatingsReport types | VERIFIED | All types present; BalanceReport extended with optional ratings field (line 111) |
| `packages/bot-harness/analysis/glicko2-engine.ts` | updateRating pure function, GLICKO2_DEFAULTS | VERIFIED | 196 lines; exports updateRating and GLICKO2_DEFAULTS with all 6 hyperparameters |
| `packages/bot-harness/analysis/glicko2-engine.test.ts` | Min 80 lines; Glickman paper example, no-match case | VERIFIED | 136 lines; 7 tests including paper example (1464.06) and no-match RD increase |
| `packages/bot-harness/analysis/encounter-extractor.ts` | extractTemplateEncounters, extractCombinationEncounters, GAME_PHASE_DEFAULTS | VERIFIED | 204 lines; all 3 exports present; log-weighted cross-product credit model |
| `packages/bot-harness/analysis/encounter-extractor.test.ts` | Min 80 lines; cross-product, tick filtering | VERIFIED | 364 lines; 9 tests covering cross-product, tick range, draws, self-encounters |
| `packages/bot-harness/analysis/rating-pool.ts` | RatingPool class, createRatingPools | VERIFIED | 299 lines; exports RatingPool and createRatingPools; snapshot-based batch update |
| `packages/bot-harness/analysis/rating-pool.test.ts` | Min 100 lines | VERIFIED | 308 lines; 8 tests |
| `packages/bot-harness/analysis/combination-miner.ts` | minePairwiseCombinations, mineFrequentSets | VERIFIED | 205 lines; both functions exported with canonical +notation pair IDs |
| `packages/bot-harness/analysis/combination-miner.test.ts` | Min 80 lines | VERIFIED | 216 lines; 6 tests |
| `packages/bot-harness/analysis/outlier-detector.ts` | detectOutliers with all 4 flag types | VERIFIED | 125 lines; both methods implemented; additive flags; does not mutate input |
| `packages/bot-harness/analysis/outlier-detector.test.ts` | Min 60 lines | VERIFIED | 168 lines; 7 tests |
| `packages/bot-harness/analysis/rating-worker.ts` | Worker thread entry point; parentPort; compute-pool/pool-result protocol | VERIFIED | 102 lines; ComputePoolMessage, PoolResultMessage types; handles compute-pool and terminate |
| `packages/bot-harness/analysis/rating-coordinator.ts` | computeRatingsSequential, computeRatingsParallel, RatingComputeOptions | VERIFIED | 481 lines; both exports plus interface; parallel falls back to sequential for <=2 pools |
| `packages/bot-harness/analysis/rating-coordinator.test.ts` | Min 60 lines | VERIFIED | 301 lines; 5 tests including sequential==parallel equivalence |
| `packages/bot-harness/analysis/balance-report.ts` | assembleRatingsReport, ratingsOptions in AssembleOptions | VERIFIED | assembleRatingsReport exported (line 204); ratingsOptions in AssembleOptions (line 40) |
| `packages/bot-harness/analysis/console-formatter.ts` | Tier list and outlier sections | VERIFIED | Sections 6 (Structure Ratings / Glicko-2) and 7 (Balance Outliers) present |
| `packages/bot-harness/analysis/markdown-formatter.ts` | Rating tables, pairwise combos, outlier tables | VERIFIED | Structure Ratings, Pairwise Combination Ratings, Frequent Set Ratings, Balance Outliers sections |
| `packages/bot-harness/analysis/index.ts` | Exports for all Phase 22 modules | VERIFIED | All 6 new modules exported (glicko2-engine, encounter-extractor, rating-pool, combination-miner, outlier-detector, rating-coordinator) |
| `bin/analyze-balance.ts` | ratings/report/all subcommands; 8 new flags; backward compatible | VERIFIED | allowPositionals routing; all flags present (--early-end, --mid-end, --tau, --min-support, --max-set-size, --per-phase-combos, --workers, --sd-threshold); no-subcommand path preserved |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| glicko2-engine.ts | types.ts | import type { Glicko2Rating, MatchResult } | WIRED | line 13: `import type { Glicko2Rating, MatchResult } from './types.js'` |
| encounter-extractor.ts | types.ts | import TemplateEncounter, ParsedMatch, GamePhaseRange | WIRED | lines 14-18: multi-line import of all 3 types |
| rating-pool.ts | glicko2-engine.ts | imports updateRating for batch computation | WIRED | line 22: `import { GLICKO2_DEFAULTS, updateRating } from './glicko2-engine.js'` |
| rating-pool.ts | encounter-extractor.ts | imports extractTemplateEncounters and GAME_PHASE_DEFAULTS | WIRED | lines 23-26: both imported and used in processMatches/createRatingPools |
| outlier-detector.ts | stats.ts | imports mean and stddev for statistical deviation | WIRED | line 19: `import { mean, stddev } from './stats.js'`; used at lines 72-73 |
| rating-coordinator.ts | rating-worker.ts | spawns worker threads with pool data | WIRED | line 384: `new Worker(shimPath, ...)` with _worker-shim.mjs pattern |
| rating-coordinator.ts | rating-pool.ts | imports RatingPool and createRatingPools | WIRED | line 25: `import { createRatingPools, RatingPool } from './rating-pool.js'` |
| balance-report.ts | rating-coordinator.ts | calls computeRatingsParallel/Sequential for ratings assembly | WIRED | lines 17-19: both imported; used at lines 165, 167 when ratingsOptions provided |
| bin/analyze-balance.ts | balance-report.ts | calls assembleBalanceReport and assembleRatingsReport | WIRED | line 11: assembleRatingsReport imported; called at lines 160, 200 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| console-formatter.ts | report.ratings | assembleBalanceReport with ratingsOptions -> computeRatingsParallel/Sequential | Glicko-2 engine processes match encounter data from real TickRecord actions | FLOWING |
| markdown-formatter.ts | report.ratings | Same pipeline | Same as above | FLOWING |
| rating-coordinator.ts | RatingsReport | createRatingPools + buildPoolEncounters + extractTemplateEncounters -> updateRating | Builds by team extracted from TickRecord.actions with actionType=build/result=applied | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| updateRating exports as function with correct defaults | `node --input-type=module "import { updateRating, GLICKO2_DEFAULTS } from '.../glicko2-engine.ts'; console.log(typeof updateRating, GLICKO2_DEFAULTS.initialRating)"` | `function 1500` | PASS |
| All Plan 01 tests pass (16 tests) | `npx vitest run glicko2-engine.test.ts encounter-extractor.test.ts` | 16 passed | PASS |
| All Plan 02 tests pass (21 tests) | `npx vitest run rating-pool.test.ts combination-miner.test.ts outlier-detector.test.ts` | 21 passed | PASS |
| All Plan 03 tests pass (11 tests) | `npx vitest run rating-coordinator.test.ts balance-report.test.ts` | 11 passed | PASS |
| Parallel computation produces same results as sequential | rating-coordinator.test.ts "produces same results as sequential" | PASS (18s) | PASS |

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|----------------|-------------|--------|----------|
| BAL-04 | 22-01, 22-02, 22-03 | Glicko-2 rating engine rates individual structure templates and template combinations from match outcomes | SATISFIED | updateRating in glicko2-engine.ts; rating pools in rating-pool.ts; combination mining in combination-miner.ts; full pipeline in rating-coordinator.ts; 48 tests passing across 5 test files |
| BAL-05 | 22-03 | Balance report CLI generates summary reports (win rates, ratings, strategy meta, heatmaps) from match data | SATISFIED | bin/analyze-balance.ts with ratings/report/all subcommands; console-formatter.ts and markdown-formatter.ts extended with tier lists, combination ratings, and outlier sections; assembleRatingsReport and assembleBalanceReport+ratingsOptions integration |

No orphaned requirements — REQUIREMENTS.md maps exactly BAL-04 and BAL-05 to Phase 22, both claimed by plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| packages/bot-harness/index.ts | 13 | TS2308 re-export collision: `export * from './analysis/index.js'` introduces MatchResult ambiguity with `export * from './types.js'` (line 1) | Warning | Does not affect runtime behavior (documented in Plan 03 SUMMARY as pre-existing); blocks clean TypeScript build for packages/bot-harness consumers; noted as out-of-scope for Phase 22 |
| packages/bot-harness/analysis/rating-coordinator.ts | 148-162 | Dead code block: inner loop at lines 148-162 iterates tick actions but assigns nothing (sets no state), followed immediately by a second loop at lines 165-179 that actually collects teamTemplates. The first loop is a no-op. | Info | No functional impact (second loop is correct); minor dead code in frequent-set pool building |

### Human Verification Required

#### 1. CLI ratings subcommand with real match data

**Test:** Run `tsx bin/analyze-balance.ts ratings --match-dir <path-to-match-files>`
**Expected:** Console output showing tier lists for early/mid/late game phases with template names, Glicko-2 ratings, RD values, and provisional flags where applicable
**Why human:** No match files available in this environment; behavioral validation of full I/O pipeline requires real NDJSON match data

#### 2. CLI all subcommand producing three output files

**Test:** Run `tsx bin/analyze-balance.ts all --match-dir <dir> --output balance-report`
**Expected:** Three files created: balance-report.json (full BalanceReport with ratings field), balance-report.md (with Structure Ratings, Pairwise Combination Ratings, and Balance Outliers sections), and console output
**Why human:** Multi-file output and markdown section rendering require real match data and filesystem inspection

### Gaps Summary

One gap blocks a clean lint run: the `MatchResult` interface added to `packages/bot-harness/analysis/types.ts` in Phase 22-01 creates a barrel export collision in `packages/bot-harness/index.ts`. Both `./types.js` and `./analysis/index.js` (which re-exports analysis/types.ts) export `MatchResult`, triggering TS2308. This was documented in the Phase 22-03 SUMMARY as a pre-existing issue outside the plan scope.

The fix is simple: rename `MatchResult` in `analysis/types.ts` to `Glicko2MatchResult` (or add an explicit disambiguation in the barrel), then update the three references in glicko2-engine.ts, rating-pool.ts, and rating-coordinator.ts.

All runtime functionality — 47 tests passing across 6 test files, full pipeline from match data to CLI output, worker thread parallelism, and both formatters — is verified complete and correct.

---

_Verified: 2026-04-01T21:15:26Z_
_Verifier: Claude (gsd-verifier)_
