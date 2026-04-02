# Phase 22: Structure Strength Ratings - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Glicko-2 ratings for individual structure templates and template combinations, with per-game-phase tier lists (early/mid/late), balance outlier detection, and a CLI balance report summarizing the competitive meta. This phase delivers the Glicko-2 rating engine, combination rating system, outlier detection, and extends Phase 21's analysis CLI with rating and report subcommands. It does NOT include the live game bot adapter (Phase 23) or any game balance changes based on findings.

</domain>

<decisions>
## Implementation Decisions

### Glicko-2 Match Modeling

- **D-01:** Template-vs-template encounters extracted from team-level match outcomes. Winning team's templates earn fractional wins against losing team's templates, weighted by `log(1 + buildCount)` for each template. Logarithmic scoring captures diminishing returns — first build matters most, spam adds less signal.
- **D-02:** Separate Glicko-2 rating pools per game phase: early, mid, late. Only builds within each configurable tick-range window contribute to that pool's ratings. Produces three independent tier lists per template.
- **D-03:** Configurable game-phase boundaries (e.g., ticks 0-200 = early, 200-600 = mid, 600+ = late). Defaults chosen by Claude, tunable via CLI flags.
- **D-04:** Templates with insufficient data (RD > 150) flagged as provisional rather than reported as definitive ratings. Per success criterion #2.
- **D-05:** Two-level parallelism for Glicko-2 computation via worker threads:
  - (a) **Across pools:** Each rating pool (early/mid/late × individual/pairwise/frequent-set) runs as an independent Glicko-2 pass in its own worker thread.
  - (b) **Within pools:** For larger pools (pairwise combos, frequent sets), partition the per-period entity update step across worker threads. Glicko-2 batch updates are embarrassingly parallel — each entity's new rating depends only on its current rating + opponents' pre-update ratings, with no cross-entity dependency within a period. Individual template pools (small N) may not need intra-pool parallelism; combination pools (N² pairs, hundreds of frequent sets) benefit from it.

### Combination Ratings

- **D-06:** Pairwise combinations as primary model — rate every 2-template pair that co-occurs in a match. Manageable combinatorial space, shows synergies and anti-synergies.
- **D-07:** Top-K frequent set mining as secondary model — discover higher-order combinations (3+ templates) that appear frequently. Configurable min support and max set size parameters.
- **D-08:** Both pairwise and frequent-set combinations get their own Glicko-2 ratings using the same log-weighted credit model as individual templates.
- **D-09:** Game-phase splits for individual template ratings only. Combination ratings computed across the full match by default. Configurable flag to enable per-phase combination ratings if data volume supports it.

### Balance Outlier Detection

- **D-10:** Two independent outlier detection methods, both reported as separate flags:
  - (a) Statistical deviation: templates whose Glicko-2 rating is >2 standard deviations from the mean within their rating pool.
  - (b) Rating + usage matrix: categorizes templates as dominant (high rating + high pick rate), niche strong (high rating + low pick rate), or trap (low rating + high pick rate).
- **D-11:** Outlier detection runs per game phase. A template can be flagged as overpowered in early game but balanced overall — actionable for targeted balance tuning.
- **D-12:** Templates can carry multiple flags simultaneously. Flags are additive, not exclusive.

### Report CLI Scope

- **D-13:** Extend Phase 21's analysis CLI with new subcommands: `analyze ratings` (run Glicko-2 engine), `analyze report` (generate full balance report). Single entry point, shared infrastructure.
- **D-14:** Full pipeline mode: `analyze all` runs win rates, strategy classification, Glicko-2 ratings, and report generation in one command. One invocation for the complete balance picture.
- **D-15:** Report output follows Phase 21's three-tier pattern: JSON canonical (extended with ratings, outlier flags), console summary, markdown generator.
- **D-16:** Ratings data added to Phase 21's combined JSON file (extended schema, not a separate file). Report generation reads the combined JSON.

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

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 21 Context (Analysis Infrastructure)

- `.planning/phases/21-balance-analysis/21-CONTEXT.md` — Win rate analysis (three perspectives), strategy classification (three methods), JSON output format, CLI structure, generational tracking

### Phase 18 Context (Match Data Source)

- `.planning/phases/18-headless-match-runner/18-CONTEXT.md` — NDJSON match log format (D-05/D-06), file organization, full build orders per tick

### Phase 20 Context (Training Data)

- `.planning/phases/20-ppo-training-with-self-play/20-CONTEXT.md` — Self-play checkpoints as generation boundaries, run directory structure

### RTS Engine — Structure Templates

- `packages/rts-engine/structure.ts` — `StructureTemplate`, `createDefaultStructureTemplates()` — defines the template vocabulary being rated

### RTS Engine — Match Outcomes

- `packages/rts-engine/match-lifecycle.ts` — `MatchOutcome`, `TeamOutcomeSnapshot` (coreHp, territoryCellCount, buildStats)

### Bot Harness (Phases 18-21 deliver)

- `packages/bot-harness/` — HeadlessMatchRunner, NDJSON logging, BotEnvironment, analysis CLI, win rate analysis, strategy classification

### Requirements

- `.planning/REQUIREMENTS.md` — BAL-04 (Glicko-2 rating engine), BAL-05 (balance report CLI)

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets (from Phases 18-21, not yet built)

- Phase 21's combined JSON output — primary data source for Glicko-2 ratings
- Phase 21's analysis CLI — extend with new subcommands
- Phase 21's markdown generator — extend with ratings/report sections
- Phase 18's NDJSON match logs — raw data for build-order extraction
- `createDefaultStructureTemplates()` — enumerates template vocabulary
- Phase 20's worker_threads infrastructure — pattern for parallelizing Glicko-2 computation

### Established Patterns

- `packages/bot-harness` is the home package for all v0.0.4 code
- NDJSON for data interchange, JSON for analysis output
- CLI entry points via `bin/` scripts with configurable flags
- Worker threads for CPU-intensive computation (Phase 20 D-13/D-14)
- Three-tier output: JSON canonical, console summary, markdown generator (Phase 21 D-09/D-10/D-11)

### Integration Points

- Reads Phase 21's combined JSON (win rates, strategies, generational data)
- Reads Phase 18's NDJSON match logs for build-order extraction
- Extends Phase 21's CLI with `analyze ratings`, `analyze report`, `analyze all`
- Extends Phase 21's combined JSON schema with ratings, outlier flags, tier lists
- Report output consumable by humans for balance tuning decisions

</code_context>

<specifics>
## Specific Ideas

- Logarithmic scoring (`log(1 + buildCount)`) prevents template spam from dominating ratings — first build of a template carries the most signal.
- Three-tier-list approach (early/mid/late) surfaces phase-specific balance issues: a template overpowered in early game but balanced overall is exactly the nuance needed for targeted balance tuning.
- Pairwise combos + frequent-set mining covers both known synergies (template A + B) and emergent higher-order combos discovered from data.
- The rating + usage outlier matrix (dominant/niche/trap) provides game-design-meaningful categories beyond pure statistical deviation.
- Worker thread parallelization is natural here: each independent rating pool (game phase × entity type) can run as its own Glicko-2 pass.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 22-structure-strength-ratings_
_Context gathered: 2026-04-01_
