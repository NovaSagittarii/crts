# Phase 20: PPO Training with Self-Play - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-01
**Phase:** 20-ppo-training-with-self-play
**Areas discussed:** Network architecture, Self-play opponent pool, Training CLI & config, Worker parallelism

---

## Network Architecture

### Q1: What network architecture?

| Option               | Description                                                                    | Selected |
| -------------------- | ------------------------------------------------------------------------------ | -------- |
| Small CNN + MLP head | 2-3 conv layers + flatten + concat scalars + shared trunk + policy/value heads | ✓        |
| Pure MLP             | Flatten everything. Simpler, loses spatial structure.                          |          |
| You decide           | Claude picks.                                                                  |          |

**User's choice:** Small CNN + MLP head

### Q2: Shared or separate policy/value networks?

| Option                       | Description                                                        | Selected |
| ---------------------------- | ------------------------------------------------------------------ | -------- |
| Shared trunk, separate heads | One backbone, branch into policy + value. Efficient.               | ✓        |
| Fully separate networks      | Independent networks. Doubles cost, no benefit at this complexity. |          |

**User's choice:** Shared trunk, separate heads
**Notes:** User asked about game complexity to validate this choice. Analysis: ~32K obs dimensions, ~5K actions, moderate strategic depth. Separate networks not justified — would double CPU cost for no representational benefit.

### Q3: Checkpoint format?

| Option             | Description                              | Selected |
| ------------------ | ---------------------------------------- | -------- |
| TF.js SavedModel   | Native format, JSON + binary weights.    | ✓        |
| Custom weight dump | Raw binary/JSON. No benefit over native. |          |
| You decide         | Claude picks.                            |          |

**User's choice:** TF.js SavedModel format

### Q4: Fixed or configurable architecture?

| Option                   | Description                             | Selected |
| ------------------------ | --------------------------------------- | -------- |
| Fixed with defaults      | Hardcode layer sizes.                   |          |
| Configurable layer sizes | CLI flags for conv filters, MLP widths. | ✓        |

**User's choice:** Configurable layer sizes

---

## Self-Play Opponent Pool

### Q1: How to sample opponents?

| Option                   | Description                                                | Selected |
| ------------------------ | ---------------------------------------------------------- | -------- |
| Configurable ratio mix   | Three-way: latest / historical / random. Default 50/30/20. | ✓        |
| Uniform random from pool | All equally likely. Over-weights weak early checkpoints.   |          |
| You decide               | Claude designs.                                            |          |

**User's choice:** Configurable ratio mix

### Q2: When to add checkpoints to pool?

| Option            | Description                                          | Selected |
| ----------------- | ---------------------------------------------------- | -------- |
| Every N episodes  | Periodic cadence, configurable.                      | ✓        |
| Performance-gated | Only when win rate exceeds threshold. Adds overhead. |          |
| You decide        | Claude picks.                                        |          |

**User's choice:** Every N episodes

### Q3: Pool size cap?

| Option                    | Description                                          | Selected |
| ------------------------- | ---------------------------------------------------- | -------- |
| Capped with FIFO eviction | Max size, evict oldest. Bounds disk, keeps relevant. | ✓        |
| Unbounded pool            | Keep all checkpoints.                                |          |
| You decide                | Claude decides.                                      |          |

**User's choice:** Capped with FIFO eviction

### Q4: Pool seeding?

| Option                        | Description                                      | Selected |
| ----------------------------- | ------------------------------------------------ | -------- |
| Seed with RandomBot + NoOpBot | Pre-populate from Phase 18. Diverse from tick 0. | ✓        |
| Empty pool, self-play only    | No diversity early.                              |          |

**User's choice:** Seed with RandomBot + NoOpBot

---

## Training CLI & Config

### Q1: Training output?

| Option                  | Description                           | Selected |
| ----------------------- | ------------------------------------- | -------- |
| Live metrics + log file | stdout metrics + NDJSON training log. | ✓        |
| Silent with log file    | Minimal stdout.                       |          |
| You decide              | Claude designs.                       |          |

**User's choice:** Live metrics + log file

### Q2: Run organization?

| Option                   | Description                                   | Selected |
| ------------------------ | --------------------------------------------- | -------- |
| runs/<run-id>/ directory | config.json, log, checkpoints/, final-model/. | ✓        |
| Flat output directory    | Everything in one dir.                        |          |
| You decide               | Claude decides.                               |          |

**User's choice:** runs/<run-id>/ directory

### Q3: Resume support?

| Option               | Description                                  | Selected |
| -------------------- | -------------------------------------------- | -------- |
| Yes, from checkpoint | --resume loads checkpoint + optimizer state. | ✓        |
| No resume            | Fresh starts only.                           |          |
| You decide           | Claude decides.                              |          |

**User's choice:** Yes, from checkpoint

### Q4: TF.js decision gate?

| Option           | Description                                                     | Selected |
| ---------------- | --------------------------------------------------------------- | -------- |
| 8-hour threshold | Per STATE.md. Benchmark early, defer to Python/SB3 if too slow. | ✓        |
| Always TF.js     | Commit regardless.                                              |          |
| You decide       | Claude manages.                                                 |          |

**User's choice:** 8-hour wall clock threshold

---

## Worker Parallelism

### Q1: TF.js backend?

| Option           | Description                                                    | Selected |
| ---------------- | -------------------------------------------------------------- | -------- |
| tfjs-node native | @tensorflow/tfjs-node. Eigen multi-threading for gradient ops. | ✓        |
| Pure JS / WASM   | Slower, simpler install.                                       |          |

**User's choice:** tfjs-node native
**Notes:** User asked about multi-threaded PPO updates. Analysis: tfjs-node uses Eigen which auto-parallelizes matmul/conv/backprop across ~4-16 native threads. This is separate from Node.js worker_threads — the two mechanisms naturally time-share CPU cores between collection and update phases.

### Q2: Worker architecture?

| Option                                  | Description                                                                            | Selected |
| --------------------------------------- | -------------------------------------------------------------------------------------- | -------- |
| Actor-learner with configurable workers | Workers collect episodes, main thread does PPO. --workers flag, auto-detect cores - 2. | ✓        |
| You decide                              | Claude designs.                                                                        |          |

**User's choice:** Actor-learner with configurable workers
**Notes:** Target machine has 48 cores. Diminishing returns expected around 16-32 workers due to PPO update becoming proportionally larger fraction of wall time.

### Q3: Episodes per collection round?

| Option                   | Description                                       | Selected |
| ------------------------ | ------------------------------------------------- | -------- |
| Configurable per-round   | Default workers × 4. Amortizes update idle time.  | ✓        |
| One per worker per round | Minimizes staleness, wasteful at high core count. |          |
| You decide               | Claude picks.                                     |          |

**User's choice:** Configurable per-round episodes

### Q4: Weight sync method?

| Option                   | Description                                                 | Selected |
| ------------------------ | ----------------------------------------------------------- | -------- |
| postMessage transferable | Float32Arrays via postMessage. Infrequent, negligible cost. | ✓        |
| SharedArrayBuffer        | Zero-copy but marginal benefit, adds complexity.            |          |

**User's choice:** postMessage transferable

---

## Claude's Discretion

- PPO hyperparameter defaults
- Default layer sizes
- Default pool sampling ratios and promotion interval
- Exact CLI flags
- GAE implementation details
- Worker tfjs-node initialization pattern

## Deferred Ideas

None — discussion stayed within phase scope
