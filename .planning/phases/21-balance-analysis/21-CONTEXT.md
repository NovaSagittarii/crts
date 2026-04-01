# Phase 21: Balance Analysis - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Win rates and strategy distributions computable from accumulated NDJSON match data, revealing per-template and per-strategy balance insights. This phase delivers win rate analysis (three attribution methods), strategy classification (three methods), generational tracking, and a CLI with JSON + console + markdown output. It does NOT include Glicko-2 structure ratings (Phase 22), the balance report CLI for ratings (Phase 22 BAL-05), or the live bot adapter (Phase 23).

</domain>

<decisions>
## Implementation Decisions

### Win Rate Attribution
- **D-01:** Compute all three win rate perspectives for each template: (a) presence-based (matches won where template was built / matches where it was built), (b) usage-weighted (weighted by build frequency within matches), (c) first-build attribution (based on first N builds only, capturing opening strategy impact).
- **D-02:** Wilson score interval as primary confidence interval method. Bootstrap percentile available as an option for cases where distribution is skewed or Wilson is insufficient.
- **D-03:** Per-strategy win rates follow the same multi-perspective approach — apply the three attribution methods to identified strategy archetypes as well as individual templates.

### Strategy Classification
- **D-04:** Implement all three classification methods: feature-based rules, algorithmic clustering, and sequence pattern mining. Each provides a different lens on the data.
- **D-05:** Feature-based rules use Conway-appropriate metrics (NOT traditional RTS labels like "rush/turtle"): build timing/density, resource allocation patterns, territory expansion rate, structure diversity, proximity to enemy core, structure spread pattern. Combined into a multi-dimensional feature vector.
- **D-06:** Algorithmic clustering (k-means or similar) discovers emergent archetypes from data without presupposing what strategies look like. Validates or challenges the rule-based labels.
- **D-07:** Sequence pattern mining finds common build-order subsequences regardless of naming. Most granular view of strategy patterns.
- **D-08:** Key Conway-specific insight: "attack" is emergent from Conway grid dynamics, not a direct RTS action. Structure placement context determines offensive vs defensive value, so classification must operate on observable build metrics, not assumed intent.

### Analysis Output Format
- **D-09:** JSON as canonical output format — machine-readable, consumed by Phase 22's Glicko-2 engine.
- **D-10:** Console summary for quick human feedback when running the CLI.
- **D-11:** Markdown generation script that reads the JSON output and produces human-friendly .md reports for easier viewing/sharing.
- **D-12:** Single combined JSON file (e.g., `balance-report.json`) rather than separate files per analysis type. Split only if output size or repeated reading patterns motivate it later.

### Generational Tracking
- **D-13:** Checkpoint-based generation boundaries — each self-play checkpoint from Phase 20's opponent pool marks a generation. Tracks intra-run strategy evolution as the bot population improves.
- **D-14:** Track strategy frequency distribution per generation: which archetypes appear, at what rate, and how the mix shifts across checkpoints.
- **D-15:** Supports detecting convergence (dominant strategy = potential balance problem), cycling (healthy counter-play), and broken templates (usage spikes that persist across generations).

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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 18 Context (Match Data Source)
- `.planning/phases/18-headless-match-runner/18-CONTEXT.md` — NDJSON format (D-05/D-06), file organization `matches/<run-id>/match-<N>.ndjson` (D-08), full build orders per tick (template, position, transform, result)

### Phase 19 Context (Template Vocabulary)
- `.planning/phases/19-observation-action-and-reward-interface/19-CONTEXT.md` — ObservationEncoder, template enumeration via `createDefaultStructureTemplates()`

### Phase 20 Context (Training Data + Checkpoints)
- `.planning/phases/20-ppo-training-with-self-play/20-CONTEXT.md` — Self-play opponent pool with checkpoint promotion (D-05/D-06/D-07), training log NDJSON in `runs/<run-id>/` (D-09/D-10), checkpoint format (D-04)

### RTS Engine — Structure Templates
- `packages/rts-engine/structure.ts` — `StructureTemplate`, `createDefaultStructureTemplates()` — defines the template vocabulary being rated

### RTS Engine — Match Outcomes
- `packages/rts-engine/match-lifecycle.ts` — `MatchOutcome`, `TeamOutcomeSnapshot` (coreHp, territoryCellCount, buildStats)

### Bot Harness (Phases 18-20 deliver)
- `packages/bot-harness/` — HeadlessMatchRunner, NDJSON logging, BotEnvironment, training infrastructure

### Requirements
- `.planning/REQUIREMENTS.md` — BAL-02 (win rate analysis), BAL-03 (strategy distribution classifier)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phases 18-20, not yet built)
- Phase 18's NDJSON match logs — primary data source. Each line contains tick-level build orders (template, position, transform, result) and match outcome.
- Phase 20's `runs/<run-id>/` directory structure — contains checkpoint metadata and training logs that define generation boundaries.
- `createDefaultStructureTemplates()` — enumerates the template vocabulary; analysis needs this to map template IDs to names.
- `MatchOutcome` / `TeamOutcomeSnapshot` — defines what "winning" means for attribution.

### Established Patterns
- `packages/bot-harness` is the home package for all v0.0.4 code — extend it with analysis modules.
- NDJSON for data interchange (Phase 18 match logs, Phase 20 training logs) — analysis reads this format.
- CLI entry points via `bin/` scripts invocable with npx/tsx (Phase 18 D-13 pattern).
- Run-based directory organization: `matches/<run-id>/`, `runs/<run-id>/`.

### Integration Points
- Analysis CLI reads `matches/<run-id>/match-<N>.ndjson` files (Phase 18 output)
- Analysis CLI reads `runs/<run-id>/checkpoints/` metadata for generation boundaries (Phase 20 output)
- Analysis JSON output consumed by Phase 22's Glicko-2 rating engine
- Console summary provides quick feedback during/after training runs

</code_context>

<specifics>
## Specific Ideas

- Conway-specific insight: "attack" is emergent — a wall structure can be offensive depending on grid context. Strategy classification must use observable metrics (timing, economy, territory, diversity) rather than intent-based labels.
- All three win rate methods provide complementary views: presence-based for broad trends, usage-weighted for "spam to win" detection, first-build for opening meta analysis.
- The three classification methods serve different purposes: rules give human-readable labels, clustering discovers emergent patterns, sequence mining finds specific build-order recipes.
- Generational tracking is the bridge between Phase 20 (training) and Phase 22 (ratings) — it shows whether the meta is stable enough for Glicko-2 ratings to be meaningful.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 21-balance-analysis*
*Context gathered: 2026-04-01*
