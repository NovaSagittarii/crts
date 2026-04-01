# Phase 19: Observation, Action, and Reward Interface - Research

**Researched:** 2026-04-01
**Domain:** Gymnasium-style RL environment API wrapping RtsRoom with observation encoding, action decoding/masking, and configurable reward shaping
**Confidence:** HIGH

## Summary

This phase wraps the existing `RtsRoom` game engine in a Gymnasium-compatible `BotEnvironment` API with three core modules: `ObservationEncoder` (multi-channel feature planes + scalar features as flat `Float32Array`), `ActionDecoder` (territory-bounded discrete action space with masking via `previewBuildPlacement`), and `RewardSignal` (terminal + shaped intermediate rewards with linear annealing). All code lives in `packages/bot-harness`, extending Phase 18's foundation.

The codebase already provides every data source needed. `RtsRoom.state` exposes `Grid` cells, `TeamState` with resources/income/structures/defeated/baseTopLeft/territoryRadius, and `previewBuildPlacement()` for exact action validity. `createTeamOutcomeSnapshots()` provides coreHp and territoryCellCount for reward computation. The default template vocabulary is 5 templates (block, generator, glider, eater-1, gosper), and territory starts at radius 12 (euclidean, ~452 cells) expandable via structure buildRadius bonuses.

**Primary recommendation:** Use a single flat `Discrete` action space with index = `template_index * max_positions + position_index + 1` (0 = no-op). Enumerate positions within the build zone bounding box. Action mask is a `Uint8Array` computed by iterating all (template, position) pairs through `previewBuildPlacement`. Observations use channel-first layout `[C, H, W]` in a `Float32Array` with separate scalar feature vector.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Multi-channel 2D feature planes: alive cells, own structure footprint, enemy structure footprint, own territory mask, own core position. Stacked as channels (CNN-style input).
- **D-02:** Scalar features: own resources, income, pending build count, structure count, core HP, tick number, territory radius. Normalized to [0,1].
- **D-03:** Absolute grid coordinates -- no base-centering or rotation. Net learns position invariance during training.
- **D-04:** Output format is flat `Float32Array` with shape metadata (channels, height, width). No TF.js dependency in bot-harness. Phase 20 wraps into `tf.tensor` at training time.
- **D-05:** Claude's discretion on single discrete vs multi-discrete -- pick what works best for small RTS action spaces with PPO.
- **D-06:** Territory-bounded enumeration -- only enumerate valid placement positions within the bot's current territory. Action space resizes each tick. Manageable size (~1000 cells x N templates + no-op).
- **D-07:** Build + no-op only -- no destroy actions in the initial action space. Simpler for RL training. Can add destroy later if needed.
- **D-08:** Action masking via `RtsRoom.previewBuildPlacement()` -- guaranteed consistent with what `queueBuildEvent()` accepts. Correctness over performance.
- **D-09:** Terminal rewards: win = +1, loss = -1, draw (tick limit) = 0. Standard RL convention.
- **D-10:** Intermediate shaped signals: economy delta (resource/income change) + opponent core HP damage dealt. Two clean signals aligned with winning.
- **D-11:** Linear annealing: shaped reward weight starts at 1.0, linearly decays to 0.0 over configurable N episodes. Early training guided by shaping, late training converges on terminal reward.
- **D-12:** Per-component configurable weights: separate weights for economy_delta, core_damage, and terminal. Allows tuning signal balance during training experiments.
- **D-13:** Single-agent per `BotEnvironment` instance -- wraps one team's perspective. For self-play, create two environments sharing the same RtsRoom. Standard Gymnasium convention.
- **D-14:** `step(action)` returns Gymnasium 5-tuple: `{observation, reward, terminated, truncated, info}`. terminated = match ended naturally, truncated = tick limit hit.
- **D-15:** `reset()` creates a fresh RtsRoom with a new seed, adds both agents, returns initial observation. Caller provides opponent `BotStrategy` (defaults to RandomBot from Phase 18).
- **D-16:** `observation_space` and `action_space` static properties describe shapes, dtypes, bounds. Standard Gymnasium convention -- Phase 20's PPO uses these to configure the neural network.

### Claude's Discretion
- Single discrete vs multi-discrete action space structure (D-05)
- Exact number of feature planes and their order
- Normalization ranges and clamping strategy for scalar features
- Action index encoding scheme (how template x position maps to integer)
- Reward scale factors and default weight values
- `info` dict contents in step() return
- Internal module structure within bot-harness for Phase 19 additions

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HARN-02 | Observation encoder extracts grid feature planes and scalar features from RoomState into a tensor-compatible format | ObservationEncoder module: 5 binary feature planes (alive, own structures, enemy structures, territory mask, core position) + 7 scalar features as normalized Float32Array. Grid.isCellAlive() for plane 0, StructurePayload.footprint for planes 1-2, build zone geometry for plane 3, core footprint for plane 4. |
| HARN-03 | Action decoder maps discrete action indices to valid build/destroy queue calls with action masking for invalid placements | ActionDecoder module: single Discrete(N+1) action space where N = num_templates * max_territory_positions. Mask computed via RtsRoom.previewBuildPlacement() for each (template, position) pair. Decode action index back to BuildQueuePayload for queueBuildEvent(). |
| HARN-04 | Reward signal computes win/loss outcome reward plus shaped intermediate rewards (economy, territory, structure health) with configurable annealing | RewardSignal module: terminal (+1/-1/0) + economy_delta + core_damage shaped signals. Per-component weights with linear annealing coefficient. Pure function of (prev_state_snapshot, current_state_snapshot, teamId, config). |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Strict TypeScript:** strict mode, no `any`, explicit `.js` extensions in relative imports, explicit return types for exported functions
- **Package boundaries:** `packages/*` must never import from `apps/*` or use Socket.IO/Express/DOM APIs. All new code goes in `packages/bot-harness`
- **Import aliases:** Use `#conway-core`, `#rts-engine`, `#bot-harness`
- **Testing:** Deterministic unit tests co-located in `packages/*`. Use vitest (already configured)
- **Style:** Interfaces for object shapes; type aliases for unions. Keep `npm run lint` passing
- **Commits:** Conventional Commits format
- **Grid API:** Treat `Grid` internals as opaque -- use its methods (`isCellAlive`, `cells()`, `toPacked()`, etc.), not direct byte-buffer access
- **RtsRoom pattern:** Prefer `RtsRoom` instance methods over static `RtsEngine` room APIs

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript (strict) | 5.x (project-configured) | All implementation | Project requirement |
| vitest | ^3.0.5 (project-configured) | Unit testing | Already in project devDependencies |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `#rts-engine` | local | RtsRoom, TeamState, structures, previewBuildPlacement, createTeamOutcomeSnapshots | All observation/action/reward data sources |
| `#conway-core` | local | Grid class for cell-level observation extraction | Feature plane construction |
| `#bot-harness` | local | BotStrategy, BotView, BotAction, match runner, RandomBot | Environment reset/step lifecycle |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Single Discrete action space | MultiDiscrete (template, x, y) | MultiDiscrete requires 3 separate masks and correlated masking is harder. Single Discrete with flat index is simpler for PPO, easier to mask, and the total action count (~2500-5000) is manageable |
| Pure function reward | Stateful reward tracker | Pure function is simpler, testable, deterministic. Annealing state lives in the environment, not the reward function |

**Installation:** No new dependencies required. All modules use existing project packages.

## Architecture Patterns

### Recommended Module Structure
```
packages/bot-harness/
  -- Existing Phase 18 files --
  bot-strategy.ts          # BotStrategy, BotView, BotAction, TeamStateView
  match-runner.ts          # runMatch, createBotView, applyBotActions
  match-logger.ts          # MatchLogger
  types.ts                 # MatchConfig, MatchResult, NDJSON types
  noop-bot.ts              # NoOpBot
  random-bot.ts            # RandomBot
  seed.ts                  # seedToRoomId, generateSeeds
  index.ts                 # Re-exports

  -- New Phase 19 files --
  observation-encoder.ts   # ObservationEncoder class
  action-decoder.ts        # ActionDecoder class
  reward-signal.ts         # RewardSignal + RewardConfig + annealing
  bot-environment.ts       # BotEnvironment (Gymnasium-style API)
  observation-encoder.test.ts
  action-decoder.test.ts
  reward-signal.test.ts
  bot-environment.test.ts
```

### Pattern 1: ObservationEncoder (HARN-02)

**What:** Deterministic encoder that extracts multi-channel 2D feature planes + scalar features from RtsRoom state.

**Feature Planes (5 channels, each H x W binary):**

| Channel | Name | Source | Value |
|---------|------|--------|-------|
| 0 | alive_cells | `Grid.isCellAlive(x, y)` | 1.0 if alive, 0.0 if dead |
| 1 | own_structure_footprint | Own team's `StructurePayload.footprint` cells | 1.0 if covered, 0.0 otherwise |
| 2 | enemy_structure_footprint | Enemy team(s) structure footprint cells | 1.0 if covered, 0.0 otherwise |
| 3 | own_territory_mask | Build zone coverage (euclidean distance from structure centers) | 1.0 if in territory, 0.0 otherwise |
| 4 | own_core_position | Core structure's footprint cells | 1.0 if core cell, 0.0 otherwise |

**Scalar Features (7 values, normalized to [0, 1]):**

| Index | Feature | Normalization | Source |
|-------|---------|---------------|--------|
| 0 | resources | clamp(value / MAX_RESOURCES, 0, 1) | `teamState.resources` |
| 1 | income | clamp(value / MAX_INCOME, 0, 1) | `teamState.income` |
| 2 | pending_build_count | clamp(value / MAX_PENDING, 0, 1) | `teamState.pendingBuilds.length` |
| 3 | structure_count | clamp(value / MAX_STRUCTURES, 0, 1) | `teamState.structures.length` (non-core) |
| 4 | core_hp | clamp(value / CORE_MAX_HP, 0, 1) | Core structure's `hp / 500` |
| 5 | tick_number | clamp(value / maxTicks, 0, 1) | `tick / config.maxTicks` |
| 6 | territory_radius | clamp(value / MAX_RADIUS, 0, 1) | `teamState.territoryRadius / MAX_RADIUS` |

**Normalization constants:** Use generous upper bounds (e.g., MAX_RESOURCES=500, MAX_INCOME=20, MAX_PENDING=10, MAX_STRUCTURES=50, CORE_MAX_HP=500, MAX_RADIUS=100). Clamping prevents values > 1.0 without crashing.

**Output format:**
```typescript
interface ObservationResult {
  planes: Float32Array;     // C * H * W flat array (channel-first: [C, H, W])
  scalars: Float32Array;    // 7 normalized scalar features
  shape: {
    channels: number;       // 5
    height: number;         // grid height (e.g., 52)
    width: number;          // grid width (e.g., 52)
    scalarCount: number;    // 7
  };
}
```

**Layout:** Channel-first (`[C, H, W]`) is standard for CNN input in TF.js and PyTorch. Plane data at `planes[c * H * W + y * W + x]`.

**When to use:** Called by `BotEnvironment.step()` and `BotEnvironment.reset()` to produce observations.

**Key constraint:** Must be deterministic -- identical RoomState + teamId = identical Float32Array output. No randomness, no floating-point non-determinism (all values are 0.0 or 1.0 for planes, clamped ratios for scalars).

### Pattern 2: ActionDecoder (HARN-03)

**What:** Maps integer action indices to `BuildQueuePayload` calls with exhaustive action masking.

**Recommendation: Single Discrete action space (D-05 discretion)**

Rationale for single Discrete over MultiDiscrete:
1. With ~5 buildable templates and ~500-2000 territory positions, total action space is ~2500-10000 + 1 (no-op). This is well within PPO's capability for discrete spaces.
2. Single Discrete simplifies masking -- one boolean per action index. MultiDiscrete requires correlated masking across dimensions (a position valid for template A may be invalid for template B due to different sizes).
3. Standard PPO implementations (including CleanRL, SB3) handle single Discrete with masking cleanly.
4. The action space resizes each tick as territory changes, but the mask handles this naturally.

**Action index encoding:**
```
action = 0                                          => no-op
action = template_idx * num_positions + pos_idx + 1 => build template at position
```

Where:
- `template_idx` is 0-indexed into the sorted template list (excluding `__core__`)
- `pos_idx` is 0-indexed into the enumerated territory positions
- Territory positions are enumerated in row-major order within the territory bounding box

**Territory position enumeration:**
```typescript
// For each structure with buildRadius > 0, collect the bounding box
// Iterate positions in the bounding box that fall within euclidean distance
// Deduplicate positions (a cell may be covered by multiple structures)
// Sort in row-major order (y ascending, then x ascending) for determinism
```

**Action mask computation:**
```typescript
// mask[0] = 1 (no-op is always valid)
// For each (template_idx, pos_idx):
//   action_idx = template_idx * num_positions + pos_idx + 1
//   preview = room.previewBuildPlacement(playerId, { templateId, x, y })
//   mask[action_idx] = preview.accepted ? 1 : 0
```

**Performance consideration:** With ~5 templates x ~500 positions = ~2500 preview calls per tick, each involving build zone and occupancy checks. This should complete in <50ms per tick (the checks are simple geometry). For training throughput, this is acceptable given matches are ~2000 ticks and target is CPU training.

**Key constraint:** Every action index where `mask[i] === 1` MUST succeed when decoded and passed to `queueBuildEvent()`. No false positives in the mask. The use of `previewBuildPlacement()` guarantees this since `queueBuildEvent()` calls the same internal evaluation.

### Pattern 3: RewardSignal (HARN-04)

**What:** Pure function computing reward from state transitions with configurable shaping.

**Terminal reward:**
```typescript
// On match outcome:
//   win  => +1.0 * weights.terminal
//   loss => -1.0 * weights.terminal
//   draw => 0.0
```

**Shaped intermediate rewards (per tick):**
```typescript
// economy_delta: (current_resources + current_income) - (prev_resources + prev_income)
//   Normalized by dividing by a scaling constant (e.g., 100)
// core_damage: (prev_enemy_core_hp - current_enemy_core_hp)
//   Normalized by dividing by CORE_MAX_HP (500)
```

**Annealing:**
```typescript
// shaped_weight = max(0, 1.0 - episode_number / anneal_episodes)
// total_reward = terminal_reward + shaped_weight * (
//     weights.economy_delta * economy_delta_normalized +
//     weights.core_damage * core_damage_normalized
// )
```

**Default config:**
```typescript
interface RewardConfig {
  weights: {
    terminal: number;       // default: 1.0
    economy_delta: number;  // default: 0.1
    core_damage: number;    // default: 0.5
  };
  annealEpisodes: number;   // default: 10000
}
```

**State snapshot for reward computation:**
```typescript
interface RewardStateSnapshot {
  resources: number;
  income: number;
  coreHp: number;
  enemyCoreHp: number;
}
```

The `RewardSignal.compute()` function takes `(prevSnapshot, currentSnapshot, terminated, truncated, config, episodeNumber)` and returns a number. This is a pure function -- no internal state.

### Pattern 4: BotEnvironment (Gymnasium API)

**What:** Wraps RtsRoom in a Gymnasium-style step/reset interface.

**Interface:**
```typescript
interface StepResult {
  observation: ObservationResult;
  reward: number;
  terminated: boolean;  // match ended naturally (core destroyed)
  truncated: boolean;   // tick limit reached
  info: StepInfo;
}

interface StepInfo {
  tick: number;
  actionMask: Uint8Array;
  actionSpaceSize: number;
  teamId: number;
  matchOutcome: MatchOutcome | null;
  // Additional diagnostic data for logging
}

interface BotEnvironmentConfig {
  gridWidth: number;      // default: 52
  gridHeight: number;     // default: 52
  maxTicks: number;       // default: 2000
  rewardConfig: RewardConfig;
}

class BotEnvironment {
  // Static shape descriptors (Gymnasium convention)
  readonly observationSpace: {
    planes: { shape: [number, number, number]; dtype: 'float32' };
    scalars: { shape: [number]; dtype: 'float32' };
  };
  readonly actionSpace: {
    type: 'Discrete';
    n: number;  // max action space size (upper bound)
  };

  constructor(config: BotEnvironmentConfig);

  reset(seed: number, opponent?: BotStrategy): ResetResult;
  step(action: number): StepResult;
}
```

**Reset flow:**
1. Create fresh `RtsRoom.create()` with grid dimensions from config
2. Add two players: `'rl-agent'` (the team being trained) and `'opponent'`
3. Create opponent bot view and get opponent's first action (no-op for tick 0)
4. Return initial observation + action mask + info

**Step flow:**
1. Decode `action` via ActionDecoder -> `BuildQueuePayload` or no-op
2. If build action, call `room.queueBuildEvent('rl-agent', payload)`
3. Get opponent's view via `createBotView()`, call `opponent.decideTick()`, apply opponent actions
4. Call `room.tick()` to advance simulation
5. Compute reward via RewardSignal
6. Encode new observation via ObservationEncoder
7. Compute new action mask
8. Return `{ observation, reward, terminated, truncated, info }`

**Self-play pattern (D-13):** Create two `BotEnvironment` instances sharing the same `RtsRoom`. Each controls one team. The training loop alternates `step()` calls. This is out of scope for Phase 19's implementation but the single-agent API naturally supports it.

### Anti-Patterns to Avoid

- **Don't import TF.js in bot-harness** (D-04). Output `Float32Array` with shape metadata. Phase 20 wraps into tensors.
- **Don't cache action masks across ticks.** Territory changes every tick (structures built/destroyed, integrity checks). Always recompute.
- **Don't use `Grid` internal buffers directly.** Use `Grid.isCellAlive(x, y)` per CLAUDE.md. Despite the performance cost, this maintains the abstraction boundary.
- **Don't store mutable state in RewardSignal.** It must be a pure function. Annealing state (episode counter) lives in BotEnvironment or the training loop.
- **Don't enumerate the full grid for action positions.** Only enumerate positions within the build zone bounding box (territory). Full 52x52 = 2704 cells per template; territory-bounded is ~500-1000 cells.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Build validity checking | Custom collision/territory logic | `RtsRoom.previewBuildPlacement()` | Already handles all edge cases: out-of-bounds, occupied, outside territory, insufficient resources, team defeated, template comparison. Guaranteed consistent with `queueBuildEvent()` |
| Territory cell enumeration | Manual bounding box + distance | `collectBuildZoneContributors()` + `isBuildZoneCoveredByContributor()` from `build-zone.ts` | Handles euclidean distance shape, multi-contributor zones, build radius aggregation |
| Match outcome ranking | Custom win/loss logic | `RtsRoom.createCanonicalMatchOutcome()` | Consistent with engine's ranking comparator |
| Bot view creation | Manual state extraction | `createBotView()` from `match-runner.ts` | Already filters own team only, extracts templates, handles payloads |
| Structure templates list | Hardcoded template names | `createDefaultStructureTemplates()` or `room.state.templates` | Authoritative template vocabulary |

**Key insight:** The RTS engine already provides every validation and data extraction function needed. The Gymnasium wrapper is pure orchestration -- it should delegate all domain logic to existing `RtsRoom` and `RtsEngine` methods.

## Common Pitfalls

### Pitfall 1: Action Space / Mask Size Mismatch
**What goes wrong:** Territory expands as structures are built (block template has buildRadius=20). If the action space size is fixed at reset time but territory grows, new valid positions appear that have no corresponding action index.
**Why it happens:** Territory radius changes dynamically: starts at 12, grows by `structure.buildRadius` for each active structure with buildRadius > 0.
**How to avoid:** Compute the maximum possible action space size at reset() time using a generous upper bound (e.g., full grid positions). The mask disables most actions; only territory-valid ones are enabled. This means the Discrete(N) size is fixed for the episode, but the mask narrows the valid set.
**Warning signs:** Assertion failures where a valid build position has no action index.

### Pitfall 2: Non-Deterministic Observation Encoding
**What goes wrong:** Two identical RoomState inputs produce different Float32Array outputs.
**Why it happens:** Iterating Maps/Sets without deterministic ordering, or using floating-point operations that produce platform-dependent results.
**How to avoid:** Always sort structures by key before iterating. Use only integer arithmetic and exact float constants (0.0, 1.0). All normalization uses simple division with clamping.
**Warning signs:** Determinism tests comparing byte-identical Float32Arrays fail intermittently.

### Pitfall 3: previewBuildPlacement Requires playerId Not teamId
**What goes wrong:** Calling `room.previewBuildPlacement(teamId, payload)` fails because it expects a playerId string, not a team number.
**Why it happens:** The API resolves team from player internally: `room.players.get(playerId) -> player.teamId -> room.teams.get(teamId)`.
**How to avoid:** BotEnvironment stores the playerId string (e.g., `'rl-agent'`) used in `addPlayer()` and passes it to all RtsRoom methods.
**Warning signs:** All preview results return `accepted: false` with "Player is not in this room" error.

### Pitfall 4: Gosper Gun Template Too Large for Territory
**What goes wrong:** Gosper glider gun is 36x9 -- it may not fit in the territory bounding box, especially at small territory radii.
**Why it happens:** Template width (36) exceeds the initial territory diameter (~24 cells). Even if territory grows, the template must fit entirely within the grid AND within territory.
**How to avoid:** The action mask naturally handles this -- `previewBuildPlacement()` will reject placements that extend outside the map or outside territory. But the action space enumeration should still include these templates; the mask just keeps them disabled until territory is large enough.
**Warning signs:** Gosper template never appears as a valid action. This is expected behavior, not a bug -- confirm in tests.

### Pitfall 5: Reward Signal Magnitude Imbalance
**What goes wrong:** Shaped rewards dominate terminal rewards during early training, then shaped rewards vanish too quickly, leaving the agent with sparse signal.
**Why it happens:** Economy delta can be large (resources accumulate at ~1/tick for base income), while core damage is rare (only happens when Conway patterns breach the core).
**How to avoid:** Normalize shaped signals to similar scales (economy delta / 100, core damage / 500). Use configurable weights so experiments can tune the balance. Default annealing over 10000 episodes gives sufficient time for both signals.
**Warning signs:** Training loss is unstable, or agent learns pure economy hoarding without attacking.

### Pitfall 6: Enemy Observation Data Access in Fog-of-War
**What goes wrong:** Trying to access enemy team state for feature planes when BotView only exposes own team.
**Why it happens:** Phase 18's BotView filters to own team only (D-02 fog-of-war). But feature plane 2 (enemy structure footprint) requires enemy data.
**How to avoid:** The ObservationEncoder must access `RtsRoom` state directly (not through BotView) for the enemy team's structures. The encoder operates at the environment level, not the bot strategy level. BotEnvironment has access to the full `RtsRoom` and can read both teams' state payloads.
**Warning signs:** Enemy structure feature plane is always zeros.

## Code Examples

### ObservationEncoder Core Logic
```typescript
// Source: derived from Grid API (packages/conway-core/grid.ts) and
// RtsRoom.createStatePayload() (packages/rts-engine/rts.ts)

export class ObservationEncoder {
  private readonly width: number;
  private readonly height: number;
  private readonly channels = 5;
  private readonly scalarCount = 7;

  public constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }

  public encode(room: RtsRoom, teamId: number, tick: number, maxTicks: number): ObservationResult {
    const planeSize = this.height * this.width;
    const planes = new Float32Array(this.channels * planeSize);
    const scalars = new Float32Array(this.scalarCount);

    const payload = room.createStatePayload();
    const ownTeam = payload.teams.find(t => t.id === teamId);
    const enemyTeam = payload.teams.find(t => t.id !== teamId);

    // Channel 0: alive cells
    const grid = room.state.grid;
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (grid.isCellAlive(x, y)) {
          planes[0 * planeSize + y * this.width + x] = 1.0;
        }
      }
    }

    // Channel 1: own structure footprint
    if (ownTeam) {
      for (const structure of ownTeam.structures) {
        for (const cell of structure.footprint) {
          planes[1 * planeSize + cell.y * this.width + cell.x] = 1.0;
        }
      }
    }

    // Channel 2: enemy structure footprint
    if (enemyTeam) {
      for (const structure of enemyTeam.structures) {
        for (const cell of structure.footprint) {
          planes[2 * planeSize + cell.y * this.width + cell.x] = 1.0;
        }
      }
    }

    // Channel 3: own territory mask (build zone)
    // Channel 4: own core position
    // ... (similar pattern using build zone and core structure data)

    // Scalar features (normalized to [0, 1])
    if (ownTeam) {
      scalars[0] = Math.min(ownTeam.resources / 500, 1.0);
      scalars[1] = Math.min(ownTeam.income / 20, 1.0);
      scalars[2] = Math.min(ownTeam.pendingBuilds.length / 10, 1.0);
      scalars[3] = Math.min(ownTeam.structures.length / 50, 1.0);
      // ... core HP, tick, territory radius
    }

    return { planes, scalars, shape: { channels: this.channels, height: this.height, width: this.width, scalarCount: this.scalarCount } };
  }
}
```

### ActionDecoder Action Mask Computation
```typescript
// Source: derived from RtsRoom.previewBuildPlacement()
// (packages/rts-engine/rts.ts line ~2594)

public computeActionMask(room: RtsRoom, playerId: string, teamId: number): Uint8Array {
  const positions = this.enumerateTerritoryPositions(room, teamId);
  const templates = this.getBuildableTemplates(room);
  const maskSize = templates.length * positions.length + 1; // +1 for no-op
  const mask = new Uint8Array(maskSize);

  mask[0] = 1; // no-op is always valid

  for (let tIdx = 0; tIdx < templates.length; tIdx++) {
    for (let pIdx = 0; pIdx < positions.length; pIdx++) {
      const actionIdx = tIdx * positions.length + pIdx + 1;
      const preview = room.previewBuildPlacement(playerId, {
        templateId: templates[tIdx].id,
        x: positions[pIdx].x,
        y: positions[pIdx].y,
      });
      mask[actionIdx] = preview.accepted ? 1 : 0;
    }
  }

  return mask;
}
```

### RewardSignal Computation
```typescript
// Source: derived from match-lifecycle.ts TeamOutcomeSnapshot
// and gameplay-rules.ts INTEGRITY_HP_COST_PER_CELL

export function computeReward(
  prev: RewardStateSnapshot,
  curr: RewardStateSnapshot,
  terminated: boolean,
  truncated: boolean,
  isWinner: boolean | null,
  config: RewardConfig,
  episodeNumber: number,
): number {
  // Terminal reward
  let reward = 0;
  if (terminated || truncated) {
    if (isWinner === true) reward += config.weights.terminal * 1.0;
    else if (isWinner === false) reward += config.weights.terminal * -1.0;
    // draw (truncated with no winner) => 0
  }

  // Shaped rewards with annealing
  const shapedWeight = Math.max(0, 1.0 - episodeNumber / config.annealEpisodes);
  if (shapedWeight > 0) {
    const economyDelta = ((curr.resources + curr.income) - (prev.resources + prev.income)) / 100;
    const coreDamage = (prev.enemyCoreHp - curr.enemyCoreHp) / 500;

    reward += shapedWeight * (
      config.weights.economy_delta * economyDelta +
      config.weights.core_damage * coreDamage
    );
  }

  return reward;
}
```

### BotEnvironment Step Flow
```typescript
// Source: derived from match-runner.ts runMatch() pattern
// (packages/bot-harness/match-runner.ts lines 127-189)

public step(action: number): StepResult {
  // 1. Decode action
  const botAction = this.actionDecoder.decode(action);

  // 2. Apply agent's action
  if (botAction) {
    this.room.queueBuildEvent(this.agentPlayerId, botAction);
  }

  // 3. Get opponent action and apply
  const opponentView = createBotView(this.room, this.opponentTeamId, this.tick);
  const opponentActions = this.opponent.decideTick(opponentView, this.opponentTeamId);
  applyBotActions(this.room, this.opponentPlayerId, opponentActions);

  // 4. Advance simulation
  const tickResult = this.room.tick();
  this.tick++;

  // 5. Compute reward
  const currentSnapshot = this.captureRewardSnapshot();
  const reward = computeReward(
    this.prevSnapshot, currentSnapshot,
    tickResult.outcome !== null, this.tick >= this.maxTicks,
    /* isWinner */, this.rewardConfig, this.episodeNumber
  );
  this.prevSnapshot = currentSnapshot;

  // 6. Encode observation
  const observation = this.encoder.encode(this.room, this.agentTeamId, this.tick, this.maxTicks);

  // 7. Compute action mask
  const actionMask = this.actionDecoder.computeActionMask(this.room, this.agentPlayerId, this.agentTeamId);

  const terminated = tickResult.outcome !== null;
  const truncated = !terminated && this.tick >= this.maxTicks;

  return {
    observation, reward, terminated, truncated,
    info: { tick: this.tick, actionMask, actionSpaceSize: actionMask.length, teamId: this.agentTeamId, matchOutcome: tickResult.outcome }
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `done` flag (OpenAI Gym) | `terminated` + `truncated` (Gymnasium) | Gymnasium v0.26 (2022) | Critical for correct bootstrapping in PPO -- must distinguish natural termination from truncation |
| Fixed action space | Dynamic action masking | 2020-present | Standard practice for constrained environments. MaskablePPO in SB3 is the reference |
| Constant reward shaping | Annealed shaping | 2023-present | Prevents shaped reward from dominating terminal signal. Linear decay is the simplest baseline |

**Deprecated/outdated:**
- OpenAI Gym: Replaced by Gymnasium (Farama Foundation). The 5-tuple return in step() is the new standard.
- Single `done` flag: Must use `terminated`/`truncated` distinction for correct value bootstrapping.

## Open Questions

1. **Action Space Upper Bound Sizing**
   - What we know: Territory starts at radius 12 (~452 cells) and grows with structure buildRadius bonuses. Block template has buildRadius=20.
   - What's unclear: What is a reasonable upper bound for `max_positions` that covers the entire possible territory expansion without being wastefully large?
   - Recommendation: Use the full grid area (width * height = 2704 for 52x52) as the position enumeration upper bound. This means the action space is `5 * 2704 + 1 = 13521` at most. The mask disables most actions. This is still manageable for PPO (AlphaGo had 362 actions, Dota had thousands). Alternatively, use territory bounding box computed from max possible buildRadius.

2. **Enemy Core HP Visibility for Reward**
   - What we know: BotView (fog-of-war) hides enemy team internals. But the reward function needs enemy core HP for the `core_damage` shaped signal.
   - What's unclear: Should the reward function have access to the full room state, or should enemy core HP be inferred from observable signals?
   - Recommendation: The RewardSignal operates at the environment level (not the agent level), so it has access to the full RtsRoom state. This is standard -- reward signals in RL training are "god mode" even when observations are partial. The agent can't see enemy HP, but the environment uses it for shaping.

3. **Action Mask in Info vs Observation**
   - What we know: Gymnasium convention puts action mask in the `info` dict. Some implementations put it in the observation space as a separate key.
   - What's unclear: Where should Phase 20's PPO expect the mask?
   - Recommendation: Put action mask in `info` dict per D-14's return tuple. Phase 20 can access `info.actionMask` when sampling actions. This keeps the observation space clean for the neural network.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^3.0.5 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run packages/bot-harness/observation-encoder.test.ts packages/bot-harness/action-decoder.test.ts packages/bot-harness/reward-signal.test.ts packages/bot-harness/bot-environment.test.ts` |
| Full suite command | `npm run test:unit` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HARN-02-a | Identical RoomState + teamId -> identical Float32Array | unit | `npx vitest run packages/bot-harness/observation-encoder.test.ts -t "deterministic"` | Wave 0 |
| HARN-02-b | Feature planes have correct dimensions (channels * H * W) | unit | `npx vitest run packages/bot-harness/observation-encoder.test.ts -t "shape"` | Wave 0 |
| HARN-02-c | Alive cells plane matches Grid.isCellAlive() | unit | `npx vitest run packages/bot-harness/observation-encoder.test.ts -t "alive"` | Wave 0 |
| HARN-02-d | Structure footprint planes match structure payloads | unit | `npx vitest run packages/bot-harness/observation-encoder.test.ts -t "footprint"` | Wave 0 |
| HARN-02-e | Scalar features normalized to [0, 1] | unit | `npx vitest run packages/bot-harness/observation-encoder.test.ts -t "scalar"` | Wave 0 |
| HARN-03-a | No-op action (index 0) produces no build | unit | `npx vitest run packages/bot-harness/action-decoder.test.ts -t "noop"` | Wave 0 |
| HARN-03-b | Every masked-valid action succeeds via queueBuildEvent | unit | `npx vitest run packages/bot-harness/action-decoder.test.ts -t "mask valid"` | Wave 0 |
| HARN-03-c | Every masked-invalid action is genuinely invalid | unit | `npx vitest run packages/bot-harness/action-decoder.test.ts -t "mask invalid"` | Wave 0 |
| HARN-03-d | Action decode roundtrip: encode -> decode -> matches template + position | unit | `npx vitest run packages/bot-harness/action-decoder.test.ts -t "roundtrip"` | Wave 0 |
| HARN-04-a | Win produces +1, loss produces -1, draw produces 0 | unit | `npx vitest run packages/bot-harness/reward-signal.test.ts -t "terminal"` | Wave 0 |
| HARN-04-b | Economy delta shaped reward is non-zero when resources change | unit | `npx vitest run packages/bot-harness/reward-signal.test.ts -t "economy"` | Wave 0 |
| HARN-04-c | Core damage shaped reward is non-zero when enemy HP decreases | unit | `npx vitest run packages/bot-harness/reward-signal.test.ts -t "core damage"` | Wave 0 |
| HARN-04-d | Annealing decays shaped weight to 0 over N episodes | unit | `npx vitest run packages/bot-harness/reward-signal.test.ts -t "anneal"` | Wave 0 |
| HARN-04-e | Custom weight config changes reward magnitudes | unit | `npx vitest run packages/bot-harness/reward-signal.test.ts -t "weights"` | Wave 0 |
| ENV-01 | reset() returns valid observation and action mask | unit | `npx vitest run packages/bot-harness/bot-environment.test.ts -t "reset"` | Wave 0 |
| ENV-02 | step() with no-op advances tick and returns valid 5-tuple | unit | `npx vitest run packages/bot-harness/bot-environment.test.ts -t "step noop"` | Wave 0 |
| ENV-03 | step() with valid build action queues build successfully | unit | `npx vitest run packages/bot-harness/bot-environment.test.ts -t "step build"` | Wave 0 |
| ENV-04 | Full episode terminates or truncates correctly | unit | `npx vitest run packages/bot-harness/bot-environment.test.ts -t "episode"` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run packages/bot-harness/{changed-file}.test.ts`
- **Per wave merge:** `npm run test:unit`
- **Phase gate:** `npm run test:fast` (unit + web) green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `packages/bot-harness/observation-encoder.test.ts` -- covers HARN-02
- [ ] `packages/bot-harness/action-decoder.test.ts` -- covers HARN-03
- [ ] `packages/bot-harness/reward-signal.test.ts` -- covers HARN-04
- [ ] `packages/bot-harness/bot-environment.test.ts` -- covers ENV-01 through ENV-04

## Sources

### Primary (HIGH confidence)
- `packages/rts-engine/rts.ts` -- RtsRoom, RoomState, TeamState, BuildQueuePayload, previewBuildPlacement, createTeamOutcomeSnapshots, createStatePayload
- `packages/rts-engine/structure.ts` -- StructureTemplate, createDefaultStructureTemplates (5 templates: block, generator, glider, eater-1, gosper)
- `packages/rts-engine/build-zone.ts` -- collectBuildZoneContributors, isBuildZoneCoveredByContributor, euclidean distance
- `packages/rts-engine/gameplay-rules.ts` -- DEFAULT_TEAM_TERRITORY_RADIUS=12, INTEGRITY_HP_COST_PER_CELL=1, BUILD_ZONE_DISTANCE_SHAPE='euclidean'
- `packages/rts-engine/match-lifecycle.ts` -- MatchOutcome, TeamOutcomeSnapshot, rankTeamsForOutcome
- `packages/rts-engine/geometry.ts` -- Vector2, getBaseCenter, BASE_FOOTPRINT_WIDTH=11
- `packages/conway-core/grid.ts` -- Grid class, isCellAlive(), cells(), width, height
- `packages/bot-harness/` -- BotStrategy, BotView, TeamStateView, match-runner.ts, types.ts (Phase 18 foundation)
- Gymnasium API docs -- https://gymnasium.farama.org/api/env/

### Secondary (MEDIUM confidence)
- PPO action masking best practices -- https://www.sciencedirect.com/science/article/pii/S2405959520300746 (verified against SB3 documentation)
- Reward shaping annealing -- https://arxiv.org/html/2408.10215v1 (verified pattern: linear decay from 1.0 to 0.0)

### Tertiary (LOW confidence)
- None -- all findings verified against codebase and official docs.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all code uses existing project packages, no new dependencies
- Architecture: HIGH -- patterns derived directly from codebase analysis of RtsRoom, Grid, and existing bot-harness code
- Pitfalls: HIGH -- identified from actual API signatures and data flow in the codebase (e.g., playerId vs teamId, territory dynamics, Gosper sizing)
- Action space design: MEDIUM -- single Discrete recommendation is well-supported by RL literature for this scale (~5K-13K actions), but exact sizing strategy has tradeoffs

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable -- all dependencies are internal to the project)
