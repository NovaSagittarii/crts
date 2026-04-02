# Phase 23: Playable In-Game Bot - Research

**Researched:** 2026-04-01
**Domain:** Socket.IO bot adapter, TF.js model inference, lobby integration, tick-budget management
**Confidence:** HIGH

## Summary

Phase 23 delivers a Socket.IO bot adapter that connects a trained PPO model to a live game server as a virtual player. The bot reuses the existing ObservationEncoder, ActionDecoder, and TF.js model infrastructure from Phases 18-20, wrapping them in a Socket.IO client process that follows the identical protocol as the human web client. The primary new server-side capability is the "Add Bot" host action, which fills an empty lobby slot with a bot. The primary new client-side additions are the "Add Bot" button in the lobby and a bot indicator in the player list.

The codebase has complete infrastructure for this phase: `socket-contract.ts` defines all events, `tfjs-file-io.ts` provides model loading, `ObservationEncoder` and `ActionDecoder` handle the observe-infer-act pipeline, and the integration test fixtures demonstrate the exact Socket.IO client connection pattern. The server's `sessionId`-based auth and lobby system accept any Socket.IO client, so the bot process connects identically to a browser client.

**Primary recommendation:** Build the bot adapter as a new CLI entry point (`bin/play-bot.ts`) in the bot-harness package, implementing BotStrategy backed by TF.js model inference, and connecting via `socket.io-client` with the same auth/join/ready/gameplay protocol as `apps/web/src/client.ts`. Add a `bot:add` server event for the host to trigger bot slot assignment, and a minimal lobby UI addition for the "Add Bot" button.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Host can fill an empty player slot with a bot via an explicit "Add Bot" action in the lobby. Host controls when/if a bot joins -- not auto-join or matchmaking.
- **D-02:** Bot connects as a separate process via Socket.IO -- identical to a human client from the server's perspective. Tests the real socket protocol end-to-end.
- **D-03:** Bot is visually distinguishable: shown with a bot indicator and a name like "Bot (PPO-v3)" in both lobby and match UI. Transparent to the human player.
- **D-04:** `--model <path>` CLI flag for explicit model path, with auto-detect fallback to the most recent `final-model/` directory under `runs/`. Explicit flag takes precedence.
- **D-05:** No hot-swap between matches. Restart the bot process with a different `--model` flag to change models. Simple lifecycle, matches are short enough.
- **D-06:** Three configurable fallback strategies for when inference exceeds the per-tick budget: (a) No-op (default), (b) Cached action, (c) Pre-compute + deadline. Configurable via CLI flag.
- **D-07:** Tick budget metrics logged: inference time per tick, budget utilization %, and fallback triggers. Configurable verbosity.
- **D-08:** Auto-reconnect with exponential backoff on disconnect. On successful reconnect, resume play using the server's existing reconnect/resync flow.
- **D-09:** Configurable post-match behavior: `--single-match` flag to disconnect after one match. Default: stay connected and wait for the next match.
- **D-10:** Bot handles full match lifecycle via socket events: lobby join -> ready -> countdown -> active (tick-by-tick decisions) -> match finished.

### Claude's Discretion

- Exact CLI flag names and defaults for the bot adapter
- Socket.IO connection configuration (URL, reconnect attempts, backoff parameters)
- How "Add Bot" action is communicated from host client to server (new socket event or room config)
- Server-side changes needed to support bot slot filling
- UI implementation for bot indicator and "Add Bot" button
- Model warm-up strategy (pre-run dummy inference to avoid cold-start latency)
- Exact tick budget threshold (derived from server tick rate)
- Internal module structure within bot-harness for Phase 23 additions
- How auto-detect scans `runs/` for latest model (sorting by timestamp, reading metadata, etc.)

### Deferred Ideas (OUT OF SCOPE)

None -- discussion stayed within phase scope.
</user_constraints>

<phase_requirements>

## Phase Requirements

| ID        | Description                                                                              | Research Support                                                                                                                                                             |
| --------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEPLOY-01 | Socket.IO bot adapter connects a trained model to a live game server as a virtual player | Full pipeline verified: socket-contract.ts events, ObservationEncoder/ActionDecoder, TF.js loadModelFromDir, socket.io-client auth pattern from web client and test fixtures |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Import direction:** `apps/*` may import from `packages/*`; `packages/*` must never import from `apps/*` or use Socket.IO/Express/DOM APIs. The bot CLI (`bin/play-bot.ts`) imports from `#bot-harness` and `#rts-engine`. Bot adapter code with Socket.IO client dependency lives in `bin/` or `apps/`, NOT in `packages/bot-harness/`.
- **Socket contract:** All event names and payload shapes come from `packages/rts-engine/socket-contract.ts` -- do not re-declare.
- **Explicit `.js` extensions** in relative imports.
- **Strict TypeScript mode;** avoid `any`.
- **Explicit return types** for exported functions.
- **Runtime payload validation** at socket/network boundaries.
- **Testing placement:** Integration tests in `tests/integration/server/`; package unit tests co-located in `packages/*`.
- **Integration test patterns:** Use fixture builders, ephemeral ports (`port: 0`), teardown clients before server.
- **Commits:** Conventional Commits.
- **CLI pattern (Phase 18 precedent):** `node:util parseArgs` for zero-dependency CLI argument parsing.

## Standard Stack

### Core

| Library             | Version     | Purpose                     | Why Standard                                         |
| ------------------- | ----------- | --------------------------- | ---------------------------------------------------- |
| socket.io-client    | 4.8.3       | Bot connects to live server | Already installed; same lib as web client            |
| @tensorflow/tfjs    | 4.23.0-rc.0 | Model inference (predict)   | Already installed; pure JS CPU backend (musl Alpine) |
| node:util parseArgs | Node 24.13  | CLI argument parsing        | Phase 18/20 precedent; zero-dependency               |

### Supporting

| Library | Version | Purpose                      | When to Use                             |
| ------- | ------- | ---------------------------- | --------------------------------------- |
| tsx     | 4.21.0  | TypeScript execution for CLI | Dev-time execution of `bin/play-bot.ts` |

### Alternatives Considered

| Instead of                            | Could Use                  | Tradeoff                                   |
| ------------------------------------- | -------------------------- | ------------------------------------------ |
| Separate process via socket.io-client | In-process bot (no socket) | Violates D-02; skips real protocol testing |
| Custom HTTP polling                   | Socket.IO transport        | Non-standard; loses bidirectional events   |

No new dependencies are needed. Everything is already installed in the project.

## Architecture Patterns

### Recommended Module Structure

The bot adapter bridges the gap between Socket.IO (runtime-specific) and the domain logic in `packages/bot-harness/`. Per CLAUDE.md layer boundaries, Socket.IO client code must NOT go in `packages/`. The recommended structure:

```
bin/
  play-bot.ts              # CLI entry point (new)
packages/bot-harness/
  live-bot-strategy.ts     # BotStrategy impl wrapping TF.js model (new, no socket dep)
  model-loader.ts          # Auto-detect + explicit model loading (new, no socket dep)
  tick-budget.ts           # Budget tracking + fallback logic (new, no socket dep)
apps/server/src/
  server.ts                # Add bot:add event handler (modify)
packages/rts-engine/
  socket-contract.ts       # Add bot:add event to ClientToServerEvents (modify)
apps/web/src/
  lobby-screen-ui.ts       # Add Bot button (modify)
  lobby-controls-view-model.ts  # Add Bot button state (modify)
  client.ts                # Emit bot:add, render bot indicator (modify)
```

Key: `live-bot-strategy.ts`, `model-loader.ts`, and `tick-budget.ts` are runtime-agnostic and belong in `packages/bot-harness/`. The Socket.IO wiring that uses them lives in `bin/play-bot.ts`.

### Pattern 1: Bot Socket Lifecycle (bin/play-bot.ts)

**What:** The bot CLI connects via `socket.io-client`, follows the same protocol as the web client, and replaces human UI decisions with neural network inference.

**When to use:** This is the primary pattern for the entire phase.

**Socket flow (matching web client's client.ts):**

```typescript
// 1. Connect with sessionId auth (line 572-576 of apps/web/src/client.ts)
const socket = io(serverUrl, {
  auth: { sessionId: botSessionId },
  transports: ['websocket'],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
});

// 2. On connect -> join room
socket.on('connect', () => {
  socket.emit('room:join', { roomId, slotId: targetSlotId });
});

// 3. On room:joined -> claim slot + set ready
socket.on('room:joined', (payload: RoomJoinedPayload) => {
  // Store tickMs, templates, state, teamId
  socket.emit('room:claim-slot', { slotId: targetSlotId });
});

socket.on('room:slot-claimed', (payload: RoomSlotClaimedPayload) => {
  socket.emit('room:set-ready', { ready: true });
});

// 4. On state -> tick-by-tick inference
socket.on('state', (payload: RoomStatePayload) => {
  // Only act during active match
  if (roomStatus !== 'active') return;
  // Observe -> Infer -> Act pipeline within tick budget
  const action = inferAction(payload);
  if (action) {
    socket.emit('build:queue', action);
  }
});

// 5. On room:match-finished -> optionally disconnect or wait
socket.on('room:match-finished', (payload: MatchFinishedPayload) => {
  if (singleMatch) socket.disconnect();
  // else: wait for restart
});
```

### Pattern 2: Observe-Infer-Act Pipeline

**What:** On each `state` event, the bot runs ObservationEncoder -> tf.model.predict() -> ActionDecoder.

**Critical detail:** ObservationEncoder takes an `RtsRoom` instance, but the bot receives `RoomStatePayload` over the wire. The bot must reconstruct observation data from the payload without needing an `RtsRoom`. Two options:

- **Option A (recommended):** Create a lightweight adapter in `packages/bot-harness/` that extracts observation planes/scalars directly from `RoomStatePayload` (grid bytes, team payloads) without requiring an `RtsRoom` instance. This avoids the heavy dependency of reconstructing a full `RtsRoom` from a wire payload.
- **Option B:** Use `RtsRoom.fromState()` to reconstruct the room from the payload, then use the existing `ObservationEncoder`. This is heavier but reuses existing code exactly.

State accumulated decision from CONTEXT.md Phase 20: "PPO network accepts channels-last [H,W,C] input; callers transpose from ObservationEncoder channels-first [C,H,W]." The bot adapter must handle this transpose.

```typescript
// Observe
const planes = encodePlanesFromPayload(statePayload, teamId); // [C,H,W]
const scalars = encodeScalarsFromPayload(statePayload, teamId);

// Transpose C,H,W -> H,W,C for model input
const planesTensor = tf
  .tensor3d(planes, [C, H, W])
  .transpose([1, 2, 0])
  .expandDims(0);
const scalarsTensor = tf.tensor2d(scalars, [1, scalars.length]);

// Infer
const [logits, value] = model.predict([planesTensor, scalarsTensor]);

// Mask invalid actions and sample
const actionMask = computeActionMaskFromPayload(statePayload, teamId);
const maskedLogits = applyActionMask(logits, actionMask);
const actionIndex = tf.multinomial(maskedLogits, 1).dataSync()[0];

// Act
const buildPayload = actionDecoder.decode(actionIndex);
if (buildPayload) {
  socket.emit('build:queue', buildPayload);
}

// Dispose tensors
planesTensor.dispose();
scalarsTensor.dispose();
logits.dispose();
value.dispose();
```

### Pattern 3: "Add Bot" Server Event

**What:** A new `bot:add` client-to-server event that only the host can emit in lobby status. The server creates a virtual "bot slot reservation" so the bot process can join and claim that slot.

**Recommended approach:** The simplest pattern is for the server to emit a `room:bot-slot` event back to the host with a `{ roomId, slotId, botSessionId }` payload. The host's UI then shows "Bot joining..." until the bot's socket connects and claims the slot.

However, since D-02 says the bot connects as a separate process, the server-side "Add Bot" logic is simply:

1. Host emits `bot:add` with `{ slotId }`.
2. Server validates: room is in lobby status, host is the sender, slot exists and has capacity.
3. Server returns the `roomId` and `slotId` that the bot should target (or an error).
4. The human player's client UI shows the "Bot invited" state.
5. The bot process (already running or launched externally) connects with the target room/slot info.

The bot process itself knows which room to join via CLI flags (`--room <id>` or `--room-code <code>`).

### Pattern 4: Tick Budget Management

**What:** Tracks inference time per tick and applies fallback when budget is exceeded.

```typescript
interface TickBudgetConfig {
  budgetMs: number; // e.g., 80ms for 100ms tick rate (80% utilization)
  fallback: 'noop' | 'cached' | 'deadline';
}

interface TickMetrics {
  inferenceMs: number;
  budgetUtilization: number; // inferenceMs / budgetMs
  fallbackTriggered: boolean;
  fallbackReason?: string;
}
```

Default tick budget: 80ms (80% of the 100ms server tick). This leaves 20ms headroom for network + game simulation.

### Anti-Patterns to Avoid

- **Importing socket.io-client in packages/bot-harness/:** Violates layer boundaries. Socket.IO is runtime-specific and belongs in `bin/` or `apps/`.
- **Re-declaring socket event types:** Use imports from `socket-contract.ts` exclusively.
- **Blocking the event loop during inference:** TF.js `predict()` is synchronous in the pure JS backend. For `deadline` fallback, use `setTimeout(0)` to yield the event loop between observation encoding and inference.
- **Creating `RtsRoom` on the client side:** The bot is a Socket.IO client. It receives `RoomStatePayload`, not `RoomState`. Do not try to reconstruct a full `RtsRoom` from wire data -- the bot does not need simulation, only observation encoding and action decoding.
- **Leaking TF.js tensors:** Every `predict()` call creates output tensors. Must dispose them after extracting data. Use `tf.tidy()` or explicit dispose.

## Don't Hand-Roll

| Problem                        | Don't Build                 | Use Instead                                              | Why                                               |
| ------------------------------ | --------------------------- | -------------------------------------------------------- | ------------------------------------------------- |
| Socket.IO connection with auth | Custom WebSocket            | `socket.io-client` with `auth: { sessionId }`            | Reconnect, auth, event typing already handled     |
| Model loading from directory   | Manual file parsing         | `loadModelFromDir()` from `tfjs-file-io.ts`              | Already handles model.json + weights.bin format   |
| CLI argument parsing           | Custom argv handling        | `node:util parseArgs`                                    | Project precedent from Phase 18/20                |
| Action space computation       | Manual template enumeration | `ActionDecoder` from `packages/bot-harness/`             | Handles no-op, template sorting, position mapping |
| Reconnect with state sync      | Custom reconnect protocol   | Socket.IO auto-reconnect + server's `room:joined` resync | Server already handles snapshot + input replay    |

**Key insight:** The bot adapter is mostly glue code. The heavy lifting -- observation encoding, action decoding, model inference, socket protocol -- is all done by existing libraries. The new code is the lifecycle orchestration and tick budget management.

## Common Pitfalls

### Pitfall 1: TF.js Tensor Leaks

**What goes wrong:** Calling `model.predict()` in a loop without disposing output tensors causes unbounded memory growth. Matches can run 2000+ ticks.
**Why it happens:** TF.js tensors are NOT garbage collected. They must be explicitly disposed or wrapped in `tf.tidy()`.
**How to avoid:** Wrap the entire observe-infer-act cycle in `tf.tidy()`, or explicitly dispose every tensor after extracting `Float32Array` data via `dataSync()`.
**Warning signs:** `tf.memory().numTensors` increasing monotonically during a match.

### Pitfall 2: Channels-First vs Channels-Last Mismatch

**What goes wrong:** The ObservationEncoder produces [C,H,W] (channels-first), but the PPO model expects [H,W,C] (channels-last). Feeding the wrong format produces garbage predictions.
**Why it happens:** Phase 20 decision: "PPO network accepts channels-last [H,W,C] input; callers transpose from ObservationEncoder channels-first [C,H,W]."
**How to avoid:** Always transpose planes from [C,H,W] to [H,W,C] before creating the input tensor. Use `tf.tensor3d(planes, [C,H,W]).transpose([1,2,0])`.
**Warning signs:** Model predictions are uniform/random despite trained weights.

### Pitfall 3: ObservationEncoder Requires RtsRoom, Not Payload

**What goes wrong:** The existing `ObservationEncoder.encode()` takes an `RtsRoom` instance. The bot receives `RoomStatePayload` over the socket. Attempting to use ObservationEncoder directly requires reconstructing an RtsRoom, which is heavy and unnecessary.
**Why it happens:** ObservationEncoder was designed for headless match runner (Phase 18), which has direct room access.
**How to avoid:** Either (a) create a new `encodeFromPayload()` function that extracts the same features from `RoomStatePayload` directly, or (b) accept the cost of using the existing encoder with a lightweight RtsRoom reconstruction. Option (a) is recommended as it avoids the dependency and is more efficient.
**Warning signs:** Attempting to call `room.createStatePayload()` on the client side (there is no RtsRoom on the client side).

### Pitfall 4: Action Masking Without Room Access

**What goes wrong:** `ActionDecoder.computeActionMask()` requires an `RtsRoom` instance to call `room.previewBuildPlacement()`. The bot client does not have a room instance.
**Why it happens:** Action masking was designed for headless training (Phase 19).
**How to avoid:** For live play, use a simplified action mask based on the `RoomStatePayload`: check resources, check build zone from structure positions, filter impossible templates by cost. Accept that some actions may be rejected by the server (the server validates anyway). Alternatively, implement a payload-based action mask that approximates the room-based one.
**Warning signs:** Bot submitting many rejected builds. Monitor `build:queue-rejected` events.

### Pitfall 5: State Event Timing

**What goes wrong:** The server emits `state` on every tick during active matches. If the bot's inference takes longer than the tick interval, state events queue up and the bot falls behind.
**Why it happens:** Socket.IO is event-driven. If the bot blocks on inference during one `state` event, the next tick's `state` event queues in the Node.js event loop.
**How to avoid:** Track whether inference is in progress. If a new `state` event arrives while still processing the previous one, skip the old inference (it's stale anyway). The `deadline` fallback strategy handles this explicitly.
**Warning signs:** Bot actions lagging behind the current game tick.

### Pitfall 6: Bot Session Identity and Slot Claiming

**What goes wrong:** The bot connects with a sessionId, but the "Add Bot" flow requires the bot to know which room and slot to join.
**Why it happens:** The bot is a separate process; it needs to be told where to go.
**How to avoid:** Pass `--room <id>` and `--slot <slotId>` as CLI arguments. The host clicks "Add Bot" in the UI, then starts the bot process with the room info. Alternatively, the bot can join the default room and auto-claim the first available slot.
**Warning signs:** Bot joining wrong room or failing to claim a slot.

### Pitfall 7: Model Warm-Up Latency

**What goes wrong:** First TF.js `predict()` call is significantly slower than subsequent calls due to JIT compilation and memory allocation.
**Why it happens:** TF.js pure JS backend initializes internal state lazily on first operation.
**How to avoid:** Run a dummy inference with zero-filled tensors of the correct shape immediately after model loading, before the match starts. This "warms up" the model during the lobby/countdown phase.
**Warning signs:** First few ticks of the match have inference times 5-10x higher than steady state.

## Code Examples

### Socket.IO Client Connection (from apps/web/src/client.ts lines 571-576)

```typescript
// Source: apps/web/src/client.ts
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
  serverUrl,
  {
    auth: { sessionId: botSessionId },
    transports: ['websocket'],
  },
);
```

### Model Loading (from packages/bot-harness/training/tfjs-file-io.ts)

```typescript
// Source: packages/bot-harness/training/tfjs-file-io.ts
import { loadModelFromDir } from './training/tfjs-file-io.js';

const model = await loadModelFromDir('/path/to/final-model/');
// model is a tf.LayersModel with inputs ['planes', 'scalars']
// and outputs [policy_logits, value]
```

### Run Directory Structure (from training-logger.ts)

```
runs/
  run-YYYYMMDD-HHMMSS/
    config.json
    training-log.ndjson
    checkpoints/
      checkpoint-50/
        model.json
        weights.bin
      checkpoint-100/
        model.json
        weights.bin
    final-model/          <-- D-04 auto-detect target
      model.json
      weights.bin
```

### Integration Test Client Pattern (from tests/integration/server/test-support.ts)

```typescript
// Source: tests/integration/server/test-support.ts line 244
export function createClient(
  port: number,
  options: TestClientOptions = {},
): Socket {
  const socket = io(`http://localhost:${port}`, {
    autoConnect: false,
    transports: ['websocket'],
    auth: options.sessionId ? { sessionId: options.sessionId } : undefined,
  });
  if (shouldConnect) socket.connect();
  return socket;
}
```

### ActionDecoder.decode() (from packages/bot-harness/action-decoder.ts)

```typescript
// Source: packages/bot-harness/action-decoder.ts line 159
// Returns null for no-op (index 0), BuildQueuePayload for build actions
const buildPayload = actionDecoder.decode(actionIndex);
if (buildPayload) {
  socket.emit('build:queue', buildPayload);
}
```

### Server Room Join + Slot Claim Flow (from apps/server/src/server.ts)

```typescript
// Source: server.ts lines 2416-2434
// Client emits room:join with { roomId, slotId }
// Server calls joinRoom() -> room.lobby.join() -> addPlayer()
// If slotId provided, auto-calls tryClaimSlot()

// Source: server.ts lines 2454-2511
// Client emits room:set-ready with { ready: true }
// Server validates lobby status, calls room.lobby.setReady()
// When all slots ready and host starts, countdown begins
```

### Server Auth Handshake (from apps/server/src/server.ts lines 2301-2311)

```typescript
// Source: server.ts lines 2301-2311
const authPayload =
  socket.handshake.auth && typeof socket.handshake.auth === 'object'
    ? (socket.handshake.auth as { sessionId?: unknown })
    : {};
const { session } = sessionCoordinator.attachSocket({
  requestedSessionId: authPayload.sessionId,
  fallbackSessionId,
  fallbackName,
  socketId: socket.id,
});
```

## State of the Art

| Old Approach                     | Current Approach            | When Changed | Impact                                                  |
| -------------------------------- | --------------------------- | ------------ | ------------------------------------------------------- |
| `file://` handler for model load | Custom `loadModelFromDir()` | Phase 20     | Pure JS backend lacks `file://` -- must use custom IO   |
| `tfjs-node` native addon         | `@tensorflow/tfjs` pure JS  | Phase 20     | Alpine Linux musl blocks native addon; pure JS CPU only |
| RtsRoom direct access for bots   | Socket-based bot client     | Phase 23     | Headless was direct; live play requires socket protocol |

**Deprecated/outdated:**

- `RtsEngine.addPlayerToRoom()` static method: Prefer `RtsRoom.addPlayer()` instance method (Phase 2/3 migration complete).

## Open Questions

1. **Observation Encoding from Payload**
   - What we know: `ObservationEncoder.encode()` requires an `RtsRoom` instance. The bot receives `RoomStatePayload`.
   - What's unclear: Whether to create a new payload-based encoder or reconstruct an `RtsRoom` from the payload.
   - Recommendation: Create a lightweight `encodeFromPayload()` adapter. The key data needed (grid cells, structure positions, resources, income) is all present in `RoomStatePayload`. Avoid the overhead and complexity of reconstructing `RtsRoom.fromState()`.

2. **Action Masking in Live Play**
   - What we know: `ActionDecoder.computeActionMask()` requires `RtsRoom.previewBuildPlacement()`.
   - What's unclear: Whether to implement a simplified payload-based mask or accept server rejections.
   - Recommendation: Implement a basic cost/territory check from the payload. The server validates all actions anyway. A few rejected builds per match are acceptable for a bot. Log rejected builds in metrics for debugging.

3. **"Add Bot" Trigger Mechanism**
   - What we know: Host clicks "Add Bot" in lobby UI. Bot is a separate process.
   - What's unclear: How the bot process learns which room to join.
   - Recommendation: CLI flags `--room <id>` and `--slot <slotId>`. The simplest UX: host creates room, sees room code in UI, runs `npx tsx bin/play-bot.ts --room-code ABCD --slot team-2`. The `bot:add` server event is optional -- it could simply be that the bot joins like any player and the host recognizes it by the "Bot (PPO-v3)" name. However, D-01 specifies an explicit "Add Bot" action, so the server event approach is needed.

## Validation Architecture

### Test Framework

| Property           | Value                                       |
| ------------------ | ------------------------------------------- |
| Framework          | vitest 4.0.18                               |
| Config file        | `vitest.config.ts`                          |
| Quick run command  | `npx vitest run --dir packages/bot-harness` |
| Full suite command | `npm test`                                  |

### Phase Requirements -> Test Map

| Req ID     | Behavior                                                       | Test Type   | Automated Command                                                | File Exists? |
| ---------- | -------------------------------------------------------------- | ----------- | ---------------------------------------------------------------- | ------------ |
| DEPLOY-01a | Bot adapter connects via Socket.IO and joins lobby             | integration | `npx vitest run tests/integration/server/bot-adapter.test.ts -x` | Wave 0       |
| DEPLOY-01b | Bot completes full match lifecycle (join->ready->play->finish) | integration | `npx vitest run tests/integration/server/bot-adapter.test.ts -x` | Wave 0       |
| DEPLOY-01c | Bot decision pipeline completes within tick budget             | unit        | `npx vitest run packages/bot-harness/tick-budget.test.ts -x`     | Wave 0       |
| DEPLOY-01d | Model loading with auto-detect fallback                        | unit        | `npx vitest run packages/bot-harness/model-loader.test.ts -x`    | Wave 0       |
| DEPLOY-01e | Tick budget fallback strategies (noop, cached, deadline)       | unit        | `npx vitest run packages/bot-harness/tick-budget.test.ts -x`     | Wave 0       |
| DEPLOY-01f | Server bot:add event validation                                | integration | `npx vitest run tests/integration/server/bot-adapter.test.ts -x` | Wave 0       |

### Sampling Rate

- **Per task commit:** `npm run test:fast`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `tests/integration/server/bot-adapter.test.ts` -- covers DEPLOY-01a, DEPLOY-01b, DEPLOY-01f
- [ ] `packages/bot-harness/tick-budget.test.ts` -- covers DEPLOY-01c, DEPLOY-01e
- [ ] `packages/bot-harness/model-loader.test.ts` -- covers DEPLOY-01d
- [ ] `packages/bot-harness/live-bot-strategy.test.ts` -- covers observe-infer-act pipeline

## Environment Availability

| Dependency          | Required By     | Available | Version     | Fallback                              |
| ------------------- | --------------- | --------- | ----------- | ------------------------------------- |
| Node.js             | All             | Yes       | 24.13.0     | --                                    |
| tsx                 | CLI execution   | Yes       | 4.21.0      | --                                    |
| socket.io-client    | Bot connection  | Yes       | 4.8.3       | --                                    |
| @tensorflow/tfjs    | Model inference | Yes       | 4.23.0-rc.0 | --                                    |
| vitest              | Testing         | Yes       | 4.0.18      | --                                    |
| Trained model files | Bot inference   | Unknown   | --          | Use random fallback if no model found |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:**

- Trained model files: If no `runs/` directory or `final-model/` exists, the bot adapter should fall back to `RandomBot` strategy and log a warning. This allows testing the socket adapter without a trained model.

## Sources

### Primary (HIGH confidence)

- `packages/bot-harness/bot-strategy.ts` -- BotStrategy interface, BotView, BotAction types
- `packages/bot-harness/observation-encoder.ts` -- ObservationEncoder with RtsRoom dependency
- `packages/bot-harness/action-decoder.ts` -- ActionDecoder with RtsRoom dependency for masking
- `packages/bot-harness/training/ppo-network.ts` -- PPOModelConfig, model architecture (planes + scalars inputs)
- `packages/bot-harness/training/tfjs-file-io.ts` -- loadModelFromDir, saveModelToDir
- `packages/bot-harness/training/training-config.ts` -- parseTrainingArgs pattern, NetworkConfig
- `packages/bot-harness/bot-environment.ts` -- BotEnvironment showing observe/act pipeline
- `packages/rts-engine/socket-contract.ts` -- All socket event names and payload shapes
- `packages/rts-engine/lobby.ts` -- LobbyRoom API for slot management
- `apps/server/src/server.ts` -- Full server lifecycle, auth, join, tick loop
- `apps/server/src/lobby-session.ts` -- Session coordinator, reconnect holds
- `apps/web/src/client.ts` -- Web client connection pattern, socket lifecycle
- `apps/web/src/lobby-controls-view-model.ts` -- Lobby button state derivation
- `tests/integration/server/fixtures.ts` -- Integration test harness pattern
- `tests/integration/server/test-support.ts` -- Test client creation pattern

### Secondary (MEDIUM confidence)

- `.planning/phases/23-playable-in-game-bot/23-CONTEXT.md` -- All locked decisions
- `.planning/STATE.md` -- Accumulated project decisions from prior phases

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH -- all dependencies already installed and verified in package.json
- Architecture: HIGH -- codebase fully explored; patterns derived directly from existing code
- Pitfalls: HIGH -- identified from actual code analysis (tensor lifecycle, encoder dependencies, channel ordering)

**Research date:** 2026-04-01
**Valid until:** 2026-05-01 (stable; no fast-moving external dependencies)
