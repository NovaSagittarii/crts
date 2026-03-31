# Technology Stack

**Project:** v0.0.4 RL Bot Harness & Balance Analysis
**Researched:** 2026-03-30
**Overall confidence:** MEDIUM-HIGH (verified npm versions against registry, evaluated tradeoffs against codebase constraints and Node.js 24 runtime)

## Scope

This document covers **only** the new capabilities needed for the v0.0.4 milestone: RL bot training (PPO), Glicko-2 structure ratings, and headless match simulation. The base stack (TypeScript, Node.js 24, Socket.IO, Vite, Vitest, Express) is unchanged and not re-examined here.

---

## Critical Decision: TypeScript-Native vs Python Bridge for PPO Training

The most consequential stack decision is whether to train PPO models in TypeScript (using TensorFlow.js) or in Python (using Stable-Baselines3 via subprocess bridge). After thorough evaluation, **TypeScript-native training using `@tensorflow/tfjs`** is recommended. Here is the full analysis:

### Why TypeScript-native wins for this project

1. **Single-language constraint.** The project has explicitly maintained a TypeScript-only stack through three milestones. Adding Python introduces a second language, a second build toolchain, a second set of linting/formatting rules, and cross-language debugging pain. The project's key decision table already states: "Build as TypeScript-only prototype (no wasm, no protobuf) -- Reduces integration complexity and keeps iteration fast."

2. **Small model scale.** The observation space is a grid of ~100x100 cells with 6 feature channels plus ~10 scalar economy values. The action space is discrete (template x position x transform). The actor-critic networks are 2-3 hidden layers of 64-128 units. This is trivially small for even a pure-JS CPU backend. Python's advantage (GPU acceleration, massive batch parallelism) only matters for models with millions of parameters.

3. **The game engine IS TypeScript.** RtsRoom.tick() is a synchronous TypeScript function. A Python bridge requires serializing every observation (grid + economy state) to JSON/bytes, sending it over subprocess stdio, receiving an action, deserializing it, then calling back into TypeScript. This round-trip per step adds latency and complexity that does not exist in the all-TypeScript path, where observation extraction and action application are direct function calls on the same RoomState object.

4. **Determinism parity.** The existing test infrastructure (fast-check property tests, lockstep hash verification) works in TypeScript. If training produces non-deterministic results, we can debug them using the same tools. A Python bridge introduces a cross-language boundary that complicates debugging.

### Why Python bridge was rejected

| Concern | Assessment |
|---------|-----------|
| SB3 PPO is "battle-tested" | True, but PPO-Clip is a well-documented algorithm (~200 LOC core). The "37 implementation details" paper covers all edge cases. Our custom implementation can be tested with property-based tests against known-correct trajectories. |
| ONNX export for deployment | Not needed in v0.0.4. TensorFlow.js saves/loads models natively (`model.save()` / `loadLayersModel()`). ONNX export becomes relevant only if we later need cross-platform deployment. |
| Python subprocess IPC | Adds process management, stdio parsing, error handling across process boundaries, and a Python virtualenv that every developer must set up. This is real ongoing friction. |
| Training speed | For our model sizes, pure JS CPU training completes in seconds-to-minutes per batch of 1000 trajectories. If this becomes a bottleneck, the WASM backend is a drop-in 2-5x speedup. |

---

## Recommended Stack

### Core: PPO Training and Inference

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| `@tensorflow/tfjs` | `4.22.0` | Neural network training and inference for PPO actor-critic models | Only production-grade tensor math library for JavaScript/TypeScript. Provides autograd, optimizers (Adam), and layer APIs needed for PPO. Use the **pure JS CPU backend** -- no native bindings. |

**Why NOT `@tensorflow/tfjs-node`:** The native binding package is [broken on Node.js 24](https://github.com/tensorflow/tfjs/issues/8609) -- our runtime. The last npm release was 4.22.0 (October 2024), with no new release including the fix. Pre-built binaries return 404 even on Node.js 20/22. Adding a native binary dependency that requires downgrading Node.js or building from source violates the project's low-friction constraint.

**Why NOT ONNX Runtime for training:** `onnxruntime-node` (v1.24.3, actively maintained, Node 24 compatible) is excellent for **inference** of pre-trained models but does not support **training**. ONNX Runtime is inference-only by design. It becomes relevant in a future milestone for fast in-game bot inference after training is complete.

**Why NOT `ppo-tfjs`:** The npm package (v0.0.2, last published May 2023, 1 weekly download) is a single-file JavaScript implementation with zero TypeScript types, no tests, and no active maintenance. Useful as a **reference** for the gym-like interface pattern, but not suitable as a dependency.

**Performance note:** The pure JS CPU backend is ~10-100x slower than native bindings. For our use case this is acceptable: networks are small (2-3 hidden layers, 64-128 units), observation space is modest, and training runs are offline batch processes. A training epoch over 1000 matches is expected to take minutes on CPU. If this becomes a bottleneck, the WASM backend (`@tensorflow/tfjs-backend-wasm`) is a drop-in replacement offering 2-5x speedup with no native compilation.

### Glicko-2 Rating System

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Custom implementation | N/A | Glicko-2 ratings for structure templates and strategy combinations | ~150 lines of TypeScript. No external dependency needed. |

**Why custom instead of a library:**

The Glicko-2 algorithm is well-documented (8 steps, [Glickman's reference paper](https://www.glicko.net/glicko/glicko2.pdf)), deterministic, and compact. The three available npm libraries all have problems:

| Library | Version | Last Updated | Problem |
|---------|---------|-------------|---------|
| `glicko2` | 1.2.1 | June 2024 | JavaScript only, no TypeScript types |
| `glicko2.ts` | 1.3.2 | January 2022 | **GPL-3.0 license** -- viral copyleft, incompatible with MIT/ISC projects |
| `glicko-two` | 1.3.1 | ~6 years ago | Unmaintained, no recent activity |

The GPL-3.0 license on `glicko2.ts` is a hard blocker -- using it would force the entire project to adopt GPL-3.0. The other two are JavaScript-only and/or unmaintained. The algorithm is simple enough that dependency cost (maintenance risk, type stubs, integration quirks) exceeds the ~150 lines of implementation cost.

Our Glicko-2 implementation needs: 1v1 rating updates (no multi-competitor), rating period batching, and volatility calculation via the Illinois algorithm. This is a pure function with no I/O -- ideal for the `packages/rl-training` package.

### Headless Match Runner

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| No new dependency | N/A | Headless match simulation for training and analysis | `RtsRoom.tick()` is already deterministic, runtime-agnostic, and has no DOM/Socket.IO dependencies. The headless runner is a loop calling existing APIs. |

The existing `RtsRoom` API provides everything needed for headless simulation:

```typescript
// Headless match -- no new dependencies
const room = RtsRoom.create({ id, name, width, height });
const teamA = room.addPlayer('bot-a', 'Bot A');
const teamB = room.addPlayer('bot-b', 'Bot B');

while (true) {
  const obs = extractObservation(room.state, teamA.id);
  const action = agent.act(obs);
  if (action) room.queueBuildEvent('bot-a', action);
  const result = room.tick();
  if (result.outcome) break;
}
```

No Socket.IO, no Express, no timers. Pure synchronous function calls.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@tensorflow/tfjs-backend-wasm` | `4.22.0` | WASM acceleration for training | Only if pure JS CPU backend proves too slow during training. Drop-in replacement: `tf.setBackend('wasm')`. No native compilation. |

### Development Tools (No New Additions)

| Tool | Purpose | Notes |
|------|---------|-------|
| Vitest (existing, 4.0.18) | Tests for PPO, Glicko-2, headless runner, bot harness | No new test framework. Property-based tests with fast-check for rating invariants and observation determinism. |
| Node.js `worker_threads` (built-in) | Parallel headless matches during training | Run N matches concurrently for self-play data collection. Built into Node.js 24, no library needed. |

### Infrastructure

| Technology | Purpose | Why |
|------------|---------|-----|
| NDJSON files | Match result storage, rating persistence | Zero dependencies, human-readable, append-only, git-trackable. Sufficient for <100K matches. |
| TF.js model files (JSON + binary weights) | Serialized trained policy | Native `model.save('file://./path')` and `loadLayersModel('file://./path')`. No format conversion needed. |
| `data/` directory | Local storage for models, matches, ratings | Add to `.gitignore`. Training artifacts are reproducible from code. |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `@tensorflow/tfjs-node` | Broken on Node.js 24 (our runtime). No npm release since October 2024. Pre-built binaries 404 on Node 20+. | `@tensorflow/tfjs` (pure JS backend). Slower but works everywhere, zero install friction. |
| `stable-baselines3` (Python) | Introduces Python runtime dependency, subprocess IPC overhead, virtualenv setup, cross-language debugging pain. Game observation/action spaces are small enough for JS-native training. | Custom PPO implementation in TypeScript using `@tensorflow/tfjs`. |
| `ppo-tfjs` npm | Unmaintained (v0.0.2, May 2023). No TypeScript types. 1 weekly download. Zero tests. | Use as **reference** for gym-like interface design, then write our own typed implementation. |
| `glicko2.ts` npm | **GPL-3.0 license** -- viral copyleft forces project to adopt GPL. | Custom Glicko-2 implementation (~150 LOC). Algorithm is well-documented by Glickman. |
| `glicko2` / `glicko-two` npm | JavaScript-only or unmaintained. Dependency cost exceeds implementation cost for a ~150-line algorithm. | Custom Glicko-2 implementation with full TypeScript types and tests. |
| `brain.js` | Simpler API than TensorFlow.js but lacks autograd, custom loss functions, and the clipped surrogate objective needed for PPO. | `@tensorflow/tfjs` which provides the full gradient computation API required for PPO. |
| `onnxruntime-node` | Inference-only -- cannot train models. Relevant later for deploying trained models, not for v0.0.4 training phase. | `@tensorflow/tfjs` for both training and inference in v0.0.4. |
| `gymnasium` / OpenAI Gym | Python-only. Our "gym" is the RtsRoom API itself -- already a step/reset interface. | Custom TypeScript gym-like interface wrapping RtsRoom. |
| `colyseus` | Multiplayer framework -- overkill for headless simulation. We already have RtsRoom for deterministic ticking. | Direct RtsRoom.tick() calls in a loop. |
| `worker-threads-pool` / `workerpool` | Small abstraction over built-in worker_threads. Not worth a dependency for the simple fan-out pattern needed (N parallel matches). | Native `worker_threads` with a simple pool wrapper (~50 LOC). |
| SQLite (`better-sqlite3`) | Adds a native dependency (node-gyp build). NDJSON files are sufficient for <100K match records. | NDJSON files. Migrate to SQLite only if querying patterns become complex. |
| gRPC / ZeroMQ | Over-engineered IPC for a single-process training loop. | Not applicable -- everything runs in one Node.js process (with worker_threads for parallelism). |

---

## Integration Points

### New Package: `packages/rl-training`

A new deterministic, runtime-agnostic package alongside `packages/conway-core` and `packages/rts-engine`:

| Module | Responsibility |
|--------|---------------|
| `gym-env.ts` | Gym-like environment wrapping RtsRoom: `reset()`, `step(action)`, `observe()`. Defines observation and action space shapes. |
| `observation.ts` | Extracts typed observation tensors from RoomState: grid channels, economy scalars, structure features. |
| `action.ts` | Maps discrete action indices to BuildQueuePayload/DestroyQueuePayload. Includes action masking for invalid placements. |
| `reward.ts` | Reward shaping: core HP delta, territory change, economy growth, match outcome bonus. |
| `ppo.ts` | PPO-Clip implementation: actor-critic networks, GAE advantage estimation, clipped surrogate loss, entropy bonus. Uses `@tensorflow/tfjs`. |
| `trainer.ts` | Self-play training loop: runs headless matches, collects trajectories, updates policy. |
| `glicko2.ts` | Glicko-2 rating system: rating update, period batching, volatility calculation. Zero dependencies. |
| `balance-analysis.ts` | Win rate matrices, strategy distribution tracking, per-structure Glicko-2 ratings. |
| `headless-runner.ts` | Runs a match to completion without Socket.IO. Accepts two agent functions, returns match outcome + trajectory data. |

### Import Path

Add to root `package.json`:
```json
{
  "imports": {
    "#rl-training": {
      "development": "./packages/rl-training/index.ts",
      "default": "./dist/packages/rl-training/index.js"
    }
  }
}
```

Import direction: `packages/rl-training` imports from `#rts-engine` and `#conway-core`. `apps/*` may import from `#rl-training`. This follows the existing layer boundary rules.

### Where the Bot Adapter Lives

The playable in-game bot (Socket.IO adapter) lives in `apps/server/` because it touches Socket.IO -- runtime-specific code. It imports trained model weights from disk and uses `@tensorflow/tfjs` for inference, calling the same observation/action interfaces from `#rl-training`.

### Observation Space Design

Based on RTS RL research (MicroRTS GridNet architecture, invalid action masking patterns), the observation should be a multi-channel grid tensor plus scalar features:

**Grid channels** (per cell, shape `[H, W, C]`):
- Cell alive/dead (1 channel)
- Own territory (1 channel)
- Enemy territory (1 channel)
- Own structures footprint (1 channel)
- Enemy structures footprint (1 channel)
- Build zone legality for own team (1 channel)

**Scalar features** (concatenated to flattened grid or as separate input head):
- Own resources, own income, enemy income estimate
- Own core HP, enemy core HP
- Current tick, pending build count, pending destroy count

**Action space** (discrete, with invalid action masking):
- Template selection (6 templates from `createDefaultStructureTemplates()`)
- Grid position (H x W)
- Transform (4 rotations x 2 flips = 8 orientations)
- No-op / destroy action

Invalid action masking (setting logits to -infinity for illegal actions) is critical -- most grid positions are invalid for any given template at any given time. The existing `previewBuildPlacement()` API already returns `accepted: boolean`, which can drive the mask.

### Training Data Flow

```
Self-Play Training Loop:
  1. Headless Runner: RtsRoom.create() + addPlayer() x2
  2. Episode Loop: agent.act(observation) -> room.queueBuildEvent() -> room.tick()
  3. Collect: (observation, action, reward, done, log_prob, value) tuples
  4. PPO Update: compute advantages (GAE), update actor-critic via clipped surrogate loss
  5. Repeat for N episodes per training iteration
  6. Save: model.save('file://./data/models/ppo-v{iteration}')
  7. Glicko-2: rate strategies/structures based on accumulated match outcomes
```

---

## Installation

```bash
# PPO training -- pure JS, no native binaries, works on Node.js 24
npm install @tensorflow/tfjs@^4.22.0

# Optional: WASM backend for 2-5x speedup if CPU training is too slow
# npm install @tensorflow/tfjs-backend-wasm@^4.22.0
```

No new runtime production dependencies beyond `@tensorflow/tfjs`. The Glicko-2 implementation and headless runner are pure TypeScript with zero external dependencies.

### .gitignore additions

```
# Training artifacts
data/models/
data/matches/
data/ratings/
```

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| ML Framework | `@tensorflow/tfjs` (pure JS) | `@tensorflow/tfjs-node` (native) | Broken on Node 24. Native binary download 404s. No release since Oct 2024. |
| ML Framework | `@tensorflow/tfjs` (pure JS) | Python + Stable-Baselines3 | Cross-language complexity violates single-language constraint. Small models don't need Python ecosystem. IPC overhead per step. |
| ML Framework | `@tensorflow/tfjs` (pure JS) | Custom tensor math (no framework) | PPO needs autograd, Adam optimizer, batch matrix ops. Reimplementing these is months of work vs. using a mature library. |
| Training Speed | Pure JS CPU (default) | WASM backend | Add WASM only if benchmarks prove CPU is too slow. Don't prematurely optimize. |
| Training Speed | Pure JS CPU | GPU via WebGL | Not available in Node.js server context. Would require browser-based training. |
| Glicko-2 | Custom TypeScript (~150 LOC) | `glicko2.ts` npm | GPL-3.0 license is a hard blocker. |
| Glicko-2 | Custom TypeScript (~150 LOC) | `glicko2` npm (JS) | No TypeScript types. 150 LOC is cheaper than maintaining type stubs. |
| Inference Runtime | `@tensorflow/tfjs` (shared with training) | `onnxruntime-node` (v1.24.3) | Cannot train, only infer. Would require a separate training stack and model format conversion. Useful in future for perf-critical inference. |
| Match Runner | Direct RtsRoom.tick() API | Socket.IO test harness | Socket.IO adds latency, async complexity, port management. Headless matches should be synchronous. |
| Parallelism | Built-in `worker_threads` | `workerpool` npm | Simple fan-out pattern doesn't need a library. ~50 LOC wrapper. |
| Data Storage | NDJSON files | SQLite via `better-sqlite3` | Native dependency. NDJSON sufficient for <100K records. |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|----------------|-------|
| `@tensorflow/tfjs@4.22.0` | Node.js 24.13.0 | Pure JS backend, no native binaries or N-API dependency. Works on any Node.js version. Verified via npm registry. |
| `@tensorflow/tfjs-backend-wasm@4.22.0` | Node.js 24.13.0 | WASM execution, no native compilation. Optional performance upgrade path. |
| `RtsRoom` (existing package) | Node.js + browser | Already runtime-agnostic. Headless runner calls `tick()` directly. No changes to existing engine needed. |
| Custom Glicko-2 | Any TypeScript | Pure math, zero dependencies. Testable with fast-check property tests. |
| `worker_threads` (built-in) | Node.js 12+ | Stable API since Node.js 12. Used for parallel match execution during training. |

---

## Future Considerations (NOT for v0.0.4)

| Technology | When to Consider | Purpose |
|------------|-----------------|---------|
| `onnxruntime-node` v1.24.3 | Post-training optimization | Export TF.js model to ONNX for 5-10x faster in-game bot inference. Actively maintained, Node 24 compatible. |
| `@tensorflow/tfjs-node` | If/when Node 24 binary published | Native C++ backend for ~10x training speedup. Monitor [issue #8609](https://github.com/tensorflow/tfjs/issues/8609). |
| Python Stable-Baselines3 | If observation/action spaces grow significantly | If the game evolves to need CNN feature extractors, multi-agent PPO, or massive self-play farms. At current scale, JS-native is sufficient. |
| `@tensorflow/tfjs-backend-webgpu` | If training in browser becomes useful | GPU acceleration for web-based training visualization. Not relevant for server-side headless training. |

---

## Sources

- [HIGH] `@tensorflow/tfjs` npm registry (4.22.0, Oct 2024): https://www.npmjs.com/package/@tensorflow/tfjs -- verified via `npm view`
- [HIGH] `@tensorflow/tfjs-node` broken on Node 24: https://github.com/tensorflow/tfjs/issues/8609
- [HIGH] `@tensorflow/tfjs-node` Node 22 pre-built binary request (also unsupported): https://github.com/tensorflow/tfjs/issues/8430
- [HIGH] `@tensorflow/tfjs-node` pre-built binary 404 errors: https://github.com/tensorflow/tfjs/issues/8481
- [HIGH] `onnxruntime-node` npm registry (1.24.3, actively maintained with March 2026 dev builds): https://www.npmjs.com/package/onnxruntime-node -- verified via `npm view`
- [HIGH] Glicko-2 algorithm reference paper (Glickman, revised March 2022): https://www.glicko.net/glicko/glicko2.pdf
- [HIGH] `glicko2` npm (1.2.1, MIT, June 2024): verified via `npm view`
- [HIGH] `glicko2.ts` npm (1.3.2, **GPL-3.0**, January 2022): verified via `npm view`
- [HIGH] `glicko-two` npm (1.3.1, MIT, ~6 years ago): verified via `npm view`
- [MEDIUM] ppo-tfjs reference implementation (gym-like TF.js PPO): https://github.com/zemlyansky/ppo-tfjs
- [MEDIUM] PPO algorithm details -- OpenAI Spinning Up: https://spinningup.openai.com/en/latest/algorithms/ppo.html
- [MEDIUM] Keras PPO reference (actor-critic architecture): https://keras.io/examples/rl/ppo_cartpole/
- [MEDIUM] The 37 Implementation Details of PPO (ICLR Blog Track): https://iclr-blog-track.github.io/2022/03/25/ppo-implementation-details/
- [MEDIUM] MicroRTS GridNet observation/action space design: https://github.com/Farama-Foundation/MicroRTS-Py
- [MEDIUM] Scale-invariant RL for RTS games (2024): https://www.sciencedirect.com/science/article/abs/pii/S1875952124002118
- [MEDIUM] TensorFlow.js platform/environment guide (backend performance comparison): https://www.tensorflow.org/js/guide/platform_environment
- [LOW] TensorFlow.js pure JS CPU ~10-100x slower than native: https://www.tensorflow.org/js/guide/nodejs
- [LOW] Stable-Baselines3 PPO documentation: https://stable-baselines3.readthedocs.io/

---

_Stack research for: v0.0.4 RL Bot Harness & Balance Analysis_
_Researched: 2026-03-30_
