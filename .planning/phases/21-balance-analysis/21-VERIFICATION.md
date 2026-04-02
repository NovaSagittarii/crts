---
phase: 21-balance-analysis
verified: 2026-04-01T19:25:00Z
status: passed
score: 10/10 must-haves verified
re_verification: false
---

# Phase 21: Balance Analysis Verification Report

**Phase Goal:** Win rates and strategy distributions are computable from accumulated match data, revealing per-template and per-strategy balance insights
**Verified:** 2026-04-01T19:25:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria)

| #   | Truth                                                                                                                     | Status   | Evidence                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Per-template and per-strategy win rates are computed from the match database with 95% confidence intervals                | VERIFIED | `computeTemplateWinRates` and `computeStrategyWinRates` in win-rate-analyzer.ts both call `wilsonScoreInterval` from stats.ts; 15/15 tests pass covering presence/usage-weighted/first-build methods  |
| 2   | Strategy distribution classifier identifies build-order archetypes and tracks their frequency across training generations | VERIFIED | strategy-classifier.ts exports `classifyAll`; generation-tracker.ts exports `discoverGenerations`, `splitMatchesByGeneration`, `computeGenerationData`; 30/30 classifier+clustering+mining tests pass |
| 3   | Analysis runs against any NDJSON match log directory and produces structured output (not coupled to a live training run)  | VERIFIED | `bin/analyze-balance.ts` CLI reads any `--match-dir`; no imports from training modules in analysis/ directory; `--help` produces correct usage output                                                 |

**Score:** 3/3 success criteria verified

### Required Artifacts

All artifacts from plans 01-04 exist and are substantive:

| Artifact                                               | Status   | Line Count | Key Exports                                                                                                                                                                                                               |
| ------------------------------------------------------ | -------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/bot-harness/match-runner.ts`                 | VERIFIED | —          | templateId/x/y/transform now populated in `createTickRecord`                                                                                                                                                              |
| `packages/bot-harness/analysis/types.ts`               | VERIFIED | 120        | 12 interfaces: ParsedMatch, ConfidenceInterval, WinRateWithCI, TemplateWinRate, StrategyWinRate, StrategyFeatureVector, StrategyAssignment, ClusterResult, SequencePattern, GenerationData, BalanceReport, AnalysisConfig |
| `packages/bot-harness/analysis/stats.ts`               | VERIFIED | 133        | `wilsonScoreInterval`, `bootstrapPercentileCI`, `shannonEntropy`, `mean`, `stddev`                                                                                                                                        |
| `packages/bot-harness/analysis/match-log-reader.ts`    | VERIFIED | 73         | `readMatchFile`, `discoverMatchFiles`                                                                                                                                                                                     |
| `packages/bot-harness/analysis/win-rate-analyzer.ts`   | VERIFIED | 336 (>100) | `computeTemplateWinRates`, `computeStrategyWinRates`                                                                                                                                                                      |
| `packages/bot-harness/analysis/strategy-classifier.ts` | VERIFIED | 285 (>80)  | `extractFeatures`, `classifyStrategy`, `classifyAll`                                                                                                                                                                      |
| `packages/bot-harness/analysis/clustering.ts`          | VERIFIED | 283 (>60)  | `kMeans`, `normalizeFeatures`, `featureVectorToArray`                                                                                                                                                                     |
| `packages/bot-harness/analysis/sequence-miner.ts`      | VERIFIED | 128 (>40)  | `mineSequencePatterns`, `extractBuildSequence`                                                                                                                                                                            |
| `packages/bot-harness/analysis/generation-tracker.ts`  | VERIFIED | 138        | `discoverGenerations`, `splitMatchesByGeneration`, `computeGenerationData`                                                                                                                                                |
| `packages/bot-harness/analysis/balance-report.ts`      | VERIFIED | 167        | `assembleBalanceReport`, `DEFAULT_ANALYSIS_CONFIG`                                                                                                                                                                        |
| `packages/bot-harness/analysis/console-formatter.ts`   | VERIFIED | 162        | `formatConsoleSummary`                                                                                                                                                                                                    |
| `packages/bot-harness/analysis/markdown-formatter.ts`  | VERIFIED | 233        | `formatMarkdownReport`                                                                                                                                                                                                    |
| `packages/bot-harness/analysis/index.ts`               | VERIFIED | 11         | Barrel re-exports all 11 analysis modules                                                                                                                                                                                 |
| `packages/bot-harness/index.ts`                        | VERIFIED | —          | Includes `export * from './analysis/index.js'`                                                                                                                                                                            |
| `bin/analyze-balance.ts`                               | VERIFIED | 166        | `parseArgs`, `--match-dir`, `assembleBalanceReport` call                                                                                                                                                                  |

### Key Link Verification

| From                   | To                                      | Via                                                                                  | Status | Notes       |
| ---------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ | ------ | ----------- |
| match-log-reader.ts    | bot-harness/types.ts                    | `import MatchHeader, TickRecord, MatchOutcomeRecord`                                 | WIRED  | Line 6-12   |
| match-log-reader.ts    | analysis/types.ts                       | `import ParsedMatch`                                                                 | WIRED  | Line 12     |
| stats.ts               | analysis/types.ts                       | `import ConfidenceInterval`                                                          | WIRED  | Line 1      |
| win-rate-analyzer.ts   | analysis/types.ts                       | imports TemplateWinRate, StrategyWinRate, WinRateWithCI, ParsedMatch, AnalysisConfig | WIRED  | Lines 3-11  |
| win-rate-analyzer.ts   | analysis/stats.ts                       | `import { wilsonScoreInterval }`                                                     | WIRED  | Line 12     |
| strategy-classifier.ts | analysis/types.ts                       | imports StrategyFeatureVector, StrategyAssignment, ParsedMatch                       | WIRED  | Lines 3-7   |
| strategy-classifier.ts | analysis/stats.ts                       | `import { mean, shannonEntropy, stddev }`                                            | WIRED  | Line 7      |
| clustering.ts          | analysis/types.ts                       | `import ClusterResult, StrategyFeatureVector`                                        | WIRED  | Line 1      |
| balance-report.ts      | win-rate-analyzer.ts                    | `import { computeTemplateWinRates, computeStrategyWinRates }`                        | WIRED  | Line 8      |
| balance-report.ts      | strategy-classifier.ts                  | `import { classifyAll }`                                                             | WIRED  | Line 6      |
| balance-report.ts      | clustering.ts                           | `import { normalizeFeatures, kMeans }`                                               | WIRED  | Line 7      |
| balance-report.ts      | sequence-miner.ts                       | `import { extractBuildSequence, mineSequencePatterns }`                              | WIRED  | Line 9      |
| balance-report.ts      | generation-tracker.ts                   | `import { discoverGenerations, splitMatchesByGeneration, computeGenerationData }`    | WIRED  | Lines 10-14 |
| generation-tracker.ts  | win-rate-analyzer.ts                    | `import { computeTemplateWinRates }`                                                 | WIRED  | Line 9      |
| bin/analyze-balance.ts | packages/bot-harness (via #bot-harness) | imports all analysis API                                                             | WIRED  | Lines 7-15  |

**Note on Plan 04 key link deviation:** The plan specified `generation-tracker.ts -> match-log-reader.ts via discoverMatchFiles`. The implementation instead uses `node:fs/promises readdir` directly for checkpoint discovery (which discovers checkpoint directories, not match files). Match file discovery is correctly handled by `discoverMatchFiles` in the CLI (`bin/analyze-balance.ts` lines 8, 100, 111). The goal truth is met via a different but correct implementation path.

### Data-Flow Trace (Level 4)

Analysis modules process in-memory `ParsedMatch[]` data — no rendering of dynamic data from a live source. The CLI reads NDJSON files from disk and passes them through the pipeline synchronously. Data flow is:

`discoverMatchFiles(matchDir)` → `readMatchFile(fp)[]` → `ParsedMatch[]` → `assembleBalanceReport(matches, config)` → `BalanceReport` → formatters

All data sources are real file reads, not hardcoded stubs. Verified: `readMatchFile` uses `createReadStream` and `readline.createInterface` (match-log-reader.ts lines 19-48). No static empty returns.

### Behavioral Spot-Checks

| Behavior                   | Command                                                    | Result                                                             | Status |
| -------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------ | ------ |
| CLI help prints usage      | `npx tsx bin/analyze-balance.ts --help`                    | Full usage text with all options printed                           | PASS   |
| CLI requires --match-dir   | `npx tsx bin/analyze-balance.ts 2>&1`                      | Would exit with error (not tested without arg to avoid error exit) | N/A    |
| 82 analysis tests pass     | `npx vitest run packages/bot-harness/analysis/`            | 82/82 tests pass across 8 test files                               | PASS   |
| 19 match-runner tests pass | `npx vitest run packages/bot-harness/match-runner.test.ts` | 19/19 tests pass including 5 new templateId tests                  | PASS   |
| Module exports present     | `grep -n "export function"` on all analysis modules        | All declared exports confirmed present                             | PASS   |

### Requirements Coverage

| Requirement | Source Plans        | Description                                                                                               | Status    | Evidence                                                                                                                                                                                                                                                                   |
| ----------- | ------------------- | --------------------------------------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| BAL-02      | 21-01, 21-02, 21-04 | Win rate analysis computes per-template and per-strategy win rates from the match database                | SATISFIED | `computeTemplateWinRates` (presence/usage-weighted/first-build with Wilson CIs), `computeStrategyWinRates`, `assembleBalanceReport` orchestrates both; 15 win-rate tests pass                                                                                              |
| BAL-03      | 21-03, 21-04        | Strategy distribution classifier identifies and tracks build-order archetypes across training generations | SATISFIED | `classifyAll` with Conway-appropriate labels (early-builder, diverse-placer, X-heavy, economy-saver, balanced); `kMeans` for emergent clustering; `discoverGenerations` + `splitMatchesByGeneration` for generational tracking; 30 classifier/clustering/mining tests pass |

No orphaned requirements: REQUIREMENTS.md maps only BAL-02 and BAL-03 to Phase 21, both covered.

### Anti-Patterns Found

No anti-patterns detected:

- No TODO/FIXME/placeholder comments in production files
- No empty return stubs (`return null`, `return []`, `return {}`) without data population
- No hardcoded static returns in API-like functions
- No console.log-only handlers
- No traditional RTS labels (rush/turtle/macro) — confirmed absent from strategy-classifier.ts
- No imports from training modules in analysis/ directory — confirmed clean

### Human Verification Required

The following behaviors cannot be verified programmatically:

**1. CLI end-to-end against real match data**

- **Test:** Point `bin/analyze-balance.ts --match-dir <path> --format all` at a real NDJSON match directory from a training run
- **Expected:** JSON report written to disk, markdown summary written to disk, console summary printed to stdout with win rates and strategy distribution populated
- **Why human:** No real match NDJSON directory exists in the test environment; requires a prior training run to generate match files

**2. Console formatter readability and column alignment**

- **Test:** Run `--format console` on a real dataset with 100+ matches; inspect output formatting
- **Expected:** Columns aligned, percentages readable, template names truncated sensibly, convergence notes appear when generations detected
- **Why human:** Format quality is subjective; requires real multi-generation data

**3. Markdown formatter table correctness in a markdown renderer**

- **Test:** Generate `--format markdown`, open in GitHub or a markdown viewer
- **Expected:** Tables render correctly with proper alignment, all sections present
- **Why human:** Markdown rendering requires visual inspection

### Gaps Summary

No gaps. All must-have truths are verified, all artifacts are substantive and wired, all 101 tests (82 analysis + 19 match-runner) pass, requirements BAL-02 and BAL-03 are satisfied.

---

_Verified: 2026-04-01T19:25:00Z_
_Verifier: Claude (gsd-verifier)_
