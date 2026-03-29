# Requirements: Conway RTS

**Defined:** 2026-03-29
**Core Value:** Two players can quickly get into a match and use Conway-based strategy to defend their safe cell and breach the opponent's.

## v0.0.3 Requirements

Requirements for deterministic lockstep protocol migration. Each maps to roadmap phases.

### Client Simulation

- [x] **SIM-01**: Client initializes a local RtsRoom from the server-provided starting state and tick number at match start, then processes ticks identically to the server during active match
- [ ] **SIM-02**: Client tick cadence aligns to the server clock with drift correction so both advance in lockstep

### Transport Protocol

- [x] **XPORT-01**: Server relays confirmed input events (build/destroy queue accepts) instead of per-tick full state broadcasts; steady-state active match traffic consists only of input events and periodic checkpoint hashes
- [x] **XPORT-02**: Server retains a bounded input log (ring buffer) covering the reconnect window for replay delivery
- [x] **XPORT-03**: Server assigns a deterministic ordering to inputs received in the same tick window before relaying to all clients

### Consistency Verification

- [x] **SYNC-01**: Client computes a determinism hash at checkpoint intervals and compares it with the server-broadcast hash
- [x] **SYNC-02**: On hash mismatch the client receives a full state snapshot and resynchronizes its local simulation

### Reconnect

- [ ] **RECON-01**: Disconnected player rejoins mid-match by receiving a state snapshot plus the input log from that snapshot tick forward

### Quality & Verification

- [ ] **QUAL-01**: Property-based determinism tests prove that identical input sequences produce identical state hashes across server and client simulation instances

## Future Requirements

Deferred to future release. Tracked but not in current roadmap.

### UX Enhancements

- **UX2-01**: Minimap and fog-of-war map awareness
- **UX2-02**: Bulk destroy and undo/redo timeline controls
- **UX2-03**: Custom structure template authoring/sharing

### Base Geometry

- **BASE2-01**: Multiple base archetypes or configurable base geometry

### Replay & Spectator

- **REPLAY-01**: Replay/spectator mode using lockstep input log

## Out of Scope

| Feature | Reason |
|---------|--------|
| Client-predicted simulation / rollback netcode | Contradicts lockstep authority model; adds rollback/reconciliation complexity |
| Peer-to-peer lockstep | NAT traversal complexity; server-relay model is superior for two-player web game |
| Binary/protobuf transport encoding | JSON over Socket.IO is sufficient for two-player prototype; premature optimization |
| Dynamic input delay tuning | Adaptive clock management not justified at prototype scale |
| Full invisible desync recovery | State resync requires snapshot transfer; brief visible pause is standard lockstep behavior |
| Account/auth system | Out of scope for prototype validation |
| Frontend framework / renderer migration | Deferred until scale/performance demands it |

## Constraints

- Server remains authoritative for the match-finished lifecycle transition; clients predict defeat/victory locally but the server declares the canonical outcome
- Lockstep applies only to `active` match state; lobby, team selection, countdown, and chat are unchanged
- Existing reconnect behavior must be preserved (players can rejoin mid-match)

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SIM-01 | Phase 13 | Complete |
| SIM-02 | Phase 13 | Pending |
| XPORT-01 | Phase 14 | Complete |
| XPORT-02 | Phase 14 | Complete |
| XPORT-03 | Phase 14 | Complete |
| SYNC-01 | Phase 15 | Complete |
| SYNC-02 | Phase 15 | Complete |
| RECON-01 | Phase 16 | Pending |
| QUAL-01 | Phase 17 | Pending |

**Coverage:**
- v0.0.3 requirements: 9 total
- Mapped to phases: 9
- Unmapped: 0

---
*Requirements defined: 2026-03-29*
*Last updated: 2026-03-29 after roadmap creation (Phases 13-17)*
