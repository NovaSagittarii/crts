# Phase 21: Balance Analysis - Research

**Researched:** 2026-04-01
**Domain:** Statistical analysis of match data (win rates, strategy classification, generational tracking)
**Confidence:** HIGH

## Summary

Phase 21 delivers offline balance analysis over NDJSON match logs produced by Phase 18's HeadlessMatchRunner and Phase 20's training pipeline. The core deliverables are: (1) per-template and per-strategy win rate computation with three attribution methods and confidence intervals, (2) strategy classification using three complementary methods (feature-based rules, k-means clustering, sequence pattern mining), (3) generational tracking of strategy frequency across training checkpoints, and (4) a CLI that reads any match log directory and produces JSON + console + markdown output.

All analysis code lives in `packages/bot-harness/` alongside the existing match runner and training infrastructure. The implementation is pure TypeScript with zero external dependencies for the statistical and clustering algorithms -- Wilson score interval, bootstrap percentile CI, k-means clustering, and PrefixSpan-style sequence mining are all simple enough to hand-roll in a few hundred lines each. The game's template vocabulary is small (5 templates: block, generator, glider, eater-1, gosper), making brute-force approaches to pattern mining viable.

**Primary recommendation:** Implement all statistical and ML algorithms from scratch in TypeScript (no npm dependencies). The algorithms are well-defined, the data volumes are small (hundreds to low thousands of matches), and zero-dependency aligns with the project's existing patterns. Fix the upstream data gap (build TickActionRecords missing templateId) before writing analysis code.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Compute all three win rate perspectives: (a) presence-based, (b) usage-weighted, (c) first-build attribution
- **D-02:** Wilson score interval as primary CI method. Bootstrap percentile as option for skewed distributions
- **D-03:** Per-strategy win rates follow the same three-perspective approach as per-template
- **D-04:** Implement all three classification methods: feature-based rules, algorithmic clustering, sequence pattern mining
- **D-05:** Feature-based rules use Conway-appropriate metrics (NOT traditional RTS labels): build timing/density, resource allocation, territory expansion, structure diversity, proximity to enemy core, structure spread pattern
- **D-06:** Algorithmic clustering (k-means or similar) discovers emergent archetypes from data
- **D-07:** Sequence pattern mining finds common build-order subsequences
- **D-08:** Classification must operate on observable build metrics, not assumed intent
- **D-09:** JSON as canonical output format, consumed by Phase 22's Glicko-2 engine
- **D-10:** Console summary for quick human feedback
- **D-11:** Markdown generation script reading JSON output
- **D-12:** Single combined JSON file (e.g., `balance-report.json`)
- **D-13:** Checkpoint-based generation boundaries from Phase 20's opponent pool
- **D-14:** Track strategy frequency distribution per generation
- **D-15:** Detect convergence, cycling, and broken templates across generations

### Claude's Discretion
- Exact feature-based rule thresholds and archetype labels
- Clustering algorithm choice (k-means vs DBSCAN vs other) and parameter tuning
- Sequence pattern mining implementation details (min support, max pattern length)
- JSON schema field names and nesting structure
- Console summary formatting and key findings selection
- Markdown template layout
- CLI flag names and defaults
- How checkpoint metadata is read from Phase 20's run directories
- Internal module structure within bot-harness for Phase 21 additions

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BAL-02 | Win rate analysis computes per-template and per-strategy win rates from the match database | Three attribution methods (presence, usage-weighted, first-build) with Wilson score CI; requires upstream fix to populate templateId in build TickActionRecords |
| BAL-03 | Strategy distribution classifier identifies and tracks build-order archetypes across training generations | Three classification methods (feature rules, k-means, sequence mining) with generational tracking using Phase 20 checkpoint boundaries |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript (project) | strict mode | All analysis code | Project standard |
| Vitest | (project version) | Unit tests | Project standard, co-located in packages/ |
| node:util parseArgs | built-in | CLI argument parsing | Phase 18/20 established pattern, zero dependencies |
| node:fs/promises | built-in | NDJSON file reading | Project standard |
| node:readline | built-in | Line-by-line NDJSON streaming | Memory-efficient for large match log directories |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Hand-rolled Wilson score | N/A | Confidence intervals | ~20 lines, well-defined formula |
| Hand-rolled k-means | N/A | Strategy clustering | ~100 lines, small feature vectors |
| Hand-rolled PrefixSpan | N/A | Sequence pattern mining | ~150 lines, small template vocab |
| Hand-rolled bootstrap | N/A | Alternative CI method | ~30 lines, simple resampling |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-rolled Wilson | `wilson-score-interval@2.1.0` npm | 20 lines vs dependency; formula is trivial |
| Hand-rolled k-means | `ml-kmeans@7.0.0` npm | Clean API but adds dependency for ~100 lines of code |
| Hand-rolled PrefixSpan | `@smartesting/vmsp@1.1.1` npm | Overkill for 5-template vocabulary; simpler to hand-roll |

**No installation needed.** All algorithms are implemented from scratch using Node.js built-ins.

## Architecture Patterns

### Recommended Project Structure
```
packages/bot-harness/
  analysis/                    # New directory for Phase 21
    index.ts                   # Barrel export
    match-log-reader.ts        # NDJSON parser -> structured match data
    win-rate-analyzer.ts       # Three attribution methods + CIs
    strategy-classifier.ts     # Feature extraction + rule-based classification
    clustering.ts              # k-means implementation + archetype discovery
    sequence-miner.ts          # Build-order subsequence mining
    generation-tracker.ts      # Checkpoint-based generational analysis
    balance-report.ts          # JSON report assembly
    console-formatter.ts       # Console summary output
    markdown-formatter.ts      # Markdown report generation
    stats.ts                   # Wilson score, bootstrap, basic statistics
    types.ts                   # All analysis interfaces
    match-log-reader.test.ts   # Tests co-located per project convention
    win-rate-analyzer.test.ts
    strategy-classifier.test.ts
    clustering.test.ts
    sequence-miner.test.ts
    generation-tracker.test.ts
    balance-report.test.ts
    stats.test.ts
  bin/
    analyze-balance.ts         # CLI entry point
```

### Pattern 1: NDJSON Match Log Reader
**What:** Streaming parser that reads match NDJSON files into structured in-memory representations.
**When to use:** Every analysis operation starts with reading match logs.
**Example:**
```typescript
// Source: Derived from existing match-logger.ts and types.ts patterns
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

interface ParsedMatch {
  header: MatchHeader;
  ticks: TickRecord[];
  outcome: MatchOutcomeRecord;
}

async function readMatchFile(filePath: string): Promise<ParsedMatch> {
  const lines: NdjsonLine[] = [];
  const rl = createInterface({ input: createReadStream(filePath) });
  for await (const line of rl) {
    if (line.trim()) {
      lines.push(JSON.parse(line) as NdjsonLine);
    }
  }
  // First line is header, last is outcome, middle are ticks
  return {
    header: lines[0] as MatchHeader,
    ticks: lines.slice(1, -1) as TickRecord[],
    outcome: lines[lines.length - 1] as MatchOutcomeRecord,
  };
}
```

### Pattern 2: Feature Vector Extraction
**What:** Extract Conway-specific build metrics from match tick records into a normalized feature vector for each team per match.
**When to use:** Input to both rule-based classification and k-means clustering.
**Example:**
```typescript
// Source: Derived from D-05 decision and existing TickActionRecord/TickEconomyRecord
interface StrategyFeatureVector {
  // Build timing / density
  firstBuildTick: number;       // When first successful build occurred
  buildDensity: number;         // Successful builds per 100 ticks
  buildBurstiness: number;      // Std dev of inter-build intervals

  // Resource allocation
  avgResourcesAtBuild: number;  // Mean resources when building
  resourceEfficiency: number;   // Applied / (applied + rejected) ratio

  // Territory
  territoryGrowthRate: number;  // Territory cells gained per 100 ticks
  finalTerritoryRatio: number;  // Team territory / total cells

  // Structure diversity
  uniqueTemplatesUsed: number;  // Count of distinct template IDs
  templateEntropy: number;      // Shannon entropy of template distribution

  // Spatial (if x/y available)
  avgDistanceToEnemy: number;   // Mean build distance to enemy core
  structureSpread: number;      // Std dev of build positions
}
```

### Pattern 3: Wilson Score Interval
**What:** Confidence interval for binomial proportions (win/loss).
**When to use:** Computing per-template and per-strategy win rate confidence intervals.
**Example:**
```typescript
// Source: Standard Wilson score formula (Wilson 1927)
interface ConfidenceInterval {
  lower: number;
  upper: number;
  center: number;
  n: number;
  z: number;
}

function wilsonScoreInterval(
  wins: number,
  total: number,
  confidence: number = 0.95,
): ConfidenceInterval {
  if (total === 0) {
    return { lower: 0, upper: 1, center: 0, n: 0, z: 0 };
  }
  // z-score for confidence level (1.96 for 95%)
  const z = zScoreForConfidence(confidence);
  const p = wins / total;
  const denominator = 1 + z * z / total;
  const center = (p + z * z / (2 * total)) / denominator;
  const margin =
    (z * Math.sqrt((p * (1 - p) + z * z / (4 * total)) / total)) / denominator;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    center,
    n: total,
    z,
  };
}
```

### Anti-Patterns to Avoid
- **Loading all match files into memory at once:** Stream files one at a time, extract features, discard raw data. A training run with 1000 matches at ~2000 ticks each could be 100MB+ of NDJSON.
- **Assuming templateId is always present in build actions:** The current data format has a known gap (see Critical Pitfall 1). Analysis must handle missing templateId gracefully.
- **Using traditional RTS strategy labels:** Conway-specific (D-08). Avoid "rush", "turtle", "macro" labels. Use observable metric-driven names like "early-builder", "diverse-placer", "generator-heavy".
- **Coupling analysis to live training runs:** Analysis must work against any NDJSON directory (Success Criterion 3). No imports from training coordinator or live state.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NDJSON parsing | Custom line parser with edge case handling | `readline.createInterface` + `JSON.parse` per line | Built-in, handles backpressure, line breaks correctly |
| File discovery | Custom recursive directory walker | `node:fs readdir` with simple glob matching | Match files follow predictable `match-*.ndjson` pattern |
| CLI argument parsing | Custom argv parser | `node:util parseArgs` | Project-established pattern (Phase 18, 20) |

**Key insight:** Statistical algorithms (Wilson, k-means, bootstrap) ARE worth hand-rolling here. They're well-defined, small, have no edge cases beyond empty/zero inputs, and the game's data volumes are tiny (5 templates, hundreds of matches). Adding npm dependencies would be pure overhead.

## Critical Data Gap: Build TickActionRecord Missing templateId

**This is the most important finding in this research.**

The current `TickActionRecord` for build actions does NOT include `templateId`, `x`, `y`, or `transform` fields. The `BuildOutcome` interface from `packages/rts-engine/rts.ts` (line 171) only contains: `eventId`, `teamId`, `outcome`, `reason`, `affordable`, `needed`, `current`, `deficit`, `executeTick`, `resolvedTick`. No template identification data.

The `mapBuildOutcomeToActionRecord` function in `packages/bot-harness/match-runner.ts` (line 72) maps only `teamId`, `actionType`, and `result`. The `templateId` field exists as optional on `TickActionRecord` but is never populated for builds.

**Impact:** Without templateId, Phase 21 cannot compute per-template win rates (BAL-02 core requirement).

**The fix:** The `createTickRecord` function already receives `_botActions: [BotAction[], BotAction[]]` and `_teamIds: [number, number]` parameters (line 94) but does not use them (underscore-prefixed). The bot actions contain `build.templateId`, `build.x`, `build.y`, `build.transform`. The fix is to correlate bot build actions with build outcomes by matching teamId and tick, or to directly log the queued build payloads alongside outcomes.

**Recommendation:** Phase 21's first task should fix `createTickRecord` to populate templateId/x/y/transform from the bot actions. This is a backward-compatible enhancement to the match runner (existing fields become populated). Existing match logs without templateId should still be processable (with degraded analysis: template-level breakdown unavailable, match-level win rates still computable).

The `TickActionRecord` interface already has the optional fields:
```typescript
interface TickActionRecord {
  teamId: number;
  actionType: 'build' | 'destroy';
  templateId?: string;  // Already defined, never set for builds
  x?: number;           // Already defined, never set for builds
  y?: number;           // Already defined, never set for builds
  transform?: unknown;  // Already defined, never set for builds
  result: string;
  structureKey?: string;
}
```

**This is documented in STATE.md:** "Phase 18: BuildOutcome from RtsRoom lacks templateId/x/y/transform; TickActionRecord maps from outcome status fields only for builds"

## Common Pitfalls

### Pitfall 1: Missing Template IDs in Build Actions
**What goes wrong:** Analysis code assumes every build TickActionRecord has a templateId, crashes or produces empty results on existing match logs.
**Why it happens:** Known data gap from Phase 18 (see Critical Data Gap section above).
**How to avoid:** (1) Fix the data gap in createTickRecord, (2) Make all analysis code handle missing templateId gracefully with null checks, (3) Clearly report when matches lack template data.
**Warning signs:** Empty template win rate tables, zero-count template appearances.

### Pitfall 2: Division by Zero in Win Rate Calculations
**What goes wrong:** Templates/strategies with zero matches cause NaN/Infinity in win rate calculations.
**Why it happens:** Wilson score formula divides by total matches; some templates may never be used in a match set.
**How to avoid:** Guard all division with `total === 0` checks. Wilson score interval naturally handles this (return [0, 1] interval). Filter out zero-count entries from reports.
**Warning signs:** NaN values in JSON output, console display showing "NaN%".

### Pitfall 3: Small Sample Sizes Producing Misleading Confidence Intervals
**What goes wrong:** A template used in 3 matches with 3 wins shows "100% win rate" with a tight-looking CI.
**Why it happens:** Wilson score CIs are wide for small n, but users may not read the CI -- they see the center estimate.
**How to avoid:** Always display confidence intervals alongside point estimates. Include n (sample size) in output. Consider adding a "minimum matches" threshold for reporting (e.g., 10 matches minimum to show a template's win rate).
**Warning signs:** Templates with n < 10 shown as top-performing.

### Pitfall 4: K-Means Instability with Random Initialization
**What goes wrong:** Different runs of k-means produce different cluster assignments, making generational tracking inconsistent.
**Why it happens:** K-means depends on initial centroid placement. With small datasets, different initializations can produce very different clusters.
**How to avoid:** Use k-means++ initialization (deterministic selection biased toward spread centroids). Run multiple initializations (e.g., 10) and pick the best by within-cluster sum of squares. Use a fixed random seed for reproducibility.
**Warning signs:** Archetype labels change between analysis runs on the same data.

### Pitfall 5: Sequence Mining Combinatorial Explosion
**What goes wrong:** With long matches (2000 ticks), mining all subsequences is computationally expensive.
**Why it happens:** The number of possible subsequences grows exponentially with sequence length.
**How to avoid:** The template vocabulary is only 5 items, which bounds the combinatorial space dramatically. Set reasonable max pattern length (e.g., 8-10 templates). Use minimum support threshold (e.g., 5% of matches). Consider only the first N builds per match (aligns with D-01c first-build attribution).
**Warning signs:** Analysis takes > 30 seconds for a few hundred matches.

### Pitfall 6: Generational Boundaries Not Found
**What goes wrong:** The CLI cannot find checkpoint metadata in the run directory, so generational tracking produces empty results.
**Why it happens:** Phase 20's checkpoint directory structure may vary. The analysis CLI needs to read `runs/<run-id>/checkpoints/` and find checkpoint episode numbers.
**How to avoid:** Document the expected checkpoint directory layout. Provide clear error messages when checkpoints not found. Make generational tracking optional (analysis still works without it, just no generation breakdown).
**Warning signs:** "No checkpoints found" warnings, empty generational data in output.

### Pitfall 7: Coupling to Training Runtime
**What goes wrong:** Analysis code imports from training modules, creating unnecessary dependencies and breaking Success Criterion 3 (analysis runs against any NDJSON directory).
**Why it happens:** Convenient to reuse training types/utilities.
**How to avoid:** Analysis modules should only import from types.ts (shared NDJSON types) and rts-engine (template definitions). No imports from training/ directory. The analysis CLI reads files, not runtime state.
**Warning signs:** Import paths referencing `./training/`, `@tensorflow/tfjs`, or `BotEnvironment`.

## Code Examples

### Reading All Matches from a Run Directory
```typescript
// Source: Derived from Phase 18 match-logger.ts file organization pattern
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

async function discoverMatchFiles(matchDir: string): Promise<string[]> {
  const entries = await readdir(matchDir);
  return entries
    .filter((e) => e.startsWith('match-') && e.endsWith('.ndjson'))
    .sort((a, b) => {
      // Sort by match index numerically
      const numA = parseInt(a.replace('match-', '').replace('.ndjson', ''), 10);
      const numB = parseInt(b.replace('match-', '').replace('.ndjson', ''), 10);
      return numA - numB;
    })
    .map((e) => join(matchDir, e));
}
```

### Bootstrap Percentile Confidence Interval
```typescript
// Source: Standard bootstrap percentile method
function bootstrapPercentileCI(
  wins: number,
  total: number,
  confidence: number = 0.95,
  iterations: number = 10000,
  seed?: number,
): ConfidenceInterval {
  if (total === 0) {
    return { lower: 0, upper: 1, center: 0, n: 0, z: 0 };
  }
  const p = wins / total;
  const rng = seed !== undefined ? seededRng(seed) : Math.random;
  const samples: number[] = [];

  for (let i = 0; i < iterations; i++) {
    let resampledWins = 0;
    for (let j = 0; j < total; j++) {
      if (rng() < p) resampledWins++;
    }
    samples.push(resampledWins / total);
  }
  samples.sort((a, b) => a - b);

  const alpha = (1 - confidence) / 2;
  const lowerIdx = Math.floor(alpha * iterations);
  const upperIdx = Math.floor((1 - alpha) * iterations);
  return {
    lower: samples[lowerIdx],
    upper: samples[upperIdx],
    center: p,
    n: total,
    z: 0,
  };
}
```

### K-Means Clustering (Minimal)
```typescript
// Source: Standard k-means++ with Lloyd's algorithm
interface KMeansResult {
  centroids: number[][];
  assignments: number[];
  iterations: number;
  wcss: number; // Within-cluster sum of squares
}

function kMeans(
  data: number[][],
  k: number,
  maxIterations: number = 100,
): KMeansResult {
  const dims = data[0].length;
  // k-means++ initialization
  const centroids = kMeansPlusPlus(data, k);
  let assignments = new Array(data.length).fill(0);

  for (let iter = 0; iter < maxIterations; iter++) {
    // Assign points to nearest centroid
    const newAssignments = data.map((point) =>
      nearestCentroid(point, centroids),
    );
    // Check convergence
    if (arraysEqual(assignments, newAssignments)) {
      return { centroids, assignments, iterations: iter, wcss: computeWCSS(data, centroids, assignments) };
    }
    assignments = newAssignments;
    // Update centroids
    for (let c = 0; c < k; c++) {
      const clusterPoints = data.filter((_, i) => assignments[i] === c);
      if (clusterPoints.length > 0) {
        for (let d = 0; d < dims; d++) {
          centroids[c][d] = clusterPoints.reduce((sum, p) => sum + p[d], 0) / clusterPoints.length;
        }
      }
    }
  }
  return { centroids, assignments, iterations: maxIterations, wcss: computeWCSS(data, centroids, assignments) };
}
```

### CLI Entry Point Pattern
```typescript
// Source: Follows Phase 18/20 CLI pattern with node:util parseArgs
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    'match-dir': { type: 'string' },
    'run-dir': { type: 'string' },
    'output': { type: 'string', short: 'o' },
    'format': { type: 'string', short: 'f' }, // json | console | markdown | all
    'confidence': { type: 'string' },
    'min-matches': { type: 'string' },
    'max-pattern-length': { type: 'string' },
    'k': { type: 'string' }, // Number of clusters
    help: { type: 'boolean', short: 'h' },
  },
  strict: true,
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Wald (normal approx) CI | Wilson score interval | Long established, but recently emphasized in ML eval | Better coverage for small n and extreme p; stays in [0,1] |
| Manual strategy labeling | Data-driven clustering + rule-based hybrid | Common in game analytics | Discovers archetypes without presupposing categories |
| Single win rate metric | Multi-perspective attribution (presence, usage-weighted, first-build) | Modern game balance analysis | Catches different imbalance types (dominant strategies vs opening advantages) |

**Deprecated/outdated:**
- Normal approximation (Wald) CI for proportions with small samples -- use Wilson score instead
- Single fixed strategy categories -- use data-driven discovery

## Open Questions

1. **Exact checkpoint directory structure from Phase 20**
   - What we know: Phase 20 saves checkpoints to `runs/<run-id>/checkpoints/checkpoint-<episode>/` via OpponentPool.saveCheckpoint()
   - What's unclear: Whether checkpoint directories contain metadata files (e.g., episode number, timestamp) beyond TF.js model files, or if the episode number must be parsed from the directory name
   - Recommendation: Parse episode number from directory name `checkpoint-<N>`. This matches the `addCheckpoint` implementation which uses `checkpoint-${String(episode)}` naming. Read `runs/<run-id>/config.json` for run-level metadata.

2. **Optimal number of clusters (k) for strategy classification**
   - What we know: With only 5 templates, the strategy space is bounded. Elbow method or silhouette score can guide k selection.
   - What's unclear: What k values will emerge as meaningful for Conway RTS strategies
   - Recommendation: Default k=4 (a reasonable starting point for a 5-template game). Provide `--k` CLI flag. Implement elbow method as optional diagnostic.

3. **How to handle draws in win rate attribution**
   - What we know: Matches end in draw when maxTicks reached without a core being destroyed. Both teams have `isDraw: true`.
   - What's unclear: Whether draws count as 0.5 wins or are excluded from win rate calculations
   - Recommendation: Count draws as 0.5 wins (standard in game balance analysis). This is a half-win for both teams. Document this clearly.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (project standard) |
| Config file | `vitest.config.ts` (exists, includes #bot-harness alias) |
| Quick run command | `npx vitest run packages/bot-harness/analysis/` |
| Full suite command | `npm run test:unit` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BAL-02 | Presence-based win rate computation | unit | `npx vitest run packages/bot-harness/analysis/win-rate-analyzer.test.ts -x` | Wave 0 |
| BAL-02 | Usage-weighted win rate computation | unit | `npx vitest run packages/bot-harness/analysis/win-rate-analyzer.test.ts -x` | Wave 0 |
| BAL-02 | First-build attribution win rate | unit | `npx vitest run packages/bot-harness/analysis/win-rate-analyzer.test.ts -x` | Wave 0 |
| BAL-02 | Wilson score CI correctness | unit | `npx vitest run packages/bot-harness/analysis/stats.test.ts -x` | Wave 0 |
| BAL-02 | Bootstrap percentile CI | unit | `npx vitest run packages/bot-harness/analysis/stats.test.ts -x` | Wave 0 |
| BAL-03 | Feature extraction from tick records | unit | `npx vitest run packages/bot-harness/analysis/strategy-classifier.test.ts -x` | Wave 0 |
| BAL-03 | Rule-based strategy classification | unit | `npx vitest run packages/bot-harness/analysis/strategy-classifier.test.ts -x` | Wave 0 |
| BAL-03 | K-means clustering produces stable assignments | unit | `npx vitest run packages/bot-harness/analysis/clustering.test.ts -x` | Wave 0 |
| BAL-03 | Sequence pattern mining finds known patterns | unit | `npx vitest run packages/bot-harness/analysis/sequence-miner.test.ts -x` | Wave 0 |
| BAL-03 | Generational tracking across checkpoints | unit | `npx vitest run packages/bot-harness/analysis/generation-tracker.test.ts -x` | Wave 0 |
| BAL-02/03 | NDJSON match log reading | unit | `npx vitest run packages/bot-harness/analysis/match-log-reader.test.ts -x` | Wave 0 |
| BAL-02/03 | JSON report assembly | unit | `npx vitest run packages/bot-harness/analysis/balance-report.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run packages/bot-harness/analysis/ -x`
- **Per wave merge:** `npm run test:unit`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/bot-harness/analysis/stats.test.ts` -- Wilson score + bootstrap CI tests
- [ ] `packages/bot-harness/analysis/win-rate-analyzer.test.ts` -- three attribution methods
- [ ] `packages/bot-harness/analysis/match-log-reader.test.ts` -- NDJSON parsing
- [ ] `packages/bot-harness/analysis/strategy-classifier.test.ts` -- feature extraction + rules
- [ ] `packages/bot-harness/analysis/clustering.test.ts` -- k-means correctness
- [ ] `packages/bot-harness/analysis/sequence-miner.test.ts` -- pattern mining
- [ ] `packages/bot-harness/analysis/generation-tracker.test.ts` -- checkpoint boundaries
- [ ] `packages/bot-harness/analysis/balance-report.test.ts` -- JSON assembly

## Project Constraints (from CLAUDE.md)

- **Strict TypeScript mode:** avoid `any`, explicit return types for exported functions
- **Explicit `.js` extensions** in relative imports
- **Interfaces for object shapes; type aliases for unions**
- **Layer boundaries:** `packages/*` must never import from `apps/*`
- **Import alias:** use `#bot-harness`, `#rts-engine`, `#conway-core`
- **Test placement:** Deterministic unit tests co-located in `packages/*`
- **Conventional Commits** for git messages
- **Keep `npm run lint` passing** (ESLint + typescript-eslint recommendedTypeChecked)
- **`conway-rts/`** is legacy -- do not edit

## Sources

### Primary (HIGH confidence)
- `packages/bot-harness/types.ts` -- NDJSON line types (MatchHeader, TickRecord, TickActionRecord, MatchOutcomeRecord)
- `packages/bot-harness/match-runner.ts` -- createTickRecord function showing _botActions unused (data gap)
- `packages/bot-harness/match-logger.ts` -- MatchLogger write pattern, file organization
- `packages/rts-engine/rts.ts` lines 171-182 -- BuildOutcome interface (no templateId)
- `packages/rts-engine/structure.ts` line 475 -- createDefaultStructureTemplates() with 5 templates
- `packages/rts-engine/match-lifecycle.ts` -- RankedTeamOutcome, MatchOutcome interfaces
- `packages/bot-harness/training/opponent-pool.ts` -- checkpoint naming pattern `checkpoint-${episode}`
- `packages/bot-harness/training/training-config.ts` -- SelfPlayConfig, checkpoint interval
- `packages/bot-harness/training/training-logger.ts` -- Run directory structure
- `.planning/STATE.md` -- "BuildOutcome from RtsRoom lacks templateId/x/y/transform"

### Secondary (MEDIUM confidence)
- [wilson-score-interval npm](https://www.npmjs.com/package/wilson-score-interval) -- Wilson score formula reference (v2.1.0)
- [Wilson Score Interval guide](https://insightful-data-lab.com/2025/08/20/wilson-score-interval/) -- Formula verification
- [ml-kmeans npm](https://www.npmjs.com/package/ml-kmeans) -- k-means API reference (v7.0.0)
- [@smartesting/vmsp npm](https://www.npmjs.com/package/@smartesting/vmsp) -- VMSP algorithm reference (v1.1.1)
- [Sequential pattern mining (Wikipedia)](https://en.wikipedia.org/wiki/Sequential_pattern_mining) -- Algorithm survey

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all code is hand-rolled TypeScript using Node.js built-ins, no external dependencies to verify
- Architecture: HIGH -- follows established bot-harness package patterns from Phase 18/20, module structure is straightforward
- Pitfalls: HIGH -- Critical data gap verified by reading source code; statistical edge cases well-understood
- Data format: HIGH -- Read actual TypeScript interfaces and implementation; confirmed templateId gap from multiple sources

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable domain, no fast-moving dependencies)
