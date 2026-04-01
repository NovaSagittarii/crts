# Phase 20: PPO Training with Self-Play - Research

**Researched:** 2026-04-01
**Domain:** Reinforcement learning training pipeline (PPO), TensorFlow.js, Node.js worker parallelism
**Confidence:** MEDIUM (tfjs-node has significant compatibility constraints requiring architectural adaptation)

## Summary

Phase 20 builds a PPO training pipeline in TypeScript using TensorFlow.js, consuming the Gymnasium-style BotEnvironment API delivered by Phase 19. The pipeline must produce checkpoint files, support self-play with a historical opponent pool, provide a training CLI, and parallelize episode collection across CPU cores.

**Critical finding:** `@tensorflow/tfjs-node` has a long-standing, unresolved incompatibility with Node.js `worker_threads` (GitHub issues #3463, #8388, #2079). The native C++ addon cannot be loaded in multiple worker thread contexts -- subsequent workers fail with "Module did not self-register." Additionally, tfjs-node 4.22.0 (latest stable) is broken with Node.js 24 (the project's runtime at v24.13.0). The RC version `4.23.0-rc.0` (published 2025-01-13) likely contains the Node 24 fix from PR #8425.

**Primary recommendation:** Use a centralized-inference architecture where worker_threads run match simulation ONLY (no TF.js imports), while the main thread handles all neural network inference and gradient updates via tfjs-node. Workers send observations to the main thread, receive actions back, and return complete trajectories. This avoids the native addon threading bug while still parallelizing the expensive match simulation across cores.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Small CNN + MLP head. 2-3 conv layers on spatial feature planes, flatten + concatenate with scalar features, shared MLP trunk, separate policy head (action logits) and value head (state value scalar).
- **D-02:** Shared trunk with separate heads -- standard PPO approach.
- **D-03:** Layer sizes configurable via CLI flags (conv filter counts, MLP widths).
- **D-04:** Checkpoints saved in TF.js SavedModel format (tf.io.fileSystem handler -- JSON topology + binary weights).
- **D-05:** Configurable three-way ratio mix for opponent sampling: latest checkpoint, random historical checkpoint, pure random bot.
- **D-06:** New checkpoints added to pool every N episodes (configurable periodic cadence).
- **D-07:** Pool capped with FIFO eviction of oldest checkpoints. Max pool size configurable.
- **D-08:** Pool seeded with RandomBot + NoOpBot from Phase 18.
- **D-09:** Live metrics to stdout + structured NDJSON training log file.
- **D-10:** Run output in `runs/<run-id>/` directory with config.json, training-log.ndjson, checkpoints/, final-model/.
- **D-11:** Resume support: `--resume <run-id>` loads latest checkpoint, optimizer state, and episode count.
- **D-12:** TF.js decision gate: start with `@tensorflow/tfjs-node`. If benchmark run >8 hours wall clock, document and defer to Python/SB3.
- **D-13:** `@tensorflow/tfjs-node` backend (native TensorFlow C lib with Eigen multi-threading).
- **D-14:** Actor-learner split: worker threads collect episodes, main thread runs PPO gradient updates.
- **D-15:** Configurable worker count via `--workers` flag. Default: auto-detect available cores - 2.
- **D-16:** Configurable episodes per collection round. Default: workers x 4 episodes.
- **D-17:** Weight sync via postMessage with transferable Float32Arrays.

### Claude's Discretion
- Exact default layer sizes (conv filter counts, MLP widths)
- PPO hyperparameter defaults (learning rate, clip epsilon, gamma, GAE lambda, number of PPO epochs per update)
- Default opponent pool sampling ratios and checkpoint promotion interval
- Default max pool size
- Default episodes per collection round multiplier
- Exact CLI flag names and help text
- GAE implementation details
- Entropy bonus coefficient
- Training log NDJSON field names
- How workers handle tfjs-node initialization

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRAIN-01 | PPO training loop runs policy gradient updates against headless matches using TF.js | TF.js Layers API + custom training loop via `optimizer.minimize()`. CNN+MLP architecture maps to `tf.layers.conv2d` + `tf.layers.dense`. GAE computed in pure JS on trajectory buffers. Clipped surrogate loss computed with `tf.variableGrads`. |
| TRAIN-02 | Self-play system maintains opponent pool of historical checkpoints to prevent mode collapse | Checkpoints saved via `model.save('file://...')`, loaded via `tf.loadLayersModel('file://...')`. Pool manager tracks checkpoint metadata. Three-way sampling (latest/historical/random) with FIFO eviction. |
| TRAIN-03 | Training CLI launches configurable training runs from command line | `node:util parseArgs` (established pattern from Phase 18's run-matches.ts CLI). Flat CLI flags for all hyperparameters. NDJSON structured logging to file. |
| TRAIN-04 | Training step parallelizes match simulations across worker threads | **CRITICAL CONSTRAINT:** tfjs-node incompatible with worker_threads. Architecture must use centralized-inference pattern: workers run match sim only (import #bot-harness, NOT @tensorflow/tfjs-node), main thread batches inference. Alternative: workers collect full episodes autonomously with action masks only (no neural net), main thread does inference on collected observations. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @tensorflow/tfjs-node | 4.23.0-rc.0 | Native TF.js backend with Eigen multi-threading | Required for CPU training performance. RC version needed for Node 24 compatibility. Stable 4.22.0 broken with Node 24. |
| worker_threads (node:) | built-in | Parallel match simulation | Node.js built-in. Workers run game simulation only -- NO tfjs-node imports in workers. |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:util (parseArgs) | built-in | CLI argument parsing | Training CLI, following Phase 18 pattern |
| node:fs/promises | built-in | Checkpoint/log file I/O | Saving/loading models, writing NDJSON logs |
| node:path | built-in | Path construction | Run directories, checkpoint paths |
| node:os | built-in | CPU core detection | Auto-detecting worker count |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| @tensorflow/tfjs-node | @tensorflow/tfjs (pure JS) | 10-100x slower for training; acceptable only if native addon fails to install |
| @tensorflow/tfjs-node | @tensorflow/tfjs-backend-wasm | Could work in worker_threads but slower than native; good fallback |
| worker_threads | child_process.fork() | Full isolation (tfjs-node works per-process) but higher memory overhead per worker; viable if centralized-inference pattern proves too complex |
| node:util parseArgs | commander/yargs | External dependency; parseArgs sufficient and already established in project |

**Installation:**
```bash
npm install @tensorflow/tfjs-node@4.23.0-rc.0
```

**Version verification:** `@tensorflow/tfjs-node@4.23.0-rc.0` published 2025-01-13 on npm. Tagged as `next`. This is the only version that may work with Node.js 24.13.0. If installation fails, fallback to `@tensorflow/tfjs` (pure JS CPU backend) or downgrade Node.js to v22 LTS.

**IMPORTANT:** Before any implementation work, the very first task must be to verify that `@tensorflow/tfjs-node@4.23.0-rc.0` installs and runs correctly on this machine (Node 24.13.0, Linux Alpine). This is a blocking prerequisite.

## Architecture Patterns

### Recommended Project Structure
```
packages/bot-harness/
  training/
    ppo-network.ts          # CNN+MLP model builder (tf.model API)
    ppo-trainer.ts           # PPO update logic (GAE, clipped loss, optimizer)
    trajectory-buffer.ts     # Stores (obs, action, reward, value, logProb, done)
    opponent-pool.ts         # Checkpoint management + sampling
    training-worker.ts       # Worker thread entry point (NO tfjs-node import)
    training-coordinator.ts  # Main thread orchestrator (spawns workers, runs inference)
    training-config.ts       # Hyperparameter types + defaults
    training-logger.ts       # NDJSON structured logging
  bin/
    train.ts                 # CLI entry point (parseArgs + coordinator)
```

### Pattern 1: Centralized-Inference Actor-Learner Split
**What:** Workers run match simulation using BotEnvironment (which uses RtsRoom, Grid, etc. -- all pure TypeScript, no native addons). Workers do NOT import tfjs-node. Instead, workers either: (a) send observations to main thread for batched inference, or (b) run entire episodes using action-mask-based random sampling, then send trajectory data back to main for PPO update.
**When to use:** Always -- this is the required pattern due to tfjs-node worker_threads incompatibility.

**Architecture Option A: Synchronous inference relay (complex but optimal for policy quality)**
```
Worker:                                 Main Thread:
  env.reset() -> obs                      |
  postMessage({obs, mask}) -------->      batch inference
  <-------- postMessage({action})         |
  env.step(action) -> obs, reward         |
  ... repeat per tick ...                 |
  postMessage({trajectory}) -------->     PPO update
```
Drawback: High IPC overhead (message per tick per worker). With 2000 ticks/episode and N workers, this is chatty.

**Architecture Option B: Autonomous episode collection (simpler, recommended)**
```
Worker:                                 Main Thread:
  receive frozen weights --------->       |
  load weights into local model*          |
  run full episode autonomously           |
  postMessage({trajectory}) -------->     PPO update
  <-------- postMessage({newWeights})     |
  ... repeat ...                          |

  * Workers use @tensorflow/tfjs (pure JS) or @tensorflow/tfjs-backend-wasm for local inference
```
This avoids per-tick IPC. Workers load a lightweight pure-JS or WASM TF.js backend for inference only (no gradient computation). The main thread uses tfjs-node for gradient updates.

**Architecture Option C: No inference in workers at all (simplest, action-mask only)**
```
Worker:                                 Main Thread:
  run episode with masked-random policy   |
  (use action mask to sample valid actions)|
  postMessage({trajectory}) -------->     compute advantages + PPO update
  ... repeat ...                          |
```
Workers use `BotEnvironment.step()` with actions sampled uniformly from the action mask (no neural net needed). Main thread computes log probs, values, and advantages post-hoc from stored observations. Simplest implementation but collects random-quality episodes initially.

**Recommended:** Architecture Option B with `@tensorflow/tfjs` (pure JS) in workers for inference. Workers import the pure JS TF.js (no native addon), load frozen weights received from main thread, run inference locally, and send complete trajectories back. Main thread uses `@tensorflow/tfjs-node` for gradient updates only. This gives policy-guided episode collection without the native addon threading issue.

**Key constraint validation:** `@tensorflow/tfjs` (pure JS, no native addon) CAN be safely loaded in `worker_threads` because it has no C++ addon. Only `@tensorflow/tfjs-node` has the native addon problem. Workers can use the pure JS backend for inference (slower but functional for forward passes only).

### Pattern 2: CNN + MLP Policy-Value Network
**What:** Build a TF.js model with `tf.model()` (functional API) that takes spatial planes + scalars as two inputs, processes planes through conv2d layers, flattens, concatenates with scalars, passes through shared MLP trunk, then splits into policy head (logits) and value head (scalar).
**When to use:** For all neural network construction in this phase.

```typescript
import * as tf from '@tensorflow/tfjs-node';

function buildPPOModel(config: {
  planeShape: [number, number, number]; // [C, H, W]
  scalarCount: number;
  actionCount: number;
  convFilters: number[];
  mlpUnits: number[];
}): tf.LayersModel {
  // Input: spatial feature planes [batch, H, W, C] (channels-last for tf.js conv2d)
  const planeInput = tf.input({
    shape: [config.planeShape[1], config.planeShape[2], config.planeShape[0]],
    name: 'planes',
  });

  // Input: scalar features [batch, scalarCount]
  const scalarInput = tf.input({
    shape: [config.scalarCount],
    name: 'scalars',
  });

  // CNN trunk
  let conv = planeInput;
  for (let i = 0; i < config.convFilters.length; i++) {
    conv = tf.layers.conv2d({
      filters: config.convFilters[i],
      kernelSize: 3,
      padding: 'same',
      activation: 'relu',
      name: `conv_${i}`,
    }).apply(conv) as tf.SymbolicTensor;
  }
  const flat = tf.layers.flatten({ name: 'flatten' }).apply(conv) as tf.SymbolicTensor;

  // Concatenate flattened conv output with scalar features
  const merged = tf.layers.concatenate({ name: 'merge' }).apply([flat, scalarInput]) as tf.SymbolicTensor;

  // Shared MLP trunk
  let trunk = merged;
  for (let i = 0; i < config.mlpUnits.length; i++) {
    trunk = tf.layers.dense({
      units: config.mlpUnits[i],
      activation: 'relu',
      name: `trunk_${i}`,
    }).apply(trunk) as tf.SymbolicTensor;
  }

  // Policy head (action logits -- NO softmax, use log_softmax in loss)
  const policyLogits = tf.layers.dense({
    units: config.actionCount,
    name: 'policy_logits',
  }).apply(trunk) as tf.SymbolicTensor;

  // Value head (state value scalar)
  const value = tf.layers.dense({
    units: 1,
    name: 'value',
  }).apply(trunk) as tf.SymbolicTensor;

  return tf.model({
    inputs: [planeInput, scalarInput],
    outputs: [policyLogits, value],
    name: 'ppo_model',
  });
}
```

### Pattern 3: PPO Clipped Surrogate Loss
**What:** Standard PPO-Clip objective computed inside `optimizer.minimize()`.
**When to use:** During each PPO update epoch over the collected trajectory batch.

```typescript
// Pseudo-code for PPO update step
function ppoPolicyLoss(
  logits: tf.Tensor,        // Current policy logits [batch, actionCount]
  actions: tf.Tensor,        // Taken actions [batch]
  oldLogProbs: tf.Tensor,    // Log probs under old policy [batch]
  advantages: tf.Tensor,     // GAE advantages [batch]
  clipEpsilon: number,       // e.g., 0.2
  entropyCoeff: number,      // e.g., 0.01
): tf.Scalar {
  return tf.tidy(() => {
    const logSoftmax = tf.logSoftmax(logits);
    const newLogProbs = logSoftmax.gather(actions, 1); // log prob of taken action
    const ratio = tf.exp(tf.sub(newLogProbs, oldLogProbs));
    const clipped = tf.clipByValue(ratio, 1 - clipEpsilon, 1 + clipEpsilon);
    const surr1 = tf.mul(ratio, advantages);
    const surr2 = tf.mul(clipped, advantages);
    const policyLoss = tf.neg(tf.mean(tf.minimum(surr1, surr2)));

    // Entropy bonus (encourages exploration)
    const probs = tf.softmax(logits);
    const entropy = tf.neg(tf.sum(tf.mul(probs, logSoftmax), -1));
    const entropyLoss = tf.neg(tf.mean(entropy));

    return tf.add(policyLoss, tf.mul(entropyCoeff, entropyLoss)) as tf.Scalar;
  });
}
```

### Pattern 4: GAE Computation (Pure JavaScript, No TF.js)
**What:** Generalized Advantage Estimation computed on raw trajectory arrays, not tensors. Standard recursive backward pass.
**When to use:** After episode collection, before PPO updates.

```typescript
function computeGAE(
  rewards: number[],
  values: number[],
  dones: boolean[],
  lastValue: number,
  gamma: number,    // e.g., 0.99
  lambda: number,   // e.g., 0.95
): { advantages: Float32Array; returns: Float32Array } {
  const T = rewards.length;
  const advantages = new Float32Array(T);
  const returns = new Float32Array(T);

  let lastGAE = 0;
  for (let t = T - 1; t >= 0; t--) {
    const nextValue = t === T - 1 ? lastValue : values[t + 1];
    const nextNonTerminal = t === T - 1 ? (dones[T - 1] ? 0 : 1) : (dones[t] ? 0 : 1);
    const delta = rewards[t] + gamma * nextValue * nextNonTerminal - values[t];
    lastGAE = delta + gamma * lambda * nextNonTerminal * lastGAE;
    advantages[t] = lastGAE;
    returns[t] = advantages[t] + values[t];
  }

  return { advantages, returns };
}
```

### Pattern 5: Weight Transfer to Workers
**What:** Extract model weights as Float32Arrays, transfer to workers via postMessage with transferable list, workers reconstruct weights into their local pure-JS tfjs model.
**When to use:** After each PPO update, to sync new policy weights to collection workers.

```typescript
// Main thread: extract weights
function extractWeights(model: tf.LayersModel): ArrayBuffer[] {
  return model.getWeights().map(w => {
    const data = w.dataSync(); // Float32Array
    const buffer = data.buffer.slice(0);
    return buffer;
  });
}

// Worker: apply weights
function applyWeights(model: tf.LayersModel, buffers: ArrayBuffer[]): void {
  const tensors = buffers.map((buf, i) => {
    const shape = model.getWeights()[i].shape;
    return tf.tensor(new Float32Array(buf), shape);
  });
  model.setWeights(tensors);
  tensors.forEach(t => t.dispose());
}
```

### Anti-Patterns to Avoid
- **Importing @tensorflow/tfjs-node in worker_threads:** Will crash with "Module did not self-register" on second+ worker. Use pure JS `@tensorflow/tfjs` in workers or no TF.js at all.
- **Using `model.fit()` for PPO:** PPO requires custom loss computation with clipped surrogate objective. Use `optimizer.minimize()` with custom loss function.
- **Forgetting `tf.tidy()` in training loops:** TF.js does NOT have automatic garbage collection for tensors. Every training iteration leaks memory without explicit disposal. Wrap all tensor operations in `tf.tidy()`.
- **Storing TF.js tensors in trajectory buffers:** Store raw `Float32Array` / `number[]` in trajectory buffers, convert to tensors only at PPO update time. Tensors in buffers cause memory leaks and cannot be transferred between threads.
- **Using channels-first layout with tf.layers.conv2d:** TF.js conv2d defaults to channels-last `[batch, height, width, channels]`. The ObservationEncoder outputs channels-first `[C, H, W]`. Must transpose before feeding to conv2d: reshape from `[C, H, W]` to `[H, W, C]`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Neural network layers | Custom matrix ops | `tf.layers.conv2d`, `tf.layers.dense` | Correctness, GPU/Eigen acceleration, serialization |
| Optimizer (Adam) | Custom Adam implementation | `tf.train.adam()` | Numerically validated, handles state, bias correction |
| Categorical sampling | Custom multinomial | `tf.multinomial(logits, 1)` | Correct probability-weighted sampling |
| Model serialization | Custom weight serialization | `model.save('file://...')` / `tf.loadLayersModel('file://...')` | TF.js native format, cross-environment compatible |
| CLI argument parsing | Custom flag parser | `node:util parseArgs` | Built-in, established project pattern |
| Worker pool management | Custom thread management | Manual worker_threads pool with message passing | Small enough that a library isn't needed, but don't use bare `new Worker()` without pool pattern |

**Key insight:** The PPO algorithm itself must be hand-rolled since no production-ready TypeScript PPO library exists for TF.js. The `ppo-tfjs` npm package is a reference (~300 lines) but is JavaScript-only, uses a different architecture, and lacks TypeScript types. Port the algorithm, not the library.

## Common Pitfalls

### Pitfall 1: tfjs-node + worker_threads Crash
**What goes wrong:** Importing `@tensorflow/tfjs-node` in worker_threads causes "Module did not self-register" or tensor reference errors after the first worker loads.
**Why it happens:** The native C++ TensorFlow addon shares global state across threads and does not support Node.js worker_threads' context-aware addon requirements.
**How to avoid:** Workers must NEVER import `@tensorflow/tfjs-node`. Use `@tensorflow/tfjs` (pure JS) in workers for inference, or no TF.js at all.
**Warning signs:** Crashes on second worker spawn, intermittent "Tensor not referenced" errors.

### Pitfall 2: tfjs-node + Node.js 24 Incompatibility
**What goes wrong:** `@tensorflow/tfjs-node@4.22.0` (latest stable) fails to load on Node.js 24.
**Why it happens:** Native addon build incompatibility fixed in PR #8425 but not yet released in a stable version.
**How to avoid:** Use `@tensorflow/tfjs-node@4.23.0-rc.0` (tagged `next` on npm). If RC fails, fallback to Node 22 or pure JS backend.
**Warning signs:** Module load error on first import of `@tensorflow/tfjs-node`.

### Pitfall 3: Tensor Memory Leaks in Training Loop
**What goes wrong:** Memory grows unboundedly during training, eventually OOM crash.
**Why it happens:** TF.js tensors are NOT garbage collected automatically. Each `tf.tensor()`, `tf.add()`, etc. allocates native memory that persists until `dispose()` or `tf.tidy()` cleanup.
**How to avoid:** Wrap ALL tensor operations in `tf.tidy()`. Store trajectory data as plain JS arrays/Float32Arrays, NOT as tf.Tensor objects. Call `tf.disposeVariables()` when discarding old models.
**Warning signs:** `tf.memory().numTensors` growing over training iterations.

### Pitfall 4: Channels-First vs Channels-Last Mismatch
**What goes wrong:** Conv2d produces garbage output or shape errors.
**Why it happens:** ObservationEncoder outputs `[C, H, W]` (channels-first), but TF.js `conv2d` expects `[H, W, C]` (channels-last) by default.
**How to avoid:** Transpose observation planes from `[C, H, W]` to `[H, W, C]` before feeding to the network. Or set `dataFormat: 'channelsFirst'` on conv2d layers (less common in TF.js, may have less optimization).
**Warning signs:** Shape mismatch errors, model producing constant outputs.

### Pitfall 5: Action Masking with Softmax
**What goes wrong:** Agent selects invalid actions despite masking.
**Why it happens:** Naively applying mask after softmax doesn't zero out probabilities correctly. Must mask BEFORE softmax by setting invalid logits to negative infinity.
**How to avoid:** Apply mask to logits: `maskedLogits = logits + (1 - mask) * (-1e9)`. Then apply softmax/multinomial to masked logits.
**Warning signs:** Agent attempting builds outside territory, rejected actions.

### Pitfall 6: On-Policy Data Staleness
**What goes wrong:** PPO diverges or oscillates after many updates on same batch.
**Why it happens:** PPO is on-policy -- data must come from the current policy. Too many epochs on the same batch violates the on-policy assumption.
**How to avoid:** Limit PPO epochs per batch (typically 3-10). Monitor KL divergence between old and new policy; stop early if KL exceeds threshold (~0.015).
**Warning signs:** Loss oscillating, win rate plateauing or decreasing.

### Pitfall 7: Observation/Action Space Dimension Mismatch
**What goes wrong:** Model input/output shapes don't match environment.
**Why it happens:** Hard-coded dimensions instead of reading from `BotEnvironment.observationSpace` / `BotEnvironment.actionSpace`.
**How to avoid:** Always derive network dimensions from environment metadata: `observationSpace.planes.shape` for CNN input, `actionSpace.n` for policy head output.
**Warning signs:** Shape errors on first forward pass.

## Code Examples

### Example 1: Custom Training Loop with optimizer.minimize()
```typescript
// Source: TF.js official docs + PPO-TFJS reference
import * as tf from '@tensorflow/tfjs-node';

const optimizer = tf.train.adam(3e-4);

function trainStep(
  model: tf.LayersModel,
  obsBatch: tf.Tensor[],     // [planesTensor, scalarsTensor]
  actions: tf.Tensor1D,
  oldLogProbs: tf.Tensor1D,
  advantages: tf.Tensor1D,
  returns: tf.Tensor1D,
  clipEpsilon: number,
  entropyCoeff: number,
  valueLossCoeff: number,
): { policyLoss: number; valueLoss: number; entropy: number } {
  let pLoss = 0, vLoss = 0, ent = 0;

  optimizer.minimize(() => {
    const [logits, values] = model.predict(obsBatch) as tf.Tensor[];
    const valuesSqueezed = values.squeeze([-1]);

    // Policy loss (clipped surrogate)
    const logSoftmax = tf.logSoftmax(logits);
    const actionOneHot = tf.oneHot(actions, logits.shape[1]!);
    const newLogProbs = tf.sum(tf.mul(logSoftmax, actionOneHot), -1);
    const ratio = tf.exp(tf.sub(newLogProbs, oldLogProbs));
    const clipped = tf.clipByValue(ratio, 1 - clipEpsilon, 1 + clipEpsilon);
    const surr1 = tf.mul(ratio, advantages);
    const surr2 = tf.mul(clipped, advantages);
    const policyLoss = tf.neg(tf.mean(tf.minimum(surr1, surr2)));

    // Value loss
    const valueLoss = tf.mean(tf.squaredDifference(valuesSqueezed, returns));

    // Entropy bonus
    const probs = tf.softmax(logits);
    const entropy = tf.neg(tf.mean(tf.sum(tf.mul(probs, logSoftmax), -1)));

    pLoss = policyLoss.dataSync()[0];
    vLoss = valueLoss.dataSync()[0];
    ent = entropy.dataSync()[0];

    return tf.add(
      tf.add(policyLoss, tf.mul(valueLossCoeff, valueLoss)),
      tf.mul(-entropyCoeff, entropy),
    ) as tf.Scalar;
  });

  return { policyLoss: pLoss, valueLoss: vLoss, entropy: ent };
}
```

### Example 2: Masked Action Sampling
```typescript
// Source: Standard RL practice + BotEnvironment action mask
function sampleMaskedAction(
  logits: tf.Tensor1D,
  actionMask: Uint8Array,
): { action: number; logProb: number } {
  return tf.tidy(() => {
    // Apply mask: set invalid actions to -Infinity before softmax
    const maskTensor = tf.tensor1d(Array.from(actionMask), 'float32');
    const maskedLogits = tf.add(
      logits,
      tf.mul(tf.sub(1, maskTensor), -1e9),
    );

    // Sample action from masked distribution
    const action = tf.multinomial(maskedLogits.expandDims(0), 1)
      .dataSync()[0];

    // Compute log probability of sampled action
    const logSoftmax = tf.logSoftmax(maskedLogits);
    const logProb = logSoftmax.dataSync()[action];

    return { action, logProb };
  });
}
```

### Example 3: Model Save/Load with Checkpoint Directory
```typescript
// Source: TF.js official save/load guide
import * as tf from '@tensorflow/tfjs-node';
import { mkdir } from 'node:fs/promises';

async function saveCheckpoint(
  model: tf.LayersModel,
  checkpointDir: string,
  episode: number,
): Promise<string> {
  const dir = `${checkpointDir}/checkpoint-${episode}`;
  await mkdir(dir, { recursive: true });
  await model.save(`file://${dir}`);
  return dir;
}

async function loadCheckpoint(
  checkpointDir: string,
): Promise<tf.LayersModel> {
  return tf.loadLayersModel(`file://${checkpointDir}/model.json`);
}
```

### Example 4: Worker Thread for Episode Collection (Pure JS TF.js)
```typescript
// training-worker.ts -- runs in worker_threads
// CRITICAL: import @tensorflow/tfjs, NOT @tensorflow/tfjs-node
import * as tf from '@tensorflow/tfjs';
import { parentPort, workerData } from 'node:worker_threads';
import { BotEnvironment } from '#bot-harness';

// Load model architecture and weights received from main thread
const env = new BotEnvironment(workerData.envConfig);
let model: tf.LayersModel | null = null;

parentPort!.on('message', async (msg) => {
  if (msg.type === 'set-weights') {
    if (!model) {
      // Build model from config (same architecture as main thread)
      model = buildModel(workerData.modelConfig);
    }
    applyWeights(model, msg.weightBuffers);
    return;
  }

  if (msg.type === 'collect-episode') {
    const trajectory = collectEpisode(env, model!, msg.seed, msg.opponent);
    // Transfer trajectory data back to main thread
    parentPort!.postMessage(
      { type: 'trajectory', data: trajectory },
      trajectory.transferList, // ArrayBuffer transfer list
    );
  }
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| tfjs-node 4.22.0 | tfjs-node 4.23.0-rc.0 | 2025-01-13 | Required for Node.js 24 compatibility |
| A3C (async gradient updates) | PPO-Clip (clipped surrogate) | 2017 (PPO paper) | More stable training, simpler implementation |
| Single-process RL | Actor-learner split | 2018 (IMPALA) | Parallel episode collection for throughput |
| Hand-rolled optimizers | TF.js built-in Adam | Stable | Numerically correct, handles momentum/bias |

**Deprecated/outdated:**
- `@tensorflow/tfjs-node@4.22.0`: Broken with Node.js 24. Use `4.23.0-rc.0`.
- Shared-weight worker_threads with tfjs-node: Not supported. Use centralized inference or pure JS backend in workers.

## Open Questions

1. **tfjs-node 4.23.0-rc.0 on Alpine Linux + Node 24**
   - What we know: The RC likely includes the Node 24 fix from PR #8425
   - What's unclear: Whether the native addon builds correctly on Alpine Linux (musl libc vs glibc). tfjs-node requires prebuilt binaries or compilation from source.
   - Recommendation: First task in the plan must verify installation. If it fails, immediate fallback to `@tensorflow/tfjs` (pure JS) for everything, accepting slower training.

2. **Pure JS TF.js Performance in Workers**
   - What we know: `@tensorflow/tfjs` (pure JS, no native addon) is safe for worker_threads
   - What's unclear: How much slower inference is compared to tfjs-node for the specific model size (CNN on 52x52 grid)
   - Recommendation: Benchmark pure JS inference vs native. If <5ms per forward pass, it's acceptable for episode collection workers.

3. **Conv2d Input Format (channels-first vs channels-last)**
   - What we know: ObservationEncoder outputs `[5, 52, 52]` (channels-first). TF.js conv2d defaults to channels-last `[52, 52, 5]`.
   - What's unclear: Whether `dataFormat: 'channelsFirst'` on conv2d layers works well with tfjs-node Eigen backend
   - Recommendation: Use `dataFormat: 'channelsFirst'` if supported to avoid per-observation transpose overhead. Fall back to transposing at model input if not.

4. **Optimizer State Serialization for Resume**
   - What we know: TF.js `model.save()` saves topology + weights but NOT optimizer state
   - What's unclear: How to persist Adam optimizer momentum/velocity for resume support (D-11)
   - Recommendation: Manually serialize optimizer weights via `optimizer.getWeights()` / `optimizer.setWeights()`. Save as separate binary file alongside model checkpoint.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Everything | Yes | 24.13.0 | Node 22 LTS if tfjs-node fails |
| npm | Package install | Yes | 11.9.0 | -- |
| @tensorflow/tfjs-node | Training (TRAIN-01) | UNKNOWN (not installed) | 4.23.0-rc.0 target | @tensorflow/tfjs (pure JS) |
| worker_threads | Parallelism (TRAIN-04) | Yes | built-in | child_process.fork() |
| tsx | CLI execution | Yes | installed | -- |
| vitest | Tests | Yes | installed | -- |

**Missing dependencies with no fallback:**
- None -- all dependencies have viable fallbacks

**Missing dependencies with fallback:**
- `@tensorflow/tfjs-node`: Not yet installed. Must verify 4.23.0-rc.0 works on this platform. If native addon fails, use `@tensorflow/tfjs` (pure JS, ~10-100x slower but functional).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.0.18 |
| Config file | `vitest.config.ts` (exists, includes #bot-harness alias) |
| Quick run command | `npx vitest run --dir packages/bot-harness` |
| Full suite command | `npm test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRAIN-01 | PPO network builds from env observation/action space | unit | `npx vitest run packages/bot-harness/training/ppo-network.test.ts -x` | Wave 0 |
| TRAIN-01 | PPO update reduces loss on fixed trajectory batch | unit | `npx vitest run packages/bot-harness/training/ppo-trainer.test.ts -x` | Wave 0 |
| TRAIN-01 | GAE computation matches hand-computed values | unit | `npx vitest run packages/bot-harness/training/trajectory-buffer.test.ts -x` | Wave 0 |
| TRAIN-02 | Opponent pool adds/evicts/samples checkpoints correctly | unit | `npx vitest run packages/bot-harness/training/opponent-pool.test.ts -x` | Wave 0 |
| TRAIN-02 | Pool sampling follows configured ratios | unit | `npx vitest run packages/bot-harness/training/opponent-pool.test.ts -x` | Wave 0 |
| TRAIN-03 | CLI parses all flags and launches training | unit | `npx vitest run packages/bot-harness/training/training-config.test.ts -x` | Wave 0 |
| TRAIN-04 | Workers collect episodes and return valid trajectories | integration | `npx vitest run packages/bot-harness/training/training-coordinator.test.ts -x` | Wave 0 |
| TRAIN-01 | Trained policy wins > untrained vs random (convergence) | integration | `npx vitest run packages/bot-harness/training/convergence.test.ts -x` | Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run --dir packages/bot-harness`
- **Per wave merge:** `npm run test:fast`
- **Phase gate:** `npm test` (full suite green before verification)

### Wave 0 Gaps
- [ ] `packages/bot-harness/training/ppo-network.test.ts` -- covers TRAIN-01 (network builds correctly)
- [ ] `packages/bot-harness/training/ppo-trainer.test.ts` -- covers TRAIN-01 (PPO update logic)
- [ ] `packages/bot-harness/training/trajectory-buffer.test.ts` -- covers TRAIN-01 (GAE computation)
- [ ] `packages/bot-harness/training/opponent-pool.test.ts` -- covers TRAIN-02 (pool management)
- [ ] `packages/bot-harness/training/training-config.test.ts` -- covers TRAIN-03 (CLI config parsing)
- [ ] `packages/bot-harness/training/training-coordinator.test.ts` -- covers TRAIN-04 (worker coordination)
- [ ] `packages/bot-harness/training/convergence.test.ts` -- covers success criterion #5 (win rate improvement)
- [ ] TF.js installation verification script (blocking prerequisite)

## Recommended PPO Hyperparameter Defaults

Based on standard PPO literature (Schulman et al. 2017, CleanRL, Stable Baselines3):

| Parameter | Default | Range | Notes |
|-----------|---------|-------|-------|
| Learning rate | 3e-4 | 1e-5 to 1e-3 | Adam optimizer; standard starting point |
| Clip epsilon | 0.2 | 0.1 to 0.3 | PPO clipping ratio |
| Gamma (discount) | 0.99 | 0.9 to 0.999 | Future reward discounting |
| GAE lambda | 0.95 | 0.9 to 1.0 | Advantage estimation bias-variance tradeoff |
| PPO epochs | 4 | 3 to 10 | Update passes per batch; watch KL divergence |
| Mini-batch size | 64 | 32 to 256 | Subdivisions of trajectory batch per epoch |
| Entropy coefficient | 0.01 | 0.001 to 0.05 | Exploration bonus; higher = more exploration |
| Value loss coefficient | 0.5 | 0.25 to 1.0 | Relative weight of value vs policy loss |
| Max gradient norm | 0.5 | 0.5 to 1.0 | Gradient clipping for stability |
| Target KL (early stop) | 0.015 | 0.01 to 0.03 | Stop PPO epochs if KL exceeds this |

### Recommended Network Defaults
| Parameter | Default | Notes |
|-----------|---------|-------|
| Conv filters | [32, 64, 64] | 3 conv layers, progressively wider |
| Conv kernel size | 3 | Small receptive field for 52x52 grid |
| MLP hidden units | [256, 128] | Shared trunk after flatten+concat |
| Activation | relu | Standard for PPO |

### Recommended Self-Play Defaults
| Parameter | Default | Notes |
|-----------|---------|-------|
| Opponent ratio (latest) | 0.5 | 50% games against current best |
| Opponent ratio (historical) | 0.3 | 30% games against random historical checkpoint |
| Opponent ratio (random bot) | 0.2 | 20% games against RandomBot/NoOpBot |
| Checkpoint interval | 50 episodes | Save new checkpoint every 50 episodes |
| Max pool size | 30 | FIFO eviction beyond 30 checkpoints |

## Sources

### Primary (HIGH confidence)
- TF.js official save/load guide: https://www.tensorflow.org/js/guide/save_load
- TF.js training guide: https://www.tensorflow.org/js/guide/train_models
- TF.js API reference (conv2d, dense, model, optimizers): https://js.tensorflow.org/api/latest/
- npm registry: @tensorflow/tfjs-node versions and dist-tags
- Node.js worker_threads docs: https://nodejs.org/api/worker_threads.html

### Secondary (MEDIUM confidence)
- GitHub Issue #8388 (tfjs-node + worker_threads failure, Feb 2025 latest comment): https://github.com/tensorflow/tfjs/issues/8388
- GitHub Issue #3463 (backend overwrite in workers): https://github.com/tensorflow/tfjs/issues/3463
- GitHub Issue #8609 (tfjs-node broken with Node 24): https://github.com/tensorflow/tfjs/issues/8609
- ppo-tfjs reference implementation: https://github.com/zemlyansky/ppo-tfjs
- PPO algorithm reference: https://spinningup.openai.com/en/latest/algorithms/ppo.html
- CleanRL PPO docs: https://docs.cleanrl.dev/rl-algorithms/ppo/

### Tertiary (LOW confidence)
- tfjs-node 4.23.0-rc.0 including Node 24 fix: inferred from PR #8425 merge date vs RC publish date, not verified
- Pure JS @tensorflow/tfjs working in worker_threads: logical inference (no native addon = no addon threading issue), not empirically verified in this project

## Metadata

**Confidence breakdown:**
- Standard stack: MEDIUM - tfjs-node has known compatibility issues with both Node 24 and worker_threads; requires RC version and architectural workaround
- Architecture: MEDIUM-HIGH - centralized-inference pattern is well-established in RL literature; pure JS TF.js in workers is the novel adaptation
- Pitfalls: HIGH - well-documented issues from GitHub issues, official docs, and established RL practice
- PPO algorithm: HIGH - extremely well-documented algorithm with reference implementations in multiple languages

**Research date:** 2026-04-01
**Valid until:** 2026-04-15 (fast-moving: tfjs-node compatibility situation could change with a new release)
