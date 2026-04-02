# Phase 19: Observation, Action, and Reward Interface - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

Wrap RtsRoom in a Gymnasium-style API with structured observations (multi-channel feature planes + scalar features), territory-bounded discrete action space with masking, and configurable reward shaping with per-component weights and linear annealing. This phase delivers ObservationEncoder, ActionDecoder, RewardSignal, and BotEnvironment inside `packages/bot-harness`. It does NOT include the training pipeline (Phase 20), balance analysis (Phase 21+), or the Socket.IO bot adapter (Phase 23).

</domain>

<decisions>
## Implementation Decisions

### Observation Encoding

- **D-01:** Multi-channel 2D feature planes: alive cells, own structure footprint, enemy structure footprint, own territory mask, own core position. Stacked as channels (CNN-style input).
- **D-02:** Scalar features: own resources, income, pending build count, structure count, core HP, tick number, territory radius. Normalized to [0,1].
- **D-03:** Absolute grid coordinates — no base-centering or rotation. Net learns position invariance during training.
- **D-04:** Output format is flat `Float32Array` with shape metadata (channels, height, width). No TF.js dependency in bot-harness. Phase 20 wraps into `tf.tensor` at training time.

### Action Space Design

- **D-05:** Claude's discretion on single discrete vs multi-discrete — pick what works best for small RTS action spaces with PPO.
- **D-06:** Territory-bounded enumeration — only enumerate valid placement positions within the bot's current territory. Action space resizes each tick. Manageable size (~1000 cells × N templates + no-op).
- **D-07:** Build + no-op only — no destroy actions in the initial action space. Simpler for RL training. Can add destroy later if needed.
- **D-08:** Action masking via `RtsRoom.previewBuildPlacement()` — guaranteed consistent with what `queueBuildEvent()` accepts. Correctness over performance.

### Reward Shaping

- **D-09:** Terminal rewards: win = +1, loss = -1, draw (tick limit) = 0. Standard RL convention.
- **D-10:** Intermediate shaped signals: economy delta (resource/income change) + opponent core HP damage dealt. Two clean signals aligned with winning.
- **D-11:** Linear annealing: shaped reward weight starts at 1.0, linearly decays to 0.0 over configurable N episodes. Early training guided by shaping, late training converges on terminal reward.
- **D-12:** Per-component configurable weights: separate weights for economy_delta, core_damage, and terminal. Allows tuning signal balance during training experiments.

### Environment API

- **D-13:** Single-agent per `BotEnvironment` instance — wraps one team's perspective. For self-play, create two environments sharing the same RtsRoom. Standard Gymnasium convention.
- **D-14:** `step(action)` returns Gymnasium 5-tuple: `{observation, reward, terminated, truncated, info}`. terminated = match ended naturally, truncated = tick limit hit.
- **D-15:** `reset()` creates a fresh RtsRoom with a new seed, adds both agents, returns initial observation. Caller provides opponent `BotStrategy` (defaults to RandomBot from Phase 18).
- **D-16:** `observation_space` and `action_space` static properties describe shapes, dtypes, bounds. Standard Gymnasium convention — Phase 20's PPO uses these to configure the neural network.

### Claude's Discretion

- Single discrete vs multi-discrete action space structure (D-05)
- Exact number of feature planes and their order
- Normalization ranges and clamping strategy for scalar features
- Action index encoding scheme (how template × position maps to integer)
- Reward scale factors and default weight values
- `info` dict contents in step() return
- Internal module structure within bot-harness for Phase 19 additions

</decisions>

<canonical_refs>

## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 18 Context (Foundation)

- `.planning/phases/18-headless-match-runner/18-CONTEXT.md` — BotStrategy interface, filtered view contract, bot-harness package structure, match runner API

### RTS Engine — Observation Sources

- `packages/rts-engine/rts.ts` — `RoomState` (line ~256), `TeamState` (line ~233), `BuildStats` (line ~127), `RoomTickResult` (line ~383)
- `packages/rts-engine/structure.ts` — `Structure` class (line ~309): x, y, hp, active, isCore; `StructureTemplate` (line ~160): id, activationCost, income, buildRadius, startingHp
- `packages/rts-engine/geometry.ts` — `Vector2`, `getBaseCenter`, territory geometry
- `packages/rts-engine/core-footprint.ts` — Core structure layout, CORE_FOOTPRINT_WIDTH/HEIGHT

### RTS Engine — Action Sources

- `packages/rts-engine/rts.ts` — `RtsRoom.previewBuildPlacement()` (action masking), `RtsRoom.queueBuildEvent()` (action execution), `BuildQueuePayload`, `QueueBuildResult`
- `packages/rts-engine/structure.ts` — `createDefaultStructureTemplates()` — defines the template vocabulary (action choices)
- `packages/rts-engine/build-zone.ts` — Territory/build zone logic, `collectBuildZoneContributors`

### RTS Engine — Reward Sources

- `packages/rts-engine/match-lifecycle.ts` — `MatchOutcome`, `TeamOutcomeSnapshot` (coreHp, territoryCellCount, etc.)
- `packages/rts-engine/rts.ts` — `RtsRoom.createTeamOutcomeSnapshots()`, `RtsRoom.createCanonicalMatchOutcome()`
- `packages/rts-engine/gameplay-rules.ts` — `INTEGRITY_HP_COST_PER_CELL`, economic constants

### Conway Core

- `packages/conway-core/grid.ts` — `Grid` class (width, height, Uint8Array cells, get/set), `toPacked()`/`fromPacked()` for binary encoding

### Requirements

- `.planning/REQUIREMENTS.md` — HARN-02 (observation encoder), HARN-03 (action decoder), HARN-04 (reward signal)

</canonical_refs>

<code_context>

## Existing Code Insights

### Reusable Assets

- `RtsRoom.previewBuildPlacement(playerId, payload)` → `BuildPreviewResult` with accepted/rejected + reason — direct source for action masking
- `TeamState.structures` (Map<string, Structure>) — iterate for structure feature planes
- `TeamState.resources`, `.income`, `.incomeBreakdown`, `.territoryRadius`, `.baseTopLeft` — direct scalar observation sources
- `Structure.hp`, `.active`, `.isCore` — per-structure observation features
- `Grid` internal `Uint8Array` — can be read cell-by-cell for feature planes via `grid.get(x, y)`
- `createDefaultStructureTemplates()` — enumerates the template vocabulary, defines the action dimension
- `RtsRoom.createTeamOutcomeSnapshots()` — per-team coreHp, territoryCellCount, buildStats for reward computation

### Established Patterns

- Phase 18 established `packages/bot-harness` as the package home — extend it
- `BotStrategy` interface with `decideTick(view, teamId)` — BotEnvironment wraps this
- Filtered view: own team + full grid — ObservationEncoder formalizes this contract
- Flat `Float32Array` avoids TF.js coupling in the harness package

### Integration Points

- `BotEnvironment.reset()` creates `RtsRoom.create()` + `addPlayer()` (Phase 18 runner pattern)
- `BotEnvironment.step(action)` → `ActionDecoder.decode(action)` → `RtsRoom.queueBuildEvent()` → `RtsRoom.tick()` → `ObservationEncoder.encode()` + `RewardSignal.compute()`
- `observation_space` / `action_space` metadata → consumed by Phase 20's PPO network builder

</code_context>

<specifics>
## Specific Ideas

- Observation encoder must be deterministic: identical RoomState + teamId → identical Float32Array output (success criterion #1).
- Action mask must be exhaustive: every action index that passes the mask must succeed when executed via queueBuildEvent. No false positives in the mask (success criterion #2).
- RewardSignal is a pure function of (prev_state, current_state, teamId, config) — no hidden state, fully configurable.
- The BotEnvironment wraps the match runner's tick loop — each step() = one game tick, with the opponent also making decisions via its BotStrategy.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 19-observation-action-and-reward-interface_
_Context gathered: 2026-04-01_
