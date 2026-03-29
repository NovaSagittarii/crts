# Roadmap: Conway RTS TypeScript Prototype

## Milestones

- ✅ **v0.0.1 Prototype Baseline** — shipped 2026-03-01 (Phases 1-5). Archive: `.planning/milestones/v0.0.1-ROADMAP.md`
- ✅ **v0.0.2 Gameplay Expansion** — shipped 2026-03-03 (Phases 6-12). Archive: `.planning/milestones/v0.0.2-ROADMAP.md`
- 🚧 **v0.0.3 Deterministic Lockstep Protocol** — Phases 13-17 (in progress)

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3, …): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

<details>
<summary>✅ v0.0.1 Prototype Baseline (Phases 1-5) — SHIPPED 2026-03-01</summary>

See archive: `.planning/milestones/v0.0.1-ROADMAP.md`

</details>

<details>
<summary>✅ v0.0.2 Gameplay Expansion (Phases 6-12) — SHIPPED 2026-03-03</summary>

See archive: `.planning/milestones/v0.0.2-ROADMAP.md`

</details>

### 🚧 v0.0.3 Deterministic Lockstep Protocol (In Progress)

**Milestone Goal:** Migrate the network protocol from full-state broadcast to deterministic lockstep, where clients run the simulation locally and the server acts as a thin input validator and relay.

- [x] **Phase 13: Client Simulation Foundation** - Build the local simulation runner and tick clock; verify client and server produce identical state hashes (completed 2026-03-29)
- [x] **Phase 14: Input-Only Transport** - Switch server to relay inputs instead of broadcasting full state; establish bounded input log (completed 2026-03-29)
- [ ] **Phase 15: Hash Checkpoint Protocol** - Wire desync detection and state-resync fallback as the primary consistency mechanism
- [ ] **Phase 16: Reconnect via Snapshot + Input Replay** - Reconnecting clients receive a state snapshot plus input log and replay to current tick
- [ ] **Phase 17: Quality Gate** - Property-based tests confirm lockstep invariants hold over long random input sequences

## Phase Details

### Phase 13: Client Simulation Foundation
**Goal**: Clients run an authoritative local copy of the match simulation that stays in lockstep with the server
**Depends on**: Phase 12 (v0.0.2 complete)
**Requirements**: SIM-01, SIM-02
**Success Criteria** (what must be TRUE):
  1. At match start the client initializes a local `RtsRoom` from the server-provided state snapshot and tick number, then advances the simulation on every tick without receiving full state broadcasts
  2. The client tick counter derives from server-emitted `executeTick` and checkpoint values, not from a local setInterval count
  3. After N ticks with M queued inputs, the client-computed determinism hash matches the server-computed hash
  4. Client-side event rejection at `executeTick` mirrors server rejection without suppressing server-accepted events
**Plans**: 2 plans
Plans:
- [x] 13-01-PLAN.md — RtsRoom.fromPayload() factory + hash equivalence unit tests
- [x] 13-02-PLAN.md — ClientSimulation module + client.ts wiring (dual-path)
**UI hint**: yes

### Phase 14: Input-Only Transport
**Goal**: Active match traffic consists only of relayed input events; the server no longer broadcasts full state every tick
**Depends on**: Phase 13
**Requirements**: XPORT-01, XPORT-02, XPORT-03
**Success Criteria** (what must be TRUE):
  1. No full-state broadcast is emitted during an active lockstep match; only `build:queued`/`destroy:queued` relay events and periodic checkpoint hashes cross the wire
  2. The server assigns a deterministic ordering to inputs received within the same tick window before relaying to all clients
  3. A bounded ring buffer on the server retains accepted input events covering the configured reconnect window; entries older than the window are discarded
**Plans**: 2 plans
Plans:
- [x] 14-01-PLAN.md — InputEventLog ring buffer + sequence field on queued payloads (TDD)
- [x] 14-02-PLAN.md — Broadcast suppression + InputEventLog wiring + client update + integration tests

### Phase 15: Hash Checkpoint Protocol
**Goal**: Periodic hash checkpoints catch state divergence and trigger authoritative state resync
**Depends on**: Phase 14
**Requirements**: SYNC-01, SYNC-02
**Success Criteria** (what must be TRUE):
  1. The client computes a determinism hash at each checkpoint interval and compares it against the server-broadcast hash
  2. A deliberate divergence injected in a test causes the client to detect a mismatch and request a state resync within one checkpoint interval
  3. After receiving a fallback snapshot the client resets its local simulation to the canonical state and resumes ticking from the correct tick boundary
  4. The fallback snapshot is delivered only after all turn-buffer commands due at or before the fallback tick have executed
**Plans**: TBD

### Phase 16: Reconnect via Snapshot + Input Replay
**Goal**: A disconnected player can rejoin mid-match, replay the input log, and resume in sync with the live game
**Depends on**: Phase 15
**Requirements**: RECON-01
**Success Criteria** (what must be TRUE):
  1. A player who disconnects mid-match receives a post-tick state snapshot and the server input log from that snapshot tick forward upon reconnecting
  2. The reconnect engine replays the input log against the local `RtsRoom` in insertion-sorted order and the resulting state hash matches the server checkpoint hash
  3. The client resumes the live tick loop from the correct tick after replay completes without a full state re-broadcast
**Plans**: TBD

### Phase 17: Quality Gate
**Goal**: Property-based tests and integration coverage confirm the lockstep protocol is correct and all prior milestone behavior is preserved
**Depends on**: Phase 16
**Requirements**: QUAL-01
**Success Criteria** (what must be TRUE):
  1. Property-based tests using `fast-check` confirm that identical input sequences applied to independent server and client simulation instances produce identical state hashes after 500+ ticks across diverse random inputs
  2. An `ArrayBuffer` round-trip integration test confirms `Grid.toPacked()` survives the Socket.IO binary attachment path without corruption
  3. All pre-existing non-lockstep integration tests continue to pass
**Plans**: TBD

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1-5 (archived) | v0.0.1 | — | Complete | 2026-03-01 |
| 6-12 (archived) | v0.0.2 | — | Complete | 2026-03-03 |
| 13. Client Simulation Foundation | v0.0.3 | 2/2 | Complete    | 2026-03-29 |
| 14. Input-Only Transport | v0.0.3 | 2/2 | Complete   | 2026-03-29 |
| 15. Hash Checkpoint Protocol | v0.0.3 | 0/TBD | Not started | - |
| 16. Reconnect via Snapshot + Input Replay | v0.0.3 | 0/TBD | Not started | - |
| 17. Quality Gate | v0.0.3 | 0/TBD | Not started | - |
