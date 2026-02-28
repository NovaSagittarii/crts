# Requirements: Conway RTS TypeScript Prototype

**Defined:** 2026-02-27
**Core Value:** Two players can quickly get into a match and use Conway-based strategy to defend their safe cell and breach the opponent's.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Lobby & Teams

- [x] **LOBBY-01**: User can list, create, join, and leave rooms with deterministic membership updates.
- [x] **LOBBY-02**: User can join a team and receive deterministic base assignment for that team.
- [x] **LOBBY-03**: Team spawn locations are equally spaced on the torus map to ensure fair starts and avoid overlap.
- [x] **LOBBY-04**: Reconnecting user can rejoin their room and receive authoritative state resync.

### Match Lifecycle

- [x] **MATCH-01**: Host can start a match only when lifecycle preconditions are met, and room state transitions through `lobby -> countdown -> active -> finished`.
- [x] **MATCH-02**: Match uses one canonical breach rule and ends with explicit winner/loser outcomes.
- [x] **MATCH-03**: Defeated user is locked out of gameplay actions and sees clear defeat status.

### Build Queue & Validation

- [x] **BUILD-01**: User can queue a template build and receives queued acknowledgement with execute tick.
- [x] **BUILD-02**: Every queued build reaches a terminal outcome: `applied` or `rejected(reason)`.
- [x] **BUILD-03**: Gameplay mutations are accepted only through validated queue paths (no direct bypass mutation path).
- [x] **BUILD-04**: Build validation enforces bounds and territory constraints with explicit rejection messages.

### Economy

- [ ] **ECON-01**: User can see current resources and per-tick income in the match HUD.
- [x] **ECON-02**: User can only queue affordable builds; unaffordable requests are rejected with reason.
- [x] **ECON-03**: Resource income updates dynamically based on owned structures/territory state.

### UX

- [x] **UX-01**: User can inspect pending builds in a queue timeline organized by execute tick.

### Quality Gates

- [ ] **QUAL-01**: Developers can run unit tests covering lobby/team invariants, queue validation, queue terminal outcomes, and economy rules.
- [ ] **QUAL-02**: Developers can run integration tests covering end-to-end flow: join -> build -> tick -> breach -> defeat.

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Gameplay Expansion

- **GAME-01**: User can plan ghost-cell edits in a single-batch draft/commit workflow.
- **GAME-02**: User can use expanded offense/defense/support template catalog beyond baseline set.
- **GAME-03**: User can view near-safe-cell threat indicators for faster defensive reaction.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature                                    | Reason                                                                       |
| ------------------------------------------ | ---------------------------------------------------------------------------- |
| WebAssembly simulation pipeline            | This milestone optimizes for TypeScript iteration speed and rapid validation |
| Protobuf networking                        | Socket.IO JSON contracts are enough for prototype scope                      |
| Accounts and persistent profiles           | Session-level identity is sufficient for v1 validation                       |
| Large-scale map/performance program        | Defer until core gameplay loop is validated and measured                     |
| Ranked matchmaking and progression systems | Adds backend/product complexity not required for prototype proof             |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase   | Status  |
| ----------- | ------- | ------- |
| LOBBY-01    | Phase 1 | Complete |
| LOBBY-02    | Phase 1 | Complete |
| LOBBY-03    | Phase 1 | Complete |
| LOBBY-04    | Phase 1 | Complete |
| MATCH-01    | Phase 2 | Complete |
| MATCH-02    | Phase 2 | Complete |
| MATCH-03    | Phase 2 | Complete |
| BUILD-01    | Phase 3 | Complete |
| BUILD-02    | Phase 3 | Complete |
| BUILD-03    | Phase 3 | Complete |
| BUILD-04    | Phase 3 | Complete |
| ECON-01     | Phase 4 | Pending |
| ECON-02     | Phase 4 | Complete |
| ECON-03     | Phase 4 | Complete |
| UX-01       | Phase 4 | Complete |
| QUAL-01     | Phase 5 | Pending |
| QUAL-02     | Phase 5 | Pending |

**Coverage:**

- v1 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0 ✓

---

_Requirements defined: 2026-02-27_
_Last updated: 2026-02-27 after roadmap creation_
