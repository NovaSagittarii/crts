# Phase 22: Structure Strength Ratings - Research

**Researched:** 2026-04-01
**Domain:** Glicko-2 rating engine for structure templates + combinations, outlier detection, balance report CLI
**Confidence:** HIGH

## Summary

Phase 22 extends Phase 21's balance analysis with Glicko-2 ratings for individual structure templates, pairwise template combinations, and frequent template sets. The core deliverables are: (1) a Glicko-2 rating engine that processes match logs into per-entity ratings with RD/confidence, (2) per-game-phase rating pools (early/mid/late), (3) pairwise and frequent-set combination ratings, (4) statistical and usage-matrix outlier detection, and (5) CLI subcommands (`analyze ratings`, `analyze report`, `analyze all`) extending Phase 21's `bin/analyze-balance.ts`.

The project has 5 structure templates (block, generator, glider, eater-1, gosper), yielding 10 pairwise combinations -- a very manageable combinatorial space. The Glicko-2 algorithm is mathematically well-defined (8-step procedure from Mark Glickman's paper) and hand-rolling it aligns with this project's zero-dependency pattern established in Phase 21. The algorithm's batch update model is embarrassingly parallel per entity, making worker thread parallelism (D-05) straightforward. The existing `packages/bot-harness/analysis/` module structure, `BalanceReport` type, and three-tier output pattern (JSON/console/markdown) provide clear extension points.

**Primary recommendation:** Hand-roll the Glicko-2 engine from scratch in TypeScript (no npm Glicko-2 library). The algorithm is a single function with ~100 lines of math. Use the existing `packages/bot-harness/analysis/` directory for all new modules. Extend the `BalanceReport` interface and `assembleBalanceReport()` to include ratings data. Extend `bin/analyze-balance.ts` with subcommand routing.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Template-vs-template encounters extracted from team-level match outcomes. Winning team's templates earn fractional wins against losing team's templates, weighted by `log(1 + buildCount)`. Logarithmic scoring captures diminishing returns.
- **D-02:** Separate Glicko-2 rating pools per game phase: early, mid, late. Only builds within each configurable tick-range window contribute to that pool's ratings. Produces three independent tier lists.
- **D-03:** Configurable game-phase boundaries (e.g., ticks 0-200 = early, 200-600 = mid, 600+ = late). Defaults chosen by Claude, tunable via CLI flags.
- **D-04:** Templates with insufficient data (RD > 150) flagged as provisional rather than reported as definitive ratings.
- **D-05:** Two-level parallelism for Glicko-2 computation via worker threads: (a) across pools (each rating pool runs in its own worker), (b) within pools (partition per-period entity updates across workers for large combination pools).
- **D-06:** Pairwise combinations as primary model -- rate every 2-template pair that co-occurs in a match.
- **D-07:** Top-K frequent set mining as secondary model -- discover higher-order combinations (3+ templates) that appear frequently. Configurable min support and max set size.
- **D-08:** Both pairwise and frequent-set combinations get their own Glicko-2 ratings using the same log-weighted credit model.
- **D-09:** Game-phase splits for individual template ratings only. Combination ratings computed across the full match by default. Configurable flag to enable per-phase combination ratings.
- **D-10:** Two independent outlier detection methods: (a) statistical deviation (>2 SD from mean), (b) rating + usage matrix (dominant/niche strong/trap categorization).
- **D-11:** Outlier detection runs per game phase. A template can be flagged as overpowered in early game but balanced overall.
- **D-12:** Templates can carry multiple flags simultaneously. Flags are additive.
- **D-13:** Extend Phase 21's CLI with new subcommands: `analyze ratings`, `analyze report`. Single entry point.
- **D-14:** Full pipeline mode: `analyze all` runs win rates, strategy classification, Glicko-2 ratings, and report generation in one command.
- **D-15:** Report output follows Phase 21's three-tier pattern: JSON canonical (extended), console summary, markdown generator.
- **D-16:** Ratings data added to Phase 21's combined JSON file (extended schema, not separate file).

### Claude's Discretion
- Default game-phase tick boundaries
- Glicko-2 hyperparameters (initial rating, initial RD, volatility, tau)
- Frequent-set mining algorithm choice (Apriori, FP-growth, or simpler)
- Default min support and max set size for frequent-set mining
- Statistical deviation threshold (>2 SD recommended but tunable)
- Rating + usage matrix threshold boundaries for dominant/niche/trap categories
- Worker thread count and partition strategy for intra-pool parallelism
- Exact CLI flag names and defaults for new subcommands
- Report formatting, section ordering, tier list presentation
- Internal module structure within bot-harness for Phase 22 additions

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BAL-04 | Glicko-2 rating engine rates individual structure templates and template combinations from match outcomes | Glicko-2 algorithm (8-step Glickman procedure) hand-rolled in TypeScript; three entity types (individual, pairwise, frequent-set); per-game-phase pools; log-weighted fractional credit model; RD > 150 provisional flagging |
| BAL-05 | Balance report CLI generates summary reports (win rates, ratings, strategy meta, heatmaps) from match data | Extends existing `bin/analyze-balance.ts` with subcommands `ratings`, `report`, `all`; extends `BalanceReport` JSON schema with ratings/outlier data; extends console/markdown formatters with tier lists and outlier flags |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript (project) | strict mode | All Phase 22 code | Project standard |
| Vitest | 4.0.18 | Unit tests co-located in packages/ | Project standard |
| node:util parseArgs | built-in | CLI argument parsing | Phase 18/20/21 established pattern |
| node:worker_threads | built-in | Glicko-2 pool parallelism | Phase 20 established pattern for CPU-intensive work |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Hand-rolled Glicko-2 | N/A | Rating computation | ~100 lines of math, well-defined 8-step algorithm |
| Hand-rolled frequent-set mining | N/A | Combination discovery | Extend Phase 21's PrefixSpan to itemset mining; small vocabulary (5 templates) |
| Existing stats.ts | N/A | mean, stddev, Wilson CI | Already implemented in Phase 21 |
| Existing match-log-reader.ts | N/A | NDJSON parsing | Already implemented in Phase 21 |
| Existing sequence-miner.ts | N/A | PrefixSpan pattern mining | Reference for frequent-set mining approach |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled Glicko-2 | `glicko2-lite` npm (v5.0.0) | Library is 1.7M ops/sec but adds dependency; hand-roll is ~100 lines, matches project's zero-dep analysis pattern from Phase 21 |
| Hand-rolled frequent sets | `node-apriori` or `node-fpgrowth` npm | Both 7+ years old, unmaintained; with only 5 templates the combinatorial space is trivial |
| Hand-rolled outlier detection | No library exists for this specific use case | Domain-specific: SD-based + usage-matrix categorization are custom to this game's balance analysis |

**Installation:**
```bash
# No new dependencies required -- all hand-rolled following Phase 21 pattern
```

## Architecture Patterns

### Recommended Module Structure
```
packages/bot-harness/analysis/
  types.ts                    # Extended with Glicko-2 types (RatingEntity, etc.)
  glicko2-engine.ts           # Core Glicko-2 algorithm (pure math, no I/O)
  glicko2-engine.test.ts      # Verify against Glickman paper example
  rating-pool.ts              # RatingPool: manages entities, match extraction, period updates
  rating-pool.test.ts         # Pool orchestration tests
  combination-miner.ts        # Pairwise + frequent-set combination discovery
  combination-miner.test.ts   # Combination extraction tests
  outlier-detector.ts         # SD-based + usage-matrix outlier detection
  outlier-detector.test.ts    # Outlier detection tests
  rating-worker.ts            # Worker thread entry point for parallel pool computation
  balance-report.ts           # Extended assembleBalanceReport (existing file, modified)
  console-formatter.ts        # Extended with ratings sections (existing file, modified)
  markdown-formatter.ts       # Extended with tier lists (existing file, modified)
  index.ts                    # Extended exports (existing file, modified)
bin/
  analyze-balance.ts          # Extended with subcommand routing (existing file, modified)
```

### Pattern 1: Glicko-2 Rating Engine (Pure Math)
**What:** Stateless function implementing Glickman's 8-step algorithm
**When to use:** Called per entity per rating period
**Example:**
```typescript
// Source: Glickman's Glicko-2 paper (glicko.net/glicko/glicko2.pdf)

interface Glicko2Rating {
  rating: number;     // mu on Glicko-2 scale
  rd: number;         // phi on Glicko-2 scale
  volatility: number; // sigma
}

interface MatchResult {
  opponentRating: number;
  opponentRd: number;
  score: number; // 1.0 = win, 0.5 = draw, 0.0 = loss
}

/** Default hyperparameters */
const GLICKO2_DEFAULTS = {
  initialRating: 1500,
  initialRd: 350,
  initialVolatility: 0.06,
  tau: 0.5,           // System constant, constrains volatility change
  convergenceTol: 1e-6, // Epsilon for Step 5 iteration
  scaleFactor: 173.7178, // 400 / ln(10)
};

function updateGlicko2(
  player: Glicko2Rating,
  matches: MatchResult[],
  tau: number,
): Glicko2Rating {
  // Step 1: Convert to Glicko-2 scale
  const mu = (player.rating - 1500) / 173.7178;
  const phi = player.rd / 173.7178;
  const sigma = player.volatility;

  // If no matches, only RD increases (Step 6 only)
  if (matches.length === 0) {
    const phiStar = Math.sqrt(phi * phi + sigma * sigma);
    return {
      rating: player.rating,
      rd: phiStar * 173.7178,
      volatility: sigma,
    };
  }

  // Steps 2-8: Full update with match data
  // ... (g function, E function, v, delta, volatility iteration, final update)
}
```

### Pattern 2: Match-to-Encounter Extraction (D-01 Credit Model)
**What:** Converts team-level match outcomes into template-vs-template encounters with log-weighted credits
**When to use:** Before feeding data into the Glicko-2 engine
**Example:**
```typescript
interface TemplateEncounter {
  templateA: string;       // From winning team
  templateB: string;       // From losing team
  scoreA: number;          // Fractional win credit
  scoreB: number;          // 1 - scoreA (or 0.5 each for draw)
  weightA: number;         // log(1 + buildCountA)
  weightB: number;         // log(1 + buildCountB)
}

function extractEncounters(
  match: ParsedMatch,
  tickRange?: { start: number; end: number }, // For game-phase filtering
): TemplateEncounter[] {
  // 1. Filter ticks to range (if provided)
  // 2. Count builds per template per team within range
  // 3. Determine win credit from match outcome
  // 4. Generate cross-product: every template in team A vs every template in team B
  // 5. Weight each encounter by log(1 + buildCount) for both sides
}
```

### Pattern 3: Rating Pool with Game-Phase Separation (D-02)
**What:** Independent rating pool per game phase, each maintaining its own entity ratings
**When to use:** Organizing Glicko-2 computation into parallel-ready units
**Example:**
```typescript
interface RatingPool {
  name: string;            // e.g., "individual-early", "pairwise-full"
  entityType: 'individual' | 'pairwise' | 'frequent-set';
  phase: 'early' | 'mid' | 'late' | 'full';
  tickRange: { start: number; end: number } | null;
  entities: Map<string, Glicko2Rating>;
  encounters: TemplateEncounter[];
}

// Per D-02: individual templates get 3 pools (early/mid/late)
// Per D-09: combinations default to 1 pool (full match)
// Total pools = 3 (individual phases) + 1 (pairwise full) + 1 (frequent-set full) = 5 minimum
// With --per-phase-combos flag: 3 + 3 + 3 = 9 pools
```

### Pattern 4: Worker Thread Parallelism (D-05)
**What:** Each rating pool runs as an independent Glicko-2 pass in its own worker thread
**When to use:** Across-pool parallelism for the 5+ independent rating pools
**Example:**
```typescript
// Follow Phase 20's established pattern:
// 1. Main thread prepares pool data (encounters, entity state)
// 2. Worker receives pool data via postMessage
// 3. Worker runs Glicko-2 updates for all entities in the pool
// 4. Worker returns updated ratings via postMessage with transferable buffers
// 5. Main thread collects results from all workers

// Worker message protocol (mirrors Phase 20's training-worker.ts pattern)
interface RatingWorkerMessage {
  type: 'compute-pool';
  pool: SerializedRatingPool; // Entities + encounters as plain objects
}

interface RatingWorkerResult {
  type: 'pool-result';
  poolName: string;
  entities: Array<{ id: string; rating: Glicko2Rating }>;
}
```

### Pattern 5: Outlier Detection (D-10)
**What:** Two independent detection methods producing additive flags per template
**When to use:** After Glicko-2 ratings are computed, before report generation
**Example:**
```typescript
type OutlierFlag =
  | 'statistical-outlier-high'  // >2 SD above mean
  | 'statistical-outlier-low'   // >2 SD below mean
  | 'dominant'                  // High rating + high pick rate
  | 'niche-strong'              // High rating + low pick rate
  | 'trap';                     // Low rating + high pick rate

interface RatedTemplate {
  templateId: string;
  rating: Glicko2Rating;
  provisional: boolean;  // RD > 150
  pickRate: number;       // Usage frequency across matches
  outlierFlags: OutlierFlag[];
}
```

### Anti-Patterns to Avoid
- **Mutable global rating state:** Keep rating pools immutable between periods. Each `updateGlicko2` call returns a NEW rating object.
- **Updating ratings after each match:** Glicko-2 is designed for batch/period-based updates. Collect all matches in a period, then update all entities simultaneously. For this project, all matches in a log directory constitute one rating period.
- **Cross-entity dependency within a period:** Glicko-2 batch updates are embarrassingly parallel because each entity's new rating depends only on its pre-update rating + opponents' pre-update ratings. Never read another entity's post-update rating during a batch.
- **Importing TF.js in rating workers:** Rating workers do pure math only -- no TF.js dependency. Phase 20's worker pattern imported TF.js because it needed neural network inference. Rating workers are lightweight.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NDJSON parsing | Custom line parser | Existing `readMatchFile()` from `match-log-reader.ts` | Already handles streaming, error cases, type parsing |
| Wilson score CI | Binomial CI math | Existing `wilsonScoreInterval()` from `stats.ts` | Already tested and used by Phase 21 |
| Mean/stddev | Basic stats | Existing `mean()`, `stddev()` from `stats.ts` | Already tested |
| Build sequence extraction | Tick walker | Existing `extractBuildSequence()` from `sequence-miner.ts` | Already handles templateId filtering |
| Strategy classification | Feature extraction | Existing `classifyAll()` from `strategy-classifier.ts` | Already computes strategy features and labels |

**Key insight:** Phase 21 built a comprehensive analysis foundation. Phase 22 extends it rather than rebuilding. All new code should import from the existing `analysis/` module.

## Glicko-2 Algorithm Details

### The 8-Step Procedure (Glickman, 2013)

The algorithm operates on a "Glicko-2 scale" where `mu = (rating - 1500) / 173.7178` and `phi = rd / 173.7178`. All computation happens on this scale; results are converted back at the end.

**Step 1-2:** Convert ratings to Glicko-2 scale.

**Step 3:** Compute estimated variance `v`:
```
g(phi_j) = 1 / sqrt(1 + 3*phi_j^2 / pi^2)
E(mu, mu_j, phi_j) = 1 / (1 + exp(-g(phi_j) * (mu - mu_j)))
v = [SUM_j g(phi_j)^2 * E * (1 - E)]^(-1)
```

**Step 4:** Compute estimated improvement `delta`:
```
delta = v * SUM_j g(phi_j) * (s_j - E)
```

**Step 5:** Determine new volatility `sigma'` via Illinois algorithm (iterative root-finding):
```
f(x) = (e^x * (delta^2 - phi^2 - v - e^x)) / (2 * (phi^2 + v + e^x)^2) - (x - ln(sigma^2)) / tau^2
```
Iterate until convergence (|B - A| < epsilon = 1e-6).

**Step 6:** Update pre-rating period RD: `phi* = sqrt(phi^2 + sigma'^2)`

**Step 7:** Update rating and RD:
```
phi' = 1 / sqrt(1/phi*^2 + 1/v)
mu' = mu + phi'^2 * SUM_j g(phi_j) * (s_j - E)
```

**Step 8:** Convert back: `rating' = 173.7178 * mu' + 1500`, `rd' = 173.7178 * phi'`

### Recommended Hyperparameters (Claude's Discretion)

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Initial rating | 1500 | Standard Glicko-2 default |
| Initial RD | 350 | Standard Glicko-2 default (maximum uncertainty) |
| Initial volatility | 0.06 | Glickman's recommended default |
| Tau | 0.5 | Middle of recommended range (0.3-1.2); conservative but responsive |
| Convergence epsilon | 1e-6 | Standard precision for Step 5 iteration |
| Provisional RD threshold | 150 | Per D-04 success criterion |

### Game-Phase Tick Boundaries (Claude's Discretion)

| Phase | Tick Range | Rationale |
|-------|-----------|-----------|
| Early | 0-200 | First 10% of default 2000-tick matches; opening builds |
| Mid | 200-600 | Middle 20%; main build phase, economy established |
| Late | 600+ | Remaining 70%; late-game, territory control |

These boundaries align with the game's economy curve: initial resources are spent in the first 200 ticks, generators become productive by tick 200, and late-game shifts to territorial consolidation.

### Match Credit Model (D-01)

For each match, template encounters are generated as:
1. Identify winning and losing teams (or draw)
2. Count builds per template per team (within tick range for phased pools)
3. For each template A in winning team vs each template B in losing team:
   - Score for A: `1.0 * log(1 + countA)` (win credit scaled by log-weight)
   - Score for B: `0.0 * log(1 + countB)` (loss credit scaled by log-weight)
4. For draws: both get `0.5` credit
5. These weighted encounters feed into the Glicko-2 update as match results

The log-weighted credit means building "block" 5 times gives credit `log(6) = 1.79`, not 5x the credit of building it once (`log(2) = 0.69`). This prevents template spam from dominating ratings.

## Combination Mining Details

### Pairwise Combinations (D-06)

With 5 templates, there are `C(5,2) = 10` possible pairs. For each match and team, extract the set of templates used. Every 2-element subset that actually co-occurs becomes a "pairwise entity" that participates in Glicko-2 rating, using the same cross-team encounter model as individual templates.

Entity ID format: `"block+glider"` (sorted alphabetically for canonical naming).

### Frequent-Set Mining (D-07)

Phase 21 already has `mineSequencePatterns()` using PrefixSpan for sequential patterns. For frequent *sets* (order-independent), a simpler approach is sufficient:

**Recommended algorithm:** Direct enumeration with Apriori-style pruning. Given 5 templates, the maximum itemset size is 5. Total possible subsets: `2^5 - 1 = 31`. With such a tiny vocabulary, brute-force enumeration of all possible subsets and counting support is faster and simpler than FP-growth.

```typescript
// For each match-team pair, extract the SET of templates used (not sequence)
// For each candidate k-subset (k = 2..maxSetSize), count support
// Filter by minSupport threshold
// Rate surviving sets via Glicko-2
```

**Default parameters (Claude's Discretion):**
- Min support: 5 (matches containing the set)
- Max set size: 4 (beyond 4 templates in a single match is unlikely with 5 total)

### Combination Rating Credit

Combination entities (pairwise or frequent-set) participate in encounters the same way individual templates do:
- Winning team's combinations earn fractional wins against losing team's combinations
- Log-weighted by the minimum build count among the combination's members
- E.g., if team uses {block: 3, glider: 1}, the pair "block+glider" gets weight `log(1 + min(3, 1)) = log(2)`

## Outlier Detection Details

### Method A: Statistical Deviation (D-10a)

After Glicko-2 ratings are computed for a pool:
1. Collect all non-provisional entity ratings (RD <= 150)
2. Compute mean and standard deviation
3. Flag entities with rating > mean + 2*SD as `statistical-outlier-high`
4. Flag entities with rating < mean - 2*SD as `statistical-outlier-low`

The threshold of 2 SD is configurable (D-10 says ">2 standard deviations").

### Method B: Rating + Usage Matrix (D-10b)

Categorize entities into a 2x2 matrix using rating and pick rate:

| | High Pick Rate | Low Pick Rate |
|---|---|---|
| **High Rating** | `dominant` | `niche-strong` |
| **Low Rating** | `trap` | (unlabeled -- unused and weak) |

**Threshold boundaries (Claude's Discretion):**
- High rating: > median rating (or > mean + 0.5*SD)
- High pick rate: > median pick rate (or top 40th percentile)

These thresholds produce game-design-meaningful labels:
- **Dominant:** Commonly used AND strong -- potential balance concern
- **Niche strong:** Rarely used but strong when used -- potential hidden gem
- **Trap:** Commonly used but weak -- players are baited into a poor strategy

## Worker Thread Architecture

### Pool Count Analysis

| Pool Type | Phases | Count |
|-----------|--------|-------|
| Individual template | early, mid, late | 3 |
| Pairwise combination | full (default) | 1 |
| Frequent-set combination | full (default) | 1 |
| **Total (default)** | | **5** |
| With --per-phase-combos | early, mid, late each | 9 |

### Parallelism Strategy (D-05)

**Across pools (D-05a):** Spawn up to `min(poolCount, cpuCount - 1)` worker threads. Each worker receives one pool's data and returns updated ratings. With 5 pools and 4 CPUs, use 3 workers (leaving 1 for main thread).

**Within pools (D-05b):** For pools with many entities (pairwise: up to 10; frequent-sets: up to ~31), the Glicko-2 batch update is embarrassingly parallel -- each entity's rating depends only on pre-update opponent ratings. For pools with <= ~20 entities, single-threaded is sufficient. Intra-pool parallelism only benefits pools with hundreds of entities, which is unlikely with 5 templates.

**Practical recommendation:** Across-pool parallelism is sufficient for the current template vocabulary. Implement the intra-pool partition interface but default to single-threaded per pool. The worker thread code should accept an `entities` slice for future scalability.

### Worker Thread Pattern

Follow Phase 20's established pattern (`training-worker.ts` / `training-coordinator.ts`):
1. Use `_worker-shim.mjs` for tsx TypeScript loading in worker threads
2. Message-based protocol: `{ type: 'compute-pool', ... }` / `{ type: 'pool-result', ... }`
3. No shared mutable state -- all data passed via `postMessage`
4. Plain objects only (no class instances across thread boundary)

## CLI Extension Design

### Subcommand Routing

The existing `bin/analyze-balance.ts` uses flat flags. Phase 22 adds subcommand-style routing while maintaining backward compatibility:

```bash
# Phase 21 (existing, still works)
tsx bin/analyze-balance.ts --match-dir ./matches/run-123

# Phase 22 additions
tsx bin/analyze-balance.ts ratings --match-dir ./matches/run-123
tsx bin/analyze-balance.ts report --match-dir ./matches/run-123
tsx bin/analyze-balance.ts all --match-dir ./matches/run-123

# New flags for ratings subcommand
--early-end <tick>        # End of early phase (default: 200)
--mid-end <tick>          # End of mid phase (default: 600)
--tau <float>             # Glicko-2 tau parameter (default: 0.5)
--min-support <int>       # Frequent-set min support (default: 5)
--max-set-size <int>      # Frequent-set max size (default: 4)
--per-phase-combos        # Enable per-phase combination ratings
--workers <int>           # Worker thread count (default: auto)
--sd-threshold <float>    # Outlier SD threshold (default: 2.0)

# New flags for report subcommand
--format <json|console|markdown|all>  # (shared with existing)
--output <path>                       # (shared with existing)
```

**Implementation:** Use `node:util parseArgs` with `allowPositionals: true` to extract the subcommand, then route to the appropriate handler. The default (no subcommand) runs the Phase 21 analysis for backward compatibility.

### Extended BalanceReport Schema

```typescript
// Additions to the existing BalanceReport interface
interface BalanceReport {
  // ... existing fields from Phase 21 ...

  // Phase 22 additions
  ratings?: {
    hyperparameters: {
      initialRating: number;
      initialRd: number;
      initialVolatility: number;
      tau: number;
      phaseBoundaries: { earlyEnd: number; midEnd: number };
    };
    individual: {
      early: RatedEntity[];
      mid: RatedEntity[];
      late: RatedEntity[];
    };
    pairwise: RatedEntity[];
    frequentSets: RatedEntity[];
    outliers: OutlierReport;
  };
}

interface RatedEntity {
  id: string;
  name: string;
  rating: number;
  rd: number;
  volatility: number;
  provisional: boolean;  // RD > 150
  matchCount: number;
  pickRate: number;
  outlierFlags: string[];
}

interface OutlierReport {
  perPhase: {
    early: OutlierEntry[];
    mid: OutlierEntry[];
    late: OutlierEntry[];
  };
  overall: OutlierEntry[];
}

interface OutlierEntry {
  entityId: string;
  entityName: string;
  flags: string[];
  rating: number;
  rd: number;
  pickRate: number;
}
```

## Common Pitfalls

### Pitfall 1: Glicko-2 Scale Confusion
**What goes wrong:** Mixing the 1500-centered "display" scale with the 0-centered Glicko-2 internal scale during computation.
**Why it happens:** The algorithm operates on `mu = (rating - 1500) / 173.7178` internally but displays results on the 1500 scale.
**How to avoid:** All internal computation uses Glicko-2 scale (mu, phi). Convert to display scale ONLY at output. Keep `toGlicko2Scale()` and `fromGlicko2Scale()` as explicit conversion functions.
**Warning signs:** Ratings clustering near 0 instead of 1500, or RDs near 2 instead of 350.

### Pitfall 2: Volatility Iteration Non-Convergence
**What goes wrong:** Step 5's Illinois algorithm fails to converge or enters infinite loop.
**Why it happens:** Edge cases with very few matches or extreme rating differences can cause the bracketing to fail.
**How to avoid:** Cap iterations at 100 (Glickman's paper suggests convergence is fast). If not converged, use the midpoint of the current bracket. Add a test case verifying convergence on Glickman's paper example.
**Warning signs:** Functions running >50 iterations in Step 5.

### Pitfall 3: Empty Rating Pools
**What goes wrong:** A game phase has no builds (e.g., no late-game builds in short matches), producing an empty pool.
**Why it happens:** Match data may not cover all game phases, especially in short matches.
**How to avoid:** Skip empty pools gracefully. Report them as "insufficient data" rather than crashing. The pool computation function should handle zero encounters by returning all entities with unchanged (initial) ratings but increased RD.
**Warning signs:** Pools with 0 encounters for a phase.

### Pitfall 4: Cross-Team Self-Play Encounters
**What goes wrong:** Both teams use the same template, creating an encounter of template vs itself with both win and loss credit.
**Why it happens:** Template vocabulary is small (5 templates), so overlap is common.
**How to avoid:** This is actually correct behavior -- a template can have encounters against itself if both teams use it. The winning team's usage gets win credit, losing team's gets loss credit. Do NOT filter out self-encounters.
**Warning signs:** None -- self-encounters are expected and valid.

### Pitfall 5: Worker Thread Serialization of Maps
**What goes wrong:** `Map` objects cannot be serialized via `postMessage` (they become empty objects).
**Why it happens:** `postMessage` uses structured clone algorithm, which handles Maps, but converting to plain objects is more explicit and testable.
**How to avoid:** Convert all `Map<string, Glicko2Rating>` to `Array<{ id: string; rating: Glicko2Rating }>` before posting to workers. Reconstruct Maps in the main thread after receiving results.
**Warning signs:** Empty or missing rating data after worker thread returns.

### Pitfall 6: Log-Weight Edge Cases
**What goes wrong:** `log(1 + 0) = 0` means a template with 0 builds gets zero weight, which is correct. But `log(1 + 1) = 0.69` for a single build is quite small.
**Why it happens:** Logarithmic scaling compresses all values.
**How to avoid:** The credit model should multiply the fractional score (0/0.5/1) by the log weight. A single build yields `1.0 * 0.69 = 0.69` fractional win credit. This is intentional -- it correctly weights single-use templates lower than multi-use ones. Verify this behavior in tests.
**Warning signs:** All ratings converging to 1500 (insufficient differentiation).

## Code Examples

### Glicko-2 Core Functions
```typescript
// Source: Glickman's Glicko-2 paper (glicko.net/glicko/glicko2.pdf)

const SCALE_FACTOR = 173.7178; // 400 / ln(10)

function g(phi: number): number {
  return 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
}

function E(mu: number, muJ: number, phiJ: number): number {
  return 1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));
}

function computeVariance(
  mu: number,
  opponents: Array<{ mu: number; phi: number }>,
): number {
  let sum = 0;
  for (const opp of opponents) {
    const gPhi = g(opp.phi);
    const e = E(mu, opp.mu, opp.phi);
    sum += gPhi * gPhi * e * (1 - e);
  }
  return 1 / sum;
}
```

### Match-to-Encounter Extraction
```typescript
// Extract template encounters from a parsed match with optional tick range filter

function extractTemplateEncounters(
  match: ParsedMatch,
  tickRange?: { start: number; end: number },
): TemplateEncounter[] {
  const encounters: TemplateEncounter[] = [];

  // 1. Filter ticks to range
  const filteredTicks = tickRange
    ? match.ticks.filter(t => t.tick >= tickRange.start && t.tick < tickRange.end)
    : match.ticks;

  // 2. Count builds per template per team
  const teamBuilds = new Map<number, Map<string, number>>();
  for (const tick of filteredTicks) {
    for (const action of tick.actions) {
      if (action.actionType === 'build' && action.result === 'applied' && action.templateId) {
        if (!teamBuilds.has(action.teamId)) teamBuilds.set(action.teamId, new Map());
        const counts = teamBuilds.get(action.teamId)!;
        counts.set(action.templateId, (counts.get(action.templateId) ?? 0) + 1);
      }
    }
  }

  // 3. Determine teams and outcomes
  const teamIds = [...teamBuilds.keys()];
  if (teamIds.length < 2) return encounters;

  // 4. Generate cross-product encounters
  for (const teamA of teamIds) {
    for (const teamB of teamIds) {
      if (teamA === teamB) continue;
      const creditA = getWinCredit(match, teamA);
      const creditB = getWinCredit(match, teamB);
      const buildsA = teamBuilds.get(teamA)!;
      const buildsB = teamBuilds.get(teamB)!;

      for (const [templateA, countA] of buildsA) {
        for (const [templateB, countB] of buildsB) {
          encounters.push({
            templateA,
            templateB,
            scoreA: creditA,
            scoreB: creditB,
            weightA: Math.log(1 + countA),
            weightB: Math.log(1 + countB),
          });
        }
      }
    }
  }

  return encounters;
}
```

### Pairwise Combination Discovery
```typescript
// Extract pairwise template combinations from a match

function extractPairwiseCombinations(
  match: ParsedMatch,
  tickRange?: { start: number; end: number },
): Map<number, Set<string>> {
  // Returns Map<teamId, Set<pairId>> where pairId = "template1+template2" (sorted)
  const teamTemplates = extractTemplatesPerTeam(match, tickRange);
  const teamPairs = new Map<number, Set<string>>();

  for (const [teamId, templates] of teamTemplates) {
    const sorted = [...templates].sort();
    const pairs = new Set<string>();
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        pairs.add(`${sorted[i]}+${sorted[j]}`);
      }
    }
    teamPairs.set(teamId, pairs);
  }

  return teamPairs;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Elo rating | Glicko-2 | 2001/2013 | Adds RD (confidence) and volatility; better handles irregular play |
| Per-match update | Batch/period update | Glicko-2 design | More accurate when many games cluster in time |
| Win rate only | Win rate + Glicko-2 rating | Phase 22 addition | Ratings account for opponent strength; win rate alone doesn't |

**Deprecated/outdated:**
- Original Glicko (no volatility) -- superseded by Glicko-2
- Single-pool ratings (no game-phase awareness) -- Phase 22 adds phase-specific pools

## Open Questions

1. **Fractional scores in Glicko-2 with log weights**
   - What we know: Standard Glicko-2 uses binary scores (0, 0.5, 1). The D-01 credit model produces fractional scores weighted by `log(1 + buildCount)`.
   - What's unclear: Whether Glicko-2's math handles fractional scores correctly, or if they should be normalized to sum to 1 within each encounter.
   - Recommendation: Treat each weighted encounter as a separate match result. For a template with weight 1.79 (buildCount=5), create a single encounter with score 1.0 (win) or 0.0 (loss). The log weight affects how many "virtual matches" this template contributes -- use weight as a multiplier on the encounter count rather than the score itself. Validate with small test cases.

2. **Rating period definition**
   - What we know: Glicko-2 is designed for batch updates within rating periods. All matches in the analysis directory constitute match data.
   - What's unclear: Whether to treat all matches as a single period or split into multiple periods (e.g., per generation).
   - Recommendation: Start with single-period (all matches = one period). This is simplest and provides ratings at the "final" state of the meta. Per-generation periods can be added later if needed (each generation becomes a Glicko-2 period, with RD increasing between periods for inactive entities).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (root level) |
| Quick run command | `npx vitest run packages/bot-harness/analysis/glicko2-engine.test.ts` |
| Full suite command | `npm run test:unit` |

### Phase Requirements to Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BAL-04.1 | Glicko-2 core produces correct rating/RD/vol from paper example | unit | `npx vitest run packages/bot-harness/analysis/glicko2-engine.test.ts -x` | Wave 0 |
| BAL-04.2 | Match-to-encounter extraction with log-weighted credit | unit | `npx vitest run packages/bot-harness/analysis/rating-pool.test.ts -x` | Wave 0 |
| BAL-04.3 | Per-game-phase pool separation (early/mid/late) | unit | `npx vitest run packages/bot-harness/analysis/rating-pool.test.ts -x` | Wave 0 |
| BAL-04.4 | RD > 150 provisional flagging | unit | `npx vitest run packages/bot-harness/analysis/rating-pool.test.ts -x` | Wave 0 |
| BAL-04.5 | Pairwise combination extraction and rating | unit | `npx vitest run packages/bot-harness/analysis/combination-miner.test.ts -x` | Wave 0 |
| BAL-04.6 | Frequent-set mining and rating | unit | `npx vitest run packages/bot-harness/analysis/combination-miner.test.ts -x` | Wave 0 |
| BAL-04.7 | Outlier detection (SD-based + usage matrix) | unit | `npx vitest run packages/bot-harness/analysis/outlier-detector.test.ts -x` | Wave 0 |
| BAL-05.1 | CLI subcommand routing (ratings/report/all) | unit | `npx vitest run packages/bot-harness/analysis/balance-report.test.ts -x` | Wave 0 |
| BAL-05.2 | Extended BalanceReport JSON schema with ratings | unit | `npx vitest run packages/bot-harness/analysis/balance-report.test.ts -x` | Wave 0 |
| BAL-05.3 | Console formatter includes tier lists | unit | `npx vitest run packages/bot-harness/analysis/console-formatter.test.ts -x` | Extend existing |
| BAL-05.4 | Markdown formatter includes tier lists and outliers | unit | `npx vitest run packages/bot-harness/analysis/markdown-formatter.test.ts -x` | Extend existing |
| BAL-05.5 | Worker thread parallel computation produces same results as sequential | unit | `npx vitest run packages/bot-harness/analysis/rating-worker.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run packages/bot-harness/analysis/ -x`
- **Per wave merge:** `npm run test:unit`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/bot-harness/analysis/glicko2-engine.test.ts` -- covers BAL-04.1 (core algorithm correctness)
- [ ] `packages/bot-harness/analysis/rating-pool.test.ts` -- covers BAL-04.2, BAL-04.3, BAL-04.4
- [ ] `packages/bot-harness/analysis/combination-miner.test.ts` -- covers BAL-04.5, BAL-04.6
- [ ] `packages/bot-harness/analysis/outlier-detector.test.ts` -- covers BAL-04.7
- [ ] `packages/bot-harness/analysis/rating-worker.test.ts` -- covers BAL-05.5
- [ ] Extend existing `balance-report.test.ts` -- covers BAL-05.1, BAL-05.2

## Sources

### Primary (HIGH confidence)
- Glickman, M.E. (2013). "Example of the Glicko-2 system." glicko.net/glicko/glicko2.pdf -- definitive algorithm specification
- Wikipedia: Glicko rating system -- algorithm formulas, function definitions
- Existing codebase: `packages/bot-harness/analysis/` -- complete Phase 21 implementation providing extension points
- Existing codebase: `packages/bot-harness/training/training-worker.ts` -- worker thread pattern
- Existing codebase: `packages/rts-engine/structure.ts` -- 5 default templates (block, generator, glider, eater-1, gosper)

### Secondary (MEDIUM confidence)
- npm: `glicko2-lite` v5.0.0 -- verified API surface, options (tau, rating), function signature
- npm: `glicko2.ts` v1.3.2 -- TypeScript Glicko-2 with team support
- npm: `glicko2` v1.2.1 -- established JS implementation
- GitHub gist: "So You Want to Use Glicko-2 for Your Game's Ratings" -- practical guidance on period-based updates

### Tertiary (LOW confidence)
- npm: `node-apriori` v1.0.0, `node-fpgrowth` -- considered for frequent-set mining but rejected (7+ years unmaintained; brute-force is simpler for 5 templates)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- zero dependencies, extending existing Phase 21 code
- Architecture: HIGH -- module structure mirrors Phase 21 pattern; worker threads follow Phase 20 pattern
- Glicko-2 algorithm: HIGH -- well-documented public-domain algorithm; verified against Glickman paper and multiple implementations
- Pitfalls: HIGH -- identified from algorithm edge cases and project's worker thread experience
- Combination mining: MEDIUM -- brute-force approach is simple for 5 templates but untested pattern in this codebase
- Outlier detection: MEDIUM -- thresholds are discretionary (median vs mean-based cutoffs need tuning)

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable domain -- algorithm is unchanged since 2013)
