# Milestones

## v0.0.3 Deterministic Lockstep Protocol (Shipped: 2026-03-30)

**Phases completed:** 5 phases, 10 plans, 17 tasks

**Key accomplishments:**

- RtsRoom.fromPayload() factory for reconstructing fully tickable rooms from RoomStatePayload with bit-identical determinism hashes
- ClientSimulation class with server-driven tick advance, input replay, and hash checkpoint verification wired into client.ts socket handlers via dual-path rendering
- InputEventLog ring buffer for bounded input event storage with TDD, plus sequence field on BuildQueuedPayload/DestroyQueuedPayload populated from lockstep monotonic counter
- Broadcast suppression gating on isInputOnlyMode, InputEventLog lifecycle wiring, and client checkpoint guard with 6 integration tests
- Client detects hash mismatch at lockstep checkpoints, requests full state snapshot, and reinitializes local simulation via ClientSimulation.resync(); server guarantees turn-buffer flush before snapshot in primary mode
- 3 integration tests prove end-to-end: checkpoint hashes carry valid FNV-1a-32 digests for client comparison, server responds to state:request with full snapshot during primary lockstep, and snapshot tick is fresh relative to most recent checkpoint (turn-buffer flush guarantee)
- Input log delivery via room:joined payload with sorted client-side replay for deterministic reconnect catchup
- 4 integration tests proving reconnect-replay-verify cycle with inputLog delivery, build event inclusion, empty log edge case, and no-broadcast verification
- Property-based determinism tests using fast-check prove server/client hash parity across 350+ random input scenarios with 500+ ticks each
- Integration test proves Grid.toPacked() ArrayBuffer survives Socket.IO binary attachment path without corruption via byte-level round-trip comparison

---

## v0.0.1 Prototype Baseline (Shipped: 2026-03-01)

**Phases completed:** 5 phases, 16 plans, 48 tasks
**Git range:** `f4daac0..06577d2`
**Timeline:** 2026-02-27 04:44 UTC -> 2026-03-01 09:41 UTC (2.21 days)

**Key accomplishments:**

- Established deterministic lobby/team flow with authoritative membership updates and reconnect-safe session ownership.
- Added 30-second reconnect hold/reclaim behavior with UI indicators and race-condition regression coverage.
- Implemented canonical lifecycle transitions and breach outcome resolution with defeat lockout enforcement.
- Enforced queue-only gameplay mutations with explicit terminal build outcomes and typed rejection reasons.
- Delivered economy/queue UX (affordability preview, pending timeline, resource deltas) driven by authoritative payloads.
- Added explicit QUAL-02 end-to-end integration coverage plus `test:quality` gate scripts for repeatable validation.

**Requirement scope note:** `LOBBY-02` is treated as a delivered capability, not a formal milestone requirement for closure accounting.

**Audit note:** No `v0.0.1-MILESTONE-AUDIT.md` file was present at completion time.

---

## v0.0.2 Gameplay Expansion (Shipped: 2026-03-03)

**Phases completed:** 7 phases, 14 plans, 33 tasks
**Git range:** `1cba7f0..5c4018d`
**Timeline:** 2026-03-01 12:55 UTC -> 2026-03-02 16:21 -0700 (1.44 days)
**Diff stats:** 94 files changed, 16,685 insertions, 1,719 deletions
**Scope note:** Stats use the kickoff-to-HEAD range selected during milestone closeout.

**Key accomplishments:**

- Canonicalized base gameplay around a shared 5x5 (16-cell) footprint and deterministic template-wide integrity repair.
- Replaced center-point territory checks with authoritative full-footprint union build-zone legality (fixed radius 15).
- Delivered transform-aware placement end-to-end (engine, server, web) with rotate/mirror parity across preview, queue, and apply.
- Added deterministic destroy queue behavior with stable rejection taxonomy and reconnect-safe structure/pending projection.
- Split lobby and in-game screens by authoritative lifecycle state while preserving shared chat draft continuity.
- Added in-match camera controls, union-zone visualization, pinned structure inspector, and tactical Economy/Build/Team overlays.

**Known gaps:**

- Milestone closed without `.planning/v0.0.2-MILESTONE-AUDIT.md`; run `/gsd-audit-milestone` retroactively if full gap verification is required.

---
