# Architecture Research

**Domain:** RL Bot Harness, PPO Self-Play Training, Balance Analysis, and In-Game Bot Integration — Conway RTS TypeScript prototype (v0.0.4)
**Researched:** 2026-03-30
**Confidence:** HIGH for integration architecture (direct codebase analysis); MEDIUM for training pipeline (ecosystem research + architectural reasoning); MEDIUM for Glicko rating system (verified npm libraries + domain fit analysis)

## Context: What Already Exists

This is a milestone research document for v0.0.4. The architecture below describes how an RL bot harness, training pipeline, balance analysis, and live bot adapter integrate with the existing system. The focus is integration points, new vs modified components, and data flow.

**Existing foundation confirmed by codebase analysis:**

- `packages/rts-engine/rts.ts`: `RtsRoom.tick()` is deterministic with a fixed tick order (economy -> builds -> Conway step -> defeat check -> outcome). `RtsRoom.create()` creates rooms. `RtsRoom.addPlayer()` adds players and spawns their base/core. `RtsRoom.queueBuildEvent()` and `RtsRoom.queueDestroyEvent()` are the canonical action entry points. `RtsRoom.createStatePayload()` serializes full room state. `RtsRoom.state` exposes the `RoomState` directly (grid, teams, structures, resources, tick).
- `packages/rts-engine/rts.ts` (`RoomState`): Contains `grid: Grid` (Conway cells), `teams: Map<number, TeamState>` (resources, income, structures, pendingBuildEvents, defeated, baseTopLeft), `players: Map<string, RoomPlayerState>`, `tick: number`, `generation: number`.
- `packages/rts-engine/rts.ts` (`TeamState`): Contains `resources: number`, `income: number`, `structures: Map<string, Structure>` (each with `hp`, `active`, `x`, `y`, `templateId`, `isCore`), `pendingBuildEvents: BuildEvent[]`, `pendingDestroyEvents: DestroyEvent[]`, `defeated: boolean`, `baseTopLeft: Vector2`, `buildStats: BuildStats`.
- `packages/rts-engine/structure.ts`: `createDefaultStructureTemplates()` returns the available template catalogue (block, generator, glider, eater-1, gosper). Each template has `id`, `activationCost`, `income`, `buildRadius`, `startingHp`.
- `packages/rts-engine/match-lifecycle.ts`: `determineMatchOutcome()` produces `MatchOutcome` with `winner` and `ranked` arrays. `RankedTeamOutcome` includes `finalCoreHp`, `coreState`, `territoryCellCount`, build stats.
- `packages/rts-engine/gameplay-rules.ts`: `DEFAULT_STARTING_RESOURCES = 40`, `DEFAULT_QUEUE_DELAY_TICKS = 10`, `INTEGRITY_CHECK_INTERVAL_TICKS = 4`.
- `packages/conway-core/grid.ts`: `Grid` has `width`, `height`, `step()`, `isCellAlive(x,y)`, `setCell(x,y,v)`, `toPacked()`, `toUnpacked()`, `clone()`. Cell iteration via `grid.cells()`.
- `apps/server/src/server.ts`: Socket.IO server with room management, lockstep protocol, and `ClientToServerEvents` / `ServerToClientEvents` typed contracts.
- `packages/rts-engine/socket-contract.ts`: Full typed event contracts for all client-server communication.

**What is NOT yet built (v0.0.4 scope):**

- Headless match runner (no Socket.IO, no rendering, pure `RtsRoom` execution)
- Bot agent interface (observation extraction, action submission, reward computation)
- PPO training loop or any ML inference capability
- Balance analysis or structure rating system
- Socket.IO bot adapter for live matches

---

## Recommended Architecture

### System Overview

```
TRAINING PIPELINE (offline, Node.js or Python)

+--------------------------------------------------+
|  packages/bot-harness/                           |
|  +--------------------------------------------+  |
|  |  HeadlessMatchRunner                       |  |
|  |  (creates RtsRoom, adds bot agents,        |  |
|  |   runs tick loop until outcome)            |  |
|  +--------------------------------------------+  |
|  +--------------------------------------------+  |
|  |  BotEnvironment (Gym-like)                 |  |
|  |  step(action) -> {obs, reward, done, info} |  |
|  |  reset() -> obs                            |  |
|  +--------------------------------------------+  |
|  +--------------------------------------------+  |
|  |  ObservationEncoder                        |  |
|  |  RoomState -> Float32Array feature vector  |  |
|  +--------------------------------------------+  |
|  +--------------------------------------------+  |
|  |  ActionDecoder                             |  |
|  |  model output -> queueBuildEvent() calls   |  |
|  +--------------------------------------------+  |
|  +--------------------------------------------+  |
|  |  RewardSignal                              |  |
|  |  RoomTickResult + state delta -> number    |  |
|  +--------------------------------------------+  |
+--------------------------------------------------+

TRAINING (Python, external process)

+--------------------------------------------------+
|  training/                                       |
|  +--------------------------------------------+  |
|  |  PPO Training Loop (Stable Baselines3)     |  |
|  |  Communicates with BotEnvironment via       |  |
|  |  stdio JSON protocol or shared NDJSON file  |  |
|  +--------------------------------------------+  |
|  +--------------------------------------------+  |
|  |  Self-Play Manager                         |  |
|  |  Opponent pool, matchmaking, ELO tracking  |  |
|  +--------------------------------------------+  |
|  +--------------------------------------------+  |
|  |  ONNX Export                               |  |
|  |  Trained policy -> .onnx model file        |  |
|  +--------------------------------------------+  |
+--------------------------------------------------+

ANALYSIS (Node.js)

+--------------------------------------------------+
|  packages/balance-analysis/                      |
|  +--------------------------------------------+  |
|  |  MatchDatabase (SQLite or NDJSON)          |  |
|  |  match results, per-tick snapshots         |  |
|  +--------------------------------------------+  |
|  +--------------------------------------------+  |
|  |  GlickoRatingEngine                        |  |
|  |  structure/combo ratings via glicko2.ts    |  |
|  +--------------------------------------------+  |
|  +--------------------------------------------+  |
|  |  BalanceReport                             |  |
|  |  win rates, strategy distributions, maps   |  |
|  +--------------------------------------------+  |
+--------------------------------------------------+

LIVE GAME (Node.js + Socket.IO)

+--------------------------------------------------+
|  apps/server/ (MODIFIED)                         |
|  +--------------------------------------------+  |
|  |  BotSocketAdapter                          |  |
|  |  Connects as virtual Socket.IO client       |  |
|  |  Loads ONNX model via onnxruntime-node     |  |
|  |  Observation -> model -> action -> emit    |  |
|  +--------------------------------------------+  |
+--------------------------------------------------+
```

### Component Boundaries

| Component | Layer | Responsibility | Communicates With |
|-----------|-------|----------------|-------------------|
| `HeadlessMatchRunner` | `packages/bot-harness` | Creates `RtsRoom`, adds virtual players, runs tick loop, collects outcomes | `RtsRoom` (rts-engine), `BotAgent` interface |
| `BotEnvironment` | `packages/bot-harness` | Gymnasium-style wrapper: `reset()`, `step(action)`, observation/action spaces | `HeadlessMatchRunner`, `ObservationEncoder`, `ActionDecoder`, `RewardSignal` |
| `ObservationEncoder` | `packages/bot-harness` | Extracts fixed-size `Float32Array` feature vector from `RoomState` for one team's perspective | `RoomState` (read-only) |
| `ActionDecoder` | `packages/bot-harness` | Converts model output (template selection + grid coordinates) into `queueBuildEvent()` / `queueDestroyEvent()` calls | `RtsRoom` via `HeadlessMatchRunner` |
| `RewardSignal` | `packages/bot-harness` | Computes per-tick reward from `RoomTickResult` and state deltas (resource gain, territory change, core HP damage, build success) | `RoomTickResult`, `RoomState` snapshots |
| PPO Training Loop | `training/` (Python) | Stable Baselines3 PPO with custom Gymnasium env wrapping the Node.js `BotEnvironment` via IPC | `BotEnvironment` via stdio/subprocess |
| Self-Play Manager | `training/` (Python) | Manages opponent pool, selects opponents from historical checkpoints, tracks training progress | PPO Training Loop, saved model checkpoints |
| ONNX Export | `training/` (Python) | Exports trained PyTorch policy to `.onnx` format | Trained PPO model |
| `GlickoRatingEngine` | `packages/balance-analysis` | Computes Glicko-2 ratings for individual structure templates and template combinations based on match outcomes | `MatchDatabase` |
| `MatchDatabase` | `packages/balance-analysis` | Stores match results, strategy selections, per-tick snapshots for analysis | `HeadlessMatchRunner` output |
| `BalanceReport` | `packages/balance-analysis` | Generates win rate tables, strategy distribution analysis, per-map metrics | `MatchDatabase`, `GlickoRatingEngine` |
| `BotSocketAdapter` | `apps/server` | Virtual Socket.IO client that loads ONNX model and plays in live matches | `onnxruntime-node`, socket-contract types, `ObservationEncoder`, `ActionDecoder` |

---

## Key Design Decision: Where Does the Headless Match Runner Live?

**Decision: New package `packages/bot-harness`**

**Rationale:**
1. **Layer boundary enforcement.** The existing rule is strict: `packages/*` contains deterministic, runtime-agnostic logic; `apps/*` contains runtime-specific code. A headless match runner is deterministic and runtime-agnostic — it uses only `RtsRoom` from `packages/rts-engine`. It belongs in `packages/`.
2. **Separation from rts-engine.** Putting it inside `rts-engine` would bloat that package with ML-specific concerns (observation encoding, reward computation, Gym interface) that have nothing to do with game rules. The bot harness is a *consumer* of rts-engine, not part of it.
3. **Testability.** A separate package can be tested independently. Its unit tests verify observation encoding, action decoding, and reward computation without touching Socket.IO or browser APIs.
4. **Reuse.** The same `BotEnvironment` interface serves both the Python training pipeline (via IPC) and the Node.js live bot adapter (via direct import). A package alias (`#bot-harness`) makes it importable from both `training/` scripts and `apps/server/`.

**Import direction:**
```
packages/bot-harness  ->  packages/rts-engine  (consumer imports engine)
packages/bot-harness  ->  packages/conway-core  (for Grid utilities)
apps/server           ->  packages/bot-harness  (live bot adapter imports harness)
training/             ->  packages/bot-harness  (training scripts import harness)
packages/rts-engine   -X- packages/bot-harness  (engine must NOT import harness)
```

---

## Key Design Decision: Training in Python, Inference in TypeScript

**Decision: Train PPO in Python (Stable Baselines3), export to ONNX, run inference in Node.js (onnxruntime-node)**

**Rationale:**
1. **Python RL ecosystem is 10x more mature.** Stable Baselines3 provides a production-grade PPO implementation with hundreds of tested hyperparameter configurations, curriculum learning, and self-play wrappers. The TypeScript RL ecosystem (ppo-tfjs, rl-ts) consists of minimally maintained hobby projects with 1-10 weekly npm downloads.
2. **TensorFlow.js PPO is not viable for training.** TensorFlow.js has a known tensor creation bottleneck (4x slower than Python for RL observation loops). The `@tensorflow/tfjs-node-gpu` backend has documented performance inconsistencies. No mature PPO implementation exists in the ecosystem.
3. **ONNX bridge is well-established.** Stable Baselines3 has official ONNX export documentation. `onnxruntime-node` is maintained by Microsoft, supports Node.js 20+, and provides TypeScript type definitions. The pattern "train in Python, deploy via ONNX" is standard practice for game AI.
4. **Clean separation of concerns.** Training is a batch process that runs offline; inference is a real-time process that runs in the game server. ONNX is the serialization boundary. The Node.js codebase never needs to import PyTorch or TensorFlow.

**The alternative considered (all-TypeScript with ppo-tfjs) was rejected because:**
- `ppo-tfjs` has 1 weekly download and 1 maintainer, last updated over a year ago
- Tensor creation overhead makes RL training loops 4x slower than Python
- No community, no debugging support, no proven hyperparameter configurations
- Would require maintaining a custom PPO implementation alongside game development

---

## Detailed Component Architecture

### 1. HeadlessMatchRunner

```typescript
// packages/bot-harness/headless-match-runner.ts

interface HeadlessMatchConfig {
  width: number;
  height: number;
  maxTicks: number;           // safety limit to prevent infinite matches
  ticksPerDecision: number;   // how often bots can act (e.g., every 10 ticks)
  templates?: StructureTemplateInput[];  // override default templates
}

interface BotAgent {
  id: string;
  name: string;
  selectAction(observation: BotObservation): BotAction;
}

interface HeadlessMatchResult {
  outcome: MatchOutcome;
  totalTicks: number;
  strategyLog: StrategyLogEntry[];  // what each agent built and when
  tickSnapshots: TickSnapshot[];     // periodic state captures for analysis
}

class HeadlessMatchRunner {
  static runMatch(
    config: HeadlessMatchConfig,
    agents: [BotAgent, BotAgent],
  ): HeadlessMatchResult;
}
```

**How it works:**
1. `RtsRoom.create()` with the given dimensions
2. `room.addPlayer()` for each agent (assigns teams, spawns bases)
3. Loop: for each tick until `maxTicks` or match finishes:
   a. Every `ticksPerDecision` ticks, call `agent.selectAction(observation)`
   b. Convert action to `room.queueBuildEvent()` or `room.queueDestroyEvent()`
   c. Call `room.tick()`
   d. Check `result.outcome` — if non-null, match is over
4. Return `HeadlessMatchResult`

**Why `ticksPerDecision` matters:** The Conway grid evolves every tick, but strategic decisions (placing structures) should happen less frequently to be meaningful. A decision every 10 ticks (matching `DEFAULT_QUEUE_DELAY_TICKS`) means the bot decides once per build cycle.

### 2. ObservationEncoder

```typescript
// packages/bot-harness/observation-encoder.ts

interface BotObservation {
  features: Float32Array;       // fixed-size feature vector for ML model
  validActions: BotActionMask;  // which actions are legal right now
}

interface BotActionMask {
  canBuild: boolean[];          // per-template: has resources and valid placement
  canDestroy: boolean[];        // per-owned-structure: can be destroyed
}
```

**Observation space design (extracted from RoomState):**

| Feature Group | Source | Size | Description |
|---------------|--------|------|-------------|
| Global | `room.state.tick`, `room.state.width`, `room.state.height` | 3 | Normalized tick progress, map dimensions |
| Own team economy | `team.resources`, `team.income`, `team.incomeBreakdown` | 4 | Current resources, income rate, structure/base income |
| Own team structures | `team.structures` | ~20 | Count per template type, total HP, core HP, active count |
| Own team pending | `team.pendingBuildEvents`, `team.pendingDestroyEvents` | 4 | Pending build count, pending destroy count, reserved cost |
| Enemy team economy | `enemyTeam.resources`, `enemyTeam.income` | 4 | Mirror of own team features |
| Enemy team structures | `enemyTeam.structures` | ~20 | Mirror of own team features |
| Enemy team pending | `enemyTeam.pendingBuildEvents` | 4 | Mirror |
| Grid spatial | `room.state.grid` | Variable | Downsampled grid density map (e.g., 8x8 or 16x16 average density bins) |
| Territory | Derived from grid + base positions | ~16 | Cells near own base vs enemy base, frontier density |
| Build zone | Derived from structure positions + radii | ~16 | Available build area coverage |

**Total observation vector size:** ~100-200 floats (configurable). The grid spatial features use a fixed-size downsampled representation regardless of actual grid dimensions.

**Grid downsampling strategy:** Divide the grid into NxN bins (e.g., 8x8 = 64 bins). Each bin contains the ratio of alive cells in that region. This gives the model spatial awareness without a variable-size observation.

### 3. ActionDecoder

```typescript
// packages/bot-harness/action-decoder.ts

interface BotAction {
  type: 'build' | 'destroy' | 'wait';
  templateId?: string;    // for build
  x?: number;             // for build (grid coordinates)
  y?: number;             // for build
  structureKey?: string;  // for destroy
}
```

**Action space design:**

The action space is a discrete multi-dimensional space:
1. **Action type:** `build` | `destroy` | `wait` (3 choices)
2. **Template selection (if build):** index into template catalogue (5 templates + core excluded = 5 choices)
3. **Placement (if build):** (x, y) on the grid. To keep the action space manageable, quantize to a coarser grid (e.g., every 4 cells = ~25x25 = 625 positions for a 100x100 map)

**Total discrete action space:** 3 + (5 * 625) + (structure_count) = ~3130 actions. For PPO with discrete actions, this is manageable.

**Action masking is critical:** The `BotActionMask` prevents the model from choosing invalid actions (building when broke, placing outside build zone, destroying enemy structures). Invalid actions waste training time. The mask is computed by calling `RtsRoom.previewBuildPlacement()` for each template at candidate positions.

**Efficient action masking:** Rather than testing every position, pre-compute the build zone from active structures and only test positions within it. This reduces the preview calls from 625 per template to ~50-100.

### 4. RewardSignal

```typescript
// packages/bot-harness/reward-signal.ts

interface RewardConfig {
  winReward: number;              // e.g., +10.0
  loseReward: number;             // e.g., -10.0
  coreDamageDealtReward: number;  // e.g., +0.5 per HP dealt
  coreDamageTakenPenalty: number; // e.g., -0.5 per HP lost
  resourceGainReward: number;     // e.g., +0.01 per resource earned
  territoryGainReward: number;    // e.g., +0.02 per cell gained
  buildSuccessReward: number;     // e.g., +0.1 per successful build
  buildFailPenalty: number;       // e.g., -0.05 per rejected build
  idleTickPenalty: number;        // e.g., -0.001 per tick with no action
}
```

**Reward design principles:**
1. **Sparse terminal reward dominates:** Win/loss is the primary signal. All shaping rewards are 10-100x smaller.
2. **Shaping rewards accelerate early learning:** Without them, random agents rarely win, so the gradient signal is near zero for thousands of episodes.
3. **Core HP delta is the strongest shaping signal:** It directly correlates with the win condition.
4. **Build success/fail shapes exploration:** Encourages the agent to learn valid placements early.
5. **Reward is computed per team perspective:** Each agent gets its own reward from the shared `RoomTickResult`.

**Implementation:** After each `room.tick()`, the `RewardSignal` compares pre-tick and post-tick `TeamState` snapshots to compute deltas.

### 5. BotEnvironment (Gym-like Interface)

```typescript
// packages/bot-harness/bot-environment.ts

interface EnvironmentConfig extends HeadlessMatchConfig {
  reward: RewardConfig;
  observationSize: number;
  actionGridResolution: number;  // e.g., 4 = quantize to every 4 cells
}

interface StepResult {
  observation: Float32Array;
  reward: number;
  done: boolean;
  truncated: boolean;  // hit maxTicks without outcome
  info: {
    outcome?: MatchOutcome;
    tick: number;
    validActions: BotActionMask;
  };
}

class BotEnvironment {
  constructor(config: EnvironmentConfig);
  reset(): Float32Array;
  step(action: number): StepResult;  // single int encoding the discrete action
  get observationSpace(): { shape: number[] };
  get actionSpace(): { n: number };
}
```

**This is the boundary between TypeScript game logic and Python training.** The `BotEnvironment` consumes the `HeadlessMatchRunner`, `ObservationEncoder`, `ActionDecoder`, and `RewardSignal` to present a clean `reset()/step()` interface.

### 6. Python-TypeScript IPC Bridge

**Decision: Subprocess with NDJSON (newline-delimited JSON) over stdio**

```
Python (SB3)  <--stdin/stdout-->  Node.js (BotEnvironment)
```

**Protocol:**
```json
// Python -> Node.js (action)
{"type": "step", "action": 42}
{"type": "reset"}

// Node.js -> Python (observation)
{"type": "observation", "obs": [0.1, 0.2, ...], "reward": 0.5, "done": false, "truncated": false, "info": {...}}
{"type": "reset_obs", "obs": [0.1, 0.2, ...], "info": {...}}
```

**Why NDJSON over stdio:**
1. **Zero dependencies.** No ZeroMQ, no gRPC, no shared memory libraries.
2. **Cross-platform.** Works identically on Linux, macOS, Windows.
3. **Debuggable.** You can literally `cat` the pipe to see what's happening.
4. **Fast enough.** A single match step takes ~1ms (tick loop). JSON serialization of a 200-float observation is ~50us. The bottleneck is the PPO update, not the bridge.

**Alternative considered (shared memory / gRPC) was rejected because:**
- Adds dependency complexity
- PPO training is I/O bound on gradient updates, not on environment stepping
- NDJSON is the standard for lightweight Gym bridges (used by Gymnasium's subprocess vec env)

### 7. Self-Play Architecture

```
training/
  self_play.py          # Main training script
  sb3_env_wrapper.py    # Gymnasium env wrapping the Node.js subprocess
  opponent_pool.py      # Historical model management
  export_onnx.py        # ONNX export after training
```

**Self-play strategy: Opponent pool with prioritized sampling**

1. Training starts with two random agents
2. Every N episodes (e.g., 100), save the current model as a checkpoint
3. The opponent for each episode is sampled from the pool:
   - 50% chance: latest checkpoint (ensures training against strong opponents)
   - 30% chance: random historical checkpoint (prevents forgetting)
   - 20% chance: random policy (ensures robustness against naive play)
4. When the current model's win rate against all pool members exceeds 60%, add it to the pool as the new "best"

**Match configuration for self-play:**
- Map size: use the default (or a small set of fixed sizes for variety)
- `maxTicks`: 500-1000 (most matches should resolve before this)
- `ticksPerDecision`: 10 (one decision per build delay cycle)
- Both agents see the same observation space but from their own team's perspective

### 8. Balance Analysis: Glicko-2 Structure Ratings

**Decision: Use `glicko2.ts` (npm package) for the Glicko-2 engine**

**Rationale:** `glicko2.ts` is a TypeScript-native implementation with full type definitions, GPL-3.0 licensed, maintained, and supports the standard Glicko-2 algorithm. It handles rating periods, rating deviation, and volatility correctly.

**How structure ratings work:**

A "structure strategy" is defined as the set of structure templates a bot prioritized during a match (e.g., "primarily block + generator" or "early gosper rush"). After each match:

1. Extract each team's **strategy profile**: the template distribution (normalized counts of each template built)
2. Identify the **dominant strategy**: the template or 2-template combination that received the most investment
3. Treat each strategy as a "player" in the Glicko-2 system
4. Record the match outcome as a win/loss/draw for each strategy
5. Update ratings at the end of each rating period (every 50-100 matches)

**Rating entities:**

| Entity Type | Key | What It Represents |
|-------------|-----|--------------------|
| Individual template | `"block"`, `"generator"`, etc. | How strong is this template when it's the primary build |
| Template pair | `"block+generator"`, `"block+gosper"` | How strong is this 2-template combination |
| Opening strategy | `"early-generator"`, `"early-gosper"` | How strong is this opening (first 3 builds) |

**Database schema (NDJSON files for simplicity):**

```
data/
  matches.ndjson         # One line per match: {id, agents, outcome, ticks, strategies}
  strategy-ratings.json  # Current Glicko-2 ratings for each strategy
  template-ratings.json  # Current Glicko-2 ratings for each template
  balance-report.json    # Generated analysis report
```

**Why NDJSON files instead of SQLite:**
- Zero native dependencies (SQLite requires node-gyp)
- Append-only writes are safe for concurrent processes
- Human-readable and git-trackable for small datasets
- The expected dataset size (thousands of matches, not millions) is well within NDJSON's performance envelope

### 9. BotSocketAdapter (Live Game Integration)

```typescript
// apps/server/src/bot-socket-adapter.ts

interface BotSocketAdapterConfig {
  modelPath: string;          // path to .onnx model file
  botName: string;
  ticksPerDecision: number;
  observationSize: number;
  actionGridResolution: number;
}

class BotSocketAdapter {
  constructor(config: BotSocketAdapterConfig);

  // Joins an existing room as a player via internal Socket.IO client
  async joinRoom(roomId: string): Promise<void>;

  // Called by the server's tick loop or by observing state events
  async onTick(statePayload: RoomStatePayload): Promise<void>;
}
```

**How the live bot works:**

1. The `BotSocketAdapter` creates an internal `socket.io-client` connection to the same server
2. It joins a room and claims a slot like any human player
3. On each decision tick, it:
   a. Converts the current `RoomStatePayload` into a `Float32Array` observation using the same `ObservationEncoder` from `packages/bot-harness`
   b. Runs ONNX inference: `ort.InferenceSession.run(feeds)` returns the action
   c. Converts the action to a `BuildQueuePayload` or `DestroyQueuePayload` using the same `ActionDecoder`
   d. Emits `build:queue` or `destroy:queue` via its socket connection

**Why an internal Socket.IO client (not direct RtsRoom access):**
1. **Validates the full protocol.** The bot exercises the same validation path as human players
2. **No special server modifications.** The bot is just another client
3. **Testable.** Integration tests can verify bot behavior end-to-end
4. **Lockstep compatible.** The bot's inputs go through the same lockstep relay pipeline

**ONNX inference performance:** `onnxruntime-node` runs a small MLP (2 hidden layers, 64-128 neurons) in <1ms on CPU. The decision interval (every 10 ticks at ~100ms/tick = 1 second) gives plenty of headroom.

---

## Data Flow

### Training Data Flow

```
BotEnvironment.reset()
  |-> HeadlessMatchRunner creates RtsRoom
  |-> Adds 2 virtual players
  |-> ObservationEncoder extracts initial obs from RoomState
  |-> Returns Float32Array to Python via NDJSON

BotEnvironment.step(action)
  |-> ActionDecoder converts int -> BotAction
  |-> HeadlessMatchRunner calls room.queueBuildEvent() or room.queueDestroyEvent()
  |-> HeadlessMatchRunner calls room.tick() (possibly multiple ticks until next decision point)
  |-> RewardSignal computes reward from tick results and state deltas
  |-> ObservationEncoder extracts new obs from RoomState
  |-> Returns {obs, reward, done, info} to Python via NDJSON
```

### Live Bot Data Flow

```
Server emits state snapshot (via lockstep checkpoint or periodic state)
  |-> BotSocketAdapter receives state via socket event
  |-> ObservationEncoder converts RoomStatePayload to Float32Array
  |-> onnxruntime-node runs inference on Float32Array
  |-> ActionDecoder converts model output to BuildQueuePayload
  |-> BotSocketAdapter emits build:queue via socket
  |-> Server validates and relays as normal
```

### Balance Analysis Data Flow

```
HeadlessMatchRunner.runMatch() completes
  |-> Returns HeadlessMatchResult {outcome, strategyLog, tickSnapshots}
  |-> MatchDatabase appends to matches.ndjson
  |-> After rating period (every N matches):
      |-> GlickoRatingEngine reads match history
      |-> Updates ratings for templates and combinations
      |-> Writes updated ratings to JSON
  |-> BalanceReport reads ratings + match history
  |-> Generates summary statistics (win rates, strategy distribution, etc.)
```

---

## Patterns to Follow

### Pattern 1: Observation Extraction from RoomState

**What:** Extract a fixed-size observation vector by reading `RoomState` fields, never modifying them.

**When:** Every decision tick in both training and live play.

**Key principle:** The `ObservationEncoder` must be a pure function: `(RoomState, teamId) -> Float32Array`. No side effects. Same state always produces same observation. This is critical for determinism and testability.

```typescript
function encodeObservation(state: RoomState, teamId: number): Float32Array {
  const features = new Float32Array(OBSERVATION_SIZE);
  let offset = 0;

  // Global features
  features[offset++] = state.tick / MAX_TICKS;  // normalized
  features[offset++] = state.width;
  features[offset++] = state.height;

  // Own team features
  const ownTeam = state.teams.get(teamId)!;
  features[offset++] = ownTeam.resources / MAX_RESOURCES;
  features[offset++] = ownTeam.income;
  // ... etc

  return features;
}
```

### Pattern 2: Action Space with Masking

**What:** Define a flat discrete action space but mask illegal actions before the model chooses.

**When:** Every decision step.

**Key principle:** The model outputs a probability distribution over all actions. Before sampling, zero out probabilities for invalid actions and renormalize. This prevents the model from wasting gradient signal on learning which actions are legal (the engine already knows).

```typescript
function computeActionMask(state: RoomState, teamId: number): boolean[] {
  const mask = new Array(ACTION_SPACE_SIZE).fill(false);

  // "wait" is always valid
  mask[WAIT_ACTION_INDEX] = true;

  // For each template, check if we can afford it and have valid placements
  for (const template of state.templates) {
    const team = state.teams.get(teamId)!;
    if (team.resources >= template.activationCost) {
      // Mark build actions for this template as potentially valid
      // (actual placement validity checked per-position)
      markBuildActionsValid(mask, template, state, teamId);
    }
  }

  return mask;
}
```

### Pattern 3: Reward Shaping with Sparse Terminal Signal

**What:** Small per-tick shaping rewards plus large terminal win/loss reward.

**When:** After every `room.tick()` call.

**Key principle:** The terminal reward (win/loss) must dominate the cumulative shaping rewards. If shaping rewards sum to +5 over a match but the win reward is +10, the agent learns that winning matters more than just building structures. A common mistake is making shaping rewards too large, causing the agent to optimize for resource hoarding rather than winning.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Modifying RtsRoom for Bot Support

**What:** Adding bot-specific methods or flags to `RtsRoom` or `RoomState`.

**Why bad:** Violates the principle that `packages/rts-engine` is purely about game rules. Bot support is a consumption pattern, not a game rule. Adding bot hooks to the engine creates coupling that makes the engine harder to maintain and test independently.

**Instead:** The bot harness wraps `RtsRoom` from the outside. All interaction goes through the existing public API: `addPlayer()`, `queueBuildEvent()`, `queueDestroyEvent()`, `tick()`, `state` (read).

### Anti-Pattern 2: Training PPO in TypeScript

**What:** Implementing the full PPO algorithm in TypeScript using TensorFlow.js.

**Why bad:** The TypeScript RL ecosystem has no production-grade PPO implementation. `ppo-tfjs` is unmaintained (1 download/week). TensorFlow.js has a 4x tensor creation overhead that specifically impacts RL training loops. You would spend more time debugging the PPO implementation than training the bot.

**Instead:** Train in Python with Stable Baselines3 (battle-tested, well-documented), export to ONNX, run inference in Node.js.

### Anti-Pattern 3: Embedding the Bot Directly in the Server Tick Loop

**What:** Making the bot a special case in the server's tick processing, bypassing the socket event system.

**Why bad:** Breaks the lockstep protocol (bot actions wouldn't be relayed to other clients). Introduces a code path that human players can't exercise. Makes the bot untestable through normal integration tests.

**Instead:** Use `BotSocketAdapter` as an internal Socket.IO client. The bot's actions go through the same validation and relay pipeline as human actions.

### Anti-Pattern 4: Using Variable-Size Observations

**What:** Passing the full grid as a variable-length array, or having observation size depend on structure count.

**Why bad:** Neural networks require fixed-size inputs. Variable observations would require padding/masking complexity that adds bugs and training instability.

**Instead:** Use a fixed-size downsampled grid representation and fixed-size per-team feature vector. Structure counts are scalar features, not variable-length lists.

---

## Recommended File Structure

```
packages/bot-harness/
  index.ts                      # Package exports
  headless-match-runner.ts      # HeadlessMatchRunner class
  bot-environment.ts            # BotEnvironment (Gym-like wrapper)
  observation-encoder.ts        # RoomState -> Float32Array
  action-decoder.ts             # Model output -> game actions
  reward-signal.ts              # Tick result -> reward number
  action-space.ts               # Action space definition and masking
  types.ts                      # Shared interfaces (BotAgent, BotAction, etc.)
  headless-match-runner.test.ts # Unit tests
  observation-encoder.test.ts   # Unit tests
  action-decoder.test.ts        # Unit tests
  reward-signal.test.ts         # Unit tests
  bot-environment.test.ts       # Integration tests

packages/balance-analysis/
  index.ts                      # Package exports
  match-database.ts             # NDJSON match result storage
  glicko-rating-engine.ts       # Glicko-2 wrapper for structure ratings
  strategy-extractor.ts         # Extract strategy profiles from match logs
  balance-report.ts             # Generate analysis reports
  types.ts                      # Shared interfaces
  glicko-rating-engine.test.ts  # Unit tests
  strategy-extractor.test.ts    # Unit tests

training/
  requirements.txt              # Python deps: stable-baselines3, onnx, onnxruntime
  sb3_env_wrapper.py            # Gymnasium wrapper for Node.js subprocess
  self_play.py                  # Self-play training loop
  opponent_pool.py              # Model checkpoint management
  export_onnx.py                # ONNX export script
  README.md                     # How to train

apps/server/src/
  bot-socket-adapter.ts         # NEW: Virtual Socket.IO client for live bots
  bot-socket-adapter.test.ts    # Unit tests

data/
  models/                       # Trained .onnx model files
  matches/                      # Match result NDJSON files
  ratings/                      # Glicko-2 rating JSON files

tests/integration/server/
  bot-match.test.ts             # NEW: End-to-end bot vs bot via socket
```

---

## Scalability Considerations

| Concern | At 100 matches | At 10K matches | At 100K matches |
|---------|---------------|----------------|-----------------|
| Match storage | <1MB NDJSON | ~100MB NDJSON, still fast | Consider SQLite migration or NDJSON rotation |
| Training time | Minutes (SB3 on CPU) | Hours (SB3 on CPU, GPU recommended) | Days (multi-GPU, parallel environments recommended) |
| Glicko-2 computation | Instant | <1 second per rating period | Consider batch processing, rating period pruning |
| ONNX inference latency | <1ms | N/A (inference is per-request, not batch) | N/A |
| NDJSON parse for analysis | Instant | ~1 second full scan | Stream-parse, or migrate to SQLite for indexed queries |

---

## Package Configuration

The new packages require additions to `package.json`:

```json
{
  "imports": {
    "#bot-harness": {
      "development": "./packages/bot-harness/index.ts",
      "default": "./dist/packages/bot-harness/index.js"
    },
    "#balance-analysis": {
      "development": "./packages/balance-analysis/index.ts",
      "default": "./dist/packages/balance-analysis/index.js"
    }
  }
}
```

New TypeScript path mappings in `tsconfig.json`:
```json
{
  "include": ["apps/server/src/**/*", "packages/**/*", "tests/**/*.ts"]
}
```

The existing `include` glob already covers `packages/**/*`, so new packages are automatically included.

---

## Sources

- [SB3 ONNX Export Documentation](https://stable-baselines3.readthedocs.io/en/master/guide/export.html) (HIGH confidence)
- [onnxruntime-node npm](https://www.npmjs.com/package/onnxruntime-node) (HIGH confidence)
- [ONNX Runtime JavaScript API](https://onnxruntime.ai/docs/get-started/with-javascript/node.html) (HIGH confidence)
- [glicko2.ts](https://github.com/animafps/glicko2.ts) (MEDIUM confidence — working library, but GPL-3.0 license needs consideration)
- [glicko-two (TypeScript)](https://github.com/ReedD/glicko-two) (MEDIUM confidence — alternative if GPL is a concern)
- [ppo-tfjs](https://github.com/zemlyansky/ppo-tfjs) (LOW confidence — evaluated and rejected for training)
- [RL.ts](https://github.com/StoneT2000/rl-ts) (LOW confidence — Gym interface reference, not production-ready)
- [SIMPLE Self-Play Pattern](https://towardsdatascience.com/training-an-agent-to-master-a-simple-game-through-self-play-88bdd0d60928/) (MEDIUM confidence — architecture reference)
- [Hugging Face Self-Play Guide](https://huggingface.co/learn/deep-rl-course/en/unit7/self-play) (MEDIUM confidence — training strategy reference)
- [37 Implementation Details of PPO](https://iclr-blog-track.github.io/2022/03/25/ppo-implementation-details/) (HIGH confidence — hyperparameter guidance)
- Codebase analysis of `packages/rts-engine/rts.ts`, `packages/conway-core/grid.ts`, `apps/server/src/server.ts` (HIGH confidence)
