# Stack Research

**Domain:** v0.0.3 Deterministic Lockstep Protocol migration
**Researched:** 2026-03-29
**Confidence:** HIGH for all decisions — verified against current npm registry, Socket.IO official docs, and codebase inspection

## Scope

This document replaces the v0.0.2 STACK.md. It focuses exclusively on **new** capabilities needed for the lockstep migration. The base stack (TypeScript 5.4.5, Socket.IO 4.8.3, Vite 8.0.3, Vitest 4.1.2, Express 4.19.2) is unchanged and not re-examined here.

---

## Recommended Stack

### Core Technologies (NEW for v0.0.3)

| Technology       | Version | Purpose                                     | Why Recommended                                                                                                                                                                                                                                                                    |
| ---------------- | ------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bufferutil`     | `4.1.0` | Native WebSocket frame masking/unmasking    | Grid snapshots are `ArrayBuffer` (bit-packed). Each tick-boundary snapshot and reconnect payload traverses at least one full `Uint8Array`; native buffer ops measurably reduce CPU overhead on the ws layer. Optional install — server gracefully falls back to pure-JS if absent. |
| `utf-8-validate` | `6.0.6` | Native UTF-8 validation of WebSocket frames | Pair with `bufferutil` to complete native ws performance. Both are `--save-optional` to keep the base install clean; Socket.IO docs recommend installing together.                                                                                                                 |

Both packages are maintained by the Socket.IO team (bufferutil last updated December 2025; utf-8-validate last updated December 2024 — verified via npm registry). They are the official recommendation in the Socket.IO performance tuning guide.

### Supporting Libraries (NEW for v0.0.3)

| Library      | Version | Purpose                                        | When to Use                                                                                                                                                                                                                                                                                          |
| ------------ | ------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fast-check` | `4.6.0` | Property-based testing for lockstep invariants | Required for snapshot round-trip and input-log serialization tests. The determinism contract demands: "same input list + same snapshot produces same final hash." Property tests catch floating-point and ordering regressions that unit tests miss. Vitest 4.x integrates natively via `fc.test()`. |

`fast-check` was already recommended in v0.0.2 STACK.md but not installed. v0.0.3 makes it required, not optional — lockstep correctness is only verifiable with invariant testing across random input sequences.

### Development Tools (unchanged, no new additions)

| Tool                       | Purpose                 | Notes                                                                      |
| -------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| Vitest 4.1.2               | All existing test modes | No change needed. `fc.test()` from fast-check plugs in directly.           |
| ESLint + typescript-eslint | Payload type safety     | Strict mode catches any `any` leakage in new input-log serialization code. |

---

## What NOT to Add

| Avoid                               | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Use Instead                                                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `socket.io-msgpack-parser`          | Last published November 2022 (3 years stale); notepack.io dependency has no active maintainer. The protocol requires binary data to be sent as `ArrayBuffer`/`Buffer` natively via Socket.IO's built-in binary framing. Grid snapshots are already `ArrayBuffer` via `Grid.toPacked()` — Socket.IO sends these in a single WebSocket frame automatically. Adding an unmaintained parser solely for frame-packing is premature optimization with real maintenance risk. | Native Socket.IO binary events with `ArrayBuffer` payloads (already used for grid state via `toPacked`).         |
| `@msgpack/msgpack`                  | The lockstep protocol sends inputs (small JSON objects), not large binary blobs. Input payloads are `BuildQueuePayload` / `DestroyQueuePayload` — already typed, small, and handled by existing socket contract. Reconnect snapshots use `Grid.toPacked()` for grid (binary) and JSON for team state. Adding a serialization library for what TypeScript interfaces already model cleanly is over-engineering.                                                         | Existing typed JSON socket contract for inputs; `ArrayBuffer` via `toPacked()` for grid state.                   |
| `flatbuffers` / `protobuf`          | Schema-first binary protocols add codegen tooling, breaking changes across schema versions, and build pipeline complexity. The project constraint is TypeScript-only prototype. The engine already has a well-defined typed contract in `socket-contract.ts`.                                                                                                                                                                                                          | `socket-contract.ts` typed interfaces remain the canonical wire contract.                                        |
| `@geckos.io/snapshot-interpolation` | Client-side interpolation library for position-based games. This project uses deterministic lockstep with grid cells, not continuous position values. Reconnect recovery uses snapshot + input replay, not interpolation.                                                                                                                                                                                                                                              | Custom snapshot serialization: `RoomStatePayload` (JSON) + `Grid.toPacked()` (binary ArrayBuffer).               |
| `netplayjs`                         | Rollback-first browser game library. This project uses server-authoritative lockstep with a turn buffer already implemented in `server.ts`. The engine is already deterministic with a complete `LockstepRuntimeState`. Adding a third-party lockstep library over an existing one causes a rewrite, not a migration.                                                                                                                                                  | Extend the existing `LockstepRuntimeState` and `BufferedLockstepCommand` in `server.ts`.                         |
| `zod`                               | v0.0.2 STACK.md marked this optional. At current payload surface area, manual guards in `server.ts` are sufficient and already in place. Lockstep input payloads reuse existing `BuildQueuePayload`/`DestroyQueuePayload` validation.                                                                                                                                                                                                                                  | Existing runtime payload guards at socket boundary. Revisit if payload variants multiply past current milestone. |

---

## Integration Points

### Where New Code Lives

| Layer                                    | File(s)                  | New Responsibility                                                                                                                                                                                                                                                                      |
| ---------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/rts-engine/`                   | New file: `input-log.ts` | Typed input-log record: maps turn number to ordered array of `BuildQueuePayload \| DestroyQueuePayload` with sequence and team metadata. Pure data structure, no I/O. Consumed by server for reconnect replay and by clients for local simulation.                                      |
| `packages/rts-engine/socket-contract.ts` | Existing file            | Add 3–4 new event types: `lockstep:input-turn` (server→clients, relays inputs for a turn), `lockstep:snapshot` (server→reconnecting client, packed state + turn index), `lockstep:input-log-replay` (server→reconnecting client, ordered input log from snapshot turn to current turn). |
| `apps/server/src/server.ts`              | Existing file            | Extend `LockstepRuntimeState` with an input log ring buffer (bounded by snapshot interval). Add snapshot generation at checkpoint intervals. Add reconnect handler that sends snapshot + log slice to rejoining player.                                                                 |
| `apps/web/src/client.ts` / new file      | Existing + new           | Add client-side tick loop: receive `lockstep:input-turn`, apply to local `RtsRoom`, step simulation. Handle `lockstep:snapshot` + `lockstep:input-log-replay` for reconnect. Hash checkpoint verification against `lockstep:checkpoint`.                                                |
| `packages/rts-engine/rts.ts`             | Existing file            | No changes expected. `RtsRoom.tick()` and `RtsEngine.tick()` are already the deterministic simulation entry point. Clients call the same method server does.                                                                                                                            |

### Binary Payload Strategy

Grid state (`Grid.toPacked()`) is already `ArrayBuffer` — Socket.IO 4.8.3 sends it as a single binary WebSocket frame natively. No parser changes needed.

Input-turn payloads are small JSON objects (1–5 queued commands per turn). JSON frames remain appropriate. Do not binary-encode inputs — the overhead is negligible and the loss of debug visibility is real.

Reconnect snapshot = `{ stateJson: RoomStatePayload, gridBuffer: ArrayBuffer, turn: number }`. Mixed binary+JSON payload in one Socket.IO event is supported and tested as of 4.8.1 (binary data bug was patched in 4.8.1).

### Input Log Ring Buffer

The server must maintain a bounded ring buffer of input logs per room for reconnect replay. Size = `snapshotIntervalTicks / turnLengthTicks` turns. At default config (snapshot every 50 ticks, turn length 1 tick), this is 50 entries — trivially small.

Data structure per entry: `{ turn: number, sequence: number, commands: SerializedCommand[] }` where `SerializedCommand` is the existing `BufferedLockstepCommand` shape without server-internal fields.

This is pure TypeScript data, no library needed.

### Client-Side Simulation

Clients need to run `RtsRoom.tick()` locally. `RtsRoom` is in `packages/rts-engine` — it is already runtime-agnostic (no Socket.IO / DOM imports). The client imports it via the `#rts-engine` alias already wired in `package.json`. No new import path or bundler config needed.

The client creates a local `RtsRoom` from the snapshot received on reconnect (or from `room:joined` on initial join), then ticks it each turn-boundary using inputs from `lockstep:input-turn`.

---

## Installation

```bash
# Native WebSocket performance (optional — server degrades gracefully without these)
npm install --save-optional bufferutil utf-8-validate

# Property-based testing — required for lockstep invariant coverage
npm install -D fast-check@^4.6.0
```

No new runtime production dependencies. `bufferutil` and `utf-8-validate` are optional native add-ons. `fast-check` is dev-only.

---

## Alternatives Considered

| Recommended                                                        | Alternative                                   | When to Use Alternative                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Socket.IO binary framing (`ArrayBuffer`) for grid snapshots | `socket.io-msgpack-parser`                    | Use msgpack only if payload analysis shows the JSON overhead of team-state fields in reconnect snapshots is a measured bottleneck AND maintainer risk is acceptable. Not recommended at prototype scale.                                                      |
| Extend existing `LockstepRuntimeState`                             | New lockstep library (netplayjs, lockstep.io) | Use a library only if building a new project from scratch without existing lockstep infrastructure. This project already has turn buffering, shadow room, checkpoint/fallback events, and FNV-1a hashing — adding a library means deleting more than it adds. |
| JSON for input-turn events                                         | Binary encoding for inputs                    | Use binary encoding for inputs only at 10+ players per room or if profiling shows serialization is on the hot path. At 2 players with 1–5 commands/turn, JSON serialization time is unmeasurable.                                                             |
| `Grid.toPacked()` for snapshot grid encoding                       | Delta encoding                                | Use delta encoding when grids are large (>500×500) and change sparsely between snapshots. At current prototype grid sizes (configurable, default order of magnitude 100s of cells), full packed snapshots are < 1 KB and delta complexity is not warranted.   |

---

## Version Compatibility

| Package                                 | Compatible With                           | Notes                                                                                                                                                                     |
| --------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bufferutil@4.1.0`                      | `ws@8.x` (used by Socket.IO 4.8.3 server) | Optional C++ add-on. Verifies with `npm ls ws` to confirm the indirect dependency. Graceful fallback if build fails (e.g., Alpine/musl environments without build tools). |
| `utf-8-validate@6.0.6`                  | `ws@8.x`                                  | Same as bufferutil. Install together.                                                                                                                                     |
| `fast-check@4.6.0`                      | Vitest 4.1.2                              | `fc.test()` helper is native to Vitest 4.x. No additional wiring needed.                                                                                                  |
| `RtsRoom` (local package)               | Node.js and browser                       | Already runtime-agnostic per AGENTS.md constraints. Confirmed: no Socket.IO / DOM imports in `packages/rts-engine`. Safe to import from `apps/web`.                       |
| Socket.IO 4.8.3 mixed binary+JSON event | All modern browsers                       | Binary data bug was patched in 4.8.1. Current 4.8.3 is safe for mixed `{ gridBuffer: ArrayBuffer, stateJson: string }` payloads.                                          |

---

## Sources

- [HIGH] Socket.IO performance tuning guide (bufferutil, utf-8-validate, binary modes): https://socket.io/docs/v4/performance-tuning/
- [HIGH] Socket.IO custom parser docs (msgpack tradeoffs, "MUST use on both sides" requirement): https://socket.io/docs/v4/custom-parser/
- [HIGH] Socket.IO 4.8.1 changelog (binary data bug patched): https://socket.io/docs/v4/changelog/4.8.1
- [HIGH] socket.io-msgpack-parser npm page (3.0.2, last published 2022 — verified stale): https://www.npmjs.com/package/socket.io-msgpack-parser
- [HIGH] fast-check docs (Vitest integration, `fc.test()`): https://fast-check.dev/
- [HIGH] bufferutil npm registry (4.1.0, December 2025): https://www.npmjs.com/package/bufferutil
- [HIGH] utf-8-validate npm registry (6.0.6): https://www.npmjs.com/package/utf-8-validate
- [HIGH] @msgpack/msgpack npm registry (3.1.3, December 2025): https://www.npmjs.com/package/@msgpack/msgpack
- [MEDIUM] Gaffer On Games — Deterministic Lockstep (reconnect via snapshot + replay pattern): https://gafferongames.com/post/deterministic_lockstep/
- [MEDIUM] Game Networking Demystified, Part III: Lockstep (input buffer and turn model): https://ruoyusun.com/2019/04/06/game-networking-3.html
- [HIGH] npm registry version checks run 2026-03-29: socket.io@4.8.3, socket.io-client@4.8.3, vite@8.0.3, vitest@4.1.2, typescript@6.0.2, fast-check@4.6.0, bufferutil@4.1.0, utf-8-validate@6.0.6

---

_Stack research for: v0.0.3 Deterministic Lockstep Protocol_
_Researched: 2026-03-29_
