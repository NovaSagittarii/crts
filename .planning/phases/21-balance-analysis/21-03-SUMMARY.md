---
phase: 21-balance-analysis
plan: 03
subsystem: analysis
tags: [k-means, clustering, strategy-classification, sequence-mining, prefixspan, feature-extraction]

# Dependency graph
requires:
  - phase: 21-01
    provides: "types.ts (StrategyFeatureVector, ClusterResult, SequencePattern), stats.ts (shannonEntropy, mean, stddev)"
provides:
  - "extractFeatures: StrategyFeatureVector from ParsedMatch tick records"
  - "classifyStrategy: rule-based Conway-appropriate labels (early-builder, diverse-placer, template-heavy, economy-saver, balanced)"
  - "classifyAll: batch classification producing StrategyAssignment[]"
  - "kMeans: k-means++ initialization with multi-run and seeded PRNG"
  - "normalizeFeatures: z-score normalization per feature dimension"
  - "mineSequencePatterns: PrefixSpan-style build-order subsequence mining"
  - "extractBuildSequence: ordered templateId sequence from match ticks"
affects: [21-04, balance-report-pipeline]

# Tech tracking
tech-stack:
  added: []
  patterns: [PrefixSpan projected-database pattern mining, k-means++ initialization with LCG PRNG, z-score feature normalization]

key-files:
  created:
    - packages/bot-harness/analysis/strategy-classifier.ts
    - packages/bot-harness/analysis/strategy-classifier.test.ts
    - packages/bot-harness/analysis/clustering.ts
    - packages/bot-harness/analysis/clustering.test.ts
    - packages/bot-harness/analysis/sequence-miner.ts
    - packages/bot-harness/analysis/sequence-miner.test.ts
  modified: []

key-decisions:
  - "classifyStrategy accepts buildCounts Record and totalTicks separately rather than embedding in feature vector, keeping StrategyFeatureVector purely numeric"
  - "Conway-appropriate labels (early-builder, diverse-placer, template-heavy, economy-saver, balanced) instead of traditional RTS terminology per D-08"
  - "PrefixSpan projected-database approach for sequence mining -- bounded by 5-template vocabulary"
  - "Multi-run k-means (default 10 runs) with lowest-WCSS selection for stability"

patterns-established:
  - "Feature extraction from ParsedMatch: walk ticks, filter by teamId, compute aggregates"
  - "Seeded LCG PRNG for deterministic k-means initialization (same seed used across stats.ts and clustering.ts)"
  - "PrefixSpan with per-sequence deduplication for correct support counting"

requirements-completed: [BAL-03]

# Metrics
duration: 15min
completed: 2026-04-01
---

# Phase 21 Plan 03: Strategy Classification Methods Summary

**Three complementary strategy classification methods: feature-based rule labeling with Conway-appropriate names, k-means++ clustering with z-score normalization, and PrefixSpan sequence mining for build-order patterns**

## Performance

- **Duration:** 15 min
- **Started:** 2026-04-01T18:21:38Z
- **Completed:** 2026-04-01T18:36:14Z
- **Tasks:** 2
- **Files created:** 6

## Accomplishments
- Feature extraction produces 11-dimensional StrategyFeatureVector from match tick records covering timing, density, economy, territory, and spatial features
- Rule-based classifier assigns Conway-appropriate labels avoiding traditional RTS terminology (no rush/turtle/macro)
- K-means clustering with k-means++ initialization and multi-run support discovers emergent strategy archetypes
- PrefixSpan sequence mining finds common build-order subsequences with support counting
- All 30 tests passing, lint clean

## Task Commits

Each task was committed atomically:

1. **Task 1: Feature extraction and rule-based strategy classification**
   - `dc7b13c` (test: failing tests for strategy-classifier)
   - `a031331` (feat: implement strategy-classifier with 14 tests passing)
2. **Task 2: K-means clustering and sequence pattern mining**
   - `90be837` (test: failing tests for clustering and sequence-miner)
   - `730b293` (feat: implement clustering and sequence-miner with 16 tests passing)
3. **Lint fixes** - `8e7bd2a` (fix: remove unused imports and functions)

## Files Created/Modified
- `packages/bot-harness/analysis/strategy-classifier.ts` - Feature extraction (extractFeatures) and rule-based classification (classifyStrategy, classifyAll)
- `packages/bot-harness/analysis/strategy-classifier.test.ts` - 14 tests covering feature extraction and classification rules
- `packages/bot-harness/analysis/clustering.ts` - K-means clustering (kMeans), z-score normalization (normalizeFeatures), vector conversion (featureVectorToArray)
- `packages/bot-harness/analysis/clustering.test.ts` - 8 tests covering cluster separation, convergence, determinism, WCSS monotonicity
- `packages/bot-harness/analysis/sequence-miner.ts` - PrefixSpan sequence mining (mineSequencePatterns), build sequence extraction (extractBuildSequence)
- `packages/bot-harness/analysis/sequence-miner.test.ts` - 8 tests covering subsequence discovery, length limits, support filtering, Conway vocabulary

## Decisions Made
- classifyStrategy takes buildCounts as a separate Record<string, number> parameter alongside the numeric feature vector, keeping StrategyFeatureVector purely numeric for clustering compatibility
- Conway-appropriate labels per D-08: early-builder, diverse-placer, {templateId}-heavy, mono-{templateId}, economy-saver, balanced
- PrefixSpan approach chosen for sequence mining -- projected database with per-sequence deduplication ensures correct support counting
- Multi-run k-means (10 runs by default) with lowest-WCSS selection provides stable clustering without requiring external libraries

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed lint errors for unused imports/functions**
- **Found during:** Post-task verification
- **Issue:** Unused `TickActionRecord` import in strategy-classifier.ts and unused `euclideanDistance` function in clustering.ts
- **Fix:** Removed unused import and function
- **Files modified:** packages/bot-harness/analysis/strategy-classifier.ts, packages/bot-harness/analysis/clustering.ts
- **Verification:** `npx eslint` passes clean
- **Committed in:** 8e7bd2a

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor lint cleanup, no scope change.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Strategy classification, clustering, and sequence mining modules are ready for Plan 04 (balance report pipeline)
- classifyAll produces StrategyAssignment[] with clusterId=-1 placeholders ready for kMeans to fill
- normalizeFeatures converts StrategyFeatureVector[] to number[][] suitable for kMeans input
- extractBuildSequence extracts ordered templateId sequences for mineSequencePatterns input

## Self-Check: PASSED

- All 7 files verified present
- All 5 commits verified in git log
- No stubs, TODOs, or placeholders found
- 30/30 tests passing
- Lint clean

---
*Phase: 21-balance-analysis*
*Completed: 2026-04-01*
