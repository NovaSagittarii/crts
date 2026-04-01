# Phase 22: Structure Strength Ratings - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-01
**Phase:** 22-structure-strength-ratings
**Areas discussed:** Glicko-2 match modeling, Combination ratings, Balance outlier detection, Report CLI scope

---

## Glicko-2 Match Modeling

### Q1: How should template-level 'matches' be derived from team-level outcomes?

| Option | Description | Selected |
|--------|-------------|----------|
| Credit-all | Every template on winning team gets a 'win' vs every template on losing team. Simple but treats all templates equally. | |
| Weighted by usage | Fractional credit proportional to build frequency. Captures 'workhorse' templates. | |
| Head-to-head proximity | Only templates near each other on grid 'compete.' Most accurate for Conway dynamics but complex. | |
| **Log-weighted usage** | **User specified: weighted by usage with logarithmic scoring function** | ✓ |

**User's choice:** Weighted by usage with logarithmic scoring function (e.g., `log(1 + buildCount)`)
**Notes:** User clarified that logarithmic weighting is appropriate — diminishing returns on repeated builds of the same template. First build matters most, spam adds less signal.

### Q2: Should log-weighted credit also factor in build timing?

| Option | Description | Selected |
|--------|-------------|----------|
| No, usage count only (Recommended) | Log-weighted by build count only. Phase 21 already tracks first-build attribution separately. | |
| Yes, time-decay weighting | Earlier builds get more credit via decay factor. | |
| You decide | Claude picks. | |
| **Per-phase tier lists** | **User specified: separate scoring systems for early/mid/late game, configurable time ranges** | ✓ |

**User's choice:** Different scoring systems (early-game, mid-game, late-game) to produce multiple tier lists. Configurable time ranges.
**Notes:** Instead of a single time-decay function, the user wanted separate Glicko-2 rating pools per game phase, each producing its own tier list. More actionable for balance tuning.

---

## Combination Ratings

### Q3: How should template 'combinations' be defined?

| Option | Description | Selected |
|--------|-------------|----------|
| Pairwise combos (Recommended) | Rate every 2-template pair. Manageable combinations, shows synergies. | ✓ |
| Full build-order sets | Entire set of templates as one 'combination.' Combinatorial explosion risk. | |
| Top-K frequent sets | Mine frequent itemsets, rate only common combinations. Data-driven. | ✓ |

**User's choice:** Pairwise combos as primary, plus top-K frequent sets as secondary. Configurable analysis.
**Notes:** Both approaches, with frequent-set mining discovering higher-order combos beyond pairs.

### Q4: Should combination ratings split by game phase (early/mid/late)?

| Option | Description | Selected |
|--------|-------------|----------|
| Individual only (Recommended) | Game-phase splits for individual templates only. Combinations rated across full match. Avoids data sparsity. | ✓ |
| Both split | Phase splits for both. More granular but combinations may be too sparse per phase. | |
| You decide | Claude picks. | |

**User's choice:** Individual only, configurable (can enable per-phase combination ratings via config if data supports it)
**Notes:** None additional.

---

## Balance Outlier Detection

### Q5: What should trigger flagging a template as a balance outlier?

| Option | Description | Selected |
|--------|-------------|----------|
| Statistical deviation (Recommended) | Rating >2 SD from mean. Pure statistical outlier detection. | ✓ |
| Rating + usage combined | High rating + high pick rate = dominant. High rating + low pick rate = niche. Low rating + high pick rate = trap. Richer taxonomy. | ✓ |
| Configurable thresholds | User sets thresholds. Most flexible but needs tuning. | |

**User's choice:** Both methods as separate flags in the report. Templates can carry multiple flags.
**Notes:** None additional.

### Q6: Should outlier detection apply per game phase?

| Option | Description | Selected |
|--------|-------------|----------|
| Per game phase (Recommended) | Flag outliers within each tier list. Captures phase-specific balance issues. | ✓ |
| Overall only | Aggregate ratings only. Simpler. | |
| You decide | Claude picks. | |

**User's choice:** Per game phase (Recommended)
**Notes:** None additional.

---

## Report CLI Scope

### Q7: How should Phase 22's CLI relate to Phase 21's?

| Option | Description | Selected |
|--------|-------------|----------|
| Extend Phase 21's CLI (Recommended) | Add subcommands: `analyze ratings`, `analyze report`. Single entry point. | ✓ |
| Separate CLI tool | New `bin/balance-report.ts`. Clean separation but duplicates infrastructure. | |
| Pipeline approach | Phase 21 produces JSON, Phase 22 consumes it. Decoupled but two commands. | |

**User's choice:** Extend Phase 21's CLI (Recommended)
**Notes:** None additional.

### Q8: Should the CLI include a full pipeline mode?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, full pipeline mode (Recommended) | `analyze all` runs win rates, strategy classification, Glicko-2, and report in one command. | ✓ |
| No, keep subcommands separate | User runs each step explicitly. More control. | |
| You decide | Claude picks. | |

**User's choice:** Yes, full pipeline mode (Recommended)
**Notes:** None additional.

---

## Additional Decision (post-discussion)

**User specified:** Glicko-2 analysis must use multithreaded methods (worker_threads) for computational efficiency. Each independent rating pool is a natural parallelization target.

---

## Claude's Discretion

- Default game-phase tick boundaries
- Glicko-2 hyperparameters
- Frequent-set mining algorithm and parameters
- Outlier detection thresholds
- Worker thread parallelization strategy
- CLI flag names and defaults
- Report formatting and presentation
- Internal module structure

## Deferred Ideas

None — discussion stayed within phase scope
