# Phase 23: Playable In-Game Bot - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-01
**Phase:** 23-playable-in-game-bot
**Areas discussed:** Bot identity & lobby, Model loading & selection, Tick budget & fallback, Lifecycle & error handling

---

## Bot Identity & Lobby

### Q1: How should a human player initiate a match against the bot?

| Option                                  | Description                                                                          | Selected |
| --------------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| Bot auto-joins open rooms (Recommended) | Bot process auto-joins any room waiting for a second player. Minimal server changes. |          |
| Explicit 'Play vs Bot' button           | New UI option to create a bot match. Server spawns/assigns the bot.                  |          |
| Server-side matchmaking                 | Server detects room waited too long, assigns bot automatically.                      |          |
| **Host fills slot**                     | **User specified: host can fill a player slot with a bot**                           | ✓        |

**User's choice:** Host can fill a player slot with a bot
**Notes:** Explicit host action, not auto-join or matchmaking.

### Q2: How should the bot connect to the server?

| Option                         | Description                                                                                                | Selected |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- | -------- |
| Socket.IO client (Recommended) | Separate process via Socket.IO — identical to human client from server's perspective. Tests real protocol. | ✓        |
| Server-side instantiation      | Server creates bot in-process. No Socket.IO. Faster but skips socket layer.                                |          |
| Both modes                     | Socket.IO for production, in-process for dev/testing. Configurable.                                        |          |

**User's choice:** Socket.IO client (Recommended)
**Notes:** None additional.

### Q3: Should the bot be visually distinguishable from a human player?

| Option                            | Description                                                              | Selected |
| --------------------------------- | ------------------------------------------------------------------------ | -------- |
| Bot indicator shown (Recommended) | Bot has a name like 'Bot (PPO-v3)' and/or visual indicator. Transparent. | ✓        |
| Indistinguishable                 | Appears identical to a human. No special label.                          |          |
| You decide                        | Claude picks.                                                            |          |

**User's choice:** Bot indicator shown (Recommended)
**Notes:** None additional.

---

## Model Loading & Selection

### Q4: How should the bot adapter select which trained model to use?

| Option                                | Description                                                           | Selected |
| ------------------------------------- | --------------------------------------------------------------------- | -------- |
| CLI flag for model path (Recommended) | `--model <path>` pointing to TF.js SavedModel directory. Explicit.    |          |
| Auto-detect latest                    | Scan `runs/` for most recent `final-model/`. Convenient but implicit. |          |
| Both: flag with auto fallback         | `--model <path>` takes precedence, auto-detect if omitted.            | ✓        |

**User's choice:** Both: flag with auto fallback
**Notes:** None additional.

### Q5: Should the bot support hot-swapping models between matches?

| Option                            | Description                                                     | Selected |
| --------------------------------- | --------------------------------------------------------------- | -------- |
| No, restart to swap (Recommended) | Restart bot process with different `--model`. Simple lifecycle. | ✓        |
| Yes, hot-swap via signal/command  | Watch for signal or command to load new model between matches.  |          |
| You decide                        | Claude picks.                                                   |          |

**User's choice:** No, restart to swap (Recommended)
**Notes:** None additional.

---

## Tick Budget & Fallback

### Q6: What should happen if inference exceeds the per-tick budget?

| Option                       | Description                                                                | Selected |
| ---------------------------- | -------------------------------------------------------------------------- | -------- |
| No-op fallback (Recommended) | Submit no action. Bot skips a beat. Simple, safe.                          |          |
| Cached action                | Use previous tick's action. Keeps bot active but may execute stale action. |          |
| Pre-compute + deadline       | Start inference immediately, hard deadline cancels if over budget.         |          |
| **All configurable**         | **User specified: all three strategies, configurable, no-op as default**   | ✓        |

**User's choice:** All three strategies configurable with no-op as default
**Notes:** Flexibility to experiment with latency tolerance during testing.

### Q7: Should the bot log tick budget metrics?

| Option                            | Description                                                                          | Selected |
| --------------------------------- | ------------------------------------------------------------------------------------ | -------- |
| Yes, to stdout/file (Recommended) | Log inference time, budget utilization %, fallback triggers. Configurable verbosity. | ✓        |
| Metrics only on demand            | Behind `--verbose`/`--metrics` flag. Silent by default.                              |          |
| You decide                        | Claude picks.                                                                        |          |

**User's choice:** Yes, to stdout/file (Recommended)
**Notes:** None additional.

---

## Lifecycle & Error Handling

### Q8: How should the bot handle disconnection during a match?

| Option                                    | Description                                                             | Selected |
| ----------------------------------------- | ----------------------------------------------------------------------- | -------- |
| Auto-reconnect with backoff (Recommended) | Exponential backoff, resume via v0.0.3 reconnect/resync flow.           | ✓        |
| Crash and restart                         | Process exits, external supervisor restarts. Simpler but loses context. |          |
| You decide                                | Claude picks.                                                           |          |

**User's choice:** Auto-reconnect with backoff (Recommended)
**Notes:** None additional.

### Q9: After match finishes, should bot stay connected or disconnect?

| Option                      | Description                                                     | Selected |
| --------------------------- | --------------------------------------------------------------- | -------- |
| Stay and wait (Recommended) | Remain connected, ready for next match. Convenient for testing. |          |
| Disconnect after match      | Clean resource lifecycle but more friction.                     |          |
| Configurable                | `--single-match` to disconnect. Default: stay connected.        | ✓        |

**User's choice:** Configurable — `--single-match` flag, default stay connected
**Notes:** None additional.

---

## Claude's Discretion

- CLI flag names and defaults
- Socket.IO connection config
- "Add Bot" server/client implementation approach
- Model warm-up strategy
- Tick budget threshold derivation
- Auto-detect model scanning logic
- Internal module structure

## Deferred Ideas

None — discussion stayed within phase scope
