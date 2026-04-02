# Phase 19: Observation, Action, and Reward Interface - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-01
**Phase:** 19-observation-action-and-reward-interface
**Areas discussed:** Observation encoding, Action space design, Reward shaping, Environment API

---

## Observation Encoding

### Q1: How should the grid be encoded for the observation tensor?

| Option                        | Description                                                                                                          | Selected |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | -------- |
| Multi-channel feature planes  | Separate 2D planes for alive cells, own structures, enemy structures, own territory, core position. CNN-style input. | ✓        |
| Single binary plane + scalars | One binary grid plus scalar features. Simpler but loses spatial info.                                                |          |
| You decide                    | Claude designs encoding.                                                                                             |          |

**User's choice:** Multi-channel feature planes
**Notes:** Rich spatial info for neural net input.

### Q2: What scalar features should accompany the spatial planes?

| Option                             | Description                                                                                                | Selected |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------- |
| Economy + build stats              | Own resources, income, pending builds, structure count, core HP, tick, territory radius. Normalized [0,1]. | ✓        |
| Economy + build + opponent visible | Same plus opponent structure count and territory size.                                                     |          |
| You decide                         | Claude picks.                                                                                              |          |

**User's choice:** Economy + build stats
**Notes:** Compact set covering key dimensions.

### Q3: Observation perspective — relative or absolute?

| Option                 | Description                                                                   | Selected |
| ---------------------- | ----------------------------------------------------------------------------- | -------- |
| Absolute coordinates   | Raw grid coordinates. Net learns position invariance.                         | ✓        |
| Base-centered relative | Shift/rotate so base is at center. Position-invariant but complex transforms. |          |

**User's choice:** Absolute coordinates

### Q4: Observation tensor format?

| Option                 | Description                                                                | Selected |
| ---------------------- | -------------------------------------------------------------------------- | -------- |
| Flat Float32Array      | Plain typed arrays with shape metadata. No TF.js dependency.               | ✓        |
| TF.js tensors directly | Return tf.Tensor objects. Tighter Phase 20 integration but heavy coupling. |          |
| You decide             | Claude picks.                                                              |          |

**User's choice:** Flat Float32Array

---

## Action Space Design

### Q1: How should the action space be structured?

| Option          | Description                                                                | Selected |
| --------------- | -------------------------------------------------------------------------- | -------- |
| Single discrete | One integer for all valid actions + no-op. Standard PPO.                   |          |
| Multi-discrete  | Separate choices for template, x, y. Factored but invalid combos possible. |          |
| You decide      | Claude picks based on PPO conventions.                                     | ✓        |

**User's choice:** You decide (Claude's discretion)

### Q2: How to handle the large (template, x, y) combo space?

| Option                        | Description                                                                           | Selected |
| ----------------------------- | ------------------------------------------------------------------------------------- | -------- |
| Territory-bounded enumeration | Only enumerate within current territory. Resizes per tick. ~1000 cells × N templates. | ✓        |
| Fixed full-grid enumeration   | All 80×80 positions. Large space, heavy masking.                                      |          |
| Coarse grid sampling          | Every Nth cell. Loses fine granularity.                                               |          |

**User's choice:** Territory-bounded enumeration

### Q3: Include destroy actions?

| Option                  | Description                                          | Selected |
| ----------------------- | ---------------------------------------------------- | -------- |
| Build + no-op only      | Simpler for initial RL. Add destroy later if needed. | ✓        |
| Build + destroy + no-op | Full vocabulary. Larger space, harder to learn.      |          |

**User's choice:** Build + no-op only

### Q4: Action masking source?

| Option                      | Description                                                  | Selected |
| --------------------------- | ------------------------------------------------------------ | -------- |
| previewBuildPlacement       | Reuse existing API. Guaranteed consistent. May be expensive. | ✓        |
| Lightweight territory check | Faster but may miss edge cases.                              |          |
| You decide                  | Claude decides.                                              |          |

**User's choice:** previewBuildPlacement

---

## Reward Shaping

### Q1: Terminal reward values?

| Option           | Description                          | Selected |
| ---------------- | ------------------------------------ | -------- |
| +1 / -1 / 0      | Standard RL. Win/loss/draw.          | ✓        |
| Scaled by margin | Magnitude scales with HP difference. |          |
| You decide       | Claude picks.                        |          |

**User's choice:** +1 / -1 / 0

### Q2: Which intermediate signals to shape?

| Option                           | Description                                                       | Selected |
| -------------------------------- | ----------------------------------------------------------------- | -------- |
| Economy + core HP delta          | Resource/income change + opponent core damage. Two clean signals. | ✓        |
| Economy + territory + structures | More signals but risks reward hacking.                            |          |
| Economy + core HP + territory    | Three signals, needs careful tuning.                              |          |
| You decide                       | Claude designs.                                                   |          |

**User's choice:** Economy + core HP delta

### Q3: Annealing schedule?

| Option            | Description                                          | Selected |
| ----------------- | ---------------------------------------------------- | -------- |
| Linear decay      | Weight 1.0 → 0.0 over N episodes. Standard approach. | ✓        |
| Exponential decay | Faster initial drop, longer tail.                    |          |
| You decide        | Claude picks.                                        |          |

**User's choice:** Linear decay

### Q4: Per-component weights?

| Option             | Description                                          | Selected |
| ------------------ | ---------------------------------------------------- | -------- |
| Yes, per-component | Separate weights for economy, core damage, terminal. | ✓        |
| Single coefficient | One coefficient for all shaped rewards.              |          |

**User's choice:** Yes, per-component weights

---

## Environment API

### Q1: Single-agent or two-agent environment?

| Option                | Description                                                      | Selected |
| --------------------- | ---------------------------------------------------------------- | -------- |
| Single-agent per env  | Each BotEnvironment wraps one team. Share RtsRoom for self-play. | ✓        |
| Two-agent environment | One env manages both agents.                                     |          |
| You decide            | Claude picks.                                                    |          |

**User's choice:** Single-agent per environment

### Q2: step() return format?

| Option             | Description                                        | Selected |
| ------------------ | -------------------------------------------------- | -------- |
| Gymnasium 5-tuple  | {observation, reward, terminated, truncated, info} | ✓        |
| Simplified 4-tuple | {observation, reward, done, info}                  |          |
| You decide         | Claude picks.                                      |          |

**User's choice:** Gymnasium 5-tuple

### Q3: How should reset() initialize?

| Option                          | Description                                             | Selected |
| ------------------------------- | ------------------------------------------------------- | -------- |
| Create fresh RtsRoom + opponent | reset() creates room, adds agents, returns initial obs. | ✓        |
| Accept external RtsRoom         | reset(room?) optionally accepts pre-configured room.    |          |
| You decide                      | Claude picks.                                           |          |

**User's choice:** Create fresh RtsRoom + opponent

### Q4: Expose observation/action space metadata?

| Option                          | Description                                                     | Selected |
| ------------------------------- | --------------------------------------------------------------- | -------- |
| Yes, static properties          | observation_space and action_space with shapes, dtypes, bounds. | ✓        |
| Implicit from first observation | No metadata, infer from reset().                                |          |
| You decide                      | Claude decides.                                                 |          |

**User's choice:** Yes, static properties

---

## Claude's Discretion

- Single discrete vs multi-discrete action space structure
- Exact feature plane count and order
- Normalization ranges and clamping for scalars
- Action index encoding scheme
- Reward scale factors and default weights
- info dict contents
- Internal module structure for Phase 19 additions

## Deferred Ideas

None — discussion stayed within phase scope
