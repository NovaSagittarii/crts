# Phase 23: Playable In-Game Bot - Context

**Gathered:** 2026-04-01
**Status:** Ready for planning

<domain>
## Phase Boundary

A trained PPO model joins a live game server as a virtual player via Socket.IO, making decisions within the tick budget. This phase delivers the Socket.IO bot adapter, lobby integration ("Add Bot" host action), model loading, tick budget management with configurable fallback strategies, and lifecycle handling. It does NOT include training new models (Phase 20), balance analysis (Phase 21-22), or any UI beyond the bot indicator and "Add Bot" action.

</domain>

<decisions>
## Implementation Decisions

### Bot Identity & Lobby
- **D-01:** Host can fill an empty player slot with a bot via an explicit "Add Bot" action in the lobby. Host controls when/if a bot joins — not auto-join or matchmaking.
- **D-02:** Bot connects as a separate process via Socket.IO — identical to a human client from the server's perspective. Tests the real socket protocol end-to-end.
- **D-03:** Bot is visually distinguishable: shown with a bot indicator and a name like "Bot (PPO-v3)" in both lobby and match UI. Transparent to the human player.

### Model Loading & Selection
- **D-04:** `--model <path>` CLI flag for explicit model path, with auto-detect fallback to the most recent `final-model/` directory under `runs/`. Explicit flag takes precedence.
- **D-05:** No hot-swap between matches. Restart the bot process with a different `--model` flag to change models. Simple lifecycle, matches are short enough.

### Tick Budget & Fallback
- **D-06:** Three configurable fallback strategies for when inference exceeds the per-tick budget:
  - (a) **No-op (default):** Submit no action for that tick. Simple, safe, no stale data risk.
  - (b) **Cached action:** Use previous tick's action. Keeps bot active but may execute stale/invalid action.
  - (c) **Pre-compute + deadline:** Start inference immediately on tick state arrival, hard deadline cancels if over budget.
  Configurable via CLI flag. No-op as default.
- **D-07:** Tick budget metrics logged: inference time per tick, budget utilization %, and fallback triggers. Configurable verbosity. Essential for verifying success criterion #3 (headroom).

### Lifecycle & Error Handling
- **D-08:** Auto-reconnect with exponential backoff on disconnect. On successful reconnect, resume play using the server's existing reconnect/resync flow (snapshot + input replay from v0.0.3).
- **D-09:** Configurable post-match behavior: `--single-match` flag to disconnect after one match. Default: stay connected and wait for the next match. Convenient for repeated testing sessions.
- **D-10:** Bot handles full match lifecycle via socket events: lobby join → ready → countdown → active (tick-by-tick decisions) → match finished. All transitions driven by socket-contract.ts event names.

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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 18 Context (Bot Infrastructure)
- `.planning/phases/18-headless-match-runner/18-CONTEXT.md` — BotStrategy interface (D-01/D-02), bot-harness package, headless match runner

### Phase 19 Context (Observation/Action Pipeline)
- `.planning/phases/19-observation-action-and-reward-interface/19-CONTEXT.md` — ObservationEncoder, ActionDecoder, BotEnvironment, Float32Array format (D-04)

### Phase 20 Context (Trained Model Format)
- `.planning/phases/20-ppo-training-with-self-play/20-CONTEXT.md` — TF.js SavedModel checkpoints (D-04), tfjs-node backend (D-13), run directory structure (D-10)

### Socket Contract (Canonical Event Names)
- `packages/rts-engine/socket-contract.ts` — All socket event names and payload shapes. Bot adapter MUST use these.

### Server (Socket Lifecycle)
- `apps/server/src/server.ts` — Socket.IO wiring, room lifecycle, reconnect handling

### Reconnect Infrastructure (v0.0.3)
- `packages/rts-engine/input-event-log.ts` — Input replay for reconnect
- `packages/rts-engine/rts.ts` — `RtsRoom.fromState()`, state snapshot for resync

### Bot Harness (Phases 18-20 deliver)
- `packages/bot-harness/` — BotStrategy, ObservationEncoder, ActionDecoder, BotEnvironment

### Requirements
- `.planning/REQUIREMENTS.md` — DEPLOY-01 (Socket.IO bot adapter)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phases 18-20, not yet built)
- `ObservationEncoder.encode(state, teamId)` → `Float32Array` — bot adapter wraps into `tf.tensor` for inference
- `ActionDecoder.decode(actionIndex)` → build queue payload — bot adapter submits via socket
- `BotStrategy` interface — bot adapter implements this, backed by TF.js model inference
- TF.js SavedModel loading via `tf.loadLayersModel('file://<path>')` — standard tfjs-node API

### Established Patterns
- `packages/bot-harness` is the home package for all v0.0.4 code
- Socket.IO client connection pattern from `apps/web/src/client.ts` — reference for bot's socket lifecycle
- `socket-contract.ts` event names used consistently across server and client
- Reconnect via snapshot + input replay already implemented in v0.0.3

### Integration Points
- Bot process connects to server via `socket.io-client` (same as web client)
- Bot emits/listens to same socket events as human client (`room:join`, `build:queue`, `tick`, etc.)
- Server needs: (a) "Add Bot" event from host, (b) logic to associate bot socket with the room slot
- Web client needs: (a) "Add Bot" button in lobby, (b) bot indicator in player list/match UI
- Bot's decision pipeline: receive tick state → ObservationEncoder → tf.model.predict() → ActionDecoder → emit build:queue

</code_context>

<specifics>
## Specific Ideas

- The bot adapter is essentially a Socket.IO client that replaces the human's UI with a neural network inference pipeline. Same protocol, different decision source.
- Success criterion #1 says the bot should appear "identical to a human player from the opponent's perspective" at the protocol level — the bot indicator is a UI convenience, not a protocol difference.
- The "Add Bot" action is the only new server/UI capability in this phase. Everything else is a new client process using existing protocol.
- Tick budget metrics are critical for validating that tfjs-node inference is fast enough for real-time play. If it's too slow, the configurable fallback strategies provide graceful degradation.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 23-playable-in-game-bot*
*Context gathered: 2026-04-01*
