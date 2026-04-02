# Phase 21: Balance Analysis - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-01
**Phase:** 21-balance-analysis
**Areas discussed:** Win rate attribution, Strategy classification, Analysis output format, Generational tracking

---

## Win Rate Attribution

### Q1: How should per-template win rates be computed?

| Option                       | Description                                                                                                                                | Selected |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| Presence-based (Recommended) | Template X win rate = matches won where X was built / matches where X was built. Simple, interpretable, standard in game balance analysis. |          |
| Usage-weighted               | Weight each match by how many times template X was built. Captures "spam this template to win" strategies but harder to interpret.         |          |
| First-build attribution      | Only count the first N builds in a match. Focuses on opening strategy impact, ignores late-game template usage.                            |          |
| **All of the above**         | **User selected: compute all three metrics**                                                                                               | ✓        |

**User's choice:** Calculate all metrics (presence, usage, and first-build)
**Notes:** User wanted a multi-dimensional view of template strength rather than picking one perspective.

### Q2: What confidence interval method for win rates?

| Option                              | Description                                                                            | Selected |
| ----------------------------------- | -------------------------------------------------------------------------------------- | -------- |
| Wilson score interval (Recommended) | Standard for proportion CIs with small samples. Well-behaved at extremes. Closed-form. | ✓        |
| Bootstrap percentile                | Resamples match outcomes to estimate CI. More flexible but computationally heavier.    |          |
| You decide                          | Claude picks the method.                                                               |          |

**User's choice:** Wilson score interval as primary, bootstrap available as option when needed
**Notes:** User wanted Wilson as default but wanted bootstrap available for edge cases.

---

## Strategy Classification

### Q3: How should build-order archetypes be identified?

| Option                            | Description                                                                           | Selected |
| --------------------------------- | ------------------------------------------------------------------------------------- | -------- |
| Feature-based rules (Recommended) | Define archetypes by measurable features. Interpretable, deterministic, easy to tune. |          |
| Algorithmic clustering            | k-means/DBSCAN on build-order feature vectors. Discovers archetypes from data.        |          |
| Sequence pattern mining           | Find common build-order subsequences. Most granular.                                  |          |
| **All of the above**              | **User selected: implement all three methods**                                        | ✓        |

**User's choice:** All three classification methods
**Notes:** User clarified that Conway RTS is nonstandard — "attackers" aren't direct RTS actions but emergent from Conway grid dynamics. Traditional labels (rush/turtle) don't map cleanly. All three methods provide complementary views: rules for human-readable labels, clustering for emergent patterns, sequences for specific recipes.

### Q4: For the feature-based rules layer, what observable metrics should define archetypes?

| Option                                     | Description                                                                                           | Selected |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------- | -------- |
| Build timing + economy focus (Recommended) | Classify by: early vs late builder, high-income vs low-income, structure density, template diversity. |          |
| Territory behavior                         | Classify by: territory growth rate, proximity to enemy core, structure spread pattern.                |          |
| All of the above                           | Combine timing, economy, and territory metrics into a multi-dimensional feature vector.               | ✓        |
| You decide                                 | Claude picks metrics from available match data fields.                                                |          |

**User's choice:** All of the above — multi-dimensional feature vector
**Notes:** None additional.

---

## Analysis Output Format

### Q5: What output format should the balance analysis CLI produce?

| Option                               | Description                                                               | Selected |
| ------------------------------------ | ------------------------------------------------------------------------- | -------- |
| JSON + console summary (Recommended) | Structured JSON for programmatic consumption. Console summary for humans. | ✓        |
| Markdown report                      | Generate .md file with tables and sections.                               |          |
| JSON only                            | Pure structured data.                                                     |          |

**User's choice:** JSON + console summary, with .md generation script from JSON for easier viewing experience
**Notes:** Three-tier output: JSON canonical, console for quick feedback, markdown generator script for human reports.

### Q6: Should analysis output be one combined JSON file or separate files per analysis type?

| Option                       | Description                                                      | Selected |
| ---------------------------- | ---------------------------------------------------------------- | -------- |
| Separate files (Recommended) | win-rates.json, strategies.json, etc. Each analysis independent. |          |
| Single combined file         | One balance-report.json with nested sections. Simpler to manage. | ✓        |
| You decide                   | Claude picks based on data relationships.                        |          |

**User's choice:** Combined file unless output size or repeated reading patterns motivate a split approach
**Notes:** Start simple with one file, split later if needed.

---

## Generational Tracking

### Q7: What defines a "generation" when tracking strategy frequency across training?

Initial question was rejected — user asked for clarification on what generational tracking is and how it applies to Conway RTS bots. After explanation of convergence detection, cycling identification, and broken template detection:

### Q8: How granular should generation tracking be?

| Option                         | Description                                                                     | Selected |
| ------------------------------ | ------------------------------------------------------------------------------- | -------- |
| Checkpoint-based (Recommended) | Each self-play checkpoint = one generation. Shows intra-run evolution.          | ✓        |
| Run-based                      | Each training run = one generation. Coarser — only between-session differences. |          |
| Both levels                    | Track at both checkpoint and run granularity.                                   |          |
| You decide                     | Claude picks based on Phase 20 data structure.                                  |          |

**User's choice:** Checkpoint-based (Recommended)
**Notes:** None additional.

---

## Claude's Discretion

- Exact feature-based rule thresholds and archetype labels
- Clustering algorithm choice and parameters
- Sequence pattern mining implementation details
- JSON schema field names and structure
- Console/markdown formatting
- CLI flag names and defaults
- Checkpoint metadata reading approach
- Internal module structure

## Deferred Ideas

None — discussion stayed within phase scope
